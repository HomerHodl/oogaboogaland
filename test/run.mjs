import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, acquire, dispose, driverError } from "./browser.mjs";
import { writeCharacters } from "../scripts/characters.mjs";
// ---- solid-props.mjs ----
const { solidPropsProbe } = (() => {
  // Exercise the same transformed mesh queries used by hub movement.
  // The old arch proves a prop's empty bounding-box space stays traversable.
  const solidPropsProbe = () => {
    const { scene, models, hubModels, solidProps } = window.BL;
    const solids = solidProps.create(), rows = [];
    const box = scene.createNode({ geometry: models.box({ w: 2, h: 2, d: 2, color: "#fff", offset: { y: 1 } }) });
    const sync = (root) => { scene.updateWorld(root); solids.sync(); };
    solids.add(box); solids.add(box); sync(box);
    rows.push({ name: "solid volume and swept sides", ok: solids.stats.nodes === 1 && !solids.clearAt(0, 0.2, 0, 0.2, 0.4) && !solids.segmentClear(-3, 0.2, 0, 3, 0.2, 0, 0.2, 1) && solids.clearAt(2, 0, 0, 0.2, 1) });
    rows.push({ name: "landing footprint and head clearance", ok: solids.supportAt(0, 0, 3, 0, 0.2) === 2 && solids.supportAt(1.1, 0, 3, 0, 0.2) === 2 && solids.clearAt(0, 2, 0, 0.2, 1) && solids.ceilingAt(0, 0, -2, 0.2) === 0 && solids.ceilingAt(3, 0, -2, 0.2) === Infinity });
    // Raising a rider next to a mesh can leave a shallow side overlap. Recover in ordinary short walking
    // steps, including mirrored mesh winding, without granting entry or tunnelling through another prop.
    const recovery = [];
    for (const sign of [1, -1]) {
      box.scale.x = sign; sync(box);
      const strict = !solids.segmentClear(sign * 1.1, 0.8, 0, sign * 1.15, 0.8, 0, 0.3, 1.5);
      const inward = !solids.escapeSegmentClear(sign * 1.1, 0.8, 0, sign * 1.05, 0.8, 0, 0.3, 1.5);
      const entry = !solids.escapeSegmentClear(sign * 1.6, 0.8, 0, sign * 1.15, 0.8, 0, 0.3, 1.5);
      const inside = !solids.escapeSegmentClear(sign * 0.95, 0.8, 0, sign * 1.05, 0.8, 0, 0.3, 1.5);
      let escaped = true, x = sign * 1.1;
      for (let i = 0; i < 5; i++) { const nx = x + sign * 0.05; escaped &&= solids.escapeSegmentClear(x, 0.8, 0, nx, 0.8, 0, 0.3, 1.5); x = nx; }
      recovery.push(strict && inward && entry && inside && escaped && solids.clearAt(x, 0.8, 0, 0.3, 1.5));
    }
    box.scale.x = 1;
    const post = scene.createNode({ geometry: models.box({ w: 0.04, h: 3, d: 2, color: "#fff" }), position: { x: 2.1, y: 1.5, z: 0 } });
    solids.add(post); sync(box); sync(post);
    rows.push({ name: "raised rider escapes existing mesh contact without entering solids", ok: recovery.every(Boolean)
      && !solids.escapeSegmentClear(1.1, 0.8, 0, 2.5, 0.8, 0, 0.3, 1.5), recovery });
    solids.remove(post);
    box.rotation.z = 0.4; box.scale.x = 2; box.scale.z = 0.5; box.position.x = 5; sync(box);
    const tiltedTop = solids.supportAt(5, 0, 10, 0, 0.3);
    rows.push({ name: "rotation and nonuniform scale", ok: tiltedTop > 2 && tiltedTop < 2.5 && !solids.clearAt(5, 0.5, 0, 0.2, 0.3) && solids.clearAt(5, tiltedTop, 0, 0.3, 1.5) && solids.clearAt(5, 0.5, 0, 0.2, 0.3, box), top: tiltedTop });
    box.visible = false; solids.sync();
    rows.push({ name: "hidden and removed scenery", ok: solids.clearAt(5, 0.5, 0, 0.2, 0.3) && solids.supportAt(5, 0, 10, 0, 0.3) === -Infinity });
    solids.remove(box);
    const gate = scene.createNode({ geometry: hubModels.gate() }); solids.add(gate); sync(gate);
    const bounds = scene.boundsOf(gate.geometry), left = (bounds.min[0] * 2 + bounds.max[0]) / 3;
    rows.push({ name: "old gate opening and columns", ok: solids.segmentClear(0, 0, -2, 0, 0, 2, 0.2, 1.2) && !solids.segmentClear(bounds.min[0] + 0.05, 0, -2, bounds.min[0] + 0.05, 0, 2, 0.2, 1.2) && solids.supportAt(left, 0, 10, 0, 0.2) > 1.5 });
    solids.remove(gate);
    for (const [name, root] of [
      ["barrel", scene.createNode({ geometry: hubModels.barrel() })],
      ["box", scene.createNode({ geometry: hubModels.woodCrate() })],
      ["tree", scene.createNode({ geometry: hubModels.tree(0) })],
      ["rock", scene.createNode({ geometry: hubModels.rock(0) })]
    ]) {
      solids.add(root); sync(root);
      const top = solids.supportAt(0, 0, 20, 0, 0.3);
      const side = solids.segmentClear(-4, 0.05, 0, 4, 0.05, 0, 0.3, 1.5);
      rows.push({ name: `${name} sides and landing`, ok: Number.isFinite(top) && top > 0 && !side && solids.clearAt(0, top, 0, 0.3, 1.5), top });
      solids.remove(root);
    }
    // Outer visible leaves, rather than the old collision crown, are the
    // oracle: each sampled top must catch a landing in its placed frame.
    const canopies = [];
    for (const [name, geometry] of [
      ...Array.from({ length: 4 }, (_, i) => ["tree " + i, hubModels.tree(i)]),
      ...window.BL.poolModels.CANOPY.map((build, i) => ["rainforest " + i, build()]),
      ...Array.from({ length: 3 }, (_, i) => ["palm " + i, window.BL.dressing.palm(i)])
    ]) {
      const root = scene.createNode({ geometry, position: { x: 3, y: 0.7, z: -2 },
        rotation: { x: 0, y: 0.71, z: 0 }, scale: { x: 1.3, y: 1.1, z: 0.8 } });
      solids.add(root); sync(root);
      const points = Array(16).fill(null), reach = Array(16).fill(-Infinity), v = geometry.verts;
      const bounds = scene.boundsOf(geometry), low = bounds.min[1] + (bounds.max[1] - bounds.min[1]) * 0.55;
      for (const face of geometry.faces) for (let i = 1; i + 1 < face.i.length; i++) {
        const a = face.i[0] * 3, b = face.i[i] * 3, c = face.i[i + 1] * 3;
        const ny = (v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
        const x = (v[a] + v[b] + v[c]) / 3, y = (v[a + 1] + v[b + 1] + v[c + 1]) / 3, z = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
        if (ny <= 1e-10 || y < low) continue;
        for (let direction = 0; direction < points.length; direction++) {
          const angle = direction * Math.PI * 2 / points.length, distance = x * Math.cos(angle) + z * Math.sin(angle);
          if (distance <= reach[direction]) continue;
          reach[direction] = distance;
          points[direction] = [x, y, z];
        }
      }
      const failures = [];
      for (let i = 0; i < points.length; i++) {
        if (!points[i]) { failures.push(i); continue; }
        const p = new Float64Array(3); window.BL.math.mat4.transformPoint(p, root.world, ...points[i]);
        const top = solids.supportAt(p[0], p[2], 20, 0, 0.05);
        if (top < p[1] - 1e-6 || !solids.clearAt(p[0], top, p[2], 0.05, 1.5)) failures.push(i);
      }
      root.visible = false; solids.sync();
      const hidden = solids.supportAt(3, -2, 20, 0, 0.3) === -Infinity;
      canopies.push({ name, failures, hidden });
      solids.remove(root);
    }
    rows.push({ name: "all tree crowns and palm fronds catch outer-leaf landings after rotation and scaling", ok: canopies.length === 10 && canopies.every(row => !row.failures.length && row.hidden), canopies });
    const leaves = scene.createNode({ geometry: { verts: [-1, 3, -1, -1, 3, 1, 1, 3, 1, 1, 3, -1],
      faces: [{ i: [0, 1, 2, 3], color: [80, 160, 40], supportOnly: true }], lines: [] } });
    solids.add(leaves); sync(leaves);
    const shoulder = {};
    rows.push({ name: "leaf landing surfaces do not enclose bodies, block movement or become ceilings", ok: solids.supportAt(0, 0, 4, 0, 0.3) === 3
      && solids.clearAt(0, 2.7, 0, 0.3, 1.5) && solids.segmentClear(0, 0, 0, 0, 4, 0, 0.3, 1.5)
      && solids.ceilingAt(0, 0, 0, 0.3) === Infinity && !solids.shoulderAt(-2, 2.7, 0, 1, 0, 0.3, 1.5, 4, shoulder) });
    solids.remove(leaves);
    solids.dispose();
    rows.push({ name: "registry cleanup", ok: solids.stats.nodes === 0 && solids.stats.triangles === 0 });
    return rows;
  };
  return { solidPropsProbe };
})();

// ---- npc-paths.mjs ----
const { npcPathWalkingProbe, npcCenterlineProbe, npcLowerTurnsProbe, npcStairPassingProbe } = (() => {
  // Paths change underneath a route and a second Ooga occupies the trail.
  // Path preference must never block arrival.
  const npcPathWalkingProbe = () => {
    const B = window.__ooga, BL = window.BL, S = BL.scene, scene = BL.scenes.hub;
    const actors = [...B.cavemen.values()], cave = actors.find((c) => c.state === "working") || actors[0], blocker = actors.find((c) => c !== cave);
    const nav = B.headquarters.npcPaths, path = B.island.path, rows = [], dt = 1 / 30;
    const cage = S.createNode(), wall = BL.models.box({ w: 2.6, h: 1.2, d: 0.25, color: "#777777" });
    for (let n = 0; n < 4; n++) S.addChild(cage, S.createNode({ geometry: wall,
      position: { x: n < 2 ? 0 : n === 2 ? -1 : 1, y: 0.6, z: n < 2 ? n ? 1 : -1 : 0 }, rotation: { x: 0, y: n < 2 ? 0 : Math.PI / 2, z: 0 } }));
    cage.visible = false; S.addChild(scene.root, cage); B.headquarters.solids.props.add(cage);
    const original = scene.update; scene.update = () => {}; B.pilot.release(true); B.setPileLevel(100000);
    for (const prop of B.props) prop.node.visible = false;
    for (const c of actors) {
      c.root.visible = false; c.state = "working"; c.build = null; c.bedTravel.mode = "";
      c.walk = null; c.act.kind = "idle"; c.act.until = c.nextBuildAt = 1e12;
      c.hop = c.hopV = c.cheer = c.catchT = c.yawn = 0;
    }
    let time = B.renderOpts.matrix.time;
    try {
      for (const name of ["ring", "passing", "changed path", "fireplace", "jump recovery"]) {
        path.setRadius(B.altar.platformRadius);
        const r = path.debug.ringTrafficRadius, tx = name === "fireplace" ? B.fireSeats[0].x : r, tz = name === "fireplace" ? B.fireSeats[0].z : 0;
        cave.root.visible = true; blocker.root.visible = false;
        Object.assign(cave.root.position, { x: -r, y: cave.baseY, z: 0 });
        cave.act.kind = "wander"; Object.assign(cave.act.spot, { x: tx, z: tz, ry: 0 });
        cave.walk = { tx, tz, speed: 1.7, phase: 0, heading: 0, to: "spot" };
        cave.avoidance.tx = NaN; cave.avoidance.navigation.mode = 0; cave.pathing.tx = NaN;
        cave.hop = cave.hopV = 0; cave.leap.vx = cave.leap.vz = 0;
        cage.visible = name === "jump recovery"; cage.position.x = -r;
        S.updateWorld(scene.root); B.headquarters.solids.props.sync();
        nav.target(cave, tx, tz);
        const plans = cave.pathing.plans, count = cave.pathing.count, storage = cave.pathing.route;
        const jumps = cave.avoidance.navigation.jumps;
        const laneSign = count > 1 ? Math.sign(nav.zAt(storage[1]) - nav.zAt(storage[0])) : 0;
        if (name === "passing") {
          const i = storage[Math.floor(count / 2)];
          Object.assign(blocker.root.position, { x: nav.xAt(i), y: blocker.baseY, z: nav.zAt(i) });
          blocker.root.visible = true; S.updateWorld(scene.root);
        }
        let frames = 0, onPath = 0, separation = Infinity, maximumStep = 0, maximumTurn = 0, midpointError = 0, laneError = 0, laneSamples = 0, minimumTrafficRadius = Infinity, heading = NaN, changed = false, recovered = false, intersections = 0, lastX = cave.root.position.x, lastZ = cave.root.position.z;
        while (cave.walk && !recovered && frames++ < 3600) {
          if (name === "changed path" && frames === 30) { path.setRadius(B.altar.platformRadius + 0.5); changed = true; }
          B.crew.update(dt, time += dt); S.updateWorld(scene.root); B.headquarters.solids.props.sync();
          const p = cave.root.position;
          if (name === "jump recovery") {
            const feet = p.y - cave.baseY;
            if (!B.headquarters.solids.props.clearAt(p.x, feet + 1e-5, p.z, 0.295, cave.bodyHeight - 1e-5)) intersections++;
            recovered = cave.hop === 0 && feet > 1.1 && Math.hypot(p.x + r, p.z) > 0.6;
          }
          if (B.island.isPath(p.x, p.z)) onPath++;
          if (blocker.root.visible) separation = Math.min(separation, Math.hypot(p.x - blocker.root.position.x, p.z - blocker.root.position.z));
          const step = Math.hypot(p.x - lastX, p.z - lastZ), angle = Math.atan2(p.x - lastX, p.z - lastZ);
          if (step > 0.03 && Number.isFinite(heading)) maximumTurn = Math.max(maximumTurn, Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading))));
          if (step > 0.03) heading = angle;
          if (name === "ring") {
            midpointError = Math.max(midpointError, Math.abs(Math.hypot(p.x, p.z) - r));
            if (Math.hypot(p.x + r, p.z) > 1.5 && Math.hypot(p.x - tx, p.z - tz) > 1.5) {
              laneSamples++; laneError = Math.max(laneError, Math.abs(Math.hypot(p.x, p.z) - (r + laneSign * 0.35)));
              minimumTrafficRadius = Math.min(minimumTrafficRadius, Math.hypot(p.x, p.z));
            }
          }
          maximumStep = Math.max(maximumStep, step); lastX = p.x; lastZ = p.z;
        }
        rows.push({ name, arrived: !cave.walk, distance: Math.hypot(cave.root.position.x - tx, cave.root.position.z - tz), frames,
          onPath: onPath / frames, separation: Number.isFinite(separation) ? separation : null, maximumStep, maximumTurn, midpointError, laneError, laneSamples, changed,
          ringWidth: path.debug.ringOuterRadius - path.debug.ringInnerRadius, outerTraffic: minimumTrafficRadius > path.debug.ringCenterRadius,
          innerLoading: B.crew.fanSlots.length > 0 && B.crew.fanSlots.every(slot => Math.hypot(slot.x, slot.z) > path.debug.ringInnerRadius && Math.hypot(slot.x, slot.z) < path.debug.ringCenterRadius),
          replans: cave.pathing.plans - plans, jumps: cave.avoidance.navigation.jumps - jumps, recovered, intersections, count, stable: cave.pathing.route === storage && storage.length === nav.capacity });
      }
      return rows;
    } finally { B.headquarters.solids.props.remove(cage); S.removeChild(scene.root, cage); path.setRadius(B.altar.platformRadius); scene.update = original; }
  };

  const npcCenterlineProbe = () => {
    const B = window.__ooga, scene = window.BL.scenes.hub, S = window.BL.scene;
    const nav = B.headquarters.npcPaths, path = B.island.path, actors = [...B.cavemen.values()], cave = actors.find((c) => c.state === "working") || actors[0], rows = [];
    B.pilot.release(true); B.setPileLevel(100000);
    const update = scene.update; scene.update = () => {};
    for (const prop of B.props) prop.node.visible = false;
    for (const c of actors) { c.root.visible = false; c.override = c.state = "away"; c.work.phase = ""; B.crew.stopBurst(c); B.crew.stopReload(c, true); c.bedTravel.mode = ""; c.walk = null; c.act.kind = "idle"; c.act.until = c.nextBuildAt = 1e12; }
    cave.override = cave.state = "working";
    cave.root.visible = true;
    let time = B.renderOpts.matrix.time;
    try {
      for (let line = 0; line < path.centerlines.length; line++) {
        const points = [];
        for (const p of path.centerlines[line]) {
          // Decorative trails continue into sealed mouths; exercise their
          // usable approaches, not destinations the crew intentionally rejects.
          const clear = Math.hypot(p.x, p.z) >= path.debug.ringTrafficRadius + 0.5 && B.island.isPath(p.x, p.z)
            && !B.headquarters.solids.npcDestinationBlocked(cave, p.x, p.z)
            && B.headquarters.solids.npcWalkable(p.x, p.z, p.x, p.z, B.island.surfaceAt(p.x, p.z), cave.bodyHeight, cave);
          if (clear) points.push(p); else if (points.length) break;
        }
        if (points.length < 2) continue;
        let pathLength = 0;
        for (let n = 1; n < points.length; n++) pathLength += Math.hypot(points[n].x - points[n - 1].x, points[n].z - points[n - 1].z);
        for (const direction of [1, -1]) {
          const start = direction > 0 ? points[0] : points.at(-1), end = direction > 0 ? points.at(-1) : points[0], r = path.debug.ringTrafficRadius;
          Object.assign(cave.root.position, { x: 0, y: cave.baseY, z: -r }); cave.pathing.tx = NaN;
          nav.target(cave, end.x, end.z); const connected = cave.pathing.count > 0;
          Object.assign(cave.root.position, { x: start.x, y: cave.baseY + B.island.surfaceAt(start.x, start.z), z: start.z });
          cave.act.kind = "wander"; Object.assign(cave.act.spot, { x: end.x, z: end.z, ry: 0 });
          cave.walk = { tx: end.x, tz: end.z, speed: 1.7, phase: 0, heading: 0, to: "spot" };
          cave.hop = cave.hopV = 0; cave.avoidance.tx = cave.pathing.tx = NaN; cave.avoidance.navigation.mode = 0;
          S.updateWorld(scene.root); B.headquarters.solids.props.sync();
          let frames = 0, error = 0, laneError = 0, laneSamples = 0, rightSamples = 0, onPath = 0, deviation = null;
          while (cave.walk && frames++ < 1800) {
            B.crew.update(1 / 30, time += 1 / 30); S.updateWorld(scene.root);
            const p = cave.root.position;
            if (B.island.isPath(p.x, p.z)) onPath++;
            let best = Infinity, side = 0;
            for (let n = 1; n < points.length; n++) {
              const a = points[n - 1], b = points[n], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
              const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;
              const distance = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
              if (distance < best) { best = distance; side = length2 ? direction * ((p.z - a.z) * dx - (p.x - a.x) * dz) / Math.sqrt(length2) : 0; }
            }
            error = Math.max(error, best);
            if (Math.hypot(p.x - start.x, p.z - start.z) > 1.5 && Math.hypot(p.x - end.x, p.z - end.z) > 1.5) {
              laneSamples++; if (side > 0) rightSamples++; laneError = Math.max(laneError, Math.abs(side - 0.35));
            }
            if (!deviation && best > 0.45) deviation = { x: p.x, z: p.z, targetX: cave.pathing.targetX, targetZ: cave.pathing.targetZ, index: cave.pathing.index, count: cave.pathing.count, mode: cave.avoidance.navigation.mode, goalX: cave.walk?.tx, goalZ: cave.walk?.tz };
          }
          const distance = Math.hypot(cave.root.position.x - end.x, cave.root.position.z - end.z);
          rows.push({ line, direction, pathLength, connected, arrived: !cave.walk && distance < 1e-6, onPath: onPath / frames, error, laneError, laneSamples, rightSamples, frames, deviation, distance });
        }
      }
      return { rows, lines: path.centerlines.length, nodes: nav.nodes, capacity: nav.capacity };
    } finally { scene.update = update; }
  };

  const npcLowerTurnsProbe = () => {
    const B = window.__ooga, BL = window.BL, scene = BL.scenes.hub, actors = [...B.cavemen.values()], cave = actors.find((c) => c.state === "working") || actors[0], rows = [];
    B.pilot.release(true);
    const update = scene.update; scene.update = () => {};
    for (const prop of B.props) prop.node.visible = false;
    for (const c of actors) {
      c.root.visible = false; c.state = "chilling"; c.bedTravel.mode = ""; c.walk = c.build = null;
      c.act.kind = "idle"; c.act.until = c.nextBuildAt = c.yawnAt = 1e12; c.hop = c.hopV = 0;
      c.work.phase = ""; B.crew.stopBurst(c); B.crew.stopReload(c, true);
    }
    cave.root.visible = true;
    let time = B.renderOpts.matrix.time;
    try {
      for (const ramp of B.island.headquarters.ramps) for (const bed of B.headquarters.mattresses) for (const toBed of [true, false]) {
        const apron = B.island.mouths.find((m) => m.id === ramp.id).apron;
        const start = toBed ? apron : bed.walkAt, floor = toBed ? 0 : bed.room.floor;
        const route = B.headquarters.sleepNavigation.route(start.x, floor, start.z, bed, toBed, apron.x, apron.z);
        if (!route) { rows.push({ room: bed.roomIndex, ramp: ramp.id, missing: true }); continue; }
        cave.work.phase = ""; B.crew.stopBurst(cave); B.crew.stopReload(cave, true);
        cave.root.quaternion = null; cave.root.rotation.x = cave.root.rotation.z = 0;
        Object.assign(cave.root.position, { x: start.x, y: cave.baseY + floor, z: start.z }); cave.state = toBed ? "sleeping" : "chilling"; cave.bedroll = toBed ? bed : null; cave.walk = null;
        cave.avoidance.tx = NaN; cave.avoidance.navigation.mode = 0;
        Object.assign(cave.bedTravel, { mode: "walk", route, index: 0, phase: 0, blocked: 0, toBed, bed });
        BL.scene.updateWorld(scene.root); B.headquarters.solids.props.sync();
        let frames = 0, collisions = 0, maximumTurn = 0, turnAt = null, heading = NaN, lastX = start.x, lastZ = start.z;
        while (cave.bedTravel.mode === "walk" && frames++ < 2400) {
          B.crew.update(1 / 30, time += 1 / 30);
          const p = cave.root.position, feet = p.y - cave.baseY, step = Math.hypot(p.x - lastX, p.z - lastZ), angle = Math.atan2(p.x - lastX, p.z - lastZ);
          if (cave.bedTravel.mode === "walk") {
            if (!B.island.clearAt(p.x, feet + 0.3, p.z, 0.295, cave.bodyHeight - 0.3)) collisions++;
            if (step > 0.03 && Number.isFinite(heading)) {
              const turn = Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)));
              if (turn > maximumTurn) { maximumTurn = turn; turnAt = { x: p.x, y: feet, z: p.z, index: cave.bedTravel.index, points: route.slice(Math.max(0, cave.bedTravel.index - 2), cave.bedTravel.index + 2) }; }
            }
            if (step > 0.03) heading = angle;
          }
          lastX = p.x; lastZ = p.z;
        }
        rows.push({ room: bed.roomIndex, basement: bed.basement, ramp: ramp.id, toBed, arrived: toBed ? cave.bedTravel.mode === "lie" : cave.bedTravel.mode === "", collisions, maximumTurn, turnAt, frames, points: route.length });
        cave.bedTravel.mode = ""; cave.state = "working";
      }
      return rows;
    } finally { scene.update = update; }
  };

  const npcStairPassingProbe = ({ dt = 1 / 30 } = {}) => {
    const B = window.__ooga, BL = window.BL, scene = BL.scenes.hub, actors = [...B.cavemen.values()];
    const cave = actors.find((c) => c.state === "working") || actors[0], blocker = actors.find((c) => c !== cave), rows = [];
    B.pilot.release(true);
    const update = scene.update; scene.update = () => {};
    for (const c of actors) {
      c.root.visible = false; c.state = "chilling"; c.bedTravel.mode = ""; c.walk = c.build = null;
      c.act.kind = "idle"; c.act.until = c.nextBuildAt = c.yawnAt = 1e12; c.hop = c.hopV = 0;
      c.work.phase = ""; B.crew.stopBurst(c); B.crew.stopReload(c, true);
    }
    let time = B.renderOpts.matrix.time;
    try {
      for (const [level, ramps] of [["HQ", B.island.headquarters.ramps], ["basement", B.island.headquarters.basement.ramps]]) {
        for (const ramp of ramps) for (const uphill of [true, false]) for (const offset of [0, 0.4, -0.4]) {
          const route = ramp.samples.map((p) => ({ x: p.x, y: p.y, z: p.z }));
          if ((route[0].y > route.at(-1).y) === uphill) route.reverse();
          const start = route[0], end = route.at(-1), middle = Math.floor(route.length / 2), at = route[middle], next = route[middle + 1];
          const length = Math.hypot(next.x - at.x, next.z - at.z), fx = (next.x - at.x) / length, fz = (next.z - at.z) / length;
          route.push({ ...end });
          for (const c of [cave, blocker]) {
            c.root.visible = true; c.root.quaternion = null; c.bedTravel.mode = ""; c.walk = null;
            c.avoidance.tx = NaN; c.avoidance.navigation.mode = 0; c.hop = c.hopV = 0;
            Object.assign(c.shoulder, { phase: 0, other: null, yaw: 0, targetYaw: 0, motionX: 0, motionZ: 0 });
          }
          cave.state = "working"; blocker.state = "chilling";
          blocker.work.phase = ""; blocker.act.kind = "idle"; blocker.act.until = 1e12;
          B.crew.stopBurst(blocker); B.crew.stopReload(blocker, true);
          Object.assign(cave.root.position, { x: start.x, y: cave.baseY + start.y, z: start.z });
          const bx = at.x + fz * offset, bz = at.z - fx * offset;
          const floor = B.headquarters.solids.supportAt(bx, bz, at.y, at.y, blocker);
          Object.assign(blocker.root.position, { x: bx, y: blocker.baseY + floor, z: bz });
          Object.assign(cave.bedTravel, { mode: "walk", route, index: 0, phase: 0, blocked: 0, toBed: false, bed: null });
          BL.scene.updateWorld(scene.root); B.headquarters.solids.props.sync();
          let frames = 0, peakYaw = 0, collisions = 0, gap = Infinity, maximumStep = 0, blockerDrift = 0, lastX = start.x, lastZ = start.z;
          const jumps = cave.avoidance.navigation.jumps;
          while (cave.bedTravel.mode === "walk" && frames++ < Math.ceil(60 / dt)) {
            B.crew.update(dt, time += dt); BL.scene.updateWorld(scene.root); B.headquarters.solids.props.sync();
            const p = cave.root.position, feet = p.y - cave.baseY;
            peakYaw = Math.max(peakYaw, Math.abs(cave.shoulder.yaw));
            maximumStep = Math.max(maximumStep, Math.hypot(p.x - lastX, p.z - lastZ));
            blockerDrift = Math.max(blockerDrift, Math.hypot(blocker.root.position.x - bx, blocker.root.position.z - bz));
            gap = Math.min(gap, Math.hypot(p.x - bx, p.z - bz));
            if (!B.island.clearAt(p.x, feet + 0.3, p.z, 0.295, cave.bodyHeight - 0.3)) collisions++;
            lastX = p.x; lastZ = p.z;
          }
          rows.push({ level, ramp: ramp.id ?? ramp.index, uphill, offset, frames, arrived: cave.bedTravel.mode === "", peakYaw, collisions, gap, maximumStep, blockerDrift,
            jumps: cave.avoidance.navigation.jumps - jumps, distance: Math.hypot(cave.root.position.x - end.x, cave.root.position.z - end.z),
            index: cave.bedTravel.index, count: route.length });
          cave.bedTravel.mode = ""; cave.walk = null;
        }
      }
      // An off-center pass at the upper HQ apron can have clear headroom
      // while its analytic slope support leaves the feet inside the rock.
      let apron = null;
      for (const ramp of B.island.headquarters.ramps) {
        const mouth = B.island.mouths.find((m) => m.id === ramp.id), sr = Math.sin(mouth.ry), cr = Math.cos(mouth.ry);
        for (let along = -3; along <= 1 && !apron; along += 0.05) for (let across = -3.5; across <= 3.5 && !apron; across += 0.05) {
          const x = mouth.x + sr * along + cr * across, z = mouth.z + cr * along - sr * across;
          const feet = B.headquarters.solids.supportAt(x, z, -0.3, -0.3, cave);
          const blockedFeet = !B.island.clearAt(x, feet + 1e-5, z, 0, 0.01);
          const clearTorso = B.island.clearAt(x, feet + 0.3, z, 0.295, cave.bodyHeight - 0.3);
          if (blockedFeet && clearTorso) apron = { x, z, feet, blockedFeet, clearTorso,
            rejected: !B.headquarters.solids.npcWalkable(x, z, x, z, feet, cave.bodyHeight, cave) };
        }
      }
      if (!apron) throw new Error("No embedded-foot upper-apron fixture");
      return { dt, rows, apron };
    } finally { scene.update = update; }
  };
  return { npcPathWalkingProbe, npcCenterlineProbe, npcLowerTurnsProbe, npcStairPassingProbe };
})();
// ---- window-flare.mjs ----
const { windowFlareProbe } = (() => {
  const windowFlareProbe = () => {
    const B = window.__ooga, island = B.island, H = island.headquarters, geometry = island.geometry, failures = [];
    const family = (w) => w.kind === "panorama" ? "panorama" : `${w.basement ? "basement" : "HQ"} ${w.kind}`;
    const families = {};
    for (const w of H.windows) { const name = family(w); families[name] = (families[name] || 0) + 1; }
    let faces = 0, samples = 0, sweeps = 0, sloped = 0;
    for (const face of geometry.faces) {
      if (!face.headquartersWindowReveal) continue;
      if (face.i.length > 7 && failures.length < 12) failures.push({ kind: "Canvas polygon capacity", vertices: face.i.length });
      for (let triangle = 1; triangle < face.i.length - 1; triangle++) {
        faces++;
        const a = face.i[0] * 3, b = face.i[triangle] * 3, c = face.i[triangle + 1] * 3, v = geometry.verts;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const area = Math.hypot(nx, ny, nz);
        if (area < 1e-10) { failures.push({ kind: "degenerate", face: faces }); continue; }
        nx /= area; ny /= area; nz /= area;
        if (Math.abs(ny) > 0.01 && Math.abs(ny) < 0.9999) sloped++;
        if (faces % 11) continue;
        const x = (v[a] + v[b] + v[c]) / 3, y = (v[a + 1] + v[b + 1] + v[c + 1]) / 3, z = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
        // A reveal can meet the last sliver of an outer cliff voxel.
        // Stay close enough to test that face instead of stepping through its entire rock.
        const inward = island.solidAt(x - nx * 1e-5, y - ny * 1e-5, z - nz * 1e-5), outward = island.solidAt(x + nx * 1e-5, y + ny * 1e-5, z + nz * 1e-5);
        samples++;
        if ((!inward || outward) && failures.length < 12) failures.push({ kind: "mesh/rock", x, y, z, inward, outward });
        if (area > 0.005 && faces % 77 === 0) {
          sweeps++;
          if (island.voxelSegmentClearAt(x + nx * 0.06, y + ny * 0.06 - 0.005, z + nz * 0.06, x - nx * 0.04, y - ny * 0.04 - 0.005, z - nz * 0.04, 0.005, 0.01) && failures.length < 12) failures.push({ kind: "swept reveal", x, y, z });
        }
      }
    }
    const aperture = H.windows.find((w) => w.kind === "room" && w.basement && w.roomIndex === 0), f = aperture.flare.frusta[0];
    const sx = Math.sin(f.angle), sz = -Math.cos(f.angle), tx = -sz, tz = sx, middle = (f.start + aperture.flare.edge) / 2;
    const across = aperture.width / 2 + 0.1, x = sx * middle + tx * across, z = sz * middle + tz * across, y = aperture.sill + aperture.height / 2;
    const enlargedAim = { across, oldHalfWidth: aperture.width / 2, widthHere: f.half + f.horizontal * (middle - f.start), clear: island.clearAt(x, y - 0.4, z, 0.3, 0.8) };
    let floorSamples = 0, ceilingSamples = 0, floorError = 0, ceilingError = 0;
    for (let radius = f.start + 0.5; radius < aperture.flare.edge - 0.5; radius += 0.02) {
      const x = sx * radius, z = sz * radius, expectedFloor = aperture.sill - f.vertical * (radius - f.start), expectedCeiling = aperture.sill + aperture.height + f.vertical * (radius - f.start);
      const floor = island.supportAt(x, z, y, 0, -120), ceiling = island.ceilingAt(x, expectedFloor + 0.05, z);
      if (floor > -120) { floorSamples++; floorError = Math.max(floorError, Math.abs(floor - expectedFloor)); }
      if (ceiling < Infinity) { ceilingSamples++; ceilingError = Math.max(ceilingError, Math.abs(ceiling - expectedCeiling)); }
    }
    // Intersect each tapered aperture with concentric shell sections to derive angular bounds from its side planes,
    // independently of the construction's approximate arc-gap budget; panorama sectors included.
    const halfAngle = (f, radius) => Math.min(Math.acos(Math.min(1, f.start / radius)), Math.atan(f.horizontal) + Math.asin((f.half - f.horizontal * f.start) / (radius * Math.hypot(1, f.horizontal))));
    let separationSamples = 0, pairs = 0, neighborGap = Infinity, stackedGap = Infinity;
    for (let i = 0; i < H.windows.length; i++) for (let j = i + 1; j < H.windows.length; j++) {
      const a = H.windows[i], b = H.windows[j];
      let inspected = false;
      for (const af of a.flare.frusta) for (const bf of b.flare.frusta) {
        if (af.inner || bf.inner) continue;
        const angle = Math.abs(Math.atan2(Math.sin(af.angle - bf.angle), Math.cos(af.angle - bf.angle))), start = Math.max(af.start, bf.start), end = Math.min(a.flare.edge, b.flare.edge);
        if (start >= end || angle > Math.PI / 2) continue;
        const steps = Math.ceil((end - start) / 0.05);
        for (let n = 0; n <= steps; n++) {
          const radius = start + (end - start) * n / steps;
          const horizontal = 2 * radius * Math.sin(Math.max(0, angle - halfAngle(af, radius) - halfAngle(bf, radius)) / 2);
          const aLow = a.sill - af.vertical * (radius - af.start), aHigh = a.sill + a.height + af.vertical * (radius - af.start);
          const bLow = b.sill - bf.vertical * (radius - bf.start), bHigh = b.sill + b.height + bf.vertical * (radius - bf.start);
          const vertical = Math.max(0, aLow - bHigh, bLow - aHigh), gap = Math.hypot(horizontal, vertical);
          separationSamples++; inspected = true;
          if (vertical < 1e-6) neighborGap = Math.min(neighborGap, gap);
          else if (horizontal < 1e-6) stackedGap = Math.min(stackedGap, gap);
          if (gap < H.rockCover - 1e-6 && failures.length < 12) failures.push({ kind: "aperture separation", a: i, b: j, radius, gap });
        }
      }
      if (inspected) pairs++;
    }
    // Ray-test the rendered terrain independently of collision, from every room across the inner aperture.
    // Stray retained wall triangles must not hide an opening whose physical air is clear.
    let roomViews = 0, roomViewRays = 0;
    for (const w of H.windows) {
      if (w.kind !== "room") continue;
      const room = (w.basement ? H.basement : H).rooms.find((r) => r.index === w.roomIndex), sx = Math.sin(w.angle), sz = -Math.cos(w.angle);
      roomViews++;
      for (const across of [-w.width / 2 + 0.2, 0, w.width / 2 - 0.2]) for (const height of [0.2, w.height / 2, w.height - 0.2]) for (const exterior of [false, true]) {
        const frame = Math.hypot(w.x, w.z) + 0.05, frameX = sx * frame - sz * across, frameZ = sz * frame + sx * across;
        const fromX = exterior ? frameX : room.x, fromZ = exterior ? frameZ : room.z;
        const x = exterior ? sx * (w.flare.edge + 0.25) - sz * across : frameX, z = exterior ? sz * (w.flare.edge + 0.25) + sx * across : frameZ, y = w.sill + height, dx = x - fromX, dz = z - fromZ;
        roomViewRays++;
        if (!island.voxelSegmentClearAt(fromX, y - 0.025, fromZ, x, y - 0.025, z, 0.025, 0.05) && failures.length < 12) failures.push({ kind: "room window wall", window: w.index, across, height, exterior });
        for (const face of geometry.faces) for (let n = 1; n < face.i.length - 1; n++) {
          const ai = face.i[0] * 3, bi = face.i[n] * 3, ci = face.i[n + 1] * 3, v = geometry.verts;
          if (y < Math.min(v[ai + 1], v[bi + 1], v[ci + 1]) || y > Math.max(v[ai + 1], v[bi + 1], v[ci + 1])) continue;
          const ax = v[ai], ay = v[ai + 1], az = v[ai + 2], ux = v[bi] - ax, uy = v[bi + 1] - ay, uz = v[bi + 2] - az, vx = v[ci] - ax, vy = v[ci + 1] - ay, vz = v[ci + 2] - az;
          const px = -dz * vy, py = dz * vx - dx * vz, pz = dx * vy, determinant = ux * px + uy * py + uz * pz;
          if (Math.abs(determinant) < 1e-9) continue;
          const tx = fromX - ax, ty = y - ay, tz = fromZ - az, u = (tx * px + ty * py + tz * pz) / determinant;
          if (u < 0 || u > 1) continue;
          const qx = ty * uz - tz * uy, qy = tz * ux - tx * uz, qz = tx * uy - ty * ux, vWeight = (dx * qx + dz * qz) / determinant;
          if (vWeight < 0 || u + vWeight > 1) continue;
          const t = (vx * qx + vy * qy + vz * qz) / determinant;
          if (t > 1e-6 && t < 1 - 1e-6 && failures.length < 12) failures.push({ kind: "rendered room window wall", window: w.index, across, height, exterior, x: fromX + dx * t, y, z: fromZ + dz * t });
        }
      }
    }
    const rampFrames = [];
    const clipPolygon = (points, plane) => {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length], da = a[0] * plane[0] + a[1] * plane[1] + a[2] * plane[2] - plane[3], db = b[0] * plane[0] + b[1] * plane[1] + b[2] * plane[2] - plane[3];
        if (da <= 1e-8) out.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const t = da / (da - db);
          out.push(a.map((v, axis) => v + (b[axis] - v) * t));
        }
      }
      return out;
    };
    for (const w of H.windows) {
      if (w.kind !== "ramp") continue;
      const floorFaces = geometry.faces.filter((f) => w.basement ? f.headquartersBasementRamp || f.i.every((i) => Math.abs(geometry.verts[i * 3 + 1] - H.basement.floor) < 1e-8) : f.headquartersRamp);
      const sx = Math.sin(w.angle), sz = -Math.cos(w.angle), radius = Math.hypot(w.x, w.z);
      let clearance = Infinity, missing = 0, throatClearance = Infinity, floorExtent = -Infinity, floorPieces = 0, intersections = 0;
      const throat = w.flare.frusta.find((f) => f.inner), flare = w.flare.frusta.find((f) => !f.inner);
      const throatPlanes = [[-sx, 0, -sz, -radius], [sx, 0, sz, throat.end], [-sz, 0, sx, w.width / 2], [sz, 0, -sx, w.width / 2]];
      for (const f of floorFaces) for (let n = 1; n < f.i.length - 1; n++) {
        const triangle = [f.i[0], f.i[n], f.i[n + 1]].map((i) => Array.from(geometry.verts.slice(i * 3, i * 3 + 3)));
        const [a, b, c] = triangle;
        if ((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]) >= -1e-9) continue;
        let clipped = triangle;
        for (const plane of throatPlanes) clipped = clipPolygon(clipped, plane);
        if (clipped.length >= 3) {
          floorPieces++;
          for (const point of clipped) {
            throatClearance = Math.min(throatClearance, w.sill - point[1]);
            floorExtent = Math.max(floorExtent, point[0] * sx + point[2] * sz);
          }
        }
        // The expanding outer opening must never remove or intersect the visible sloping floor, including side edges.
        clipped = triangle;
        for (const plane of flare.planes) clipped = clipPolygon(clipped, plane);
        if (clipped.length >= 3) {
          let area = 0;
          for (let k = 1; k < clipped.length - 1; k++) area += Math.abs((clipped[k][0] - clipped[0][0]) * (clipped[k + 1][2] - clipped[0][2]) - (clipped[k][2] - clipped[0][2]) * (clipped[k + 1][0] - clipped[0][0]));
          if (area > 1e-8) intersections++;
        }
      }
      for (let sample = 0; sample <= 60; sample++) {
        const across = (sample / 60 - 0.5) * w.width, x = sx * radius - sz * across, z = sz * radius + sx * across;
        let floor = -Infinity;
        for (const f of floorFaces) for (let n = 1; n < f.i.length - 1; n++) {
          const a = f.i[0] * 3, b = f.i[n] * 3, c = f.i[n + 1] * 3, v = geometry.verts;
          if (x < Math.min(v[a], v[b], v[c]) - 1e-8 || x > Math.max(v[a], v[b], v[c]) + 1e-8 || z < Math.min(v[a + 2], v[b + 2], v[c + 2]) - 1e-8 || z > Math.max(v[a + 2], v[b + 2], v[c + 2]) + 1e-8) continue;
          const ux = v[b] - v[a], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vz = v[c + 2] - v[a + 2], determinant = ux * vz - uz * vx;
          if (determinant >= -1e-9) continue;
          const u = ((x - v[a]) * vz - (z - v[a + 2]) * vx) / determinant, q = (ux * (z - v[a + 2]) - uz * (x - v[a])) / determinant;
          if (u >= -1e-7 && q >= -1e-7 && u + q <= 1 + 1e-7) floor = Math.max(floor, v[a + 1] + u * (v[b + 1] - v[a + 1]) + q * (v[c + 1] - v[a + 1]));
        }
        if (!Number.isFinite(floor)) missing++;
        else clearance = Math.min(clearance, w.sill - floor);
      }
      const balcony = w.basement && H.basement.balconies.find((entry) => w.angle > entry.startAngle && w.angle < entry.endAngle);
      const openBalcony = !!balcony && Math.abs(throat.end - radius) < 1e-7;
      let openChecks = 0, openClear = true;
      if (openBalcony) for (const across of [-w.width / 2 + 0.2, 0, w.width / 2 - 0.2]) for (const height of [0.2, w.height / 2, w.height - 0.2]) {
        const y = w.sill + height;
        openChecks++;
        if (!island.voxelSegmentClearAt(sx * radius - sz * across, y - 0.025, sz * radius + sx * across, sx * (balcony.openingRadius + 0.25) - sz * across, y - 0.025, sz * (balcony.openingRadius + 0.25) + sx * across, 0.025, 0.05)) openClear = false;
      }
      rampFrames.push({ openBalcony, openChecks, openClear, window: w.index, basement: !!w.basement, width: w.width, height: w.height, samples: 61, clearance, missing, throatClearance, floorExtent, floorPieces, intersections, marker: radius, frame: throat.end, throatWidth: throat.half * 2, throatHorizontal: throat.horizontal, throatVertical: throat.vertical });
    }
    return { families, windows: H.windows.map((w) => ({ kind: w.kind, basement: !!w.basement, innerWidth: w.width, innerHeight: w.height, outerWidth: w.kind === "panorama" ? w.flare.edge * (w.endAngle - w.startAngle) : w.width + w.flare.horizontal * 2, outerHeight: w.height + w.flare.vertical * 2, horizontal: w.flare.horizontal, vertical: w.flare.vertical, edge: w.flare.edge })), fragments: H.windowFragments, totalFaces: geometry.faces.length, faces, samples, sweeps, sloped, failures, enlargedAim, floorSamples, ceilingSamples, floorError, ceilingError, separationSamples, pairs, neighborGap, stackedGap, rockCover: H.rockCover, roomViews, roomViewRays, rampFrames, unit: island.unit };
  };
  return { windowFlareProbe };
})();
// ---- hq-basement.mjs ----
const { headquartersBasementProbe } = (() => {
  // Inspect actual voxel clearance and support in the second HQ level.
  // Every sample selects its height explicitly, since the upper rooms occupy the same XZ.
  const headquartersBasementProbe = () => {
    const B = window.__ooga, island = B.island, H = island.headquarters, basement = H.basement;
    const failures = [], rooms = [], ramps = [], column = {}, upper = {};
    let commonSamples = 0, rockSamples = 0;
    const fail = (kind, x, y, z, detail = null) => {
      if (failures.length < 12) failures.push({ kind, x, y, z, detail });
    };
    const inspect = (x, z, floor, body = true, rock = false) => {
      const open = island.cavityAt(x, z, column, H.caveIndex, floor + 1.1);
      if (!open || column.caveIndex !== H.caveIndex || Math.abs(column.floor - floor) > 0.08 || column.ceiling < floor + 3.5) fail("floor and comfortable height", x, floor, z, { ...column });
      if (body && !island.clearAt(x, floor + 0.3, z, 0.29, 2.75)) fail("character and camera volume", x, floor, z);
      if (!rock) return;
      for (let y = column.ceiling + 0.02; y < column.ceiling + H.rockCover; y += 0.1) {
        rockSamples++;
        if (!island.solidAt(x, y, z)) fail("solid rock above basement", x, y, z, { ceiling: column.ceiling });
      }
    };
    for (let x = -basement.room.radius + 0.75; x <= basement.room.radius - 0.75; x += 0.5) for (let z = -basement.room.radius + 0.75; z <= basement.room.radius - 0.75; z += 0.5) {
      const radius = Math.hypot(x, z);
      if (radius >= basement.room.radius - 0.75 || radius <= basement.hole.mouthRadius + island.unit) continue;
      inspect(basement.room.x + x, basement.room.z + z, basement.floor, true, true);
      commonSamples++;
    }
    for (const room of basement.rooms) {
      const sx = Math.sin(room.angle), sz = -Math.cos(room.angle);
      let floorSamples = 0, corridorSamples = 0;
      for (let along = -room.depth / 2 + 0.5; along <= room.depth / 2 - 0.5 + 1e-7; along += 0.25) for (let across = -room.width / 2 + 0.5; across <= room.width / 2 - 0.5 + 1e-7; across += 0.25) {
        const x = room.x + sx * along - sz * across, z = room.z + sz * along + sx * across;
        inspect(x, z, room.floor, Math.abs(along) <= room.depth / 2 - 0.75 && Math.abs(across) <= room.width / 2 - 0.75, true);
        floorSamples++;
        for (const other of basement.rooms) {
          if (other === room) continue;
          const dx = x - other.x, dz = z - other.z, acrossOther = dx * Math.cos(other.angle) + dz * Math.sin(other.angle), alongOther = dx * Math.sin(other.angle) - dz * Math.cos(other.angle);
          if (Math.abs(acrossOther) < other.width / 2 && Math.abs(alongOther) < other.depth / 2) fail("neighboring rooms overlap", x, room.floor + 1, z, { room: room.index, other: other.index });
        }
      }
      const length = Math.hypot(room.x - room.approach.x, room.z - room.approach.z), count = Math.ceil(length / 0.2);
      for (let i = 0; i <= count; i++) {
        const x = room.approach.x + (room.x - room.approach.x) * i / count, z = room.approach.z + (room.z - room.approach.z) * i / count;
        inspect(x, z, room.floor, true, true);
        corridorSamples++;
      }
      const walls = [[-room.width / 2 - 0.5, 0], [room.width / 2 + 0.5, 0], [0, room.depth / 2 + 0.5]].map(([across, along]) => island.solidAt(room.x + sx * along - sz * across, room.floor + 0.5, room.z + sz * along + sx * across));
      const aperture = H.windows.find((entry) => entry.kind === "room" && entry.basement && entry.roomIndex === room.index);
      rooms.push({ index: room.index, basement: room.basement, floor: room.floor, ceiling: room.ceiling, radius: room.radius, width: room.width, depth: room.depth, floorSamples, corridorSamples, walls, windowFloor: aperture && aperture.floor, resident: room.resident ?? null });
    }
    for (const ramp of basement.ramps) {
      let maxSlope = 0, maxStep = 0, smoothSamples = 0, samples = 0;
      for (let i = 1; i < ramp.samples.length; i++) {
        const a = ramp.samples[i - 1], b = ramp.samples[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), count = Math.max(1, Math.ceil(length / 0.1));
        maxSlope = Math.max(maxSlope, Math.abs(b.y - a.y) / length);
        maxStep = Math.max(maxStep, Math.abs(b.y - a.y));
        if (b.y > a.y + 1e-7) fail("basement entrance must descend monotonically", b.x, b.y, b.z);
        for (let j = 0; j < count; j++) {
          const k = j / count, x = a.x + dx * k, z = a.z + dz * k, floor = a.y + (b.y - a.y) * k;
          if (Math.abs(floor / island.unit - Math.round(floor / island.unit)) > 0.02) smoothSamples++;
          for (const offset of [0, -0.65, 0.65]) inspect(x + dz / length * offset, z - dx / length * offset, floor, offset === 0);
          samples++;
        }
      }
      const first = ramp.samples[0], last = ramp.samples.at(-1);
      ramps.push({ index: ramp.index, first: first.y, last: last.y, width: ramp.width, startAngle: Math.atan2(first.x, -first.z), endRadius: Math.hypot(last.x - basement.room.x, last.z - basement.room.z), maxSlope, maxStep, smoothSamples, samples });
    }
    // Rasterize every rendered lower floor, including the outermost slope cells.
    // These full-width checks catch unsupported flanks that centerline probes miss.
    const g = island.geometry, cells = new Map(), U = island.unit;
    for (const face of g.faces) {
      const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
      const bx = g.verts[b] - g.verts[a], bz = g.verts[b + 2] - g.verts[a + 2], cx = g.verts[c] - g.verts[a], cz = g.verts[c + 2] - g.verts[a + 2], determinant = bx * cz - bz * cx;
      if (determinant >= 0) continue;
      const xs = face.i.map((i) => g.verts[i * 3]), ys = face.i.map((i) => g.verts[i * 3 + 1]), zs = face.i.map((i) => g.verts[i * 3 + 2]);
      const low = Math.min(...ys), high = Math.max(...ys), ramp = face.headquartersBasementRamp || 0;
      if (!ramp && (high - low > 1e-7 || low < basement.floor - 1e-7 || high >= H.floor - 1e-7)) continue;
      for (let x = Math.min(...xs) + U / 2; x < Math.max(...xs) - 1e-7; x += U) for (let z = Math.min(...zs) + U / 2; z < Math.max(...zs) - 1e-7; z += U) {
        const dx = x - g.verts[a], dz = z - g.verts[a + 2], u = (dx * cz - dz * cx) / determinant, v = (bx * dz - bz * dx) / determinant;
        // Greedy flat floors are rectangular quads; the slope faces are triangles.
        if (face.i.length === 3 && (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7)) continue;
        const floor = ramp ? g.verts[a + 1] + u * (g.verts[b + 1] - g.verts[a + 1]) + v * (g.verts[c + 1] - g.verts[a + 1]) : low;
        if (!island.cavityAt(x, z, column, H.caveIndex, floor + 1.1) || Math.abs(column.floor - floor) > 0.08) {
          if (!ramp) continue;
          fail("rendered basement floor keeps its collision interval", x, floor, z, { ...column });
        }
        const key = Math.floor(x / U) + ":" + Math.floor(z / U), previous = cells.get(key);
        cells.set(key, { x, z, floor, ramp, low: Math.min(low, previous ? previous.low : Infinity) });
      }
    }
    const voxelTop = (x, z, floor) => {
      let y = floor - 0.001;
      while (!island.solidAt(x, y, z) && y > floor - 1) y -= U / 10;
      return island.solidAt(x, y, z) ? Math.ceil(y / U) * U : -Infinity;
    };
    let footingSamples = 0, footingRock = 0, footingAir = 0, stackedCells = 0, renderCells = 0;
    for (const cell of cells.values()) {
      const { x, z, floor, ramp } = cell, top = voxelTop(x, z, cell.low);
      if (ramp) renderCells++;
      for (const depth of [U / 2, U * 1.5, U * 2.5]) {
        footingSamples++;
        // The outermost balcony cells stop at the island's original rounded underside;
        // they retain supporting rock above it and must not grow a new slab below it.
        const bottom = -U - Math.floor(island.undersideDepthAt(Math.hypot(x, z)) / U) * U;
        const y = top - depth, inside = y >= bottom, solid = island.solidAt(x, y, z);
        if (inside) footingRock++; else footingAir++;
        if (!Number.isFinite(top) || solid !== inside) fail("rock footing stops at the natural underside", x, y, z, { floor, ramp, bottom, solid });
      }
      island.cavityAt(x, z, column, H.caveIndex, floor + 1.1);
      island.cavityAt(x, z, upper, H.caveIndex);
      if (upper.floor <= column.floor + 0.5) continue;
      let station = Infinity;
      if (ramp) {
        let distance = Infinity;
        const points = basement.ramps[ramp - 1].samples;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))), d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
          if (d < distance) { distance = d; station = a.s + (b.s - a.s) * t; }
        }
      }
      if (station < 1) continue;
      const base = voxelTop(x, z, upper.floor) - U;
      stackedCells++;
      if (column.ceiling + H.rockCover > base + 1e-7) fail("full rock cover at actual stacked ceiling", x, column.ceiling, z, { ramp, upperFloor: upper.floor, upperRockBase: base });
      for (const depth of [U / 2, U * 1.5, U * 2.5]) if (!island.solidAt(x, column.ceiling + depth, z)) fail("solid separating rock across rendered ramp width", x, column.ceiling + depth, z, { ramp });
    }
    island.cavityAt(basement.room.x, basement.room.z, upper, H.caveIndex, H.floor + 1.1);
    const upperSupport = island.supportAt(basement.room.x, basement.room.z, H.floor + 0.1, 0.2);
    let upperRockBase = Infinity;
    for (const ramp of H.ramps) for (const point of ramp.samples) {
      let y = point.y - 0.001;
      while (!island.solidAt(point.x, y, point.z) && y > point.y - 1) y -= 0.025;
      if (island.solidAt(point.x, y, point.z)) upperRockBase = Math.min(upperRockBase, Math.ceil(y / island.unit) * island.unit - island.unit);
    }
    return { floor: basement.floor, ceiling: basement.ceiling, height: basement.ceiling - basement.floor, radius: basement.room.radius, upperFloor: upper.floor, upperSupport, upperRockBase, requiredCeiling: upperRockBase - H.rockCover, separation: upperSupport - basement.ceiling, rockCover: H.rockCover, unit: island.unit, commonSamples, rockSamples, floorCells: cells.size, renderCells, footingSamples, footingRock, footingAir, stackedCells, rooms, ramps, failures };
  };
  return { headquartersBasementProbe };
})();
// ---- convex.mjs ----
const { convexProbe } = (() => {
  // Analytic boxes exercise the shared convex narrow phase without rendering.
  const convexProbe = () => {
    const collide = window.BL.convex.sweptCylinder, failures = [];
    let seed = 918273, stationary = 0, swept = 0, contacts = 0, rotated = 0, tetrahedra = 0, tilted = 0, ceiling = 0;
    const random = () => { seed = Math.imul(seed ^ seed >>> 15, 2246822519); seed = Math.imul(seed ^ seed >>> 13, 3266489917); return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
    const box = (x, y, z, width, height, depth) => {
      const vertices = new Float64Array(24);
      let i = 0;
      for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) { vertices[i++] = x + a * width; vertices[i++] = y + b * height; vertices[i++] = z + c * depth; }
      return vertices;
    };
    const check = (kind, expected, actual, detail) => { if (expected !== actual && failures.length < 12) failures.push({ kind, expected, actual, ...detail }); };
    for (let i = 0; i < 20000; i++) {
      const x0 = random() * 60 - 30, y0 = random() * 30 - 25, z0 = random() * 60 - 30, w = 0.025 + random() * 0.225, h = 0.025 + random() * 0.225, d = 0.025 + random() * 0.225;
      const x = x0 + random() * 1.2 - 0.6, y = y0 + random() * 2.2 - 1.5, z = z0 + random() * 1.2 - 0.6, radius = i % 13 ? random() * 0.7 : 0, height = i % 17 ? random() * 1.8 : 0;
      const dx = Math.max(x0 - x, 0, x - x0 - w), dz = Math.max(z0 - z, 0, z - z0 - d);
      const horizontal = radius ? dx * dx + dz * dz < radius * radius : x > x0 && x < x0 + w && z > z0 && z < z0 + d;
      const vertical = height ? y < y0 + h && y + height > y0 : y > y0 && y < y0 + h;
      check("stationary box oracle", horizontal && vertical, collide(box(x0, y0, z0, w, h, d), x, y, z, x, y, z, radius, height), { x, y, z, radius, height, x0, y0, z0, w, h, d });
      stationary++;
    }
    const unit = box(-0.5, -0.5, -0.5, 1, 1, 1), thin = box(-0.002, -0.5, -0.5, 0.004, 1, 1);
    const cases = [
      ["side touch", false, 1, -0.25, 0, 0.5, 0.5],
      ["side inside", true, 1 - 1e-5, -0.25, 0, 0.5, 0.5],
      ["top cap touch", false, 0, 0.5, 0, 0.25, 0.5],
      ["bottom cap touch", false, 0, -1, 0, 0.25, 0.5],
      ["corner touch", false, 0.5 + Math.SQRT1_2 * 0.3, -0.25, 0.5 + Math.SQRT1_2 * 0.3, 0.3, 0.5],
      ["corner inside", true, 0.5 + Math.SQRT1_2 * 0.3 - 1e-5, -0.25, 0.5 + Math.SQRT1_2 * 0.3 - 1e-5, 0.3, 0.5],
      ["point inside", true, 0, 0, 0, 0, 0],
      ["point outside", false, 0.6, 0, 0, 0, 0],
      ["point on face", false, 0.5, 0, 0, 0, 0],
      ["point on edge", false, 0.5, 0.5, 0, 0, 0],
      ["point on corner", false, 0.5, 0.5, 0.5, 0, 0],
      ["flat disk on cap", false, 0, 0.5, 0, 0.25, 0],
      ["flat disk inside", true, 0, 0, 0, 0.25, 0],
      ["vertical line inside", true, 0, -1, 0, 0, 1],
      ["vertical line on face", false, 0.5, -1, 0, 0, 1]
    ];
    for (const [kind, expected, x, y, z, radius, height] of cases) {
      check(kind, expected, collide(unit, x, y, z, x, y, z, radius, height)); contacts++;
    }
    for (const [kind, expected, piece, x, y, z, tx, ty, tz, radius, height] of [
      ["thin wall tunneling", true, thin, -2, -0.25, 0, 2, -0.25, 0, 0.15, 0.5],
      ["point tunneling", true, thin, -2, 0, 0, 2, 0, 0, 0, 0],
      ["diagonal swept cap", true, thin, -2, 2, 0, 2, -2, 0, 0.15, 0.5],
      ["swept above", false, thin, -2, 0.50001, 0, 2, 0.50001, 0, 0.15, 0.5],
      ["parallel side tangent", false, unit, -2, -0.25, 0.75, 2, -0.25, 0.75, 0.25, 0.5],
      ["parallel side just inside", true, unit, -2, -0.25, 0.75 - 1e-5, 2, -0.25, 0.75 - 1e-5, 0.25, 0.5],
      ["almost parallel outside", false, unit, -2, -0.25, 0.75001, 2, -0.25, 0.750001, 0.25, 0.5],
      ["almost parallel entry", true, unit, -2, -0.25, 0.75001, 2, -0.25, 0.74999, 0.25, 0.5]
    ]) { check(kind, expected, collide(piece, x, y, z, tx, ty, tz, radius, height)); swept++; }
    // Random straight horizontal sweeps cross the X extent,
    // reducing the oracle to the exact cylinder-vs-box vertical interval and Z distance.
    for (let i = 0; i < 5000; i++) {
      const y = random() * 2 - 1, z = random() * 2 - 1, radius = random() * 0.4, height = random();
      const expected = y < 0.5 && y + height > -0.5 && Math.abs(z) < 0.5 + radius;
      check("swept box oracle", expected, collide(unit, -2, y, z, 2, y, z, radius, height), { y, z, radius, height }); swept++;
    }
    // Y rotations preserve the cylinder, giving an exact independent oracle
    // for oblique rock faces and non-axis-aligned sweeps through thin fragments.
    for (let i = 0; i < 5000; i++) {
      const angle = random() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle), rock = box(-0.1, -0.1, -0.01, 0.2, 0.2, 0.02);
      for (let j = 0; j < rock.length; j += 3) { const x = rock[j], z = rock[j + 2]; rock[j] = x * c - z * s; rock[j + 2] = x * s + z * c; }
      const x = random() - 0.5, y = random() - 0.5, z = random() - 0.5, radius = random() * 0.3, height = random() * 0.5;
      const dx = Math.max(0, Math.abs(x) - 0.1), dz = Math.max(0, Math.abs(z) - 0.01), wx = x * c - z * s, wz = x * s + z * c;
      check("rotated stationary box", y < 0.1 && y + height > -0.1 && dx * dx + dz * dz < radius * radius, collide(rock, wx, y, wz, wx, y, wz, radius, height), { angle, x, y, z, radius, height });
      check("rotated swept box", y < 0.1 && y + height > -0.1 && Math.abs(z) < 0.01 + radius, collide(rock, -c - z * s, y, -s + z * c, c - z * s, y, s + z * c, radius, height), { angle, y, z, radius, height });
      rotated += 2;
    }
    const tetrahedron = new Float64Array([0, 0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25]);
    for (let i = 0; i < 5000; i++) {
      const x = random() * 0.5 - 0.1, y = random() * 0.5 - 0.1, z = random() * 0.5 - 0.1;
      check("tetrahedron point halfspaces", x > 0 && y > 0 && z > 0 && x + y + z < 0.25, collide(tetrahedron, x, y, z, x, y, z, 0, 0), { x, y, z }); tetrahedra++;
    }
    // Unlike a Y rotation, these slabs have inclined floors/ceilings; tangential sides stay beyond the cylinder.
    // Exact oracle: support span along the slab normal, r*hypot(nx,nz) + h/2*abs(ny).
    const gaps = [0, 0.000001, 0.00005, 0.0007, -0.000001, -0.00005, -0.0007];
    for (let i = 0; i < 5000; i++) {
      const angle = random() * Math.PI * 2, azimuth = random() * Math.PI * 2, sine = Math.sin(angle), cosine = Math.cos(angle), ca = Math.cos(azimuth), sa = Math.sin(azimuth);
      const nx = sine * ca, ny = cosine, nz = sine * sa, ux = -sa, uz = ca, vx = cosine * ca, vy = -sine, vz = cosine * sa;
      const rock = new Float64Array(24), radius = 0.05 + random() * 0.5, height = 0.2 + random() * 1.8, gap = gaps[i % gaps.length], sign = i % 2 ? 1 : -1;
      let at = 0;
      for (const n of [-0.125, 0.125]) for (const u of [-4, 4]) for (const v of [-4, 4]) {
        rock[at++] = -13 + nx * n + ux * u + vx * v;
        rock[at++] = -9 + ny * n + vy * v;
        rock[at++] = 18 + nz * n + uz * u + vz * v;
      }
      const distance = sign * (0.125 + radius * Math.hypot(nx, nz) + height / 2 * Math.abs(ny) + gap), x = -13 + nx * distance, y = -9 + ny * distance - height / 2, z = 18 + nz * distance;
      check("tilted slab grazing", gap < 0, collide(rock, x, y, z, x, y, z, radius, height), { angle, azimuth, gap, radius, height });
      check("tilted slab tangent sweep", gap < 0, collide(rock, x - ux, y, z - uz, x + ux, y, z + uz, radius, height), { angle, azimuth, gap, radius, height });
      tilted += 2;
    }
    // This real window-ceiling fragment formerly cycled the simplex for all 96 iterations
    // despite a 0.000697-unit gap above the character's head.
    const fragment = new Float64Array([2.5, -3.4153745779425924, -26.5, 2.5, -3.25, -26.5, 2.75, -3.25, -26.5, 2.75, -3.412715065908091, -26.5, 2.75, -3.4474767912316704, -26.25, 2.75, -3.25, -26.25, 2.5, -3.25, -26.25, 2.5, -3.450136303266171, -26.25]);
    const x = 2.768242993333574, y = -4.946482208881706, z = -26.78966635837148, radius = 0.295, height = 1.5324024474716216;
    for (const offset of [0, -0.001, 0.001]) {
      check("window ceiling grazing", offset > 0, collide(fragment, x, y + offset, z, x, y + offset, z, radius, height), { offset }); ceiling++;
    }
    check("window ceiling crossing sweep", true, collide(fragment, x, y - 0.001, z, x, y + 0.001, z, radius, height)); ceiling++;
    return { stationary, swept, contacts, rotated, tetrahedra, tilted, ceiling, failures };
  };
  return { convexProbe };
})();
// ---- lifehash.mjs ----
const { lifehashProbe } = (() => {
  // Vectors are SHA-256 of the full 32x32 RGB images from Blockchain Commons bc-lifehash C++ rev 0444dbe,
  // Version::version2, module_size=1; they span UTF-8, all 4 palettes, both symmetries, SHA-256 padding edges.
  const lifehashProbe = async () => {
    const vectors = [
      ["", "ca68773e52a9f34f57dab7b5c32e2ef5bee5622c5afb04e2d5c07c7f77d27ae5"],
      ["Hello", "a58bb5ca1f675a286f562e951d6c6d0436ec6d0375dd8b7975944e80932de584"],
      ["LifeHash", "3dba998f97a989e204fe26d63165be340032ef4e168b3e0dbca8900b0d3627b2"],
      ["0", "8720911ff37e66101c206c275bda128fb9ef2464db16c38bc7aeb4ecc8937b5a"],
      ["ðŸº", "f5076a19df9166337f0d9648f07952eda8eed875d691b5c7d19bcbd6149f9bc2"],
      ["room:1,-6,3:sheet", "35f6863e6c8776bc7c8b4983a52e04476844b965d18d4bc2df89940966209242"],
      ["room:1,-6,3:pillow", "6e5dd786707721579bfaccb784118eb453831d23c88b5a34692f3b40ac5cb5f7"],
      ["room:1,-7,3:sheet", "4cc26d33761d419a3a25c4c1eb5380039883d9299bb0bafd783f1549d596e354"],
      ["room:2,-6,3:sheet", "67f7c9972f855c9589591f8a27499a44b3fe694aa84ac2493ac663621ac02701"],
      ["room:1,-6,4:sheet", "646afe514d675a1c7b857f07fba4746e5206fcccfa1bad303e0f9a45ad1fd1a3"],
      ["a".repeat(55), "2739a2d2d7ccc7ae7cf8fd59828baffb3cd268193104c2c0f210a2e0bc4f876f"],
      ["a".repeat(56), "fe4ff5e1548813a9a44617340a4af9b11a137229b46cea07e934a28985f91594"],
      ["a".repeat(64), "cc660d127aecbe9157c51fdbbb4b3ec92a3f108702a3d54a3dd22288be0e4ed2"],
      ["a".repeat(200), "aba63df599e1038bf9ee2397034d342c2b53d7d5287bd10c03e4ad6cf4861be7"]
    ];
    const failures = [], signatures = new Set();
    let referenceMatches = 0, shapeMatches = 0, repeatMatches = 0, constructionMs = 0;
    for (const [seed, expected] of vectors) {
      const start = performance.now(), image = window.BL.lifehash.make(seed);
      constructionMs += performance.now() - start;
      if (image.width === 32 && image.height === 32 && image.colors instanceof Uint8Array && image.colors.length === 3072) shapeMatches++;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", image.colors));
      const actual = Array.from(digest, (v) => v.toString(16).padStart(2, "0")).join("");
      if (actual === expected) referenceMatches++; else failures.push({ seed, expected, actual });
      signatures.add(actual);
      const repeated = window.BL.lifehash.make(seed);
      if (repeated.colors !== image.colors && repeated.colors.every((v, i) => v === image.colors[i])) repeatMatches++;
    }
    return { vectors: vectors.length, referenceMatches, shapeMatches, repeatMatches, unique: signatures.size, constructionMs, failures };
  };
  return { lifehashProbe };
})();
// ---- ramp-outline-sections.mjs ----
const { rampOutlineSectionsProbe } = (() => {
  // Real ramp exits distinguish continuous wall guides from stepped roof faces.
  const rampOutlineSectionsProbe = () => {
    const BL = window.BL, B = window.__ooga, island = B.island, H = island.headquarters, guides = B.headquarters.rockGuides;
    const ramps = guides.contexts.filter((context) => context.kind === "ramp");
    const outdoors = guides.contexts.filter((context) => context.kind === "surface" || context.kind === "front");
    const fronts = outdoors.filter((context) => context.kind === "front"), failures = [];
    const fail = (kind, detail) => { if (failures.length < 12) failures.push({ kind, ...detail }); };
    const column = { floor: 0, ceiling: 0 }, geometry = { ramps: ramps.length, triangles: 0, nonvertical: 0, wrongOwner: 0, ceilingSteps: 0, aboveCeiling: 0, maxCeilingError: 0, exteriorSamples: 0, buriedExterior: 0, coveredExterior: 0 };
    for (const context of ramps) {
      const v = context.surface;
      for (let at = 0; at < v.length; at += 9) {
        const ax = v[at + 3] - v[at], ay = v[at + 4] - v[at + 1], az = v[at + 5] - v[at + 2];
        const bx = v[at + 6] - v[at], by = v[at + 7] - v[at + 1], bz = v[at + 8] - v[at + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const length = Math.hypot(nx, ny, nz);
        if (length < 1e-9) continue;
        geometry.triangles++; nx /= length; ny /= length; nz /= length;
        if (Math.abs(ny) > 1e-5) geometry.nonvertical++;
        const x = (v[at] + v[at + 3] + v[at + 6]) / 3, y = (v[at + 1] + v[at + 4] + v[at + 7]) / 3, z = (v[at + 2] + v[at + 5] + v[at + 8]) / 3;
        const positive = island.rampColumnAt(x + nx * 0.025, z + nz * 0.025, context.basement, column), positiveCeiling = positive ? column.ceiling : Infinity;
        const negative = island.rampColumnAt(x - nx * 0.025, z - nz * 0.025, context.basement, column), negativeCeiling = negative ? column.ceiling : Infinity;
        // A side slab has ramp air on exactly one horizontal side; ceiling risers share the ramp footprint on both,
        // regardless of triangle winding or the floor-clipping fan at the lower edge.
        const expected = context.index + 1, ceiling = positive === expected ? positiveCeiling : negativeCeiling;
        if (positive !== expected && negative !== expected) { geometry.wrongOwner++; fail("ramp owner", { basement: context.basement, index: context.index, x, y, z, positive, negative }); }
        if (positive === expected && negative === expected) { geometry.ceilingSteps++; fail("ceiling step", { basement: context.basement, index: context.index, x, y, z }); }
        const excess = Math.max(v[at + 1], v[at + 4], v[at + 7]) - ceiling;
        geometry.maxCeilingError = Math.max(geometry.maxCeilingError, excess);
        if (excess > 1e-5) { geometry.aboveCeiling++; fail("above ceiling", { basement: context.basement, index: context.index, excess }); }
      }
    }
    for (const context of outdoors) for (let group = 0; group < context.surfaceGroupCount; group++) {
      const at = group * 3, s = context.surfaceSamples, x = s[at], y = s[at + 1], z = s[at + 2];
      geometry.exteriorSamples++;
      if (!island.clearAt(x, y, z)) { geometry.buriedExterior++; fail("buried exterior", { context: context.kind, index: context.index, x, y, z }); }
      if (Number.isFinite(island.ceilingAt(x, y, z))) { geometry.coveredExterior++; fail("covered exterior", { context: context.kind, index: context.index, x, y, z }); }
    }
    // Compare the original wall mesh with the guide mesh:
    // checking phases of registered panels alone cannot detect a panel given the wrong owner.
    const coverage = { samples: 0, missing: 0, wrongOwner: 0, duplicated: 0, fabricated: 0, doorwaySamples: 0, doorwayFilled: 0, sections: 0, longWallSpans: [] };
    const guideBuckets = new Map(), sourcePlanes = new Map(), coveredSections = new Set(), unit = island.unit, source = island.geometry.verts;
    const expectedFrontageAt = (x, z) => {
      // The corridor is the mouth's original 3 m apron plus its later long extension; derive that union
      // independently of the guide's ownership accessor, which once recorded only the extension.
      x = island.sightGrid[1] + (Math.floor((x - island.sightGrid[1]) / unit) + 0.5) * unit;
      z = island.sightGrid[3] + (Math.floor((z - island.sightGrid[3]) / unit) + 0.5) * unit;
      for (let index = 0; index < H.fronts.length; index++) {
        const front = H.fronts[index], ramp = H.ramps[index], dx = x - front.center.x, dz = z - front.center.z;
        const across = dx * front.tangent.x + dz * front.tangent.z, depth = dx * -front.tangent.z + dz * front.tangent.x;
        const padding = unit / 2 * (Math.abs(front.tangent.x) + Math.abs(front.tangent.z));
        const extension = Math.abs(across) < front.halfLength + padding && Math.abs(depth) < front.halfWidth + padding && depth > -1.1;
        const mx = x - ramp.from.x - ramp.axis.x * 0.5, mz = z - ramp.from.z - ramp.axis.z * 0.5;
        const along = mx * ramp.axis.x + mz * ramp.axis.z, mouthAcross = Math.abs(mz * ramp.axis.x - mx * ramp.axis.z);
        const doorwayInset = unit / 2 * (Math.abs(ramp.axis.x) + Math.abs(ramp.axis.z)) - 1e-6;
        const apron = along > -3 && along <= -doorwayInset && mouthAcross < 3.5;
        if (extension || apron) return index + 1;
      }
      return 0;
    };
    const planeKey = (axis, plane) => `${axis}:${Math.round(plane * 1e5)}`;
    const bucketKey = (axis, plane, horizontal) => `${planeKey(axis, plane)}:${Math.floor(horizontal / unit)}`;
    const triangleContains = (entry, horizontal, y) => {
      const v = entry.context.surface, at = entry.at, h = entry.horizontal;
      const x = v[at + h], py = v[at + 1], bx = v[at + 3 + h] - x, by = v[at + 4] - py, cx = v[at + 6 + h] - x, cy = v[at + 7] - py, determinant = bx * cy - by * cx;
      if (Math.abs(determinant) < 1e-9) return false;
      const u = ((horizontal - x) * cy - (y - py) * cx) / determinant, w = (bx * (y - py) - by * (horizontal - x)) / determinant;
      return u >= -1e-5 && w >= -1e-5 && u + w <= 1 + 1e-5;
    };
    for (const context of guides.contexts) for (let at = 0; at < context.surface.length; at += 9) {
      const v = context.surface, axis = Math.abs(v[at] - v[at + 3]) + Math.abs(v[at] - v[at + 6]) < 1e-5 ? 0
        : Math.abs(v[at + 2] - v[at + 5]) + Math.abs(v[at + 2] - v[at + 8]) < 1e-5 ? 2 : -1;
      if (axis < 0) continue;
      const horizontal = axis === 0 ? 2 : 0, low = Math.min(v[at + horizontal], v[at + 3 + horizontal], v[at + 6 + horizontal]), high = Math.max(v[at + horizontal], v[at + 3 + horizontal], v[at + 6 + horizontal]);
      const entry = { context, at, horizontal };
      for (let cell = Math.floor((low + 1e-5) / unit); cell < Math.ceil((high - 1e-5) / unit); cell++) {
        const key = bucketKey(axis, v[at + axis], (cell + 0.5) * unit);
        if (!guideBuckets.has(key)) guideBuckets.set(key, []);
        guideBuckets.get(key).push(entry);
      }
    }
    for (const face of island.geometry.faces) {
      if (face.i.length < 3 || face.headquartersWindowReveal || face.windowIndex !== undefined) continue;
      const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
      const ux = source[b] - source[a], uy = source[b + 1] - source[a + 1], uz = source[b + 2] - source[a + 2], vx = source[c] - source[a], vy = source[c + 1] - source[a + 1], vz = source[c + 2] - source[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-9 || Math.abs(ny) > length * 0.1) continue;
      nx /= length; nz /= length;
      const axis = Math.abs(nx) > 0.9 ? 0 : 2, horizontal = axis === 0 ? 2 : 0, plane = source[a + axis];
      let low = Infinity, high = -Infinity, bottom = Infinity, top = -Infinity;
      for (const index of face.i) { low = Math.min(low, source[index * 3 + horizontal]); high = Math.max(high, source[index * 3 + horizontal]); bottom = Math.min(bottom, source[index * 3 + 1]); top = Math.max(top, source[index * 3 + 1]); }
      const key = planeKey(axis, plane);
      if (!sourcePlanes.has(key)) sourcePlanes.set(key, []);
      sourcePlanes.get(key).push({ low, high, bottom, top });
      for (let cell = Math.floor(low / unit); cell < Math.ceil(high / unit); cell++) {
        const h = (cell + 0.5) * unit, x = axis === 0 ? plane : h, z = axis === 2 ? plane : h;
        const positiveOwner = expectedFrontageAt(x + nx * 0.025, z + nz * 0.025), negativeOwner = expectedFrontageAt(x - nx * 0.025, z - nz * 0.025);
        if ((!positiveOwner && !negativeOwner) || positiveOwner === negativeOwner) continue;
        const candidates = guideBuckets.get(bucketKey(axis, plane, h)) || [];
        for (let row = Math.max(0, Math.floor(bottom / unit)); row < Math.ceil(top / unit); row++) {
          const y = (row + 0.5) * unit;
          const positiveAir = island.clearAt(x + nx * 0.025, y, z + nz * 0.025), negativeAir = island.clearAt(x - nx * 0.025, y, z - nz * 0.025);
          if (positiveAir === negativeAir) continue;
          const owner = positiveAir ? positiveOwner : negativeOwner;
          if (!owner) continue;
          coverage.samples++;
          let correct = false, wrong = false, otherOwner = "";
          for (const entry of candidates) if (triangleContains(entry, h, y)) {
            const context = entry.context;
            if (context.kind === "front" && context.index === owner - 1) { correct = true; coveredSections.add(`${context.index}:${context.surfaceWallGroups[context.surfaceGroups[entry.at / 9]]}`); }
            else { wrong = true; otherOwner = `${context.kind}:${context.basement ? "basement:" : ""}${context.index}`; }
          }
          if (!correct) { if (wrong) coverage.wrongOwner++; else coverage.missing++; fail("frontage coverage", { index: owner - 1, x, y, z, wrong }); }
          if (correct && wrong) { coverage.duplicated++; fail("overlapping frontage", { index: owner - 1, x, y, z, otherOwner }); }
        }
      }
    }
    for (const context of fronts) for (let at = 0; at < context.surface.length; at += 9) {
      const v = context.surface, axis = Math.abs(v[at] - v[at + 3]) + Math.abs(v[at] - v[at + 6]) < 1e-5 ? 0 : 2, horizontal = axis === 0 ? 2 : 0;
      const h = (v[at + horizontal] + v[at + 3 + horizontal] + v[at + 6 + horizontal]) / 3, y = (v[at + 1] + v[at + 4] + v[at + 7]) / 3;
      const originals = sourcePlanes.get(planeKey(axis, v[at + axis])) || [];
      if (!originals.some((face) => h >= face.low - 1e-5 && h <= face.high + 1e-5 && y >= face.bottom - 1e-5 && y <= face.top + 1e-5)) coverage.fabricated++;
    }
    for (const context of fronts) for (let wall = 0; wall < 2; wall++) {
      const front = H.fronts[context.index], v = context.surface;
      let low = Infinity, high = -Infinity;
      for (let at = 0; at < v.length; at += 9) if (context.surfaceWallGroups[context.surfaceGroups[at / 9]] === wall) for (let corner = 0; corner < 9; corner += 3) {
        const across = (v[at + corner] - front.center.x) * front.tangent.x + (v[at + corner + 2] - front.center.z) * front.tangent.z;
        low = Math.min(low, across); high = Math.max(high, across);
      }
      coverage.longWallSpans.push(high - low);
    }
    for (let index = 0; index < H.fronts.length; index++) {
      const front = H.fronts[index], reach = front.halfLength + 2, ox = island.sightGrid[1], oz = island.sightGrid[3];
      for (let gx = Math.floor((front.center.x - reach - ox) / unit); gx <= Math.ceil((front.center.x + reach - ox) / unit); gx++) for (let gz = Math.floor((front.center.z - reach - oz) / unit); gz <= Math.ceil((front.center.z + reach - oz) / unit); gz++) for (const axis of [0, 2]) {
        const x = ox + (gx + (axis === 0 ? 1 : 0.5)) * unit, z = oz + (gz + (axis === 2 ? 1 : 0.5)) * unit, dx = axis === 0 ? 0.025 : 0, dz = axis === 2 ? 0.025 : 0;
        const positive = expectedFrontageAt(x + dx, z + dz), negative = expectedFrontageAt(x - dx, z - dz);
        if ((positive === index + 1) === (negative === index + 1)) continue;
        if (island.rampColumnAt(x + dx, z + dz, false, column) !== index + 1 && island.rampColumnAt(x - dx, z - dz, false, column) !== index + 1) continue;
        const h = axis === 0 ? z : x, candidates = guideBuckets.get(bucketKey(axis, axis === 0 ? x : z, h)) || [];
        for (let row = 0; row < 13; row++) {
          const y = (row + 0.5) * unit;
          if (!island.clearAt(x + dx, y, z + dz) || !island.clearAt(x - dx, y, z - dz)) continue;
          coverage.doorwaySamples++;
          if (candidates.some((entry) => entry.context.kind === "front" && triangleContains(entry, h, y))) coverage.doorwayFilled++;
        }
      }
    }
    coverage.sections = coveredSections.size;
    if (coverage.samples < 100 || coverage.sections !== H.fronts.length * 3 || coverage.longWallSpans.some((span) => span < 6) || !coverage.doorwaySamples || coverage.missing || coverage.wrongOwner || coverage.duplicated || coverage.fabricated || coverage.doorwayFilled) fail("incomplete frontage", coverage);
    const actor = { baseY: 0, root: { position: { x: 0, y: 0, z: 0 } } }, camera = BL.scene.createCamera({ near: 0.1, far: 100 });
    const rows = [], phases = { sections: fronts.reduce((sum, context) => sum + context.walls.length, 0), sampled: 0, selfHidden: 0, unequal: 0, cameraVisible: 0, visibleOutlined: 0, cameraEligibilityError: 0, returnError: 0 };
    const activeSections = new Set();
    const snapshot = () => outdoors.map((context) => new Float32Array(context.surfacePerceived));
    const difference = (before) => {
      let error = 0;
      for (let i = 0; i < outdoors.length; i++) for (let group = 0; group < before[i].length; group++) error = Math.max(error, Math.abs(before[i][group] - outdoors[i].surfacePerceived[group]));
      return error;
    };
    const checkSections = (eye) => {
      for (const context of fronts) for (let group = 0; group < context.surfaceGroupCount; group++) {
        const wallIndex = context.surfaceWallGroups[group], wall = context.walls[wallIndex], at = group * 3, s = context.surfaceSamples;
        if (wall.phase <= 0) continue;
        activeSections.add(`${context.index}:${wallIndex}`); phases.sampled++;
        if (Math.abs(context.surfaceWholePhases[group] - wall.phase * wall.phase * (3 - 2 * wall.phase)) > 1e-6 || context.surfaceSections[group] !== 1) phases.unequal++;
        if (!island.sightClearAt(eye.x, eye.y, eye.z, s[at], s[at + 1], s[at + 2])) phases.selfHidden++;
        if (!context.surfaceHidden[group] && context.surfaceTargets[group] > 0) phases.visibleOutlined++;
      }
    };
    try {
      guides.resetSurface();
      for (let index = 0; index < H.ramps.length; index++) {
        const ramp = H.ramps[index], front = H.fronts[index], frontage = fronts.find((context) => context.index === index), nx = -front.tangent.z, nz = front.tangent.x;
        const path = [6, 4, 2, 0].map((sample) => ({ ...ramp.samples[sample], sample }));
        path.push({ x: front.center.x, y: 0, z: front.center.z, sample: -1 });
        let buried = null;
        for (const offset of [0.5, 1, 1.5, 2]) for (const y of [0.75, 1.5, 2.5]) {
          const point = { x: front.center.x + nx * (front.halfWidth + offset), y, z: front.center.z + nz * (front.halfWidth + offset) };
          if (!buried && island.solidAt(point.x, point.y, point.z)) buried = point;
        }
        if (!buried || !frontage) { fail("entrance fixture", { index, buried: !!buried, frontage: !!frontage }); continue; }
        const row = { index, steps: 0, insideSteps: 0, visibleExitInside: 0, outlinedExitInside: 0, returnSamples: 0, buried: true };
        const saved = [];
        for (let traversal = 0; traversal < 2; traversal++) for (let step = 0; step < path.length; step++) {
          const key = traversal ? path.length - 1 - step : step, point = path[key];
          const floor = island.supportAt(point.x, point.z, point.y, 0.65);
          Object.assign(actor.root.position, { x: point.x, y: floor, z: point.z });
          const eye = { x: point.x, y: floor + 1.1, z: point.z };
          if (!island.clearAt(eye.x, eye.y, eye.z)) fail("route eye", { index, key });
          Object.assign(camera.position, buried); Object.assign(camera.target, eye);
          guides.updateSurfaces(eye.x, eye.y, eye.z, camera, 0.3, actor);
          row.steps++; checkSections(eye);
          if (!traversal) saved[key] = snapshot();
          else { row.returnSamples++; phases.returnError = Math.max(phases.returnError, difference(saved[key])); }
          const inside = point.sample > 0 && island.rampColumnAt(point.x, point.z, false, column) === index + 1;
          if (inside) {
            row.insideSteps++;
            // The far wall across the entrance stays perceptible before the character crosses into the open frontage.
            for (let group = 0; group < frontage.surfaceGroupCount; group++) {
              if (frontage.surfaceWallGroups[group] !== 1) continue;
              const at = group * 3, s = frontage.surfaceSamples;
              if (Math.hypot(s[at] - eye.x, s[at + 1] - floor, s[at + 2] - eye.z) >= 10.5 || !island.sightClearAt(eye.x, eye.y, eye.z, s[at], s[at + 1], s[at + 2])) continue;
              row.visibleExitInside++;
              if (frontage.surfacePerceived[group] > 0 && frontage.surfacePhases[group] > 0) row.outlinedExitInside++;
            }
          }
        }
        const eye = { x: actor.root.position.x, y: actor.root.position.y + 1.1, z: actor.root.position.z }, beforeCamera = snapshot();
        for (const angle of [0, Math.PI / 2, Math.PI]) {
          Object.assign(camera.position, eye);
          Object.assign(camera.target, { x: eye.x + Math.cos(angle), y: eye.y, z: eye.z + Math.sin(angle) });
          guides.updateSurfaces(eye.x, eye.y, eye.z, camera, 0.3, actor);
          phases.cameraEligibilityError = Math.max(phases.cameraEligibilityError, difference(beforeCamera));
          for (const context of outdoors) for (let group = 0; group < context.surfaceGroupCount; group++) {
            if (context.surfacePerceived[group] <= 0) continue;
            const at = group * 3, s = context.surfaceSamples, dx = s[at] - eye.x, dy = s[at + 1] - eye.y, dz = s[at + 2] - eye.z;
            const depth = dx * Math.cos(angle) + dz * Math.sin(angle);
            if (depth <= camera.near || !island.sightClearAt(eye.x + dx * camera.near / depth, eye.y + dy * camera.near / depth, eye.z + dz * camera.near / depth, s[at], s[at + 1], s[at + 2])) continue;
            phases.cameraVisible++;
            if (context.surfaceTargets[group] > 0 || context.surfacePhases[group] > 0) phases.visibleOutlined++;
          }
        }
        if (!row.insideSteps || !row.visibleExitInside || !row.outlinedExitInside) fail("exit wall hidden inside ramp", row);
        rows.push(row);
      }
    } finally { guides.resetSurface(); }
    if (geometry.nonvertical || geometry.wrongOwner || geometry.ceilingSteps || geometry.aboveCeiling || geometry.buriedExterior || geometry.coveredExterior) fail("invalid geometry", {});
    if (phases.unequal || phases.visibleOutlined || phases.returnError > 1e-6 || phases.cameraEligibilityError > 1e-6) fail("unstable section", {});
    return { geometry, coverage, fronts: fronts.length, phases: { ...phases, activeSections: activeSections.size }, rows, failures };
  };
  return { rampOutlineSectionsProbe };
})();
// ---- slope-outline-sections.mjs ----
const { slopeOutlineSectionsProbe } = (() => {
  // Stair faces belong to a hillside side; its crest remains a sight barrier.
  const slopeOutlineSectionsProbe = () => {
    const BL = window.BL, B = window.__ooga, island = B.island, guides = B.headquarters.rockGuides;
    const failures = [], fail = (kind, detail = {}) => { if (failures.length < 12) failures.push({ kind, ...detail }); };
    const synthetic = { risers: 0, treads: 0, joined: 0, excluded: 0, terraceCells: 0, terraceEndsJoined: false, oppositeSides: false, diagonalJoined: false, cacheReused: false };
    const fixture = (surfaceAt) => ({ unit: 0.25, radius: 8, sightGrid: new Float64Array([0.25, -8, -8, -8]), surfaceAt, frontageColumnAt: () => 0 });
    const ridge = fixture((x) => Math.max(0, 4 - Math.ceil(Math.max(0, Math.abs(x) - 1.5) / 0.5) * 0.5));
    const ridgeGuides = BL.slopeGuides.create({ island: ridge }), out = { side: -1, sector: -1, x: 0, z: 0 }, sides = [];
    for (const sign of [-1, 1]) {
      let side = -1;
      for (let step = 0; step < 8; step++) {
        const x = sign * (5 - step * 0.5), height = (step + 1) * 0.5;
        const accepted = ridgeGuides.classify(x, height - 0.25, 0.125, sign, 0, 0, out);
        synthetic.risers++;
        if (!accepted || side >= 0 && side !== out.side) fail("split synthetic riser", { sign, step, accepted, side, actual: out.side });
        else { side = out.side; synthetic.joined++; }
        if (step === 7) continue;
        const tread = ridgeGuides.classify(x - sign * 0.125, height, 0.125, 0, 1, 0, out);
        synthetic.treads++;
        if (!tread || out.side !== side) fail("split synthetic tread", { sign, step, tread, side, actual: out.side });
        else synthetic.joined++;
      }
      sides.push(side);
    }
    synthetic.oppositeSides = sides[0] >= 0 && sides[1] >= 0 && sides[0] !== sides[1];
    if (!synthetic.oppositeSides) fail("ridge sides joined", { sides });
    for (const x of [-1.375, -0.125, 0.125, 1.375]) {
      if (ridgeGuides.classify(x, 4, 0.125, 0, 1, 0, out)) fail("crest outlined", { x });
      else synthetic.excluded++;
    }
    for (const normal of [[0, -1, 0], [-1, 0, 0]]) {
      if (ridgeGuides.classify(-5, 4.5, 0.125, ...normal, out)) fail("ceiling or buried riser outlined", { normal });
      else synthetic.excluded++;
    }
    const shelf = fixture((x) => x < -4 ? 1 : x < -2 ? 2 : x < 2 ? 3 : 4);
    const shelfGuides = BL.slopeGuides.create({ island: shelf });
    if (shelfGuides.classify(0.125, 3, 0.125, 0, 1, 0, out)) fail("broad intermediate platform outlined");
    else synthetic.excluded++;
    // A 1.5 m terrace is one six-cell strip: its endpoint cells are over a metre from the opposite riser
    // but still belong to the same stair.
    const terrace = fixture((x) => x < -2 ? 1 : x < -0.75 ? 2 : x < 0.75 ? 3 : x < 2 ? 4 : 5);
    const terraceGuides = BL.slopeGuides.create({ island: terrace });
    const lowerRiser = terraceGuides.classify(-0.75, 2.5, 0.125, -1, 0, 0, out), terraceSide = out.side;
    const upperRiser = terraceGuides.classify(0.75, 3.5, 0.125, -1, 0, 0, out);
    synthetic.terraceEndsJoined = lowerRiser && upperRiser && out.side === terraceSide;
    if (!synthetic.terraceEndsJoined) fail("terrace risers split", { lowerRiser, upperRiser, expected: terraceSide, actual: out.side });
    for (let cell = 0; cell < 6; cell++) {
      const x = -0.625 + cell * 0.25, accepted = terraceGuides.classify(x, 3, 0.125, 0, 1, 0, out);
      if (!accepted || out.side !== terraceSide) fail("short terrace cell missing or split", { cell, x, accepted, expected: terraceSide, actual: out.side });
      else synthetic.terraceCells++;
    }
    const diagonal = fixture((x, z) => Math.max(0, Math.min(4, Math.floor((x + z + 8) / 0.5) * 0.5)));
    const diagonalGuides = BL.slopeGuides.create({ island: diagonal });
    let diagonalSide = -1, diagonalJoined = true;
    for (let step = 0; step < 4; step++) {
      const height = 2 + step * 0.5;
      for (const p of [[-3 + step * 0.5, height - 0.25, -3.125, -1, 0, 0], [-3.125 + step * 0.5, height - 0.25, -3, 0, 0, -1], [-2.875 + step * 0.5, height, -3.125, 0, 1, 0]]) {
        const accepted = diagonalGuides.classify(...p, out);
        if (!accepted || diagonalSide >= 0 && diagonalSide !== out.side) { diagonalJoined = false; fail("diagonal stair split", { step, p, accepted, expected: diagonalSide, actual: out.side }); }
        else diagonalSide = out.side;
      }
    }
    synthetic.diagonalJoined = diagonalJoined;
    synthetic.cacheReused = BL.slopeGuides.create({ island: ridge }) === ridgeGuides && BL.slopeGuides.create({ island: island }) === BL.slopeGuides.create({ island });
    if (!synthetic.cacheReused) fail("slope cache rebuilt");

    const contexts = guides.contexts.filter((context) => context.kind === "surface");
    const geometry = { sides: contexts.length, triangles: 0, risers: 0, treads: 0, mixedSides: 0, invalid: 0, buried: 0, covered: 0, crestOrPlatform: 0, splitOwner: 0 };
    const ownerIds = new Set(), directions = [];
    for (let sector = 0; sector < 8; sector++) directions.push([Math.cos(sector * Math.PI / 4), Math.sin(sector * Math.PI / 4)]);
    for (const context of contexts) {
      if (!Number.isInteger(context.source.slopeSide) || context.source.sector < 0 || context.source.sector > 7 || context.walls.length !== 1) { geometry.invalid++; fail("slope owner missing", { index: context.index }); }
      if (ownerIds.has(context.source.slopeSide)) geometry.splitOwner++;
      ownerIds.add(context.source.slopeSide);
      let hasRiser = false, hasTread = false;
      for (let group = 0; group < context.surfaceGroupCount; group++) {
        const at = group * 3, c = context.surfaceCenters, s = context.surfaceSamples, x = c[at], y = c[at + 1], z = c[at + 2];
        const dx = s[at] - x, dy = s[at + 1] - y, dz = s[at + 2] - z;
        if (!island.clearAt(s[at], s[at + 1], s[at + 2])) geometry.buried++;
        if (Number.isFinite(island.ceilingAt(s[at], s[at + 1], s[at + 2]))) geometry.covered++;
        if (dy > 0.02) {
          hasTread = true; geometry.treads++;
          if (Math.abs(y - island.surfaceAt(x, z)) > 1e-4) geometry.invalid++;
          // Find the first actual height change in both directions: every point on a short terrace shares the strip
          // width, and its distance to one endpoint can exceed the former search radius.
          let intermediate = false;
          for (const direction of directions) {
            const dx = Math.round(direction[0]), dz = Math.round(direction[1]), stride = Math.hypot(dx, dz) * island.unit;
            let lower = 0, higher = 0, downOpen = true, upOpen = true;
            for (let step = 1; step * stride <= 2 + stride + 1e-4 && ((!lower && downOpen) || (!higher && upOpen)); step++) {
              if (downOpen && !lower) {
                const height = island.surfaceAt(x + dx * step * island.unit, z + dz * step * island.unit);
                if (height > y + 1e-4) downOpen = false;
                else if (height < y - 1e-4) lower = step * stride;
              }
              if (upOpen && !higher) {
                const height = island.surfaceAt(x - dx * step * island.unit, z - dz * step * island.unit);
                if (height < y - 1e-4) upOpen = false;
                else if (height > y + 1e-4) higher = step * stride;
              }
            }
            if (lower && higher && lower + higher - stride <= 2 + 1e-4) { intermediate = true; break; }
          }
          if (!intermediate) { geometry.crestOrPlatform++; fail("real crest or platform outlined", { x, y, z, index: context.index }); }
        } else {
          hasRiser = true; geometry.risers++;
          const lower = island.surfaceAt(s[at], s[at + 2]), higher = island.surfaceAt(x - dx, z - dz);
          if (Math.abs(dy) > 1e-4 || lower >= higher - 1e-4 || y < Math.max(0, lower) - 1e-4 || y > higher + 1e-4) { geometry.invalid++; fail("not an exposed riser", { x, y, z, lower, higher }); }
        }
      }
      if (hasRiser && hasTread) geometry.mixedSides++;
      for (let at = 0; at < context.surface.length; at += 9) {
        geometry.triangles++;
        const v = context.surface, ux = v[at + 3] - v[at], uy = v[at + 4] - v[at + 1], uz = v[at + 5] - v[at + 2], vx = v[at + 6] - v[at], vy = v[at + 7] - v[at + 1], vz = v[at + 8] - v[at + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz);
        if (length <= 1e-8 || Math.abs(ny) > length * 0.1 && Math.abs(ny) < length * 0.9) geometry.invalid++;
      }
    }
    if (!geometry.mixedSides || !geometry.treads || !geometry.risers || geometry.invalid || geometry.buried || geometry.covered || geometry.crestOrPlatform || geometry.splitOwner) fail("invalid real slopes", geometry);

    const actor = { baseY: 0, root: { position: { x: 0, y: 0, z: 0 } } }, camera = BL.scene.createCamera({ near: 0.1, far: 100 });
    const fixtures = [], runtime = { positions: 0, candidates: 0, rays: 0, blockedBelow: 0, revealedAbove: 0, partialFadeIn: 0, partialFadeOut: 0, uniformSamples: 0, selfHiddenSamples: 0, cameraVisible: 0, cameraOutlined: 0, orbitError: 0, returnError: 0, cacheStable: true, buffersStable: true };
    const witness = (context, eye, firstOnly = true) => {
      let seen = -1;
      for (let group = 0; group < context.surfaceGroupCount; group++) {
        const at = group * 3, c = context.surfaceCenters, s = context.surfaceSamples;
        if (Math.hypot(c[at] - eye.x, c[at + 1] - eye.y + 1.1, c[at + 2] - eye.z) > 12) continue;
        runtime.rays++;
        if (island.sightClearAt(eye.x, eye.y, eye.z, s[at], s[at + 1], s[at + 2])) { seen = group; if (firstOnly) break; }
      }
      return seen;
    };
    // Select real opposing faces from the heightfield; no hard-coded seed geometry or assumed eye height
    // decides whether the crest blocks them.
    for (let angleIndex = 0; angleIndex < 24 && fixtures.length < 2; angleIndex++) for (const radius of [22.5, 24.5, 26.5]) {
      if (fixtures.length >= 2) break;
      const angle = angleIndex * Math.PI / 12, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const lower = { x, y: island.surfaceAt(x, z) + 1.1, z };
      if (!island.clearAt(x, lower.y, z) || Number.isFinite(island.ceilingAt(x, lower.y, z))) continue;
      runtime.positions++;
      const nearby = contexts.filter((context) => {
        const b = context.bounds, cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, direction = directions[context.source.sector];
        const dx = Math.max(b[0] - x, 0, x - b[3]), dz = Math.max(b[2] - z, 0, z - b[5]);
        return b[4] > lower.y + 0.25 && dx * dx + dz * dz < 49 && (x - cx) * direction[0] + (z - cz) * direction[1] < -0.75;
      }).sort((a, b) => a.surfaceGroupCount - b.surfaceGroupCount);
      for (const context of nearby.slice(0, 16)) {
        runtime.candidates++;
        const upper = { x, y: context.bounds[4] + 1.5, z };
        if (witness(context, lower) >= 0 || !island.clearAt(x, upper.y, z)) continue;
        const seen = witness(context, upper);
        if (seen < 0 || fixtures.some((row) => row.side === context.source.slopeSide)) continue;
        // Nearby witnesses on the opposite-facing side prove the lower point is beside this hill,
        // not isolated under another level.
        const nearSide = contexts.find((other) => {
          const difference = Math.abs(context.source.sector - other.source.sector), turn = Math.min(difference, 8 - difference), b = other.bounds;
          if (turn < 3 || Math.max(b[0] - x, 0, x - b[3]) ** 2 + Math.max(b[2] - z, 0, z - b[5]) ** 2 > 49) return false;
          return witness(other, lower) >= 0;
        });
        if (!nearSide) continue;
        fixtures.push({ side: context.source.slopeSide, nearSide: nearSide.source.slopeSide, lower, upper, seen, context });
        break;
      }
    }
    const uniform = (context, eye) => {
      const expected = context.walls[0].phase ** 2 * (3 - 2 * context.walls[0].phase);
      for (let group = 0; group < context.surfaceGroupCount; group++) {
        runtime.uniformSamples++;
        if (Math.abs(context.surfaceWholePhases[group] - expected) > 1e-6 || context.surfaceSections[group] !== 1) fail("slope fades split", { side: context.source.slopeSide, group });
        const at = group * 3, s = context.surfaceSamples;
        if (expected > 0 && !island.sightClearAt(eye.x, eye.y, eye.z, s[at], s[at + 1], s[at + 2])) runtime.selfHiddenSamples++;
      }
    };
    try {
      for (const row of fixtures) {
        const context = row.context, wall = context.walls[0], s = context.surfaceSamples, seenAt = row.seen * 3;
        const buffers = [context.surface, context.surfacePhases, context.surfaceWholePhases, context.surfacePerceived, context.surfaceHidden, context.surfaceTerrainSeen];
        const update = (eye, dt) => { Object.assign(actor.root.position, { x: eye.x, y: eye.y - 1.1, z: eye.z }); guides.updateSurface(context, eye.x, eye.y, eye.z, camera, dt, actor); };
        guides.resetSurface();
        Object.assign(camera.position, { x: row.lower.x, y: row.lower.y - 1.35, z: row.lower.z });
        Object.assign(camera.target, { x: s[seenAt], y: s[seenAt + 1], z: s[seenAt + 2] });
        update(row.lower, 0.3);
        if (wall.target === 0 && !context.surfaceWholeActive) runtime.blockedBelow++; else fail("far side through crest", { side: row.side, target: wall.target });
        update(row.upper, 0.025);
        if (wall.phase > 0 && wall.phase < wall.target) runtime.partialFadeIn++; else fail("slope appeared without fade", { side: row.side, phase: wall.phase, target: wall.target });
        uniform(context, row.upper);
        update(row.upper, 0.3);
        if (wall.target > 0 && context.surfaceWholeActive === context.surfaceGroupCount) runtime.revealedAbove++; else fail("far side missing above crest", { side: row.side });
        uniform(context, row.upper);
        const target = wall.target;
        for (const offset of [0, 4, -4]) {
          Object.assign(camera.position, { x: row.upper.x + offset, y: row.upper.y, z: row.upper.z });
          Object.assign(camera.target, { x: s[seenAt], y: s[seenAt + 1], z: s[seenAt + 2] });
          update(row.upper, 0.3);
          runtime.orbitError = Math.max(runtime.orbitError, Math.abs(wall.target - target));
          const p = camera.position, t = camera.target, length = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z), fx = (t.x - p.x) / length, fy = (t.y - p.y) / length, fz = (t.z - p.z) / length;
          for (let group = 0; group < context.surfaceGroupCount; group++) {
            const at = group * 3, dx = s[at] - p.x, dy = s[at + 1] - p.y, dz = s[at + 2] - p.z, depth = dx * fx + dy * fy + dz * fz;
            if (depth <= camera.near || !island.sightClearAt(p.x + dx * camera.near / depth, p.y + dy * camera.near / depth, p.z + dz * camera.near / depth, s[at], s[at + 1], s[at + 2])) continue;
            runtime.cameraVisible++;
            if (context.surfaceTargets[group] > 0 || context.surfacePhases[group] > 0) runtime.cameraOutlined++;
          }
        }
        const version = context.surfaceVersion, rays = guides.stats.surfaceRays;
        for (let frame = 0; frame < 12; frame++) update(row.upper, 0);
        runtime.cacheStable &&= context.surfaceVersion === version && guides.stats.surfaceRays === rays;
        runtime.buffersStable &&= buffers.every((buffer, index) => buffer === [context.surface, context.surfacePhases, context.surfaceWholePhases, context.surfacePerceived, context.surfaceHidden, context.surfaceTerrainSeen][index]);
        update(row.lower, 0.025);
        if (wall.target === 0 && wall.phase > 0 && wall.phase < target) runtime.partialFadeOut++; else fail("slope disappeared without fade", { side: row.side, phase: wall.phase, target: wall.target });
        uniform(context, row.lower);
        update(row.lower, 0.3);
        if (wall.phase || context.surfaceWholeActive) fail("stale far side after descent", { side: row.side });
        update(row.upper, 0.3);
        runtime.returnError = Math.max(runtime.returnError, Math.abs(wall.target - target));
      }
    } finally { guides.resetSurface(); }
    if (!fixtures.length) fail("no real crest fixture", { positions: runtime.positions, candidates: runtime.candidates });
    if (!runtime.cameraVisible || runtime.cameraOutlined || runtime.orbitError > 1e-6 || runtime.returnError > 1e-6 || !runtime.cacheStable || !runtime.buffersStable) fail("unstable slope visibility", runtime);
    return { synthetic, geometry, runtime, fixtures: fixtures.map(({ context, ...row }) => row), failures };
  };
  return { slopeOutlineSectionsProbe };
})();
// ---- outline-performance.mjs ----
const { outlinePerformanceProbe } = (() => {
  // Visibility caches keep exact witnesses without repeating unrelated terrain work.
  const outlinePerformanceProbe = () => {
    const B = window.__ooga, BL = window.BL, island = B.island, guides = B.headquarters.rockGuides;
    const camera = BL.scene.createCamera({ near: 0.1, far: 100 }), actor = { baseY: 0, root: { position: { x: 0, y: 0, z: 0 } } };
    const rows = [], failures = [];
    for (const context of guides.contexts) {
      if (context.kind !== "surface" || context.surfaceGroupCount < 100) continue;
      const s = context.surfaceSamples, c = context.surfaceCenters, wall = context.walls[0];
      const ex = s[0] + (s[0] - c[0]) * 20, ey = s[1] + 0.6, ez = s[2] + (s[2] - c[2]) * 20;
      if (!island.clearAt(ex, ey, ez)) continue;
      Object.assign(actor.root.position, { x: ex, y: ey - 1.1, z: ez });
      Object.assign(camera.position, { x: ex * 1.8, y: ey, z: ez * 1.8 });
      Object.assign(camera.target, { x: ex, y: ey, z: ez });
      guides.resetSurface();
      let blocked = -1, queries = 0;
      const objectClear = (ax, ay, az, x, y, z) => {
        queries++;
        return blocked < 0 || Math.abs(x - s[blocked * 3]) + Math.abs(y - s[blocked * 3 + 1]) + Math.abs(z - s[blocked * 3 + 2]) > 1e-7;
      };
      guides.updateSurface(context, ex, ey, ez, camera, 0.3, actor, objectClear, 1);
      if (!wall.perceived) continue;
      let first = -1, witnesses = 0;
      for (let group = 0; group < context.surfaceGroupCount; group++) {
        const at = group * 3, p = actor.root.position;
        if (Math.hypot(c[at] - p.x, c[at + 1] - p.y, c[at + 2] - p.z) <= 12 && island.sightClearAt(ex, ey, ez, s[at], s[at + 1], s[at + 2])) {
          if (first < 0) first = group;
          witnesses++;
        }
      }
      if (witnesses < 2) continue;
      const lazy = context.surfaceTerrainSeen.filter((value) => value === 2).length;
      const beforeRays = guides.stats.surfaceRays, beforeCertificates = guides.stats.surfaceCertificates, initialQueries = queries;
      blocked = first;
      guides.updateSurface(context, ex, ey, ez, camera, 0.3, actor, objectClear, 2);
      const remaining = context.surfaceTerrainSeen.filter((value) => value === 2).length;
      const row = { groups: context.surfaceGroupCount, witnesses, initialQueries, lazy, remaining, stillPerceived: wall.perceived, retraced: guides.stats.surfaceRays - beforeRays + guides.stats.surfaceCertificates - beforeCertificates };
      // Moving the actor alone does not invalidate a fixed camera's rock rays.
      actor.root.position.y += 0.05;
      guides.updateSurface(context, ex, ey + 0.05, ez, camera, 0.3, actor, objectClear, 3);
      row.actorRetraced = guides.stats.surfaceRays - beforeRays + guides.stats.surfaceCertificates - beforeCertificates;
      const anchor = context.surfaceEye[0];
      for (let step = 1; step <= 4; step++) {
        actor.root.position.x = ex + step * 0.01;
        guides.updateSurface(context, ex + step * 0.01, ey + 0.05, ez, camera, 1 / 120, actor, objectClear, 10 + step);
      }
      // Small moves must accumulate against the last terrain query,
      // even when unrelated moving objects invalidate perception every frame.
      row.accumulatedMotion = Math.abs(context.surfaceEye[0] - anchor) >= 0.025;
      // A previously inactive wall must be evaluated when it becomes visible,
      // even if the camera has not moved at all.
      guides.resetSurface();
      guides.updateSurface(context, ex, ey, ez, camera, 0.3, actor, () => false, 4);
      const inactive = !wall.cameraReady && !wall.target;
      const inactiveRays = guides.stats.surfaceRays + guides.stats.surfaceCertificates;
      guides.updateSurface(context, ex, ey, ez, camera, 0.3, actor, () => true, 5);
      row.newlyActive = inactive && wall.cameraReady && wall.target > 0 && guides.stats.surfaceRays + guides.stats.surfaceCertificates > inactiveRays;
      if (!lazy || remaining >= lazy || !row.stillPerceived || row.retraced || row.actorRetraced || !row.accumulatedMotion || !row.newlyActive) failures.push(row);
      rows.push(row);
      if (rows.length === 3) break;
    }
    guides.resetSurface();
    if (rows.length !== 3) failures.push({ kind: "missing hill fixtures", count: rows.length });
    return { rows, failures };
  };
  return { outlinePerformanceProbe };
})();
// ---- canopy-occlusion.mjs ----
const { canopyCertificateProbe, canopyPileProbe } = (() => {
  // A close canopy must not trigger a surface-by-surface search of a large object;
  // coverage is proved from the actual faces, preserving holes and near clipping.
  const canopyCertificateProbe = () => {
    const BL = window.BL, S = BL.scene, root = S.createNode(), actor = { root: S.createNode() };
    const box = (w, h, d) => BL.models.box({ w, h, d, color: "#ffffff" });
    const target = S.createNode({ geometry: box(8, 8, 2), position: { x: 0, y: 0, z: 24 } });
    const cover = S.createNode({ geometry: box(4, 4, 0.4), position: { x: 0, y: 0, z: 2 } });
    const left = S.createNode({ geometry: box(2, 4, 0.4), position: { x: -1.001, y: 0, z: 2 }, visible: false });
    const right = S.createNode({ geometry: left.geometry, position: { x: 1.001, y: 0, z: 2 }, visible: false });
    S.addChild(root, target, cover, left, right, actor.root);
    const objects = BL.objectGuides.create({ roots: [target, cover, left, right], crew: { cavemen: new Map() }, propsBlockActor: false });
    const camera = S.createCamera({ near: 0.1, far: 100 });
    Object.assign(camera.position, { x: 0, y: 0, z: 0 }); Object.assign(camera.target, target.position);
    let rays = 0;
    const clear = () => { rays++; return true; };
    clear.boxClear = () => true; clear.boxSolid = () => false;
    const rows = [], failures = [];
    const sample = (name, expected, efficient = false) => {
      S.updateWorld(root); objects.collect(actor, 0, 0, 24, camera, 1.6);
      rays = 0;
      const before = objects.stats.cameraCertificates, hidden = objects.concealed(target, actor, clear);
      const row = { name, hidden, rays, certificates: objects.stats.cameraCertificates - before };
      rows.push(row);
      if (hidden !== expected || efficient && (rays > 2 || row.certificates < 1)) failures.push(row);
    };
    try {
      sample("nearby solid canopy covers the full target", true, true);
      camera.position.x = 0.05; sample("small camera pan", true, true);
      camera.position.x = 0;
      cover.visible = false; left.visible = right.visible = true;
      sample("two millimetre opening remains visible", false);
      left.visible = right.visible = false; cover.visible = true;
      cover.position.x = 2; sample("uncovered target edge", false);
      cover.position.x = 0; camera.near = 3;
      sample("canopy clipped behind near plane", false);
      camera.near = 0.1;
      cover.geometry = { ...cover.geometry, clipMinY: 0.1 }; objects.register(cover);
      sample("moving gate cut does not count as coverage", false);
      cover.geometry = box(4, 4, 0.4); objects.register(cover);
      cover.rotation.y = 0.2; Object.assign(cover.scale, { x: 1.1, y: 1.2, z: 0.8 });
      sample("rotated nonuniform canopy", true, true);
      cover.rotation.y = 0; Object.assign(cover.scale, { x: 1, y: 1, z: 1 });
      cover.geometry = box(4, 4, 4); cover.position.z = 0; objects.register(cover);
      sample("camera inside canopy", true, true);
      cover.visible = false; sample("canopy moves away without a stale certificate", false);
    } finally { objects.dispose(); }
    return { rows, failures, disposed: objects.stats.registered === 0 };
  };

  const canopyPileProbe = () => {
    const B = window.__ooga, S = window.BL.scenes.hub, H = B.headquarters;
    const actors = [...B.cavemen.values()], actor = actors.find((c) => c.state === "working") || actors[0];
    const provider = H.objectGuides.getProvider(B.core), update = S.update, clear = B.island.sightClearAt;
    // Three views remain behind the rock rim; raising the first above it sees
    // through decorative canopy and must clear guides without touching the pile.
    const rows = [], failures = [], cases = [[0, 1, -26.08493723861947, 6, 12.811184468393678], [1, 0, 28.044528645827203, 8.9, -1.8912998152277658], [0, -1, 13.15289368298812, 9.4, -25.122891324817388], [0, 1, -26.08493723861947, 8.15, 12.811184468393678]];
    let rays = 0;
    B.pilot.possess(actor); S.update = () => {};
    B.island.sightClearAt = (...args) => { rays++; return clear(...args); };
    try {
      const radius = B.altar.platformRadius + 1.5;
      for (let index = 0; index < cases.length; index++) {
        const point = cases[index], x = point[0] * radius, z = point[1] * radius;
        Object.assign(actor.root.position, { x, y: B.island.surfaceAt(x, z) + actor.baseY, z });
        window.BL.scene.updateWorld(S.root);
        Object.assign(B.camera.target, { x, y: actor.root.position.y + 0.7, z });
        for (const pan of [0, -0.05, 0.05, -0.1, 0.1]) {
          Object.assign(B.camera.position, { x: point[2] + pan, y: point[3], z: point[4] });
          rays = 0;
          const start = performance.now(); S.overlay(0.3);
          const row = { index, pan, ms: performance.now() - start, rays, samples: provider.state.visibilitySamples, instances: provider.state.instances, considered: provider.state.considered, enabled: H.sightGuides.objectsEnabled, outlines: H.sightGuides.objectCount };
          rows.push(row);
          const wrongVisibility = index === 3 ? row.enabled || row.outlines : !row.enabled || !row.outlines;
          if (wrongVisibility || row.samples || row.instances || row.considered || row.rays > 10000) failures.push(row);
        }
      }
    } finally { B.island.sightClearAt = clear; S.update = update; }
    return { rows, failures, fruitInstances: B.shell.instanceCount };
  };
  return { canopyCertificateProbe, canopyPileProbe };
})();
// ---- terrain-sight.mjs ----
const { terrainSightProbe } = (() => {
  // Compare the fast cell traversal with independent point occupancy, exact voxel/window sweeps,
  // and known crossings of the actual rendered surfaces.
  const terrainSightProbe = () => {
    const BL = window.BL, island = window.__ooga.island, geometry = island.geometry, random = BL.math.mulberry32(414);
    const counts = { voxel: 0, window: 0, main: 0, basement: 0 }, rays = [], failures = [];
    const reference = (a, b, spacing = 0.02) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / spacing));
      let px = a[0], py = a[1], pz = a[2];
      if (island.rockMaterialAt(px, py, pz)) return false;
      for (let n = 1; n <= steps; n++) {
        const t = n / steps, x = a[0] + dx * t, y = a[1] + dy * t, z = a[2] + dz * t;
        if (island.rockMaterialAt(x, y, z) || !island.voxelSegmentClearAt(px, py, pz, x, y, z, 0, 0)) return false;
        px = x; py = y; pz = z;
      }
      return true;
    };
    for (const face of geometry.faces) {
      const kind = face.headquartersWindowReveal ? "window" : face.headquartersRamp ? "main" : face.headquartersBasementRamp ? "basement" : "voxel";
      if (counts[kind] >= 120) continue;
      const v = geometry.verts, a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-9) continue;
      nx /= length; ny /= length; nz /= length;
      let x = 0, y = 0, z = 0;
      for (const i of face.i) { x += v[i * 3]; y += v[i * 3 + 1]; z += v[i * 3 + 2]; }
      x /= face.i.length; y /= face.i.length; z /= face.i.length;
      const front = [x + nx * 0.04, y + ny * 0.04, z + nz * 0.04], away = [x + nx * 0.08, y + ny * 0.08, z + nz * 0.08];
      if (island.rockMaterialAt(...front) || island.rockMaterialAt(...away)) continue;
      counts[kind]++;
      rays.push({ kind, a: front, b: [x - nx * 0.04, y - ny * 0.04, z - nz * 0.04], expected: false }, { kind, a: front, b: away, expected: true });
    }
    const rooms = [...island.headquarters.rooms, ...island.headquarters.basement.rooms];
    for (let n = 0; n < 400; n++) {
      const room = rooms[n % rooms.length], a = [room.x + (random() - 0.5) * 2, room.floor + 0.6 + random() * 2.5, room.z + (random() - 0.5) * 2];
      const angle = random() * Math.PI * 2, distance = random() * 35, b = [a[0] + Math.cos(angle) * distance, a[1] + (random() - 0.5) * distance, a[2] + Math.sin(angle) * distance];
      if (!island.rockMaterialAt(...a)) rays.push({ kind: "room", a, b });
    }
    for (const opening of island.headquarters.windows) for (let n = 0; n < 8; n++) {
      const distance = 3 + random() * 12, sx = Math.sin(opening.angle), sz = -Math.cos(opening.angle);
      const a = [opening.x - sx * distance, opening.y + (random() - 0.5) * 2, opening.z - sz * distance], b = [opening.x + sx * distance, opening.y + (random() - 0.5) * 2, opening.z + sz * distance];
      if (!island.rockMaterialAt(...a)) rays.push({ kind: "window passage", a, b });
    }
    let certifiedRays = 0;
    for (const ray of rays) {
      const actual = island.sightClearAt(...ray.a, ...ray.b), reverse = island.sightClearAt(...ray.b, ...ray.a);
      let expected = ray.expected ?? reference(ray.a, ray.b);
      if (actual !== expected && ray.expected === undefined) expected = reference(ray.a, ray.b, 0.0025);
      if ((actual !== expected || actual !== reverse) && failures.length < 8) failures.push({ ...ray, actual, reverse, expected });
      const emptyBox = island.sightBoxClearAt(Math.min(ray.a[0], ray.b[0]), Math.min(ray.a[1], ray.b[1]), Math.min(ray.a[2], ray.b[2]), Math.max(ray.a[0], ray.b[0]), Math.max(ray.a[1], ray.b[1]), Math.max(ray.a[2], ray.b[2]));
      if (emptyBox) certifiedRays++;
      if (emptyBox && !expected && failures.length < 8) failures.push({ kind: "unsafe box certificate", ...ray });
    }
    let clearBoxes = 0, boxRays = 0, boxPoints = 0;
    for (let n = 0; n < 600; n++) {
      const room = rooms[n % rooms.length], x = n % 3 ? room.x + (random() - 0.5) * 6 : (random() - 0.5) * 100;
      const y = n % 3 ? room.floor + 0.5 + random() * 4 : -40 + random() * 80, z = n % 3 ? room.z + (random() - 0.5) * 6 : (random() - 0.5) * 100;
      const radius = 0.03 + random() * 0.7;
      if (!island.sightBoxClearAt(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius)) continue;
      clearBoxes++;
      for (let i = 0; i < 27; i++) {
        const px = x + (i % 3 - 1) * radius, py = y + (Math.floor(i / 3) % 3 - 1) * radius, pz = z + (Math.floor(i / 9) - 1) * radius;
        boxPoints++;
        if (island.rockMaterialAt(px, py, pz) && failures.length < 8) failures.push({ kind: "occupied certified box", point: [px, py, pz] });
      }
      for (let i = 0; i < 8; i++) {
        const a = [x + (random() * 2 - 1) * radius, y + (random() * 2 - 1) * radius, z + (random() * 2 - 1) * radius];
        const b = [x + (random() * 2 - 1) * radius, y + (random() * 2 - 1) * radius, z + (random() * 2 - 1) * radius];
        boxRays++;
        if ((!island.sightClearAt(...a, ...b) || !reference(a, b)) && failures.length < 8) failures.push({ kind: "blocked certified box", a, b });
      }
    }
    let solidBoxes = 0, solidPoints = 0;
    for (let n = 0; n < 1000; n++) {
      const x = (random() - 0.5) * 62, y = -28 + random() * 38, z = (random() - 0.5) * 62, radius = random() * 0.4;
      if (!island.sightBoxSolidAt(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius)) continue;
      solidBoxes++;
      for (let i = 0; i < 27; i++) {
        const px = x + (i % 3 - 1) * radius, py = y + (Math.floor(i / 3) % 3 - 1) * radius, pz = z + (Math.floor(i / 9) - 1) * radius;
        solidPoints++;
        if ((!island.rockMaterialAt(px, py, pz) || island.sightClearAt(x, y, z, px, py, pz)) && failures.length < 8) failures.push({ kind: "empty certified solid box", point: [px, py, pz] });
      }
    }
    // Use the rendered reveal polygons, not the certificate's cached planes. Each pair has a box inside the
    // stone and one 2 mm through that visible surface; a clear-air witness makes the latter unsafe.
    const fragmentWindows = new Array(island.headquarters.windows.length).fill(0);
    let fragmentBoxes = 0, fragmentAirBoxes = 0, fragmentPoints = 0;
    for (const face of geometry.faces) {
      if (!face.headquartersWindowReveal || fragmentWindows[face.windowIndex] >= 3) continue;
      const v = geometry.verts, a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
      const u = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], w = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
      const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], length = Math.hypot(...normal);
      if (length < 1e-9) continue;
      for (let axis = 0; axis < 3; axis++) normal[axis] /= length;
      const surface = [0, 0, 0];
      for (const i of face.i) for (let axis = 0; axis < 3; axis++) surface[axis] += v[i * 3 + axis] / face.i.length;
      const center = surface.map((x, axis) => x - normal[axis] * 0.006), air = surface.map((x, axis) => x + normal[axis] * 0.002);
      const away = surface.map((x, axis) => x + normal[axis] * 0.004), radius = 0.001;
      if (island.rockMaterialAt(...air) || !island.clearAt(...air, 0, 0) || !reference(air, away, 0.00025)) continue;
      const points = [];
      for (let i = 0; i < 27; i++) points.push([center[0] + (i % 3 - 1) * radius, center[1] + (Math.floor(i / 3) % 3 - 1) * radius, center[2] + (Math.floor(i / 9) - 1) * radius]);
      if (points.some((p) => !island.rockMaterialAt(...p) || island.clearAt(...p, 0, 0))) continue;
      // GJK against the actual convex mesh proves a fragment contains the corners, hence the whole box,
      // without reading its sight planes.
      const pieces = island.windowPiecesAt(center[0], center[2]) || [];
      if (!pieces.some((piece) => points.every((p) => BL.convex.sweptCylinder(piece.vertices, ...p, ...p, 0, 0)))) continue;
      fragmentWindows[face.windowIndex]++;
      fragmentBoxes++;
      fragmentPoints += points.length;
      const inside = island.sightBoxSolidAt(...center.map((x) => x - radius), ...center.map((x) => x + radius));
      if (!inside && failures.length < 8) failures.push({ kind: "uncertified solid window fragment", window: face.windowIndex, center, radius });
      const min = center.map((x, axis) => Math.min(x - radius, air[axis] - 0.0001)), max = center.map((x, axis) => Math.max(x + radius, air[axis] + 0.0001));
      fragmentAirBoxes++;
      if ((island.sightBoxSolidAt(...min, ...max) || reference(center, air, 0.00025)) && failures.length < 8) failures.push({ kind: "window certificate hides a 2 mm air opening", window: face.windowIndex, min, max, air });
    }
    // This seam lies on a shared convex-fragment plane; both sides are solid,
    // so a zero-radius touch must not create an infinitesimal see-through seam.
    const seam = [-28.81, -1.625, 4.75], seamCovered = !!island.rockMaterialAt(...seam)
      && !!island.rockMaterialAt(seam[0], seam[1], seam[2] - 1e-6) && !!island.rockMaterialAt(seam[0], seam[1], seam[2] + 1e-6)
      && !island.sightClearAt(-28.79, -1.625, 4.75, -28.83, -1.625, 4.75);
    const floor = island.headquarters.basement.floor, outside = island.sightClearAt(80, 2, 80, 80, 5, 80), throughIsland = !island.sightClearAt(0, 20, 0, 0, -50, 0), shaft = island.sightClearAt(0, floor - 0.1, 0, 0, -50, 0);
    return { counts, rays: rays.length, certifiedRays, clearBoxes, boxRays, boxPoints, solidBoxes, solidPoints, fragmentWindows, fragmentBoxes, fragmentAirBoxes, fragmentPoints, failures, seamCovered, outside, throughIsland, shaft };
  };
  return { terrainSightProbe };
})();

// ---- auto-quality.mjs ----
const { autoQualityProbe } = (() => {

  // Exercise the director's real controller with deterministic frame timings;
  // a fast test machine cannot reliably reproduce sustained GPU pressure.
  const autoQualityProbe = () => {
    const source = readFileSync(new URL("../src/js/director.js", import.meta.url), "utf8");
    const controller = source.slice(source.indexOf("  const perf ="), source.indexOf("  const WARMUP"));
    const create = (quality = "high", renderedFrames = 100) => {
      const changes = [], state = { focused: true, now: 0 };
      const renderer = { kind: "webgl2", quality, setQuality(value) { this.quality = value; changes.push(value); } };
      const context = { renderer, document: { hasFocus: () => state.focused }, transition: null, renderedFrames, showQuality() {} };
      const tier = runInNewContext(`${controller}\n({ autoTier, tierFromBoot, BOOT_MEDIUM, BOOT_LOW })`, context);
      // The governor reads delivered intervals only, so a frame costs the probe nothing but the interval it took.
      const frames = (count, interval = 1000 / 60) => { for (let n = 0; n < count; n++) tier.autoTier(interval, state.now += interval); };
      return { changes, state, renderer, context, frames, boot: tier.tierFromBoot, medium: tier.BOOT_MEDIUM, low: tier.BOOT_LOW };
    };
    const healthy = create(); healthy.frames(1200);
    // A GPU-bound machine issues cheap frames and delivers slow ones: the old governor could not see it at all.
    const bound = create(); bound.frames(1200); bound.frames(240, 30);
    // 8 fps has to cost a tier in about two seconds, not the fifteen that 120 frames took.
    const slow = create(); const slowAt = (() => { for (let n = 0; n < 200; n++) { slow.frames(1, 125); if (slow.changes.length) return slow.state.now; } return Infinity; })();
    // One dropped frame is another program, not this one; the step lasts the session, so a second window must agree.
    const spike = create();
    for (let n = 0; n < 10; n++) { spike.frames(119); spike.frames(1, 60); }
    const bounded = create(); bounded.frames(1200); bounded.frames(2400, 40);
    const warming = create("high", 5); warming.frames(240, 40);
    const excluded = create(); excluded.frames(600);
    excluded.state.focused = false; excluded.frames(600, 40);
    excluded.state.focused = true; excluded.context.transition = {}; excluded.frames(600, 40);
    const fallback = create(); fallback.renderer.kind = "canvas2d"; fallback.frames(600, 40);
    // Boot cost is the only device signal Safari cannot mask, and it is read once, before any frame exists. The
    // boots sit inside the director's own bands, so recalibrating its thresholds never strands this check.
    const fast = create(); fast.boot(fast.medium * 0.5);
    const middling = create(); middling.boot((middling.medium + middling.low) / 2);
    const crawling = create(); crawling.boot(crawling.low * 1.2);
    const floor = create("low"); floor.boot(floor.low * 2); floor.boot(floor.medium * 0.3);
    const phone = create("medium"); phone.boot((phone.medium + phone.low) / 2);
    return { healthy: healthy.changes.length === 0, gpuBound: bound.changes[0] === "medium",
      reactsIn: slowAt, reactsFast: slowAt <= 2500, ignoresSpikes: spike.changes.length === 0,
      bounded: bounded.changes.join("|") === "medium|low", warmup: warming.changes.length === 0,
      ignoresPauses: excluded.changes.length === 0, fallback: fallback.changes.length === 0,
      bootFast: fast.changes.length === 0, bootMedium: middling.changes.join("|") === "medium",
      bootLow: crawling.changes.join("|") === "low", bootOneWay: floor.changes.length === 0,
      bootKeepsCoarse: phone.changes.length === 0 };
  };
  return { autoQualityProbe };
})();

// ---- contributor-activity.mjs ----
const { contributorActivityProbe } = (() => {
  // Pass a private module instance for unit checks; no scene or clock mutation needed.
  const contributorActivityProbe = (contributors, at) => {
    const HOUR = 3600000, { roster, stateFor, ageLabel, applyActivity, applySnapshot, hasRecentActivity, subscribe } = contributors;
    const saved = roster.map((entry) => ({ at: entry.lastCommitAt, activity: [...entry.activity] }));
    const state = (age) => stateFor({ lastCommitAt: at - age }, at);
    const boundaries = state(0) === "working" && state(HOUR - 1) === "working" && state(HOUR) === "chilling" &&
      state(24 * HOUR - 1) === "chilling" && state(24 * HOUR) === "sleeping" && state(8 * 24 * HOUR) === "sleeping";
    const invalidStates = [NaN, Infinity, 0, -1, at + 1].every((lastCommitAt) => stateFor({ lastCommitAt }, at) === "sleeping");
    const labels = ageLabel({ lastCommitAt: at }, at) === "0m ago" &&
      ageLabel({ lastCommitAt: at - HOUR / 2 }, at) === "30m ago" &&
      ageLabel({ lastCommitAt: at - HOUR + 1 }, at) === "59m ago" &&
      ageLabel({ lastCommitAt: at - 3 * HOUR }, at) === "3h ago" && ageLabel({ lastCommitAt: at - 49 * HOUR }, at) === "2d ago";
    let notifications = 0;
    const unsubscribe = subscribe(() => { notifications++; });
    try {
      const first = roster[0], second = roster[1], firstAt = at - 15 * 60000, secondAt = at - 8 * HOUR;
      const accepted = applyActivity([
        { name: first.name.toUpperCase(), lastCommitAt: firstAt - 1 },
        { name: first.name, lastCommitAt: firstAt },
        { name: second.name, lastCommitAt: secondAt }
      ], at);
      const update = accepted === 2 && notifications === 1 && stateFor(first, at) === "working" && stateFor(second, at) === "chilling";
      const invalid = applyActivity([
        null, { name: first.name, lastCommitAt: "today" }, { name: first.name, lastCommitAt: Infinity },
        { name: first.name, lastCommitAt: at + 1 }, { name: first.name, lastCommitAt: 0 },
        { name: first.name, lastCommitAt: firstAt }, { name: first.name, lastCommitAt: firstAt - 1 },
        { name: "unknown-contributor", lastCommitAt: at }, { lastCommitAt: at }
      ], at) === 0 && applyActivity(null, at) === 0 && applyActivity([], NaN) === 0 &&
        first.lastCommitAt === firstAt && notifications === 1;
      const expires = stateFor(first, firstAt + HOUR) === "chilling" && stateFor(first, firstAt + 24 * HOUR) === "sleeping"
        && hasRecentActivity(first, "oogaboogax/entropylab", firstAt + HOUR - 1)
        && !hasRecentActivity(first, "oogaboogax/entropylab", firstAt + HOUR);
      const snapshot = (repo, login, age) => ({ meta: { repo, schema_version: 1, generated_at: new Date(at).toISOString() },
        contributors: [{ login, last_seen_at: new Date(at - age).toISOString() }] });
      const alias = roster.find((entry) => entry.name === "bc1gui");
      const snapshotUpdates = applySnapshot([
        snapshot("OogaBoogaX/entropyLab", "ottoz0r", HOUR / 2),
        snapshot("OogaBoogaX/another-project", second.name, HOUR / 4)
      ], at);
      const projects = snapshotUpdates === 2 && hasRecentActivity(alias, "oogaboogax/entropylab", at) &&
        hasRecentActivity(second, "oogaboogax/another-project", at) && !hasRecentActivity(second, "oogaboogax/entropylab", at) &&
        stateFor(second, at) === "working" && !hasRecentActivity(second, "oogaboogax/another-project", at + 4 * HOUR);
      const otherRepo = applySnapshot(snapshot("another-org/entropylab", first.name, 0), at) === 0;
      const orgSnapshot = (org, login, age) => ({ meta: { org, schema_version: 2, generated_at: new Date(at).toISOString() },
        contributors: [{ login, last_seen_at: new Date(at - age).toISOString() }] });
      const orgV3 = { meta: { org: "OogaBoogaX", schema_version: 3, generated_at: new Date(at).toISOString() },
        contributors: [{ login: second.name, last_seen_at: new Date(at - 90000).toISOString() }] };
      const orgWideV3 = applySnapshot(orgV3, at) === 1 && second.lastCommitAt === at - 90000;
      const fanned = { meta: { org: "OogaBoogaX", schema_version: 3, generated_at: new Date(at).toISOString() },
        contributors: [{ login: second.name, last_seen_at: new Date(at - 30000).toISOString() }],
        repos: [{ name: "oogaboogaland", contributors: [{ login: second.name, last_seen_at: new Date(at - 30000).toISOString() }] }] };
      const fanOut = applySnapshot(fanned, at) === 1 && second.activity.get("oogaboogax/oogaboogaland") === at - 30000 &&
        hasRecentActivity(second, "oogaboogax/oogaboogaland", at) && second.activity.get("oogaboogax/entropylab") !== at - 30000;
      const orgWide = applySnapshot(orgSnapshot("OogaBoogaX", second.name, 60000), at) === 1 &&
        second.activity.get("oogaboogax/entropylab") === at - 60000 && second.lastCommitAt === at - 30000 &&
        hasRecentActivity(second, "oogaboogax/entropylab", at) && stateFor(second, at) === "working";
      const wrongOrg = applySnapshot(orgSnapshot("SomeoneElse", second.name, 0), at) === 0;
      const absentTime = snapshot("OogaBoogaX/entropylab", first.name, 0);
      delete absentTime.contributors[0].last_seen_at;
      const noSyntheticActivity = applySnapshot(absentTime, at) === 0 && first.lastCommitAt === firstAt;
      absentTime.contributors[0].last_seen_at = new Date(at).toUTCString();
      const strictTimestamp = applySnapshot(absentTime, at) === 0;
      const lastNotification = notifications;
      unsubscribe();
      const unsubscribed = applyActivity([{ name: first.name, lastCommitAt: at }], at) === 1 && notifications === lastNotification;
      contributors.seedDebugActivity(at);
      // A character pinned to its own repository keeps working on it whatever the
      // dates say, so the debug fixture cannot put that one to sleep either.
      const pinned = roster.find((entry) => entry.maintainer);
      const pinnedWorks = !pinned || stateFor(pinned, at) === "working" && ageLabel(pinned, at) === "building"
        && ["oogaboogax/entropylab", "oogaboogax/oogaboogaland"].every((repo) => hasRecentActivity(pinned, repo, at));
      const debugFixture = roster.every((entry, i) => stateFor(entry, at) === (entry.maintainer || i < 3 ? "working" : i < 6 ? "chilling" : "sleeping") &&
        entry.activity.size === 1 && hasRecentActivity(entry, "oogaboogax/entropylab", at) === (!!entry.maintainer || i < 3));
      applyActivity(Array.from({ length: 70 }, (_, i) => ({ name: first.name, repo: `OogaBoogaX/project-${i}`, lastCommitAt: at })), at);
      const boundedProjects = first.activity.size === 64 && hasRecentActivity(first, "oogaboogax/project-62", at) &&
        !hasRecentActivity(first, "oogaboogax/project-63", at);
      return { boundaries, invalidStates, labels, update, invalid, expires, projects, otherRepo, orgWideV3, fanOut, orgWide, wrongOrg, noSyntheticActivity, strictTimestamp,
        unsubscribed, debugFixture, pinnedWorks, boundedProjects, rosterUnchanged: roster.length === saved.length };
    } finally {
      unsubscribe();
      roster.forEach((entry, i) => {
        entry.lastCommitAt = saved[i].at;
        entry.activity.clear();
        for (const [repo, stamp] of saved[i].activity) entry.activity.set(repo, stamp);
      });
    }
  };
  return { contributorActivityProbe };
})();

// ---- npc-lanes.mjs ----
const { npcLaneSpacingProbe, npcLaneCornerProbe, npcLaneCurveProbe, npcLabLaneProbe, npcRingJunctionProbe } = (() => {
  // Real crew walkers share a simple trail, isolating lane choice and following
  // distance from scenery, spawn timing, and the cave's firing formation.
  const npcLaneSpacingProbe = ({ dt = 1 / 60 } = {}) => {
    const BL = window.BL, S = BL.scene, root = S.createNode(), targets = new Set(), noop = () => {};
    const island = { path: { version: 0, debug: { active: false, ringCenterRadius: 0 }, centerlines: [[{ x: 0, z: -10 }, { x: 0, z: 10 }]] },
      surfaceAt: () => 0, isPath: (x, z) => Math.abs(x) < 1 && Math.abs(z) <= 10 };
    const npcPaths = BL.npcPaths.create({ island, walkable: () => true });
    const crew = BL.crew.create({ root, world: { level: 0 }, npcPaths,
      input: { add: (node) => targets.add(node), remove: (node) => targets.delete(node) }, hud: { setRosterRow: noop },
      game: { state: { assignments: {}, inventory: [] } }, pile: { footprintEdge: 1, pileEdge: () => 1 },
      viewYaw: 0, buildSpots: [], walkIn: { x: 0, z: 3 }, groundAt: () => 0, walkable: () => true,
      bedrolls: BL.contributors.roster.map((entry, i) => ({ x: 30 + i * 2, y: 0, z: 30, hidden: true })),
      fx: { say: noop, zzzAt: noop, burst: noop, puff: noop, spawnParticle: noop, damageNumber: noop }
    });
    const actors = [...crew.cavemen.values()], a = actors[0], b = actors[1], rows = [];
    let time = 0, result;
    const place = (cave, x, z, tx, tz) => {
      cave.state = "working"; cave.root.visible = true; cave.root.quaternion = null;
      Object.assign(cave.root.position, { x, y: cave.baseY, z });
      cave.walk = { tx, tz, speed: 1.7, phase: 0, heading: Math.atan2(tx - x, tz - z), to: "spot" };
      cave.act.kind = "wander"; Object.assign(cave.act.spot, { x: tx, z: tz, ry: 0 });
      cave.act.until = cave.nextBuildAt = cave.yawnAt = 1e12;
      cave.hop = cave.hopV = 0; cave.bedTravel.mode = ""; cave.pathing.tx = NaN;
      cave.avoidance.tx = NaN; cave.avoidance.navigation.mode = 0;
      Object.assign(cave.traffic, { moving: false, waiting: false, leader: null });
      Object.assign(cave.shoulder, { phase: 0, other: null, yaw: 0, targetYaw: 0, motionX: 0, motionZ: 0 });
    };
    try {
      for (const cave of actors) { cave.root.visible = false; cave.state = "away"; cave.bedTravel.mode = ""; }
      for (const name of ["opposing", "following", "tied", "branching"]) {
        place(a, name === "tied" ? 0.35 : 0, -6, 0, 6);
        place(b, name === "tied" ? -0.35 : 0, name === "opposing" ? 6 : name === "tied" ? -6 : -6.75, 0, name === "opposing" ? -6 : 6);
        let frames = 0, gap = Infinity, waitFrames = 0, resumedGap = 0, laneError = 0, laneSamples = 0, laneRight = true;
        let waiting = false, branched = false, branchReleased = false, deadlocked = false, maxHop = 0, maxStep = 0, jumps = 0;
        const oldJumps = a.avoidance.navigation.jumps + b.avoidance.navigation.jumps;
        const duration = name === "opposing" ? 12 : 3;
        while (frames++ < Math.ceil(duration / dt) && (a.walk || b.walk)) {
          const ax = a.root.position.x, az = a.root.position.z, bx = b.root.position.x, bz = b.root.position.z;
          crew.update(dt, time += dt); S.updateWorld(root);
          const separation = Math.hypot(a.root.position.x - b.root.position.x, a.root.position.z - b.root.position.z);
          gap = Math.min(gap, separation);
          maxStep = Math.max(maxStep, Math.hypot(a.root.position.x - ax, a.root.position.z - az), Math.hypot(b.root.position.x - bx, b.root.position.z - bz));
          maxHop = Math.max(maxHop, a.hop, b.hop);
          deadlocked ||= a.traffic.waiting && b.traffic.waiting;
          if (b.traffic.waiting) { waiting = true; waitFrames++; }
          else if (waiting && !resumedGap) { resumedGap = separation; branchReleased = branched; }
          if (name === "branching" && b.traffic.waiting && waitFrames * dt >= 0.1) {
            a.walk.tx = a.act.spot.x = 2; a.walk.tz = a.act.spot.z = -2; branched = true;
          }
          if (name === "opposing" && Math.abs(a.root.position.z) < 3 && Math.abs(b.root.position.z) < 3) {
            laneSamples++; laneRight &&= a.root.position.x < 0 && b.root.position.x > 0;
            laneError = Math.max(laneError, Math.abs(a.root.position.x + 0.35), Math.abs(b.root.position.x - 0.35));
          }
        }
        jumps = a.avoidance.navigation.jumps + b.avoidance.navigation.jumps - oldJumps;
        rows.push({ name, frames, gap, waiting, waitSeconds: waitFrames * dt, resumedGap, branched, branchReleased, deadlocked,
          maxHop, maxStep, jumps, laneRight, laneError, laneSamples, arrived: !a.walk && !b.walk });
      }
      result = { dt, rows };
    } finally { crew.dispose(); if (result) result.disposed = targets.size === 0 && root.children.length === 0; }
    return result;
  };

  // The lab's ring-to-spoke turn doubles back sharply. Its outgoing right lane
  // crosses beside the old center segment; center projection used to stop here.
  const npcLaneCornerProbe = ({ dt = 1 / 60 } = {}) => {
    const points = [{ x: -1.3258252147, z: -1.3258252147 }, { x: -1.1414276794, z: -1.487537513 },
      { x: -0.9375, z: -1.6237976321 }, { x: -1, z: -1.7320508076 },
      { x: -1.0311355328, z: -1.8580593405 }, { x: -1.0620560974, z: -1.9835666982 }, { x: -2, z: -6 }];
    const island = { path: { version: 0, debug: { active: false, ringCenterRadius: 0 }, centerlines: [points] },
      surfaceAt: () => 0, isPath: () => true };
    const nav = window.BL.npcPaths.create({ island, walkable: () => true });
    const cave = { root: { position: { x: -1.3559743, y: 0, z: -1.7136292 } }, baseY: 0, bodyHeight: 1.2,
      bedTravel: { mode: "" }, pathing: nav.createState() };
    const end = points.at(-1), p = cave.root.position, storage = cave.pathing.route;
    let frames = 0, staleHint = false, maximumStep = 0;
    while (Math.hypot(end.x - p.x, end.z - p.z) > 1e-6 && frames++ < Math.ceil(10 / dt)) {
      nav.target(cave, end.x, end.z);
      const dx = cave.pathing.targetX - p.x, dz = cave.pathing.targetZ - p.z, distance = Math.hypot(dx, dz);
      if (distance < 1e-7) { staleHint = true; break; }
      const step = Math.min(2.8 * dt, distance);
      p.x += dx / distance * step; p.z += dz / distance * step;
      maximumStep = Math.max(maximumStep, step);
    }
    return { dt, frames, staleHint, maximumStep, arrived: Math.hypot(end.x - p.x, end.z - p.z) < 1e-6,
      stable: cave.pathing.route === storage, index: cave.pathing.index, count: cave.pathing.count };
  };

  // Both directions follow the same S curve on their own right-hand side;
  // measuring signed distance rules out a world-axis bias or cutting straight.
  const npcLaneCurveProbe = ({ dt = 1 / 60 } = {}) => {
    const points = [], rows = [];
    const view = window.BL.math.mat4.create(), eye = { x: 0, y: 1, z: 0 }, ahead = { x: 0, y: 1, z: 0 }, up = { x: 0, y: 1, z: 0 };
    for (let n = 0; n <= 128; n++) { const z = -8 + n / 8; points.push({ x: Math.sin(z * 0.4) * 2, z }); }
    const island = { path: { version: 0, debug: { active: false, ringCenterRadius: 0 }, centerlines: [points] },
      surfaceAt: () => 0, isPath: () => true };
    const nav = window.BL.npcPaths.create({ island, walkable: () => true });
    for (const direction of [1, -1]) {
      const start = direction > 0 ? points[0] : points.at(-1), end = direction > 0 ? points.at(-1) : points[0];
      const cave = { root: { position: { x: start.x, y: 0, z: start.z } }, baseY: 0, bodyHeight: 1.2,
        bedTravel: { mode: "" }, pathing: nav.createState() };
      const p = cave.root.position;
      let frames = 0, samples = 0, laneError = 0, minimumRight = Infinity, maximumTurn = 0, heading = NaN;
      let hintX = NaN, hintZ = NaN, maximumHintStep = 0;
      while (Math.hypot(end.x - p.x, end.z - p.z) > 1e-6 && frames++ < Math.ceil(20 / dt)) {
        nav.target(cave, end.x, end.z);
        const dx = cave.pathing.targetX - p.x, dz = cave.pathing.targetZ - p.z, distance = Math.hypot(dx, dz);
        if (distance < 1e-7) break;
        const step = Math.min(1.7 * dt, distance), angle = Math.atan2(dx, dz);
        if (Number.isFinite(heading) && step > 0.5 * 1.7 * dt) maximumTurn = Math.max(maximumTurn, Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading))));
        heading = angle; p.x += dx / distance * step; p.z += dz / distance * step;
        if (Math.hypot(p.x - start.x, p.z - start.z) < 1.5 || Math.hypot(p.x - end.x, p.z - end.z) < 1.5) continue;
        let nearest = Infinity, right = 0;
        for (let n = 1; n < points.length; n++) {
          const a = points[n - 1], b = points[n], vx = b.x - a.x, vz = b.z - a.z, length2 = vx * vx + vz * vz;
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / length2));
          const error = Math.hypot(p.x - a.x - vx * t, p.z - a.z - vz * t);
          if (error < nearest) {
            nearest = error; ahead.x = vx * direction; ahead.z = vz * direction;
            // Use the rendered camera's right axis while looking down the trail.
            window.BL.math.mat4.lookAt(view, eye, ahead, up);
            right = (p.x - a.x - vx * t) * view[0] + (p.z - a.z - vz * t) * view[8];
          }
        }
        if (Number.isFinite(hintX)) maximumHintStep = Math.max(maximumHintStep, Math.hypot(cave.pathing.targetX - hintX, cave.pathing.targetZ - hintZ));
        hintX = cave.pathing.targetX; hintZ = cave.pathing.targetZ;
        samples++; minimumRight = Math.min(minimumRight, right); laneError = Math.max(laneError, Math.abs(right - 0.35));
      }
      rows.push({ direction, frames, samples, minimumRight, laneError, maximumTurn, maximumHintStep, arrived: Math.hypot(end.x - p.x, end.z - p.z) < 1e-6 });
    }
    return { dt, rows };
  };

  // Check the real lab trail from both ends, using the camera's screen-right
  // basis both down the authored curve and in the walking character's heading.
  const npcLabLaneProbe = ({ dt = 1 / 60 } = {}) => {
    const B = window.__ooga, BL = window.BL, S = BL.scene, scene = BL.scenes.hub, rows = [];
    const actors = [...B.cavemen.values()], cave = actors.find((c) => c.state === "working") || actors[0], path = B.island.path;
    const mouth = B.mouths.find((m) => m.id === "c11");
    let trail = null, nearest = Infinity;
    for (const line of path.centerlines) {
      const end = line.at(-1), distance = Math.hypot(end.x - mouth.x, end.z - mouth.z);
      if (distance < nearest) { nearest = distance; trail = line; }
    }
    const points = trail.filter((p) => Math.hypot(p.x, p.z) > path.debug.ringCenterRadius + 1 && Math.hypot(p.x, p.z) < 15);
    const view = BL.math.mat4.create(), eye = { x: 0, y: 1, z: 0 }, ahead = { x: 0, y: 1, z: 0 }, up = { x: 0, y: 1, z: 0 };
    const update = scene.update; scene.update = () => {}; B.pilot.release(true);
    for (const prop of B.props) prop.node.visible = false;
    for (const c of actors) {
      c.root.visible = false; c.state = "working"; c.bedTravel.mode = ""; c.walk = null;
      c.act.kind = "idle"; c.act.until = c.nextBuildAt = 1e12; c.hop = c.hopV = 0;
    }
    cave.root.visible = true;
    let time = B.renderOpts.matrix.time;
    try {
      for (const direction of [1, -1]) {
        const start = direction > 0 ? points[0] : points.at(-1), end = direction > 0 ? points.at(-1) : points[0];
        Object.assign(cave.root.position, { x: start.x, y: cave.baseY, z: start.z });
        cave.act.kind = "wander"; Object.assign(cave.act.spot, { x: end.x, z: end.z, ry: 0 });
        cave.walk = { tx: end.x, tz: end.z, speed: 2.8, phase: 0, heading: Math.atan2(end.x - start.x, end.z - start.z), to: "spot" };
        cave.root.rotation.y = cave.walk.heading;
        cave.hop = cave.hopV = 0; cave.avoidance.tx = cave.pathing.tx = NaN; cave.avoidance.navigation.mode = 0;
        Object.assign(cave.traffic, { moving: false, waiting: false, leader: null });
        S.updateWorld(scene.root); B.headquarters.solids.props.sync();
        let frames = 0, samples = 0, minimumRight = Infinity, minimumFacingRight = Infinity, laneError = 0, maximumHop = 0, maximumStep = 0;
        while (cave.walk && frames++ < Math.ceil(20 / dt)) {
          const p = cave.root.position, x = p.x, z = p.z;
          B.crew.update(dt, time += dt); S.updateWorld(scene.root);
          maximumStep = Math.max(maximumStep, Math.hypot(p.x - x, p.z - z)); maximumHop = Math.max(maximumHop, cave.hop);
          if (Math.hypot(p.x - start.x, p.z - start.z) < 1.5 || Math.hypot(p.x - end.x, p.z - end.z) < 1.5) continue;
          let nearest = Infinity, right = 0, lateralX = 0, lateralZ = 0;
          for (let n = 1; n < points.length; n++) {
            const a = points[n - 1], b = points[n], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2));
            const lx = p.x - a.x - dx * t, lz = p.z - a.z - dz * t, distance = Math.hypot(lx, lz);
            if (distance < nearest) {
              nearest = distance; lateralX = lx; lateralZ = lz; ahead.x = direction * dx; ahead.z = direction * dz;
              BL.math.mat4.lookAt(view, eye, ahead, up); right = lx * view[0] + lz * view[8];
            }
          }
          ahead.x = Math.sin(cave.root.rotation.y); ahead.z = Math.cos(cave.root.rotation.y);
          BL.math.mat4.lookAt(view, eye, ahead, up);
          samples++; minimumRight = Math.min(minimumRight, right);
          minimumFacingRight = Math.min(minimumFacingRight, lateralX * view[0] + lateralZ * view[8]);
          laneError = Math.max(laneError, Math.abs(right - 0.35));
        }
        rows.push({ direction, start, end, frames, samples, minimumRight, minimumFacingRight, laneError, maximumHop, maximumStep, arrived: !cave.walk });
      }
      return { dt, rows };
    } finally { scene.update = update; }
  };

  // The actual lab spoke joins a circular route at a sharp angle. The offset
  // curve must round that join in either direction, without folding or replanning.
  const npcRingJunctionProbe = ({ dt = 1 / 60 } = {}) => {
    const B = window.__ooga, island = B.island, nav = window.BL.npcPaths.create({ island, walkable: () => true }), rows = [];
    const ring = { x: -island.path.debug.ringTrafficRadius, z: 0 };
    const spoke = island.path.centerlines[0].find((p) => Math.hypot(p.x, p.z) > island.path.debug.ringTrafficRadius + 4);
    for (const direction of [1, -1]) {
      const start = direction > 0 ? ring : spoke, end = direction > 0 ? spoke : ring;
      const p = { x: start.x, y: 0, z: start.z }, cave = { root: { position: p }, baseY: 0, bodyHeight: 1.2,
        bedTravel: { mode: "" }, pathing: nav.createState() };
      const state = cave.pathing, laneX = state.laneX, laneZ = state.laneZ, constructionCapacity = nav.capacity;
      nav.target(cave, end.x, end.z);
      const plans = state.plans;
      let frames = 0, maximumTurn = 0, maximumStep = 0, heading = NaN, stale = false;
      while (Math.hypot(p.x - end.x, p.z - end.z) > 1e-6 && frames++ < Math.ceil(15 / dt)) {
        nav.target(cave, end.x, end.z);
        const dx = state.targetX - p.x, dz = state.targetZ - p.z, distance = Math.hypot(dx, dz);
        if (distance < 1e-7) { stale = true; break; }
        const step = Math.min(2.8 * dt, distance), angle = Math.atan2(dx, dz);
        if (Number.isFinite(heading) && Math.hypot(p.x - start.x, p.z - start.z) > 1 && Math.hypot(p.x - end.x, p.z - end.z) > 0.5)
          maximumTurn = Math.max(maximumTurn, Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading))));
        heading = angle; maximumStep = Math.max(maximumStep, step);
        p.x += dx / distance * step; p.z += dz / distance * step;
      }
      rows.push({ direction, frames, stale, maximumTurn, maximumStep, arrived: Math.hypot(p.x - end.x, p.z - end.z) < 1e-6,
        stable: state.laneX === laneX && state.laneZ === laneZ && state.plans === plans,
        count: state.count, capacity: state.laneX.length, constructionCapacity, pairedCapacity: state.laneZ.length === constructionCapacity });
    }
    return { dt, rows };
  };
  return { npcLaneSpacingProbe, npcLaneCornerProbe, npcLaneCurveProbe, npcLabLaneProbe, npcRingJunctionProbe };
})();

// ---- solo-debug.mjs ----
const { soloDebugParsingProbe, soloDebugSnapshot, soloDebugLifecycleProbe, soloDebugGamesProbe } = (() => {
  // Parse the real module for each URL without creating a browser or mutating the
  // canonical roster. Activity refreshes must not widen a solo construction list.
  const soloDebugParsingProbe = (load) => {
    const canonical = load("").roster.map((entry) => entry.name);
    const cases = [
      { query: "", solo: false, names: canonical },
      { query: "?debug=1&character=MrHodlX", solo: false, names: canonical },
      { query: "?solo=1&character=MrHodlX", solo: false, names: canonical },
      { query: "?debug=1&solo=0&character=MrHodlX", solo: false, names: canonical },
      { query: "?debug=1&solo=other&character=MrHodlX", solo: false, names: canonical },
      { query: "?debug=1&solo=1&character=%20mRhOdLx%20", solo: true, names: ["MrHodlX"] },
      { query: "?debug=1&solo&character=MrHodlX", solo: true, names: ["MrHodlX"] },
      { query: "?debug=1&solo=1&character=BC1GUI", solo: true, names: ["bc1gui"] },
      { query: "?debug=1&solo=1", solo: true, names: [] },
      { query: "?debug=1&solo&character=", solo: true, names: [] },
      { query: "?debug=1&solo=1&character=%20%20", solo: true, names: [] },
      { query: "?debug=1&solo=1&character=unknown-ooga", solo: true, names: [] },
      { query: "?debug=1&solo=1&character=MrHodl", solo: true, names: [] },
      { query: "?debug=1&solo=1&character=ottoz0r", solo: true, names: [] }
    ];
    const rows = cases.map((fixture) => {
      const C = load(fixture.query), active = C.activeRoster, before = active.map((entry) => entry.name);
      const at = Date.now();
      C.seedDebugActivity(at);
      C.applyActivity(canonical.map((name) => ({ name, lastCommitAt: at + 1 })), at + 1);
      return { query: fixture.query, expected: fixture.names, solo: C.solo, before,
        flags: C.solo === fixture.solo && before.join("|") === fixture.names.join("|"),
        canonical: C.roster.map((entry) => entry.name).join("|") === canonical.join("|"),
        references: active.every((entry) => C.roster.includes(entry)),
        stable: C.activeRoster === active && active.map((entry) => entry.name).join("|") === before.join("|") };
    });
    return { canonical, rows, flags: rows.every((row) => row.flags), preserved: rows.every((row) => row.canonical && row.references && row.stable) };
  };

  // The scene debug object remains inspectable on a normal page even though the
  // global __ooga testing entry point is deliberately absent there.
  const soloDebugSnapshot = () => {
    const BL = window.BL, B = window.__ooga, id = B ? B.scene : "hub", scene = BL.scenes[id], D = scene.debug;
    const crew = D.crew, actors = crew ? [...crew.cavemen.values()] : [], canonical = BL.contributors.roster.map((entry) => entry.name);
    const attached = (node) => { for (let parent = node.parent; parent; parent = parent.parent) if (parent === scene.root) return true; return false; };
    return { scene: id, exposed: !!B, backend: B ? B.renderer.kind : null, solo: BL.contributors.solo,
      canonical, active: BL.contributors.activeRoster.map((entry) => entry.name), actors: actors.map((cave) => cave.traits.name),
      roster: [...document.querySelectorAll("#roster > li")].map((row) => row.dataset.name),
      indices: actors.map((cave) => ({ name: cave.traits.name, index: cave.index, expected: canonical.indexOf(cave.traits.name) })),
      attached: actors.every((cave) => attached(cave.root)), finite: actors.every((cave) => Object.values(cave.root.position).every(Number.isFinite)),
      player: crew && crew.player ? crew.player.traits.name : null,
      jetpackOwned: !!D.jetpack?.owned, magazineOwned: actors.some((cave) => crew.hasMagazine(cave)),
      magazineCarrier: actors.find((cave) => crew.hasMagazine(cave))?.traits.name || null, weaponHidden: document.getElementById("weapon-hud").hidden,
      magazineHidden: document.getElementById("magazine-hud").hidden };
  };

  const soloDebugLifecycleProbe = async (snapshot) => {
    const B = window.__ooga, BL = window.BL, rows = [], detached = [];
    const frames = () => new Promise((resolve, reject) => {
      const first = B.renderedFrames, start = performance.now();
      const tick = () => {
        if (B.renderedFrames >= first + 3) resolve();
        else if (performance.now() - start > 8000) reject(new Error("Solo scene frames did not advance"));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const exercise = async () => {
      rows.push({ stage: "entry", ...snapshot() });
      B.pilot.release(true);
      B.refreshStates(true);
      const at = Date.now(), absent = BL.contributors.roster.find((entry) => !B.cavemen.has(entry.name));
      BL.contributors.applyActivity(BL.contributors.roster.map((entry) => ({ name: entry.name, lastCommitAt: at })), at);
      BL.scenes[B.scene].onDonation({ id: `solo-${B.scene}-${rows.length}`, sats: 1200, handle: absent ? absent.name : "", message: "", at });
      await frames();
      rows.push({ stage: "released-refreshed-donated", ...snapshot() });
    };
    await exercise();
    for (const id of ["lab", "hub"]) {
      const old = B.crew, roots = [...B.cavemen.values()].map((cave) => cave.root);
      B.go(id);
      await new Promise((resolve, reject) => {
        const start = performance.now();
        const tick = () => {
          if (B.scene === id && !B.transitioning) resolve();
          else if (performance.now() - start > 12000) reject(new Error(`Solo transition to ${id} did not settle`));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      detached.push(old.cavemen.size === 0 && roots.every((node) => !node.parent));
      await exercise();
    }
    return { rows, detached: detached.every(Boolean), noControlFallback: rows.filter((row) => row.stage !== "entry").every((row) => row.player === null) };
  };

  const soloDebugGamesProbe = async (snapshot) => {
    const B = window.__ooga, rows = [];
    const go = async (id) => {
      B.go(id);
      await new Promise((resolve, reject) => {
        const start = performance.now();
        const tick = () => {
          if (B.scene === id && !B.transitioning) resolve();
          else if (performance.now() - start > 12000) reject(new Error(`Solo game transition to ${id} did not settle`));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    };
    await go("race");
    const race = { scene: "race", actors: B.racers.racers.map((racer) => racer.name), player: B.racers.player?.name || null,
      roster: [...document.querySelectorAll("#garage-racers [data-racer]")].map((row) => row.dataset.racer),
      sidebar: [...document.querySelectorAll("#roster > li")].map((row) => row.dataset.name), spectators: B.track.spectators.count,
      disabled: [...document.querySelectorAll('[data-action="race-start"], [data-action="cup-start"]')].every((button) => button.disabled) };
    B.race.startRace();
    race.started = B.race.phase;
    if (!race.actors.length) { B.race.startCup(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    race.afterAttempt = B.race.phase;
    rows.push(race);
    await go("hub");
    const afterRace = snapshot();
    await go("drop");
    const drop = { scene: "drop", actors: B.diver ? [B.diver.cave.traits.name] : [],
      roster: [...document.querySelectorAll("#drop-oogas [data-racer]")].map((row) => row.dataset.racer),
      sidebar: [...document.querySelectorAll("#roster > li")].map((row) => row.dataset.name),
      disabled: document.querySelector('[data-action="drop-start"]').disabled };
    B.drop.start();
    drop.started = B.drop.phase;
    if (!drop.actors.length) { B.drop.jumpNow(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    drop.afterAttempt = B.drop.phase;
    rows.push(drop);
    await go("hub");
    return { rows, afterRace, afterDrop: snapshot() };
  };
  return { soloDebugParsingProbe, soloDebugSnapshot, soloDebugLifecycleProbe, soloDebugGamesProbe };
})();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Three, measured: cutting this to 1 and the tips to 12 saved 35 s of lane work across all seven
// soaks - 4 s of wall - because a soak is dominated by its settle, its forced GC and two heap
// parses, not by its round trips. Not worth a third of the leak detection.
// Thirty tips exercise the same pooling and cleanup as sixty, for half the clicking.
// One rate for step-size-independent behaviour; the low rate is the one that has
// caught real bugs (long steps skipping collision), so it is the one kept.
const RATES = [1 / 20];
// One Ooga per character file; the generated bundle is rebuilt so every run sees new files.
writeCharacters();
const CAST = readdirSync(join(root, "src", "characters")).filter((f) => f.endsWith(".js")).length;
const src = `file://${join(root, "src", "index.html")}`;
const dist = `file://${join(root, "oogaboogaland.html")}`;
// Checks pin the clock at noon (hour=12, day=80) unless they ask for another hour.
const clock = (query = "") => `${query.includes("hour=") ? "" : "&hour=12"}${query.includes("day=") ? "" : "&day=80"}${query ? "&" + query : ""}`;
const page = (base, query) => `${base}?debug=1&nosim=1&scene=lab${clock(query)}`;
// Without scene= the page lands on the hub.
const hubPage = (base, query) => `${base}?debug=1&nosim=1${clock(query)}`;
const covered = (c) => c.worstGap <= 0.14 && c.meanGap <= 0.08 && c.yellowPanels && c.panelColors >= 5 && c.tiles > 0;
const results = [];
// Blocks run side by side, so each collects its lines and prints them together when it finishes.
const output = new AsyncLocalStorage();
// Quiet by default: a PASS is one count in the summary, a FAIL prints with its detail. VERBOSE=1 prints everything.
const VERBOSE = process.env.VERBOSE === "1";
// A failure inside a step marked `open` (a known, unfixed bug) prints OPEN and does not fail the run.
const record = (name, ok, detail = "") => {
  const run = output.getStore(), open = !ok && !!run && !!run.open;
  const line = ok && !VERBOSE ? null : `${ok ? "PASS" : open ? "OPEN" : "FAIL"} ${name}${open ? ` Â· known: ${run.open}` : ""}${detail ? " Â· " + detail : ""}`;
  if (run) {
    run.results.push({ name, ok, open, detail });
    if (line) run.lines.push(line);
  } else {
    results.push({ name, ok, open, detail });
    if (line) console.log(line);
  }
};
const untilReady = async (b) => {
  const t0 = Date.now();
  const sample = () => b.evaluate(`(() => { const B=window.__ooga;return {scene:B?.scene,frames:B?.renderedFrames||0,curtain:!!document.getElementById("curtain"),renderer:B?.renderer?.kind}; })()`);
  const isReady = s => s.frames>=2&&!s.curtain;
  for (;;) {
    let state = null;
    try {
      state = await sample();
    } catch (err) {
      if (err.driver) throw err;
      // The old document is still tearing down.
    }
    if (state&&isReady(state)) break;
    if (Date.now() - t0 > 20000) {
      // A slow DevTools reply can cross the deadline while the page becomes ready. Judge the
      // fresh state, not the stale boolean; never synchronously read pixels on a failure path.
      state=await sample();if(isReady(state))break;
      throw driverError("page readiness deadline: "+JSON.stringify(state)+" "+b.logs.join(" | "));
    }
    await b.sleep(40);
  }
  // Entering pops the seven cavemen in on tweens, so a drawn scene is not a settled one.
  // Wait for tweenCount() === 0, not the shortened 0.9 s leaf-curtain transition.
  await b.evaluate(`new Promise((resolve) => { const t0 = performance.now(); const tick = () => { if (window.BL.scene.tweenCount() === 0 || performance.now() - t0 > 4000) resolve(); else requestAnimationFrame(tick); }; tick(); })`);
};
// Installed only by the shoreline browser tests, before boot. Production code is untouched.
const shorelineHarness = () => {
  const P=window.__shoreline={draws:0,attempts:0,readbacks:0,readbackMs:0,maxRenderMs:0,contextsLost:0,simulating:false,tick:0,last:0};
  const read=WebGL2RenderingContext.prototype.readPixels;
  WebGL2RenderingContext.prototype.readPixels=function(...args){const t=performance.now();P.readbacks++;try{return read.apply(this,args);}finally{P.readbackMs+=performance.now()-t;}};
  document.addEventListener("webglcontextlost",()=>P.contextsLost++,true);
  document.addEventListener("DOMContentLoaded",()=>{
    const B=window.__ooga,R=B?.renderer;if(!R)return;
    // Use the existing low tier, including its real shaders/buffers, on the software-GPU lane.
    // All three tiers' upload capacities and gameplay are additionally covered by water-unit.
    R.setQuality("low");const render=R.render;
    R.render=function(...args){
      if(P.simulating&&++P.tick%60!==0&&P.tick!==P.last){P.observe?.(false);return false;}
      const t=performance.now();P.attempts++;const drawn=render.apply(this,args);
      P.maxRenderMs=Math.max(P.maxRenderMs,performance.now()-t);if(drawn)P.draws++;P.observe?.(drawn);return drawn;
    };
    // Keep every original 60 Hz director/input/physics step and draw each simulated second
    // plus the final state. The ordinary requestAnimationFrame loop is never replaced.
    P.advance=(seconds,observe=null)=>{P.simulating=true;P.observe=observe;P.tick=0;P.last=Math.round(seconds*60);try{B.advance(seconds);}finally{P.simulating=false;P.observe=null;}};
    // Simulated time advances through the normal director; readiness, not elapsed time, ends a wait.
    P.until=(ready,limit=60)=>{let seconds=0;while(!ready()&&seconds<limit){P.advance(1);seconds++;}if(!ready())throw Error("Shoreline lifecycle did not become ready within "+limit+" simulated seconds");return seconds;};
  },{once:true});
};
const shorelineState = () => {
  const B=window.__ooga,D=B?.dsb,P=window.__shoreline,gl=document.getElementById("scene")?.getContext("webgl2");
  const ext=gl?.getExtension("WEBGL_debug_renderer_info"),errors=[];
  if(gl)for(let i=0;i<8;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;errors.push(e);}
  return {scene:B?.scene,kind:B?.renderer.kind,ready:B?.renderer.ready,failure:String(B?.renderer.failure||""),frames:B?.renderedFrames,draws:P.draws,
    curtain:!!document.getElementById("curtain"),lost:!gl||gl.isContextLost()||P.contextsLost>0,errors,
    gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):"unknown",readbacks:P.readbacks,readbackMs:P.readbackMs,maxRenderMs:P.maxRenderMs,timing:B?.timing,
    initialized:!!(D?.water&&D.waterInteraction&&D.land&&D.avatar&&B.crew&&window.BL.dsbCoast),
    capacity:D?.waterInteraction.stats.capacity,nodes:D?.waterInteraction.group.children.length,records:B?.renderer.stats.records,textures:B?.renderer.stats.waterTextures};
};
const shorelineHealthy = s => s.scene==="dsb"&&s.kind==="webgl2"&&s.ready&&!s.failure&&s.frames>=3&&s.draws>=2&&!s.curtain&&!s.lost&&!s.errors.length&&s.initialized&&s.capacity===24&&s.textures===2;
const readbackPerformanceNotice = line => /^\[log\.warning\] \[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance, [^)]*\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/.test(line);
const shorelineHarnessChecks = async () => {
  const now=Date.now;let elapsed=0,calls=0,screenshots=0;
  const context={window:{__ooga:{scene:"dsb",renderedFrames:1,renderer:{kind:"webgl2"}},BL:{scene:{tweenCount:()=>0}}},document:{getElementById:()=>true},performance:{now:()=>0}};
  const b={logs:[],sleep:async()=>{},screenshot:async()=>{screenshots++;},evaluate:async expression=>{
    const result=runInNewContext(expression,context);calls++;
    if(calls===1){elapsed=20001;context.window.__ooga.renderedFrames=3;context.document.getElementById=()=>null;}
    return result;
  }};
  try{Date.now=()=>elapsed;await untilReady(b);record("Shoreline validator: a late ready reply succeeds without failure-path screenshot readback",calls===3&&screenshots===0);}
  catch(e){record("Shoreline validator: a late ready reply succeeds without failure-path screenshot readback",false,String(e));}
  finally{Date.now=now;}
  let boot=null,ticks=0,renders=0,readbacks=0;const R={setQuality(){},render:()=>{renders++;return true;}};
  const B={renderer:R,advance:seconds=>{for(let i=0;i<Math.round(seconds*60);i++){ticks++;R.render();}}};
  const C=class {readPixels(){readbacks++;}};
  const sandbox={window:{__ooga:B},document:{addEventListener:(name,fn)=>{if(name==="DOMContentLoaded")boot=fn;}},WebGL2RenderingContext:C,performance:{now:()=>0}};
  runInNewContext(`(${shorelineHarness.toString()})()`,sandbox);boot();const P=sandbox.window.__shoreline;
  let observations=0,observedDraws=0,transient=false;
  P.advance(2.25,drawn=>{observations++;if(drawn)observedDraws++;if(ticks===7)transient=true;});const sampled=renders,sampledTicks=ticks;R.render();new C().readPixels();const ordinary=renders;
  const waitStart=ticks,waited=P.until(()=>ticks-waitStart>=135,4);
  let deadline=false;try{P.until(()=>false,1);}catch{deadline=true;}
  record("Shoreline validator: observes transient simulation ticks and waits for semantic readiness with a bounded deadline",observations===135&&observedDraws===3&&transient&&waited===3&&deadline&&!P.observe);
  B.advance=()=>{throw Error("fixture simulation failure");};try{P.advance(1);}catch{}
  record("Shoreline validator: sampling preserves every physics tick, final draw, normal rendering and readback forwarding",sampledTicks===135&&sampled===3&&ordinary===4&&readbacks===1&&P.readbacks===1&&!P.simulating&&!P.observe);
};
// Frame limiter stays on: unlocked measured 418 fps, turning every `fps >= 50` floor into `418 >= 50`.
// UNLOCK=1 unlocks the non-measuring lanes so the trade can be measured.
const UNLOCKED = process.env.UNLOCK === "1";
const POOLED = process.env.POOL === "1";
let realTimeTask = false;
const retried = [];
const SESSION_MS = 120000;
const failure = (err) => String(err.message || err).slice(0, 1600);
// Blocks sharing a page run one after another in one Chrome, each with its own name, error and console check.
// Records are held until the session ends, so a session that could not run can be dropped and rerun.
const session = (url, steps, opts, final) => output.run({ lines: [], results: [], retry: null }, async () => {
  const run = output.getStore(), { lines } = run;
  const t0 = Date.now();
  let b = null, started = t0, ready = t0, watchdog = null, overran = false;
  try {
    // Fresh Chrome per session; reuse is opt-in (POOL=1) because it measured slower and flakier than launching.
    // Idle browsers each hold a WebGL context, and a reused one carries the last task's heap and GPU state.
    const shape = { ...opts, perf: opts.perf ?? (realTimeTask || !UNLOCKED) };
    b = POOLED && !shape.perf && !final ? await acquire(shape) : await launch(shape);
    started = Date.now();
    // Watchdog kills Chrome so a wedged session never holds its lane; the longest healthy session is ~20 s.
    const browser = b;
    watchdog = setTimeout(() => { overran = true; browser.close(); }, SESSION_MS);
    if(steps.some(([name])=>name.startsWith("dsb shoreline")||name.includes("Portara aperture")))await b.send("Page.addScriptToEvaluateOnNewDocument",{source:`(${shorelineHarness.toString()})()`});
    // Install before scripts/boot: observe every DSB runtime factory and prohibit live requests.
    if (steps.some(([name]) => name.startsWith("Ooga Portal")||name.includes("Portara aperture"))) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const counts = window.__gateDormancy = { enter: 0, land: 0, zuzu: 0, data: 0, tv: 0, audio: 0, chat: 0, fetch: 0, socket: 0, radio: 0 };
      const watch = (object, key, method, counter) => {
        let value;
        Object.defineProperty(object, key, { configurable: true, get: () => value, set: next => {
          value = next;
          if (next && next[method]) { const original = next[method]; next[method] = function(...args) { counts[counter]++; return original.apply(this, args); }; }
        } });
      };
      let namespace;
      Object.defineProperty(window, "BL", { configurable: true, get: () => namespace, set: value => {
        if (namespace) { namespace = value; return; }
        namespace = value;
        // Clock injection exercises elapsed deadlines without depending on this VM's frame rate.
        window.__gateClock = 0; let gate;
        Object.defineProperty(value, "oogaPortal", { configurable: true, get: () => gate, set: next => {
          gate = next; const create = next.create;
          next.create = options => create({ ...options, now: options.now || (() => window.__gateClock) });
        } });
        for (const [key, method, counter] of [["dsbModels", "build", "land"], ["dsbAgent", "create", "zuzu"], ["dsbData", "create", "data"], ["dsbTv", "create", "tv"], ["dsbAudio", "create", "audio"], ["dsbConversation", "create", "chat"]]) watch(value, key, method, counter);
        const scenes = {}; watch(scenes, "dsb", "enter", "enter"); value.scenes = scenes;
      } });
      window.fetch = () => { counts.fetch++; return Promise.reject(new Error("Unexpected network during gate test")); };
      window.WebSocket = class { constructor() { counts.socket++; throw new Error("Unexpected socket during gate test"); } };
      window.Audio = function() { counts.radio++; return document.createElement("audio"); };
    })()` });
    // DSB exercises the real automatic startup against deterministic public-feed fixtures.
    if (steps.some(([name]) => name.includes("dsb"))) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      window.__dsbRadioFixture = { plays: 0, pauses: 0, element: null };
      if (${process.env.DSB_RADIO_LIVE !== "1"}) window.Audio = class {
        constructor() { if (window.__gateDormancy) __gateDormancy.radio++; this.src = ""; __dsbRadioFixture.element = this; }
        play() { __dsbRadioFixture.plays++; queueMicrotask(() => { if (this.src && this.onplaying) this.onplaying(); }); return Promise.resolve(); }
        pause() { __dsbRadioFixture.pauses++; }
        load() {}
        removeAttribute(name) { if (name === "src") this.src = ""; }
      };
      const originalFetch = window.fetch;
      window.__dsbFeedFixture = { requests: 0, sockets: 0, closed: 0 };
      window.fetch = async (url, options) => {
        if (window.__gateDormancy) __gateDormancy.fetch++;
        if (String(url).startsWith("https://noderunnersradio.com/")) {
          window.__dsbTvFixture = window.__dsbTvFixture || { invoices: 0, searches: 0 }; let value;
          if (url.includes("/api/search")) { __dsbTvFixture.searches++; value = { results: [{ title: "Banana Beats", artist: "Ooga", source: "library", sats: 21 }] }; }
          else if (url.includes("/api/play/status")) { if(__dsbTvFixture.paymentError)throw new Error("offline");value = __dsbTvFixture.payment || { paid: false, queued: false }; }
          else if (url.endsWith("/api/play")) { __dsbTvFixture.invoices++; value = {"bolt11": "lnbc2100n1p4vzq52pp50dsaw0kxfc0urmtzl7ezwv4qemxs8ufx98cyjjsj9wkz7l3l7afsdpltfshqgpg2c69v2f6ypqkzun0dcsykmm9de5kwgpdyppxjarrda5kugzzv4skx6qcqzzsxqzuysp535fyv3fcdnf59stpn82fd6mypgd245r8n9zg6mcnx90a8ws68v2s9qxpqysgqxj432mzxnppe93v7fqxvs8hav584jgqfejc3mrpagrkheq0ythhse9ldk82lc0p43njn39dcs36m0djafxgug2aa374eczjfm3ew54qqt8zcnh", "sats": 210, "payment_hash": "7b61d73ec64e1fc1ed62ffb22732a0cecd03f12629f0494a122bac2f7e3ff753"}; }
          else value = url.includes("nowplaying") ? { now_playing: { title: "Turtle Radio", artist: "DSB Band", note: "Hello island" }, queue: [{ title: "Banana Beats", artist: "Ooga" }] } : { history: [{ title: "Neon River", artist: "Purple Crew" }] };
          return { ok: true, json: async () => value };
        }
        if (!String(url).startsWith("https://mempool.space/") && !String(url).startsWith("https://api.exchange.coinbase.com/")) return originalFetch(url, options);
        __dsbFeedFixture.requests++;
        const minute = Math.floor(Date.now() / 60000) * 60;
        return { ok: true, json: async () => url.includes("candles") ? [[minute - 120, 59900, 60200, 60000, 60100], [minute - 60, 60000, 60400, 60100, 60300], [minute, 60200, 60500, 60300, 60400]] : url.endsWith("/height") ? 900000 : url.includes("recommended") ? { fastestFee: 8 } : { vsize: 20000000 } };
      };
      window.WebSocket = class {
        constructor() { if (window.__gateDormancy) __gateDormancy.socket++; __dsbFeedFixture.sockets++; this.closed = false; queueMicrotask(() => { if (!this.closed) { if (this.onopen) this.onopen(); if (this.onmessage) this.onmessage({ data: JSON.stringify({ type: "ticker", product_id: "BTC-USD", price: "60400", time: new Date().toISOString() }) }); } }); }
        send() {}
        close() { if (!this.closed) { this.closed = true; __dsbFeedFixture.closed++; } }
      };
    })()` });
    await b.open(url);
    await b.focus(true);
    await untilReady(b);
    ready = Date.now();
    for (const [i, [name, fn, open]] of steps.entries()) {
      const from = i ? b.logs.length : 0;
      run.open = open || null;
      try {
        await fn(b);
        const observed=b.logs.slice(from),notices=b.shorelineHealthy&&b.shorelineSoftware?observed.filter(readbackPerformanceNotice):[];
        if(notices.length)lines.push(`INFO software WebGL: ${notices.length} driver ReadPixels performance notices; healthy state/GL checks passed (no application readback required).`);
        const noise = observed.filter((l) => !l.includes("WebGL2 renderer failed")&&!notices.includes(l));
        record(`${name}: clean console`, noise.length === 0, `${((Date.now() - started) / 1000).toFixed(1)}s ${noise.join(" | ").slice(0, 1600)}`);
      } catch (err) {
        if (overran) err = driverError(`the session passed ${SESSION_MS / 1000} s and its Chrome was killed`);
        if (err.driver && !final && run.results.every((r) => r.ok)) {
          run.retry = `${name} Â· ${failure(err)}`;
          break;
        }
        record(name, false, failure(err));
        if (overran) break;
      }
    }
  } catch (err) {
    if (overran) err = driverError(`the session passed ${SESSION_MS / 1000} s and its Chrome was killed`);
    if (err.driver && !final && run.results.every((r) => r.ok)) run.retry = `${steps[0][0]} Â· ${failure(err)}`;
    else record(steps[0][0], false, failure(err));
  } finally {
    clearTimeout(watchdog);
    if (b && !overran) b.close();
    const s = (ms) => (ms / 1000).toFixed(1);
    if (VERBOSE) lines.push(`TIME ${steps.map((step) => step[0]).join(" + ")} Â· launch ${s(started - t0)}s Â· boot ${s(ready - started)}s Â· body ${s(Date.now() - ready)}s`);
  }
  return run;
});
// Only driver errors retry, once, on a fresh Chrome, and only before any assertion has failed.
// So a retry can never hide a real failure; every retry is printed.
const fold = async (url, steps, opts = {}) => {
  let run = await session(url, steps, opts, false);
  if (run.retry) {
    retried.push(run.retry);
    console.log(`RETRY ${run.retry} Â· running the session again on a fresh Chrome`);
    run = await session(url, steps, opts, true);
  }
  results.push(...run.results);
  if (run.lines.length) console.log(run.lines.join("\n"));
  return run;
};
// Waits for a condition on the page, then two more drawn frames so its effects are on screen.
const untilPage = (b, cond, ms = 6000) => b.evaluate(`new Promise((resolve) => { const B = window.__ooga, t0 = performance.now(); let hitFrame = 0; const tick = () => { const s = B.stats(); if (!hitFrame && (${cond})) hitFrame = B.renderedFrames; if ((hitFrame && B.renderedFrames >= hitFrame + 2) || performance.now() - t0 > ${ms}) resolve(!!hitFrame); else requestAnimationFrame(tick); }; tick(); })`);


const raceTracks = ["race tracks", async (b) => {
  const built = await b.evaluate(`(() => { const B = window.__ooga, T = window.BL.raceTrack, out = {}; for (const def of T.TRACKS) { const t0 = performance.now(); document.querySelector('[data-track="' + def.id + '"]').click(); const ms = performance.now() - t0; const t = B.track, S = t.samples, n = t.count; let maxStep = 0, gapNearCheck = false; for (let i = 0; i < n; i++) { const q = (i + 1) % n; if (S.surface[i] !== T.SURF.gap && S.surface[q] !== T.SURF.gap) maxStep = Math.max(maxStep, Math.abs(S.y[q] - S.y[i])); } for (const c of t.checkpoints) for (let k = 0; k < 30; k++) if (S.surface[(c + k) % n] === T.SURF.gap) gapNearCheck = true; const faces = t.sectors.reduce((sum, s) => sum + s.nodes.road.geometry.faces.length + s.nodes.big.geometry.faces.length + s.nodes.small.geometry.faces.length, 0); const h0 = t.heightAt(t.grid[0].x, t.grid[0].z, -1); out[def.id] = { ms: Math.round(ms), samples: n, length: Math.round(t.length), sectors: t.sectors.length, chunks: t.terrainNodes.length, checkpoints: t.checkpoints.length, first: t.checkpoints[0], gapNearCheck, maxStep: +maxStep.toFixed(2), faces, bananas: t.spawns.bananas.length, crates: t.spawns.crates.length, pads: t.spawns.pads.length, map: t.mapPts.length, grid: t.grid.length, gridHeight: Math.abs(h0 - t.grid[0].y) < 1e-6, torches: t.torches.length, spectators: t.spectators.count, records: B.renderer.stats.records, sky: !!(t.renderOpts.horizon && t.renderOpts.zenith) }; } return out; })()`);
  for (const [id, t] of Object.entries(built)) {
    record(`race tracks: ${id} builds fast into culled sectors with checkpoints clear of its gaps`, t.ms < 900 && t.samples > 300 && t.length > 600 && t.sectors >= 12 && t.chunks > 20 && t.checkpoints === 8 && t.first === 0 && !t.gapNearCheck && t.maxStep < 0.8 && t.faces > 15000 && t.faces < 120000 && t.bananas >= 30 && t.crates >= 6 && t.pads >= 2 && t.map >= 100 && t.grid === Math.max(8, CAST) && t.gridHeight && t.spectators > 12 && t.records < 320, JSON.stringify(t));
  }
  record("race tracks: the two outdoor tracks carry a sky and the gorge lights its torches", built.bay.sky && built.peak.sky && !built.gorge.sky && built.gorge.torches >= 20 && built.bay.torches === 0, JSON.stringify({ bay: built.bay.sky, gorge: [built.gorge.sky, built.gorge.torches], peak: built.peak.sky }));
  const swapped = await b.evaluate(`(() => { const B = window.__ooga; const r0 = B.renderer.stats.records; document.querySelector('[data-track="bay"]').click(); B.housekeep(); const r1 = B.renderer.stats.records; return { r0, r1, nodes: B.stats().allNodes }; })()`);
  record("race tracks: switching tracks releases the old track's GPU records", swapped.r1 <= swapped.r0 + 5 && swapped.nodes < 900, JSON.stringify(swapped));
}];

const orbitPage = (base, query) => `${base}?debug=1&nosim=1&scene=orbit${clock(query)}`;
// Flight log rows: a row is dot-separated, its first part the fact (PERFECT, an altitude, a bill) and every
// later part either a plain number or a named bonus (space, fast, hand-flown, air) worth its number; a count
// times its worth (stages) is points wherever it stands. Everything else on a row is words.
const orbitLog = `(() => { const O = window.__ooga.orbit, rows = [...document.querySelectorAll("#orbit-score li")].map((li) => [li.children[0].textContent, li.children[1].textContent]); const points = rows.filter(([label]) => label !== "Time").reduce((sum, [, value]) => sum + value.split(" Â· ").reduce((row, part, i) => { const times = part.match(/^(\\d+) Ã— (\\d+)$/), named = i > 0 && part.match(/^(?:[a-z-]+ )?(\\d+)$/); return row + (times ? times[1] * times[2] : named ? +named[1] : 0); }, 0), 0); return { phase: O.phase, shown: !document.getElementById("orbit-results").hidden, rows, points, final: +document.getElementById("orbit-final-score").textContent, best: document.getElementById("orbit-final-best").textContent, medal: document.getElementById("orbit-final-medal").hidden ? null : document.getElementById("orbit-final-medal").textContent, summary: document.getElementById("orbit-summary").textContent, result: O.result, exit: document.querySelector('#orbit-results [data-action="leave"]').textContent }; })()`;
// Poll in short steps: one long wait sent while the old document unloads never gets its reply.
const orbitBooted = async (b) => {
  for (let i = 0; i < 200 && !await b.evaluate(`(() => { try { return !!(window.__ooga.orbit && window.__ooga.renderedFrames > 0); } catch { return false; } })()`); i++) await b.sleep(100);
};

const orbitFlow = async (b) => {
  // Space on the title card only closes it (it used to launch in the same press); the next Space launches.
  const card = await b.evaluate(`!document.querySelector('[data-intro="orbit"]').hidden`);
  await b.key(" ");
  const closed = await b.evaluate(`({ card: !document.querySelector('[data-intro="orbit"]').hidden, phase: window.__ooga.orbit.phase })`);
  await b.key(" ");
  const counting = await b.evaluate(`(() => { const O = window.__ooga.orbit; return { phase: O.phase, strip: !document.getElementById("orbit-strip").hidden, build: document.getElementById("orbit-build").hidden, saved: JSON.parse(localStorage.getItem("oogaboogaland.v1")).orbit.build.join() === O.stack.join() }; })()`);
  // Real frames already ran the count, so the timed part restarts in one tick and reads the same on any machine.
  const lifted = await b.evaluate(`(() => { const O = window.__ooga.orbit; O.toBuild(); O.launch(); O.simulate(3.05); const ignite = O.phase; O.simulate(1.85); const gauge = O.gauge; O.releaseClamps(); O.simulate(3); const s = window.__ooga.flight.state; return { ignite, gauge, phase: O.phase, alt: s.alt, burning: s.burning, score: O.score }; })()`);
  const spent = await b.evaluate(`(() => { const O = window.__ooga.orbit, s = window.__ooga.flight.state; for (let t = 0; t < 120 && s.fuel[s.stage] > 0; t += 0.25) O.simulate(0.25); O.simulate(0.3); return { stage: s.stage, burning: s.burning, center: document.getElementById("orbit-center").textContent }; })()`);
  await b.key(" ");
  const staged = await b.evaluate(`(() => { const O = window.__ooga.orbit, s = window.__ooga.flight.state, stage = s.stage; O.simulate(1); return { stage, burning: s.burning, debris: window.__ooga.stats().debris }; })()`);
  record("orbit flow: Space closes the title card without launching, then Space launches and saves the build, the clamps let go in the gold on the gauge, and Space drops a spent stage and lights the next", card && !closed.card && closed.phase === "build" && counting.phase === "count" && counting.strip && counting.build && counting.saved && lifted.ignite === "ignite" && lifted.gauge > 0.66 && lifted.gauge < 0.78 && lifted.phase === "ascent" && lifted.alt > 5 && lifted.burning && lifted.score === 200 && !spent.burning && spent.stage === 0 && staged.stage === 1 && staged.burning && staged.debris === 1, JSON.stringify({ card, closed, counting, lifted, spent, staged }));
  // Hands off, the autopilot climbs; each spent stage is dropped as Space would.
  const top = await b.evaluate(`(() => { const O = window.__ooga.orbit, F = window.__ooga.flight, s = F.state; for (let t = 0; t < 400 && O.phase === "ascent"; t += 0.25) { if (s.fuel[s.stage] <= 0 && F.stages[s.stage + 1] && F.stages[s.stage + 1].engine) O.act(); O.simulate(0.25); } const phase = O.phase; O.simulate(5); return { phase, maxAlt: s.maxAlt, score: O.score, mode: s.mode, walk: !document.getElementById("orbit-eva").hidden }; })()`);
  await b.key(" ");
  const free = await b.evaluate(`(() => { const O = window.__ooga.orbit; O.simulate(0.2); return { pod: window.__ooga.flight.isPod(), mode: window.__ooga.flight.state.mode, walk: !document.getElementById("orbit-eva").hidden }; })()`);
  record("orbit flow: the autopilot climbs to low orbit, which holds the rocket over the pad, and Space cuts the pod free for the spacewalk", top.phase === "orbit" && top.maxAlt >= 500 && top.score >= 200 + 2 * 100 + 1000 && top.mode !== "free" && free.pod && free.mode === "free" && free.walk, JSON.stringify({ top, free }));
  await b.key(" ");
  const walk = await b.evaluate(`(() => { const O = window.__ooga.orbit, E = O.eva, phase = O.phase; E.e = O.rock.e; E.u = O.rock.u; E.f = O.rock.f - O.rock.reach * 0.6; E.ve = E.vu = E.vf = 0; O.simulate(0.2); const near = E.near; O.act(); const measuring = E.measuring > 0; for (let t = 0; t < 12 && E.measuring > 0; t += 0.25) O.simulate(0.25); O.simulate(0.5); const measured = E.measured, reeling = E.reeling; for (let t = 0; t < 40 && O.phase === "eva"; t += 0.25) O.simulate(0.25); return { phase, near, measuring, measured, reeling, after: O.phase, back: E.back, air: E.air, bonus: E.bonus, score: O.score }; })()`);
  // Air stops when the tether reels, so the air left is the air the bonus was paid on: half the walk's worth over a full tank.
  record("orbit flow: Space steps outside, at the rock Space measures it, the tether reels the Ooga home and it climbs back in with the mission done (the stage dropped in orbit counting too, and the air left paying a bonus)", walk.phase === "eva" && walk.near === "rock" && walk.measuring && walk.measured && walk.reeling && walk.after === "orbit" && walk.back && walk.air > 0 && walk.bonus === Math.round(350 * walk.air / 40) && walk.score === top.score + 100 + 700 + walk.bonus, JSON.stringify(walk));
  // The stage dropped at the top falls under the pod; it is gone before the pod is let go.
  const cleared = await b.evaluate(`(() => { const O = window.__ooga.orbit; let t = 0; for (; t < 40 && window.__ooga.stats().debris > 0; t += 0.25) O.simulate(0.25); return { debris: window.__ooga.stats().debris, t }; })()`);
  await b.key(" ");
  const falling = await b.evaluate(`(() => { const O = window.__ooga.orbit, F = window.__ooga.flight, s = F.state, phase = O.phase; for (let t = 0; t < 200 && !F.chuteReady(); t += 0.1) O.simulate(0.1); return { phase, ready: F.chuteReady(), alt: s.alt, peakHeat: s.peakHeat }; })()`);
  await b.key(" ");
  const chute = await b.evaluate(`window.__ooga.flight.state.chute`);
  await b.evaluate(`(() => { const O = window.__ooga.orbit; for (let t = 0; t < 200 && O.phase !== "results"; t += 0.25) O.simulate(0.25); })()`);
  await b.sleep(200);
  const log = await b.evaluate(orbitLog);
  const stored = await b.evaluate(`JSON.parse(localStorage.getItem("oogaboogaland.v1")).orbit.best`);
  record("orbit flow: Space lets go, the pod falls shield first, Space opens the chute once it is ready and it lands softly", cleared.debris === 0 && cleared.t <= 30 && falling.phase === "descent" && falling.ready && falling.alt < 135 && falling.peakHeat < 1 && chute === "open" && log.result && !log.result.failure && log.result.orbit, JSON.stringify({ cleared, falling, chute, result: log.result }));
  record("orbit flow: the flight log shows the total big with its medal and new best, the rows add up to it, and the best is saved", log.phase === "results" && log.shown && log.final === log.result.score && log.points === log.final && log.best === "NEW BEST" && log.medal === log.result.medal?.toUpperCase() && log.rows.some(([label]) => label === "Spacewalk") && !log.rows.some(([label]) => label === "Score") && stored && stored.score === log.final && log.exit === "Exit Game", JSON.stringify({ log, stored }));
  await b.evaluate(`document.querySelector('#orbit-results [data-action="orbit-again"]').click()`);
  await b.sleep(200);
  const again = await b.evaluate(`(() => { const O = window.__ooga.orbit; return { phase: O.phase, score: O.score, results: document.getElementById("orbit-results").hidden, debris: window.__ooga.stats().debris }; })()`);
  record("orbit flow: Fly again counts down the same rocket from a clean pad", again.phase === "count" && again.score === 0 && again.results && again.debris === 0, JSON.stringify(again));
  // A far-land best and a junk-laced build survive a reload; a malformed best does not.
  await b.evaluate(`(() => { const saved = JSON.parse(localStorage.getItem("oogaboogaland.v1")); saved.orbit.best = { score: 900, orbit: true, landing: "land" }; saved.orbit.build = ["pot", "zzz", 4, "leafshield", "gourdpod"]; localStorage.setItem("oogaboogaland.v1", JSON.stringify(saved)); })()`);
  await b.open(orbitPage(src));
  await orbitBooted(b);
  const kept = await b.evaluate(`(() => { const B = window.__ooga; return { best: B.game.state.orbit.best, stack: B.orbit.stack.join(), medal: document.getElementById("orbit-medal").hidden }; })()`);
  await b.evaluate(`(() => { const saved = JSON.parse(localStorage.getItem("oogaboogaland.v1")); saved.orbit.best = { score: "x", orbit: true, landing: "pad" }; localStorage.setItem("oogaboogaland.v1", JSON.stringify(saved)); })()`);
  await b.open(orbitPage(src));
  await orbitBooted(b);
  const dropped = await b.evaluate(`window.__ooga.game.state.orbit.best`);
  record("orbit flow: a far-land best and the known parts of a stored build survive a reload, a malformed best is dropped", kept.best && kept.best.landing === "land" && kept.best.score === 900 && kept.stack === "pot,leafshield,gourdpod" && dropped === null, JSON.stringify({ kept, dropped }));
  await b.evaluate(`document.querySelector('[data-scene="orbit"] [data-action="orbit-launch"]').click()`);
  await b.evaluate(`(() => { const O = window.__ooga.orbit; O.simulate(3.05 + 2.8); O.simulate(3.2); })()`);
  await b.evaluate(`document.querySelector('#orbit-results [data-action="leave"]').click()`);
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const left = await b.evaluate(`({ scene: window.__ooga.scene, hidden: document.getElementById("orbit").hidden })`);
  record("orbit flow: Exit Game on the flight log returns to the island with the Orbit HUD hidden", left.scene === "hub" && left.hidden, JSON.stringify(left));
};

// ---- Selection and the caps ----
// `node test/run.mjs race mine` runs the global unit tier plus those scenes; `full` runs every scene and the
// perf floor; `perf` runs the perf floor alone; `unit` (or nothing) runs only the global tier.
// Eight lanes saturate a 16-core box (measured 2026-09-20); raising it only adds heat.
const SCENES = ["hub", "lab", "race", "drop", "orbit", "mine", "pool", "dsb", "factory", "bifrost", "poker", "arcade", "skee", "hoops", "shy", "claw", "hockey", "billiards", "darts", "pinball", "ride", "invaders", "snake", "pong", "stampede", "flap", "breaker", "dash", "stacker"];
const LANES = Number(process.env.LANES) || 8;
const ARGS = process.argv.slice(2);
for (const a of ARGS) if (!SCENES.includes(a) && !["unit", "portal-unit", "water-baseline", "water-review", "water-unit", "stackchain-review", "stackchain-unit", "dsb-menus-unit", "maxis-unit", "exterior-unit", "rulers-unit", "ink-unit", "big-unit", "perf", "full", "poker-protocol"].includes(a)) throw new Error(`Unknown argument "${a}" (unit | perf | full | poker-protocol | ${SCENES.join(" | ")})`);
const ONLY = process.env.ONLY || ""; // Optional substring within the requested scenes; defaults are unchanged.
const FULL = ARGS.includes("full");
const PICKED = FULL ? SCENES : SCENES.filter((s) => ARGS.includes(s));
const PERF = FULL || ARGS.includes("perf");
const UNIT = !(ARGS.length === 1 && ["perf", "poker-protocol"].includes(ARGS[0]));
const PROTOCOL = FULL || ARGS.includes("poker-protocol");
// What keeps the cruft out: every step says why it exists, or the run does not start.
const WHY = /^(regression|playthrough|rule|contract): \S/;
const SCENE_BUDGET_S = 25;
const tasks = [];
const scene = (id, { query = "", steps, perf = false, opts = {}, label = "", url = null }) => {
  for (const s of steps) if (!WHY.test(s.why || "")) throw new Error(`${id}: step "${s.name}" must say why it exists: "regression: â€¦", "playthrough: â€¦", "rule: â€¦" or "contract: â€¦"`);
  const chosen = !ONLY || (label && label.includes(ONLY)) ? steps : steps.filter(s => s.name.includes(ONLY));
  if (!chosen.length) return;
  tasks.push({ name: perf ? `${id} perf` : opts.mobile ? `${id} phone` : label ? `${id} ${label}` : id, scene: id, perf, run: async () => {
    const t0 = Date.now();
    await fold(url || sceneUrl(id, query), chosen.map((s) => [s.name, s.run, s.open]), opts);
    const took = (Date.now() - t0) / 1000;
    if (took > SCENE_BUDGET_S) console.log(`SLOW ${id} took ${took.toFixed(1)} s against a ${SCENE_BUDGET_S} s budget`);
  } });
};
// contributors.js reads the roster from the character files, which build on math, scene and models.
const CONTRIBUTOR_SOURCES = ["math", "scene", "models", "caves", "characters", "characters.gen", "contributors"];
const contributorActivityChecks = async () => {
  const context = { window: {}, URLSearchParams, location: { search: "" } };
  for (const name of CONTRIBUTOR_SOURCES) runInNewContext(await readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8"), context);
  const r = contributorActivityProbe(context.window.BL.contributors, Date.now());
  record("banana weapon activity: one-hour clank and 24-hour chill boundaries, per-project updates, org snapshots, invalid data, and debug mix", Object.values(r).every(Boolean), JSON.stringify(r));
  const liveContext = { window: {}, URLSearchParams, location: { search: "" } };
  for (const name of [...CONTRIBUTOR_SOURCES, "jumbotron-data"]) runInNewContext(await readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8"), liveContext);
  const live = liveContext.window.BL, generatedAt = Date.parse(live.jumbotronData.meta.generated_at), aliases = Object.fromEntries(live.characters.all().filter((c) => c.github).map((c) => [c.handle, c.github]));
  const byLogin = new Map(live.jumbotronData.contributors.map((entry) => [entry.login.toLowerCase(), entry]));
  const matched = live.contributors.roster.map((entry) => ({ entry, source: byLogin.get((aliases[entry.name] || entry.name).toLowerCase()) })).filter((row) => row.source);
  const accepted = live.contributors.applySnapshot(live.jumbotronData, generatedAt);
  const current = matched.every(({ entry, source }) => entry.lastCommitAt === Date.parse(source.last_seen_at));
  // Schema 3 fans activity onto each repository key: the island uses these to
  // route a worker to the cave of the repo they actually contributed to.
  const loginOf = (entry) => (aliases[entry.name] || entry.name).toLowerCase();
  const perRepo = matched.every(({ entry }) => live.jumbotronData.repos.every((repo) => {
    const row = repo.contributors.find((c) => c.login.toLowerCase() === loginOf(entry));
    return !row || entry.activity.get(`oogaboogax/${repo.name.toLowerCase()}`) === Date.parse(row.last_seen_at);
  }));
  // Data integrity of the committed bake itself: each repo's contributor rows
  // must be that repo's own (aligned with its contributor total), and the
  // sets must genuinely differ between repos â€” identical org-wide copies
  // under every repo would fan bogus activity onto every repository key and
  // mis-route workers for the whole session.
  const blobRepos = live.jumbotronData.repos;
  const aligned = blobRepos.every((repo) => repo.contributors.length === repo.totals.contributors);
  const repoScoped = blobRepos.length < 2 || blobRepos.some((a, i) => blobRepos.slice(i + 1).some((b) =>
    a.contributors.length !== b.contributors.length ||
    a.contributors.some((c) => {
      const other = b.contributors.find((o) => o.login === c.login);
      return other && other.last_seen_at !== c.last_seen_at;
    })));
  record("Oogatron snapshot: matched Oogas take backend last-seen times fanned out per repository, and the baked repo rows are genuinely repo-scoped", matched.length >= 7 && accepted === matched.length && current && perRepo && aligned && repoScoped, JSON.stringify({ matched: matched.map(({ entry, source }) => [entry.name, source.login, source.last_seen_at]), accepted, perRepo, aligned, repoScoped, repoRows: blobRepos.map((repo) => [repo.name, repo.contributors.length, repo.totals.contributors]) }));
  // Every character must join the stats by login, or their Ooga freezes on the
  // baked lastCommit and sleeps in the HQ forever (the DrNeski/itsneski bug).
  // Characters younger than the committed bake are exempt: their login cannot
  // be in it yet, and CI regenerates the bake after each merge.
  const bakedLogins = new Set([
    ...live.jumbotronData.contributors.map((c) => c.login),
    ...Object.values(live.jumbotronData.leaderboards).flat().map((c) => c.login),
    ...live.jumbotronData.repos.flatMap((repo) => [...repo.contributors.map((c) => c.login), ...Object.values(repo.leaderboards).flat().map((c) => c.login)]),
    ...live.jumbotronData.recent.map((c) => c.login)
  ].map((login) => login.toLowerCase()));
  const unjoined = live.characters.all()
    .filter((c) => c.joined * 1e3 <= generatedAt && !bakedLogins.has((c.github || c.handle).toLowerCase()))
    .map((c) => ({ handle: c.handle, joinKey: (c.github || c.handle).toLowerCase() }));
  record("characters: every join key (github || handle) matches a login in the baked Oogatron snapshot, so no Ooga sleeps forever on a mismatch", unjoined.length === 0,
    unjoined.length ? `fix the handle, add github: "<login>" to the character file, or regenerate src/js/jumbotron-data.js: ${JSON.stringify(unjoined)}` : "");
};
// Every file in src/characters/ must register once and build a whole Ooga, so a
// new contributor is covered without editing this suite.
const characterChecks = async () => {
  const context = { window: {}, URLSearchParams, location: { search: "" } };
  for (const name of CONTRIBUTOR_SOURCES) runInNewContext(await readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8"), context);
  const BL = context.window.BL, all = BL.characters.all(), hooks = ["torso", "club", "gear", "skull", "crown", "eyes", "mark", "hatY", "headgear", "extras", "tint"];
  const rows = all.map((c) => {
    const traits = BL.contributors.traitsFor(c.handle), m = BL.models.caveman(traits);
    // A second colourway has to pair every voxel part both ways, heads included,
    // so crew.js changes the whole body and a second change puts it back.
    const parts = ["legL", "legR", "torso", "armL", "armR", "head"].map((key) => m.parts[key].geometry).concat([m.headOpen, m.headClosed]);
    const tint = !c.dress || !c.dress.tint ? !m.tint
      : !!m.tint && parts.every((geo) => m.tint.has(geo) && m.tint.get(m.tint.get(geo)) === geo && m.tint.get(geo).faces.length === geo.faces.length);
    return { handle: c.handle, joined: c.joined > 1.7e9 && c.joined < 4e9, built: m.headOpen.faces.length > 0 && m.headClosed.faces.length > 0 && m.headOpen !== m.headClosed,
      parts: ["legL", "legR", "torso", "armL", "armR", "head", "club", "gun"].every((key) => m.parts[key]), hooks: Object.keys(c.dress || {}).every((key) => hooks.includes(key) && typeof c.dress[key] === "function"),
      tint, voice: !c.voice || typeof c.voice.poke === "string" && Array.isArray(c.voice.idle),
      display: c.display === undefined || typeof c.display === "string" && !!c.display.trim() && c.display.length <= 39 };
  });
  const unique = new Set(all.map((c) => c.handle.toLowerCase())).size === all.length;
  const ordered = all.every((c, i) => !i || all[i - 1].joined <= c.joined);
  record("characters: every src/characters file registers one handle, builds a whole Ooga and uses only known hooks", rows.length === CAST && CAST === BL.contributors.roster.length && unique && ordered && rows.every((r) => r.joined && r.built && r.parts && r.hooks && r.tint && r.voice && r.display), JSON.stringify(rows.filter((r) => !(r.joined && r.built && r.parts && r.hooks && r.tint && r.voice && r.display))));
};
// The mempool.space feed parser in Node: message shapes as the socket sends them, no socket.
const mempoolFeedChecks = async () => {
  const source = await readFile(new URL("../src/js/mempool.js", import.meta.url), "utf8");
  const context = { window: { setTimeout() { return 1; }, clearTimeout() {} } };
  runInNewContext(source, context);
  const feed = context.window.BL.mempool, events = [];
  const unsubscribe = feed.subscribe((e) => events.push(e));
  feed.start();
  const offline = !feed.state.enabled && !feed.state.connected;
  feed.parse(JSON.stringify({ blocks: [{ height: 900000, tx_count: 1 }, { height: 899999, tx_count: 2 }] }));
  const seeded = feed.state.height === 900000 && events.length === 0;
  feed.parse(JSON.stringify({ block: { height: 900001, tx_count: 3210 } }));
  feed.parse(JSON.stringify({ block: { height: 900001, tx_count: 3210 } }));
  feed.parse(JSON.stringify({ block: { height: 899000, tx_count: 5 } }));
  const mined = events.length === 1 && events[0].type === "block" && events[0].height === 900001 && events[0].txCount === 3210 && feed.state.blocks === 1;
  feed.parse(JSON.stringify({ blocks: [{ height: 900002 }] }));
  const tallerTip = events.length === 2 && events[1].type === "block" && events[1].height === 900002 && feed.state.height === 900002;
  let malformedSafe = true;
  try {
    feed.parse("not json");
    feed.parse("null");
    feed.parse("1");
    feed.parse('"text"');
    feed.parse("[]");
  } catch {
    malformedSafe = false;
  }
  // A real push: the socket's total_fee is BTC and leaves as sats; a push without a numeric size is skipped.
  const fees = { fastestFee: 2, halfHourFee: 1, hourFee: 1, economyFee: 1, minimumFee: 1 }, da = { progressPercent: 29.4, difficultyChange: -2.7, remainingBlocks: 1424, remainingTime: 879990704 };
  feed.parse(JSON.stringify({ mempoolInfo: { size: 82378, bytes: 41590000, total_fee: 0.07242375 }, vBytesPerSecond: 2250, fees, da }));
  feed.parse(JSON.stringify({ mempoolInfo: { size: "82378", bytes: 1 }, vBytesPerSecond: 1 }));
  feed.parse(JSON.stringify({ mempoolInfo: { size: 5, bytes: 900 }, vBytesPerSecond: -3, fees: "x" }));
  const stats = events.slice(2);
  const statsRead = stats.length === 2 && stats.every((e) => e.type === "stats") && stats[0].count === 82378 && stats[0].vsize === 41590000 && stats[0].totalFee === 7242375 &&
    stats[0].inflow === 2250 && stats[0].fees.fastestFee === 2 && stats[0].da.remainingBlocks === 1424 && stats[1].inflow === 0 && stats[1].fees === null && stats[1].da === null && feed.state.stats === 2;
  feed.parse(JSON.stringify({ "mempool-blocks": [{ medianFee: 12.5, nTx: 3000 }, { medianFee: 2 }] }));
  feed.parse(JSON.stringify({ "mempool-blocks": [] }));
  const projections = events.slice(4);
  const projection = projections.length === 2 && projections[0].type === "fees" && projections[0].nextFee === 12.5 && projections[0].blocks === 2 && projections[1].nextFee === 0 && projections[1].blocks === 0 && feed.state.nextFee === 0 && feed.state.projectedBlocks === 0;
  unsubscribe();
  feed.emit({ type: "block", height: 1 });
  const unsubscribed = events.length === 6;
  feed.subscribe(() => events.push("after dispose"));
  feed.dispose();
  feed.emit({ type: "block", height: 1 });
  const disposed = events.length === 6 && !feed.state.enabled;
  let retries = 0, constructorSafe = true;
  class BlockedWebSocket {
    constructor() {
      throw new Error("blocked");
    }
  }
  const blockedContext = { WebSocket: BlockedWebSocket, window: { setTimeout() { retries++; return 1; }, clearTimeout() {} } };
  runInNewContext(source, blockedContext);
  try {
    blockedContext.window.BL.mempool.start();
  } catch {
    constructorSafe = false;
  }
  const backedOff = constructorSafe && blockedContext.window.BL.mempool.state.enabled && blockedContext.window.BL.mempool.state.attempts === 1 && retries === 1;
  blockedContext.window.BL.mempool.dispose();
  // A socket that opens: what it asks for, the watchdog on a silent link, and the hidden-tab pause.
  const sockets = [], timers = [];
  class FakeWebSocket {
    constructor() {
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.closed = true;
    }
  }
  const liveContext = { WebSocket: FakeWebSocket, window: { setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} } };
  runInNewContext(source, liveContext);
  const live = liveContext.window.BL.mempool, liveEvents = [];
  live.subscribe((e) => liveEvents.push(e));
  live.start();
  sockets[0].onopen();
  const asked = sockets[0].sent;
  const wants = asked.length === 1 && asked[0].action === "want" && ["blocks", "stats", "mempool-blocks"].every((k) => asked[0].data.includes(k)) && !asked.some((m) => "track-mempool" in m);
  sockets[0].onmessage({ data: JSON.stringify({ blocks: [{ height: 900000 }] }) });
  live.state.lastAt = Date.now() - 30000;
  timers.filter((t) => t.ms === 10000).at(-1).fn();
  const stalled = sockets[0].closed && !live.state.connected && timers.at(-1).ms === 2000;
  timers.at(-1).fn();
  sockets[1].onopen();
  sockets[1].onmessage({ data: JSON.stringify({ blocks: [{ height: 900000 }] }) });
  live.setHidden(true);
  const pending = timers.length;
  const hiddenClosed = sockets[1].closed && !live.state.connected && sockets.length === 2;
  sockets[1].onclose && sockets[1].onclose();
  const heldWhileHidden = timers.length === pending && sockets.length === 2;
  live.setHidden(false);
  sockets[2].onopen();
  sockets[2].onmessage({ data: JSON.stringify({ blocks: [{ height: 900003 }, { height: 900002 }] }) });
  const reseeded = sockets.length === 3 && live.state.height === 900003 && liveEvents.length === 0;
  live.dispose();
  record("mempool feed: the tip list seeds the height silently, a taller block thunders once, duplicates and lower blocks are ignored, a taller tip list counts", offline && seeded && mined && tallerTip, JSON.stringify({ offline, seeded, mined, tallerTip, events }));
  record("mempool feed: each mempoolInfo push is one stats event with the count, vsize, fees in sats and inflow, malformed pushes and messages are skipped, unsubscribe and dispose stop delivery", malformedSafe && statsRead && unsubscribed && disposed, JSON.stringify({ malformedSafe, statsRead, unsubscribed, disposed, stats }));
  record("mempool feed: a projection is one fees event with the next block's median fee, zero for an empty mempool", projection, JSON.stringify(projections));
  record("mempool feed: a WebSocket constructor failure enters bounded retry instead of escaping startup", backedOff, JSON.stringify({ constructorSafe, enabled: blockedContext.window.BL.mempool.state.enabled, attempts: blockedContext.window.BL.mempool.state.attempts, retries }));
  record("mempool feed: the socket wants blocks, stats and projections and never every transaction, a silent link is dropped and redialled, a hidden tab holds no socket and its return reseeds the tip without a block",
    wants && stalled && hiddenClosed && heldWhileHidden && reseeded, JSON.stringify({ wants, stalled, hiddenClosed, heldWhileHidden, reseeded, asked, liveEvents }));
};
// The chain snapshot in Node: real payload shapes from both providers, one code path, no sockets.
const chainSnapshotChecks = async () => {
  const source = await readFile(new URL("../src/js/chain.js", import.meta.url), "utf8"), math = await readFile(new URL("../src/js/math.js", import.meta.url), "utf8");
  const context = { window: { setTimeout() { return 1; }, clearTimeout() {}, BL: { math: null } }, location: { protocol: "https:", search: "" }, document: { visibilityState: "visible" } };
  runInNewContext(math, context);
  runInNewContext(source, context);
  const chain = context.window.BL.chain, s = chain.snapshot;
  // `/mempool` comes back byte-identical from mempool.space and from Esplora, so one reader serves both.
  const backlog = { count: 82783, vsize: 41199227, total_fee: 9242709, fee_histogram: [[6.042857, 50420], [4.227918, 53978], [2.0204725, 60149], [1.0109185, 57072], [0.3063063, 51000]] };
  chain.readBacklog(backlog);
  const ladder = Array.from(s.ladder);
  const read = { count: s.count, deep: s.deep, totalFee: s.totalFee, floor: s.floor, paying: s.paying };
  const descending = ladder.every((v, i, a) => i === 0 || a[i - 1] >= v - 1e-9);
  const normalized = Math.max(...ladder) === 1 && ladder.every((v) => v >= 0 && v <= 1);
  chain.readBacklog({ count: 0, vsize: 0, total_fee: 0, fee_histogram: [] });
  const emptied = s.count === 0 && s.deep === 0 && s.paying === 0 && Array.from(s.ladder).every((v) => v === 0);
  chain.readBacklog(null);
  chain.readBacklog({ fee_histogram: [[NaN, 1], ["x"], null, [1]] });
  const malformedSafe = Number.isFinite(s.deep);
  chain.readBlocks([{ height: 967915, tx_count: 3442, weight: 3993060, size: 1615146, timestamp: 4000 }, { height: 967914, timestamp: 3000 }, { height: 967913, timestamp: 2000 }]);
  const blocks = { height: s.height, tx: s.lastTxCount, pace: s.pace };
  chain.readBlocks([]);
  chain.readBlocks([{ height: 967916, timestamp: 9000 }, { height: 967915, timestamp: 4000 }]);
  const slowed = s.pace;
  // Esplora answers fee targets rather than tiers; the same five readings come out of it.
  chain.readEstimates({ 1: 0.659, 3: 0.659, 6: 0.363, 144: 0.277, 1008: 0.1 });
  const esplora = { fastest: s.fastestFee, hour: s.hourFee, minimum: s.minimumFee, next: s.nextFee };
  chain.readFees([{ medianFee: 12.5, nTx: 3000 }, { medianFee: 2 }]);
  const projected = s.nextFee;
  chain.readFees([]);
  const emptyPool = s.nextFee;
  chain.readFees(undefined);
  const heldOnMissing = s.nextFee;
  // Soak is the paying backlog: 3 MvB at a sat or more pours, while 40 MvB all under a sat stays dry.
  s.payAt = 0;
  chain.readBacklog({ count: 90000, vsize: 43000000, total_fee: 9e6, fee_histogram: [[5, 3000000], [0.3, 40000000]] });
  chain.derive();
  const busy = { paying: s.paying, soak: s.soak };
  s.payAt = Date.now() - 600000;
  chain.readBacklog({ count: 80000, vsize: 40000000, total_fee: 4e6, fee_histogram: [[0.5, 40000000]] });
  const decayed = s.payEma;
  s.payAt = 0;
  chain.readBacklog({ count: 80000, vsize: 40000000, total_fee: 4e6, fee_histogram: [[0.5, 40000000]] });
  chain.derive();
  const quiet = { paying: s.paying, soak: s.soak, deep: s.deep };
  const curves = { dry: chain.paySoak(chain.PAY_DRY), full: chain.paySoak(chain.PAY_FULL), none: chain.paySoak(0), over: chain.paySoak(100) };
  // The socket's stats land in the snapshot and make it live; REST then adds only the histogram.
  s.at = 0;
  const staleBefore = s.live;
  chain.ingest({ type: "stats", count: 83637, vsize: 41875886, totalFee: 8060352, inflow: 3500, fees: { fastestFee: 2, halfHourFee: 1, hourFee: 1, economyFee: 1, minimumFee: 1 }, da: { progressPercent: 29.4, difficultyChange: -2.7, remainingBlocks: 1424, remainingTime: 879990704 } });
  chain.derive();
  const socket = { count: s.count, totalFee: s.totalFee, fastest: s.fastestFee, epoch: s.remainingBlocks, gale: s.gale, live: s.live };
  chain.readBacklog(backlog, true);
  const histogramOnly = s.count === 83637 && Math.abs(s.paying - 0.221619) < 1e-6;
  chain.ingest({ type: "stats", count: 1, vsize: 1, totalFee: 0, inflow: 2250 });
  chain.derive();
  const halfGale = s.gale;
  s.socketAt = Date.now() - 100000;
  chain.derive();
  const staleGale = s.gale;
  // The Coinbase ticker_batch reader: type "ticker", string numbers, other products and control messages ignored.
  const ticker = [
    chain.readTicker({ type: "ticker", product_id: "BTC-USD", price: "85492.7", open_24h: "86016.24" }),
    chain.readTicker({ type: "ticker", product_id: "ETH-USD", price: "3000", open_24h: "3100" }),
    chain.readTicker({ type: "subscriptions", channels: [{ name: "ticker_batch" }] }),
    chain.readTicker({ type: "ticker", product_id: "BTC-USD", price: "x" })
  ];
  const priced = ticker.join() === "true,false,false,false" && s.priceUsd === 85492.7 && s.priceOpenUsd === 86016.24 && s.priceSource === "coinbase live";
  // A pinned provider once threw on start (an assignment to a constant) and took the whole page down.
  const pinnedContext = { window: { setTimeout() { return 1; }, clearTimeout() {}, BL: { math: null } }, fetch: () => new Promise(() => {}), document: { visibilityState: "visible" } };
  runInNewContext(math, pinnedContext);
  runInNewContext(source, pinnedContext);
  let pinnedStarts = true;
  try {
    pinnedContext.window.BL.chain.start({ source: "esplora" });
  } catch {
    pinnedStarts = false;
  }
  const pinned = pinnedStarts && pinnedContext.window.BL.chain.base === chain.ESPLORA && pinnedContext.window.BL.chain.extended === false;
  pinnedContext.window.BL.chain.dispose();
  record("chain snapshot: the shared /mempool payload gives the backlog, its depth, the paying backlog and a normalized descending fee ladder, and empty or malformed histograms leave it sane",
    read.count === 82783 && Math.abs(read.deep - 41.199227) < 1e-6 && read.totalFee === 9242709 && Math.abs(read.floor - 0.3063063) < 1e-6 && Math.abs(read.paying - 0.221619) < 1e-6 && descending && normalized && emptied && malformedSafe,
    JSON.stringify({ read, descending, normalized, emptied, malformedSafe, ladder: ladder.slice(0, 6) }));
  record("chain snapshot: the tip gives height, size and weight, and block pace comes from the timestamps both providers serve",
    blocks.height === 967915 && blocks.tx === 3442 && blocks.pace === 1000 && slowed === 5000,
    JSON.stringify({ blocks, slowed }));
  record("chain snapshot: Esplora fee targets and mempool.space projections both land on the same readings, an empty projection reads as a free mempool and a missing one holds the last",
    Math.abs(esplora.fastest - 0.659) < 1e-9 && Math.abs(esplora.hour - 0.363) < 1e-9 && Math.abs(esplora.minimum - 0.1) < 1e-9 && Math.abs(esplora.next - 0.659) < 1e-9 && projected === 12.5 && emptyPool === 0 && heldOnMissing === 0,
    JSON.stringify({ esplora, projected, emptyPool, heldOnMissing }));
  record("chain snapshot: a paying backlog soaks and the sub-sat pile does not, its average decays by elapsed time, and the curve stays inside its ends",
    Math.abs(busy.paying - 3) < 1e-9 && busy.soak > 0.85 && Math.abs(decayed - 3 * Math.exp(-1)) < 0.01 && quiet.paying === 0 && quiet.soak === 0 && quiet.deep === 40 && curves.dry === 0 && curves.full === 1 && curves.none === 0 && curves.over === 1,
    JSON.stringify({ busy, decayed, quiet, curves }));
  record("chain snapshot: socket stats fill the count, fees and epoch and make the snapshot live, REST then adds only the histogram, and the inflow gales only while the socket is fresh",
    !staleBefore && socket.count === 83637 && socket.totalFee === 8060352 && socket.fastest === 2 && socket.epoch === 1424 && socket.gale === 1 && socket.live && histogramOnly && Math.abs(halfGale - 0.5) < 1e-9 && staleGale === 0,
    JSON.stringify({ staleBefore, socket, histogramOnly, halfGale, staleGale }));
  record("chain snapshot: the Coinbase ticker_batch reader takes BTC-USD's price and 24-hour open from their strings and ignores other products and control messages", priced, JSON.stringify({ ticker, price: s.priceUsd, open: s.priceOpenUsd }));
  record("chain snapshot: a pinned provider starts on it without throwing (regression: an assignment to a constant killed the page)", pinned, JSON.stringify({ pinnedStarts, base: pinnedContext.window.BL.chain.base }));
  await chainFreshnessChecks(source, math);
};
// Rule: retained field values must never become fresh because another feed announced a change.
// Real readers/pollers run with a controlled clock and transports; no provider or Chrome is contacted.
const chainFreshnessChecks = async (source, math) => {
  const fields = ["backlogAt", "feesAt", "heightAt", "priceAt"];
  const fixture = (cached = null) => {
    let now = 1000000, id = 0, stored = cached, mode = "ok";
    const timers = new Map(), requests = [], notices = [];
    const tiers = { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 0, minimumFee: 0 };
    const payload = (url) => {
      if (url.endsWith("/mempool")) return { count: 2, vsize: 100, total_fee: 10, fee_histogram: [[2, 100]] };
      if (url.endsWith("/blocks")) return [{ height: 900000, timestamp: 900 }];
      if (url.endsWith("/fees/recommended")) return tiers;
      if (url.endsWith("/fees/mempool-blocks")) return [{ medianFee: 7 }];
      if (url.endsWith("/fee-estimates")) return { 1: 3, 3: 2, 6: 1, 144: 0, 1008: 0 };
      if (url.includes("/products/BTC-USD/stats")) return { last: "60000", open: "59000" };
      if (url.includes("kraken.com")) return { result: { XXBTZUSD: { c: ["60000"], o: "59000" } } };
      return {};
    };
    const context = {
      Date: class extends Date { static now() { return now; } }, AbortController,
      window: { setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); } },
      document: { visibilityState: "visible" },
      sessionStorage: { getItem: () => stored, setItem(key, value) { stored = value; } },
      fetch: async (url) => {
        requests.push(url);
        if (mode === "pending") return new Promise(() => {});
        const fail = mode === "fail" || mode === "fallback" && url.includes("coinbase.com") || mode === "fees" && (url.includes("/fees/") || url.endsWith("/fee-estimates"));
        return { ok: !fail, status: fail ? 503 : 200, headers: { get: () => "7" }, json: async () => payload(url) };
      }
    };
    runInNewContext(math, context); runInNewContext(source, context);
    const c = context.window.BL.chain, s = c.snapshot;
    const unsubscribe = c.subscribe(value => notices.push({ same: value === s, times: fields.map(k => value[k]) }));
    const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
    const fire = async (ms) => {
      for (const [key, timer] of [...timers]) if (timer.ms === ms) { timers.delete(key); timer.fn(); }
      await flush();
    };
    return { c, s, tiers, requests, notices, unsubscribe, flush, fire, timers, context,
      times: () => fields.map(k => s[k]).join(), advance: () => now += 100000,
      get now() { return now; }, get stored() { return stored; }, set mode(value) { mode = value; } };
  };
  const f = fixture(), { c, s } = f;
  record("chain freshness: all four fields start unknown and module loading starts no network or timers", f.times() === "0,0,0,0" && !f.requests.length && !f.timers.size, f.times());
  c.readBacklog({ count: 0, vsize: 0 });
  const backlog = s.backlogAt === f.now && s.vsize === 0 && !s.feesAt && !s.heightAt && !s.priceAt;
  f.advance(); c.readEstimates({ 1: 3, 3: 2, 6: 1, 144: 0, 1008: 0 });
  const fees = s.feesAt === f.now && s.fastestFee === 3 && s.economyFee === 0;
  f.advance(); c.readBlocks([{ height: 900000, timestamp: 900 }]);
  const height = s.heightAt === f.now && s.lastBlockAt === 900000;
  const held = f.times();
  f.advance(); c.readFees([{ medianFee: 9 }]); c.readDifficulty({ progressPercent: 50 }); c.derive();
  c.readBacklog({ count: 2, vsize: 100 }, true);
  c.readBacklog(null); c.readBlocks([]); c.readEstimates(null);
  record("chain freshness: accepted backlog, recommended fees and tip stamp independently; histogram, projection, difficulty and missing payloads do not refresh them", backlog && fees && height && held === f.times() && s.nextFee === 9, f.times());
  const ticker = { type: "ticker", product_id: "BTC-USD", price: "60000", open_24h: "59000" };
  c.readTicker(ticker); const firstPriceAt = s.priceAt;
  f.advance(); c.readTicker(ticker);
  const unchanged = s.priceAt === f.now && s.priceAt > firstPriceAt && s.priceUsd === 60000 && s.priceSource === "coinbase live";
  const wsTimes = f.times();
  f.advance(); c.readTicker({ ...ticker, price: "bad" }); c.readTicker({ ...ticker, product_id: "ETH-USD" });
  record("chain freshness: unchanged valid WS prices refresh only priceAt; rejected prices retain value and observation", unchanged && wsTimes === f.times(), f.times());
  c.ingest({ type: "stats", count: 2, vsize: 100, fees: f.tiers });
  const stats = s.backlogAt === f.now && s.feesAt === f.now && s.priceAt === firstPriceAt + 100000;
  const statsTimes = f.times();
  f.advance(); c.ingest({ type: "fees", nextFee: 5 }); await f.fire(0);
  const delivered = f.notices.length === 1 && f.notices[0].same && statsTimes === f.times();
  f.unsubscribe(); c.ingest({ type: "fees", nextFee: 6 }); await f.fire(0);
  const unsubscribed = f.notices.length === 1;
  c.ingest({ type: "block", height: 900001, txCount: 3 });
  record("chain freshness: socket stats and blocks stamp their own fields; coalesced notifications preserve snapshot identity and unsubscribe", stats && delivered && unsubscribed && s.heightAt === f.now && s.priceAt === firstPriceAt + 100000, f.times());
  f.advance(); c.ingest({ type: "stats", count: 1, vsize: 1 });
  const missingFeesHeld = s.feesAt === Number(statsTimes.split(",")[1]);
  c.ingest({ type: "stats", count: 1, vsize: NaN, fees: { fastestFee: 2 } });
  record("chain freshness: missing tiers retain their age; partial or invalid replacements are unknown rather than falsely fresh", missingFeesHeld && s.backlogAt === 0 && s.feesAt === 0 && s.vsize === 0 && s.hourFee === 0, f.times());
  c.dispose();

  const r = fixture(); r.c.start(); await r.flush();
  const initial = fields.every(k => r.s[k] === r.now) && r.s.priceSource === "coinbase";
  const chainTimes = r.times().split(",").slice(0, 3).join();
  r.advance(); r.mode = "fallback"; await r.c.pollPrice();
  const fallback = r.s.priceAt === r.now && r.s.priceSource === "kraken" && r.s.priceUsd === 60000 && chainTimes === r.times().split(",").slice(0, 3).join();
  r.advance(); r.mode = "ok"; await r.fire(60000);
  // A REST observation must not suppress the next REST price poll through the private WS timer.
  const restIndependent = r.s.priceAt === r.now && r.s.priceSource === "coinbase";
  record("chain freshness: REST and fallback stamp accepted unchanged prices without changing other fields or suppressing the REST cycle", initial && fallback && restIndependent, r.times());
  const beforeFailure = r.times(), values = [r.s.vsize, r.s.fastestFee, r.s.height, r.s.priceUsd].join();
  r.advance(); r.mode = "fail"; await r.fire(30000); await r.fire(60000);
  record("chain freshness: failed polls retain values and all observation times while Retry-After still controls backoff", beforeFailure === r.times() && values === [r.s.vsize, r.s.fastestFee, r.s.height, r.s.priceUsd].join() && r.c.backoff === 7000, JSON.stringify({ times: r.times(), backoff: r.c.backoff }));
  const feesAt = r.s.feesAt;
  r.advance(); r.mode = "fees"; await r.fire(37000);
  record("chain freshness: successful backlog cannot freshen recommended fees when fee requests fail", r.s.backlogAt === r.now && r.s.feesAt === feesAt && r.s.fastestFee === 3, r.times());
  const cached = fixture(r.stored); cached.mode = "pending"; cached.c.start();
  record("chain freshness: restored values carry no fabricated per-field freshness", cached.s.priceUsd === 60000 && cached.s.height === 900000 && cached.times() === "0,0,0,0", cached.times());
  cached.c.dispose(); r.c.dispose();
};
// Rule: DSB consumes observed chain fields without taking ownership of shared transports.
const dsbSharedDataChecks = async () => {
  let now = 1800000000000, id = 0, sockets = 0, lifecycle = 0, mode = "ok", finish = null;
  const listeners = new Set(), timers = new Map(), requests = [];
  const snapshot = { vsize: 20000000, fastestFee: 8, nextFee: 999, height: 900000, priceUsd: 60400, priceSource: "fixture", backlogAt: now, feesAt: now, heightAt: now, priceAt: now };
  const rows = () => { const minute = Math.floor(now / 60000) * 60; return [[minute-60,59900,60500,60000,60300],[minute,60200,60600,60300,60400]]; };
  const chain = { snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, start() { lifecycle++; }, stop() { lifecycle++; }, dispose() { lifecycle++; } };
  const context = { window: { BL: { chain } }, Date: class extends Date { static now() { return now; } }, AbortController,
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    WebSocket: class { constructor() { sockets++; } },
    fetch: async (url, options) => {
      requests.push({ url, signal: options.signal });
      if (mode === "fail") throw new Error("offline");
      if (mode === "bad") return { ok: true, json: async () => [[1,-1,1,0,0]] };
      if (mode === "pending") return new Promise(resolve => { finish = resolve; });
      return { ok: true, json: async () => rows() };
    }
  };
  runInNewContext(await readFile(new URL("../src/js/dsb-data.js", import.meta.url), "utf8"), context);
  const create = context.window.BL.dsbData.create, d = create(), s = d.state;
  const emit = () => { for (const fn of listeners) fn(snapshot); };
  record("dsb shared data: creation is dormant before land starts it", !requests.length && !listeners.size && !sockets && !timers.size);
  const original = JSON.stringify(snapshot); await d.start(); await d.start();
  record("dsb shared data: one subscription immediately maps shared fields and keeps recommended fees distinct from nextFee", listeners.size === 1 && s.backlog === 0.2 && s.fee === 8 && s.height === 900000 && s.price === 60400 && s.priceFresh && s.backlogFresh && s.feesFresh && s.heightFresh && JSON.stringify(snapshot) === original);
  record("dsb shared data: only the real minute history is requested once, with no live socket or recurring timers", requests.length === 1 && requests[0].url === "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60" && !sockets && !timers.size && s.count === 2 && s.candles[1] === 59900 && s.historyStatus.startsWith("Recent"));
  const priceAt = s.priceAt, revision = s.revision;
  now += 100000; snapshot.heightAt = now; snapshot.height++; emit();
  record("dsb shared data: fresh height cannot refresh stale backlog, fees or price, or fabricate candle ticks", s.heightFresh && !s.backlogFresh && !s.feesFresh && !s.priceFresh && s.priceAt === priceAt && s.lastTickAt === priceAt && s.revision === revision);
  snapshot.priceAt = now; snapshot.priceUsd = 60700; emit();
  const priceFreshOnly = s.priceFresh && !s.feesFresh && !s.backlogFresh && s.price === 60700 && s.revision === revision + 1;
  snapshot.backlogAt = now; snapshot.vsize = 200000000; emit();
  const backlogIndependent = s.backlog === 1 && s.backlogFresh && !s.feesFresh;
  snapshot.feesAt = now; snapshot.fastestFee = 0; emit();
  record("dsb shared data: price, backlog and fee observations propagate independently, including capped backlog and zero fees", priceFreshOnly && backlogIndependent && s.fee === 0 && s.feesFresh);
  now += 180000; d.refresh();
  record("dsb shared data: idle feeds age at the HUD read without a subscription event or any network polling", !s.backlogFresh && !s.feesFresh && !s.heightFresh && !s.priceFresh && requests.length === 1 && s.priceStatus.includes("delayed"));
  snapshot.backlogAt = snapshot.feesAt = snapshot.heightAt = snapshot.priceAt = 0; emit();
  record("dsb shared data: unknown timestamps retain safe presentation values without claiming freshness", s.backlog === 1 && s.price === 60700 && s.height === 900001 && s.priceAt === 0 && s.lastTickAt === 0 && s.priceStatus.includes("unknown") && s.skyStatus.includes("unknown"));
  const frozen = s.price; d.dispose(); snapshot.priceAt = now; snapshot.priceUsd = 61000; emit();
  record("dsb shared data: leaving unsubscribes without touching shared lifecycle or receiving later prices", !listeners.size && lifecycle === 0 && s.price === frozen);
  let visits = true;
  for (let i = 0; i < 3; i++) { const next = create(); await next.start(); await next.start(); visits &&= listeners.size === 1; next.stop(); visits &&= listeners.size === 0; next.dispose(); }
  record("dsb shared data: repeated visits have one listener each and no accumulated sockets, polling or shared lifecycle calls", visits && !listeners.size && !sockets && !timers.size && !lifecycle && requests.length === 4);
  mode = "fail"; const offline = create(); await offline.start();
  record("dsb shared data: history outage retains the shared price, labels demo candles and does not start background retries", offline.state.price === 61000 && offline.state.priceFresh && offline.state.historyStatus.includes("demo candles") && !timers.size);
  offline.dispose(); mode = "bad"; const malformed = create(); await malformed.start();
  record("dsb shared data: malformed OHLC retains bounded demo history without claiming real historical data", malformed.state.historyStatus.includes("demo candles") && malformed.state.count === 48 && malformed.state.candles.length === 240);
  malformed.dispose(); mode = "pending"; const late = create(), waiting = late.start(), signal = requests.at(-1).signal, before = late.state.revision;
  late.dispose(); const cancelled = signal.aborted && !timers.size && !listeners.size;
  finish({ ok: true, json: async () => rows() }); await waiting;
  record("dsb shared data: disposal aborts pending history, clears its timeout and ignores late completion", cancelled && late.state.revision === before);
  // A nosim page has no observed shared values. DSB must not start the service to compensate.
  snapshot.backlogAt = snapshot.feesAt = snapshot.heightAt = snapshot.priceAt = 0;
  mode = "fail"; const unknown = create(); await unknown.start();
  record("dsb shared data: unobserved shared state keeps demo defaults and never enables disabled providers", unknown.state.backlog === 0.35 && unknown.state.fee === 4 && unknown.state.height === 0 && !unknown.state.priceFresh && !lifecycle && !sockets);
  unknown.dispose();
};
// The six rain steps in Node: soak alone picks them, a step holds against a hover on its boundary, and
// the amount that falls is continuous through them.
const weatherStepChecks = async () => {
  const context = { window: { BL: { math: null, models: { cached: (f) => f, noShadow: (g) => g, box: () => ({}), merge: () => ({}), polyline: () => ({}), particleGeometry: () => ({}) }, scene: {} } } };
  runInNewContext(await readFile(new URL("../src/js/math.js", import.meta.url), "utf8"), context);
  runInNewContext(await readFile(new URL("../src/js/weather.js", import.meta.url), "utf8"), context);
  runInNewContext(await readFile(new URL("../src/js/dsb-weather.js", import.meta.url), "utf8"), context);
  const parse = query => context.window.BL.dsbWeather.override(new URLSearchParams(query));
  record("DSB weather override: only known debug presets can replace ordinary chain weather", parse("weather=storm") === null && parse("debug=1&weather=storm") === "storm" && parse("debug=1&weather=NaN") === null && parse("debug=1&weather=__proto__") === null);
  const { STEPS, stepFor, wetAt } = context.window.BL.weather;
  const names = [0, 0.1, 0.25, 0.45, 0.65, 0.85, 1].map((k) => STEPS[stepFor(k)].name);
  const ladder = names.join() === "dry,drizzle,light rain,rain,heavy rain,downpour,downpour";
  const holds = stepFor(0.42, 3) === 3 && stepFor(0.39, 3) === 2 && stepFor(0.46, 2) === 3 && stepFor(0.02, 5) === 0;
  let continuous = true, previous = 0;
  for (let k = 0.1; k <= 1.0001; k += 0.001) {
    const wet = wetAt(k);
    if (wet < previous - 1e-9 || wet - previous > 0.13) continuous = false;
    previous = wet;
  }
  const ends = wetAt(0) === 0 && wetAt(0.0999) === 0 && Math.abs(wetAt(0.1) - 0.12) < 1e-9 && wetAt(0.85) === 1 && wetAt(1) === 1;
  record("weather steps: soak alone names dry through downpour, a step holds against a hover on its boundary, and the rain amount rises continuously",
    ladder && holds && continuous && ends, JSON.stringify({ names, holds, continuous, ends }));
};
const debugActivityStatusChecks = async () => {
  const sources = await Promise.all(CONTRIBUTOR_SOURCES.map((name) => readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8")));
  const rows = [], at = Date.now();
  for (const [query, expected] of [["?debug=1&status=clankin", "working"], ["?debug=1&status=chillin", "chilling"], ["?debug=1&status=sleepin", "sleeping"], ["?status=clankin", null], ["?debug=1&status=unknown", null], ["?debug=1&status=working", null]]) {
    const context = { window: {}, URLSearchParams, location: { search: query } };
    for (const source of sources) runInNewContext(source, context);
    const C = context.window.BL.contributors;
    C.seedDebugActivity(at);
    const before = C.roster.map(entry => C.stateFor(entry, at)), stamp = C.roster[0].lastCommitAt;
    C.applyActivity(C.roster.map(entry => ({ name: entry.name, lastCommitAt: at + 1 })), at + 1);
    rows.push({ query, expected, parsed: C.debugState, before, maintainers: C.roster.map(entry => entry.maintainer),
      after: C.roster.map(entry => C.stateFor(entry, at + 1)), later: C.roster.map(entry => C.stateFor(entry, at + 10 * 86400000)),
      sourceUpdated: C.roster.every(entry => entry.lastCommitAt === at + 1) && stamp === at,
      workEligible: C.roster.every(entry => C.hasRecentActivity(entry, "oogaboogax/entropylab", at + 10 * 86400000)) });
  }
  const load = (search) => {
    const context = { window: {}, URLSearchParams, location: { search } };
    for (const source of sources) runInNewContext(source, context);
    return context.window.BL.contributors;
  };
  const example = "ooga=w-s-bitcoin:clank:lab,obl,lf&ooga=portlandhodl:clank:lab,obl&ooga=DrNeski:clank:lab,lf&ooga=bc1gui:clank:lab&ooga=2140data:clank:obl&ooga=SaniExp:chill&ooga=MrHodlX:chill&ooga=Holo-Elfstone:chill&ooga=Tmmmemcee:chill&ooga=YellowBrokeIt:chill";
  const C = load(`?debug=1&status=sleepin&${example}`), lab = "oogaboogax/entropylab", obl = "oogaboogax/oogaboogaland", lf = "drneski/lightning-foundry";
  C.seedDebugActivity(at);
  const modes = C.roster.map(entry => C.stateFor(entry, at));
  // Neither a maintainer nor a later feed/seed may wake unlisted owners or add work caves.
  const unlisted = C.roster.find(entry => C.stateFor(entry, at) === "sleeping");
  unlisted.maintainer = true;
  C.applyActivity(C.roster.flatMap(entry => [lab, obl].map(repo => ({ name: entry.name, repo, lastCommitAt: at + 1 }))), at + 1);
  C.seedDebugActivity(at + 30 * 86400000);
  const pinned = C.roster.every((entry, i) => C.stateFor(entry, at + 30 * 86400000) === modes[i]);
  const counts = { working: 0, chilling: 0, sleeping: 0, multi: 0 };
  for (const entry of C.roster) {
    counts[C.stateFor(entry, at)]++;
    if ([lab, obl, lf].filter(repo => C.hasRecentActivity(entry, repo, at)).length > 1) counts.multi++;
  }
  const eligible = C.roster.every(entry => {
    const name = entry.name.toLowerCase();
    return C.hasRecentActivity(entry, lab, at) === ["w-s-bitcoin", "portlandhodl", "drneski", "bc1gui"].includes(name)
      && C.hasRecentActivity(entry, obl, at) === ["w-s-bitcoin", "portlandhodl", "2140data"].includes(name)
      && C.hasRecentActivity(entry, lf, at) === ["w-s-bitcoin", "drneski"].includes(name)
      && !C.hasRecentActivity(entry, "oogaboogax/unknown", at);
  });
  const empty = load("?debug=1&ooga="), invalid = load("?debug=1&ooga=w-s-bitcoin:unknown:lab&ooga=bc1gui:clank:missing&ooga=DrNeski:clank&ooga=Holo-Elfstone&ooga=missing:chill");
  const defaults = [empty, invalid].every(c => c.roster.every(entry => c.stateFor(entry, at) === "sleeping" && !c.hasRecentActivity(entry, lab, at)));
  const ignored = load(`?${example}`), alias = load("?debug=1&ooga=OTTOZ0R:clank:c11,oogaboogax/oogaboogaland,c2&ooga=DrNeski:clank:entropylab,c1,drneski/lightning-foundry&ooga=SaniExp:chill&ooga=SaniExp:sleep");
  const aliases = alias.roster.filter(entry => ["bc1gui", "DrNeski"].includes(entry.name)).every(entry => alias.stateFor(entry, at) === "working" && [lab, obl, lf].every(repo => alias.hasRecentActivity(entry, repo, at)))
    && alias.stateFor(alias.roster.find(entry => entry.name === "SaniExp"), at) === "sleeping";
  record("debug activity status URL: valid global and per-owner modes remain pinned across refreshes and elapsed time, with unlisted owners sleeping", pinned && defaults && aliases && !ignored.debugRoster && counts.working === 5 && counts.chilling === 5 && counts.sleeping === C.roster.length - 10 && rows.every(row => row.parsed === row.expected && (row.expected ? [...row.before, ...row.after, ...row.later].every(state => state === row.expected) : new Set(row.before).size === 3 && row.after.every(state => state === "working") && row.later.every((state, i) => state === (row.maintainers[i] ? "working" : "sleeping")))), JSON.stringify({ rows, counts, pinned, defaults, aliases }));
  record("debug activity status URL: source timestamps still refresh, global clankin stays eligible for EntropyLab, and explicit workers visit only their listed repos", eligible && counts.multi === 3 && rows.every(row => row.sourceUpdated && row.workEligible === (row.expected === "working")), JSON.stringify({ rows, counts, eligible }));
};
const soloDebugChecks = async () => {
  const sources = await Promise.all(CONTRIBUTOR_SOURCES.map((name) => readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8")));
  const r = soloDebugParsingProbe((search) => {
    const context = { window: {}, URLSearchParams, location: { search } };
    for (const source of sources) runInNewContext(source, context);
    return context.window.BL.contributors;
  });
  record("solo debug URL: flags require debug and exact known handles with case and whitespace normalization", r.flags && r.rows.length === 14, JSON.stringify(r.rows));
  record("solo debug URL: filtered activity references retain the complete canonical roster across refreshes", r.preserved && r.canonical.length === CAST, JSON.stringify(r));
};
const labLanes = async (b) => {
  for (const dt of RATES) {
  const r = await b.evaluate(`(${npcLabLaneProbe.toString()})(${JSON.stringify({ dt })})`);
  record(`work movement lab lanes: ${1 / dt}Hz outbound and returning characters keep to their actual facing-right side`, r.rows.length === 2 && r.rows.every((row) => row.arrived && row.samples > 0 && row.minimumRight > 0 && row.minimumFacingRight > 0 && row.laneError < 0.05 && row.maximumHop === 0 && row.maximumStep <= 2.8 * dt + 1e-6), JSON.stringify(r));
  }

};
const workCaveTrips = async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, scene = BL.scenes.hub, dt = 1 / 20;
    const update = scene.update; scene.update = () => {}; B.pilot.release(true); B.setPileLevel(100000);
    const actors = B.crew.list.filter(c => c.state === "working");
    const rows = actors.map(c => ({ name: c.contributor.name, outbound: [0, 0, 0], returned: [0, 0, 0],
      phase: "", stall: 0, maximumStall: 0, maximumStep: 0, missingRoutes: 0,
      resets: c.progress.resets, jumps: c.avoidance.navigation.jumps }));
    let time = B.renderOpts.matrix.time, frames = 0;
    try {
      for (; frames < 6000; frames++) {
        for (let i = 0; i < actors.length; i++) {
          const c = actors[i], row = rows[i], p = c.root.position;
          if (c.work.phase === "shoot" && row.phase !== "shoot") {
            row.outbound[c.work.site]++;
            // Shorten shooting, leaving outbound, return, reload and the
            // companion handoff on the actual scene update path.
            c.weapon.ammo = 0; c.weapon.spareAmmo.fill(0);
            c.work.emptyTime = 0.5; c.work.rest = 0; c.work.plannedSite = -1;
          }
          if (c.work.phase === "reload" && row.phase !== "reload") row.returned[c.work.site]++;
          row.phase = c.work.phase; row.x = p.x; row.z = p.z;
        }
        update(dt, time += dt); S.updateWorld(scene.root);
        for (let i = 0; i < actors.length; i++) {
          const c = actors[i], row = rows[i], p = c.root.position, step = Math.hypot(p.x - row.x, p.z - row.z);
          const moving = c.work.phase === "outbound" || c.work.phase === "station" || c.work.phase === "return";
          row.stall = moving && step < 0.001 ? row.stall + dt : 0;
          row.maximumStall = Math.max(row.maximumStall, row.stall); row.maximumStep = Math.max(row.maximumStep, step);
          const approach = B.crew.workSites[c.work.site].route.at(-1);
          const followsPath = c.work.phase === "outbound" && Math.hypot(p.x - approach.x, p.z - approach.z) > 3
            || c.work.phase === "return" && c.work.index < 0 && !c.pileApproach
              && Math.hypot(p.x, p.z) > B.island.path.debug.ringLoadingRadius + 2;
          if (followsPath && !c.work.direct && !c.hop && !c.bedTravel.mode
            && Math.abs(p.y - c.baseY) < 0.1 && c.pathing.count < 2) row.missingRoutes++;
        }
        if (rows.every(row => row.returned.every(count => count >= 2))) break;
      }
      for (let i = 0; i < actors.length; i++) {
        rows[i].resets = actors[i].progress.resets - rows[i].resets;
        rows[i].jumps = actors[i].avoidance.navigation.jumps - rows[i].jumps;
      }
      return { frames, rows, sites: B.crew.workSites.map(site => site.repo) };
    } finally { scene.update = update; }
  })()`);
  record("work movement cave trips: five workers retain path routes and finish repeated trips to lab, OBL and LF without stuck loops, jumps or relocation",
    r.sites.length === 3 && r.rows.length === 5 && r.rows.every(row => row.outbound.every(n => n >= 2)
      && row.returned.every(n => n >= 2) && row.maximumStall < 5 && row.maximumStep <= 2.8 / 20 + 1e-6
      && row.missingRoutes === 0 && row.resets === 0 && row.jumps === 0), JSON.stringify(r));
  const rejoin = await b.evaluate(`(() => {
    const island = { path: { version: 0, debug: { active: false, ringCenterRadius: 0 }, centerlines: [[{ x: 0, z: 0 }, { x: 0, z: 10 }]] }, surfaceAt: () => 0, isPath: () => true };
    const clear = (x, z, tx, tz) => {
      const dx = tx - x, dz = tz - z, length = dx * dx + dz * dz;
      const t = length ? Math.max(0, Math.min(1, -(x * dx + (z - 4.2) * dz) / length)) : 0;
      return Math.hypot(x + dx * t, z + dz * t - 4.2) >= 0.25;
    };
    const nav = BL.npcPaths.create({ island, walkable: clear });
    const cave = { root: { position: { x: 0.3, y: 0, z: 3.8 } }, baseY: 0, bodyHeight: 1.7, bedTravel: { mode: "" }, pathing: nav.createState() };
    const p = cave.root.position; let blocked = 0, backwards = 0, maximumStep = 0;
    for (let n = 0; n < 200 && Math.hypot(p.x, p.z - 10) >= 0.12; n++) {
      nav.target(cave, 0, 10);
      const dx = cave.pathing.targetX - p.x, dz = cave.pathing.targetZ - p.z, distance = Math.hypot(dx, dz);
      if (distance < 1e-8) break;
      const step = Math.min(2.8 / 20, distance), x = p.x + dx * step / distance, z = p.z + dz * step / distance;
      if (!clear(p.x, p.z, x, z)) { blocked++; break; }
      if (z < p.z - 1e-7) backwards++;
      maximumStep = Math.max(maximumStep, step); p.x = x; p.z = z;
    }
    return { blocked, backwards, maximumStep, arrived: Math.hypot(p.x, p.z - 10) < 0.12 };
  })()`);
  record("work movement cave trips: a displaced walker rejoins its lane around a post instead of cutting into it or reversing",
    rejoin.arrived && rejoin.blocked === 0 && rejoin.backwards === 0 && rejoin.maximumStep <= 2.8 / 20 + 1e-6, JSON.stringify(rejoin));
  const all = await b.evaluate(`(${npcCenterlineProbe.toString()})()`);
  record("work movement cave trips: every surface trail connects to the ring and completes in both directions, including LF and Mine above buried HQ ramps",
    all.rows.length === all.lines * 2 && all.rows.some(row => row.line === 4 && row.pathLength > 12) && all.rows.some(row => row.line === 1 && row.pathLength > 12)
      && all.rows.every(row => row.connected && row.arrived && row.onPath > 0.95 && row.error < 0.45), JSON.stringify(all));
};
const npcPaths = (backend) => [`NPC paths ${backend}`, async (b) => {
  const rows = await b.evaluate(`(${npcPathWalkingProbe.toString()})()`);
  record(`NPC paths ${backend}: prefer connected trails, pass other Oogas, replan changed paths and reach off-path fireplace seats`, rows.length === 5 && rows.slice(0, 4).every((r) => r.arrived && r.distance < 1e-6 && r.stable && r.maximumStep <= 1.7 / 30 + 1e-6 && r.count > 0) && rows[0].onPath > 0.95 && rows[1].onPath > 0.65 && rows[1].separation >= 0.68 && rows[2].changed && rows[2].replans > 0 && rows[3].onPath < 0.95, JSON.stringify(rows.slice(0, 4)));
  const recovery = rows[4];
  record(`NPC paths ${backend}: the widened ring keeps smooth passing traffic in its outer lane and loading slots in its inner lane`, rows[0].ringWidth === 2.25 && rows[0].outerTraffic && rows[0].innerLoading && rows[0].laneSamples > 0 && rows[0].laneError < 0.05 && rows[0].maximumTurn < 0.1, JSON.stringify(rows[0]));
  record(`NPC paths ${backend}: blocked-trail recovery can jump onto its obstacle without path hints canceling flight`, recovery.recovered && recovery.jumps > 0 && recovery.intersections === 0 && recovery.stable && recovery.maximumStep <= 3 / 30 + 1e-6, JSON.stringify(recovery));
}];

// The games' rules and saves in Node, under the same localStorage the page uses: the mine's seeded sim,
// every game's stored best, the tickets a machine spends and the jackpot wheel's odds.
const GAME_SOURCES = ["math", "donations", "rocket-parts", "mine-rigs", "mine-sim", "game"];
const gameRulesChecks = async () => {
  const store = new Map();
  const context = { window: {}, URLSearchParams, location: { search: "" }, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  for (const name of GAME_SOURCES) runInNewContext(await readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8"), context);
  const BL = context.window.BL, M = BL.mineSim, R = BL.mineRigs;
  {
    const run = () => { const sim = M.create({ seed: 42 }); sim.place(R.GPU); return sim; };
    const a = run(), whole = run();
    a.simulate(300);
    M.save(a, "tester");
    const b = M.load();
    a.simulate(300); b.sim.simulate(300); whole.simulate(600);
    const [sa, sb, sw] = [a, b.sim, whole].map((sim) => JSON.stringify(sim.snapshot()));
    record("mine sim: a seeded run repeats exactly, and a saved run resumes where it stopped", sa === sw && sa === sb && b.lead === "tester", JSON.stringify({ resumed: sa === sb, repeated: sa === sw }));
    const s = a.state, mined = s.minedSats, held = s.sats + s.sold === s.minedSats;
    a.sellSats(0.5);
    const sold = s.sold > 0 && s.sats + s.sold === s.minedSats;
    a.end();
    record("mine sim: coin mined is always coin held plus coin sold, and leaving ends the run scored and unsaveable", mined > 0 && held && sold && s.over && s.reason === "left" && Number.isFinite(s.score) && s.score >= 0, JSON.stringify({ mined, sats: s.sats, sold: s.sold, score: s.score }));
    M.clear();
  }
  {
    const make = () => BL.game.create({ catalog: [] }), g = make();
    const bests = {
      race: [g.recordRace("bay", 30000, 100000, "silver"), !g.recordRace("bay", 31000, 101000, "bronze")],
      cup: [g.recordCup(2, 20), !g.recordCup(3, 30)],
      drop: [!g.recordDrop({ score: 0, rings: 0, ringTotal: 8, landing: "lost" }), !g.recordDrop({ score: 750, rings: 6, ringTotal: 8, landing: "pancake" }), g.recordDrop({ score: 900, rings: 5, ringTotal: 8, landing: "stand" }), !g.recordDrop({ score: 800, rings: 8, ringTotal: 8, landing: "stand" }), !g.recordDrop({ score: 5000, rings: 8, ringTotal: 8, landing: "tumble" })],
      orbit: [g.recordOrbit({ score: 1500, orbit: true, landing: "pad" }), !g.recordOrbit({ score: 1400, orbit: true, landing: "sea" })],
      mine: [g.recordMine({ sats: 5e8, seconds: 1200, ending: "left", won: false, score: 500, continued: false }), !g.recordMine({ sats: 1e8, seconds: 900, ending: "time", won: false, score: 100, continued: false })]
    };
    const again = make().state;
    const kept = again.race.best.bay.race === 100000 && again.race.best.bay.medal === "silver" && again.race.cup.medal === "silver" && again.drop.best.score === 900 && again.orbit.best.score === 1500 && again.mine.best.score === 500;
    const saved = JSON.parse(store.get("oogaboogaland.v1"));
    saved.mine.best.ending = "exploded"; saved.drop.best.landing = "pancake"; saved.race.best.bay.lap = "fast";
    store.set("oogaboogaland.v1", JSON.stringify(saved));
    const bad = make().state, dropped = bad.mine.best === null && bad.drop.best === null && !bad.race.best.bay && bad.orbit.best.score === 1500;
    store.set("oogaboogaland.v1", "{not json");
    const junk = make().state.orbit.best === null;
    record("saves: every game's best survives a reload, a worse result or a crash landing never replaces it, and a malformed best, a stored crash or a broken file is dropped alone", Object.values(bests).flat().every(Boolean) && kept && dropped && junk, JSON.stringify({ bests, kept, dropped, junk }));
    // Tickets spent at a machine (the jackpot wheel): refused, spending nothing, when they fall short or the cost is
    // no whole number above nothing; a spend that goes through is saved.
    const wallet = make();
    wallet.addTickets(19);
    const short = !wallet.spendTickets(20) && wallet.state.arcade.tickets === 19;
    const malformed = [0, -5, 2.5, NaN, "20"].every((n) => !wallet.spendTickets(n)) && wallet.state.arcade.tickets === 19;
    wallet.addTickets(1);
    const spent = wallet.spendTickets(20) && wallet.state.arcade.tickets === 0 && make().state.arcade.tickets === 0;
    record("tickets: a spend refuses when the tickets fall short or the cost is no whole number above nothing, spending nothing, and one that goes through is saved", short && malformed && spent, JSON.stringify({ short, malformed, spent }));
  }
  {
    // The jackpot wheel, from arcade-models.js on the builders it loads with: the house wins slowly, and every
    // wedge, from a turn at rest and one far round after many spins, stops under the clapper wherever in it the spin
    // aims, after its whole turns and less than one more.
    for (const name of ["scene", "models", "jumbotron", "hub-models", "arcade-models"]) runInNewContext(await readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8"), context);
    const { WHEEL_VALUES: V, WHEEL_COST: cost, wheelAt, wheelStop } = BL.arcadeModels;
    const ev = V.reduce((s, v) => s + v, 0) / V.length, jackpot = Math.max(...V), missed = [];
    for (const from of [0, -0.3, -1234.567]) for (let k = 0; k < V.length; k++) for (const at of [0.2, 0.5, 0.8]) {
      const to = wheelStop(from, k, at, 3), turns = (from - to) / (Math.PI * 2);
      if (wheelAt(to) !== k || turns < 3 || turns >= 4) missed.push({ from, k, at, got: wheelAt(to), turns });
    }
    record("jackpot wheel: a spin pays back 75 to 90% of its cost on average, the jackpot is ten spins' worth, and every wedge stops under the clapper wherever the spin aims in it", V.length === 20 && ev >= cost * 0.75 && ev <= cost * 0.9 && jackpot >= cost * 10 && missed.length === 0, JSON.stringify({ ev, cost, jackpot, missed: missed.slice(0, 4) }));
  }
};
const wallPerformance = async (b) => {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  await b.focus(true);
  for (const covered of [false, true]) {
    const r = await b.evaluate(`(async () => {
      const B = window.__ooga, actor = B.cavemen.get("portlandhodl");
      B.renderer.setQuality("high");
      if (B.crew.player !== actor) B.pilot.possess(actor);
      B.pilot.navigate({ position: { x: 10, y: B.island.surfaceAt(10, 0), z: 0 }, yaw: 0, pitch: 0.4, dist: ${covered ? 55 : 10} });
      const start = performance.now(), first = B.renderedFrames, p = actor.root.position, originX = p.x, originZ = p.z, frames = [];
      let previous = start, held = "", outlined = 0, travel = 0, donated = false, particles = 0;
      const scene = window.BL.scenes.hub, update = scene.update, overlay = scene.overlay, render = B.renderer.render;
      let updateMs = 0, overlayMs = 0, renderMs = 0, wall = start, worst = null;
      scene.update = function(...args) {
        const t = performance.now();
        try {
          const result = update.apply(this, args);
          // Keep the stress pass behind actual island rock. The old orbit drag
          // no longer reaches this view after the shoulder-camera handoff was
          // tightened, so it silently measured the clear-view fast path.
          if (${covered}) {
            Object.assign(B.camera.position, { x: 0, y: 0, z: 10 });
            Object.assign(B.camera.target, { x: p.x, y: p.y + 0.7, z: p.z });
          }
          return result;
        } finally { updateMs = performance.now() - t; }
      };
      scene.overlay = function(...args) { const t = performance.now(); try { return overlay.apply(this, args); } finally { overlayMs = performance.now() - t; } };
      B.renderer.render = function(...args) { const t = performance.now(); try { return render.apply(this, args); } finally { renderMs = performance.now() - t; } };
      const key = (name, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name }));
      try {
        await new Promise(resolve => {
          const tick = now => {
            frames.push(now - previous); previous = now;
            const completed = performance.now(), gap = completed - wall; wall = completed;
            if (!worst || gap > worst.gap) worst = { gap, at: now - start, updateMs, renderMs, overlayMs, donated };
            if (B.headquarters.sightGuides.objectsEnabled) outlined++;
            travel = Math.max(travel, Math.hypot(p.x - originX, p.z - originZ));
            const next = Math.floor((now - start) / 420) % 2 ? "a" : "d";
            if (next !== held) { if (held) key(held, false); key(next, true); held = next; }
            if (${covered} && !donated && now - start >= 1000) { B.demoTip(1200); donated = true; particles = B.stats().particles; }
            if (now - start < 5000) requestAnimationFrame(tick); else resolve();
          };
          requestAnimationFrame(tick);
        });
      } finally { if (held) key(held, false); scene.update = update; scene.overlay = overlay; B.renderer.render = render; }
      frames.sort((a, b) => a - b);
      return { fps: (B.renderedFrames - first) * 1000 / (previous - start), p95: frames[Math.floor(frames.length * 0.95)], max: frames.at(-1), worst, outlined, samples: frames.length, travel, donated, particles, quality: B.renderer.quality };
    })()`);
    record(`wall movement performance: ${covered ? "moving behind cave walls during a donation" : "ordinary movement"} stays responsive at a high-density desktop size`, r.quality === "high" && r.fps >= 55 && r.p95 < 25 && r.max < 50 && r.worst.gap < 50 && r.travel > 1 && (covered ? r.outlined > r.samples * 0.9 && r.donated && r.particles >= 26 : r.outlined === 0), JSON.stringify(r));
  }
};
const adaptiveQualityChecks = async () => {
  const r = autoQualityProbe();
  record("adaptive quality: a GPU-bound machine is seen through delivered frames and loses a tier within two seconds", r.healthy && r.gpuBound && r.reactsFast, JSON.stringify(r));
  record("adaptive quality: warmup, transitions, background frames and isolated spikes do not lower quality", r.warmup && r.ignoresPauses && r.ignoresSpikes && r.fallback, JSON.stringify(r));
  record("adaptive quality: steps one tier at a time and stops at the lowest", r.bounded, JSON.stringify(r));
  record("adaptive quality: boot cost seeds the opening tier, only ever downward", r.bootFast && r.bootMedium && r.bootLow && r.bootOneWay && r.bootKeepsCoarse, JSON.stringify(r));
};
// ---- Scenes ----
// A scene is the unit of testing: one Chrome session running that scene's steps, side by side with the
// other picked scenes. Every step says why it exists; a step with `open` is a known, unfixed bug whose
// failure prints OPEN and does not fail the run.
const sceneUrl = (id, query = "") => `${src}?debug=1&nosim=1${id === "hub" ? "" : `&scene=${id}`}${process.env.TEST_CANVAS2D==="1"?"&canvas2d=1":""}${clock(query)}`;
const tourGo = (b, id) => b.evaluate(`(() => { const B = window.__ooga; B.go("${id}"); for (let i = 0; i < 150 && (B.transitioning || B.scene !== "${id}"); i++) B.advance(1 / 30, 1 / 30); B.advance(0.3, 1 / 30); B.housekeep(); const s = B.stats(); return { scene: B.scene, records: B.renderer.stats.records, nodes: s.allNodes, targets: s.targets, dom: s.dom }; })()`);
// Away and back twice. The director's ?debug=1 leave contract throws inside advance on a broken leave,
// and the second visit may hold no more GPU records, nodes, input targets or DOM than the first.
const trip = (id) => ({ name: `${id} round trip`, why: "contract: a scene left and entered again keeps nothing from the last visit, and takes a donation whenever one arrives", run: async (b) => {
  const away = id === "hub" ? "lab" : "hub", laps = [];
  for (let i = 0; i < 2; i++) {
    await tourGo(b, away);
    laps.push(await tourGo(b, id));
  }
  if (laps.some((l) => l.scene !== id)) throw new Error(`go("${id}") landed on ${laps.map((l) => l.scene).join()}`);
  const grew = ["records", "nodes", "targets", "dom"].filter((k) => laps[1][k] > laps[0][k] * 1.02 + 4);
  // A payment can arrive in any scene: the director hands it to the active one exactly like this.
  const donated = await b.evaluate(`(() => { const B = window.__ooga; window.BL.scenes[B.scene].onDonation({ id: "trip-${id}", sats: 2100, handle: "tester", message: "ooga", at: Date.now() }); B.advance(1, 1 / 30); return B.scene; })()`);
  record(`${id} round trip: leaving and entering twice keeps the leave contract and holds nothing the first visit did not, and a donation mid-visit is taken`, grew.length === 0 && donated === id, JSON.stringify({ grew, donated, first: laps[0], second: laps[1] }));
} });
const play = (id, what, code) => ({ name: `${id} playthrough`, why: "playthrough: the game reaches its result, shown and saved", run: async (b) => {
  const r = await b.evaluate(code);
  record(`${id} playthrough: ${what}`, r.ok, JSON.stringify(r));
} });
const donation = (id) => ({ name: `${id} donation`, why: "playthrough: a donation becomes bananas on the pile", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, s0 = B.stats().dropsLanded, d0 = B.game.state.donations; B.demoTip(4000); B.advance(6, 1 / 30); const landed = B.stats().dropsLanded - s0; return { ok: landed === window.BL.game.bananasFor(4000) && B.game.state.donations === d0 + 1, landed }; })()`);
  record(`${id} donation: a 4000 sat donation is counted and lands its bananas on the pile`, r.ok, JSON.stringify(r));
} });
// Every track of the cup under the autopilot: all racers finish in order, the points and the cup medal
// are the standings', and every track keeps a best. Ties share a place, so the saved medal may be any of theirs.
const cupRun = `(() => { const B = window.__ooga, R = B.race, T = window.BL.raceTrack.TRACKS, rounds = []; R.startCup(); for (let i = 0; i < T.length; i++) { if (i) R.nextRace(); const P = B.racers; P.start(); P.autopilot = true; R.simulate(300); P.autopilot = false; rounds.push({ track: R.selection.track, all: P.order.every((r) => r.finished), ranked: P.order.every((r, k) => r.rank === k + 1 && (!k || P.order[k - 1].finishTime <= r.finishTime)) }); R.finishRace(); } const pts = Array.from(R.cup.points), you = pts[B.racers.player.index], lo = pts.filter((p) => p > you).length + 1, hi = pts.filter((p) => p >= you).length, stored = B.game.state.race.cup, place = stored ? ["gold", "silver", "bronze"].indexOf(stored.medal) + 1 : 0; const saved = stored ? stored.points === you && place >= lo && place <= hi : hi > 3; return { ok: R.cup.done && R.phase === "finished" && rounds.every((r) => r.all && r.ranked) && saved && T.every((t) => B.game.state.race.best[t.id]), rounds, you, lo, hi, stored }; })()`;
// The diver starts 40 up and 56 back along its heading from the target; its glide carries it onto it.
const dropRun = `(() => { const B = window.__ooga, D = B.drop; D.jumpNow(); const T = B.course.target, d = B.diver.state, h = Math.atan2(T.x, T.z); B.diver.place(T.x - Math.sin(h) * 56, T.y + 40, T.z - Math.cos(h) * 56, h); B.diver.jump(0, 0, 0, h); let pulled = false; for (let t = 0; t < 120 && D.phase !== "results"; t += 0.25) { if (!pulled && D.phase === "air" && d.p.y < T.y + 75) { D.deploy(); pulled = true; } D.simulate(0.25); } const r = D.result, best = B.game.state.drop.best; return { ok: D.phase === "results" && !!r && r.score > 0 && r.medal === window.BL.dropHud.medalFor(r.score) && !!best && best.score === r.score, phase: D.phase, result: r && { score: r.score, landing: r.landing, medal: r.medal } }; })()`;
// Eight GPU rigs for two minutes, out to the island mid-run and a reload: the run comes back as saved and
// then finishes to its results, score shown and kept as the best, the run's save cleared.
const mineResume = { name: "mine save and finish", why: "playthrough: a mine run survives leaving and a reload, then finishes to its results", run: async (b) => {
  // The page seeds the mine's dice from the clock, and some seeds roll an early rug pull that pays nothing;
  // a saved run with a fixed seed is loaded exactly as a player's save is, so every run rolls the same.
  await b.evaluate(`(() => { const sim = window.BL.mineSim.create({ seed: 7 }); sim.simulate(1); window.BL.mineSim.save(sim, ""); })()`);
  await b.open(sceneUrl("mine"));
  await untilReady(b);
  const bought = await b.evaluate(`(() => { const M = window.__ooga.mine; if (M.phase !== "run") M.start(); M.setBananas(1e5); let n = 0; while (n < 8 && M.buy("m1", -1)) n++; M.simulate(120); return n; })()`);
  await tourGo(b, "hub");
  const saved = await b.evaluate(`(() => { const raw = localStorage.getItem("oogaboogaland.mine"), s = raw && JSON.parse(raw).state; return s && { time: s.time, mined: s.minedSats, unit: JSON.stringify(s.unit) }; })()`);
  await b.open(sceneUrl("mine"));
  await untilReady(b);
  const resumed = await b.evaluate(`(() => { const s = window.__ooga.mine.state; return { phase: window.__ooga.mine.phase, time: s.time, mined: s.minedSats, unit: JSON.stringify(Array.from(s.unit)) }; })()`);
  record("mine save: a run left mid-way is saved and a reload resumes it where it stood", bought === 8 && !!saved && resumed.phase === "run" && resumed.unit === saved.unit && resumed.time >= saved.time && resumed.time < saved.time + 10 && resumed.mined >= saved.mined, JSON.stringify({ bought, saved: saved && { time: saved.time, mined: saved.mined }, resumed: { phase: resumed.phase, time: resumed.time, mined: resumed.mined } }));
  const r = await b.evaluate(`(() => { const B = window.__ooga, M = B.mine, s = M.state; M.sim.end(); M.simulate(0.25); const shown = +document.getElementById("mine-final-score").textContent.replace(/[^0-9]/g, ""), best = B.game.state.mine.best; return { ok: s.minedSats > 0 && M.phase === "results" && shown === s.score && !!best && best.score === s.score && localStorage.getItem("oogaboogaland.mine") === null, phase: M.phase, mined: s.minedSats, shown, score: s.score }; })()`);
  // The score counts whole hundredths of a coin, so a short run may score 0; what is proven is that coin was
  // mined and the score shown is the run's own.
  record("mine playthrough: the resumed run finishes to its results with the score shown, kept as the best and its save cleared", r.ok, JSON.stringify(r));
} };

// Steering is measured on screen, never derived: A/D shipped mirrored in the rally and Q/E in the drop,
// and the canopy once turned Q right while freefall was correct. Each key is held through the real
// keyboard listener for fixed frames and its drift projected on the camera's screen-right, relative to
// the same run with no key. `ev` holds a key the way the page hears it.
const EV = `const ev = (t, k) => window.dispatchEvent(new KeyboardEvent(t, { key: k }));`;
const raceSteer = (keys) => `(() => { const B = window.__ooga, R = B.race; ${EV} const out = {};
  for (const k of [null, ...${JSON.stringify(keys)}]) {
    R.startRace(); B.advance(3.6, 1 / 60); ev("keydown", "w"); B.advance(1.2, 1 / 60);
    const p = B.racers.player, h0 = p.heading, x0 = p.x, z0 = p.z, fx = Math.sin(h0), fz = Math.cos(h0);
    if (k) ev("keydown", k); B.advance(0.5, 1 / 60); if (k) ev("keyup", k); ev("keyup", "w");
    const along = (p.x - x0) * fx + (p.z - z0) * fz, sp = B.project(p.x, p.y + 0.5, p.z, {}), ss = B.project(x0 + fx * along, p.y + 0.5, z0 + fz * along, {});
    out[k || "none"] = +(sp.x - ss.x).toFixed(1);
  }
  return out; })()`;
const raceStart = { name: "race start and steering", why: "regression: A and D steered the kart the wrong way on screen", run: async (b) => {
  const st = () => b.evaluate(`({ phase: window.__ooga.race.phase, card: !document.querySelector('[data-intro="race"]').hidden })`);
  const fresh = await st();
  await b.key("Enter");
  const closed = await st();
  await b.key("Enter");
  const counting = await st();
  await b.evaluate(`window.__ooga.advance(3.6, 1 / 60)`);
  const racing = await st();
  const px = await b.evaluate(raceSteer(["a", "d", "ArrowLeft", "ArrowRight"]));
  record("race start and steering: Enter closes the title card, Enter starts the countdown into the race, and A, D and the arrows steer left and right on screen", fresh.card && fresh.phase === "garage" && !closed.card && closed.phase === "garage" && counting.phase === "countdown" && racing.phase === "racing" && px.none === 0 && px.a < -50 && px.ArrowLeft < -50 && px.d > 50 && px.ArrowRight > 50, JSON.stringify({ fresh, closed, counting, racing, px }));
} };
const racePause = { name: "race pause", why: "rule: Escape pauses the race and nothing moves until it is pressed again", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga; ${EV} B.race.startRace(); B.advance(3.6, 1 / 60); ev("keydown", "w"); B.advance(1, 1 / 60); })()`);
  await b.key("Escape");
  const held = await b.evaluate(`(() => { const B = window.__ooga, P = B.racers, pos = () => P.racers.map((r) => [r.x, r.z]); const a = pos(), t = P.raceTime, phase = B.race.phase, panel = !document.getElementById("race-pause").hidden; B.advance(2, 1 / 60); const moved = Math.max(...pos().map((p, i) => Math.hypot(p[0] - a[i][0], p[1] - a[i][1]))); return { phase, panel, moved, clock: P.raceTime - t }; })()`);
  await b.key("Escape");
  const going = await b.evaluate(`(() => { const B = window.__ooga, p = B.racers.player, x = p.x, z = p.z, phase = B.race.phase; B.advance(0.5, 1 / 60); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); return { phase, moved: Math.hypot(p.x - x, p.z - z) }; })()`);
  record("race pause: Escape pauses with the pause panel up and no racer or clock moving, and Escape again drives on", held.phase === "paused" && held.panel && held.moved === 0 && held.clock === 0 && going.phase === "racing" && going.moved > 1, JSON.stringify({ held, going }));
} };
const raceMirror = { name: "race mirror", why: "rule: a gold cup opens the mirror tracks, and steering stays true on them", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, R = B.race, btn = document.getElementById("garage-mirror"); R.toGarage(); const locked = btn.hidden; document.querySelector('[data-action="race-mirror"]').click(); const stayed = !R.selection.mirror; B.game.recordCup(1, 70); R.startRace(); R.finishRace(); const shown = !btn.hidden; btn.click(); return { locked, stayed, shown, mirror: R.selection.mirror && B.track.mirror }; })()`);
  const px = await b.evaluate(raceSteer(["a", "d"]));
  record("race mirror: the mirror button stays shut until a gold cup, then opens the mirrored track, where A and D still steer left and right on screen", r.locked && r.stayed && r.shown && r.mirror && px.a < -50 && px.d > 50, JSON.stringify({ ...r, px }));
} };
const raceAgain = { name: "race again", why: "playthrough: Race again from the results starts the same track clean", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, R = B.race, P = B.racers; R.startRace(); P.start(); P.autopilot = true; R.simulate(300); P.autopilot = false; R.finishRace(); const track = R.selection.track, results = !document.getElementById("race-results").hidden; document.querySelector('#race-results [data-action="race-again"]').click(); const g = B.track.grid; return { results, phase: R.phase, same: R.selection.track === track, lap: P.player.lap, time: P.raceTime, finished: P.racers.some((x) => x.finished), onGrid: P.racers.every((x) => g.some((s) => Math.hypot(s.x - x.x, s.z - x.z) < 0.5)), hidden: document.getElementById("race-results").hidden }; })()`);
  record("race again: Race again on the results counts down the same track with every racer back on the grid", r.results && r.phase === "countdown" && r.same && r.lap === 1 && r.time === 0 && !r.finished && r.onGrid && r.hidden, JSON.stringify(r));
} };

const dropSteer = (canopy) => `(() => { const B = window.__ooga, D = B.drop; ${EV} const out = {};
  for (const k of [null, "a", "d", "q", "e"]) {
    D.jumpNow(); const T = B.course.target, h = B.plane.state.yaw, s = B.diver.state;
    B.diver.place(T.x, T.y + 600, T.z, h); B.diver.jump(Math.sin(h) * 20, 0, Math.cos(h) * 20, h);
    ${canopy ? "D.deploy(); B.advance(2.5, 1 / 60);" : "B.advance(1.5, 1 / 60);"}
    const x0 = s.p.x, z0 = s.p.z, vx = s.v.x, vz = s.v.z;
    if (k) ev("keydown", k); B.advance(1, 1 / 60); if (k) ev("keyup", k);
    const sp = B.project(s.p.x, s.p.y, s.p.z, {}), ss = B.project(x0 + vx, s.p.y, z0 + vz, {});
    out[k || "none"] = sp.x - ss.x;
  }
  for (const k of ["a", "d", "q", "e"]) out[k] = +(out[k] - out.none).toFixed(1);
  out.none = +out.none.toFixed(1);
  return out; })()`;
const dropStart = { name: "drop start", why: "regression: Space on the title card also launched the flight", run: async (b) => {
  const st = () => b.evaluate(`({ phase: window.__ooga.drop.phase, card: !document.querySelector('[data-intro="drop"]').hidden })`);
  const fresh = await st();
  await b.key(" ");
  const closed = await st();
  await b.key("Enter");
  const climb = await st();
  const mark = await b.evaluate(`(() => { const B = window.__ooga; let t = 0; for (; t < 60 && !B.drop.jumpOpen; t += 0.25) B.advance(0.25, 1 / 60); return t; })()`);
  await b.key(" ");
  const air = await st();
  record("drop start: Space closes the title card without taking off, Enter flies, and Space at the mark jumps", fresh.card && fresh.phase === "board" && !closed.card && closed.phase === "board" && climb.phase === "climb" && mark < 60 && air.phase === "air", JSON.stringify({ fresh, closed, climb, mark, air }));
  await b.evaluate(`window.__ooga.advance(1, 1 / 60)`);
  await b.key("Escape");
  const back = await b.evaluate(`(() => { const B = window.__ooga; return { phase: B.drop.phase, diver: B.diver.state.phase, board: !document.getElementById("drop-board").hidden, score: B.drop.score, best: B.game.state.drop.best }; })()`);
  record("drop start: Escape in the air returns to the board with nothing scored", back.phase === "board" && back.diver === "idle" && back.board && back.score === 0 && back.best === null, JSON.stringify(back));
} };
const dropCrash = { name: "drop crash", why: "rule: a crash landing keeps its ring points on the card but is never a best", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, D = B.drop, best = B.game.state.drop.best && B.game.state.drop.best.score; D.jumpNow(); const R = B.course.rings[0], h = Math.atan2(B.course.target.x, B.course.target.z); B.diver.place(R.x, R.y + 3, R.z, h); B.diver.jump(0, -30, 0, h); for (let t = 0; t < 60 && D.phase !== "results"; t += 0.25) D.simulate(0.25); const r = D.result; return { landing: r.landing, score: r.score, accuracy: r.accuracy, improved: r.improved, best, after: B.game.state.drop.best && B.game.state.drop.best.score }; })()`);
  record("drop crash: a crash through a ring scores its rings with no accuracy and does not replace the best", ["tumble", "hole", "pancake"].includes(r.landing) && r.score > 0 && r.accuracy === 0 && !r.improved && r.after === r.best, JSON.stringify(r));
} };
const dropSteering = { name: "drop steering", why: "regression: Q and E turned the wrong way in freefall, then Q turned right under the canopy", run: async (b) => {
  const free = await b.evaluate(dropSteer(false)), canopy = await b.evaluate(dropSteer(true));
  const ok = (px) => px.a < -30 && px.q < -30 && px.d > 30 && px.e > 30;
  record("drop steering: A and Q go left and D and E go right on screen, in freefall and under the canopy", ok(free) && ok(canopy), JSON.stringify({ free, canopy }));
} };

// Orbit steering per phase, each measured on screen: the pod's axes and the walker projected through the
// camera, with the planet's local up. Same axis, different sign per phase is how the canopy broke.
const ORBIT_H = `const B = window.__ooga, O = B.orbit, F = () => B.flight, s = () => B.flight.state;
const hold = (k, t) => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); B.advance(t); window.dispatchEvent(new KeyboardEvent("keyup", { key: k })); };
const basis = () => { const c = B.camera, p = c.position, t = c.target; let fx = t.x - p.x, fy = t.y - p.y, fz = t.z - p.z; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl; let ux = p.x, uy = p.y + 3040, uz = p.z; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul; let rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux; const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl; return { f: [fx, fy, fz], r: [rx, ry, rz], u: [ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx] }; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const px = (x, y, z) => { const o = B.project(x, y, z); return [o.x, o.y]; };
const scr = (d, len) => { const p = s().p, a = px(p.x, p.y, p.z), q = px(p.x + d[0] * len, p.y + d[1] * len, p.z + d[2] * len); return [q[0] - a[0], a[1] - q[1]]; };
const ang = (v) => Math.atan2(v[1], v[0]), wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const top = () => { O.toBuild(); O.launch(); O.toOrbit(); B.advance(4.3); O.dropRest(); B.advance(0.3); };`;
const orbitSteerRun = `(() => { ${ORBIT_H}
  const out = {};
  O.toBuild(); O.setStack(window.BL.rocketParts.PRESETS[0].stack); O.launch(); O.simulate(3.05); O.simulate(1.85); O.releaseClamps(); O.simulate(3); B.advance(0.2);
  const tilt = () => { const v = scr(s().up, 10); return Math.atan2(v[0], v[1]) * 180 / Math.PI; };
  for (const k of ["d", "a"]) { const t0 = tilt(); hold(k, 1); out["ascent " + k] = tilt() - t0; B.advance(0.3); }
  s().throttle = 0.5; hold("w", 0.3); out["ascent w"] = s().throttle - 0.5; const th = s().throttle; hold("s", 0.3); out["ascent s"] = s().throttle - th;
  top(); O.eva.back = true; O.letGo(); B.advance(0.5);
  for (const k of ["w", "a", "s", "d"]) { const n = () => scr(s().up.map((c) => -c), 5), a0 = n(); hold(k, 0.4); const a1 = n(); out["shield " + k] = [a1[0] - a0[0], a1[1] - a0[1]]; B.advance(0.8); }
  for (const k of ["q", "e"]) { const r0 = ang(scr(s().right, 4)); hold(k, 0.4); out["spin " + k] = wrap(ang(scr(s().right, 4)) - r0); B.advance(0.8); }
  for (let t = 0; t < 200 && !F().chuteReady(); t += 0.1) O.simulate(0.1); O.pullChute(); B.advance(3);
  for (const k of ["", "a", "d"]) { const k0 = basis(), p0 = { ...s().p }, v0 = { ...s().v }; if (k) hold(k, 1.5); else B.advance(1.5); const p = s().p; out["chute " + (k || "none")] = dot([p.x - p0.x - v0.x * 1.5, p.y - p0.y - v0.y * 1.5, p.z - p0.z - v0.z * 1.5], k0.r); B.advance(0.5); }
  top(); O.startEva(); B.advance(0.5);
  const walker = () => { const P = s().p, E = O.eva; let ux = P.x, uy = P.y + 3040, uz = P.z; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul; const dl = Math.hypot(uz, uy), fy = -uz / dl, fz = uy / dl, ex = fy * uz - fz * uy, ey = fz * ux, ez = -fy * ux; return [ex * E.e + ux * E.u, ey * E.e + uy * E.u + fy * E.f, ez * E.e + uz * E.u + fz * E.f]; };
  for (const k of ["w", "a", "s", "d", "q", "e"]) { const E = O.eva; E.e = 0; E.u = 1.1; E.f = 0; E.ve = E.vu = E.vf = 0; B.advance(0.3); const k0 = basis(), w0 = walker(); hold(k, 0.6); const w1 = walker(), d = [w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]]; out["walk " + k] = [dot(d, k0.f), dot(d, k0.r), dot(d, k0.u)]; }
  for (const k in out) out[k] = Array.isArray(out[k]) ? out[k].map((v) => +v.toFixed(2)) : +out[k].toFixed(2);
  return out; })()`;
const orbitSteering = { name: "orbit steering", why: "regression: steering keys came out mirrored in two other games, one phase at a time", run: async (b) => {
  await b.open(sceneUrl("orbit"));
  await untilReady(b);
  await b.key("Enter");
  const o = await b.evaluate(orbitSteerRun);
  const ok = o["ascent d"] > 5 && o["ascent a"] < -5 && o["ascent w"] > 0 && o["ascent s"] < 0
    && o["shield w"][1] > 30 && o["shield s"][1] < -30 && o["shield a"][0] < -30 && o["shield d"][0] > 30 && o["spin q"] > 0.05 && o["spin e"] < -0.05
    && Math.abs(o["chute none"]) < 0.2 && o["chute a"] < -0.5 && o["chute d"] > 0.5
    && o["walk w"][0] > 0.3 && o["walk s"][0] < -0.3 && o["walk a"][1] < -0.3 && o["walk d"][1] > 0.3 && o["walk q"][2] < -0.3 && o["walk e"][2] > 0.3;
  record("orbit steering: every key moves its way on screen on the climb (A D lean, W S throttle), falling home (W A S D tip the shield, Q E spin), under the chute (A D) and on the spacewalk (W S in and out, A D, Q E down and up)", ok, JSON.stringify(o));
} };
const orbitMissed = { name: "orbit missed", why: "regression: a hop back onto the pad was saluted on the flight log though it missed orbit", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, O = B.orbit; O.toBuild(); O.setStack(window.BL.rocketParts.PRESETS[1].stack); O.launch(); O.simulate(3.05); O.simulate(1.85); O.releaseClamps(); O.simulate(1); const F = B.flight, s = F.state; O.act(); let lit = 0; for (let t = 0; t < 400 && O.phase === "ascent"; t += 0.25) { const next = F.stages[s.stage + 1]; if (s.burning) lit += 0.25; if (next && next.engine && (s.fuel[s.stage] <= 0 || lit > 0.25)) { O.act(); lit = 0; } O.simulate(0.25); } for (let t = 0; t < 400 && O.phase !== "results"; t += 0.25) { if (O.phase === "descent" && F.chuteReady()) O.pullChute(); O.simulate(0.25); } return { phase: O.phase, orbit: O.result && O.result.orbit, landing: O.result && O.result.landing, summary: document.getElementById("orbit-summary").textContent }; })()`);
  record("orbit missed: a rocket that drops its stages still burning and falls back names the missed orbit and the wasted fuel first", r.phase === "results" && !r.orbit && r.summary.startsWith("Short of low orbit") && r.summary.includes("fuel went down"), JSON.stringify(r));
} };
const orbitEscape = { name: "orbit escape", why: "rule: Escape mid-flight returns to the builder, and Escape in the builder leaves for the island", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, O = B.orbit; O.toBuild(); O.launch(); O.simulate(3.05); O.simulate(1.85); O.releaseClamps(); O.simulate(2); const flying = O.phase; window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return { flying, phase: O.phase, builder: !document.getElementById("orbit-build").hidden, flight: B.flight }; })()`);
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const scene = await b.evaluate(`window.__ooga.scene`);
  record("orbit escape: Escape in the climb drops back to the builder with the flight cleared, and Escape there leaves for the island", r.flying === "ascent" && r.phase === "build" && r.builder && r.flight === null && scene === "hub", JSON.stringify({ ...r, scene }));
} };

const mineControls = { name: "mine controls", why: "regression: steering keys came out mirrored in two other games; the mine walks relative to its camera", run: async (b) => {
  await b.open(sceneUrl("mine"));
  await untilReady(b);
  const st = `({ phase: window.__ooga.mine.phase, time: window.__ooga.mine.state.time })`;
  await b.key(" ");
  await b.evaluate(`window.__ooga.advance(0.5)`);
  const spaced = await b.evaluate(st);
  await b.key("Enter");
  await b.evaluate(`window.__ooga.advance(0.5)`);
  const started = await b.evaluate(st);
  const walk = await b.evaluate(`(() => { const B = window.__ooga, M = B.mine, C = B.camera, out = {};
    const hold = (k, t) => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); B.advance(t); window.dispatchEvent(new KeyboardEvent("keyup", { key: k })); };
    const me = () => M.crew.crew[0].node.position, view = () => { const fx = C.target.x - C.position.x, fz = C.target.z - C.position.z, l = Math.hypot(fx, fz); return { f: [fx / l, fz / l], r: [-fz / l, fx / l] }; };
    for (const k of ["w", "s", "a", "d"]) { const v = view(), p0 = { ...me() }; hold(k, 0.5); const p1 = me(), a = B.project(p0.x, p0.y, p0.z), c = B.project(p1.x, p1.y, p1.z); out[k] = { away: +((p1.x - p0.x) * v.f[0] + (p1.z - p0.z) * v.f[1]).toFixed(2), px: Math.round(c.x - a.x) }; B.advance(0.6); }
    for (const k of ["q", "e"]) { const v = view(), t = M.pilot.orbit.target, x = t.x + v.f[0] * 6, z = t.z + v.f[1] * 6, y = t.y, x0 = B.project(x, y, z).x; hold(k, 0.5); B.advance(0.3); out[k] = Math.round(B.project(x, y, z).x - x0); }
    return out; })()`);
  record("mine controls: Space leaves the intro alone and Enter starts the run; W walks away from the camera, S toward it, A and D left and right on screen, and Q and E turn the view left and right", spaced.phase === "intro" && spaced.time === 0 && started.phase === "run" && walk.w.away > 1 && walk.s.away < -1 && walk.a.px < -50 && walk.d.px > 50 && walk.q > 50 && walk.e < -50, JSON.stringify({ spaced, started, walk }));
  const pause = await b.evaluate(`(() => { const B = window.__ooga, s = B.mine.state, key = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" })); let t = s.time; B.advance(1); const running = s.time - t; key(); t = s.time; B.advance(2); const frozen = s.time - t, shown = document.getElementById("mine-pause-btn").getAttribute("aria-pressed"); key(); t = s.time; B.advance(1); return { running, frozen, shown, resumed: s.time - t }; })()`);
  record("mine controls: P pauses the operation with its button pressed, and P again runs it on", pause.running > 0 && pause.frozen === 0 && pause.shown === "true" && pause.resumed > 0, JSON.stringify(pause));
  const ladder = await b.evaluate(`(() => { const B = window.__ooga, M = B.mine, s = M.state; M.setBananas(1e5); M.buy("m1", -1); M.select("unit", Array.from(s.unit).findIndex((v) => v > 0)); B.advance(0.6); const card = () => !document.getElementById("mine-card").hidden, opened = card(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); B.advance(0.6); const first = { card: card(), paused: s.paused }; window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return { opened, first, second: { paused: s.paused, scene: B.scene } }; })()`);
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const left = await b.evaluate(`({ scene: window.__ooga.scene, saved: !!localStorage.getItem("oogaboogaland.mine") })`);
  record("mine controls: Escape closes a card, then pauses, then leaves for the island with the run saved", ladder.opened && !ladder.first.card && !ladder.first.paused && ladder.second.paused && ladder.second.scene === "mine" && left.scene === "hub" && left.saved, JSON.stringify({ ...ladder, left }));
} };

// Walking relative to the camera with real keyboard events. Each key starts from the same placement and
// passes when most of the world-space move lies along the camera-relative direction on its label.
const holdKey = async (b, k, seconds) => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k, code: "Key" + k.toUpperCase() });
  await b.evaluate(`window.__ooga.advance(${seconds}, 1 / 60)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: "Key" + k.toUpperCase() });
  await b.evaluate(`window.__ooga.advance(0.2, 1 / 60)`);
};
const agentShortcut = async (b) => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftRight", location: 2, modifiers: 8 });
  await b.key("A", 8);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftRight", location: 2 });
};
const WALK = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] };
const walkKeys = async (b, who, x, z, yaws, seconds) => {
  const rows = {};
  for (const yaw of yaws) for (const k of "wasd") {
    await b.evaluate(`(() => { const B = window.__ooga; let body;
      const a = B.cavemen.get("${who}"); if (B.crew.player !== a) B.pilot.possess(a); B.pilot.navigate({ position: { x: ${x}, y: B.island ? B.island.surfaceAt(${x}, ${z}) : 0, z: ${z} }, yaw: ${yaw}, pitch: 0.4, dist: 10 }); body = a.root;
      B.advance(0.5, 1 / 60);
      const c = B.camera, vx = c.target.x - c.position.x, vz = c.target.z - c.position.z, l = Math.hypot(vx, vz), p = body.position;
      window.__walk = { body, fx: vx / l, fz: vz / l, x0: p.x, y0: p.y, z0: p.z }; })()`);
    await holdKey(b, k, seconds);
    const r = await b.evaluate(`(() => { const q = window.__walk, p = q.body.position, dx = p.x - q.x0, dz = p.z - q.z0; return { right: dx * -q.fz + dz * q.fx, fwd: dx * q.fx + dz * q.fz }; })()`);
    const [er, ef] = WALK[k], along = r.right * er + r.fwd * ef;
    rows[`${yaw} ${k}`] = { ok: along > 1 && along > 0.8 * Math.hypot(r.right, r.fwd), right: +r.right.toFixed(2), fwd: +r.fwd.toFixed(2) };
  }
  return rows;
};
const allWalk = (rows) => Object.values(rows).every((r) => r.ok);
const hubSheetPersistence = { name: "side panel persistence", why: "rule: a first visit starts folded, while later visits restore both the folded state and selected tab", run: async (b) => {
  const url = hubPage(src, "pos=0");
  await b.evaluate(`localStorage.removeItem("oogaboogaland.sheet.v1")`);
  await b.open(url);
  await untilReady(b);
  const read = `(() => { const sheet = document.getElementById("sheet"), tab = document.querySelector("[data-tab][aria-selected='true']").dataset.tab, saved = localStorage.getItem("oogaboogaland.sheet.v1"); return { open: sheet.dataset.open, tab, panel: !document.querySelector('[data-panel="' + tab + '"]').hidden, saved: saved && JSON.parse(saved) }; })()`;
  const first = await b.evaluate(read);
  await b.evaluate(`document.getElementById("sheet-bananas").click()`);
  const opened = await b.evaluate(read);
  await b.open(url);
  await untilReady(b);
  const restored = await b.evaluate(read);
  await b.evaluate(`document.getElementById("sheet-bananas").click()`);
  await b.open(url);
  await untilReady(b);
  const closed = await b.evaluate(read);
  await b.evaluate(`localStorage.removeItem("oogaboogaland.sheet.v1")`);
  record("side panel: first load is closed and reloads restore its open state and selected tab", first.open === "false" && first.tab === "roster" && first.panel && first.saved === null
    && opened.open === "true" && opened.tab === "bananas" && opened.saved?.open && opened.saved.tab === "bananas"
    && restored.open === "true" && restored.tab === "bananas" && restored.panel
    && closed.open === "false" && closed.tab === "bananas" && !closed.saved.open && closed.saved.tab === "bananas", JSON.stringify({ first, opened, restored, closed }));
} };
const hubBlockHeight = { name: "header clock and block height", why: "rule: the single-digit clock is centered from its visible glyphs with a time zone, and the shared chain reading is shown beneath it", run: async (b) => {
  const before = await b.evaluate(`(() => { const clock = document.getElementById("world-clock"), label = clock.getAttribute("aria-label"), text = label.replace(/^Ooga Booga time /, ""), cells = [...text].reduce((sum, ch) => sum + (ch === " " ? 2 : 4), -1), zone = (new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value || "UTC").toUpperCase().replaceAll("âˆ’", "-"); return { height: document.getElementById("world-block-height").textContent, bananas: !!document.getElementById("world-banana-count"), label, text, zone, cells, viewWidth: clock.querySelector("svg").viewBox.baseVal.width, cssWidth: parseFloat(clock.style.width) }; })()`);
  await b.evaluate(`BL.mempool.emit({ type: "block", height: 900123, txCount: 3210 })`);
  const after = await b.evaluate(`(() => { const B = __ooga, height = document.getElementById("world-block-height"), block = document.getElementById("world-block"); const shown = height.textContent; B.hud.setMeter(42, 60, "Ready"); return { shown, afterMeter: height.textContent, label: block.getAttribute("aria-label"), bananas: !!document.getElementById("world-banana-count"), icon: !!block.querySelector(".banana-icon") }; })()`);
  record("header: a single-digit clock is centered from its displayed time and local zone, while the chain feed paints block height below it and banana-meter updates cannot overwrite it", before.height === "\u2014" && !before.bananas && before.text === `9:00 AM ${before.zone}` && before.viewWidth === before.cells && Math.abs(before.cssWidth - before.cells / 6) < 1e-6 && after.shown === "900,123" && after.afterMeter === after.shown && after.label === "Bitcoin block height 900123" && !after.bananas && !after.icon, JSON.stringify({ before, after }));
} };
const hubWalking = { name: "hub walking", why: "regression: steering keys came out mirrored, and the removed hub Agent could still be summoned", run: async (b) => {
  const ooga = await walkKeys(b, "portlandhodl", -8, 8, [0, 2.2], 0.6);
  const running = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl"), P = B.pilot, rows = [];
    const key = (type, key, code, location = 0, shiftKey = false) => window.dispatchEvent(new KeyboardEvent(type, { key, code, location, shiftKey }));
    const move = (combat, direction, sprint) => {
      P.controls.reset(); if (P.aiming !== combat) P.modeAction("mode-toggle");
      P.navigate({ position: { x: -8, y: B.island.surfaceAt(-8, 8), z: 8 }, yaw: 0, pitch: 0.4, dist: 10 }); B.advance(0.4, 1 / 60);
      const p = a.root.position, x = p.x, z = p.z;
      if (sprint) key("keydown", "Shift", "ShiftLeft", 1, true);
      key("keydown", direction, "Key" + direction.toUpperCase(), 0, sprint);
      B.advance(0.2, 1 / 60);
      const distance = Math.hypot(p.x - x, p.z - z), keptControl = P.player === a;
      key("keyup", direction, "Key" + direction.toUpperCase(), 0, sprint);
      if (sprint) key("keyup", "Shift", "ShiftLeft", 1);
      return { distance, keptControl, sprintReleased: P.controls.read().sprint === 0 };
    };
    for (const combat of [false, true]) for (const direction of ["w", "a"]) rows.push({ combat, direction, walk: move(combat, direction, false), run: move(combat, direction, true) });
    key("keydown", "Shift", "ShiftLeft", 1, true); key("keydown", "Shift", "ShiftRight", 2, true); key("keyup", "Shift", "ShiftRight", 2, true);
    const independent = P.controls.read().sprint === 1; key("keyup", "Shift", "ShiftLeft", 1);
    return { rows, independent };
  })()`);
  record("hub running: Left Shift speeds up forward and sideways movement in carry and shoulder views, keeps possession, releases cleanly and survives a Right Shift keyup",
    running.independent && running.rows.every(row => row.walk.distance > 0.5 && row.run.distance > row.walk.distance * 1.4 && row.run.distance < row.walk.distance * 1.6
      && row.run.keptControl && row.run.sprintReleased), JSON.stringify(running));
  await b.evaluate(`window.__ooga.pilot.release(true)`);
  await agentShortcut(b);
  const agent = await b.evaluate(`window.__ooga.agent`);
  await b.key("Escape");
  record("hub walking: W A S D walk an Ooga away, left, back and right on screen from two camera angles, and Right Shift+A does not restore the removed hub Agent", allWalk(ooga) && !agent, JSON.stringify({ ooga, agent }));
} };
const hubMapNavigation = { name: "hub map navigation", why: "regression: the map could not advance after Lab, locked cursor dot clicks cycled the whole button, and departing arrivals lost their location label", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, H = B.hud, a = B.cavemen.get("portlandhodl");
    const map = document.getElementById("destination-hud"), label = document.getElementById("detached-destination-name");
    const dot = name => map.querySelector('[data-detached-preset="' + name + '"]');
    const selected = () => map.querySelector('[data-current="true"]')?.dataset.detachedPreset;
    const rows = [];
    for (const mode of ["detached", "carry", "combat", "first-person"]) {
      P.goPreset("pile"); if (mode !== "detached") P.possess(a);
      if (mode === "combat" && !P.aiming) P.modeAction("mode-toggle");
      if (mode === "first-person") P.enterClose(true);
      P.controls.reset();
      dot("lab").click(); B.advance(0.1, 1 / 60);
      const lab = selected() === "lab" && label.textContent === "Lab" && !map.hidden;
      // This is the event target/coordinate pair used by the locked cursor.
      const rect = dot("lab").getBoundingClientRect();
      map.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      const cursorDot = selected() === "lab";
      map.click(); B.advance(0.1, 1 / 60);
      const mirror = selected() === "mirror" && label.textContent === "Mirror";
      const cycle = [];
      for (const next of ["underground", "basement", "pile"]) { map.click(); B.advance(0.1, 1 / 60); cycle.push(selected() === next); }
      rows.push({ mode, lab, cursorDot, mirror, cycle, possession: mode === "detached" ? !P.player : P.player === a });
    }
    P.goPreset("pile"); P.possess(a); if (P.aiming) P.modeAction("mode-toggle");
    dot("lab").click(); B.advance(0.1, 1 / 60);
    P.hooks.onOrbit(10, 0); P.hooks.onZoom(1.05); B.advance(0.1, 1 / 60);
    const looking = selected() === "lab" && label.textContent === "Lab";
    const start = { ...a.root.position };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS" })); B.advance(1, 1 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "s", code: "KeyS" })); B.advance(0.1, 1 / 60);
    const departed = { distance: Math.hypot(a.root.position.x - start.x, a.root.position.z - start.z), label: label.textContent, selected: selected() || null, visible: label.classList.contains("show") };
    const areas = [];
    for (const name of ["underground", "basement", "timechain"]) {
      if (name === "timechain") P.goPreset(name); else dot(name).click();
      B.advance(0.1, 1 / 60); H.fadeDetachedName(true); B.advance(0.1, 1 / 60);
      areas.push({ name, label: label.textContent });
    }
    P.release(true); P.goPreset("pile");
    return { rows, looking, departed, areas };
  })()`);
  record("hub map: native and locked-cursor Lab clicks remain usable, the map cycles through Mirror, HQ, Basement and Pile in every view, and possession is retained", r.rows.every(row => row.lab && row.cursorDot && row.mirror && row.cycle.every(Boolean) && row.possession), JSON.stringify(r.rows));
  record("hub map: looking keeps the arrival label; actual travel clears its dot and shows HUB, and underground and sphere arrivals resolve to their broader areas", r.looking && r.departed.distance > 1.5 && r.departed.label === "HUB" && r.departed.selected === null && r.departed.visible
    && r.areas.map(row => row.label).join(",") === "HQ,B1,SPHERE", JSON.stringify({ looking: r.looking, departed: r.departed, areas: r.areas }));
} };
const hubRainforestSteps = { name: "rainforest bridge steps", why: "regression: diagonal treads and the bridge abutment caught walkers, and hanging vine tails protruded through the stair rock", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, P = BL.poolModels, D = P.DIR, rows = [];
    const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: "Key" + k.toUpperCase() }));
    for (const across of [-0.75, 0, 0.75, null]) {
      const replay = across === null, a = B.cavemen.get(replay ? "w-s-bitcoin" : "portlandhodl");
      B.pilot.possess(a);
      if (B.pilot.aiming !== replay) B.pilot.modeAction("mode-toggle");
      const x = replay ? 25.38348 : D.x * 25.5 + D.z * across, z = replay ? 8.36988 : D.z * 25.5 - D.x * across;
      B.pilot.navigate({ position: { x, y: replay ? 4.58241 - a.baseY : B.island.surfaceAt(x, z), z }, yaw: replay ? 13.77019 - Math.PI : Math.atan2(D.x, D.z) + Math.PI, pitch: replay ? 0.105 : 0.25, dist: 8 });
      B.advance(0.2, 1 / 60);
      let stalled = 0, longest = 0, airborne = false;
      key("keydown", "w");
      for (let i = 0; i < 90; i++) {
        const p = a.root.position, before = p.x * D.x + p.z * D.z;
        B.advance(1 / 60, 1 / 60);
        stalled = p.x * D.x + p.z * D.z - before < 0.01 ? stalled + 1 : 0;
        longest = Math.max(longest, stalled); airborne ||= a.hop > 0.01;
      }
      key("keyup", "w");
      const top = a.root.position.x * D.x + a.root.position.z * D.z, feet = a.root.position.y - a.baseY;
      key("keydown", "s"); B.advance(1.5, 1 / 60); key("keyup", "s");
      rows.push({ across, replay, top, feet, bottom: a.root.position.x * D.x + a.root.position.z * D.z, longest, airborne });
    }
    const v = P.bridge().verts;
    let tails = 0;
    for (let i = 0; i < v.length; i += 3) if (v[i + 1] < -0.8 && (v[i + 2] < -0.1 || v[i + 2] > P.SITE.span + 0.1)) tails++;
    B.pilot.release(true); B.pilot.goPreset("pile");
    return { rows, tails };
  })()`);
  record("rainforest approach: Oogas walk onto the bridge and back without stopping or jumping, including the reported W-S Bitcoin combat position", r.rows.every(row => row.top > 32 && row.bottom < 27 && row.feet > 5 && row.longest < 4 && !row.airborne), JSON.stringify(r.rows));
  record("rainforest bridge: hanging vines end at the gateways instead of extending through the stair rock", r.tails === 0, JSON.stringify({ tails: r.tails }));
} };
// The island opens Ooga Arcade with Space at its mouth, and the Mempool with a tap on its stair.
const WAIT_OUT = `(() => { const B = window.__ooga; for (let i = 0; i < 240 && (B.transitioning || B.scene === "hub"); i++) B.advance(1 / 30, 1 / 30); B.advance(0.3, 1 / 30); return B.scene; })()`;
const hubRoutes = { name: "hub routes", why: "playthrough: every scene the island opens is reached the way a player gets there", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), slot = window.BL.caves.slots.find((s) => s.scene === "arcade"), m = B.mouths.find((m) => m.id === slot.id); if (B.crew.player !== a) B.pilot.possess(a); B.pilot.navigate({ position: { x: m.x - Math.sin(m.ry) * 1.2, y: m.floorY, z: m.z - Math.cos(m.ry) * 1.2 }, yaw: m.ry, pitch: 0.4, dist: 10 }); B.advance(0.5, 1 / 60); })()`);
  await b.key(" ");
  const reached = { arcade: await b.evaluate(WAIT_OUT) };
  await tourGo(b, "hub");
  const t = await b.evaluate(`(() => { const B = window.__ooga, o = B.props.find((p) => p.prop === "poolstair"), w = o.node.world; B.pilot.navigate({ position: { x: w[12], y: w[13], z: w[14] }, target: { x: w[12], y: w[13], z: w[14] }, yaw: 0, pitch: 0.9, dist: 12 }); B.advance(0.6, 1 / 60); return B.project(w[12], w[13], w[14], {}); })()`);
  await b.click(t.x, t.y);
  reached.pool = await b.evaluate(WAIT_OUT);
  await tourGo(b, "hub");
  record("hub routes: Space at the arcade mouth and a tap on the Mempool stair each enter their scene", Object.entries(reached).every(([id, scene]) => id === scene), JSON.stringify(reached));
} };
const hubFall = { name: "hub fall", why: "rule: walking off the island drops the Ooga into the abyss and brings it back to the pile, still yours", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), I = B.island, ang = Math.PI / 4; if (B.crew.player !== a) B.pilot.possess(a); let r = 5; while (I.onLand(Math.sin(ang) * r, Math.cos(ang) * r)) r += 0.25; r -= 1.5; const x = Math.sin(ang) * r, z = Math.cos(ang) * r; B.pilot.navigate({ position: { x, y: I.surfaceAt(x, z), z }, yaw: ang + Math.PI, pitch: 0.4, dist: 10 }); B.advance(0.5, 1 / 60); })()`);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", text: "w", code: "KeyW" });
  const r = await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), p = a.root.position; let minFeet = Infinity, back = null; for (let i = 0; i < 20 * 30; i++) { B.advance(1 / 30, 1 / 30); minFeet = Math.min(minFeet, p.y - a.baseY); if (minFeet < -50 && Math.hypot(p.x, p.z) < 12) { back = i / 30; break; } } return { minFeet: +minFeet.toFixed(1), back, onLand: B.island.onLand(p.x, p.z), yours: B.crew.player === a }; })()`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW" });
  record("hub fall: an Ooga walked off the edge falls into the abyss and is back at the pile within six seconds, still yours", r.minFeet < -50 && r.back !== null && r.back < 6 && r.onLand && r.yours, JSON.stringify(r));
} };

const labWalking = { name: "lab walking", why: "regression: Shift+A left A held in the Ooga's controls, walking the Agent and the next Ooga left on their own", run: async (b) => {
  const ooga = await walkKeys(b, "portlandhodl", 5, 5, [0, 2.2], 0.3);
  const oogaJump = await b.evaluate(`(() => {
    const B = __ooga, a = B.crew.player;
    B.pilot.navigate({ position: { x: 5, y: 0, z: 5 }, yaw: 0, pitch: 0.4, dist: 10 }); B.advance(0.2, 1 / 60);
    const y = a.root.position.y, accepted = B.crew.jumpPlayer(); let peak = 0;
    for (let i = 0; i < 150; i++) { B.advance(1 / 60, 1 / 60); peak = Math.max(peak, a.root.position.y - y); }
    return { accepted, peak };
  })()`);
  await b.evaluate(`window.__ooga.pilot.release(true)`);
  await agentShortcut(b);
  const still = await b.evaluate(`(() => { const B = window.__ooga, p = B.agent.root.position, x = p.x, z = p.z; B.advance(1, 1 / 60); return { driven: B.agent.driven, drift: +Math.hypot(p.x - x, p.z - z).toFixed(2) }; })()`);
  const running = await b.evaluate(`(() => {
    const B = __ooga, a = B.agent, rows = [];
    const key = (type, key, code, location = 0, shiftKey = false) => window.dispatchEvent(new KeyboardEvent(type, { key, code, location, shiftKey }));
    for (const sprint of [false, true]) {
      a.place(5, 5, 0); B.advance(0.4, 1 / 60);
      const p = a.root.position, x = p.x, z = p.z;
      if (sprint) key("keydown", "Shift", "ShiftLeft", 1, true);
      key("keydown", "a", "KeyA", 0, sprint); B.advance(0.3, 1 / 60);
      rows.push({ sprint, distance: Math.hypot(p.x - x, p.z - z), driven: a.driven });
      key("keyup", "a", "KeyA", 0, sprint); if (sprint) key("keyup", "Shift", "ShiftLeft", 1);
    }
    return rows;
  })()`);
  record("lab running: Left Shift+A makes the gorilla strafe faster without releasing control", running.every(row => row.driven) && running[0].distance > 0.2 && running[1].distance > running[0].distance * 1.2, JSON.stringify(running));
  const jumps = await b.evaluate(`(() => {
    const B = __ooga, a = BL.scenes.lab.agent, view = BL.scenes.lab.agentView, rows = [];
    const key = (type, key, code, location = 0, shiftKey = false, repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { key, code, location, shiftKey, repeat }));
    const peakAfterPress = () => {
      const floor = a.groundAt(a.root.position.x, a.root.position.z); let peak = 0;
      for (let i = 0; i < 150; i++) { B.advance(1 / 60, 1 / 60); peak = Math.max(peak, a.root.position.y - floor); }
      return peak;
    };
    a.place(5, 5, -Math.PI / 2); view.yaw = view.tYaw = 0; B.advance(0.4, 1 / 60);
    key("keydown", " ", "Space"); key("keyup", " ", "Space");
    const tapPeak = peakAfterPress();
    for (const sprint of [false, true]) {
      a.place(5, 5, -Math.PI / 2); view.yaw = view.tYaw = 0;
      if (sprint) key("keydown", "Shift", "ShiftLeft", 1, true);
      key("keydown", "a", "KeyA", 0, sprint); B.advance(0.35, 1 / 60);
      key("keydown", " ", "Space", 0, sprint);
      const p = a.root.position, x = p.x, z = p.z, y = p.y;
      let earlyAir = a.airborne, stopped = 0, minHip = Infinity;
      for (let i = 0; i < 39; i++) {
        const px = p.x, pz = p.z;
        B.advance(1 / 60, 1 / 60);
        earlyAir ||= a.airborne || Math.abs(p.y - y) > 1e-6;
        if (Math.hypot(p.x - px, p.z - pz) < 0.01) stopped++;
        minHip = Math.min(minHip, a.hips.position.y);
        if (i === 20) key("keydown", " ", "Space", 0, sprint, true);
      }
      const heldTravel = Math.hypot(p.x - x, p.z - z);
      key("keyup", "a", "KeyA", 0, sprint); if (sprint) key("keyup", "Shift", "ShiftLeft", 1);
      let landed = false, repeated = false;
      for (let i = 0; i < 150; i++) {
        B.advance(1 / 60, 1 / 60);
        if (!a.airborne) landed = true;
        else if (landed) repeated = true;
      }
      key("keyup", " ", "Space", 0, sprint); B.advance(0.1, 1 / 60);
      rows.push({ sprint, earlyAir, stopped, minHip, heldTravel, landed, repeated, releaseAir: a.airborne });
    }
    a.place(5, 5, 0);
    key("keydown", " ", "Space"); B.advance(0.55, 1 / 60); key("keyup", " ", "Space");
    const secondY = a.root.position.y;
    key("keydown", " ", "Space"); B.advance(1 / 60, 1 / 60);
    const secondRise = a.root.position.y - secondY, thirdY = a.root.position.y;
    key("keyup", " ", "Space"); key("keydown", " ", "Space"); B.advance(1 / 60, 1 / 60);
    const thirdRise = a.root.position.y - thirdY;
    let secondLift = a.root.position.y - secondY;
    for (let i = 0; i < 150; i++) { B.advance(1 / 60, 1 / 60); secondLift = Math.max(secondLift, a.root.position.y - secondY); }
    const doubleLanded = !a.airborne;
    window.dispatchEvent(new Event("blur")); key("keyup", " ", "Space"); B.advance(0.2, 1 / 60);
    return { tapPeak, rows, secondRise, thirdRise, secondLift, doubleLanded, blurAir: a.airborne, driven: a.driven };
  })()`);
  record("lab jump: Space immediately jumps while walking or galloping, a second press double jumps 50% higher than an Ooga, holding never repeats, and a third airborne press or release adds no impulse",
    oogaJump.accepted && jumps.driven && !jumps.blurAir && jumps.doubleLanded && jumps.tapPeak > oogaJump.peak * 1.45 && jumps.tapPeak < oogaJump.peak * 1.56
      && jumps.secondLift > jumps.tapPeak * 0.98 && jumps.secondLift < jumps.tapPeak * 1.02 && jumps.secondRise > 0 && jumps.thirdRise < jumps.secondRise
      && jumps.rows.every(row => row.earlyAir && !row.stopped && row.minHip > 0.68 && row.heldTravel > 2 && row.landed && !row.repeated && !row.releaseAir), JSON.stringify({ ...jumps, oogaJump }));
  await b.key("Escape");
  const after = await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"); B.pilot.possess(a); B.pilot.navigate({ position: { x: 5, y: 0, z: 5 }, yaw: 0, pitch: 0.4, dist: 10 }); B.advance(0.3, 1 / 60); const p = a.root.position, x = p.x, z = p.z; B.advance(1, 1 / 60); return +Math.hypot(p.x - x, p.z - z).toFixed(2); })()`);
  await b.key("Escape");
  record("lab walking: W A S D walk an Ooga their way on screen, Right Shift+A summons a still Agent without leaving A held, and an Ooga taken after the Agent stands still", allWalk(ooga) && still.driven && still.drift < 0.2 && after < 0.2, JSON.stringify({ ooga, still, after }));
} };
const labKeys = { name: "lab keys", why: "rule: B streams the test bananas onto the pile, and Escape lets go of an Ooga before it leaves the lab", run: async (b) => {
  const before = await b.evaluate(`window.__ooga.stats().dropsLanded`);
  await b.key("b");
  const landed = await b.evaluate(`(() => { const B = window.__ooga; B.advance(4, 1 / 30); return B.stats().dropsLanded - ${before}; })()`);
  await b.evaluate(`(() => { const B = window.__ooga; B.pilot.possess(B.cavemen.get("portlandhodl")); B.advance(0.3, 1 / 60); })()`);
  await b.key("Escape");
  const first = await b.evaluate(`({ scene: window.__ooga.scene, driving: !!window.__ooga.crew.player })`);
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const second = await b.evaluate(`window.__ooga.scene`);
  record("lab keys: B lands 100 test bananas, the first Escape lets go of the Ooga and the second returns to the island", landed === 100 && first.scene === "lab" && !first.driving && second === "hub", JSON.stringify({ landed, first, second }));
} };
const poolLeave = { name: "pool leave", why: "rule: Escape takes the player from the Mempool cave back to the island", run: async (b) => {
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const scene = await b.evaluate(`window.__ooga.scene`);
  record("pool leave: Escape in the Mempool cave returns to the island", scene === "hub", JSON.stringify({ scene }));
} };

// The Matrix room and the mirror, each inside one evaluate so no real frame falls between the steps.
const hubMatrix = { name: "hub matrix", why: "rule: the room lever raises the mirror's bars and turns the glyph wave on, and pulling it back down puts both back", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, G = B.matrixGate, M = B.mirrorCave, W = B.renderOpts.matrix, D = BL.scenes.hub.debug.matrixCave, m = M.mouth, g = M.gate, a = B.cavemen.get("portlandhodl"); if (B.crew.player !== a) B.pilot.possess(a); B.pilot.navigate({ position: { x: G.x + Math.sin(m.ry) * 0.8, y: m.floorY, z: G.z + Math.cos(m.ry) * 0.8 }, yaw: m.ry, pitch: 0.3, dist: 3 }); B.advance(0.5, 1 / 60); const snap = () => ({ pressed: G.pressed, lever: +G.lever.rotation.x.toFixed(2), bars: +g.node.position.y.toFixed(2), wave: W.active, radius: +W.radius.toFixed(1), glyphs: W.livingGlobal, lights: G.lights.matrixLiving, grip: G.grip.matrixLiving, frame: !!G.button.matrixLiving, arm: !!G.lever.matrixLiving }); const before = { near: G.near, ...snap() }; const pressedIn = G.press(); B.advance(3, 1 / 60); const on = snap(), originalQuality = B.renderer.quality, tiers = []; for (const quality of ["high", "medium", "low"]) { B.renderer.setQuality(quality); B.advance(1 / 60, 1 / 60); tiers.push({ quality: D.quality, density: D.qualityDensity, coverage: D.drawnGlyphCount / D.surfaceGlyphCount }); } B.renderer.setQuality(originalQuality); B.advance(1 / 60, 1 / 60); const pressedOut = G.press(); B.advance(6, 1 / 60); return { before, pressedIn, on, tiers, pressedOut, off: snap() }; })()`);
  record("hub matrix: pushing the glyphed room lever up lights its green accents, raises the mirror's bars and spreads the glyph wave; pulling it down reverses each change", r.before.near && r.before.lever > 2.5 && !r.before.wave && !r.before.lights && !r.before.grip && !r.before.frame && !r.before.arm && r.before.bars === 0 && r.pressedIn && r.on.pressed && r.on.lever < 0.5 && r.on.lights && r.on.grip && !r.on.frame && !r.on.arm && r.on.bars > 3 && r.on.wave && r.on.radius > 30 && r.on.glyphs && r.pressedOut && !r.off.pressed && r.off.lever > 2.5 && !r.off.lights && !r.off.grip && r.off.bars === 0 && !r.off.wave && !r.off.glyphs, JSON.stringify(r));
  record("hub matrix: high, medium and low WebGL quality retain all glyph lanes instead of exposing black backing panels", r.tiers.every((tier, i) => tier.quality === ["high", "medium", "low"][i] && tier.density === 1 && tier.coverage > 0.55), JSON.stringify(r.tiers));
  const carved = await b.evaluate(`(() => { const B = __ooga, D = BL.scenes.hub.debug, skip = new Set(["c730", "c5"]), rooms = new Map(B.mouths.map(mouth => [mouth.id, mouth.room])); return {
    caves: D.matrixCave.caves.filter(cave => !skip.has(cave.id)).map(cave => ({ id: cave.id, terrain: cave.terrainFaces, counts: { ...cave.surfaceCounts } })),
    regions: D.caveSections.map(entry => { const room = rooms.get(entry.region.id); return { id: entry.region.id, width: entry.region.halfWidth, depth: entry.region.halfDepth, expectedWidth: room.w / 2 + 0.45, expectedDepth: (room.to + 1.6) / 2 }; }),
    sealed: B.matrixGate.sealed.map(entry => ({ id: entry.mouth.id, visible: entry.node.visible, stop: entry.stopZ }))
  }; })()`);
  // Open and mirror caves carry a bird's-eye roof region; the sealed c9 and c10 carry a seal.
  record("hub caves: every ordinary carved chamber feeds complete Matrix surfaces, fitted bird's-eye roof regions and the two sealed caves' seals", carved.caves.length === 6 && [...new Set(carved.caves.map(cave => cave.id))].sort().join() === "c1,c10,c11,c2,c3,c9"
    && carved.caves.every(cave => cave.terrain > 0 && cave.counts.floor > 0 && cave.counts.ceiling > 0 && cave.counts.wall > 0)
    && carved.regions.length === 4 && carved.regions.map(region => region.id).sort().join() === "c1,c11,c2,c3"
    && carved.regions.every(region => Math.abs(region.width - region.expectedWidth) < 1e-7 && Math.abs(region.depth - region.expectedDepth) < 1e-7)
    && carved.sealed.length === 2 && carved.sealed.map(entry => entry.id).sort().join() === "c10,c9" && carved.sealed.every(entry => entry.visible && Number.isFinite(entry.stop)), JSON.stringify(carved));
} };
const hubMirror = { name: "hub mirror", why: "rule: 500 damage shatters the mirror, unlocks its gate and ends the glyph hint; a short scene trip preserves the broken mirror before its repair delay", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, M = B.mirrorCave, g = M.gate, w = M.node.world, G = B.matrixGate, m = M.mouth; B.pilot.navigate({ position: { x: G.x + Math.sin(m.ry) * 0.8, y: m.floorY, z: G.z + Math.cos(m.ry) * 0.8 }, yaw: m.ry, pitch: 0.3, dist: 3 }); B.advance(0.5, 1 / 60); const before = { broken: M.damage.broken, locked: g.locked, hint: M.guides.state.doorway }; M.damage.hit(499, w[12], w[13], w[14]); B.advance(1 / 60, 1 / 60); const whole = { broken: M.damage.broken, locked: g.locked }; M.damage.hit(1, w[12], w[13], w[14]); B.advance(1 / 60, 1 / 60); const u0 = M.guides.state.doorwayUpdates; B.advance(1, 1 / 60); const after = { broken: M.damage.broken, shattered: M.shattered, locked: g.locked, reveal: M.node.mirrorReveal, hint: M.guides.state.doorway, frozen: M.guides.state.doorwayUpdates === u0 }; B.go("pool"); let n = 0; while ((B.transitioning || B.scene !== "pool") && n++ < 600) B.advance(1 / 30, 1 / 30); B.go("hub"); n = 0; while ((B.transitioning || B.scene !== "hub") && n++ < 600) B.advance(1 / 30, 1 / 30); B.advance(0.5, 1 / 60); const N = B.mirrorCave; return { before, whole, after, back: { broken: N.damage.broken, shattered: N.shattered, locked: N.gate.locked, reveal: N.node.mirrorReveal, hint: N.guides.state.doorway } }; })()`);
  record("hub mirror: 499 damage leaves it whole and locked, 500 shatters it open with its gate unlocked and the glyph hint stopped, and it is still broken after a trip away", !r.before.broken && r.before.locked && r.before.hint && !r.whole.broken && r.whole.locked && r.after.broken && r.after.shattered && !r.after.locked && r.after.reveal === 1 && !r.after.hint && r.after.frozen && r.back.broken && r.back.shattered && !r.back.locked && r.back.reveal === 1 && !r.back.hint, JSON.stringify(r));
} };
// The Canvas 2D fallback, for a device without WebGL2: every scene, entered in one page, paints real
// colour (sampled small, after the arrival fade) and keeps the leave contract; the console stays clean.
const canvasTour = { name: "canvas2d tour", why: "contract: the Canvas 2D fallback boots and draws every scene with the leave contract kept", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, c = document.getElementById("scene"), t = document.createElement("canvas"); t.width = t.height = 8; const x = t.getContext("2d", { willReadFrequently: true }); const paint = () => { x.drawImage(c, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data, seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return seen.size; }; const rows = { hub: { kind: B.renderer.kind, colours: paint() } }; for (const id of ["lab", "race", "drop", "orbit", "mine", "pool", "arcade", "hub"]) { B.go(id); let n = 0; while ((B.transitioning || B.scene !== id) && n++ < 600) B.advance(1 / 30, 1 / 30); B.advance(0.5, 1 / 30); rows[id === "hub" ? "back" : id] = { arrived: B.scene === id && !B.transitioning, colours: paint() }; } return rows; })()`);
  record("canvas2d tour: with WebGL2 unavailable every scene still boots, arrives and paints", r.hub.kind === "canvas2d" && Object.entries(r).every(([, row]) => row.colours >= 4 && row.arrived !== false), JSON.stringify(r));
} };

// Weapons and the jetpack, through real keys with time driven by advance: melee breaks each prop in its
// share of hits and it comes back, the AK spends and swaps magazines, the jetpack climbs, burns, refills,
// and a fall into the abyss keeps the permanent pack while emptying loaded and spare magazines.
const tapKey = async (b, key) => {
  const code = key === " " ? "Space" : /^[0-9]$/.test(key) ? "Digit" + key : "Key" + key.toUpperCase();
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
};
// The board's rotation and ticker derive from the baked data, so the check reads its
// expectations from the same file rather than pinning counts that move with the org.
const hubJumbotron = { name: "hub jumbotron", why: "rule: the rotation runs recent, org totals and five org boards, then each active repo's summary and five boards, and a draft PR ticks as DRAFT PR", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = window.__ooga, j = B.jumbotron, data = window.BL.jumbotronData;
    const ref = Date.parse(data.meta.generated_at) || Date.now();
    const active = data.repos.filter((repo) => repo.last_activity_at && ref - Date.parse(repo.last_activity_at) <= 7 * 24 * 3600 * 1000).slice(0, 6);
    j.goToView(0);
    const captions = [];
    for (let i = 0; i < j.count; i++) { captions.push(j.caption); j.nextView(); }
    const wrapped = j.caption;
    // Same single-row feed twice, the pr flagged draft and not: the ticker's type column must differ.
    const feed = (draft) => ({ ...data, recent: [{ login: data.contributors[0].login, repo: data.repos[0].name, type: "pr", occurred_at: data.meta.generated_at, draft }] });
    const column = () => { j.setView("recent"); B.advance(0.2, 1 / 30); return j.canvas.getContext("2d").getImageData(126, 12, 60, 92).data.join(); };
    j.refreshData(feed(false));
    const plain = column();
    j.refreshData(feed(true));
    const drafted = column();
    j.refreshData(data);
    j.goToView(0);
    return { count: j.count, expected: 2 + 5 + active.length * 6, captions: captions.slice(0, 8), wrapped, differs: plain !== drafted };
  })()`);
  const orgBoards = ["commits", "prs", "reviews", "comments", "issues"].map((t) => "org Â· " + t);
  record("hub jumbotron: the rotation is recent, org totals, five org leaderboards, then six slides per active repo, wrapping back to the start", r.count === r.expected && r.captions[0] === "Recent activity" && r.captions[1] === "Org totals" && orgBoards.every((c, i) => r.captions[2 + i] === c) && r.wrapped === "Recent activity", JSON.stringify(r));
  record("hub jumbotron: a draft PR draws a different ticker row than the same PR undrafted", r.differs, JSON.stringify({ differs: r.differs }));
} };
// The healthiest of its kind, so a prop an earlier step shot at is never the one measured.
const nextTo = (prop, gap, yaw = "-Math.PI / 2", pitch = 0.3) => `(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"); if (B.crew.player !== a) B.pilot.possess(a); const r = B.headquarters.breakables.list.filter((r) => r.owner.prop === "${prop}" && r.owner.active && !r.broken).sort((a, b) => b.health - a.health)[0]; window.__target = r; const t = r.owner.node.position; B.pilot.navigate({ position: { x: t.x - ${gap}, y: a.root.position.y, z: t.z }, yaw: ${yaw}, pitch: ${pitch}, dist: 4 }); B.advance(0.3, 1 / 60); return r.health; })()`;
const hubMelee = { name: "hub melee", why: "rule: a ready swing does five damage, so a box breaks in one, a barrel in two and a rock in four, and the prop comes back", run: async (b) => {
  const swings = {};
  await tapKey(b, "1");
  for (const [prop, gap] of [["crate", 0.9], ["barrel", 0.9], ["rock", 1.175]]) {
    const health = await b.evaluate(nextTo(prop, gap));
    let n = 0;
    while (n < 7 && !(await b.evaluate(`window.__target.broken`))) {
      await tapKey(b, "v");
      await b.evaluate(`window.__ooga.advance(0.65, 1 / 60)`);
      n++;
    }
    swings[prop] = { health, n };
  }
  const back = await b.evaluate(`(() => { const r = window.__target, B = window.__ooga; for (let t = 0; t < 65; t++) { B.advance(1, 1 / 30); if (!r.broken) return { t: t + 1, health: r.health, active: r.owner.active }; } return null; })()`);
  record("hub melee: one swing breaks a box, two a barrel and four a rock, and a broken rock is back whole within a minute", swings.crate.n === 1 && swings.barrel.n === 2 && swings.rock.n === 4 && !!back && back.t >= 30 && back.t <= 61 && back.health === swings.rock.health && back.active, JSON.stringify({ swings, back }));
  await b.evaluate(nextTo("rock", 1.175));
  const recharge = await b.evaluate(`(() => {
    const B = window.__ooga, crew = B.crew, a = crew.player, r = window.__target;
    const rows = [], overlay = document.getElementById("overlay").getContext("2d"), labels = [];
    const fillText = overlay.fillText;
    overlay.fillText = function(text, x, y) { if (this.fillStyle === "#ff4545") labels.push(String(text)); return fillText.call(this, text, x, y); };
    try {
      const ready = crew.meleePower(a);
      for (const wait of [0, 0.05, 0.1, 0.15, 0.2]) {
        if (wait) B.advance(wait, 0.01);
        r.health = r.maxHealth;
        const before = r.health;
        crew.swingWeapon(a, true, true);
        crew.releaseSwing(a, false, true, true);
        rows.push({ wait, damage: before - r.health, after: crew.meleePower(a) });
      }
      B.advance(0.2, 0.01);
      const recovered = crew.meleePower(a);
      crew.selectWeapon(a, 2); crew.selectWeapon(a, 1);
      r.health = r.maxHealth;
      const before = r.health;
      crew.swingWeapon(a);
      const last = before - r.health;
      crew.selectWeapon(a, 2); crew.selectWeapon(a, 1);
      const switched = crew.meleePower(a);
      r.health = r.maxHealth;
      const health = r.health;
      crew.swingWeapon(a);
      B.advance(0.01, 0.01);
      const finalDamage = health - r.health;
      B.advance(0.2, 0.01);
      r.health = r.maxHealth;
      crew.swingWeapon(a, true, true);
      a.weapon.meleeCharge = 1;
      const chargedBefore = r.health;
      crew.releaseSwing(a, false, true);
      return { ready, recovered, rows, last, switched, finalDamage, chargedDamage: chargedBefore - r.health, labels };
    } finally { overlay.fillText = fillText; }
  })()`);
  const powers = [5, 1.25, 1.25, 3.125, 5];
  record("hub melee: focused quick taps start at normal power, rapid contacts recover linearly after 0.1s and every hit restarts recovery", recharge.ready === 1 && Math.abs(recharge.recovered - 1) < 1e-8
    && recharge.rows.every((row, i) => Math.abs(row.damage - powers[i]) < 1e-8 && row.after === 0.25)
    && Math.abs(recharge.last - 5) < 1e-8 && recharge.switched === 0.25 && Math.abs(recharge.finalDamage - 1.25) < 1e-8
    && Math.abs(recharge.chargedDamage - 10) < 1e-8, JSON.stringify(recharge));
  record("hub melee: red damage numbers round full hit power to half points", ["5", "1.5", "3", "10"].every(text => recharge.labels.includes(text)), JSON.stringify(recharge.labels));
} };
const AK_STATE = `(() => { const w = window.__ooga.crew.player.weapon; return { ammo: w.ammo, spares: w.spareAmmo.slice(), shots: w.shotsFired }; })()`;
const hubAk = { name: "hub ak", why: "regression: R did nothing unless the player was aiming, so an AK emptied with V could not swap in its spare", run: async (b) => {
  const barrel = await b.evaluate(nextTo("barrel", 3, -1.34, 0.12));
  await tapKey(b, "2");
  await b.evaluate(`window.__ooga.advance(0.4, 1 / 60)`);
  const start = await b.evaluate(AK_STATE);
  const burst = async () => { await tapKey(b, "v"); await b.evaluate(`window.__ooga.advance(0.7, 1 / 60)`); return b.evaluate(AK_STATE); };
  const one = await burst(), two = await burst(), dry = await burst();
  const hit = await b.evaluate(`window.__target.broken || window.__target.health < ${barrel}`);
  await tapKey(b, "r");
  await b.evaluate(`window.__ooga.advance(0.8, 1 / 60)`);
  const swapped = await b.evaluate(AK_STATE);
  record("hub ak: V fires a burst of three from the magazine, an empty magazine fires nothing, the bananas hit, and R swaps in the full spare without aiming", start.ammo === 6 && one.ammo === 3 && two.ammo === 0 && dry.shots === two.shots && hit && swapped.ammo === 30 && swapped.spares.every((n) => n === 0), JSON.stringify({ start, one, two, dry, hit, swapped }));
} };
const JET_STATE = `(() => { const c = window.__ooga.crew.player, J = window.__ooga.jetpack; return { worn: !!c.jet, owned: J.owned, fuel: +c.jetFuel.toFixed(3), feet: +(c.root.position.y - c.baseY).toFixed(2), pickup: !!(J.pickup && J.pickup.host), toast: (document.getElementById("toast") || {}).textContent }; })()`;
const hubJetpack = { name: "hub jetpack", why: "rule: every Ooga permanently owns a J-toggleable jetpack, while abyss respawns remove only loaded and spare AK ammo", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga; B.pilot.navigate({ position: { x: -8, y: B.crew.player.root.position.y, z: 16 }, yaw: -Math.PI / 2, pitch: 0.3, dist: 5 }); B.advance(0.4, 1 / 60); })()`);
  await tapKey(b, "j");
  const off = await b.evaluate(JET_STATE);
  await tapKey(b, "j");
  const on = await b.evaluate(JET_STATE);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", text: " " });
  await b.evaluate(`window.__ooga.advance(2, 1 / 60)`);
  const up = await b.evaluate(JET_STATE);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space" });
  await b.evaluate(`window.__ooga.advance(6, 1 / 60)`);
  const down = await b.evaluate(JET_STATE);
  await b.evaluate(`(() => { const B = window.__ooga, a = B.crew.player, I = B.island, ang = Math.PI / 4; let r = 5; while (I.onLand(Math.sin(ang) * r, Math.cos(ang) * r)) r += 0.25; r -= 1.5; const x = Math.sin(ang) * r, z = Math.cos(ang) * r; B.pilot.navigate({ position: { x, y: I.surfaceAt(x, z), z }, yaw: ang + Math.PI, pitch: 0.4, dist: 10 }); B.advance(0.5, 1 / 60); })()`);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", text: "w" });
  const fell = await b.evaluate(`(() => { const B = window.__ooga, a = B.crew.player, p = a.root.position; let low = Infinity; for (let i = 0; i < 20 * 30; i++) { B.advance(1 / 30, 1 / 30); low = Math.min(low, p.y - a.baseY); if (low < -50 && Math.hypot(p.x, p.z) < 12) break; } return low; })()`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW" });
  const lost = await b.evaluate(JET_STATE);
  const permanent = await b.evaluate(`(() => {
    const B = __ooga, a = B.crew.player, geometry = new Set();
    B.headquarters.breakables.liveGeometry(geometry);
    const rewardHasJetpack = geometry.has(BL.hubModels.jetpack());
    const ammo = a.weapon.ammo, spares = a.weapon.spareAmmo.length, everyOwned = B.crew.list.every(cave => cave.jetpackOwned);
    B.crew.collectMagazine(a); B.crew.damage(a, 25); B.advance(1 / 60, 1 / 60);
    const drops = a.stunGear.drops.filter(drop => drop.active).map(drop => ({ kind: drop.kind, label: drop.label }));
    return { ammo, spares, everyOwned, rewardHasJetpack, drops, wornAfterStun: !!a.jet };
  })()`);
  record("hub jetpack: J takes the permanent pack off and on, Space climbs, fuel refills, and an abyss respawn keeps it while emptying loaded and spare AK magazines", !off.worn && on.worn && up.feet > 5 && up.fuel < 0.9 && down.feet < 0.5 && down.fuel === 1 && fell < -50
    && lost.owned && lost.worn && !lost.pickup && permanent.ammo === 0 && permanent.spares === 0 && permanent.everyOwned
    && lost.toast === "Spare magazines and loaded AK-47 ammo lost to the abyss", JSON.stringify({ off, on, up, down, fell, lost, permanent }));
  record("hub jetpack: breakables and clouds contain no jetpack pickup, stun keeps the pack, and dropped magazines carry a +1 MAG tag", !permanent.rewardHasJetpack && permanent.wornAfterStun
    && permanent.drops.length === 1 && permanent.drops[0].kind === "magazine" && permanent.drops[0].label === "+1 MAG", JSON.stringify(permanent));
} };

const hubBirdsEye = { name: "birds-eye combat camera", why: "regression: centered zoom retains its world target at the screen edge, keys rotate smoothly, and carry handoffs preserve the cursor and camera distance", run: async (b) => {
  const focusPoint = await b.evaluate(`(() => { const B = __ooga, a = B.pilot.player; B.pilot.release(true); B.advance(0.1, 1 / 60); return B.project(a.root.position.x, a.root.position.y - a.baseY + a.bodyHeight * 0.55, a.root.position.z, {}); })()`);
  await b.click(focusPoint.x, focusPoint.y);
  await b.click(focusPoint.x, focusPoint.y);
  const focused = await b.evaluate(`(() => { const P = __ooga.pilot, canvas = document.getElementById("scene"), out = { mode: P.mode, combat: P.aiming, focused: document.activeElement === canvas || document.pointerLockElement === canvas }; if (document.pointerLockElement === canvas) document.exitPointerLock(); return out; })()`);
  record("birds-eye combat: double-clicking an Ooga enters shoulder combat with mouse-look already focused", focused.mode === "shoulder" && focused.combat && focused.focused, JSON.stringify(focused));
  const selectionModes = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, C = B.camera, a = P.player, rows = [];
    P.navigate({ position: { x: -8, y: 0, z: 8 }, yaw: 0, pitch: 0.3, dist: 4 }); B.advance(1, 1 / 60);
    const selectFrom = clearance => {
      P.release(true);
      const p = a.root.position, headY = p.y - a.baseY + a.headOffset + a.viewLift;
      Object.assign(C.position, { x: p.x + 4, y: headY + clearance, z: p.z + 3 });
      Object.assign(C.target, { x: p.x, y: headY, z: p.z }); C.up = null;
      const before = { ...C.position };
      P.hooks.onDoubleTap({ owner: { kind: "caveman", cave: a } });
      const immediate = Math.hypot(C.position.x - before.x, C.position.y - before.y, C.position.z - before.z);
      B.advance(1, 1 / 60);
      rows.push({ clearance, selected: P.player === a, mode: P.mode, combat: P.aiming, immediate, heightError: Math.abs(C.position.y - before.y),
        offset: Math.hypot(C.position.x - a.root.position.x, C.position.z - a.root.position.z) });
    };
    if (!P.aiming) P.modeAction("mode-toggle");
    selectFrom(30);
    P.modeAction("mode-toggle"); selectFrom(30);
    selectFrom(20.9);
    P.modeAction("mode-toggle"); selectFrom(5);
    P.navigate({ position: { x: 6, y: B.island.headquarters.basement.floor, z: 0 }, yaw: 0, pitch: 0.3, dist: 4 }); B.advance(1, 1 / 60);
    selectFrom(21); selectFrom(5);
    return rows;
  })()`);
  record("possession: high free-roam double-click preserves altitude and each character's carry/combat choice, including below ground",
    selectionModes.length === 6 && selectionModes.every(row => row.selected && row.immediate < 1e-6)
    && selectionModes[0].mode === "birds-eye" && selectionModes[0].combat && selectionModes[0].heightError < 0.01 && selectionModes[0].offset < 0.01
    && selectionModes[1].mode === "orbit" && !selectionModes[1].combat && selectionModes[1].heightError < 0.01
    && selectionModes[2].mode === "shoulder" && !selectionModes[2].combat
    && selectionModes[3].mode === "shoulder" && selectionModes[3].combat
    && selectionModes[4].mode === "birds-eye" && selectionModes[4].combat && selectionModes[4].heightError < 0.01
    && selectionModes[5].mode === "shoulder" && selectionModes[5].combat, JSON.stringify(selectionModes));
  const rightViews = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, C = B.camera, a = P.player, canvas = document.getElementById("scene"), rows = [];
    const pointer = type => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 92, isPrimary: true, button: 2,
        buttons: type === "pointerdown" ? 2 : 0, clientX: B.renderer.size.width / 2, clientY: B.renderer.size.height / 2
      }));
    const click = (release = true) => { pointer("pointerdown"); if (release) pointer("pointerup"); };
    const sample = () => ({ mode: P.mode, combat: P.aiming, distance: P.orbit.dist, wanted: P.orbit.tDist,
      height: P.birdsEyeHeight, y: C.position.y, horizontal: Math.hypot(C.position.x - a.root.position.x, C.position.z - a.root.position.z) });
    for (const floor of [0, B.island.headquarters.basement.floor]) {
      P.navigate({ position: { x: -8, y: floor, z: 8 }, yaw: 0, pitch: 0.3, dist: 4 });
      if (P.aiming) P.modeAction("mode-toggle");
      B.advance(1, 1 / 60);
      const before = sample(); click(); const single = sample(); click(false); const immediate = sample();
      B.advance(2, 1 / 60); const out = sample();
      click(); B.advance(1, 1 / 60); const back = sample();
      P.hooks.onZoom(1.2); B.advance(2, 1 / 60); const wheelOut = sample();
      P.hooks.onZoom(0.99); B.advance(1, 1 / 60); const wheelBack = sample();
      rows.push({ floor, before, single, immediate, out, back, wheelOut, wheelBack });
    }
    P.hooks.onZoom(0.8); B.advance(1, 1 / 60); const carryFirst = sample();
    P.hooks.onZoom(1.2); B.advance(1, 1 / 60); const carryScrollBack = sample();
    P.hooks.onZoom(0.8); B.advance(1, 1 / 60);
    click(); click(false); B.advance(1, 1 / 60); const carryFirstOut = sample();
    click(); B.advance(1, 1 / 60); const carryFirstBack = sample();
    P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
    P.modeAction("mode-toggle"); B.advance(1, 1 / 60);
    click(); click(false); B.advance(1, 1 / 60); const combatOut = sample();
    click(); B.advance(1, 1 / 60); const combatBack = sample();
    P.hooks.onZoom(0.8); B.advance(1, 1 / 60); const combatFirst = sample();
    click(); click(false); B.advance(1, 1 / 60); const combatFirstOut = sample();
    click(); B.advance(1, 1 / 60); const combatFirstBack = sample();
    return { rows, carryFirst, carryScrollBack, carryFirstOut, carryFirstBack, combatOut, combatBack,
      combatFirst, combatFirstOut, combatFirstBack };
  })()`);
  record("view gestures: right-click returns from orbit to the prior shoulder or first-person view, and first-person scroll exits to shoulder",
    rightViews.rows.every(r => r.single.mode === "shoulder" && !r.single.combat && Math.abs(r.immediate.y - r.before.y) < 1e-6
      && [r.out, r.wheelOut].every(s => s.mode === "orbit" && !s.combat && Math.abs(s.distance - 6) < 0.01 && s.wanted === 6)
      && [r.back, r.wheelBack].every(s => s.mode === "shoulder" && !s.combat))
    && rightViews.rows[0].out.horizontal < 0.01
    && Math.abs(rightViews.rows[1].out.y - rightViews.rows[1].before.y) < 0.01
    && rightViews.carryFirst.mode === "first-person" && !rightViews.carryFirst.combat
    && rightViews.carryScrollBack.mode === "shoulder" && !rightViews.carryScrollBack.combat
    && rightViews.carryFirstOut.mode === "orbit" && !rightViews.carryFirstOut.combat
    && rightViews.carryFirstBack.mode === "first-person" && !rightViews.carryFirstBack.combat
    && rightViews.combatOut.mode === "birds-eye" && rightViews.combatOut.combat && rightViews.combatOut.height === 21
    && rightViews.combatBack.mode === "shoulder" && rightViews.combatBack.combat
    && rightViews.combatFirst.mode === "first-person" && rightViews.combatFirst.combat
    && rightViews.combatFirstOut.mode === "birds-eye" && rightViews.combatFirstOut.combat
    && rightViews.combatFirstBack.mode === "first-person" && rightViews.combatFirstBack.combat, JSON.stringify(rightViews));
  const shoulderFraming = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, a = P.player, rows = [];
    const sample = () => {
      const C = B.camera, p = a.root.position, dx = C.position.x - C.target.x, dz = C.position.z - C.target.z, length = Math.hypot(dx, dz);
      const side = ((C.position.x - p.x) * dz - (C.position.z - p.z) * dx) / length / a.traits.height;
      BL.scene.updateWorld(a.root); const w = a.parts.head.world, head = B.project(w[12], w[13], w[14], {});
      return { mode: P.mode, side, headOffset: B.renderer.size.width / 2 - head.x };
    };
    for (const location of [{ x: -8, y: 0, z: 8 }, { x: 6, y: B.island.headquarters.basement.floor, z: 0 }]) {
      P.navigate({ position: location, yaw: 0, pitch: 0.3, dist: 4 }); B.advance(1, 1 / 60);
      const baseline = sample();
      for (const offset of [0, 0.4]) {
        P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
        const point = B.project(a.root.position.x + offset, location.y + 0.01, a.root.position.z, {});
        P.hooks.onOrbit(-1e6, -1e6); P.hooks.onOrbit(point.x, point.y); B.advance(0.2, 1 / 60);
        P.hooks.onZoom(0.001); B.advance(2, 1 / 60); const settled = sample();
        P.hooks.onOrbit(12, 0); B.advance(0.7, 1 / 60);
        rows.push({ floor: location.y, offset, baseline, settled, looking: sample() });
      }
    }
    return rows;
  })()`);
  record("shoulder combat: zooming toward the feet keeps the normal head-side framing above and below ground, including after mouse-look", shoulderFraming.length === 4 && shoulderFraming.every(row => row.baseline.side > 0.5 && [row.settled, row.looking].every(s => s.mode === "shoulder" && Math.abs(s.side - row.baseline.side) < 0.001 && s.headOffset > 0)), JSON.stringify(shoulderFraming));
  const entry = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, C = B.camera, a = P.player;
    P.navigate({ position: { x: -8, y: 0, z: 8 }, yaw: 0, pitch: 0.3, dist: 4 }); B.advance(1, 1 / 60);
    const view = BL.math.mat4.create();
    window.__birdsSnapshot = () => { const rect = document.getElementById("scene").getBoundingClientRect(), reticle = document.getElementById("weapon-reticle"), screen = B.project(a.root.position.x, a.root.position.y, a.root.position.z, {});
      BL.math.mat4.lookAt(view, C.position, C.target, C.up || { x: 0, y: 1, z: 0 });
      return { mode: P.mode, combat: P.aiming, overhead: P.birdsEye, mix: P.birdsEyeMix, height: P.birdsEyeHeight,
      altitude: C.position.y - (a.root.position.y - a.baseY), horizontal: Math.hypot(C.position.x - a.root.position.x, C.position.z - a.root.position.z),
      down: (C.position.y - C.target.y) / Math.hypot(C.target.x - C.position.x, C.target.y - C.position.y, C.target.z - C.position.z),
      yaw: a.root.rotation.y, x: C.position.x, y: C.position.y, z: C.position.z,
      distance: Math.hypot(C.position.x - a.root.position.x, C.position.y - a.root.position.y, C.position.z - a.root.position.z),
      center: screen ? Math.hypot(screen.x - B.renderer.size.width / 2, screen.y - B.renderer.size.height / 2) : Infinity,
      pointer: P.cursor.active ? [P.cursor.x, P.cursor.y] : [rect.left + parseFloat(reticle.style.left), rect.top + parseFloat(reticle.style.top)],
      forward: [-view[2], -view[6], -view[10]], screenUp: [view[1], view[5], view[9]], orthoMix: C.orthoMix || 0, fov: C.fov,
      up: C.up ? [C.up.x, C.up.y, C.up.z] : [0, 1, 0], cutoff: B.renderOpts.cutawayMaxY }; };
    const weaponDirection = () => { BL.scene.updateWorld(a.root); const w = a.parts.gun.world, length = Math.hypot(w[8], w[9], w[10]); return [w[8] / length, w[9] / length, w[10] / length]; };
    const weaponBefore = weaponDirection(), before = __birdsSnapshot(); P.hooks.onZoom(1.2); P.update(0);
    const weaponAfter = weaponDirection(), weaponSnap = Math.hypot(...weaponAfter.map((value, i) => value - weaponBefore[i]));
    const immediate = Math.hypot(C.position.x - before.x, C.position.y - before.y, C.position.z - before.z);
    let maxStep = 0, finite = true, last = [C.position.x, C.position.y, C.position.z];
    for (let i = 0; i < 90; i++) { B.advance(1 / 60, 1 / 60); const p = C.position;
      maxStep = Math.max(maxStep, Math.hypot(p.x - last[0], p.y - last[1], p.z - last[2]));
      finite = finite && [p.x, p.y, p.z, C.target.x, C.target.y, C.target.z].every(Number.isFinite); last = [p.x, p.y, p.z]; }
    return { before, immediate, weaponSnap, maxStep, finite, after: __birdsSnapshot() };
  })()`);
  record("birds-eye combat: shoulder zoom enters directly overhead with a continuous finite camera path", entry.before.mode === "shoulder" && entry.after.mode === "birds-eye" && entry.after.overhead && entry.after.combat && entry.after.mix === 1 && entry.after.horizontal < 1e-6 && entry.after.down > 0.999999 && entry.immediate < 1e-6 && entry.weaponSnap < 1e-5 && entry.maxStep < 3 && entry.finite, JSON.stringify(entry));
  const outlines = await b.evaluate(`(() => { const B = __ooga, H = B.headquarters; B.advance(0.1, 1 / 60); return {
    mode: B.pilot.mode, combat: B.pilot.aiming, wallLines: H.sightGuides.structureCount, objectLines: H.sightGuides.objectCount,
    wall: !!H.sightGuides.structure || !!H.sightGuides.structures, bananaWall: !!H.bananaGuides.structure || !!H.bananaGuides.structures,
    guideLines: H.cameraCover.guideLines, outlined: H.cameraCover.outlined
  }; })()`);
  record("birds-eye combat: wall and object outline passes stay disabled", outlines.mode === "birds-eye" && outlines.combat && !outlines.wallLines && !outlines.objectLines
    && !outlines.wall && !outlines.bananaWall && !outlines.guideLines && !outlines.outlined, JSON.stringify(outlines));
  const size = await b.evaluate(`(() => { const r = document.getElementById("scene").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  await b.mouse("mouseMoved", size.x, size.y, { button: "none" });
  await b.evaluate(`__ooga.pilot.focusAim()`);
  await b.mouse("mouseMoved", size.x + size.w * 0.22, size.y + size.h * 0.14, { button: "none" });
  await b.evaluate(`__ooga.advance(0.5, 1 / 60)`);
  const aim = await b.evaluate(`__birdsSnapshot()`);
  const turn = Math.abs(Math.atan2(Math.sin(aim.yaw - entry.after.yaw), Math.cos(aim.yaw - entry.after.yaw)));
  record("birds-eye combat: real mouse movement changes character facing without orbiting the overhead camera", turn > 0.15 && aim.horizontal < 1e-6 && aim.down > 0.999999 && aim.up.every((n, i) => Math.abs(n - entry.after.up[i]) < 1e-6), JSON.stringify({ before: entry.after, aim, turn }));
  const centered = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, R = B.renderer, a = P.player, reticle = document.getElementById("weapon-reticle"), canvas = document.getElementById("scene"), rect = canvas.getBoundingClientRect(), ray = {};
    P.hooks.onZoom(60 / P.birdsEyeHeight); B.advance(1.5, 1 / 60); const before = __birdsSnapshot();
    const width = R.size.width, height = R.size.height, inset = parseFloat(reticle.style.getPropertyValue("--reticle-radius"));
    const pointer = () => ({ x: parseFloat(reticle.style.left), y: parseFloat(reticle.style.top) });
    // In a settled overhead projection every point on this vertical ray shares
    // the same pixel, whether the actual hit is land or an item's raised face.
    const pointAt = (x, y) => { R.ray(x, y, B.camera, ray); const t = (a.root.position.y - a.baseY - a.hop - ray.oy) / ray.dy;
      return { x: ray.ox + ray.dx * t, y: ray.oy + ray.dy * t, z: ray.oz + ray.dz * t }; };
    const start = { x: width * 0.84, y: height * 0.64 }, original = pointAt(start.x, start.y);
    P.hooks.onOrbit(-1e6, -1e6); P.hooks.onOrbit(start.x, start.y);
    // Scroll before another frame refreshes aim: the anchor must come from
    // this pointer position, not the previous assisted hit or cached ground ray.
    let anchor = original, center = 0, horizontal = 0, minHeight = before.height, screenError = 0, edgeError = 0, directionError = 0, boundsError = 0, inside = 0, outside = 0;
    const sample = () => {
      const s = __birdsSnapshot(), p = pointer(), projected = R.project(anchor.x, anchor.y, anchor.z, {});
      center = Math.max(center, s.center); horizontal = Math.max(horizontal, s.horizontal); minHeight = Math.min(minHeight, s.height);
      if (projected.x >= inset && projected.x <= width - inset && projected.y >= inset && projected.y <= height - inset) {
        inside++; screenError = Math.max(screenError, Math.hypot(p.x - projected.x, p.y - projected.y));
      } else {
        outside++; edgeError = Math.max(edgeError, Math.min(Math.abs(p.x - inset), Math.abs(width - inset - p.x), Math.abs(p.y - inset), Math.abs(height - inset - p.y)));
        const dx = projected.x - width / 2, dy = projected.y - height / 2, px = p.x - width / 2, py = p.y - height / 2;
        directionError = Math.max(directionError, dx * px + dy * py > 0 ? Math.abs(dx * py - dy * px) / Math.hypot(dx, dy) : Infinity);
      }
      boundsError = Math.max(boundsError, inset - p.x, p.x - (width - inset), inset - p.y, p.y - (height - inset));
    };
    const zoom = (factor, frames = 60) => { P.hooks.onZoom(factor); for (let i = 0; i < frames; i++) { B.advance(1 / 60, 1 / 60); sample(); } };
    zoom(0.75); const moved = pointer(); zoom(0.8); const edge = pointer(); zoom(0.9); const repeated = pointer();
    const unlocked = document.pointerLockElement !== canvas; P.focusAim();
    const mouse = (dx, dy) => canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: rect.left + start.x, clientY: rect.top + start.y, movementX: dx, movementY: dy }));
    mouse(0, 0); B.advance(1 / 60, 1 / 60); sample(); const zero = pointer(), zeroError = Math.hypot(zero.x - repeated.x, zero.y - repeated.y);
    zoom(1 / (0.75 * 0.8 * 0.9), 90); const returned = pointer(), returnError = Math.hypot(returned.x - start.x, returned.y - start.y);
    zoom(0.54, 90); const clamped = pointer(), dx = -8, dy = -4;
    // Native coordinates still describe the old cursor location; only this
    // small relative movement should take over from the displayed edge mark.
    mouse(dx, dy); B.advance(1 / 60, 1 / 60); const manual = pointer(), manualError = Math.hypot(manual.x - clamped.x - dx * width / rect.width, manual.y - clamped.y - dy * height / rect.height);
    B.advance(0.2, 1 / 60); const released = pointer(), releasedError = Math.hypot(released.x - manual.x, released.y - manual.y);
    anchor = pointAt(released.x, released.y); zoom(1 / 0.54, 90);
    const final = pointer(), originalScreen = R.project(original.x, original.y, original.z, {});
    P.hooks.onOrbit(-4, -2); B.advance(1 / 60, 1 / 60); const hooked = pointer(), hookError = Math.hypot(hooked.x - final.x + 4, hooked.y - final.y + 2);
    return { before, center, horizontal, minHeight, restored: P.birdsEyeHeight, inside, outside, screenError, edgeError, directionError, boundsError,
      travel: Math.hypot(moved.x - start.x, moved.y - start.y), edge, repeated, returnError, unlocked, zeroError, manualError, releasedError, hookError,
      newTarget: Math.hypot(final.x - originalScreen.x, final.y - originalScreen.y) };
  })()`);
  record("birds-eye combat: animated zoom keeps the character centered even while aiming off-center", centered.center < 0.02 && centered.horizontal < 1e-6 && centered.minHeight < centered.before.height - 1 && Math.abs(centered.restored - centered.before.height) < 0.02, JSON.stringify(centered));
  record("birds-eye combat: zoom tracks the fresh world point, keeps an off-screen target at the directional edge across repeated scrolls and zero-motion events, and restores it on zoom-out", centered.inside > 30 && centered.outside > 30 && centered.screenError < 0.05 && centered.edgeError < 0.05 && centered.directionError < 0.05 && centered.boundsError < 0.01 && centered.travel > 20 && centered.zeroError < 0.02 && centered.returnError < 0.05, JSON.stringify(centered));
  record("birds-eye combat: small native mouse and orbit gestures release the tracked target without jumping to stale absolute coordinates", centered.unlocked && centered.manualError < 0.02 && centered.releasedError < 0.02 && centered.hookError < 0.02 && centered.newTarget > 20, JSON.stringify(centered));
  const rotation = await b.evaluate(`(() => {
    const B = __ooga, angle = () => { const s = __birdsSnapshot(); return Math.atan2(-s.up[0], -s.up[2]); }, wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
    const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
    const hold = (k, frames) => { const before = angle(); key("keydown", k); const immediate = Math.abs(wrap(angle() - before)); let total = 0, maxStep = 0, center = 0, last = before;
      for (let i = 0; i < frames; i++) { B.advance(1 / 60, 1 / 60); const next = angle(), step = wrap(next - last); total += step; maxStep = Math.max(maxStep, Math.abs(step)); center = Math.max(center, __birdsSnapshot().center); last = next; }
      key("keyup", k); B.advance(0.6, 1 / 60); const settled = angle(); B.advance(0.5, 1 / 60);
      return { before, immediate, total, maxStep, center, after: angle(), stopped: Math.abs(wrap(angle() - settled)) }; };
    const left = hold("q", 36), right = hold("e", 36), around = hold("e", 252), before = angle(); key("keydown", "n"); key("keyup", "n");
    const immediate = Math.abs(wrap(angle() - before)); let path = 0, maxStep = 0, monotonic = true, last = before, first = null;
    for (let i = 0; i < 90; i++) { B.advance(1 / 60, 1 / 60); const next = angle(), step = Math.abs(wrap(next - last)); if (!i) first = next;
      monotonic = monotonic && Math.abs(next) <= Math.abs(last) + 1e-6; path += step; maxStep = Math.max(maxStep, step); last = next; }
    return { left, right, returned: Math.abs(wrap(right.after - left.before)), around, north: { before, immediate, first, after: angle(), path, maxStep, monotonic } };
  })()`);
  record("birds-eye combat: held Q and E rotate smoothly in opposite directions and settle after release", rotation.left.total > 0.7 && rotation.right.total < -0.7 && [rotation.left, rotation.right].every(r => r.immediate < 1e-6 && r.maxStep < 0.04 && r.center < 0.02 && r.stopped < 0.001) && rotation.returned < 0.01, JSON.stringify(rotation));
  const north = rotation.north;
  record("birds-eye combat: N eases back to north along the shortest path after rotating past a full turn", Math.abs(rotation.around.total) > Math.PI * 2 && Math.abs(north.before) > 0.2 && north.immediate < 1e-6 && Math.abs(north.first) > 0.01 && Math.abs(north.first) < Math.abs(north.before) && Math.abs(north.after) < 0.001 && north.path <= Math.abs(north.before) + 0.001 && north.maxStep < 0.25 && north.monotonic, JSON.stringify(north));
  const zoom = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot; P.hooks.onZoom(100); B.advance(1.5, 1 / 60); const max = __birdsSnapshot();
    P.hooks.onZoom(100); B.advance(0.5, 1 / 60); const clamped = __birdsSnapshot();
    P.hooks.onZoom(0.75); B.advance(1, 1 / 60); const lowered = __birdsSnapshot();
    P.hooks.onZoom(100); B.advance(1, 1 / 60); const fromMax = __birdsSnapshot();
    const C = B.camera, before = [C.position.x, C.position.y, C.position.z]; P.hooks.onZoom(0.001);
    const immediate = Math.hypot(C.position.x - before[0], C.position.y - before[1], C.position.z - before[2]);
    let last = before, maxStep = 0, switchFrame = -1;
    for (let i = 0; i < 90; i++) { B.advance(1 / 60, 1 / 60); const p = C.position;
      maxStep = Math.max(maxStep, Math.hypot(p.x - last[0], p.y - last[1], p.z - last[2])); last = [p.x, p.y, p.z];
      if (switchFrame < 0 && P.mode === "shoulder") switchFrame = i + 1; }
    const shoulder = __birdsSnapshot(); P.hooks.onZoom(0.8); B.advance(1.5, 1 / 60); const first = __birdsSnapshot();
    P.hooks.onZoom(1.2); B.advance(1.5, 1 / 60); const back = __birdsSnapshot();
    P.hooks.onZoom(1.2); B.advance(1, 1 / 60); return { max, clamped, lowered, fromMax, immediate, maxStep, switchFrame, shoulder, first, back };
  })()`);
  record("birds-eye combat: a full-height inward zoom reaches the relative-height-21 shoulder handoff promptly along a continuous path, and first-person remains reachable", Math.abs(entry.after.height - 21) < 0.01 && Math.abs(zoom.max.height - zoom.clamped.height) < 0.01 && zoom.lowered.height < zoom.max.height && zoom.lowered.mode === "birds-eye" && zoom.fromMax.height > 60 && zoom.immediate < 1e-6 && zoom.maxStep < 5 && zoom.switchFrame > 0 && zoom.switchFrame < 45 && zoom.shoulder.mode === "shoulder" && zoom.first.mode === "first-person" && zoom.back.mode === "shoulder", JSON.stringify(zoom));
  await b.mouse("mouseMoved", size.x - size.w * 0.16, size.y + size.h * 0.1, { button: "none" });
  await b.evaluate(`__ooga.advance(0.5, 1 / 60)`);
  const handoffs = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, difference = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
    window.__birdsHandoff = frames => {
      const before = __birdsSnapshot(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" })); window.dispatchEvent(new KeyboardEvent("keyup", { key: "x" }));
      let last = before, eyeStep = 0, forwardStep = 0, upStep = 0, projectionStep = 0, radiusError = 0, cursorError = 0, fovError = 0, center = 0, blended = 0;
      const sample = () => { const s = __birdsSnapshot();
        eyeStep = Math.max(eyeStep, Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z));
        forwardStep = Math.max(forwardStep, difference(s.forward, last.forward)); upStep = Math.max(upStep, difference(s.screenUp, last.screenUp));
        projectionStep = Math.max(projectionStep, Math.abs(s.orthoMix - last.orthoMix)); radiusError = Math.max(radiusError, Math.abs(s.distance - before.distance));
        cursorError = Math.max(cursorError, difference(s.pointer, before.pointer)); fovError = Math.max(fovError, Math.abs(s.fov - before.fov));
        if (s.overhead && s.mix === 1) center = Math.max(center, s.center);
        if (s.orthoMix > 0 && s.orthoMix < 1) blended++;
        last = s;
      };
      sample(); const immediate = { eyeStep, forwardStep, upStep, projectionStep, radiusError, cursorError };
      for (let i = 0; i < frames; i++) { B.advance(1 / 60, 1 / 60); sample(); }
      return { before, after: last, immediate, eyeStep, forwardStep, upStep, projectionStep, radiusError, cursorError, fovError, center, blended };
    };
    const carry = __birdsHandoff(90), diagonal = [];
    for (const side of ["a", "d"]) { const before = P.orbit.tYaw; window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: side }));
      B.advance(0.4, 1 / 60); window.dispatchEvent(new KeyboardEvent("keyup", { key: side })); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
      diagonal.push(Math.abs(Math.atan2(Math.sin(P.orbit.tYaw - before), Math.cos(P.orbit.tYaw - before)))); }
    const yaw = P.orbit.tYaw; P.hooks.onOrbit(40, -70); B.advance(1, 1 / 60); const drag = { yaw: Math.abs(P.orbit.tYaw - yaw), down: __birdsSnapshot().down };
    const entering = __birdsHandoff(18), entryReversed = __birdsHandoff(90);
    const combat = __birdsHandoff(90), partial = __birdsHandoff(18), reversed = __birdsHandoff(90);
    return { carry, diagonal, drag, entering, entryReversed, combat, partial, reversed };
  })()`);
  const continuous = r => Object.values(r.immediate).every(n => n < 1e-6) && r.eyeStep < 3 && r.forwardStep < 0.15 && r.upStep < 0.15 && r.projectionStep < 0.08 && r.radiusError < 0.02 && r.cursorError < 0.02 && r.fovError < 1e-6 && r.center < 0.02 && r.blended > 2;
  record("birds-eye combat: X smoothly hands off both ways with a fixed cursor and character distance, including reversal in each direction mid-transition", [handoffs.carry, handoffs.entering, handoffs.entryReversed, handoffs.combat, handoffs.partial, handoffs.reversed].every(continuous)
    && Math.hypot(handoffs.carry.before.pointer[0] - size.x, handoffs.carry.before.pointer[1] - size.y) > 20
    && [handoffs.carry, handoffs.entryReversed].every(r => r.after.mode === "orbit" && !r.after.combat && r.after.orthoMix === 0)
    && Math.abs(handoffs.carry.after.altitude - handoffs.carry.before.altitude) < 0.02 && handoffs.carry.after.down > 0.999
    && [handoffs.entering, handoffs.partial].every(r => r.after.orthoMix > 0 && r.after.orthoMix < 1)
    && [handoffs.combat, handoffs.reversed].every(r => r.after.mode === "birds-eye" && r.after.combat && r.after.down > 0.999999 && r.after.orthoMix === 1 && r.after.center < 0.02), JSON.stringify(handoffs));
  record("birds-eye combat: carry orbit stays still on W+A and W+D, and manual orbit rotation remains available", handoffs.diagonal.every(n => n < 1e-6) && handoffs.drag.yaw > 0.1 && handoffs.drag.down < 0.99 && handoffs.carry.after.cutoff >= 1e5, JSON.stringify({ diagonal: handoffs.diagonal, drag: handoffs.drag, cutoff: handoffs.carry.after.cutoff }));
  const falling = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, I = B.island, a = P.player, C = B.camera, clouds = BL.scenes.hub.debug.matrixCave.clouds;
    const visible = clouds.map(c => c.node.visible), diagonal = -Math.SQRT1_2;
    const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: "Key" + k.toUpperCase(), bubbles: true }));
    let radius = 5; while (radius < 100 && I.onLand(diagonal * radius, diagonal * radius)) radius += 0.25;
    const x = diagonal * (radius - 1.5), z = x, start = { position: { x, y: I.surfaceAt(x, z), z }, yaw: 0, pitch: 0.4, dist: 24 };
    const run = bird => {
      if (P.aiming) P.modeAction("mode-toggle");
      P.navigate(start); B.advance(1, 1 / 60);
      if (bird) {
        P.modeAction("mode-toggle"); key("keydown", "n"); key("keyup", "n"); B.advance(1, 1 / 60);
        P.hooks.onOrbit(-1e6, -1e6); P.hooks.onOrbit(B.renderer.size.width * 0.9, B.renderer.size.height * 0.9); B.advance(0.4, 1 / 60);
      }
      const p = a.root.position, trace = [], projected = {}, initial = [p.x, p.y, p.z];
      const aimDot = diagonal * (Math.sin(a.root.rotation.y) + Math.cos(a.root.rotation.y));
      let off = -1, back = -1, departure = null, low = Infinity, center = 0, follow = 0, clearance = Infinity, gravityError = 0, ballisticError = 0, gravityFrames = 0, shown = true;
      let lastY = p.y, lastEye = C.position.y, lastV = a.hopV;
      key("keydown", "w"); key("keydown", "a");
      try {
        for (let i = 0; i < 600; i++) {
          B.advance(1 / 60, 1 / 60); const feet = p.y - a.baseY;
          if (low < -50 && Math.hypot(p.x, p.z) < 12 && feet > -1) { back = i; break; }
          low = Math.min(low, feet);
          // Hop is relative to the live support, including the unseen abyss
          // floor. The body's world height must never jump to that support.
          if (off < 0 && feet - a.hop < -100) {
            off = i; departure = { x: p.x - initial[0], z: p.z - initial[2], vx: a.leap.vx, vz: a.leap.vz };
            key("keyup", "w"); key("keyup", "a");
          } else if (off >= 0) {
            gravityFrames++; gravityError = Math.max(gravityError, Math.abs(a.hopV - lastV + 9.8 / 60));
            ballisticError = Math.max(ballisticError, Math.abs(p.y - lastY - a.hopV / 60));
          }
          trace.push([p.x, p.y, p.z, a.hopV, a.leap.vx, a.leap.vz]);
          if (bird) {
            const screen = B.project(p.x, p.y, p.z, projected);
            center = Math.max(center, screen ? Math.hypot(screen.x - B.renderer.size.width / 2, screen.y - B.renderer.size.height / 2) : Infinity);
            follow = Math.max(follow, Math.abs(C.position.y - lastEye - p.y + lastY));
            let cut = B.renderOpts.cutawayMaxY;
            for (let j = 0; j < B.renderOpts.cutawayRegionCount; j++) {
              const r = B.renderOpts.cutawayRegions[j], dx = p.x - r.x, dz = p.z - r.z;
              if (Math.abs(dx * r.cos - dz * r.sin) < r.halfWidth + a.bodyRadius && Math.abs(dx * r.sin + dz * r.cos) < r.halfDepth + a.bodyRadius) cut = Math.min(cut, r.y);
            }
            clearance = Math.min(clearance, cut - feet - a.bodyHeight - Math.max(0, a.viewLift));
            shown = shown && a.root.visible && P.mode === "birds-eye" && C.orthoMix === 1;
          }
          lastY = p.y; lastEye = C.position.y; lastV = a.hopV;
        }
      } finally { key("keyup", "w"); key("keyup", "a"); }
      return { trace, initial, aimDot, off, back, departure, low, center, follow, clearance, gravityError, ballisticError, gravityFrames, shown };
    };
    try {
      // Moving cloud platforms are unrelated to camera mode; remove that
      // time-dependent support from both runs, then restore their visibility.
      for (const c of clouds) c.node.visible = false;
      const carry = run(false), bird = run(true); let error = 0;
      for (let i = 0; i < Math.min(carry.trace.length, bird.trace.length); i++) for (let j = 0; j < carry.trace[i].length; j++) error = Math.max(error, Math.abs(carry.trace[i][j] - bird.trace[i][j]));
      const summarize = r => { const { trace, ...rest } = r; return { ...rest, frames: trace.length }; };
      return { edge: radius < 100, sameActor: P.player === a, error, carry: summarize(carry), bird: summarize(bird) };
    } finally {
      for (let i = 0; i < clouds.length; i++) clouds[i].node.visible = visible[i];
      P.navigate({ position: { x: -8, y: 0, z: 8 }, yaw: 0, pitch: 0.3, dist: 24 });
      if (!P.aiming) P.modeAction("mode-toggle"); B.advance(1, 1 / 60);
    }
  })()`);
  record("birds-eye combat: walking off the same ledge has the same launch and gravity as carry orbit, even when aiming opposite travel", falling.edge && falling.sameActor && falling.error < 0.0001
    && falling.bird.aimDot < -0.5 && falling.carry.frames === falling.bird.frames && falling.carry.off === falling.bird.off && falling.carry.back === falling.bird.back
    && [falling.carry, falling.bird].every(r => r.off >= 0 && r.back > r.off && r.back < 600 && r.low < -50 && r.gravityFrames > 120 && r.gravityError < 1e-5 && r.ballisticError < 1e-5 && r.departure.x < -0.5 && r.departure.z < -0.5 && r.departure.vx < 0 && r.departure.vz < 0), JSON.stringify(falling));
  record("birds-eye combat: the falling character stays centered and visible above every cut plane until respawn, without a camera-height lag", falling.bird.shown && falling.bird.center < 0.02 && falling.bird.follow < 1e-5 && falling.bird.clearance > 0.06 && falling.bird.low < -50 && falling.bird.back > falling.bird.off, JSON.stringify(falling.bird));
  await b.click(size.x, size.y);
  const hudPointer = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, a = P.player, canvas = document.getElementById("scene"), reticle = document.getElementById("weapon-reticle");
    B.advance(0.1, 1 / 60);
    const route = button => {
      const canvasRect = canvas.getBoundingClientRect(), rect = button.getBoundingClientRect();
      const x = (rect.left + rect.width / 2 - canvasRect.left) * B.renderer.size.width / canvasRect.width;
      const y = (rect.top + rect.height / 2 - canvasRect.top) * B.renderer.size.height / canvasRect.height;
      const currentX = parseFloat(reticle.style.left), currentY = parseFloat(reticle.style.top);
      P.hooks.onOrbit(x - currentX, y - currentY); B.advance(1 / 60, 1 / 60);
      const hit = document.elementFromPoint(P.cursor.x, P.cursor.y);
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 91, isPrimary: true, button: 0, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 91, isPrimary: true, button: 0, buttons: 0 }));
      return hit && hit.closest("button") === button;
    };
    const shots = a.weapon.shotsFired, primary = a.weapon.primaryEquipped;
    const secondaryHit = route(document.getElementById("weapon-hud")), equipped = a.weapon.equipped;
    const primaryHit = route(document.getElementById("primary-hud")), restored = a.weapon.primaryEquipped;
    const currentX = parseFloat(reticle.style.left), currentY = parseFloat(reticle.style.top);
    P.hooks.onOrbit(B.renderer.size.width / 2 - currentX, B.renderer.size.height / 2 - currentY); B.advance(1 / 60, 1 / 60);
    return { active: P.cursor.active, visible: P.cursor.visible, locked: document.pointerLockElement === canvas,
      secondaryHit, primaryHit, primary, equipped, restored, shots, afterShots: a.weapon.shotsFired,
      reticleZ: parseInt(getComputedStyle(reticle).zIndex, 10) };
  })()`);
  record("birds-eye combat: the reticle sits above HUD buttons, routes clicks to them, and does not fire through them", hudPointer.active && !hudPointer.visible && hudPointer.locked
    && hudPointer.secondaryHit && hudPointer.primaryHit && hudPointer.primary && hudPointer.equipped && hudPointer.restored
    && hudPointer.afterShots === hudPointer.shots && hudPointer.reticleZ >= 30, JSON.stringify(hudPointer));
} };

const hubBirdsEyeFloors = { name: "birds-eye lower floors", why: "regression: ramp labels reversed with the camera and the HQ ceiling cut left the basement arrow covered", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, I = B.island, a = P.player, H = I.headquarters, room = H.rooms[0], lower = H.basement.rooms[0], D = BL.scenes.hub.debug;
    if (!P.birdsEye) { P.hooks.onZoom(1.2); B.advance(1.5, 1 / 60); }
    P.hooks.onZoom(32 / P.birdsEyeHeight); B.advance(1.5, 1 / 60);
    let hill = null;
    for (let x = -24; x <= 24 && !hill; x += 2) for (let z = -24; z <= 24; z += 2) {
      const floor = I.surfaceAt(x, z);
      if (floor >= 4 && I.clearAt(x, floor + 0.05, z, 0.35, 2) && B.headquarters.solids.props.clearAt(x, floor + 0.05, z, 0.35, 2)) { hill = { name: "hill", x, z, floor }; break; }
    }
    const lab = B.mouths.find(m => BL.caves.slots.find(s => s.id === m.id)?.scene === "lab"), places = [
      { name: "surface", x: -8, z: 8, floor: 0 }, ...(hill ? [hill] : []),
      { name: "cave", x: lab.x - Math.sin(lab.ry) * 3, z: lab.z - Math.cos(lab.ry) * 3, floor: lab.floorY },
      { name: "HQ", x: room.x, z: room.z, floor: H.floor }, { name: "basement", x: lower.x, z: lower.z, floor: H.basement.floor }];
    const geometry = I.geometry, verts = geometry.verts, originalVerts = Array.from(verts), source = I.cutawaySource, data = source.data, originalData = data.slice(), rows = [], thresholds = [];
    const entries = [...D.terrainSections, ...D.caveSections], regions = B.renderOpts.cutawayRegions;
    const paths = I.cutawayPaths, pathState = D.cutawayPaths, roof = D.terrainRampRoof;
    const rampMarkers = D.headquarters.rampMarkers.map(marker => {
      const first = marker.ramp.samples[0], ahead = marker.ramp.samples[Math.min(3, marker.ramp.samples.length - 1)];
      const dx = ahead.x - first.x, dz = ahead.z - first.z, length = Math.hypot(dx, dz) || 1;
      const forwardX = Math.sin(marker.frame.rotation.y), forwardZ = Math.cos(marker.frame.rotation.y);
      const arrowForwardX = Math.sin(marker.arrow.rotation.y), arrowForwardZ = Math.cos(marker.arrow.rotation.y);
      return { label: marker.label, channel: marker.channel, visible: marker.node.visible, arrowVisible: marker.arrow.visible,
        model: marker.node.geometry.rampMarker?.label, visual: marker.node.geometry.rampMarker?.visual, markerKind: marker.node.geometry.rampMarker?.kind, columns: marker.node.geometry.rampMarker?.columns, rows: marker.node.geometry.rampMarker?.rows,
        arrowKind: marker.arrow.geometry.rampMarker?.kind, labelDistance: marker.labelDistance, arrowDistance: marker.arrowDistance, scale: marker.frame.scale.x,
        labelSurfaceError: Math.abs(marker.frame.position.y - marker.labelPoint.y - 0.035),
        arrowSurfaceError: Math.abs(marker.arrow.position.y - marker.arrowPoint.y - 0.035),
        aligned: forwardX * dx / length + forwardZ * dz / length,
        arrowAligned: arrowForwardX * dx / length + arrowForwardZ * dz / length };
    });
    // Project the actual label transform through a full camera turn, including
    // the side-on and reversed views that used to mirror or invert the words.
    const markerViews = [], markerCoverage = [];
    for (let turn = 0; turn < 8; turn++) {
      P.navigate({ position: { x: 13.7, y: 0, z: 20.3 }, yaw: turn * Math.PI / 4, pitch: 0.3, dist: 8 }); B.advance(0.5, 1 / 60);
      B.renderer.render(BL.scenes.hub.root, B.camera, B.renderOpts);
      for (const marker of D.headquarters.rampMarkers) {
        const m = marker.node.world, bounds = BL.scene.boundsOf(marker.node.geometry);
        const project = (x, z) => B.renderer.project(m[0] * x + m[8] * z + m[12], m[1] * x + m[9] * z + m[13], m[2] * x + m[10] * z + m[14], {});
        const left = project(bounds.min[0], 0), right = project(bounds.max[0], 0), top = project(0, bounds.min[2]), bottom = project(0, bounds.max[2]);
        markerViews.push({ label: marker.label, turn, right: right.x - left.x, up: bottom.y - top.y, baseline: Math.abs(right.y - left.y) });
      }
    }
    const vineGeometry = BL.hubModels.vine(); let rampVines = 0;
    const countRampVines = node => { if (node.geometry === vineGeometry) rampVines++; for (const child of node.children) countRampVines(child); };
    countRampVines(BL.scenes.hub.root);
    const standardRim = BL.hubModels.caveMouthRim(), rampRim = BL.hubModels.caveMouthRim(1);
    const standardRimBounds = BL.scene.boundsOf(standardRim), rampRimBounds = BL.scene.boundsOf(rampRim);
    const mouthRims = { standard: 0, ramp: 0, expectedRamp: B.mouths.filter(mouth => BL.caves.slots.find(slot => slot.id === mouth.id)?.status === "headquarters").length,
      standardTop: standardRimBounds.max[1], rampTop: rampRimBounds.max[1], sameOpening: JSON.stringify(standardRim.openingBounds) === JSON.stringify(rampRim.openingBounds) };
    const rampEntranceFrame = { rampLintels: BL.headquartersModels.rampEntrance(0).faces.filter(face => face.headquartersEntranceLintel).length,
      roomLintels: BL.headquartersModels.roomEntrance(0).faces.filter(face => face.headquartersEntranceLintel).length };
    const countMouthRims = node => { const sourceGeometry = node.geometry?.matrixSourceGeometry || node.geometry;
      if (sourceGeometry === standardRim) mouthRims.standard++; else if (sourceGeometry === rampRim) mouthRims.ramp++;
      for (const child of node.children) countMouthRims(child); };
    countMouthRims(BL.scenes.hub.root);
    const pathRead = () => Array.from(paths.lengths, (length, channel) => ({ channel, length, initial: paths.initial[channel],
      lo: pathState.lo[channel], hi: pathState.hi[channel], mix: pathState.mix[channel] }));
    const roofTopology = () => {
      const original = new Set(geometry.faces), seen = new Set(); let partition = true, walls = 0, voxelWalls = true;
      for (const mesh of roof.partitionGeometries) {
        partition = partition && mesh.verts === verts;
        for (const face of mesh.faces) { partition = partition && original.has(face) && !seen.has(face); seen.add(face); }
      }
      for (const mesh of roof.perimeterGeometry) for (const face of mesh.faces) {
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const index of face.i) { const n = index * 3, x = mesh.verts[n], y = mesh.verts[n + 1], z = mesh.verts[n + 2];
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
        voxelWalls = voxelWalls && face.cutawayRampWall && maxY > minY && Math.min(maxX - minX, maxZ - minZ) < 1e-7
          && Math.abs(Math.max(maxX - minX, maxZ - minZ) - paths.unit) < 1e-7;
        walls++;
      }
      return { partition: partition && Array.from(original).every(face => seen.has(face)
        || face.cutawayFloorChannel >= 2 && face.cutawayFloorChannel < 4), voxelWalls, walls, removable: roof.stats.removableFaces,
        windowRoofFaces: Array.from(roof.stats.windowRoofFaces) };
    };
    const initialSpans = paths.ramps.map((ramp, channel) => ({ channel,
      span: (paths.initial[channel] - 1) / 254 * paths.lengths[channel],
      expected: Math.min(ramp.length, channel < 2 ? ramp.cutawayEntranceLength || ramp.width : ramp.width), length: ramp.length, tolerance: ramp.length / 254 }));
    const birdseyeWindows = H.windows.filter(window => window.kind === "room" || window.kind === "panorama").map(window => ({
      kind: window.kind, basement: !!window.basement, level: window.birdseyeCutawayLevel, columns: window.birdseyeCutawayColumns || 0
    }));
    const lowerFloorOrdered = () => roof.lowerFloorGeometry.every(geometry => geometry.faces.every(face => {
      const channel = face.cutawayFloorChannel, station = face.cutawayFloorStation;
      return station < pathState.lo[channel] || pathState.mix[channel] >= 1 - 1e-7
        && station >= pathState.lo[channel] && station <= pathState.hi[channel];
    }));
    const decodePath = key => {
      let channel = -1, station = 0, owners = 0;
      for (let i = 0; i < 4; i++) { const value = key >>> (i * 8) & 255; if (value) { channel = i; station = value; owners++; } }
      return { channel, station, owners };
    };
    const windowStations = Array.from({ length: 4 }, () => new Set());
    for (const window of H.windows) if (window.kind === "ramp") windowStations[window.cutawayChannel].add(1 + Math.round(window.cutawayStation / paths.lengths[window.cutawayChannel] * 254));
    const rampWindowCells = [];
    for (let cell = 0; cell < paths.keys.length; cell++) {
      const decoded = decodePath(paths.keys[cell]);
      if (decoded.channel < 0 || !source.windows[cell]?.length) continue;
      const x = paths.origin.x + (Math.floor(cell / paths.height) + 0.5) * paths.unit, z = paths.origin.z + (cell % paths.height + 0.5) * paths.unit;
      const raw = I.rampColumnAt(x, z, decoded.channel >= 2, {});
      if (raw) continue;
      rampWindowCells.push({ cell, ...decoded, channelCorrect: windowStations[decoded.channel].has(decoded.station) });
    }
    let overlapCells = 0, overlapOwnership = true, retainedFloors = 0, floorsPreserved = true;
    const upperColumn = {}, lowerColumn = {}, baseFaces = new Set(roof.baseGeometry.faces);
    for (let cell = 0; cell < paths.keys.length; cell++) {
      const x = paths.origin.x + (Math.floor(cell / paths.height) + 0.5) * paths.unit, z = paths.origin.z + (cell % paths.height + 0.5) * paths.unit;
      const upper = I.rampColumnAt(x, z, false, upperColumn), lower = I.rampColumnAt(x, z, true, lowerColumn);
      if (upper > 0 && upper <= 2 && lower > 0 && lower <= 2) {
        const key = paths.keys[cell]; overlapCells++;
        overlapOwnership = overlapOwnership && !!(key >>> ((upper - 1) * 8) & 255) && !(key >>> 16)
          && Math.abs(paths.bottoms[cell] - upperColumn.ceiling) < 1e-6;
      }
    }
    for (const face of geometry.faces) if (face.cutawayPathKey && face.i.some(index => verts[index * 3 + 1] < face.cutawayPathBottom - 1e-7)) {
      retainedFloors++; floorsPreserved = floorsPreserved && baseFaces.has(face);
    }
    let rampWindowFaces = 0, rampWindowBaseFaces = 0, rampWindowCrossingFaces = 0, rampWindowFacesPreserved = true, rampWindowFaceOwnership = true;
    for (const face of geometry.faces) {
      if (!face.headquartersWindowReveal || !face.cutawayPathKey) continue;
      rampWindowFaces++;
      const decoded = decodePath(face.cutawayPathKey), window = H.windows[face.windowIndex];
      rampWindowFaceOwnership = rampWindowFaceOwnership && decoded.owners === 1 && window?.kind === "ramp"
        && decoded.channel === window.cutawayChannel && windowStations[decoded.channel].has(decoded.station);
      let below = false, above = false;
      for (const index of face.i) {
        const y = verts[index * 3 + 1];
        below ||= y < face.cutawayPathBottom - 1e-7;
        above ||= y > face.cutawayPathBottom + 1e-7;
      }
      // A fragment crossing or touching the ceiling is part of the actual
      // window reveal, not removable roof. It must remain canonical base
      // geometry while wholly-above fragments may join the roof split.
      if (below || !above) {
        rampWindowCrossingFaces++;
        rampWindowFacesPreserved = rampWindowFacesPreserved && baseFaces.has(face);
      }
      if (baseFaces.has(face)) rampWindowBaseFaces++;
    }
    const sections = () => D.terrainSections.map(e => ({ visible: e.cap.node.visible, worldY: e.worldY,
      y: e.cap.node.world[13], faces: e.cap.stats.faces, cache: e.cap.stats.cacheEntries }));
    const builds = () => entries.map(e => [e.cap.stats.solidBuilds, e.cap.stats.detailBuilds]);
    for (const q of places) {
      const support = I.supportAt(q.x, q.z, q.floor + 1, 0.35), clearance = I.clearAt(q.x, q.floor + 0.1, q.z, 0.2, 1.2);
      P.navigate({ position: { x: q.x, y: q.floor, z: q.z }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(2, 1 / 60);
      BL.scene.updateWorld(BL.scenes.hub.root);
      const activeRegions = regions.slice(0, B.renderOpts.cutawayRegionCount);
      const before = { cutoff: B.renderOpts.cutawayMaxY, regions: activeRegions.map(r => ({ ...r })), paths: pathRead(), builds: builds(), roofBuilds: roof.stats.rebuilds, height: P.birdsEyeHeight };
      const caveRegions = D.caveSections.filter(e => activeRegions.includes(e.region)).map(e => ({ ...e.region }));
      P.hooks.onZoom(1.2); B.advance(0.6, 1 / 60);
      const zoomHeight = P.birdsEyeHeight;
      P.hooks.onZoom(1 / 1.2); B.advance(0.6, 1 / 60);
      const zoomStable = before.cutoff === B.renderOpts.cutawayMaxY && JSON.stringify(before.regions) === JSON.stringify(regions.slice(0, B.renderOpts.cutawayRegionCount))
        && JSON.stringify(before.paths) === JSON.stringify(pathRead()) && before.roofBuilds === roof.stats.rebuilds && JSON.stringify(before.builds) === JSON.stringify(builds());
      BL.scene.updateWorld(BL.scenes.hub.root);
      B.renderer.render(BL.scenes.hub.root, B.camera, B.renderOpts);
      if (q.name === "surface" || q.name === "HQ") for (const marker of D.headquarters.rampMarkers) {
        if ((marker.channel < 2) !== (q.name === "surface")) continue;
        let checked = 0, covered = 0;
        const m = marker.arrow.world, v = marker.arrow.geometry.verts;
        for (let i = 0; i < v.length; i += 3) {
          const x = m[0] * v[i] + m[4] * v[i + 1] + m[8] * v[i + 2] + m[12];
          const z = m[2] * v[i] + m[6] * v[i + 1] + m[10] * v[i + 2] + m[14];
          const gx = Math.floor((x - paths.origin.x) / paths.unit), gz = Math.floor((z - paths.origin.z) / paths.unit), cell = gx * paths.height + gz;
          const station = paths.keys[cell] >>> (marker.channel * 8) & 255;
          const globallyOpen = paths.bottoms[cell] >= B.renderOpts.cutawayMaxY - 0.01;
          const locallyOpen = station > 0 && station >= pathState.lo[marker.channel] && station <= pathState.hi[marker.channel] && pathState.mix[marker.channel] === 1;
          checked++; if (!globallyOpen && !locallyOpen) covered++;
        }
        markerCoverage.push({ channel: marker.channel, floor: q.name, checked, covered });
      }
      const centers = [0, H.floor, H.basement.floor].map(y => B.renderer.project(0, y, 0, {}));
      const centerError = centers.every(Boolean) ? Math.max(...centers.map(p => Math.hypot(p.x - centers[0].x, p.y - centers[0].y))) : Infinity;
      rows.push({ name: q.name, mode: P.mode, overhead: P.birdsEye, horizontal: Math.hypot(B.camera.position.x - a.root.position.x, B.camera.position.z - a.root.position.z),
        floor: a.root.position.y - a.baseY, requestedFloor: q.floor, ceiling: P.birdsEyeCeiling, floorCeiling: q.name === "HQ" ? H.ceiling : q.name === "basement" ? H.basement.ceiling : null, cutoff: B.renderOpts.cutawayMaxY,
        regions: before.regions, caveRegions, paths: before.paths, windowMix: Array.from(pathState.windowMix), roof: roofTopology(), caps: sections(), caveCaps: D.caveSections.filter(e => e.cap.node.visible).length, zoomStable, zoomMoved: Math.abs(zoomHeight - before.height) > 0.1, centerError, orthoMix: B.camera.orthoMix,
        unchanged: I.geometry === geometry && I.geometry.verts === verts && I.supportAt(q.x, q.z, q.floor + 1, 0.35) === support && I.clearAt(q.x, q.floor + 0.1, q.z, 0.2, 1.2) === clearance });
      if (q.name !== "cave") {
        const read = () => { const feet = a.root.position.y - a.baseY, relative = B.camera.position.y - feet;
          return { mode: P.mode, relative, headClearance: relative - a.headOffset * 0.95 - a.viewLift }; };
        P.hooks.onZoom(21.5 / P.birdsEyeHeight); B.advance(1.5, 1 / 60); const above = read(); P.hooks.onZoom(0.95);
        let frames = 0; while (P.mode === "birds-eye" && frames++ < 150) B.advance(1 / 60, 1 / 60);
        const switched = read(); thresholds.push({ name: q.name, floor: q.floor, above, switched, frames });
        B.advance(1, 1 / 60); P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
        P.hooks.onZoom(before.height / P.birdsEyeHeight); B.advance(1.5, 1 / 60);
      }
    }
    const landingCoverage = [];
    for (const point of [{ x: 17.12639, z: 1.63491 }, { x: 18.24953, z: -0.09931 }]) {
      P.navigate({ position: { x: point.x, y: H.floor, z: point.z }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(0.5, 1 / 60);
      landingCoverage.push({ hi: Array.from(pathState.hi), cutFaces: Array.from(roof.stats.cutFaces) });
    }
    // Move the actual actor along the authored ramps. The expected plateaus
    // come from the settled floor visits above, not a copy of the blend rule.
    const cutRead = () => {
      const p = a.root.position, feet = p.y - a.baseY, global = B.renderOpts.cutawayMaxY;
      let cut = global;
      for (let i = 0; i < B.renderOpts.cutawayRegionCount; i++) {
        const r = regions[i], dx = p.x - r.x, dz = p.z - r.z;
        if (Math.abs(dx * r.cos - dz * r.sin) < r.halfWidth && Math.abs(dx * r.sin + dz * r.cos) < r.halfDepth) cut = Math.min(cut, r.y);
      }
      const gx = Math.floor((p.x - paths.origin.x) / paths.unit), gz = Math.floor((p.z - paths.origin.z) / paths.unit);
      if (gx >= 0 && gz >= 0 && gx < paths.width && gz < paths.height) {
        const cell = gx * paths.height + gz, key = paths.keys[cell];
        for (let channel = 0; channel < 4; channel++) {
          const station = key >>> (channel * 8) & 255;
          if (station && pathState.mix[channel] > 0 && station >= pathState.lo[channel] && station <= pathState.hi[channel])
            cut = Math.min(cut, 16 + (paths.bottoms[cell] - 16) * pathState.mix[channel]);
        }
      }
      return { y: global >= 1e5 ? 16 : global, clearance: cut - feet - a.bodyHeight - Math.max(0, a.viewLift), feet, regions: B.renderOpts.cutawayRegionCount };
    };
    const rampTravel = [];
    for (const [name, ramp, upper, lower] of [["main-HQ", H.ramps[0], 16, rows.find(r => r.name === "HQ").cutoff], ["HQ-basement", H.basement.ramps[0], rows.find(r => r.name === "HQ").cutoff, rows.find(r => r.name === "basement").cutoff]]) {
      const samples = ramp.samples, first = samples[0], last = samples[samples.length - 1];
      const at = progress => {
        const y = first.y + (last.y - first.y) * progress;
        let i = 1; while (i < samples.length - 1 && samples[i].y > y) i++;
        const from = samples[i - 1], to = samples[i], k = (y - from.y) / (to.y - from.y);
        return { x: from.x + (to.x - from.x) * k, y, z: from.z + (to.z - from.z) * k };
      };
      for (const down of [true, false]) {
        const source = down ? 0.08 : 0.92, destination = 1 - source, start = at(source);
        P.navigate({ position: start, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(1, 1 / 60);
        const early = cutRead(); let previous = early, maxStep = 0, clearance = Infinity, maxRegions = 0, positionError = 0, moving = 0, structureHidden = false, slicedVisible = false, visibleFrames = 0, wholeHidden = 0, wholeBarrels = 0, wholeGorillas = 0, wholeComplete = true, lowerFloorsOrdered = lowerFloorOrdered(), lowerActorRoofChecks = 0, lowerActorRoofCovered = 0;
        const initialLowerMix = Math.max(pathState.mix[2], pathState.mix[3]), lowerGate = H.ceiling - 0.06 - paths.unit;
        const inactiveLowerCovered = () => [2, 3].every(channel => channel === D.cutawayTravelChannel
          || pathState.mix[channel] === 0 || pathState.hi[channel] <= paths.initial[channel]);
        let lowerMixMax = initialLowerMix,
          lowerRevealFrames = B.renderOpts.cutawayMaxY < lowerGate - 1e-7 && initialLowerMix > 0 ? 1 : 0,
          lowerRevealGuard = B.renderOpts.cutawayMaxY < lowerGate - 1e-7 || inactiveLowerCovered();
        const sample = () => {
          const value = cutRead(), step = Math.abs(value.y - previous.y);
          maxStep = Math.max(maxStep, step); clearance = Math.min(clearance, value.clearance); maxRegions = Math.max(maxRegions, value.regions);
          const lowerMix = Math.max(pathState.mix[2], pathState.mix[3]);
          lowerMixMax = Math.max(lowerMixMax, lowerMix);
          if (B.renderOpts.cutawayMaxY >= lowerGate - 1e-7) lowerRevealGuard = lowerRevealGuard && inactiveLowerCovered();
          else if (lowerMix > 0) lowerRevealFrames++;
          const channel = D.cutawayTravelChannel, position = a.root.position;
          const gx = Math.floor((position.x - paths.origin.x) / paths.unit), gz = Math.floor((position.z - paths.origin.z) / paths.unit);
          if (channel >= 2 && gx >= 0 && gz >= 0 && gx < paths.width && gz < paths.height) {
            const cell = gx * paths.height + gz, station = paths.keys[cell] >>> (channel * 8) & 255;
            const head = position.y - a.baseY + a.bodyHeight + Math.max(0, a.viewLift);
            if (station >= pathState.lo[channel] && station <= pathState.hi[channel] && paths.bottoms[cell] > head) {
              lowerActorRoofChecks++;
              if (pathState.mix[channel] < 1 - 1e-6) lowerActorRoofCovered++;
            }
          }
          lowerFloorsOrdered = lowerFloorsOrdered && lowerFloorOrdered();
          structureHidden ||= !!H.node.cutawayWholeHidden || H.entrances.some(entry => entry.node.cutawayWholeHidden);
          if (!a.root.cutawayWholeHidden) visibleFrames++;
          wholeHidden = Math.max(wholeHidden, B.crew.list.filter(cave => cave.root.cutawayWholeHidden).length + D.props.filter(prop => prop.node.cutawayWholeHidden).length);
          wholeBarrels = Math.max(wholeBarrels, D.props.filter(prop => prop.prop === "barrel" && prop.node.cutawayWholeHidden).length);
          wholeGorillas = Math.max(wholeGorillas, B.clankers.list.filter(entry => entry.root.cutawayWholeHidden).length);
          wholeComplete = wholeComplete && D.props.every(prop => !prop.node.cutawayWholeHidden || prop.node.cameraHidden)
            && B.clankers.list.every(entry => !entry.root.cutawayWholeHidden || entry.root.cameraHidden);
          if (value.clearance < -0.01 && !a.root.cutawayWholeHidden) slicedVisible = true;
          if (step > 1e-5) moving++;
          previous = value; return value;
        };
        const place = progress => {
          const point = at(progress); B.crew.relocatePlayer(point, 0); B.advance(1 / 60, 1 / 60);
          positionError = Math.max(positionError, Math.abs(a.root.position.y - a.baseY - point.y));
          return sample();
        };
        const travel = (from, to, frames, trace = null) => { for (let i = 1; i <= frames; i++) { const progress = from + (to - from) * i / frames, value = place(progress); if (trace) {
          const active = regions.slice(0, B.renderOpts.cutawayRegionCount);
          trace.push({ progress, floor: value.y, paths: pathRead(), caveRegionsOnly: active.every(region => D.caveSections.some(entry => entry.region === region)) });
        } } };
        const hold = () => { for (let i = 0; i < 45; i++) { B.advance(1 / 60, 1 / 60); sample(); } return previous; };
        travel(source, 0.5, 36); const middle = hold();
        // Let the first small excursion settle, then repeat the same noise
        // band: it must not alternate between the two floor states.
        place(0.502); place(0.498); B.advance(0.1, 1 / 60); const stopped = sample();
        let stopDrift = 0;
        for (let i = 0; i < 18; i++) { const value = place(0.5 + (i % 2 ? -0.002 : 0.002)); stopDrift = Math.max(stopDrift, Math.abs(value.y - stopped.y)); }
        travel(0.5, source, 36); const reversed = hold();
        const linear = []; travel(source, destination, 72, linear); const late = hold();
        const changing = linear.filter(row => row.floor > lower + 0.02 && row.floor < upper - 0.02);
        const floorWindow = changing.length ? Math.max(...changing.map(row => row.progress)) - Math.min(...changing.map(row => row.progress)) : Infinity;
        const floorCenter = changing.length ? (Math.max(...changing.map(row => row.progress)) + Math.min(...changing.map(row => row.progress))) / 2 : Infinity;
        rampTravel.push({ name, down, upper, lower, early, middle, late, reversed, maxStep, clearance, maxRegions, positionError, moving, stopDrift, floorWindow, floorCenter,
          minimumSpan: linear.every(row => row.paths.every(path => path.hi >= path.initial)), caveRegionsOnly: linear.every(row => row.caveRegionsOnly),
          lowerMixMax, lowerRevealFrames, lowerRevealGuard, lowerFloorsOrdered, lowerActorRoofChecks, lowerActorRoofCovered,
          structureHidden, slicedVisible, visibleFrames, wholeHidden, wholeBarrels, wholeGorillas, wholeComplete });
      }
    }
    // Follow cumulative authored distance, including each route's flat tail.
    // Height-only samples cannot prove that the visible endpoint keeps moving
    // ahead after the descent itself has reached the next floor.
    const pathTravel = [];
    for (let channel = 0; channel < paths.ramps.length; channel++) {
      const ramp = paths.ramps[channel], samples = ramp.samples;
      const at = distance => {
        let i = 1; while (i < samples.length - 1 && samples[i].s < distance) i++;
        const from = samples[i - 1], to = samples[i], t = (distance - from.s) / (to.s - from.s);
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
      };
      P.navigate({ position: at(0), yaw: 0, pitch: 0.3, dist: 8 }); B.advance(1, 1 / 60);
      let previous = 0, backwards = 0, minimum = Infinity, balance = Infinity, matched = 0, balanced = 0, end = 0, windowActive = false;
      for (let i = 0; i <= 48; i++) {
        B.crew.relocatePlayer(at(ramp.length * i / 48), 0); B.advance(1 / 60, 1 / 60);
        const hi = pathState.hi[channel], endpoint = Math.max(hi, pathState.lo[channel] - 1);
        backwards = Math.max(backwards, previous - endpoint); previous = endpoint;
        minimum = Math.min(minimum, hi - paths.initial[channel]);
        if (D.cutawayTravelChannel === channel) {
          matched++;
          const station = 1 + 254 * D.cutawayTravelStation / ramp.length;
          if (2 * station - 1 <= 255) { balance = Math.min(balance, endpoint - station - (station - 1)); balanced++; }
        }
        windowActive ||= pathState.mix[channel] > 0 && rampWindowCells.some(cell => cell.channel === channel
          && cell.station >= pathState.lo[channel] && cell.station <= pathState.hi[channel]);
        end = endpoint;
      }
      pathTravel.push({ channel, backwards, minimum, balance, matched, balanced, end, windowActive, roof: roofTopology() });
    }
    const coverFade = { out: [], in: [] }, readCoverFade = () => ({ path: pathState.mix[0], cave: B.renderOpts.cutawayRegionCount ? regions[0].mix : 0 });
    P.navigate({ position: { x: -8, y: 0, z: 8 }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(0.5, 1 / 60);
    P.navigate({ position: { x: hill.x, y: hill.floor, z: hill.z }, yaw: 0, pitch: 0.3, dist: 8 });
    for (let i = 0; i < 22; i++) { B.advance(1 / 60, 1 / 60); coverFade.out.push(readCoverFade()); }
    P.navigate({ position: { x: -8, y: 0, z: 8 }, yaw: 0, pitch: 0.3, dist: 8 });
    for (let i = 0; i < 22; i++) { B.advance(1 / 60, 1 / 60); coverFade.in.push(readCoverFade()); }
    const key = (type, value, code) => window.dispatchEvent(new KeyboardEvent(type, { key: value, code, bubbles: true }));
    const jetWasWorn = !!a.jet, flightFloor = I.surfaceAt(-8, 16);
    P.navigate({ position: { x: -8, y: flightFloor, z: 16 }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(1, 1 / 60);
    if (!jetWasWorn) { key("keydown", "j", "KeyJ"); key("keyup", "j", "KeyJ"); }
    const flight = { peak: 0, highFrames: 0, fallFrames: 0, clearance: Infinity, preserved: true, centered: true, landed: false };
    key("keydown", " ", "Space");
    try {
      for (let i = 0; i < 300; i++) {
        if (i === 60) key("keyup", " ", "Space");
        B.advance(1 / 60, 1 / 60); const value = cutRead(), altitude = value.feet - flightFloor;
        flight.peak = Math.max(flight.peak, altitude); flight.clearance = Math.min(flight.clearance, value.clearance);
        if (a.hopV < -0.1) flight.fallFrames++;
        if (altitude > 4) {
          flight.highFrames++;
          flight.preserved = flight.preserved && B.renderOpts.cutawayMaxY >= 1e5 && pathState.mix.every(mix => mix === 0);
        }
        flight.centered = flight.centered && P.mode === "birds-eye" && a.root.visible && Math.hypot(B.camera.position.x - a.root.position.x, B.camera.position.z - a.root.position.z) < 1e-6;
        if (i > 90 && altitude < 0.1 && a.hopV === 0) { flight.landed = true; break; }
      }
    } finally {
      key("keyup", " ", "Space");
      if (!jetWasWorn) { key("keydown", "j", "KeyJ"); key("keyup", "j", "KeyJ"); }
    }
    // Restore the basement before exercising the existing camera handoffs.
    P.navigate({ position: { x: lower.x, y: H.basement.floor, z: lower.z }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(2, 1 / 60);
    const cutState = () => ({ mode: P.mode, player: !!P.player, mix: P.birdsEyeMix, fade: B.renderOpts.cutawayFade, rock: B.renderOpts.cutawayRockMix,
      markers: D.headquarters.rampMarkers.reduce((count, marker) => count + (marker.node.visible ? 1 : 0), 0),
      cuts: B.renderOpts.cutawayMaxY < 1e5 ? [B.renderOpts.cutawayMaxY] : regions.slice(0, B.renderOpts.cutawayRegionCount).map(r => r.y) });
    const transition = (name, action, frames = 60) => {
      const before = cutState(); action(); const immediate = Math.abs(P.birdsEyeMix - before.mix), immediateFade = Math.abs(B.renderOpts.cutawayFade - before.fade);
      let last = before, mixStep = 0, fadeSÛ¾8ãFòµë(š+myÒæ6ÖW&ç÷6—F–öâÒÂF&vWBÒ²ââä"æ6ÖW&çF&vWBÓ°¢ç&VÆV6R‚“°¢6öç7B&VÆV6VBÒ²7F—fS¢æ7F—fRÂ6öçG&öÆÆVC¢Ræ6öçG&öÆÆVBÂ†VD†–FFVã¢Ræv÷&–ÆÆç'G2æ†VBæ6ÖW&†–FFVâÀ¢†–FFVã¢&WF–6ÆRæ†–FFVâÂF&vWC¢&WF–6ÆRæFF6WBçF&vWBÂ†—C¢&WF–6ÆRæFF6WBæ†—BÀ¢÷6—F–öä6ÆV&VC¢&WF–6ÆRç7G–ÆRæÆVgBbb&WF–6ÆRç7G–ÆRçF÷ÂæV#¢"æ6ÖW&ææV"À¢W–TFVÇF¢ÖF‚æ‡—÷B„"æ6ÖW&ç÷6—F–öâç‚ÒW–Rç‚Â"æ6ÖW&ç÷6—F–öâç’ÒW–Rç’Â"æ6ÖW&ç÷6—F–öâç¢ÒW–Rç¢’À¢F&vWDFVÇF¢ÖF‚æ‡—÷B„"æ6ÖW&çF&vWBç‚ÒF&vWBç‚Â"æ6ÖW&çF&vWBç’ÒF&vWBç’Â"æ6ÖW&çF&vWBç¢ÒF&vWBç¢’Ó°¢&WGW&â²÷76W76VBÂ&W6WBÂ&÷w2Â7v¢6†÷VÆFW"ç6–FR¢7vVBç6–FRÂÀ¢GW&ã¢ÖF‚æ'2‡GW&æVBç–rÒ÷fW&†VBç–r’Âæ÷'Fƒ¢ÖF‚æFã"„ÖF‚ç6–â†æ÷'F‚ç–r’ÂÖF‚æ6÷2†æ÷'F‚ç–r’’Â÷&–v–æÄ†VD†–FFVâÂæV"Â&VÆV6VBÓ°¢Òf–æÆÇ’²¶W’‚&¶W—W"Â'"“²¶W’‚&¶W—W"Â%6†–gB"Â%6†–gE&–v‡B"Â"“²ç&VÆV6R‚“²Ð¢Ò’‚–“°¢6öç7Bf–Ww2Ò²'6†÷VÆFW""Â'6†÷VÆFW""Â'6†÷VÆFW""Â&f—'7B×W'6öâ"Â&f—'7B×W'6öâ"Â'6†÷VÆFW""Â&&—&G2ÖW–R"Â&&—&G2ÖW–R"Â&&—&G2ÖW–R"Â&÷&&—B"Â&&—&G2ÖW–R"Â'6†÷VÆFW""Â&f—'7B×W'6öâ%Ó°¢6öç7BÖöFW2Ò·G'VRÂG'VRÂfÇ6RÂfÇ6RÂG'VRÂG'VRÂG'VRÂG'VRÂG'VRÂfÇ6RÂG'VRÂG'VRÂG'VUÓ°¢6öç7B6ÖW&2Ò7FFRç&÷w2æÆVæwF‚ÓÓÒf–Ww2æÆVæwF‚bb7FFRç&÷w2æWfW'’‚‡&÷rÂ’’Óâ&÷ræf–æ—FRbb&÷rçf–WrÓÓÒf–Ww5¶•Òbb&÷ræ6öÖ&BÓÓÒÖöFW5¶•Ð¢bb&÷ræ‡VEf–WrÓÓÒ&÷rçf–Wrbb&÷ræ‡VD6öÖ&BÓÓÒ7G&–ær‡&÷ræ6öÖ&B’bb&÷ræ†–FFVâÓÓÒ&÷ræ6öÖ&@¢bb‚&÷ræ6öÖ&BÇÂ&÷rçf—6–&ÆRÓÓÒ'f—6–&ÆR"bb&÷rç7G&ö¶RÓÓÒ'&v"ƒ#SRÂ#SRÂ#SR’"¢bb&÷ræ†VD†–FFVâÓÓÒ‡&÷rçf–WrÓÓÒ&f—'7B×W'6öâ"’bb&÷ræÖ—‚ÓÓÒ‡&÷rçf–WrÓÓÒ&&—&G2ÖW–R"ò¢¢bb&÷ræ7WFv’ÓÓÒ‡&÷rçf–WrÓÓÒ&&—&G2ÖW–R"’“°¢6öç7B&VÆV6VBÒ7FFRç&VÆV6VC°¢&V6÷&B‚&v÷&–ÆÆ6ÖW&¢6''’æB6öÖ&B6†&Rf—'7B×W'6öâÂ6†÷VÆFW"æBF—7FçBf–Ww3²&–v‡B6†–gB7v26†÷VÆFW"Â&÷FFW2&—&G2ÖW–RæBâf6W2æ÷'Fƒ²6öÖ&B†2v†—FR×&–ær7&÷76†—"æB&VÆV6R&W7F÷&W2F†R†VBv—F†÷WBÖ÷f–ærF†R6ÖW&"À¢7FFRç÷76W76VBbb7FFRç&W6WBbb6ÖW&2bb7FFRç7vbb7FFRçGW&ââã"bbÖF‚æ'2‡7FFRææ÷'F‚’Âã¢bb&VÆV6VBæ7F—fRbb&VÆV6VBæ6öçG&öÆÆVBbb&VÆV6VBæ†VD†–FFVâÓÓÒ7FFRæ÷&–v–æÄ†VD†–FFVâbb&VÆV6VBæ†–FFVà¢bb&VÆV6VBçF&vWBÓÓÒ&æöæR"bb&VÆV6VBæ†—BÓÓÒ&æöæR"bb&VÆV6VBç÷6—F–öä6ÆV&VBbb&VÆV6VBææV"ÓÓÒ7FFRææV ¢bb&VÆV6VBæW–TFVÇFÂRÓbbb&VÆV6VBçF&vWDFVÇFÂRÓbÂ¥4ôâç7G&–æv–g’‡7FFR’“°§ÒÒÂ²æÖS¢&v÷&–ÆÆvÆÂFW7F–æF–öâ"Âv‡“¢'&Vw&W76–öã¢6öÖÖæF–ær&ööbv÷&–ÆÆFòÆ÷vW"ö–çBf'F†W"ÆöærF†R6fRf6R7FÆÆVBBF†R7&W7B–ç7FVBöb&V6†–ærF†R6Æ–6¶VBvÆÂ"Â'Vã¢7–æ2†"’Óâ°¢6öç7B7FFRÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ2Ò$Âç66VæRÂ2Ò"æ6Ææ¶W'2ÂRÒ2æÆ—7Bæf–æB†RÓâRæ÷væW"çG&—G2ææÖRÓÓÒ'÷'FÆæF†öFÂ"’Â&ö÷BÒ$Âç66VæW2æ‡V"ç&ö÷C°¢"ç–Æ÷Bç&VÆV6R‡G'VR“²2ç&VÆV6R‚“²2æ6æ6VÄFV'VtÖ÷fR†R“°¢f÷"†6öç7B÷F†W"öb2æÆ—7B’–b†÷F†W"ÓÒR’°¢÷F†W"æ÷væW"æ÷fW'&–FRÒ÷F†W"æ÷væW"ç7FFRÒ&v’#²÷F†W"æ÷væW"æ&VEG&fVÂæÖöFRÒ"#°¢÷F†W"æ6öçG&öÆÆVBÒ÷F†W"æG&—fRæ—&&÷&æRÒ÷F†W"æ6Æ–Ö"æ7F—fRÒ÷F†W"æf—&Rç&öÆÆ–ærÒ÷F†W"æ7F—fRÒ÷F†W"ç&ö÷Bçf—6–&ÆRÒfÇ6S°¢Ð¢f÷"†6öç7B6fRöb"æ6fVÖVâçfÇVW2‚’’6fRç&ö÷Bçf—6–&ÆRÒfÇ6S°¢f÷"†6öç7B&÷öb"ç&÷2’&÷ææöFRçf—6–&ÆRÒfÇ6S°¢6öç7BÖ÷WF‚Ò"æ—6ÆæBæÖ÷WF‡2æf–æB†ÒÓâÒæ–BÓÓÒ&32"’Â7"ÒÖF‚æ6÷2†Ö÷WF‚ç'’’Â7"ÒÖF‚ç6–â†Ö÷WF‚ç'’“°¢6öç7B7F'BÒ²ƒ¢Ö÷WF‚ç‚Ò7"¢"Ò7"¢Bã‚Â“¢Â£¢Ö÷WF‚ç¢²7"¢"Ò7"¢Bã‚Ó°¢7F'Bç’Ò"æ—6ÆæBç7W&f6TB‡7F'Bç‚Â7F'Bç¢“°¢òòF†RF&vWB6öÖW2g&öÒF†R&VÂ6fRf6RÂ–æFWVæFVçFÇ’öb—G2æf–vF–öà¢òòw&ƒ¢†÷&—¦öçFÂ&’BÆ÷vW"†V–v‡BæBf'F†W"7&÷72F†RvÆÂà¢6öç7BFW'&–âÒ2æ7&VFTæöFR‡²vVöÖWG'“¢"æ—6ÆæBævVöÖWG'’Ò“°¢6öç7B&’Ò$ÂçvVöåF&vWG2æ7&VFR…·²æöFS¢FW'&–âÂ÷væW#¢·ÒÂ&F—W3¢ÕÒ“°¢6öç7BF&vWBÒ²æöFS¢çVÆÂÂ÷væW#¢çVÆÂÂƒ¢Â“¢Â£¢Âæ÷&ÖÃ¢²ƒ¢Â“¢Â£¢ÒÓ°¢–b‚&’ç&’‡F&vWBÂÖ÷WF‚ç‚²7"¢2ã‚²7"¢‚Â7F'Bç’Ò"ãRÀ¢Ö÷WF‚ç¢Ò7"¢2ã‚²7"¢‚Â×7"ÂÂÖ7"Â#’’&WGW&â²f—‡GW&S¢fÇ6RÓ°¢ö&¦V7Bæ76–vâ†Rç&ö÷Bç÷6—F–öâÂ7F'B“°¢ö&¦V7Bæ76–vâ†RÂ²7F—fS¢G'VRÂ6öçG&öÆÆVC¢fÇ6RÂÖöFS¢&6†–ÆÆ–ær"Â†6S¢&6†–ÆÂ"Â&÷WFS¢""Âg&öÕ6—FS¢ÓÀ¢VæF–æu6—FS¢ÓÂ†56Æ÷C¢fÇ6RÂÆ÷VævS¢""ÂÆ÷VævTFW'C¢fÇ6RÂ&¶VC¢fÇ6RÂ&—VC¢fÇ6RÀ¢&V6÷fW#¢Â&W7C¢Â†VF–æs¢Ö÷WF‚ç'’Â7VVC¢Â÷VæC¢Â&VC¢Â7FæC¢Â&Æö6¶VC¢À¢W†—Dfö÷G&–çC¢fÇ6RÂÆ÷t6÷fW#¢fÇ6RÂfö÷G&–çDÖöFS¢'vÆ²"Â&F—W3¢$Âæ6Ææ¶W'2åtÄµõ$D•U2Â†V–v‡C¢$Âæ6Ææ¶W'2åtÄµô„T”t…BÒ“°¢Ræ÷væW"ç7FFRÒ&6†–ÆÆ–ær#²Rç&ö÷Bçf—6–&ÆRÒG'VS°¢ö&¦V7Bæ76–vâ†RæG&—fRÂ²—&&÷&æS¢fÇ6RÂ76—fTfÆÃ¢fÇ6RÂw&÷VæFVC¢G'VRÂ&W7VÖS¢fÇ6RÂ§V×†VÆC¢fÇ6RÀ¢§V×F÷vã¢fÇ6RÂ§V×&W76VC¢fÇ6RÂ§V×3¢Âgƒ¢Âg“¢Âg£¢ÂÖ÷F–öå&V6÷fW#¢ÂÖ÷F–öäVçfVÆ÷S¢fÇ6RÒ“°¢Ræ§V×æ7F—fRÒRæf—&Ræ'W&æ–ærÒRæf—&Rç&öÆÆ–ærÒfÇ6S²Ræf—&Rç&öÆÅ&V6÷fW"Ò°¢ö&¦V7Bæ76–vâ†Ræ6Æ–Ö"Â²7F—fS¢fÇ6RÂ6V&6…VæF–æs¢fÇ6RÂ6V&6„FVfW'&VC¢fÇ6RÂ6Æ–ÕVæF–æs¢fÇ6RÀ¢7&W7EVæF–æs¢fÇ6RÂ&WG'“¢Â6V&6„7W'6÷#¢ÂFV'Vu7GV6³¢fÇ6RÂFV'Vu7F÷¢ÓÒ“°¢ö&¦V7Bæ76–vâ†RæÖ÷F–öâÂ²6Æ–Ö#¢Â6Æ–Ö$&ÆVæC¢æâÂ6Æ–Ö%6–FS¢Â6Æ–Ö$F—&V7F–öã¢Â6Æ–Ö%7G&–FS¢À¢ÖçFÆS¢Â&öÆÃ¢Â&öÆÄævÆS¢Â6†&vS¢À¢ÆæF–æs¢ÂF¶Vöfc¢Â7W÷'Döfg6WC¢ÂÆ#¢fÇ6RÂÆ%'Vä–ã¢fÇ6RÂÆ%v÷&³¢""Â6Ö6ƒ¢fÇ6RÒ“°¢Ræv÷&–ÆÆç÷6TÖævVBƒ"Â7F'Bç‚Â7F'Bç’Â7F'Bç¢ÂRæ†VF–ærÂÂfÇ6RÂfÇ6RÂ""ÂRæÖ÷F–öâ“°¢2çWFFUv÷&ÆB‡&ö÷B“²"æ†VGV'FW'2ç6öÆ–G2ç&÷2ç7–æ2‚“°¢òò7W&f6TBöæÇ’FW67&–&W2F†R&ö÷Bw26öÇVÖââ6WGFÆRF†R6ö×ÆWFRfö÷G&–çBöâæV&'’&ööbG&V@¢òòæB6W'F–g’F†R7GVÂ&–r&Vf÷&R—77V–ærF†R6ÖRÆ÷vW"ÆFW&ÂvÆÂFW7F–æF–öâà¢6öç7B&WVW7FVE7F'BÒ²ââç7F'BÒÂ6öÆ–BÒ‡‚Â’Â¢’Óâ"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢¢bb"æ—6ÆæBç6öÆ–DB‡‚ÒãBÂ’Â¢’bb"æ—6ÆæBç6öÆ–DB‡‚²ãBÂ’Â¢¢bb"æ—6ÆæBç6öÆ–DB‡‚Â’ÒãBÂ¢’bb"æ—6ÆæBç6öÆ–DB‡‚Â’²ãBÂ¢¢bb"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢ÒãB’bb"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢²ãB“°¢6öç7B6ÆV%&÷2Ò…öVçG'’Â‚Â’Â¢Âç‚Âç’Âç¢Â&F—W2Â†V–v‡BÂö7F÷'2Â÷&–FW'2Âç"Ò&F—W2Âæ‚Ò†V–v‡B’Óà¢"æ†VGV'FW'2ç6öÆ–G2ç&÷2ç6VvÖVçD6ÆV"‡‚Â’Â¢Âç‚Âç’Âç¢Â&F—W2Â†V–v‡BÂçVÆÂÂç"Âæ‚“°¢ÆWBfÆ–E7F'BÒfÇ6S°¢f÷"†ÆWB’Ò²’Â#S²’²²’°¢6öç7BF—7Fæ6RÒ’òÖF‚æ6V–Â†’ò‚’¢ãr¢ÂævÆRÒ’¢ÖF‚å’òC°¢6öç7B‚Ò&WVW7FVE7F'Bç‚²ÖF‚ç6–â†ævÆR’¢F—7Fæ6RÂ¢Ò&WVW7FVE7F'Bç¢²ÖF‚æ6÷2†ævÆR’¢F—7Fæ6S°¢ÆWB’Ò"æ—6ÆæBç7W&f6TB‡‚Â¢“°¢Ræ6ö×7BÒRæv÷&–ÆÆæ6ö×7C°¢f÷"†ÆWB6WGFÆRÒ²6WGFÆRÂƒ²6WGFÆR²²’°¢6öç7BfÆö÷"Ò2ç7W÷'DB†RÂ‚Â¢Â’ÂãS"ÂRæ†VF–ær“°¢–b‚çVÖ&W"æ—4f–æ—FR†fÆö÷"’ÇÂÖF‚æ'2†fÆö÷"Ò’’ÂRÓR’²’ÒfÆö÷#²'&V³²Ð¢’ÒfÆö÷#°¢Ð¢–b‚çVÖ&W"æ—4f–æ—FR‡’’ÇÂÖF‚æ'2‡’Ò&WVW7FVE7F'Bç’’âã"’6öçF–çVS°¢Ræv÷&–ÆÆç÷6TÖævVBƒ"Â‚Â’Â¢ÂRæ†VF–ærÂÂfÇ6RÂfÇ6RÂ""ÂRæÖ÷F–öâ“°¢–b‚Ræv÷&–ÆÆæ6Æ–Ö%÷6T6ÆV"ƒÂ‚Â’Â¢ÂRæ†VF–ærÂRæÖ÷F–öâÂ6öÆ–BÂ6ÆV%&÷2ÂRÂÂG'VR’’6öçF–çVS°¢ö&¦V7Bæ76–vâ‡7F'BÂ²‚Â’Â¢Ò“²fÆ–E7F'BÒG'VS²'&V³°¢Ð¢–b‚fÆ–E7F'B’&WGW&â²f—‡GW&S¢fÇ6RÂ&V6öã¢$æò7W÷'FVB6ÆV"&ööb7F'B"Â&WVW7FVE7F'BÓ°¢2çWFFUv÷&ÆB‡&ö÷B“°¢6öç7BÖ÷fUFòÒ††—B’Óâ°¢6öç7Bg&öÒÒ²ââæRç&ö÷Bç÷6—F–öâÒÂ&V6÷fW&–W2ÒRç7GV6²ç&V6÷fW&–W3°¢6öç7B66WFVBÒ2æFV'VtÖ÷fR†RÂ†—Bç‚Â†—Bç’Â†—Bç¢Â†—Bææ÷&ÖÂ“°¢ÆWB6V6öæG2ÒÂÖ…7FWÒÂ6Æ–Ö&–ærÒÂfW'F–6ÄW†7W'6–öâÒÂ÷fW&ÆÒçVÆÂÂ7F–VD†æv–ærÒRæ6Æ–Ö"æ7F—fS°¢ÆWB‚Òg&öÒç‚Â’Òg&öÒç’Â¢Òg&öÒç£°¢v†–ÆR†66WFVBbb6V6öæG2ÂCRbbRæFV'VtÖ÷fRç7FGW2ÓÒ&'&—fVB"bbRæFV'VtÖ÷fRç7FGW2ÓÒ&&Æö6¶VB"’°¢"æGfæ6Rƒò3Âò3“²6V6öæG2³Òò3°¢6öç7BÒRç&ö÷Bç÷6—F–öã°¢Ö…7FWÒÖF‚æÖ‚†Ö…7FWÂÖF‚æ‡—÷B‡ç‚Ò‚Âç’Ò’Âç¢Ò¢’“°¢fW'F–6ÄW†7W'6–öâÒÖF‚æÖ‚‡fW'F–6ÄW†7W'6–öâÂÖF‚æ'2‡ç’Òg&öÒç’’“°¢‚Òçƒ²’Òç“²¢Òç£°¢–b†Ræ6Æ–Ö"æ7F—fR’6Æ–Ö&–ær²³²VÇ6R7F–VD†æv–ærÒfÇ6S°¢2çWFFUv÷&ÆB†Rç&ö÷BÂ&ö÷Bçv÷&ÆB“°¢–b‚÷fW&Æ’2çG&fW'6Uf—6–&ÆR†Rç&ö÷BÂæöFRÓâ°¢–b†÷fW&ÆÇÂæöFRævVöÖWG'’’&WGW&ã°¢6öç7BfW'G2ÒæöFRævVöÖWG'’çfW'G2ÂÒÒæöFRçv÷&ÆC°¢f÷"†ÆWB’Ò²’ÂfW'G2æÆVæwFƒ²’³Ò2’°¢6öç7B‚ÒÕ³Ò¢fW'G5¶•Ò²Õ³EÒ¢fW'G5¶’²Ò²Õ³…Ò¢fW'G5¶’²%Ò²Õ³%Ó°¢6öç7B’ÒÕ³Ò¢fW'G5¶•Ò²Õ³UÒ¢fW'G5¶’²Ò²Õ³•Ò¢fW'G5¶’²%Ò²Õ³5Ó°¢6öç7B¢ÒÕ³%Ò¢fW'G5¶•Ò²Õ³eÒ¢fW'G5¶’²Ò²Õ³Ò¢fW'G5¶’²%Ò²Õ³EÓ°¢òòÖ–ÆÆ–ÖWG&R6öçF7B—2ÆÆ÷vVC²&VæFW&VBfW'FW‚Væ6Æ÷6VB–â7FöæP¢òòöâWfW'’6–FR—2VæWG&F–öâÂ–æ6ÇVF–ærGW&–ærF†RÖ÷VçBG&ç6—F–öâà¢–b„"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢’bb"æ—6ÆæBç6öÆ–DB‡‚ÒãBÂ’Â¢’bb"æ—6ÆæBç6öÆ–DB‡‚²ãBÂ’Â¢¢bb"æ—6ÆæBç6öÆ–DB‡‚Â’ÒãBÂ¢’bb"æ—6ÆæBç6öÆ–DB‡‚Â’²ãBÂ¢¢bb"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢ÒãB’bb"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢²ãB’’²÷fW&ÆÒ²‚Â’Â¢Â6V6öæG2Ó²'&V³²Ð¢Ð¢Ò“°¢Ð¢6öç7BÒRç&ö÷Bç÷6—F–öâÂG‚Òç‚Ò†—Bç‚ÂG¢Òç¢Ò†—Bç£°¢&WGW&â²66WFVBÂ6V6öæG2Âg&öÒÂF&vWC¢²ƒ¢†—Bç‚Â“¢†—Bç’Â£¢†—Bç¢ÒÂVæC¢²ââçÒÀ¢7FGW3¢RæFV'VtÖ÷fRç7FGW2Â&V6öã¢RæFV'VtÖ÷fRç&V6öâÂ6Æ–Ö&–ærÂ†æv–æs¢Ræ6Æ–Ö"æ7F—fRÂ7F–VD†æv–ærÀ¢ÆFW&Ã¢ÖF‚æ'2‚‡ç‚Òg&öÒç‚’¢7"Ò‡ç¢Òg&öÒç¢’¢7"’ÂG&÷¢g&öÒç’Òç’ÂfW'F–6ÄW†7W'6–öâÀ¢FævVçDW'&÷#¢ÖF‚æ'2†G‚¢†—Bææ÷&ÖÂç¢ÒG¢¢†—Bææ÷&ÖÂç‚’Â÷WGv&Dv¢G‚¢†—Bææ÷&ÖÂç‚²G¢¢†—Bææ÷&ÖÂç¢À¢fW'F–6ÄW'&÷#¢ÖF‚æ'2‡ç’Ò†—Bç’’ÂÖ…7FWÂ÷fW&ÆÂ&V6÷fW&–W3¢Rç7GV6²ç&V6÷fW&–W2Ò&V6÷fW&–W2Ó°¢Ó°¢6öç7Bf—'7BÒÖ÷fUFò‡F&vWB“°¢òò&WF&vWBF†R†æv–ærv÷&–ÆÆÆöærF†R6ÖR&VÂvÆÂv—F†÷WBÖ÷f–ær—@¢òò÷"&WÆ6–ærF†R6Æ–Ö"7FFRâ&÷WFR÷fW"F†R&ööb—2æ÷BvÆÂG&fW'6Rà¢6öç7B6–FWv—2Ò²æöFS¢çVÆÂÂ÷væW#¢çVÆÂÂƒ¢Â“¢Â£¢Âæ÷&ÖÃ¢²ƒ¢Â“¢Â£¢ÒÓ°¢6öç7BÒRç&ö÷Bç÷6—F–öâÂ6–FU‚Ò‡ç‚ÒÖ÷WF‚ç‚’¢7"Ò‡ç¢ÒÖ÷WF‚ç¢’¢7"Ò"ãƒ°¢6öç7B6V6öæD†—BÒf—'7Bç7FGW2ÓÓÒ&'&—fVB"bbf—'7Bæ†æv–ærbb&’ç&’‡6–FWv—2À¢Ö÷WF‚ç‚²7"¢6–FU‚²7"¢‚ÂF&vWBç’ÂÖ÷WF‚ç¢Ò7"¢6–FU‚²7"¢‚Â×7"ÂÂÖ7"Â#“°¢6öç7B6V6öæBÒ6V6öæD†—BòÖ÷fUFò‡6–FWv—2’¢çVÆÃ°¢2æ6æ6VÄFV'VtÖ÷fR†R“°¢òò6×–vâ7W&FVBÓ"&V6†VBF†—23&–Òv—F‚&÷F‚f—7G2&÷fR—G0¢òò7FöæRâ6†V6²F†R7GVÂ&VæFW&VBÆ×2F‡&÷Vv†÷WBw&—7–6ÆRÂ6W&FP¢òòg&öÒF†RÆææW"w2'&—fÂ7FGW2æB—G26öÆÆ—6–öâÖVçfVÆ÷R6×ÆW2à¢ö&¦V7Bæ76–vâ†RæÖ÷F–öâÂ²6Æ–Ö#¢Â6Æ–Ö$&ÆVæC¢Â6Æ–Ö$F—&V7F–öã¢Óãc#SS#S#cs3’À¢6Æ–Ö%6–FS¢Óãc#SS#S#cs3‚ÂÖçFÆS¢Â7W÷'Döfg6WC¢Ò“°¢6öç7Bw&—2ÒµÒÂw&—†—BÒ²æöFS¢çVÆÂÂ÷væW#¢çVÆÂÂƒ¢Â“¢Â£¢Âæ÷&ÖÃ¢²ƒ¢Â“¢Â£¢ÒÓ²ÆWB÷6T×2ÒÂ&Wf–Wt×2Ò°¢f÷"†ÆWB6×ÆRÒ²6×ÆRÂ3²6×ÆR²²’°¢RæÖ÷F–öâæ6Æ–Ö%7G&–FRÒÓBãƒc3ƒƒ#33ƒƒ2²6×ÆR¢ã°¢6öç7Bæ÷rÒW&f÷&Öæ6Rææ÷r‚“°¢Ræv÷&–ÆÆç÷6TÖævVBƒ"ÂÓ’ã3#“3Cc#ƒ“S‚ÂBã3“s“Ss3Cƒ3‚ÂÓ‚ã#Ss3CƒcC#ScRÂÖF‚å’ÂÂfÇ6RÂfÇ6RÂ""ÂRæÖ÷F–öâ“°¢÷6T×2³ÒW&f÷&Öæ6Rææ÷r‚’Òæ÷s°¢6öç7B&Wf–Wu7F'BÒW&f÷&Öæ6Rææ÷r‚’ÂÒRç&ö÷Bç÷6—F–öã°¢6öç7B&Wf–Wt6ÆV"ÒRæv÷&–ÆÆæ6Æ–Ö%÷6T6ÆV"ƒò3Âç‚Âç’Âç¢ÂÖF‚å’ÂRæÖ÷F–öâÂ6öÆ–BÂ6ÆV%&÷2ÂR“°¢&Wf–Wt×2³ÒW&f÷&Öæ6Rææ÷r‚’Ò&Wf–Wu7F'C°¢2çWFFUv÷&ÆB†Rç&ö÷BÂ&ö÷Bçv÷&ÆB“°¢ÆWBvÒ–æf–æ—G’Â÷fW&ÆÒçVÆÃ°¢2çG&fW'6Uf—6–&ÆR†Rç&ö÷BÂæöFRÓâ°¢–b‚æöFRævVöÖWG'’’&WGW&ã°¢6öç7BbÒæöFRævVöÖWG'’çfW'G2ÂÒÒæöFRçv÷&ÆBÂ6Æ—ÒæöFRævVöÖWG'’æ6Æ—ÆæRÂ†æBÒæöFRÓÓÒRç'G2æ&ÔÂÇÂæöFRÓÓÒRç'G2æ&Õ#°¢ÆWBÆ÷rÒ–æf–æ—G’Â†–v‚ÒÔ–æf–æ—G“°¢–b††æB’f÷"†ÆWB’Ò²’ÂbæÆVæwFƒ²’³Ò2’²Æ÷rÒÖF‚æÖ–â†Æ÷rÂe¶•Ò“²†–v‚ÒÖF‚æÖ‚††–v‚Âe¶•Ò“²Ð¢f÷"†ÆWB’Ò²’ÂbæÆVæwFƒ²’³Ò2’°¢6öç7B‚ÒÕ³Ò¢e¶•Ò²Õ³EÒ¢e¶’²Ò²Õ³…Ò¢e¶’²%Ò²Õ³%Ó°¢6öç7B’ÒÕ³Ò¢e¶•Ò²Õ³UÒ¢e¶’²Ò²Õ³•Ò¢e¶’²%Ò²Õ³5Ó°¢6öç7B¢ÒÕ³%Ò¢e¶•Ò²Õ³eÒ¢e¶’²Ò²Õ³Ò¢e¶’²%Ò²Õ³EÓ°¢–b†6Æ—bb6Æ—³Ò¢‚²6Æ—³Ò¢’²6Æ—³%Ò¢¢²6Æ—³5Òâ’6öçF–çVS°¢–b‚÷fW&Æbb6öÆ–B‡‚Â’Â¢’’÷fW&ÆÒ²‚Â’Â¢Â†æBÓ°¢–b‚†æBÇÂe¶’²ÒâÆ÷r²††–v‚ÒÆ÷r’¢ãR²RÓb’6öçF–çVS°¢–b„"æ—6ÆæBç6öÆ–DB‡‚Â’Â¢’’vÒ°¢VÇ6R–b‡&’ç&’†w&—†—BÂ‚Â’Â¢ÂÂÂÓÂ2’’vÒÖF‚æÖ–â†vÂw&—†—BæF—7Fæ6R“°¢Ð¢Ò“°¢w&—2çW6‚‡²v¢çVÖ&W"æ—4f–æ—FR†v’òv¢çVÆÂÂ÷fW&ÆÂ&Wf–Wt6ÆV"Ò“°¢Ð¢&WGW&â²f—‡GW&S¢7F'Bç’â2bbÖF‚æ'2‡F&vWBææ÷&ÖÂç’’Âã"À¢f—'7BÂ6V6öæDf—‡GW&S¢6V6öæD†—BbbÖF‚æ'2‡6–FWv—2ææ÷&ÖÂç’’Âã"Â6V6öæBÂw&—2Â÷6T×2Â&Wf–Wt×2Ó°¢Ò’‚–“°¢6öç7B6fT'&—fÂÒ&÷rÓâ&÷rbb&÷ræ66WFVBbb&÷rç7FGW2ÓÓÒ&'&—fVB"bb&÷ræ†æv–ærbb&÷ræ6Æ–Ö&–ærâP¢bb&÷rçFævVçDW'&÷"ÃÒã‚bb&÷ræ÷WGv&Dvâã2bb&÷ræ÷WGv&DvÂ"bb&÷rçfW'F–6ÄW'&÷"ÂãP¢bb&÷ræÖ…7FWÂã#"bb&÷ræ÷fW&Æbb&÷rç&V6÷fW&–W3°¢&V6÷&B‚&v÷&–ÆÆvÆÂFW7F–æF–öã¢&ööbv÷&–ÆÆ&V6†W2F†R6Æ–6¶VBÆ÷vW"ÆFW&ÂvÆÂw&—F‡&÷Vv‚6öçF–çV÷W26Æ–Ö&–ærv—F†÷WB&VÆö6F–öâ÷"FW'&–âVæWG&F–öâ"À¢7FFRæf—‡GW&Rbb6fT'&—fÂ‡7FFRæf—'7B’bb7FFRæf—'7BæÆFW&Ââ2ãRbb7FFRæf—'7BæG&÷âãRÂ¥4ôâç7G&–æv–g’‡7FFRæf—'7BÇÂ7FFR’“°¢&V6÷&B‚&v÷&–ÆÆvÆÂFW7F–æF–öã¢6V6öæB6Æ–6²Ö÷fW2F†R†æv–ærv÷&–ÆÆ6–FWv—2ÆöærF†RvÆÂv—F†÷WBF—6Ö÷VçF–ærÂFVÆW÷'F–ær÷"VçFW&–ær7FöæR"À¢7FFRç6V6öæDf—‡GW&Rbb6fT'&—fÂ‡7FFRç6V6öæB’bb7FFRç6V6öæBç7F–VD†æv–æp¢bb7FFRç6V6öæBæÆFW&Ââã"bb7FFRç6V6öæBçfW'F–6ÄW†7W'6–öâÂãrÂ¥4ôâç7G&–æv–g’‡7FFRç6V6öæBÇÂ7FFR’“°¢&V6÷&B‚&v÷&–ÆÆvÆÂw&—¢Æ÷vW&VB†æG26öçF7BF†RVæWfVâ6fR&–ÒF‡&÷Vv†÷WBF†V—"7–6ÆRv—F†÷WBç’&VæFW&VBÖW6‚VæWG&F–ær7FöæR"À¢7FFRæw&—3òæÆVæwF‚ÓÓÒ2bb7FFRæw&—2æWfW'’‡&÷rÓâ&÷rævÓÒçVÆÂbb&÷rævÂãRbb&÷ræ÷fW&Æbb&÷rç&Wf–Wt6ÆV"’À¢¥4ôâç7G&–æv–g’‡²w&—3¢7FFRæw&—2Â÷6T×3¢7FFRç÷6T×2Â&Wf–Wt×3¢7FFRç&Wf–Wt×2Ò’“°¢6öç7BÆ%G&ç6—F–öâÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ2Ò$Âç66VæRÂRÒ"æ6Ææ¶W'2æÆ—7Bæf–æB†RÓâRæ÷væW"çG&—G2ææÖRÓÓÒ'÷'FÆæF†öFÂ"’Â&ö÷BÒ$Âç66VæW2æ‡V"ç&ö÷C°¢"æ6Ææ¶W'2æ6æ6VÄFV'VtÖ÷fR†R“°¢ö&¦V7Bæ76–vâ†RæÖ÷F–öâÂ²6Æ–Ö#¢Â6Æ–Ö$&ÆVæC¢æâÂ6Æ–Ö$F—&V7F–öã¢Â6Æ–Ö%6–FS¢Â6Æ–Ö%7G&–FS¢ÂÖçFÆS¢À¢6Æ–Ö$w&—ƒ¢æâÂ6Æ–Ö$w&—“¢æâÂ6Æ–Ö$w&—£¢æâÂÆ%'Vä–ã¢fÇ6RÂÆ%v÷&³¢""ÂÆ%7VVW¦S¢fÇ6RÀ¢&öÆÃ¢Â&öÆÄævÆS¢Â6†&vS¢ÂÆæF–æs¢ÂF¶Vöfc¢Â7W÷'Döfg6WC¢Â6Ö6ƒ¢fÇ6RÒ“°¢6öç7B6VçFW"ÒæöFRÓâ°¢6öç7B"Ò2æ&÷VæG4öb†æöFRævVöÖWG'’’Â‚Ò†"æÖ–å³Ò²"æÖ…³Ò’ò"Â’Ò†"æÖ–å³Ò²"æÖ…³Ò’ò"Â¢Ò†"æÖ–å³%Ò²"æÖ…³%Ò’ò"ÂÒÒæöFRçv÷&ÆC°¢&WGW&â¶Õ³Ò¢‚²Õ³EÒ¢’²Õ³…Ò¢¢²Õ³%ÒÂÕ³Ò¢‚²Õ³UÒ¢’²Õ³•Ò¢¢²Õ³5ÒÂÕ³%Ò¢‚²Õ³eÒ¢’²Õ³Ò¢¢²Õ³EÕÓ°¢Ó°¢6öç7B&÷w2ÒµÓ°¢f÷"†6öç7BVçFW&–æröb·G'VRÂfÇ6UÒ’°¢òòF†W6RF¦6VçB&ö÷G27G&FFÆRF†RÆ"&÷VæF'’g&öÒ7W&FVBÓw0¢òò6GW&VB6æ²F†R&W7BöbF†RvÆ²¶VW2—G2&VÂã’Ò÷27G&–FRà¢6öç7B‚ÒVçFW&–æròÓãs3S“R¢ÓãsS“c°¢6öç7B¢ÒVçFW&–æròÓ‚ãS“3ScSC“#S“sr¢Ó‚ãc“SCcƒ3cSSÂ6–vâÒVçFW&–æròÓ¢°¢RæÖ÷F–öâæÆ"ÒVçFW&–æs°¢Ræv÷&–ÆÆç÷6TÖævVBƒ"Â‚ÂÂ¢Â2ãccS“C#“ƒƒƒ"Âã’ÂfÇ6RÂVçFW&–ærÂ""ÂRæÖ÷F–öâ“°¢2çWFFUv÷&ÆB†Rç&ö÷BÂ&ö÷Bçv÷&ÆB“°¢ÆWB†VBÒ6VçFW"†Rç'G2æ†VB’ÂF÷'6òÒ6VçFW"†Rç'G2çF÷'6ò’ÂÖ…7FWÒ°¢6öç7B&Vf÷&RÒRæv÷&–ÆÆæFV'Vrç—F6ƒ°¢RæÖ÷F–öâæÆ"ÒVçFW&–æs°¢f÷"†ÆWBg&ÖRÒ²g&ÖRÃÒ#C²g&ÖR²²’°¢Ræv÷&–ÆÆç÷6TÖævVBƒò3Â‚²6–vâ¢g&ÖR¢ãRÂÂ¢²6–vâ¢g&ÖR¢ã#S“ƒsc#3S33bÀ¢2ãccS“C#“ƒƒƒ"Âã’ÂfÇ6RÂVçFW&–ærÂ""ÂRæÖ÷F–öâ“°¢2çWFFUv÷&ÆB†Rç&ö÷BÂ&ö÷Bçv÷&ÆB“°¢6öç7BæW‡D†VBÒ6VçFW"†Rç'G2æ†VB’ÂæW‡EF÷'6òÒ6VçFW"†Rç'G2çF÷'6ò“°¢Ö…7FWÒÖF‚æÖ‚†Ö…7FWÂÖF‚æ‡—÷B‚ââææW‡D†VBæÖ‚†âÂ’’ÓââÒ†VE¶•Ò’’ÂÖF‚æ‡—÷B‚ââææW‡EF÷'6òæÖ‚†âÂ’’ÓââÒF÷'6õ¶•Ò’’“°¢†VBÒæW‡D†VC²F÷'6òÒæW‡EF÷'6ó°¢Ð¢6öç7BgFW"ÒRæv÷&–ÆÆæFV'Vrç—F6ƒ°¢Ræv÷&–ÆÆç÷6TÖævVBƒ"ÂRç&ö÷Bç÷6—F–öâç‚ÂRç&ö÷Bç÷6—F–öâç’ÂRç&ö÷Bç÷6—F–öâç¢Â2ãccS“C#“ƒƒƒ"Âã’ÂfÇ6RÂVçFW&–ærÂ""ÂRæÖ÷F–öâ“°¢6öç7B6WGFÆVBÒRæv÷&–ÆÆæFV'Vrç—F6‚Âv—BÒRæv÷&–ÆÆæFV'Vræv—C°¢ÆWBv÷&µ&—6RÒçVÆÃ°¢–b†VçFW&–ær’°¢2çWFFUv÷&ÆB†Rç&ö÷BÂ&ö÷Bçv÷&ÆB“²6öç7B†æE’Ò6VçFW"†Rç'G2æ&Õ"•³Ó°¢RæÖ÷F–öâæÆ%v÷&²Ò'F÷V6‚#²RæÖ÷F–öâæÆ%6–FRÒ°¢Ræv÷&–ÆÆç÷6TÖævVBƒãRÂRç&ö÷Bç÷6—F–öâç‚ÂRç&ö÷Bç÷6—F–öâç’ÂRç&ö÷Bç÷6—F–öâç¢Â2ãccS“C#“ƒƒƒ"ÂÂfÇ6RÂG'VRÂ""ÂRæÖ÷F–öâ“°¢2çWFFUv÷&ÆB†Rç&ö÷BÂ&ö÷Bçv÷&ÆB“²v÷&µ&—6RÒ6VçFW"†Rç'G2æ&Õ"•³ÒÒ†æE“°¢RæÖ÷F–öâæÆ%v÷&²Ò"#°¢Ð¢&÷w2çW6‚‡²VçFW&–ærÂ&Vf÷&RÂgFW"Â6WGFÆVBÂv—BÂÖ…7FWÂv÷&µ&—6RÒ“°¢Ð¢&WGW&â&÷w3°¢Ò’‚–“°¢&V6÷&B‚&v÷&–ÆÆÆ"7Fæ6S¢VçFW&–æræBÆVf–ærF†RÆ"6Öö÷F†Ç’æ–ÖFRF†R&VæFW&VB†VBæBF÷'6ò–ç7FVBöb6æ–ærW&–v‡B÷"öçFòÆÂf÷W'2"À¢Æ%G&ç6—F–öâæWfW'’‡&÷rÓâ&÷ræÖ…7FWÂã2bbÖF‚æ'2‡&÷rægFW"Ò&÷rç6WGFÆVB’Âã#P¢bb‡&÷ræVçFW&–ærò&÷ræv—BÓÓÒ'W&–v‡B"bb&÷ræ&Vf÷&RÒ&÷rægFW"âãcRbb&÷rçv÷&µ&—6Râã@¢¢&÷ræv—BÓÓÒ&¶çV6¶ÆR"bb&÷rægFW"Ò&÷ræ&Vf÷&RâãcR’’Â¥4ôâç7G&–æv–g’†Æ%G&ç6—F–öâ’“°§ÒÕÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢&Ö—'&÷"6Ææ¶W""ÂVW'“¢'6öÆóÓf6†&7FW#×÷'FÆæF†öFÂg7FGW3Ö6Ææ¶–â"Â7FW3¢·²æÖS¢&Ö—'&÷"6Ææ¶W"7F—2–ç6–FR"Âv‡“¢'&Vw&W76–öã¢6Ææ¶W"GW&æVB&÷VæBgFW"7&÷76–ærF†RÖ—'&÷"Âö¶VB—G2†VB&6²÷WBÂæBv÷&¶VB&W6–FRvÆ÷v–ærvVæW&–2&÷‚"Â'Vã¢7–æ2†"’Óâ°¢6öç7B7FFRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ2Ò"æ6Ææ¶W'2Â6—FT–æFW‚Ò2ç6—FW2æf–æD–æFW‚‡2Óâ2æÖ—'&÷%&ööÒ’Â6—FRÒ2ç6—FW5·6—FT–æFW…ÒÂÒÒ6—FRæÖ÷WF‚ÂRÒ2æÆ—7E³ÒÂÆö6Å‚ÒÓâ‡ç‚ÒÒç‚’¢6—FRæ7"Ò‡ç¢ÒÒç¢’¢6—FRç7"ÂÆö6Å¢ÒÓâ‡ç‚ÒÒç‚’¢6—FRç7"²‡ç¢ÒÒç¢’¢6—FRæ7"ÂÆ6RÒ‡‚Â¢’Óâ‡²ƒ¢Òç‚²6—FRæ7"¢‚²6—FRç7"¢¢Â“¢ÒæfÆö÷%’Â£¢Òç¢Ò6—FRç7"¢‚²6—FRæ7"¢¢Ò“²Ræ÷væW"ç7FFRÒ'v÷&¶–ær#²Ræ÷væW"çv÷&²ç6—FRÒRæ÷væW"çv÷&²çÆææVE6—FRÒRç6—FRÒ6—FT–æFWƒ²RçVæF–æu6—FRÒÓ²Ræ†56Æ÷BÒG'VS²Rç6Æ÷D–æFW‚Ò²ö&¦V7Bæ76–vâ†RÂ²6Æ÷Eƒ¢Æ6RƒÂÓBã“"’ç‚Â6Æ÷E“¢ÒæfÆö÷%’Â6Æ÷E£¢Æ6RƒÂÓBã“"’ç¢Â†6S¢'G&fVÂ"Â&÷WFS¢&VçFW""Âg&öÕ6—FS¢ÓÂVçG'•GW&ã¢fÇ6RÂ&Æö6¶VC¢Â&WG'“¢Ò“²ö&¦V7Bæ76–vâ†Rç&ö÷Bç÷6—F–öâÂÆ6RƒÂ’“²Ræ†VF–ærÒÒç'’²ÖF‚å“²"æGfæ6Rƒã#RÂòc“²6öç7BVçG'’Ò²GW&ã¢RæVçG'•GW&âÂvöÃ¢Æö6Å¢‡²ƒ¢RævöÅ‚Â£¢RævöÅ¢Ò’Ó²ö&¦V7Bæ76–vâ†Rç&ö÷Bç÷6—F–öâÂÆ6RƒÂÓBã“"’“²Rç†6RÒ'v÷&²#²Rç&÷WFRÒ"#²RævöÅ‚ÒRç6Æ÷Eƒ²RævöÅ’ÒRç6Æ÷E“²RævöÅ¢ÒRç6Æ÷E£²ÆWBÖ–å‚Ò–æf–æ—G’ÂÖ…‚ÒÔ–æf–æ—G’ÂÖ–å¢Ò–æf–æ—G’ÂÖ…¢ÒÔ–æf–æ—G’ÂF—7Fæ6RÒÂÆ7E‚ÒRç&ö÷Bç÷6—F–öâç‚ÂÆ7E¢ÒRç&ö÷Bç÷6—F–öâç£²f÷"†ÆWBBÒ²BÂƒ²B³Òò3’²"æGfæ6Rƒò3Âò3“²6öç7B‚ÒÆö6Å‚†Rç&ö÷Bç÷6—F–öâ’Â¢ÒÆö6Å¢†Rç&ö÷Bç÷6—F–öâ“²Ö–å‚ÒÖF‚æÖ–â†Ö–å‚Â‚“²Ö…‚ÒÖF‚æÖ‚†Ö…‚Â‚“²Ö–å¢ÒÖF‚æÖ–â†Ö–å¢Â¢“²Ö…¢ÒÖF‚æÖ‚†Ö…¢Â¢“²F—7Fæ6R³ÒÖF‚æ‡—÷B†Rç&ö÷Bç÷6—F–öâç‚ÒÆ7E‚ÂRç&ö÷Bç÷6—F–öâç¢ÒÆ7E¢“²Æ7E‚ÒRç&ö÷Bç÷6—F–öâçƒ²Æ7E¢ÒRç&ö÷Bç÷6—F–öâç£²Ò6öç7B6öçG&öÂÒ"æÖG&—„vFRæ'WGFöâÂÆWfW"Ò"æÖG&—„vFRæÆWfW#²&WGW&â²&ööÓ¢Òç&ööÒÂVçG'’ÂÖ–å‚ÂÖ…‚ÂÖ–å¢ÂÖ…¢ÂF—7Fæ6RÂ&V6÷fW&–W3¢Rç7GV6²ç&V6÷fW&–W2ÂWV—ÖVçC¢2æWV—ÖVçBæf–ÇFW"†—FVÒÓâ—FVÒç6—FRÓÓÒ6—FT–æFW‚’æÆVæwF‚ÂÆWfW%“¢6öçG&öÂç÷6—F–öâç’ÂÆWfW%66ÆS¢6öçG&öÂç66ÆRç’ÂÆWfW%£¢6öçG&öÂç÷6—F–öâç¢ÂÆWfW%FvvVC¢6öçG&öÂævVöÖWG'’æÖG&—„6fRÓÒVæFVf–æVBbb6öçG&öÂæ6†–ÆG&VâæWfW'’†æöFRÓâæöFRævVöÖWG'’æÖG&—„6fRÓÒVæFVf–æVB’bbÆWfW"æ6†–ÆG&VâæWfW'’†æöFRÓâæöFRævVöÖWG'’æÖG&—„6fRÓÒVæFVf–æVB’ÂÆWfW$æF—fS¢6öçG&öÂæÖG&—„æF—fRÂÆWfW%'G3¢6öçG&öÂæ6†–ÆG&VâæÆVæwF‚Âw&—'G3¢ÆWfW"æ6†–ÆG&VâæÆVæwF‚Ó²Ò’‚–“°¢&V6÷&B‚&Ö—'&÷"6Ææ¶W#¢F†R6fR6†Ö&W"W‡æG2ÂVçG'’6öçF–çVW27G&–v‡B–çv&BÂ'Vç27&÷72g&öÒ6–FRFò6–FRBf&–VBFWF‡2&V†–æBF†RvÆ72ÂæB6ö×7BvÇ—†VBÆWfW"—2Ö÷VçFVBv—F†–â&V6‚öâF†R&6²vÆÂ"Â7FFRç&ööÒçrâbbb7FFRç&ööÒçFòâbãRbbÖF‚æ'2‡7FFRæVçG'’ævöÂ²2ãR’Âãbb7FFRæÖ…¢ÃÒÓãƒR²RÓbbb7FFRæÖ–å‚ÂÓã‚bb7FFRæÖ…‚âã‚bb7FFRæÖ…¢Ò7FFRæÖ–å¢âbb7FFRæF—7Fæ6Râ‚bb7FFRæWV—ÖVçBÓÓÒbb7FFRæÆWfW%’ãÒbb7FFRæÆWfW%’ÂãRbb7FFRæÆWfW%66ÆRÂbb7FFRæÆWfW%¢Â×7FFRç&ööÒçFò²ã2bb7FFRæÆWfW%FvvVBbb7FFRæÆWfW$æF—fRbb7FFRæÆWfW%'G2ÓÓÒ2bb7FFRæw&—'G2ÓÓÒÂ¥4ôâç7G&–æv–g’‡7FFR’“°§ÒÕÒÒ“°§66VæR‚&‡V""Â²W&c¢G'VRÂVW'“¢&&ææ3Ó"Â÷G3¢²s¢“#Âƒ¢ƒÂW&c¢G'VRÂÖ÷F–öã¢G'VRÒÂ7FW3¢·²æÖS¢'vÆÂÖ÷fVÖVçBW&f÷&Öæ6R"Âv‡“¢'&Vw&W76–öã¢g&ÖR&FRfVÆÂÖ÷f–ær&V†–æB6fRvÆÇ2GW&–ærFöæF–öâ"Â'Vã¢vÆÅW&f÷&Öæ6RÕÒÒ“°§66VæR‚&Æ""Â²7FW3¢¶FöæF–öâ‚&Æ""’ÂÆ%vÆ¶–ærÂÆ$¶W—2ÂG&—‚&Æ""•ÒÒ“°§66VæR‚'&6R"Â²VW'“¢'&–ãÓ"Â7FW3¢·&6U7F'BÂ²æÖS¢'&6RG&6·2"Âv‡“¢'&Vw&W76–öã¢F†R"×6Æ÷Bw&–B7væVBg&VR&ææöâ&ææ&’"Â'Vã¢7–æ2†"’Óâ²v—B"æWfÇVFR†v–æF÷råõööövç&6RçFôv&vR‚–“²v—B&6UG&6·5³Ò†"“²ÒÒÂ&6UW6RÂÆ’‚'&6R"Â&v†öÆR7WVæFW"F†RWF÷–Æ÷C¢WfW'’&6W"f–æ—6†W2–â÷&FW"ÂF†R7WÖVFÂæBWfW'’G&6²w2&W7B&R6fVB"Â7W'Vâ’Â&6TÖ—'&÷"Â&6Tv–âÂG&—‚'&6R"•ÒÒ“°§66VæR‚&G&÷"Â²7FW3¢¶G&÷7F'BÂG&÷7FVW&–ærÂÆ’‚&G&÷"Â&§V×ÆæG2öâF†RF&vWBÂ66÷&W2—G2÷vâÖVFÂæB—26fVB2F†R&W7B"ÂG&÷'Vâ’ÂG&÷7&6‚ÂG&—‚&G&÷"•ÒÒ“°§66VæR‚&÷&&—B"Â²7FW3¢·²æÖS¢&÷&&—BfÆ÷r"Âv‡“¢'&Vw&W76–öã¢F†R76WvÆ²—"&öçW2v2Ö—76–ærg&öÒF†RfÆ–v‡BÆör"Â'Vã¢÷&&—DfÆ÷rÒÂ÷&&—E7FVW&–ærÂ÷&&—DÖ—76VBÂ÷&&—DW66RÂG&—‚&÷&&—B"•ÒÒ“°§66VæR‚&Ö–æR"Â²7FW3¢¶Ö–æU&W7VÖRÂG&—‚&Ö–æR"’ÂÖ–æT6öçG&öÇ5ÒÒ“°§66VæR‚'ööÂ"Â²7FW3¢·ööÄÆVfRÂG&—‚'ööÂ"•ÒÒ“°§66VæR‚&f7F÷'’"Â²VW'“¢&6†&7FW#×÷'FÆæF†öFÂ"Â7FW3¢¶f7F÷'•vÆ¶–ærÂf7F÷'”ÆFFW'2Âf7F÷'•&–Æ–æt§V×Âf7F÷'•vVöç2Âf7F÷'”f÷'v&BÂf7F÷'”f÷&vRÂf7F÷'•6†–VÆG2ÂG&—‚&f7F÷'’"•ÒÒ“°§66VæR‚&f7F÷'’"Â²Æ&VÃ¢&VçG&æ6R"ÂW&Ã¢‡V%vR‡7&2Â&6†&7FW#×÷'FÆæF†öFÂ"’Â7FW3¢¶f7F÷'”fÆö÷"Âf7F÷'”VçG&æ6UÒÒ“°§66VæR‚&f7F÷'’"Â²Æ&VÃ¢&6çf3&B"ÂVW'“¢&6çf3&CÓ"Â7FW3¢¶f7F÷'”6çf5ÒÒ“°§66VæR‚&&–g&÷7B"Â²W&Ã¢‡V%vR‡7&2Â'6öÆóÓf6†&7FW#×÷'FÆæF†öFÂ"’Â7FW3¢¶&–g&÷7DVçG&æ6RÂ&–g&÷7EvÆ¶–ærÂ&–g&÷7DW†—BÂG&—‚&&–g&÷7B"•ÒÒ“°§66VæR‚&&–g&÷7B"Â²Æ&VÃ¢&G6"&÷VæBG&—"ÂVW'“¢&6†&7FW#×÷'FÆæF†öFÂ"Â7FW3¢¶&–g&÷7DG6%ÒÒ“°§66VæR‚&&–g&÷7B"Â²Æ&VÃ¢'ö¶W"&÷VæBG&—"ÂVW'“¢&6†&7FW#×÷'FÆæF†öFÂ"Â7FW3¢¶&–g&÷7Eö¶W%ÒÒ“°§66VæR‚&&–g&÷7B"Â²Æ&VÃ¢&6çf3&B"ÂW&Ã¢‡V%vR‡7&2Â&6çf3&CÓ"’Â7FW3¢¶&–g&÷7D6çf5ÒÒ“°§66VæR‚&&6FR"Â²VW'“¢&6†&7FW#×÷'FÆæF†öFÂ"Â7FW3¢¶&6FUvÆ¶–ærÂ&6FTÖ6†–æRÂ&6FUÆ’ÂG&—‚&&6FR"•ÒÒ“°§66VæR‚'6¶VR"Â²7FW3¢¶6&æ—fÅÆ’‚'6¶VR"ÂãR’ÂG&—‚'6¶VR"•ÒÒ“°§66VæR‚&†ö÷2"Â²7FW3¢¶6&æ—fÅÆ’‚&†ö÷2"Âã"’ÂG&—‚&†ö÷2"•ÒÒ“°§66VæR‚'6‡’"Â²7FW3¢¶6&æ—fÅÆ’‚'6‡’"Âãr’ÂG&—‚'6‡’"•ÒÒ“°§66VæR‚&6Ær"Â²7FW3¢¶6&æ—fÅÆ’‚&6Ær"Âãb’ÂG&—‚&6Ær"•ÒÒ“°§66VæR‚&†ö6¶W’"Â²7FW3¢¶6&æ—fÅÆ’‚&†ö6¶W’"ÂãR’ÂG&—‚&†ö6¶W’"•ÒÒ“°§66VæR‚&&–ÆÆ–&G2"Â²7FW3¢¶6&æ—fÅÆ’‚&&–ÆÆ–&G2"Âã‚’ÂG&—‚&&–ÆÆ–&G2"•ÒÒ“°§66VæR‚&F'G2"Â²7FW3¢¶6&æ—fÅÆ’‚&F'G2"ÂãR’ÂG&—‚&F'G2"•ÒÒ“°§66VæR‚'–æ&ÆÂ"Â²7FW3¢¶6&æ—fÅÆ’‚'–æ&ÆÂ"ÂãR’ÂG&—‚'–æ&ÆÂ"•ÒÒ“°§66VæR‚'&–FR"Â²7FW3¢¶6&æ—fÅÆ’‚'&–FR"Âã"’ÂG&—‚'&–FR"•ÒÒ“°§66VæR‚&–çfFW'2"Â²7FW3¢¶6&æ—fÅÆ’‚&–çfFW'2"Âã#R’ÂG&—‚&–çfFW'2"•ÒÒ“°§66VæR‚'6æ¶R"Â²7FW3¢¶6&æ—fÅÆ’‚'6æ¶R"ÂãR’ÂG&—‚'6æ¶R"•ÒÒ“°§66VæR‚'öær"Â²7FW3¢¶6&æ—fÅÆ’‚'öær"ÂãR’ÂG&—‚'öær"•ÒÒ“°§66VæR‚'7F×VFR"Â²7FW3¢¶6&æ—fÅÆ’‚'7F×VFR"ÂãR’ÂG&—‚'7F×VFR"•ÒÒ“°§66VæR‚&fÆ"Â²7FW3¢¶6&æ—fÅÆ’‚&fÆ"ÂãR’ÂG&—‚&fÆ"•ÒÒ“°§66VæR‚&'&V¶W""Â²7FW3¢¶6&æ—fÅÆ’‚&'&V¶W""ÂãR’ÂG&—‚&'&V¶W""•ÒÒ“°§66VæR‚&F6‚"Â²7FW3¢¶6&æ—fÅÆ’‚&F6‚"ÂãR’ÂG&—‚&F6‚"•ÒÒ“°§66VæR‚'7F6¶W""Â²7FW3¢¶6&æ—fÅÆ’‚'7F6¶W""ÂãR’ÂG&—‚'7F6¶W""•ÒÒ“°§66VæR‚'ö¶W""Â²VW'“¢&6†&7FW#×÷'FÆæF†öFÂ"Â7FW3¢·²æÖS¢'ö¶W"fÆö÷"æBÆ’"Âv‡“¢'Æ—F‡&÷Vvƒ¢f—6—F÷"vÆ·2F†RfÆö÷"Âf–ÆÇ2F&ÆRÂÆ—2Fò6WGFÆVÖVçBæB7FæG2v—F†÷WBW‡÷6–ær†–FFVâ6&G2"Â'Vã¢7–æ2"Óâ°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ–çG&óÒ'ö¶W"%ÒævÖRÖ–çG&òÖvòr’æ6Æ–6²‚–“°¢6öç7BvÆ¶–ærÒv—BvÆ´¶W—2†"Â'÷'FÆæF†öFÂ"ÂÂ‚Â³ÂãUÒÂãCR“°¢&V6÷&B‚'ö¶W"vÆ¶–æs¢7V7FF÷'2Ö÷fRv—F‚t4Bg&öÒGvò6ÖW&ævÆW2"ÂÆÅvÆ²‡vÆ¶–ær’Â¥4ôâç7G&–æv–g’‡vÆ¶–ær’“°¢6öç7B"Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂÒ$Âç66VæW2çö¶W"æFV'Vrçö¶W"Â6Æ–6²ÒÓâFö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×ö¶W"Ö7F–öãÒ"r²²r%Òr’æ6Æ–6²‚“°¢6öç7B6÷VçBÒç&ööÒçF&ÆW2æÆVæwF‚Â6VG2Òç&ööÒçF&ÆW2æWfW'’‡BÓâBæ6†—'2æÆVæwF‚ÓÓÒ’’ÂFVÆW'2Òç&ööÒçF&ÆW2æWfW'’‡BÓâBævVçBç'G2çF÷'6òæ6†–ÆG&VâæÆVæwF‚ãÒB“°¢ç6VÆV7Bƒ“²6Æ–6²‚&¦ö–â"“²f÷"†ÆWB’Ò²’ÂC²’²²’6Æ–6²‚&&÷G2"“²6Æ–6²‚'7F'B"“°¢6öç7BBÒç6W76–öâçF&ÆW5³ÒÂ&—fFT6&G2ÒBç6æ6†÷B‚’ç6VG2æWfW'’‡2Óâ2æ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’“°¢ÆWBwV&BÒ²v†–ÆR‡BçÆ––ærbbwV&B²²ÂS’²–b‡Bç6æ6†÷B‚&Æö6Â×Æ–W""’æÆVvÂ’6Æ–6²‚&6ÆÂ"“²"æGfæ6RƒãƒÂò3“²Ð¢6öç7BFöæRÒBç6æ6†÷B‚’ÂF÷FÂÒFöæRç6VG2ç&VGV6R‚†âÂ2’Óââ²2ç7F6²Â’Â6†÷vâÒFö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×ö¶W#Ò'7G&VWB%Òr’çFW‡D6öçFVçC°¢6Æ–6²‚'7FæB"“²ç6VÆV7Bƒ’“²6Æ–6²‚&&÷G2"“²6Æ–6²‚'7F'B"“²"æGfæ6RƒÂò3“°¢&WGW&â²6÷VçBÂ6VG2ÂFVÆW'2Â&—fFT6&G2Â†6S¢FöæRç†6RÂF÷FÂÂ6†÷vâÂF&ÆUFVã¢ç6W76–öâçF&ÆW5³•Òç6æ6†÷B‚’æ†æBÂ7FæF–æs¢Fö7VÖVçBæ&öG’æ†4GG&–'WFR‚&FF×ö¶W"×6VFVB"’Ó°¢Ò’‚–“°¢&V6÷&B‚'ö¶W"Æö6ÂÆ“¢FVâ7V—FVBFVÆW'2Â“6†—'2Âæ–æR×Æ–W"6WGFÆVÖVçBÂF&ÆRFVâÆ–&ÆRæB&—fFR6æ6†÷G2"Â"æ6÷VçBÓÓÒbb"ç6VG2bb"æFVÆW'2bb"ç&—fFT6&G2bb"ç†6RÓÓÒ'6†÷vF÷vâ"bb"çF÷FÂÓÓÒ“bb"ç6†÷vâÓÓÒ$†æB6ö×ÆWFR"bb"çF&ÆUFVâÓÓÒbb"ç7FæF–ærÂ¥4ôâç7G&–æv–g’‡"’“°¢–b‡&ö6W72æVçbåô´U%õ4„õE2’°¢v—B"æWfÇVFR†‚‚’Óâ²6öç7BÒ$Âç66VæW2çö¶W"æFV'Vrç–Æ÷C²ç&VÆV6R‡G'VR“²ævõ&W6WB‚&VçG&æ6R"“²õööövæGfæ6Rƒ"“²Ò’‚–“°¢v—B"ç67&VVç6†÷B†¦ö–â‡&ö6W72æVçbåô´U%õ4„õE2Â'ö¶W"ÖfÆö÷"çær"’“°¢Ð§ÒÒÂG&—‚'ö¶W""•ÒÒ“°§66VæR‚'ö¶W""Â²Æ&VÃ¢&6çf3&B"ÂVW'“¢&6çf3&CÓ"Â7FW3¢·²æÖS¢'ö¶W"6çf3&B"Âv‡“¢''VÆS¢F†RfÆö÷"æBF&ÆR6öçG&öÇ2v÷&²öâF†RfÆÆ&6²&VæFW&W""Â'Vã¢7–æ2"Óâ°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ–çG&óÒ'ö¶W"%ÒævÖRÖ–çG&òÖvòr’æ6Æ–6²‚–“°¢6öç7B"Òv—B"æWfÇVFR†‚‚’Óâ²6öç7BÒ$Âç66VæW2çö¶W"æFV'Vrçö¶W#²æ7F–öâ‚&¦ö–â"“²æ7F–öâ‚&&÷G2"“²æ7F–öâ‚'7F'B"“²õööövæGfæ6Rƒ“²&WGW&â²¶–æC¢õööövç&VæFW&W"æ¶–æBÂ†6S¢ç6W76–öâçF&ÆW5³Òç6æ6†÷B‚’ç†6RÂæöFW3¢õööövç7FG2‚’çf—6–&ÆTæöFW2Ó²Ò’‚–“°¢&V6÷&B‚'ö¶W"fÆÆ&6³¢7FöæRF&ÆW2æBÆ–&ÆR†æBöâ6çf2$B"Â"æ¶–æBÓÓÒ&6çf3&B"bb"ç†6RÓÒ'v—F–ær"bb"ææöFW2â#Â¥4ôâç7G&–æv–g’‡"’“°§ÒÕÒÒ“°§66VæR‚'ö¶W""Â²÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚'ö¶W""Â²6&C¢u¶FFÖ–çG&óÒ'ö¶W"%ÒrÂ&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Âu¶FF×ö¶W"Ö7F–öãÒ'V–6²%ÒuÒÒ’Â²æÖS¢'ö¶W"†öæR7F–öç2"Âv‡“¢''VÆS¢6VFVBF÷V6‚Æ–W'26â&VB&—fFR6&G2æB66W72ÆVvÂ7F–öç2v—F†÷WB†÷&—¦öçFÂ÷fW&fÆ÷r"Â'Vã¢7–æ2"Óâ°¢6öç7B"Òv—B"æWfÇVFR†‚‚’Óâ²6öç7BÒ$Âç66VæW2çö¶W"æFV'Vrçö¶W#²Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×ö¶W"Ö7F–öãÒ'V–6²%Òr’æ6Æ–6²‚“²6öç7BæVÂÒFö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×ö¶W#Ò&fö7W2%Òr’Â"ÒæVÂævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²f—G3¢æVÂæ†–FFVâbb"æÆVgBãÒbb"ç&–v‡BÃÒ–ææW%v–GF‚bbæVÂç67&öÆÅv–GF‚ÃÒæVÂæ6Æ–VçEv–GF‚²Â6VG3¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"çö¶W"×6VG2'WGFöâ"’æÆVæwF‚Â6&G3¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"çö¶W"Ö†æBçö¶W"Ö6&B"’æÆVæwF‚Ó²Ò’‚–“°¢&V6÷&B‚'ö¶W"†öæS¢æ–æR6VB6†ö–6W2æBGvò&—fFR6&G2f—BF†RæVÂ"Â"æf—G2bb"ç6VG2ÓÓÒ’bb"æ6&G2ÓÓÒ"Â¥4ôâç7G&–æv–g’‡"’“°¢–b‡&ö6W72æVçbåô´U%õ4„õE2’v—B"ç67&VVç6†÷B†¦ö–â‡&ö6W72æVçbåô´U%õ4„õE2Â'ö¶W"×†öæRçær"’“°§ÒÕÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢'vVöç2"ÂVW'“¢&6†&7FW#×÷'FÆæF†öFÂgvVöãÓ"fÖsÓfÖÖóÓbf¦WG6³Ó"Â7FW3¢¶‡V$²Â‡V$ÖVÆVRÂ‡V$¦WG6µÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢&&—&G2ÖW–R6öÖ&B"ÂVW'“¢'6öÆóÓf6†&7FW#×÷'FÆæF†öFÂgvVöãÓfÖöFS×6†÷VÆFW"f6öÖ&CÓ"Â7FW3¢¶‡V$&—&G4W–RÂ‡V$&—&G4W–TfÆö÷'2Â‡V$&—&G4W–U&ö¦V7F–öâÂ‡V$&—&G4W–UF&vWG2Â‡V$6öÖ&E&WÆ•ÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢&Ö—'&÷""Â7FW3¢¶‡V$§VÖ&÷G&öâÂ‡V$ÖG&—‚Â‡V$Ö—'&÷%ÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢'6–FRæVÂ"ÂVW'“¢'÷3Ó"Â7FW3¢¶‡V%6†VWEW'6—7FVæ6UÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢&6Æö6²æB&Æö6²†V–v‡B"ÂVW'“¢'÷3Óf†÷W#Ó’"Â7FW3¢¶‡V$&Æö6´†V–v‡EÒÒ“°§66VæR‚&‡V""Â²Æ&VÃ¢&6çf3&B"ÂVW'“¢&6çf3&CÓ"Â7FW3¢¶6çf5F÷W%ÒÒ“°§66VæR‚&‡V""Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&‡V""Â²&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"76†VWB×FövvÆR"Â"76†VWBÖ&ææ2%ÒÂ6†VWC¢G'VRÒ•ÒÒ“°§66VæR‚&Æ""Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&Æ""Â²&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚'&6R"Â²VW'“¢'÷3Óg&–ãÓ"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚'&6R"Â²6&C¢u¶FFÖ–çG&óÒ'&6R%ÒrÂÆ“¢'v–æF÷råõööövç&6Rç7F'E&6R‚’"Â&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"67B"Â"6—FVÒÖ'Fâ"Â"7&6RÖv&vRÖ'Fâ"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚&G&÷"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&G&÷"Â²6&C¢u¶FFÖ–çG&óÒ&G&÷%ÒrÂÆ“¢'v–æF÷råõööövæG&÷ç7F'B‚’"Â&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"67B"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚&÷&&—B"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&÷&&—B"Â²6&C¢u¶FFÖ–çG&óÒ&÷&&—B%ÒrÂÆ“¢'v–æF÷råõööövæ÷&&—BæÆVæ6‚‚’"Â&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"67B"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚&Ö–æR"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&Ö–æR"Â²6&C¢"6Ö–æRÖ–çG&ò"Â&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"67B"Â"6Ö–æR×f–WrÖ'Fâ"Â"6Ö–æR×W6RÖ'Fâ"Â"6Ö–æRÖ×WFR"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚'ööÂ"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚'ööÂ"Â²&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚&f7F÷'’"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&f7F÷'’"Â²&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚&&–g&÷7B"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&&–g&÷7B"Â²&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"æÆVfR%ÒÒ•ÒÒ“°§66VæR‚&&6FR"Â²VW'“¢'÷3Ó"Â÷G3¢„ôäUõ4•¤RÂ7FW3¢·†öæR‚&&6FR"Â²&WV—&VC¢²"6¦÷’ÖÖ÷fR"Â"6¦÷’ÖÆöö²"Â"æÆVfR%ÒÒ•ÒÒ“° ¢òòE4"†2æò‡V"VçG&æ6RGW&–ærF†—2ÖW&vRâW†W&6—6RF†RW†—7F–ærv÷&ÆBç–Æ÷@¢òò6öçG&7BW‡Æ–6—FÇ“²æòæWrÆ–W"Öf6–ær&÷WFR—2–çG&öGV6VB'’F†Rf—‡GW&Rà¦6öç7BG6$VçFW"Ò7–æ2†"’Óâ°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ66VæRÒ$Âç66VæW2æG6"ÂVçFW"Ò66VæRæVçFW"ÂæÖRÒ"ç–Æ÷BçÆ–W#òçG&—G2ææÖS°¢66VæRæVçFW"Ò†7G‚’Óâ²66VæRæVçFW"ÒVçFW#²7G‚çv÷&ÆBç–Æ÷BÒæÖRÇÂçVÆÃ²VçFW"†7G‚“²Ó°¢òò¶VWF†R6VÆV7FVB7F÷"6öçG&öÆÆVBVçF–ÂF†RG&ç6—F–öâ÷vç2—BâÆWGF–æp¢òò—G2‡V"’'VâGW&–ærF†RfFR6÷VÆBf—&R÷"&VÆöBæB×WFFRF†P¢òòW'6—7FVçBÖ×Væ—F–öâF†BE4"—2&WV—&VBFòÆVfRVçF÷V6†VBà¢"ævò‚&G6""“²"æGfæ6Rƒãb“°¢Ò’‚–“°§Ó°¦6öç7BG6$&ö6‚Ò7–æ2†"ÂæÖR’Óâ"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂÆæFÖ&²Ò"æG6"æÆæBæÆæFÖ&·5²G´¥4ôâç7G&–æv–g’†æÖR—ÕÒÂÒÆæFÖ&²çö–çB‚“°¢"ç–Æ÷Bææf–vFR‡²–s¢ÆæFÖ&²ææöFRç&÷FF–öâç’Â—F6ƒ¢ã"ÂF—7C¢rÂ÷6—F–öã¢ÂF&vWC¢²ƒ¢ç‚Â“¢ãrÂ£¢ç¢ÒÒ“²"æGfæ6Rƒã“°§Ò’‚–“°¦6öç7BG6$W†—BÒ7–æ2†"Â†öÖRÒ&&–g&÷7B"’Óâ°¢v—B"æWfÇVFR†õööövæG6"ævFRæ7F—fFRƒ“²–b‡G—VöbõövFT6Æö6²ÓÓÒ&çVÖ&W""’²õövFT6Æö6²³Ò#²õööövæG6"ævFRçWFFR‚“²Ö“°¢v—BVçF–ÅvR†"Ât"æG6"ævFRç7FFRÓÓÒ$5D•dR"rÂS“°¢v—B"æWfÇVFR†‚‚’Óâ²6öç7B"Òõöööv²"ç–Æ÷Bææf–vFR‡²÷6—F–öã¢²ƒ¢Â“¢Â£¢#rã’ÒÂ–s¢ÖF‚å’Â—F6ƒ¢ã2ÂF—7C¢BÒ“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²f÷"†ÆWB’Ò²’Â#bb"çG&ç6—F–öæ–æs²’²²’$Âç66VæW2æG6"çWFFRƒãRÂB²’¢ãR“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“²Ò’‚–“°¢v—BVçF–ÅvR†"Â"ç66VæRÓÓÒ"G¶†öÖWÒ"bb"çG&ç6—F–öæ–ævÂS“°§Ó°¢òòÆ6VÖVçB6öçG&7BW†W&6—6W2F†RÖ÷fVBÆæFÖ&·2v—F†÷WB6†æv–ærG&fVÂf—‡GW&W2à¦f÷"†6öç7BÖö&–ÆRöb¶fÇ6RÂG'VUÒ’66VæR‚&G6""Â²Æ&VÃ¢$ööv÷'FÂG6"Æ¦"²†Öö&–ÆRò&6çf3&B"¢'vV&vÃ""’ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""²†Öö&–ÆRò"f6çf3&CÓ"¢""’’Â÷G3¢Öö&–ÆRò²ââå„ôäUõ4•¤RÂÖ÷F–öã¢fÇ6RÒ¢²Ö÷F–öã¢G'VRÒÂ7FW3¢·²æÖS¢$ööv÷'FÂG6"Æ¦"²†Öö&–ÆRò&6çf3&B"¢'vV&vÃ""’Âv‡“¢'&Vw&W76–öã¢Ö÷fVB6†÷æBEb¶VW6öÆÆ—6–öâÂ–çFW&7F–öç2Â&F–òæB6Bæf–vF–öâGF6†VBFòF†V—"g&öçG2"Â'Vã¢7–æ2"Óâ°¢6öç7B6†V6²Ò†æÖRÂö²ÂFWF–ÂÒ""’Óâ&V6÷&B‚$E4"Æ¦"²†Öö&–ÆRò&6çf3&C¢"¢'vV&vÃ#¢"’²æÖRÂö²ÂFWF–Â“°¢6öç7B&W72Ò7–æ26VÆV7F÷"Óâ°¢6öç7BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BRÒFö7VÖVçBçVW'•6VÆV7F÷"‚G´¥4ôâç7G&–æv–g’‡6VÆV7F÷"—Ò“²Rç67&öÆÄ–çFõf–Wr‡²&Æö6³¢&æV&W7B"Ò“²6öç7B"ÒRævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"Ó²Ò’‚–“°¢–b†Öö&–ÆR’²v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6…7F'B"ÂF÷V6…ö–çG3¢·ÒÒ“²v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„VæB"ÂF÷V6…ö–çG3¢µÒÒ“²Ð¢VÇ6Rv—B"æ6Æ–6²‡ç‚Âç’“°¢Ó°¢6†V6²‚&ÆæFÖ&²vVöÖWG'’æB6W'f–6W2'6VçBGW&–ærG&ç6—B"Âv—B"æWfÇVFR†õööövæG6"æÆæBbbõööövæG6"ç&W6÷W&6W2ç6†÷bbõööövæG6"ç&W6÷W&6W2çGbbbõövFTF÷&Öæ7’æÆæBÓÓÒbbõövFTF÷&Öæ7’çGbÓÓÒbbõövFTF÷&Öæ7’ç&F–òÓÓÒbbõövFTF÷&Öæ7’æfWF6‚ÓÓÒ’“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²$Âç66VæW2æG6"çWFFR…õööövæVF–òæGW&F–öâ²Â“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“²Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ&G6"×6¶—%Òr’æ6Æ–6²‚“¶“°¢6öç7BÆ6VÖVçBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BBÒõööövæG6"ÂÒBæÆæBæÆæFÖ&·2Â6VçG&RÒ²ƒ¢Â£¢‚Ó²&WGW&â²6†÷¢ç6†÷ææöFRç÷6—F–öâÂGc¢çGbææöFRç÷6—F–öâÂ6†÷–s¢ç6†÷ææöFRç&÷FF–öâç’ÂGe–s¢çGbææöFRç&÷FF–öâç’ÂvFS¢BævFRç&ö÷Bç÷6—F–öâÂF–ÆW#¢BævFRæF–ÆW"ç÷6—F–öâÂÆæC¢õövFTF÷&Öæ7’æÆæBÂGd6÷VçC¢õövFTF÷&Öæ7’çGbÂ–çv&C¢ö&¦V7BçfÇVW2†’æWfW'’†ÂÓâ²6öç7BÒÂçö–çB‚“²&WGW&âÖF‚æ‡—÷B‡ç‚Ö6VçG&Rç‚Çç¢Ö6VçG&Rç¢’ÂÖF‚æ‡—÷B†ÂææöFRç÷6—F–öâç‚Ö6VçG&Rç‚ÆÂææöFRç÷6—F–öâç¢Ö6VçG&Rç¢“²Ò’Ó²Ò’‚–“°¢6†V6²‚&÷÷6—FR–çv&Bg&öçG2&W6W'fRvFRæBF–ÆW"G&ç6f÷&×2"ÂÆ6VÖVçBç6†÷ç‚ÓÓÒÓBbbÆ6VÖVçBçGbç‚ÓÓÒBbbÆ6VÖVçBç6†÷ç¢ÓÓÒ‚bbÆ6VÖVçBçGbç¢ÓÓÒ‚bbÆ6VÖVçBç6†÷–rÓÓÒÖF‚å’ò"bbÆ6VÖVçBçGe–rÓÓÒÔÖF‚å’ò"bbÆ6VÖVçBæ–çv&BbbÆ6VÖVçBævFRç‚ÓÓÒbbÆ6VÖVçBævFRç’ÓÓÒ"bbÆ6VÖVçBævFRç¢ÓÓÒ#‚bbÆ6VÖVçBæF–ÆW"ç‚ÓÓÒ2ãrbbÆ6VÖVçBæF–ÆW"ç¢ÓÓÒ#rbbÆ6VÖVçBæÆæBÓÓÒbbÆ6VÖVçBçGd6÷VçBÓÓÒÂ¥4ôâç7G&–æv–g’‡Æ6VÖVçB’“°¢6öç7BÆæW2Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂBÒ"æG6"Â2Ò$Âç66VæRÂæö÷Ò‚’Óâ·ÒÂ7&WrÒ$Âæ7&Wræ7&VFR‡²&ö÷C¢2æ7&VFTæöFR‚’Âv÷&ÆC¢²ÆWfVÃ¢ÒÂ–çWC¢²FC¢æö÷Â&VÖ÷fS¢æö÷ÒÂ‡VC¢²6WE&÷7FW%&÷s¢æö÷ÒÂvÖS¢²7FFS¢²76–væÖVçG3¢·ÒÂ–çfVçF÷'“¢µÒÒÒÂ–ÆS¢²fö÷G&–çDVFvS¢Â–ÆTVFvS¢‚’ÓâÒÂf–Wu–s¢Â'V–ÆE7÷G3¢µÒÂvÆ´–ã¢²ƒ¢Â£¢2ÒÂw&÷VæDC¢‚’ÓâÂvÆ¶&ÆS¢‚’ÓâG'VRÂ&VG&öÆÇ3¢$Âæ6öçG&–'WF÷'2ç&÷7FW"æÖ‚…òÂ’’Óâ‡²ƒ¢3¶’£"Â“¢Â£¢3Â†–FFVã¢G'VRÒ’’Âgƒ¢²6“¢æö÷Â§§¤C¢æö÷Â'W'7C¢æö÷ÂVfc¢æö÷Â7vå'F–6ÆS¢æö÷ÂFÖvTçVÖ&W#¢æö÷ÒÒ“°¢6öç7B&÷WFW2Òµµ³ÃuÒÅ³Ã#eÕÒÅµ³Ã#•ÒÅ³Ã#eÕÒÅµ³Ã#eÒÅ³Ã35ÕÒÅµ³Ã#eÒÅ³2ãrÃ#RãeÕÒÅµ³Ã#ÒÅ³rÃ#EÕÒÅµ³Ã…ÒÅ²ÓãRÃ…ÕÒÅµ³Ã…ÒÅ³ãRÃ…ÕÕÒÂ&÷w2ÒµÓ°¢f÷"†6öç7B7F÷"öb7&Wræ6fVÖVâçfÇVW2‚’’²ÆWB6ÆV"ÒG'VS²f÷"†6öç7B¶Æ5Òöb&÷WFW2’f÷"†ÆWB“Ó¶“ÃÓ#ƒ¶’²²’6ÆV"bcÒBæ6ÆV$B†³Ò²†5³ÒÖ³Ò’¦’ó#‚Æ³Ò²†5³ÒÖ³Ò’¦’ó#‚Æ7F÷"æ&öG•&F—W2“²&÷w2çW6‚‡²æÖS¢7F÷"çG&—G2ææÖRÂ6ÆV"Ò“²Ð¢7&WræF—7÷6R‚“²&WGW&â&÷w3°¢Ò’‚–“°¢6†V6²‚&ÆÂ6†&7FW'2&WF–âÆ¦Â'&—fÂÂ&WGW&âÂF–ÆW"æB&–FRÆæW2"ÂÆæW2æÆVæwF‚ÓÓÒ45BbbÆæW2æWfW'’‡"Óâ"æ6ÆV"’Â¥4ôâç7G&–æv–g’†ÆæW2’“°¢6öç7BöÆBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂBÒ"æG6"Â÷WBÒµÓ²f÷"†6öç7B‚öb²Ó#ÂÓÒ’²"ç–Æ÷Bææf–vFR‡²÷6—F–öã¢²‚Ç“£Ç££2ÒÂF&vWC¢²‚Ç“£ãrÇ££2ÒÂ–s£Ç—F6ƒ£ã2ÆF—7C£RÒ“²$Âç66VæW2æG6"çWFFRƒÃ"“²6öç7BFö¶Vç3ÖBæ–çfVçF÷'’çFö¶Vç3²Bæ'W’‚&'&VB"“²Bæ÷VåGb‚“²÷WBçW6‚†Bæ6ÆV$B‡‚Ã2ÆBæfF"æ&öG•&F—W2’bbBæ–çfVçF÷'’çFö¶Vç3ÓÓ×Fö¶Vç2bbBçGbæ—4÷Vâbb²%f—6—BÖVÖR6†÷"Â%W6REb%Òæ–æ6ÇVFW2†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’çFW‡D6öçFVçB’“²Ò&WGW&â÷WC²Ò’‚–“°¢6†V6²‚&öÆB÷6—F–öç2†fRæò6öÆÆ—6–öâ÷"6†÷õEb–çFW&7F–öâ"ÂöÆBæWfW'’„&ööÆVâ’Â¥4ôâç7G&–æv–g’†öÆB’“°¢f÷"†6öç7BæÖRöb²'6†÷"Â'Gb%Ò’°¢v—BG6$&ö6‚†"ÂæÖR“°¢6†V6²†æÖR²"&ö×BföÆÆ÷w2G&ç6f÷&ÖVBg&öçB"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’çFW‡D6öçFVçBÓÓÒG´¥4ôâç7G&–æv–g’†æÖRÓÓÒ'6†÷"ò%f—6—BÖVÖR6†÷"¢%W6REb"—Ö’“°¢v—B&W72‚"6G6"Ö6öçFW‡B"“°¢–b†æÖRÓÓÒ'6†÷"’²v—B&W72‚u¶FFÖ7F–öãÒ&G6"Ö'&VB%Òr“²6†V6²‚%6†÷W&6†6W27F–ÆÂv÷&²"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×6†÷"’æ†–FFVâbbõööövæG6"æ–çfVçF÷'’æ'&VBÓÓÒbbõööövæG6"æ–çfVçF÷'’çFö¶Vç2ÓÓÒv’“²v—B&W72‚u¶FFÖ7F–öãÒ&G6"Ö6Æ÷6R×6†÷%Òr“²Ð¢VÇ6R²6†V6²‚%Eb÷Vç2F‡&÷Vv‚æF—fR–çFW&7F–öâ"Âv—B"æWfÇVFR†õööövæG6"çGbæ—4÷Væ’“²v—B&W72‚"6G6"×GbÖ6Æ÷6R"“²Ð¢Ð¢6öç7BVF–òÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B#ÕõööövÂCÔ"æG6"Â6÷W&6SÖBæÆæBæÆæFÖ&·2çGbçö–çB‚ÓãSRÃ2ã2Ããc2’Â&öCÖBæÆæBæ&öG5³Òç÷6—F–öã²"æVF–òæVçf—&öæÖVçB‡²ââä"æ6ÖW&Ç÷6—F–öã§6÷W&6WÒÆ&öBÃRÇ6÷W&6R“²6öç7BæV#Ô"æVF–òç&F–õföÇVÖS²"æVF–òæVçf—&öæÖVçB‡²ââä"æ6ÖW&Ç÷6—F–öã§·ƒ¢ÓÇ“£2ã2Ç££Bãg×ÒÆ&öBÃRÇ6÷W&6R“²6öç7BöÆCÔ"æVF–òç&F–õföÇVÖS²$Âç66VæRçWFFUv÷&ÆB†BæÆæBç&ö÷B“²6öç7BsÖBæÆæBçGe67&VVâçv÷&ÆC²&WGW&â²æV"ÆöÆBÇ6÷W&6RÆÖF6†W3¤ÖF‚æ‡—÷B‡6÷W&6Rç‚×u³%ÒÇ6÷W&6Rç’×u³5ÒÇ6÷W&6Rç¢×u³EÒ“ÃRÓRÓ²Ò’‚–“°¢6†V6²‚'&F–ò6÷W&6RföÆÆ÷w2&VæFW&VBEb67&VVâÂæ÷BöÆB÷6—F–öâ"ÂVF–òæÖF6†W2bbVF–òææV"âVF–òæöÆB¢"Â¥4ôâç7G&–æv–g’†VF–ò’“°¢6öç7B6BÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7BCÕõööövæG6"Âæö÷Ò‚“Óç·ÒÂ£Ô$ÂæG6$vVçBæ7&VFR‡·&VçC¤$Âç66VæRæ7&VFTæöFR‚’Æ–çWC§¶FC¦æö÷Ç&VÖ÷fS¦æö÷ÒÆ6ÆV$C¦Bæ6ÆV$BÆÆæFÖ&·3¦BæÆæBæÆæFÖ&·2Æ'&–ã§¶ö'6W'fS¦æö÷ÆF—7÷6S¦æö÷Ç&WÇ“¢‚“Óâ"'×Ò’Â6Vç6S×¶æÖS¢%–VÆÆ÷t'&ö¶T—B"Çƒ£Ç“£Ç££rÆfööC£Æ7F—fS§G'VWÒÂ&÷w3ÕµÓ²ÆWBF–ÖSÓ°¢f÷"†6öç7B–Böb²'6æ6µ÷vF6‚"Â'6†÷öÆæR"Â'vW7EöÆæR"Â'vW7B"Â'W&6‚"Â&V7B"Â&'&—fÂ%Ò’°¢¢çWFFRƒÇF–ÖRÇ6Vç6R“¶6öç7B3×¢ç6æ6†÷B‚’Â66WFVC×¢ç&WVW7B‡·f—6—C§2çf—6—BÆ–C§2ææW‡E&WVW7D–BÆC§F–ÖRÇG—S¢'vÆµ÷Fò"ÆFW7F–æF–öã¦–GÒ“²ÆWB6ÆV#×G'VS°¢f÷"†ÆWB“Ó¶“Ã#bb¢ç6æ6†÷B‚’ç6VÆbæ–çFVçBÓÓÒ'vÆ²#¶’²²—·F–ÖR³ÓãS·¢çWFFRƒãRÇF–ÖRÇ6Vç6R“¶6ÆV"bcÒBæ6ÆV$B‡¢ç&ö÷Bç÷6—F–öâç‚Ç¢ç&ö÷Bç÷6—F–öâç¢ÃãC"“·Ð¢&÷w2çW6‚‡¶–BÆ66WFVBÆ6ÆV"ÆFöæS§¢ç6æ6†÷B‚’ç6VÆbæ–çFVçBÓÒ'vÆ²"Çƒ§¢ç&ö÷Bç÷6—F–öâç‚Ç£§¢ç&ö÷Bç÷6—F–öâç§Ò“°¢×¢æF—7÷6R‚“·&WGW&â&÷w3°¢Ò’‚–“°¢6†V6²‚%§W§R&÷WFW2&÷VæB&÷F‚Ö÷fVB7G'V7GW&W2FòÆæFÖ&²ÖFW&—fVBFW7F–æF–öç2"Â6BæWfW'’‡#Óç"æ66WFVCÓÓÒ&66WFVB"bb"æ6ÆV"bb"æFöæR’Â¥4ôâç7G&–æv–g’†6B’“°§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"§W§R6öçfW'6F–öâ"ÂW&Ã¢‡V%vR†F—7B’Â7FW3¢·²æÖS¢&G6"§W§R6öçfW'6F–öâ"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢&V6÷&B‚&G6"6ö×F–&–Æ—G“¢'V–ÇB55&W6W'fW2W†7FÇ’F†RvVF†W"æBE4"æWGv÷&²W&Ö—76–öç2"Âv—B"æWfÇVFR†‚‚’Óâ°¢6öç7BöÆ–7’ÒFö7VÖVçBçVW'•6VÆV7F÷"‚vÖWF¶‡GGÖWV—cÒ$6öçFVçBÕ6V7W&—G’ÕöÆ–7’%Òr’æ6öçFVçC°¢6öç7B6÷W&6W2ÒæÖRÓâöÆ–7’ç7Æ—B‚#²"’æÖ‡2Óâ2çG&–Ò‚’ç7Æ—B‚õÅÇ2²ò’’æf–æB‡2Óâ5³ÒÓÓÒæÖR’ç6Æ–6Rƒ’ç6÷'B‚’æ¦ö–â‚'Â"“°¢&WGW&â6÷W&6W2‚&6öææV7B×7&2"’ÓÓÒ²"w6VÆbr"Â&‡GG3¢"Â'w73¢%Òç6÷'B‚’æ¦ö–â‚'Â"’bb6÷W&6W2‚'v÷&¶W"×7&2"’ÓÓÒ"w6VÆbr"bb6÷W&6W2‚&ÖVF–×7&2"’ÓÓÒ&‡GG3¢ò÷7G&VÒææöFW'VææW'7&F–òæ6öÒ"bböÆ–7’æ–æ6ÇVFW2‚'Vç6fRÒ"“°¢Ò’‚–’“°¢&V6÷&B‚&G6"&Vv—7G'“¢37F—26VÆVBæBE4"—2–çFW&æÆÇ’FG&W76&ÆRv—F†÷WB6fR"Âv—B"æWfÇVFR†„$Âæ6fW2ç6Æ÷G2æf–æB‡2Óâ2æ–BÓÓÒ&3"’ç7FGW2ÓÓÒ&F&²"bb$Âæ6fW2ç6Æ÷G2æf–æB‡2Óâ2æ–BÓÓÒ&3"’ç66VæRÓÓÒçVÆÂ’bb$Âæ6fW2ç6Æ÷G2ç6öÖR‡2Óâ2ç66VæRÓÓÒ&G6""’bb$Âç66VæW2æG6&’“°¢&V6÷&B‚&G6"6ö×F–&–Æ—G“¢‡V"¶VW2F†RvVçBÖöGVÆRv—F†÷WB7væ–ær7FæFÆöæRv÷&–ÆÆ"Âv—B"æWfÇVFR†õööövç66VæRÓÓÒ&‡V""bbõööövævVçBbb$ÂævVçBbb$Âæ6†&7FW'2ævWB‚''VÆW2×v—F†÷WB×'VÆW'2"’bbö&¦V7Bæ†4÷vâ…õööövÂ&vVçB"’bbö&¦V7Bæ†4÷vâ…õööövÂ&G6""’bbõööövæG6&’“°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ6fRÒ"æ6fVÖVâævWB‚''VÆW2×v—F†÷WB×'VÆW'2"“°¢6fRæ÷fW'&–FRÒ'v÷&¶–ær#²"æ7&Wrç&Vg&W6…7FFW2‡G'VR“²"ç–Æ÷Bç÷76W72†6fR“°¢"æ7&Wrç6VÆV7EvVöâƒ"“²v–æF÷råõöG6%&Wf–÷W5&ö÷BÒ6fRç&ö÷C° ¢Ò’‚–“°¢&V6÷&B‚&G6"6ö×F–&–Æ—G“¢6†&VBÆ–W"æBWV—ÖVçB–æ—F–Æ—¦R"Âv—B"æWfÇVFR†õööövç–Æ÷BçÆ–W"ÓÓÒõööövæ7&WrçÆ–W"bbõööövç–Æ÷BçÆ–W"çG&—G2ææÖRÓÓÒ''VÆW2×v—F†÷WB×'VÆW'2"bbõööövç–Æ÷BçÆ–W"çvVöæ’“°¢v—BG6$VçFW"†"“°¢6öç7BVçFW&VBÒv—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÂS“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Â6öFS¢$¶W•r"Ò“°¢–b‚VçFW&VB’F‡&÷rW'&÷"‚$E4"66VæR†æFöfbF–Bæ÷B6ö×ÆWFR"“°¢&V6÷&B‚&G6"6ö×F–&–Æ—G“¢66VæR†æFöfb&V'V–ÆG26VÆV7FVB6æöæ–6Âöövv—F†÷WB7F'F–ær§W§R"Âv—B"æWfÇVFR†‚‚’Óâ²6öç7BÒõööövæG6"æfF"ÂÖöFVÂÒ$ÂæÖöFVÇ2æ6fVÖâ„$Âæ6öçG&–'WF÷'2çG&—G4f÷"‚''VÆW2×v—F†÷WB×'VÆW'2"’“²&WGW&âçG&—G2ææÖRÓÓÒ''VÆW2×v—F†÷WB×'VÆW'2"bbç&ö÷BÓÒõöG6%&Wf–÷W5&ö÷Bbbæ†VD÷VâÓÓÒÖöFVÂæ†VD÷VâbbõööövæG6"ç§W§Rbbö&¦V7Bæ†4÷vâ…õööövÂ&vVçB"’bbö&¦V7Bæ†4÷vâ…õööövÂ&G6""“²Ò’‚–’“°¢6öç7B²7&VFT†æFÆW"ÒÒv—B–×÷'B‚"ââ÷6W'fW"÷§W§Rö†æFÆW"æÖ§2"“°¢6öç7B²5•5DTÕõ$ôÕBÒÒv—B–×÷'B‚"ââ÷6W'fW"÷§W§R÷W'6öæÆ—G’æÖ§2"“°¢6öç7B&WVW7D&öG’Ò²fW'6–öã¢ÂvVçC¢'§W§R"ÂÖW76vS¢$†VÆÆò"Â†—7F÷'“¢µÒÂ6W76–öã¢²Æ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"ÂÆö6F–öã¢&'&—fÂ"ÂÖööC¢&6öçFVçB"ÂfööD6÷VçC¢Â&V6VçDWfVçG3¢µÒÒÓ°¢6öç7B÷&–v–âÒ&‡GG3¢òövÖRæW†×ÆR"Â÷F–öç2Ò²ÆÆ÷vVD÷&–v–ç3¢¶÷&–v–åÒÂW$6Æ–VçEW$Ö–çWFS¢ÂF÷FÅW$Ö–çWFS¢#Ó°¢6öç7B&WVW7BÒ†&öG’Ò&WVW7D&öG’Â†VFW'2Ò·Ò’ÓâæWr&WVW7B†÷&–v–â²"ö’÷§W§Rö6†B"Â²ÖWF†öC¢%õ5B"Â†VFW'3¢²÷&–v–ã¢÷&–v–âÂ$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"Âââæ†VFW'2ÒÂ&öG“¢G—Vöb&öG’ÓÓÒ'7G&–ær"ò&öG’¢¥4ôâç7G&–æv–g’†&öG’’Ò“°¢6öç7B†æFÆW"Ò7&VFT†æFÆW"†÷F–öç2’ÂÖö6µ&WÇ’Òv—B†æFÆW"‡&WVW7B‚’“°¢&V6÷&B‚&G6"6†B6W'fW#¢Æö6Â&÷f–FW"—2†öæW7BæB÷&–v–â&W7G&–7FVB"ÂÖö6µ&WÇ’ç7FGW2ÓÓÒ#bb†v—BÖö6µ&WÇ’æ§6öâ‚’’çFW‡Bæ–æ6ÇVFW2‚&æ÷B’"’bbÖö6µ&WÇ’æ†VFW'2ævWB‚$66W72Ô6öçG&öÂÔÆÆ÷rÔ÷&–v–â"’ÓÓÒ÷&–v–âbb†v—B†æFÆW"‡&WVW7B‡&WVW7D&öG’Â²÷&–v–ã¢&‡GG3¢òö÷F†W"æW†×ÆR"Ò’’’ç7FGW2ÓÓÒC2“°¢6öç7B–çfÆ–BÒ·²ââç&WVW7D&öG’Â7—7FVÕ&ö×C¢&÷fW'&–FR"ÒÂ²ââç&WVW7D&öG’ÂfW'6–öã¢"ÒÂ²ââç&WVW7D&öG’Â†—7F÷'“¢·²&öÆS¢'7—7FVÒ"ÂFW‡C¢&÷fW'&–FR"ÕÒÒÂ²ââç&WVW7D&öG’Â6W76–öã¢²ââç&WVW7D&öG’ç6W76–öâÂ&V6VçDWfVçG3¢·²6W¢ÂF–ÖS¢ÂG—S¢&W†V7WFR"ÂVçF—G“¢'Æ–W""ÂfÇVS¢ÕÒÒÒÂ²ââç&WVW7D&öG’ÂÖW76vS¢'‚"ç&WVBƒ’ÕÓ°¢6öç7B7FGW6W2ÒµÓ°¢f÷"†6öç7B&öG’öb–çfÆ–B’7FGW6W2çW6‚‚†v—B†æFÆW"‡&WVW7B†&öG’’’’ç7FGW2“°¢&V6÷&B‚&G6"6†B6W'fW#¢66†VÖ2Â7G&VÖ–ær6—¦RæBÖVF–G—RVæf÷&6VB"Â7FGW6W2æWfW'’‡2Óâ2ÓÓÒC’bb†v—B†æFÆW"‡&WVW7B‚'‚"ç&WVBƒC“S2’’’’ç7FGW2ÓÓÒC2bb†v—B†æFÆW"‡&WVW7B‡&WVW7D&öG’Â²$6öçFVçBÕG—R#¢'FW‡B÷Æ–â"Ò’’’ç7FGW2ÓÓÒCR“°¢ÆWB&÷VæF'’ÒfÇ6S°¢6öç7BFFW"Ò7&VFT†æFÆW"‡²ââæ÷F–öç2Â&÷f–FW#¢²7–æ2vVæW&FR†–çWB’²&÷VæF'’Ò–çWBç7—7FVÕ&ö×BÓÓÒ5•5DTÕõ$ôÕBbbö&¦V7Bæ—4g&÷¦Vâ†–çWBç6W76–öâ’bb–çWBç6–væÂ–ç7Fæ6Vöb&÷'E6–væÂbb–çWBæÖ„÷WGWD6†'2ÓÓÒ²&WGW&â%Æ–â&WÇ’#²ÒÒÒ“°¢&V6÷&B‚&G6"6†B6W'fW#¢&÷f–FW"ÖæWWG&Â&÷VæF'’æB&ö×BW†6ÇVFVBg&öÒ'V–ÆB"Â†v—BFFW"‡&WVW7B‚’’’ç7FGW2ÓÓÒ#bb&÷VæF'’bb&VDf–ÆU7–æ2†æWrU$Â†F—7B’Â'WFc‚"’æ–æ6ÇVFW2…5•5DTÕõ$ôÕB’“°¢6öç7B&D÷WGWG2Ò²#Æ#ä…DÔÃÂö#â"Â'‚"ç&WVBƒ’Â²FW‡C¢'w&öær6†R"ÕÓ°¢6öç7B÷WGWE7FGW6W2ÒµÓ°¢f÷"†6öç7B÷WGWBöb&D÷WGWG2’÷WGWE7FGW6W2çW6‚‚†v—B7&VFT†æFÆW"‡²ââæ÷F–öç2Â&÷f–FW#¢²7–æ2vVæW&FR‚’²&WGW&â÷WGWC²ÒÒÒ’‡&WVW7B‚’’’ç7FGW2“°¢6öç7BW'&÷%&WÇ’Òv—B7&VFT†æFÆW"‡²ââæ÷F–öç2Â&÷f–FW#¢²7–æ2vVæW&FR‚’²F‡&÷rW'&÷"‚%$•dDUõ$õd”DU%ôU%$õ""“²ÒÒÒ’‡&WVW7B‚’“°¢&V6÷&B‚&G6"6†B6W'fW#¢–çfÆ–B÷WGWBæB&÷f–FW"W'&÷'2æWfW"ÆV²"Â÷WGWE7FGW6W2æWfW'’‡2Óâ2ÓÓÒS"’bbW'&÷%&WÇ’ç7FGW2ÓÓÒS"bb†v—BW'&÷%&WÇ’çFW‡B‚’’æ–æ6ÇVFW2‚%$•dDUõ$õd”DU%ôU%$õ""’“°¢6öç7BÆ–Ö—FVBÒ7&VFT†æFÆW"‡²ââæ÷F–öç2ÂW$6Æ–VçEW$Ö–çWFS¢Ò“°¢v—BÆ–Ö—FVB‡&WVW7B‚’“°¢ÆWBf–æ—6ƒ°¢6öç7BFVÆ–VBÒ7&VFT†æFÆW"‡²ââæ÷F–öç2ÂF–ÖV÷WD×3¢SÂÖ„6öæ7W'&VçC¢Â&÷f–FW#¢²vVæW&FR‚’²&WGW&âæWr&öÖ—6R‡&W6öÇfRÓâ²f–æ—6‚Ò&W6öÇfS²Ò“²ÒÒÒ“°¢6öç7BF–ÖVBÒv—BFVÆ–VB‡&WVW7B‚’’Âö67W–VBÒv—BFVÆ–VB‡&WVW7B‚’“°¢f–æ—6‚‚$ÆFR&WÇ’"“°¢&V6÷&B‚&G6"6†B6W'fW#¢&FRÂF–ÖV÷WBæB6öæ7W'&Væ7’Æ–Ö—G2"Â†v—BÆ–Ö—FVB‡&WVW7B‚’’’ç7FGW2ÓÓÒC#’bbF–ÖVBç7FGW2ÓÓÒSBbbö67W–VBç7FGW2ÓÓÒS2“°¢6öç7BG&ç7÷'BÒv—B"æWfÇVFR††7–æ2‚’Óâ°¢6öç7B6fVBÒv–æF÷ræfWF6‚Â"Ò$ÂæG6$vVçE&VÖ÷FRÂ6öçFW‡BÒG´¥4ôâç7G&–æv–g’‡&WVW7D&öG’ç6W76–öâ—Ó²ÆWBf—†VBÒfÇ6S°¢G'’°¢v–æF÷ræfWF6‚Ò7–æ2‡W&ÂÂ÷F–öç2’Óâ²f—†VBÒW&ÂÓÓÒ"ö’÷§W§Rö6†B"bb÷F–öç2æÖWF†öBÓÓÒ%õ5B"bb÷F–öç2æ7&VFVçF–Ç2ÓÓÒ&öÖ—B"bb÷F–öç2ç&VF—&V7BÓÓÒ&W'&÷""bb÷F–öç2ç6–væÂ–ç7Fæ6Vöb&÷'E6–væÃ²&WGW&âæWr&W7öç6R„¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢%G&ç7÷'Bf—‡GW&R"Ò’Â²†VFW'3¢²$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"ÒÒ“²Ó°¢6öç7B&WÇ’Òv—B"æ7&VFR‡²ÖöFS¢'&VÖ÷FR"Ò’ç6VæB‚$†VÆÆò"Â6öçFW‡BÂµÒÂæWr&÷'D6öçG&öÆÆW"‚’ç6–væÂ“°¢ÆWB&V¦V7FVBÒ°¢f÷"†6öç7BÖöFRöb²'7FGW2"Â'G—R"Â'6—¦R%Ò’°¢v–æF÷ræfWF6‚Ò7–æ2‚’ÓâæWr&W7öç6R†ÖöFRÓÓÒ'6—¦R"ò'‚"ç&WVBƒƒ“2’¢'·Ò"Â²7FGW3¢ÖöFRÓÓÒ'7FGW2"òS2¢#Â†VFW'3¢²$6öçFVçBÕG—R#¢ÖöFRÓÓÒ'G—R"ò'FW‡Bö‡FÖÂ"¢&Æ–6F–öâö§6öâ"ÒÒ“°¢G'’²v—B"æ7&VFR‡²ÖöFS¢'&VÖ÷FR"Ò’ç6VæB‚$†VÆÆò"Â6öçFW‡BÂµÒÂæWr&÷'D6öçG&öÆÆW"‚’ç6–væÂ“²Ò6F6‚²&V¦V7FVB²³²Ð¢Ð¢&WGW&âf—†VBbb&WÇ’çFW‡BÓÓÒ%G&ç7÷'Bf—‡GW&R"bb&V¦V7FVBÓÓÒ2bb"æ7&VFR‚’æÖöFRÓÓÒ&Öö6²#°¢Òf–æÆÇ’²v–æF÷ræfWF6‚Ò6fVC²Ð¢Ò’‚–“°¢&V6÷&B‚&G6"6†C¢f—†VB…EEG&ç7÷'B&V¦V7G2Vç6fR&W7öç6W2æBFVfVÇG2FòÖö6²"ÂG&ç7÷'B“°¢6öç7B6WGFÆRÒ7–æ2‚’Óâ°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²õööövæGfæ6R…õööövæVF–òæGW&F–öâ²Âã“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“²õööövç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ã"ÂF—7C¢rÂF&vWC¢²ƒ¢ÓBÂ“¢ãrÂ£¢#bÒÂ÷6—F–öã¢²ƒ¢ÓBÂ“¢Â£¢#bÒÒ“²õööövæGfæ6Rƒã"“¶“°¢Ó°¢6öç7B6Æ–6²Ò7–æ26VÆV7F÷"Óâ²6öç7BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒFö7VÖVçBçVW'•6VÆV7F÷"‚G´¥4ôâç7G&–æv–g’‡6VÆV7F÷"—Ò’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"Ó²Ò’‚–“²v—B"æ6Æ–6²‡ç‚Âç’“²Ó°¢6öç7B6VæBÒ7–æ2ÖW76vRÓâ²v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’çfÇVRÒG´¥4ôâç7G&–æv–g’†ÖW76vR—Ó²Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖf÷&Ò"’ç&WVW7E7V&Ö—B‚“¶“²–b‚v—BVçF–ÅvR†"Â""æG6"æ6öçfW'6F–öâæ'W7’"Â3’’F‡&÷rW'&÷"‚$6öçfW'6F–öâF–Bæ÷B6WGFÆR"“²Ó°¢v—B6WGFÆR‚“²v—B"æ¶W’‚#""“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'r"Ò“°¢v—B6Æ–6²‚"6G6"Ö6öçFW‡B"“°¢&V6÷&B‚&G6"6†C¢æV&'’FÆ²÷Vç2fö7W6VBÂ†öæW7FÇ’Æ&VÆÆVBÖö6²æVÂ"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖ6öçfW'6F–öâ"’æ÷VâbbFö7VÖVçBæ7F—fTVÆVÖVçBæ–BÓÓÒ'§W§RÖÖW76vR"bbFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖöFR"’çFW‡D6öçFVçBæ–æ6ÇVFW2‚&æò’6öææV7FVB"’bbõööövæ6öçG&öÇ2ç&VB‚’ç’ÓÓÒ’“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Ò“°¢6öç7B&Vf÷&RÒv—B"æWfÇVFR†‡²ƒ¢õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç‚Â£¢õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢Â6†÷G3¢õööövæG6"æfF"çvVöâç6†÷G4f—&VBÒ–“°¢v—B"æ¶W’‚'r"“²v—B"æ¶W’‚'b"“²v—B"æ¶W’‚'B"“°¢v—B"ç6VæB‚$–çWBæ–ç6W'EFW‡B"Â²FW‡C¢"v‡’—2F†RÖööâ&÷VæCòé¬ëë¼ë|ëÌêÜøë	ù‚"Ò“°¢6öç7BG—–ærÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"Òõöööv²"æGfæ6RƒãR“²&WGW&â²ƒ¢"æG6"æfF"ç&ö÷Bç÷6—F–öâç‚Â£¢"æG6"æfF"ç&ö÷Bç÷6—F–öâç¢Â6†÷G3¢"æG6"æfF"çvVöâç6†÷G4f—&VBÂFW‡C¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’çfÇVRÂG&–vvW#¢"æG6"æfF"çvVöâçG&–vvW$†VÆBÓ²Ò’‚–“°¢&V6÷&B‚&G6"6†C¢FW6·F÷g&VRÖf÷&ÒG—–æræWfW"Ö÷fW2÷"6†ö÷G2"ÂG—–ærç‚ÓÓÒ&Vf÷&Rç‚bbG—–ærç¢ÓÓÒ&Vf÷&Rç¢bbG—–ærç6†÷G2ÓÓÒ&Vf÷&Rç6†÷G2bbG—–ærçG&–vvW"bbG—–ærçFW‡Bæ–æ6ÇVFW2‚'wgB"’bbG—–ærçFW‡Bæ–æ6ÇVFW2‚,é¬ëë¼ë|ëÌêÜøë"’Â¥4ôâç7G&–æv–g’‡G—–ær’“°¢v—B"æ¶W’‚$VçFW""“°¢&V6÷&B‚&G6"6†C¢VçFW"6VæG2æB&V6V—fW2fÆ–FFVBÖö6²FW‡B"Âv—BVçF–ÅvR†"Ât"æG6"æ6öçfW'6F–öâæ†—7F÷'’æÆVæwF‚ÓÓÒ"bb"æG6"æ6öçfW'6F–öâæ'W7’bb"æG6"æ6öçfW'6F–öâæ†—7F÷'•³Òç6÷W&6RÓÓÒ&Öö6²"rÂ3’“°¢v—B"æWfÇVFR†õööövæGfæ6Rƒ2ã"“¶“°¢&V6÷&B‚&G6"6†C¢&W7öç6R&V6†W2†W"‡—6–6Âv÷&ÆBF–ÆöwVR"Âv—B"æWfÇVFR†õööövæG6"ç§W§RæF–ÆöwVRæ–æ6ÇVFW2‚&Æö6ÂÖö6²&WÇ’"–’“°¢6öç7BfÆ–FF–öâÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"Ò$ÂæG6$vVçE&VÖ÷FRÂ6öçFW‡BÒõööövæG6"ç§W§Ræ6öçfW'6F–öä6öçFW‡B‚’Â&÷w2Ò'&’æg&öÒ‡²ÆVæwFƒ¢3ÒÂ‚’Óâ‡²&öÆS¢'Æ–W""ÂFW‡C¢&†VÆÆò"Ò’“²6öçFW‡BçVæ&÷fVBÒ$DõôäõEõ4TäB#²6öçFW‡Bç&V6VçDWfVçG2Ò'&’æg&öÒ‡²ÆVæwFƒ¢CÒÂ…òÂ’’Óâ‡²6W¢’²ÂF–ÖS¢’ÂG—S¢&fööE÷6VVâ"ÂfÇVS¢ÂW‡G&¢$DõôäõEõ4TäB"Ò’“²6öç7B&öG’Ò"æÖ¶U&WVW7B‚$ç’÷&F–æ'’F÷–2"Â6öçFW‡BÂ&÷w2“²6öç7B&BÒ²&æ÷B§6öâ"Â&çVÆÂ"Â¥4ôâç7G&–æv–g’‡²fW'6–öã¢"ÂFW‡C¢'‚"Ò’Â¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢'‚"Â7F–öç3¢µÒÒ’Â¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢#Æ–Ör7&3×‚öæW'&÷#ÖÆW'Bƒ“â"Ò’Â¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢'‚"ç&WVBƒ’Ò’Â'‚"ç&WVBƒƒ“2•Ó²&WGW&â²&V¦V7FVC¢&BæWfW'’‡&rÓâ²G'’²"çfÆ–FFU&W7öç6R‡&r“²&WGW&âfÇ6S²Ò6F6‚²&WGW&âG'VS²ÒÒ’Â&÷VæFVC¢&öG’æ†—7F÷'’æÆVæwF‚ÓÓÒ"bb&öG’ç6W76–öâç&V6VçDWfVçG2æÆVæwF‚ÓÓÒ‚bbæWrFW‡DVæ6öFW"‚’æVæ6öFR„¥4ôâç7G&–æv–g’†&öG’’’æÆVæwF‚ÃÒ"äÄ”Ô•E2ç&WVW7D'—FW2Â6VÆV7FVC¢&öG’ç6W76–öâçÆ–W$æÖRÂ&—fFS¢¥4ôâç7G&–æv–g’†&öG’’æ–æ6ÇVFW2‚$DõôäõEõ4TäB"’bbö&¦V7Bæ†4÷vâ†&öG’ç6W76–öâÂ'‚"’Ó²Ò’‚–“°¢&V6÷&B‚&G6"6†C¢&W7öç6R66†VÖô…DÔÂ÷6—¦RfÆ–FF–öâæB6öçFW‡BÆÆ÷vÆ—7B"ÂfÆ–FF–öâç&V¦V7FVBbbfÆ–FF–öâæ&÷VæFVBbbfÆ–FF–öâç&—fFRbbfÆ–FF–öâç6VÆV7FVBÓÓÒ''VÆW2×v—F†÷WB×'VÆW'2"Â¥4ôâç7G&–æv–g’‡fÆ–FF–öâ’“°¢f÷"†ÆWB’Ò²’Âƒ²’²²’v—B6VæB‚$g&VRÖf÷&ÒF÷–2"²’“°¢&V6÷&B‚&G6"6†C¢†—7F÷'’æBDôÒ&VÖ–â6VB"Âv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ†—7F÷'’æÆVæwF‚ÓÓÒ"bbFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖ†—7F÷'’"’æ6†–ÆG&VâæÆVæwF‚ÓÓÒ&’“°¢6öç7B6÷VçBÒv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ†—7F÷'’æÖ‡"Óâ"çFW‡B’æ¦ö–â‚'Â"–“°¢v—B6VæB‚'‚"ç&WVBƒ’“°¢&V6÷&B‚&G6"6†C¢÷fW&ÆöærÖW76vW2&V¦V7FVB&Vf÷&R6VæF–ær"Âv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ†—7F÷'’æÖ‡"Óâ"çFW‡B’æ¦ö–â‚'Â"’ÓÓÒG´¥4ôâç7G&–æv–g’†6÷VçB—ÒbbFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§R×7FGW2"’çFW‡D6öçFVçBæ–æ6ÇVFW2‚#Ã"–’“°¢v—B"æ¶W’‚$W66R"“°¢&V6÷&B‚&G6"6†C¢W66R6Æ÷6W2æB6ÆV'2†VÆB–çWB"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖ6öçfW'6F–öâ"’æ÷VâbbõööövæG6"æ6öçfW'6F–öâæ—4÷Vâbbõööövæ6öçG&öÇ2ç&VB‚’ç’ÓÓÒ’“°¢6öç7BÖ÷fRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂÒ"æG6"æfF"ç&ö÷Bç÷6—F–öâÂ‚Òç‚Â¢Òç£²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²"æGfæ6Rƒã"“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“²&WGW&âÖF‚æ‡—÷B‡ç‚Ò‚Âç¢Ò¢“²Ò’‚–“°¢&V6÷&B‚&G6"6†C¢6Æ÷6–ær&W7F÷&W2Ö÷fVÖVçB"ÂÖ÷fRâãÂ7G&–ær†Ö÷fR’“°¢v—B"ç6VæB‚$V×VÆF–öâç6WDFWf–6TÖWG&–74÷fW'&–FR"Â²v–GFƒ¢3“Â†V–v‡C¢sCÂFWf–6U66ÆTf7F÷#¢ÂÖö&–ÆS¢G'VRÒ“°¢v—B"ç6VæB‚$V×VÆF–öâç6WEF÷V6„V×VÆF–öäVæ&ÆVB"Â²Væ&ÆVC¢G'VRÂÖ…F÷V6…ö–çG3¢RÒ“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’çfÇVRÒ"#²Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’æ6Æ–6²‚“¶“°¢6öç7BFÒ7–æ26VÆV7F÷"Óâ²6öç7BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒFö7VÖVçBçVW'•6VÆV7F÷"‚G´¥4ôâç7G&–æv–g’‡6VÆV7F÷"—Ò’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"Ó²Ò’‚–“²v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6…7F'B"ÂF÷V6…ö–çG3¢·ÒÒ“²v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„VæB"ÂF÷V6…ö–çG3¢µÒÒ“²Ó°¢v—BF‚"7§W§RÖÖW76vR"“°¢v—B"ç6VæB‚$–çWBæ–ç6W'EFW‡B"Â²FW‡C¢.8>8)>8¾88ò	ù‚"Ò“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’æF—7F6„WfVçB†æWr6ö×÷6—F–öäWfVçB‚&6ö×÷6—F–öç7F'B"Â²'V&&ÆW3¢G'VRÒ’“¶“°¢v—B"æ¶W’‚$VçFW""“°¢&V6÷&B‚&G6"6†C¢6ö×÷6—F–öâVçFW"FöW2æ÷B&VÖGW&VÇ’7V&Ö—B"Âv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ'W7’bbFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’çfÇVRæ–æ6ÇVFW2‚.8>8)>8¾88ò"–’“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’æF—7F6„WfVçB†æWr6ö×÷6—F–öäWfVçB‚&6ö×÷6—F–öæVæB"Â²'V&&ÆW3¢G'VRÒ’“¶“°¢v—BF‚"7§W§R×6VæB"“°¢&V6÷&B‚&G6"6†C¢F÷V6‚6VæB†æFÆW2Væ–6öFRFW‡B"Âv—BVçF–ÅvR†"Ât"æG6"æ6öçfW'6F–öâæ†—7F÷'’æB‚Ó"’çFW‡Bæ–æ6ÇVFW2‚.8>8)>8¾88ò"’bb"æG6"æ6öçfW'6F–öâæ†—7F÷'’æB‚Ó’ç6÷W&6RÓÓÒ&Öö6²"rÂ3’“°¢v—B"ç6VæB‚$V×VÆF–öâç6WDFWf–6TÖWG&–74÷fW'&–FR"Â²v–GFƒ¢3“Â†V–v‡C¢CÂFWf–6U66ÆTf7F÷#¢ÂÖö&–ÆS¢G'VRÒ“°¢&V6÷&B‚&G6"6†C¢6ö×7BæVÂf—G2&VGV6VBÖö&–ÆRf–Ww÷'B"Âv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖ6öçfW'6F–öâ"’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â"æÆVgBãÒbb"ç&–v‡BÃÒ–ææW%v–GF‚²bb"çF÷ãÒbb"æ&÷GFöÒÃÒ–ææW$†V–v‡B²bb'6TfÆöB†vWD6ö×WFVE7G–ÆR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’’æföçE6—¦R’ãÒc²Ò’‚–’“°¢v—BF‚"7§W§RÖ6Æ÷6R"“°¢&V6÷&B‚&G6"6†C¢F÷V6‚6Æ÷6R&VÆV6W26öçfW'6F–öâ"Âv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ—4÷Væ’“°¢v—B"ç6VæB‚$V×VÆF–öâæ6ÆV$FWf–6TÖWG&–74÷fW'&–FR"“²v—B"ç6VæB‚$V×VÆF–öâç6WEF÷V6„V×VÆF–öäVæ&ÆVB"Â²Væ&ÆVC¢fÇ6RÒ“°¢òò–ç7FÆÂÆö6ÂG&ç7÷'Bf—‡GW&RF‡&÷Vv‚F†R6ÖRFFW"6VÒ2F†RgWGW&R6W'f–6Rà¢v—B"æWfÇVFR†v–æF÷råõ÷§W§UG&ç7÷'BÒ²ÖöFS¢'fÆ–B"Â&öG“¢çVÆÂÂf–æ—6ƒ¢çVÆÂÓ²v–æF÷råõ÷&VÖ÷FTf7F÷'’Ò$ÂæG6$vVçE&VÖ÷FRæ7&VFS²$ÂæG6$vVçE&VÖ÷FRæ7&VFRÒ‚’Óâõ÷&VÖ÷FTf7F÷'’‡²ÖöFS¢'&VÖ÷FR"ÂF–ÖV÷WD×3¢SÂG&ç7÷'C¢7–æ2&öG’Óâ²õ÷§W§UG&ç7÷'Bæ&öG’Ò¥4ôâç'6R†&öG’“²–b…õ÷§W§UG&ç7÷'BæÖöFRÓÓÒ'Væf–Æ&ÆR"’F‡&÷ræWrW'&÷"‚&öffÆ–æR"“²–b…õ÷§W§UG&ç7÷'BæÖöFRÓÓÒ'F–ÖV÷WB"’&WGW&âæWr&öÖ—6R‡&W6öÇfRÓâ²õ÷§W§UG&ç7÷'Bæf–æ—6‚Ò&W6öÇfS²Ò“²–b…õ÷§W§UG&ç7÷'BæÖöFRÓÓÒ&ÖÆf÷&ÖVB"’&WGW&â&'&ö¶Vâ§6öâ#²–b…õ÷§W§UG&ç7÷'BæÖöFRÓÓÒ&‡FÖÂ"’&WGW&â¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢#Æ#äæ÷BÆÆ÷vVCÂö#â"Ò“²&WGW&â¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢$Æ–â&WÇ’&÷WBF†RÖööââ"²%V–WFÇ’f66–æF–ærâ"ç&WVBƒ#’Ò“²ÒÒ“²õööövævò‚&‡V""“¶“°¢–b‚v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂ#’’F‡&÷rW'&÷"‚$‡V"G&ç6—F–öâf–ÆVB"“°¢v—B"æWfÇVFR†õööövævò‚&G6""“¶“°¢–b‚v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÂ’’F‡&÷rW'&÷"‚$E4"G&ç6—F–öâf–ÆVB"“°¢v—B6WGFÆR‚“²v—B6Æ–6²‚"6G6"Ö6öçFW‡B"“°¢&V6÷&B‚&G6"6†C¢66VæRW†—B&W6WG26öçfW'6F–öâÖVÖ÷'’"Âv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ†—7F÷'’æÆVæwF‚ÓÓÒ’“°¢v—B6VæB‚%FVÆÂÖR&÷WBF†RÖööâ"“°¢&V6÷&B‚&G6"6†C¢&÷FV7FVB×6W'f–6R–çFW&f6R66WG2gVÆÂFW‡BÂv—F‚&÷VæFVBv÷&ÆBW†6W'B"Âv—B"æWfÇVFR†õööövæGfæ6Rƒ2ã"“²õööövæG6"æ6öçfW'6F–öâæ†—7F÷'’æB‚Ó’çFW‡BæÆVæwF‚âcbbõööövæG6"ç§W§RæF–ÆöwVRæÆVæwF‚ÃÒcbbõ÷§W§UG&ç7÷'Bæ&öG’çfW'6–öâÓÓÒbbõ÷§W§UG&ç7÷'Bæ&öG’ævVçBÓÓÒ'§W§R"bbõ÷§W§UG&ç7÷'Bæ&öG’æ†—7F÷'’æÆVæwF‚ÓÓÒ’“°¢f÷"†6öç7BÖöFRöb²'Væf–Æ&ÆR"Â'F–ÖV÷WB"Â&ÖÆf÷&ÖVB"Â&‡FÖÂ%Ò’°¢v—B"æWfÇVFR†õ÷§W§UG&ç7÷'BæÖöFRÒG´¥4ôâç7G&–æv–g’†ÖöFR—Ö“²v—B6VæB‚$æ÷F†W"æ÷&ÖÂVW7F–öâ"“°¢&V6÷&B‚&G6"6†C¢FWFW&Ö–æ—7F–2fÆÆ&6²f÷""²ÖöFRÂv—B"æWfÇVFR†õööövæG6"æ6öçfW'6F–öâæ†—7F÷'’æB‚Ó’ç6÷W&6RÓÓÒ&fÆÆ&6²"bbõööövæG6"æ6öçfW'6F–öâæ'W7’bbõööövæG6"ç§W§Rç6æ6†÷B‚’æ7F—fRbbFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§R×7FGW2"’çFW‡D6öçFVçBæ–æ6ÇVFW2‚&Æö6Â&WÆ–W2"’bbFö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖ†—7F÷'’"’çVW'•6VÆV7F÷"‚&"Â–ÖrÂ67&—B"–’“°¢Ð¢v—B"æWfÇVFR†õ÷§W§UG&ç7÷'BæÖöFRÒ'F–ÖV÷WB#²Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖÖW76vR"’çfÇVRÒ$6æ6VÂÖR#²Fö7VÖVçBævWDVÆVÖVçD'”–B‚'§W§RÖf÷&Ò"’ç&WVW7E7V&Ö—B‚“¶“°¢v—B6Æ–6²‚"7§W§RÖ6Æ÷6R"“°¢6öç7BÆFRÒv—B"æWfÇVFR††7–æ2‚’Óâ²6öç7B2ÒõööövæG6"æ6öçfW'6F–öâÂâÒ2æ†—7F÷'’æÆVæwFƒ²õ÷§W§UG&ç7÷'Bæf–æ—6‚„¥4ôâç7G&–æv–g’‡²fW'6–öã¢ÂFW‡C¢$ÆFR&WÇ’"Ò’“²v—B&öÖ—6Rç&W6öÇfR‚“²v—B&öÖ—6Rç&W6öÇfR‚“²&WGW&â2æ—4÷Vâbb2æ'W7’bb2æ†—7F÷'’æÆVæwF‚ÓÓÒâbb2æ†—7F÷'’æB‚Ó’çFW‡BÓÒ$ÆFR&WÇ’#²Ò’‚–“°¢&V6÷&B‚&G6"6†C¢6Æ÷6–ær6æ6VÇ2VæF–ærv÷&²æB&V¦V7G2ÆFR&WÆ–W2"ÂÆFR“°¢v—B"æWfÇVFR†$ÂæG6$vVçE&VÖ÷FRæ7&VFRÒõ÷&VÖ÷FTf7F÷'“¶“°§ÒÕÒÒ“°§66VæR‚&G6""Â²Æ&VÃ¢&G6"§W§RvVçB"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"§W§RvVçB"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢'&VGV6R"ÕÒÒ“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²õööövæGfæ6Rƒ‚Âã“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“²õööövæGfæ6Rƒ"“¶“°¢6öç7Bf—'7BÒv—B"æWfÇVFR†õööövæG6"ç§W§Rç6æ6†÷B‚–“°¢&V6÷&B‚&G6"§W§S¢‡—6–6Â6Bw&VWG2gFW"'&—fÂ"Âf—'7Bç6VÆbææÖRÓÓÒ%§W§R"bbf—'7Bç6VÆbç&öæ÷Vç2ÓÓÒ'6†Rö†W""bbf—'7Bç6VÆbæw&VWFVBbbf—'7BçÆ–W"ææÖRÓÓÒ%–VÆÆ÷t'&ö¶T—B"bbf—'7BæWfVçG2ç6öÖR†RÓâRçG—RÓÓÒ'Æ–W%÷6VVâ"’Â¥4ôâç7G&–æv–g’†f—'7Bç6VÆb’“°¢–b‡&ö6W72æVçbäE4%õ¥U¥Uô4EU$R’°¢v—B"æWfÇVFR†v–æF÷råõ÷§W§UWFFRÒ$Âç66VæW2æG6"çWFFS²$Âç66VæW2æG6"çWFFRÒ‚’Óâ²ö&¦V7Bæ76–vâ…õööövæ6ÖW&ç÷6—F–öâÂ²ƒ¢Ó"Â“¢"Â£¢#bÒ“²ö&¦V7Bæ76–vâ…õööövæ6ÖW&çF&vWBÂ²ƒ¢ÓBÂ“¢ãrÂ£¢#2Ò“²Ó²õööövæGfæ6Rƒã“¶“°¢G'’²v—B"ç67&VVç6†÷B‡&ö6W72æVçbäE4%õ¥U¥Uô4EU$R“²Ð¢f–æÆÇ’²v—B"æWfÇVFR†$Âç66VæW2æG6"çWFFRÒõ÷§W§UWFFS²FVÆWFRv–æF÷råõ÷§W§UWFFS¶“²Ð¢Ð¢6öç7BÆ6RÒ‡‚Â¢’Óâ"æWfÇVFR†õööövç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ã"ÂF—7C¢rÂF&vWC¢²ƒ¢G·‡ÒÂ“¢ãrÂ£¢G·§ÒÒÂ÷6—F–öã¢²ƒ¢G·‡ÒÂ“¢Â£¢G·§ÒÒÒ“²õööövæGfæ6Rƒã“¶“°¢v—BG6$&ö6‚†"Â'6†÷"“°¢v—B"æWfÇVFR†õööövæG6"æ'W’‚'FöÖFò"“²õööövæG6"æ'W’‚'FöÖFò"“¶“°¢v—BÆ6R‚ÓBÂBãR“°¢6öç7B†—BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ¢Ò"æG6"ç§W§S²"æG6"çF‡&÷uFöÖFò‡¢“²"æGfæ6Rƒã‚Âò#“²6öç7BÒ¢ç6æ6†÷B‚“²"æGfæ6Rƒ2ãR“²6öç7B2Ò¢ç6æ6†÷B‚“²&WGW&â²†—G3¢2ç6VÆbçFöÖFô†—G2Â–çFVçC¢ç6VÆbæ–çFVçBÂÖ÷fVC¢ÖF‚æ‡—÷B†2ç6VÆbç‚²BÂ2ç6VÆbç¢Ò#2’ÂWfVçG3¢2æWfVçG2æÖ†RÓâRçG—R’ÂF–ÆöwVS¢¢æF–ÆöwVRÓ²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢&VÂFöÖFò6öÆÆ—6–öâ&V6÷&G2†—BæBfÆVW2"Â†—Bæ†—G2ÓÓÒbb†—Bæ–çFVçBÓÓÒ&fÆVR"bb†—BæÖ÷fVBâãRbb†—BæWfVçG2æ–æ6ÇVFW2‚'FöÖFõö†—B"’bb†—BæF–ÆöwVRæ–æ6ÇVFW2‚'6ÆBvVF†W""’Â¥4ôâç7G&–æv–g’††—B’“°¢òòf–æ—6‚†W"fÆ–v‡B&Vf÷&RFW7F–ær&VÂ6†&VBvVöâ6öçF7G2à¢v—B"æWfÇVFR†õööövæGfæ6Rƒr“¶“°¢6öç7B6BÒv—B"æWfÇVFR†õööövæG6"ç§W§Rç6æ6†÷B‚’ç6VÆf“°¢v—BÆ6R†6Bç‚Â6Bç¢²2“°¢6öç7BvVöâÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ¢Ò"æG6"ç§W§RÂÒ¢ç&ö÷Bç÷6—F–öã²"æ7&Wrç6VÆV7EvVöâƒ"“²6öç7Bf—&VBÒ"æ7&Wræf—&UvVöâ„"æG6"æfF"Â²ƒ¢ç‚Â“¢ãcRÂ£¢ç¢ÒÂ“²"æGfæ6Rƒã2Âò#“²&WGW&â²f—&VBÂââç¢ç6æ6†÷B‚’ç6VÆbÓ²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢6†&VBvVöâ&W÷'G2æV&'’f—&RæB6öæf—&ÖVB†—Bv—F†÷WB¶–ÆÆ–ær†W""ÂvVöâæf—&VBbbvVöâææV&'•6†÷G2âbbvVöâçvVöä†—G2âbbvVöâæ–çFVçBÓÓÒ&fÆVR"Â¥4ôâç7G&–æv–g’‡vVöâ’“°¢v—B"æWfÇVFR†õööövæGfæ6Rƒ‚“¶“°¢v—BG6$&ö6‚†"Â'6†÷"“°¢v—B"æWfÇVFR†õööövæG6"æ'W’‚&&ææ"“¶“°¢6öç7B‡Væw'”6BÒv—B"æWfÇVFR†õööövæG6"ç§W§Rç6æ6†÷B‚’ç6VÆf“°¢v—BÆ6R†‡Væw'”6Bç‚²2Â‡Væw'”6Bç¢“°¢6öç7BfööBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ¢Ò"æG6"ç§W§S²"æGfæ6Rƒ“²"æG6"æVB‚“²"æGfæ6Rƒ2“²6öç7B2Ò¢ç6æ6†÷B‚“²&WGW&â²ââç2ç6VÆbÂWfVçG3¢2æWfVçG2æÖ†RÓâRçG—R’ÂfööC¢"æG6"æ–çfVçF÷'’æ&ææ2Ó²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢fööBö'6W'fF–öç2ÆVBFò–çFW&W7BæBföÆÆ÷v–ærv—F†÷WBF¶–ær–çfVçF÷'’"ÂfööBæfööBÓÓÒbbfööBæWfVçG2æ–æ6ÇVFW2‚&fööE÷6VVâ"’bbfööBæWfVçG2æ–æ6ÇVFW2‚&fööEö7F—f—G’"’bbfööBæWfVçG2æ–æ6ÇVFW2‚&föÆÆ÷u÷7F'FVB"’Â¥4ôâç7G&–æv–g’†fööB’“°¢v—B"æWfÇVFR†õööövæGfæ6RƒB“¶“°¢6öç7B6†BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ¢Ò"æG6"ç§W§S²6öç7B&Vf÷&RÒ¢ç6æ6†÷B‚“²6öç7BÒ¢ç&ö÷Bç÷6—F–öã²"ç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ã"ÂF—7C¢rÂF&vWC¢²ƒ¢ç‚Â“¢ãrÂ£¢ç¢²"ãRÒÂ÷6—F–öã¢²ƒ¢ç‚Â“¢Â£¢ç¢²"ãRÒÒ“²"æGfæ6Rƒã"“²6öç7BFÆ¶VBÒ¢çFÆ²‚“²&WGW&â²FÆ¶VBÂFW‡C¢¢æF–ÆöwVRÂ6÷VçC¢&Vf÷&Rç6VÆbçFöÖFô†—G2Ó²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢FÆ²&VÖVÖ&W'2F†RFöÖFò"Â6†BçFÆ¶VBbb6†Bæ6÷VçBÓÓÒbb6†BçFW‡Bæ–æ6ÇVFW2‚'FöÖFò"’Â¥4ôâç7G&–æv–g’†6†B’“°¢v—B"æWfÇVFR†õööövæGfæ6RƒB“¶“°¢6öç7B6V7W&RÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B¢ÒõööövæG6"ç§W§RÂ2Ò¢ç6æ6†÷B‚“²ÆWB–BÒ°¢6öç7B6²Ò‡G—RÂW‡G&Ò·Ò’Óâ¢ç&WVW7B‡²f—6—C¢2çf—6—BÂ–C¢²¶–BÂC¢2çF–ÖRÂG—RÂââæW‡G&Ò“°¢6öç7B&BÒ¶6²‚&WfÂ"Â²FW‡C¢&ÆW'Bƒ’"Ò’Â6²‚'vÆµ÷Fò"Â²FW7F–æF–öã¢&‡V""Ò’Â6²‚&ÆööµöB"Â²VçF—G“¢'v–æF÷r"Ò’Â6²‚'6’"Â²FW‡C¢&†’"Â6öFS¢'‚"Ò’Â6²‚'6’"Â²FW‡C¢'‚"ç&WVBƒc’Ò’Â6²‚'6’"Â²FW‡C¢&öÆB"ÂC¢2çF–ÖRÒBÒ’Â6²‚'6’"Â²FW‡C¢&öÆBf—6—B"Âf—6—C¢2çf—6—BÒÒ•Ó°¢6öç7BfÆ–BÒ6²‚'6’"Â²FW‡C¢$W&fV7FÇ’÷&F–æ'’gWGW&RÖöFVÂ6VçFVæ6Râ"Ò“°¢6öç7B&WÆ’Ò¢ç&WVW7B‡²f—6—C¢2çf—6—BÂ–BÂC¢2çF–ÖRÂG—S¢'7F÷öföÆÆ÷v–ær"Ò“°¢6öç7BÖ÷fVÖVçBÒ¶6²‚'7F÷öföÆÆ÷v–ær"’Â6²‚'vÆµ÷Fò"Â²FW7F–æF–öã¢&'&—fÂ"Ò•Ó°¢6öç7B'W'7BÒµÓ²f÷"†ÆWB’Ò²’Â#²’²²’'W'7BçW6‚†6²‚&ÆööµöB"Â²VçF—G“¢'Æ–W""Ò’“°¢&WGW&â²&BÂfÆ–BÂ&WÆ’ÂÖ÷fVÖVçBÂÆ–Ö—FVC¢'W'7Bæ–æ6ÇVFW2‚'&FUöÆ–Ö—FVB"’Ó°¢Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢7G&–7B7F–öâfÆ–FF–öâ&V¦V7G2Vç6fRÂ7FÆRÂGWÆ–6FRæBW†6W76—fR&WVW7G2"Â6V7W&RçfÆ–BÓÓÒ&66WFVB"bb6V7W&Ræ&BæWfW'’‡bÓâbÓÒ&66WFVB"’bb6V7W&Rç&WÆ’ÓÓÒ'7FÆR"bb6V7W&RæÆ–Ö—FVBbb6V7W&RæÖ÷fVÖVçBæWfW'’‡bÓâbÓÓÒ&66WFVB"’Â¥4ôâç7G&–æv–g’‡6V7W&R’“°¢6öç7BF‚Òv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ¢Ò"æG6"ç§W§S²ÆWB6fRÒG'VS²f÷"†ÆWB’Ò²’Âc²’²²’²"æGfæ6RƒãR“²6öç7BÒ¢ç&ö÷Bç÷6—F–öã²6fRÒ6fRbbÖF‚æ‡—÷B‡ç‚Âç¢’ÃÒ#’ãbbç¢ãÒbbbç¢ÃÒ#c²Ò&WGW&â²6fRÂââç¢ç6æ6†÷B‚’ç6VÆbÓ²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢v—ö–çBvÆ²&V6†W2'&—fÂ–ç6–FR6fR&÷VæG2"ÂF‚ç6fRbbÖF‚æ‡—÷B‡F‚ç‚²BÂF‚ç¢Ò#2’Âã2Â¥4ôâç7G&–æv–g’‡F‚’“°¢v—BÆ6R‚ÓBÂ#b“° ¢6öç7BÖVÖ÷'’Òv—B"æWfÇVFR†‚‚’Óâ²6öç7B¢ÒõööövæG6"ç§W§S²f÷"†ÆWB’Ò²’Âƒ²’²²’¢æWfVçB‚'FöÖFõö†—B"“²6öç7B2Ò¢ç6æ6†÷B‚“²&WGW&â²6÷VçC¢2æWfVçG2æÆVæwF‚Â†—G3¢2ç6VÆbçFöÖFô†—G2Â÷&FW&VC¢2æWfVçG2æWfW'’‚†RÂ’Â’Óâ’ÇÂRç6WÓÓÒ¶’ÒÒç6W²’Âg&÷¦Vã¢ö&¦V7Bæ—4g&÷¦Vâ‡2’bbö&¦V7Bæ—4g&÷¦Vâ‡2æWfVçG5³Ò’Ó²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢ÖVÖ÷'’—2&÷VæFVBÂ÷&FW&VBæB&VBÖöæÇ’Fò'&–ç2"ÂÖVÖ÷'’æ6÷VçBÓÓÒcBbbÖVÖ÷'’æ†—G2ÓÓÒƒbbÖVÖ÷'’æ÷&FW&VBbbÖVÖ÷'’æg&÷¦VâÂ¥4ôâç7G&–æv–g’†ÖVÖ÷'’’“°¢v—B"æWfÇVFR†v–æF÷råõööÆE§W§RÒõööövæG6"ç§W§S²õööövævò‚&‡V""“¶“°¢&V6÷&B‚&G6"§W§S¢W†—BF—7÷6W2vVçBæB‡V"†2æòvVçB"Âv—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærbbõööÆE§W§RæF—7÷6VBbb"æG6"rÂ#’“°¢v—B"æWfÇVFR†õööövævò‚&G6""“¶“°¢–b‚v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÂ’’F‡&÷rW'&÷"‚$E4"&VVçG'’f–ÆVB"“°¢&V6÷&B‚&G6"§W§S¢G&ç6—B&VVçG'’†2æòvVçB"Âv—B"æWfÇVFR‚"õööövæG6"ç§W§R"’“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²$Âç66VæW2æG6"çWFFR…õööövæVF–òæGW&F–öâ²Â“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“¶“°¢6öç7B&W6WBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B2ÒõööövæG6"ç§W§Rç6æ6†÷B‚“²&WGW&â²WfVçG3¢2æWfVçG2æÆVæwF‚Â†—G3¢2ç6VÆbçFöÖFô†—G2Ó²Ò’‚–“°¢&V6÷&B‚&G6"§W§S¢æWrf—6—B&W6WG26W76–öâÖVÖ÷'’"Â&W6WBæWfVçG2ÓÓÒbb&W6WBæ†—G2ÓÓÒÂ¥4ôâç7G&–æv–g’‡&W6WB’“°§ÒÕÒÒ“°¦f÷"†6öç7B&VG’öb¶fÇ6RÂG'VUÒ’66VæR‚&G6""Â²Æ&VÃ¢&VçG&æ6RVF–ò"²&VG’ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"VçG&æ6R"²‡&VG’ò&VF–òVæ&ÆVB"¢&VF–ò&Æö6¶VB"’Âv‡“¢'&Vw&W76–öã¢&Æö6¶VBVF–ò×W7Bæ÷B&Æö6²VçG&æ6RÖ÷fVÖVçB"Â'Vã¢7–æ2†"’Óâ°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢'&VGV6R"ÕÒÒ“°¢–b‡&VG’’°¢6öç7BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×7F'BÖVF–ò"’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"Ó²Ò’‚–“°¢v—B"æ6Æ–6²‡ç‚Âç’“°¢&V6÷&B‚&G6"VçG&æ6S¢VçFW"v—F‚6÷VæBFV6öFW2VF–ò"Âv—BVçF–ÅvR†"Â$"æVF–òç&VG’bb"æVF–òæ×W6–4GW&F–öââ"Â’“°¢ÒVÇ6R°¢òòfVÇB–æ¦V7F–öã¢FV6öF–æræWfW"&V6öÖW2&VG’æBÆ–&6²æWfW"f–æ—6†W2à¢v—B"æWfÇVFR†ö&¦V7BæFVf–æU&÷W'G’…õööövæVF–òÂ'&VG’"Â²vWC¢‚’ÓâfÇ6RÒ“¶“°¢Ð¢6öç7BÖ÷fVBÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ&Vf÷&RÒ"æG6"ç&öw&W73°¢v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“°¢"æGfæ6R„"æVF–òæGW&F–öâ¢ã3RÂãR“°¢v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“°¢&WGW&â²&Vf÷&RÂgFW#¢"æG6"ç&öw&W72Â&VG“¢"æVF–òç&VG’Â7VS¢"æVF–òæ7VRÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"VçG&æ6S¢f÷'v&BÖ÷fVÖVçBv—F‚VF–ò&VG“Ò"²&VG’ÂÖ÷fVBægFW"âÖ÷fVBæ&Vf÷&R²ã2bbÖ÷fVBç&VG’ÓÓÒ&VG’Â¥4ôâç7G&–æv–g’†Ö÷fVB’“°¢–b‡&VG’’°¢&V6÷&B‚&G6"VçG&æ6S¢æ÷&ÖÂfö–6RÆ–&6²7F'G2"ÂÖ÷fVBæ7VRãÒ“°¢v—B"æ¶W’‚&Ò"“²&V6÷&B‚&G6"VçG&æ6S¢×WFR7F–ÆÂv÷&·2"Âv—B"æWfÇVFR‚%õööövæVF–òæ×WFVB"’“°¢v—B"æ¶W’‚&Ò"“²&V6÷&B‚&G6"VçG&æ6S¢Væ×WFR7F–ÆÂv÷&·2"Âv—B"æWfÇVFR‚"õööövæVF–òæ×WFVB"’“°¢v—B"ç6VæB‚$V×VÆF–öâç6WEF÷V6„V×VÆF–öäVæ&ÆVB"Â²Væ&ÆVC¢G'VRÒ“°¢6öç7BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&¦÷’ÖÖ÷fR"“²VÂç7G–ÆRæF—7Æ’Ò&&Æö6²#²VÂæFDWfVçDÆ—7FVæW"‚'ö–çFW&F÷vâ"ÂRÓâ²v–æF÷råõöG6%7F–6µö–çFW"ÒRçö–çFW$–C²ÒÂ²öæ6S¢G'VRÒ“²6öç7B"ÒVÂævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²‚Ó²Ò’‚–“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6…7F'B"ÂF÷V6…ö–çG3¢·²ƒ¢ç‚Â“¢ç’ÕÒÒ“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„Ö÷fR"ÂF÷V6…ö–çG3¢·²ƒ¢ç‚Â“¢ç’²ÕÒÒ“°¢&V6÷&B‚&G6"VçG&æ6S¢F÷V6‚7F–6²fVVG2f÷'v&BÖ÷fVÖVçB"Âv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ&Vf÷&RÒ"æG6"ç&öw&W72Â’Ò"æ6öçG&öÇ2ç&VB‚’ç“²"æGfæ6Rƒã"“²&WGW&â’âãRbb"æG6"ç&öw&W72â&Vf÷&S²Ò’‚–’“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&¦÷’ÖÖ÷fR"’æF—7F6„WfVçB†æWrö–çFW$WfVçB‚&Æ÷7Gö–çFW&6GW&R"Â²ö–çFW$–C¢““’Ò’“¶“°¢&V6÷&B‚&G6"VçG&æ6S¢Vç&VÆFVB6GW&RÆ÷72&W6W'fW27F—fR7F–6²"Âv—B"æWfÇVFR‚%õööövæ6öçG&öÇ2ç&VB‚’ç’âãR"’“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&¦÷’ÖÖ÷fR"’ç&VÆV6Uö–çFW$6GW&R…õöG6%7F–6µö–çFW"“¶“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„Ö÷fR"ÂF÷V6…ö–çG3¢·²ƒ¢ç‚Â“¢ç’²"ÕÒÒ“°¢&V6÷&B‚&G6"VçG&æ6S¢Æ÷7B6GW&R6ÆV'27F–6²"Âv—B"æWfÇVFR‚%õööövæ6öçG&öÇ2ç&VB‚’ç’ÓÓÒ"’“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„6æ6VÂ"ÂF÷V6…ö–çG3¢µÒÒ“°¢Ð¢6öç7Bf–æ—6†VBÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"Òõöööv°¢ö&¦V7BæFVf–æU&÷W'G’„"æVF–òÂ'VæF–ær"Â²vWC¢‚’ÓâG'VRÒ“°¢v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“°¢"æGfæ6R„"æVF–òæGW&F–öâ²Âã“°¢v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“°¢&WGW&â²†6S¢"æG6"ç†6RÂ&öw&W73¢"æG6"ç&öw&W72ÂVæF–æs¢"æVF–òçVæF–ærÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"VçG&æ6S¢6ö×ÆWFW2FW7—FRVæF–ærVF–òÂ&VG“Ò"²&VG’Âf–æ—6†VBç†6RÓÓÒ&ÆæB"bbf–æ—6†VBç&öw&W72ÓÓÒbbf–æ—6†VBçVæF–ærÂ¥4ôâç7G&–æv–g’†f–æ—6†VB’“° ¢ÒÕÒÒ“°¦f÷"†6öç7BfÆÆ&6²öb¶fÇ6RÂG'VUÒ’66VæR‚&G6""Â²Æ&VÃ¢&G6"vÖWÆ’"²†fÆÆ&6²ò&6çf3&B"¢'vV&vÃ""’ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""²†fÆÆ&6²ò"f6çf3&CÓ"¢""’’Â7FW3¢·²æÖS¢&G6"vÖWÆ’"²†fÆÆ&6²ò&6çf3&B"¢'vV&vÃ""’Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢6öç7B6Æ–6²Ò7–æ2‡6VÆV7F÷"’Óâ²6öç7BÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BRÒFö7VÖVçBçVW'•6VÆV7F÷"‚G´¥4ôâç7G&–æv–g’‡6VÆV7F÷"—Ò“²Rç67&öÆÄ–çFõf–Wr‡²&Æö6³¢&6VçFW""Ò“²6öç7B"ÒRævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"Â†—G3¢Ræ6öçF–ç2†Fö7VÖVçBæVÆVÖVçDg&öÕö–çB‡"ç‚²"çv–GF‚ò"Â"ç’²"æ†V–v‡Bò"’’Ó²Ò’‚–“²–b‚æ†—G2’F‡&÷rW'&÷"‚$&Æö6¶VBö–çFW#¢"²6VÆV7F÷"“²v—B"æ6Æ–6²‡ç‚Âç’“²Ó°¢6öç7BvÆµFòÒ7–æ2‡‚Â¢’Óâ"æWfÇVFR†õööövç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ã"ÂF—7C¢rÂF&vWC¢²ƒ¢G·‡ÒÂ“¢ãrÂ£¢G·§ÒÒÂ÷6—F–öã¢²ƒ¢G·‡ÒÂ“¢Â£¢G·§ÒÒÒ“²õööövæGfæ6RƒãR“¶“°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢'&VGV6R"ÕÒÒ“°¢v—B"æ¶W’‚&Ò"“²v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢–b‡&ö6W72æVçbäE4%ô4EU$RbbfÆÆ&6²’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×&÷VæB×GVææVÂçær"’“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²õööövæGfæ6R…õööövæVF–òæGW&F–öâ²Âã“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“¶“°¢6öç7B&öF–W2Òv—B"æWfÇVFR†‡²†6S¢õööövæG6"ç†6RÂæÖS¢õööövæG6"æfF"çG&—G2ææÖRÂ6æöæ–6Ã¢õööövæG6"æfF"æ†VD÷VâÓÓÒ$ÂæÖöFVÇ2æ6fVÖâ„$Âæ6öçG&–'WF÷'2çG&—G4f÷"‚%–VÆÆ÷t'&ö¶T—B"’’æ†VD÷VâÂfVWC¢õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç’ÒõööövæG6"æfF"æ&6U’Âç4fVWC¢õööövæG6"çf—6—F÷'2æWfW'’‡bÓâÖF‚æ'2‡bç&ö÷Bç÷6—F–öâç’Òbæ&6U’ÒbæfÆö÷%’’Âã’Â&–ÄÖ–ã¢ÖF‚æÖ–â‚ââåõööövæG6"ç&–Å’’Â&F—W3¢ÖF‚æ‡—÷B…õööövæG6"æÆæBæ6'Bç÷6—F–öâç‚ÂõööövæG6"æÆæBæ6'Bç÷6—F–öâç¢’Ò–“°¢&V6÷&B‚&G6"vÖWÆ“¢6æöæ–6Â–VÆÆ÷r7FæG2öâF†RfÆö÷#²W&–ÖWFW"G&6²&WF–ç26fR6ÆV&æ6R"Â&öF–W2ç†6RÓÓÒ&ÆæB"bb&öF–W2ææÖRÓÓÒ%–VÆÆ÷t'&ö¶T—B"bb&öF–W2æ6æöæ–6ÂbbÖF‚æ'2†&öF–W2æfVWB’Âãbb&öF–W2æç4fVWBbb&öF–W2ç&–ÄÖ–âãÒrãRbbÖF‚æ'2†&öF–W2ç&F—W2Ò3’ÂãÂ¥4ôâç7G&–æv–g’†&öF–W2’“°¢v—B6Æ–6²‚"6G6"×FövvÆR"“°¢&V6÷&B‚&G6"ÖVçS¢†–FRÆVfW26†÷r'WGFöâ"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×FövvÆR"’çFW‡D6öçFVçBÓÓÒ%6†÷rE4"ÖVçR"bbvWD6ö×WFVE7G–ÆR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö&r"’’æF—7Æ’ÓÓÒ&æöæR&’“°¢v—B6Æ–6²‚"6G6"×FövvÆR"“°¢&V6÷&B‚&G6"ÖVçS¢6†÷r&W7F÷&W26öçFVçG2"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×FövvÆR"’çFW‡D6öçFVçBÓÓÒ$†–FRE4"ÖVçR"bbvWD6ö×WFVE7G–ÆR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö&r"’’æF—7Æ’ÓÒ&æöæR&’“°¢v—BvÆµFòƒ"Â"“°¢6öç7Bf6–ærÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B&÷w2ÒµÓ²f÷"†6öç7B¶W’öb²'r"Â'2%Ò’²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W’Ò’“²õööövæGfæ6Rƒã2“²6öç7B&Vf÷&RÒõööövæG6"æfF"ç&ö÷Bç&÷FF–öâç“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W’Ò’“²õööövæGfæ6Rƒã‚“²&÷w2çW6‚‡²&Vf÷&RÂgFW#¢õööövæG6"æfF"ç&ö÷Bç&÷FF–öâç’Ò“²Ò&WGW&â²ÖöFS¢õööövç–Æ÷BæÖöFRÂ&÷w2Ó²Ò’‚–“°¢&V6÷&B‚&G6"vÆ¶–æs¢6öÖ&B6†÷VÆFW"Ö÷fVÖVçB&W6W'fW2f÷'v&Bf6–ærgFW"Ö÷f–ær÷"&6¶–ærW"Âf6–æræÖöFRÓÓÒ'6†÷VÆFW""bbf6–ærç&÷w2æWfW'’‡"ÓâÖF‚æ'2‡"æ&Vf÷&RÒ"ægFW"’Âã’bbÖF‚æ6÷2†f6–ærç&÷w5³Òæ&Vf÷&RÒf6–ærç&÷w5³Òæ&Vf÷&R’âã’Â¥4ôâç7G&–æv–g’†f6–ær’“°¢v—BG6$&ö6‚†"Â'Gb"“°¢–b‡&ö6W72æVçbäE4%ô4EU$RbbfÆÆ&6²’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×7FæF–ær×–VÆÆ÷rçær"’“°¢&V6÷&B‚&G6"vÖWÆ“¢W6REbV'2æV&'’"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’æ†–FFVâbbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’çFW‡D6öçFVçBÓÓÒ%W6REb&’“°¢v—B6Æ–6²‚"6G6"Ö6öçFW‡B"“²v—B6Æ–6²‚"6G6"×GbÖ6†ææVÂ"“°¢&V6÷&B‚&G6"vÖWÆ“¢&VÂÖ÷W6R6Æ–6·2÷VâF†REb6†ææVÂ"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb"’æ÷VâbbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×&F–ò"’æ†–FFVæ’“°¢&V6÷&B‚&G6"Ec¢7V&ÖVçR†–FW26†ææVÂ6†ö–6W2"Âv—B"æWfÇVFR†vWD6ö×WFVE7G–ÆR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖÖVçR"’’æF—7Æ’ÓÓÒ&æöæR&’“°¢v—B6Æ–6²‚"6G6"×GbÖ&6²"“°¢&V6÷&B‚&G6"Ec¢&6²&W7F÷&W2F†Rf—fR6†ö–6W2"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖÖVçR"’æ†–FFVâbbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×&F–ò"’æ†–FFVâbbFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"6G6"×GbÖÖVçR'WGFöâ"’æÆVæwF‚ÓÓÒV’“°¢v—B6Æ–6²‚"6G6"×GbÖ6†ææVÂ"“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×VW'’"’çfÇVRÒ$ööv&“²v—B6Æ–6²‚"6G6"×Gb×6V&6‚"“²v—BVçF–ÅvR†"ÂvFö7VÖVçBçVW'•6VÆV7F÷"‚"6G6"×Gb×&W7VÇG2'WGFöâ"’ÓÒçVÆÂr“°¢v—B6Æ–6²‚"6G6"×Gb×&W7VÇG2'WGFöâ"“²v—BVçF–ÅvR†"ÂrFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ–çfö–6R"’æ†–FFVâr“°¢&V6÷&B‚&G6"vÖWÆ“¢6öær6VÆV7F–öâ7&VFW2öæR–çfö–6R"æBvÆÆWBÆ–æ²"Âv—B"æWfÇVFR†õöG6%Gdf—‡GW&Ræ–çfö–6W2ÓÓÒbbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ–çfö–6R×""’çv–GF‚â#bbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×vÆÆWB"’æ‡&Vbç7F'G5v—F‚‚&Æ–v‡Fæ–æs¦Ææ&2"’bbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×&–6R"’çFW‡D6öçFVçBæ–æ6ÇVFW2‚##6G2"–’“°¢&V6÷&B‚&G6"vÖWÆ“¢7FF–öâ–ÖVçB6öæf—&ÖF–öâ—26†÷vâ"Âv—BVçF–ÅvR†"ÂvFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×–ÖVçB×7FGW2"’çFW‡D6öçFVçBæ–æ6ÇVFW2‚&6öæf—&ÖVB"’rÂ’“°¢–b‡&ö6W72æVçbäE4%ô4EU$RbbfÆÆ&6²’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"Ö§V¶V&÷‚çær"’“°¢v—B6Æ–6²‚"6G6"×GbÖ6Æ÷6R"“²v—BG6$&ö6‚†"Â'6†÷"“²v—B6Æ–6²‚"6G6"Ö6öçFW‡B"“²v—B6Æ–6²‚u¶FFÖ7F–öãÒ&G6"Ö&ææ%Òr“²v—B6Æ–6²‚u¶FFÖ7F–öãÒ&G6"×FöÖFò%Òr“°¢6öç7B&÷Vv‡BÒv—B"æWfÇVFR†õööövæG6"æ–çfVçF÷'–“²&V6÷&B‚&G6"vÖWÆ“¢&VÂ6†÷6Æ–6·2FB&æææBFöÖFò"Â&÷Vv‡Bæ&ææ2ÓÓÒbb&÷Vv‡BçFöÖFöW2ÓÓÒbb&÷Vv‡BçFö¶Vç2ÓÓÒ‚Â¥4ôâç7G&–æv–g’†&÷Vv‡B’“°¢v—B6Æ–6²‚u¶FFÖ7F–öãÒ&G6"Ö6Æ÷6R×6†÷%Òr“²v—B6Æ–6²‚u¶FFÖ7F–öãÒ&G6"×F‡&÷r%Òr“°¢6öç7B&ö¦V7F–ÆRÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂvVöÖWG'’Ò$ÂæG6$ÖöFVÇ2æ7V&R‚"6VcC#Sb"’ÂæöFRÒ"æG6"æÆæBç&ö÷Bæ6†–ÆG&Vâæf–æB†âÓââævVöÖWG'’ÓÓÒvVöÖWG'’bbâçf—6–&ÆR“°¢–b‚æöFR’&WGW&â²7&VFVC¢fÇ6RÓ°¢6öç7B7F'BÒ²ââææöFRç÷6—F–öâÒÂ67&VVâÒ"ç&ö¦V7B‡7F'Bç‚Â7F'Bç’Â7F'Bç¢’Â–çfVçF÷'’Ò"æG6"æ–çfVçF÷'’çFöÖFöW3°¢"æGfæ6Rƒã"“²6öç7BÖ÷fVBÒÖF‚æ‡—÷B†æöFRç÷6—F–öâç‚Ò7F'Bç‚ÂæöFRç÷6—F–öâç¢Ò7F'Bç¢“°¢"æGfæ6Rƒã‚“²6öç7B7ÆBÒæöFRçf—6–&ÆRbbæöFRç÷6—F–öâç’ÓÓÒãBbbæöFRç66ÆRç’ÓÓÒãc°¢"æGfæ6RƒãR“²&WGW&â²7&VFVC¢G'VRÂ–çfVçF÷'’Âf—6–&ÆT–åf–Ws¢67&VVâç‚ãÒbb67&VVâç‚ÃÒ–ææW%v–GF‚bb67&VVâç’ãÒbb67&VVâç’ÃÒ–ææW$†V–v‡BÂÖ÷fVBÂ7ÆBÂW‡—&VC¢æöFRçf—6–&ÆRbb"æG6"ç6†÷G2ÓÓÒÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"vÖWÆ“¢F‡&÷v–ær6öç7VÖW2–çfVçF÷'’æB7&VFW2f—6–&ÆRÖ÷f–ærFöÖFòF†B7ÆG2æBW‡—&W2"Â&ö¦V7F–ÆRæ7&VFVBbb&ö¦V7F–ÆRæ–çfVçF÷'’ÓÓÒbb&ö¦V7F–ÆRçf—6–&ÆT–åf–Wrbb&ö¦V7F–ÆRæÖ÷fVBâbb&ö¦V7F–ÆRç7ÆBbb&ö¦V7F–ÆRæW‡—&VBÂ¥4ôâç7G&–æv–g’‡&ö¦V7F–ÆR’“°¢v—B"æ¶W’‚&""“²&V6÷&B‚&G6"vÖWÆ“¢&ææ6â&RVFVâ"Âv—B"æWfÇVFR†õööövæG6"æ–çfVçF÷'’æ&ææ2ÓÓÒ’“°¢f÷"†6öç7B¶–æBöb²&&öB"Â&6ö7FW"%Ò’°¢v—BvÆµFò†¶–æBÓÓÒ&&öB"ò¢rÂ¶–æBÓÓÒ&&öB"ò3B¢#B“°¢6öç7BG&—Ò¶–æBÓÓÒ&&öB"ò&&öEG&—"¢'G&–åG&—#°¢v—B"æWfÇVFR†õööövæG6"âG·G&—Òçv—BÒ²õööövæG6"âG·G&—ÒæævÆRÒõööövæG6"âG·G&—Òç7F'B²²õööövæGfæ6Rƒã“¶“°¢&V6÷&B‚&G6"vÖWÆ“¢"²¶–æB²"6ææ÷B&ö&Bv†–ÆRv’"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’æF—6&ÆVF’“°¢v—B"æWfÇVFR†õööövæG6"âG·G&—ÒæævÆRÒõööövæG6"âG·G&—Òç7F'B²ÖF‚å’¢"Òã²õööövæGfæ6Rƒã“¶“°¢6öç7B7F÷VBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BBÒõööövæG6"âG·G&—ÒÂÒBæævÆS²õööövæGfæ6Rƒ“²&WGW&âBçv—BâbbBæævÆRÓÓÒ²Ò’‚–“°¢&V6÷&B‚&G6"vÖWÆ“¢"²¶–æB²"W6W2BF†R7FF–öâ"Â7F÷VB“°¢v—B6Æ–6²‚"6G6"Ö6öçFW‡B"“²v—B"æWfÇVFR†õööövæGfæ6Rƒã"–“°¢6öç7Bf–WrÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂÒ"æG6"æÆæBâG¶¶–æBÓÓÒ&&öB"ò&&öG5³Ò"¢&6'B'Òç÷6—F–öâÂ2Ò"æ6ÖW&ÂÒ"æG6"âG·G&—ÒæævÆR²ÖF‚å’ò"ÂG‚Ò2çF&vWBç‚Ò2ç÷6—F–öâç‚ÂG¢Ò2çF&vWBç¢Ò2ç÷6—F–öâç£²&WGW&â²†6S¢"æG6"ç†6RÂF—7Fæ6S¢ÖF‚æ‡—÷B†2ç÷6—F–öâç‚×ç‚Æ2ç÷6—F–öâç¢×ç¢’Âf÷'v&C¢†G‚¤ÖF‚ç6–â†’¶G¢¤ÖF‚æ6÷2†’’ôÖF‚æ‡—÷B†G‚ÆG¢’Ó²Ò’‚–“°¢&V6÷&B‚&G6"vÖWÆ“¢"²¶–æB²"W6W2f÷'v&Bf—'7B×W'6öâ6ÖW&"Âf–Wrç†6RÓÓÒ¶–æBbbf–WræF—7Fæ6RÂbbf–Wræf÷'v&Bâã“’Â¥4ôâç7G&–æv–g’‡f–Wr’“°¢v—B"æG&r‡²ƒ¢SÂ“¢3SÒÂ²ƒ¢scÂ“¢CÒÂB“°¢6öç7BÆöö²Òv—B"æWfÇVFR†õööövæG6"ç&–FTÆöö¶“²&V6÷&B‚&G6"vÖWÆ“¢"²¶–æB²"Ö÷W6RÆöö²—2&÷VæFVB"ÂÖF‚æ'2†Æöö²ç–r’âãbbÖF‚æ'2†Æöö²ç–r’ÃÒãcRbbÖF‚æ'2†Æöö²ç—F6‚’ÃÒã2Â¥4ôâç7G&–æv–g’†Æöö²’“°¢–b‡&ö6W72æVçbäE4%ô4EU$RbbfÆÆ&6²’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"Ò"²¶–æB²"×&–FRçær"’“°¢v—B6Æ–6²‚"6G6"Ö6öçFW‡B"“°¢Ð¢v—B"æ¶W’‚$W66R"“²&V6÷&B‚&G6"vÖWÆ“¢W66RöâÆæB&WV—&W2F†R&WGW&âööv÷'FÂ"Âv—B"æWfÇVFR†õööövç66VæRÓÓÒ&G6"&’“°¢v—BvÆµFò‚ÓrÂ3ãR“°¢&V6÷&B‚&G6"vÖWÆ“¢f÷&ÖW"&WGW&â6fR†2æòvVöÖWG'’Â6öÆÆ—6–öâ÷"W†—B7F–öâ"Âv—B"æWfÇVFR†õööövæG6"æÆæBæW†—BbbõööövæG6"æ6ÆV$B‚ÓÃ3ãR’bbõööövæG6"æ6ÆV$B‚ÓrÃ3"ãR’bbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’çFW‡D6öçFVçBÓÒ%&WGW&âFòööv&öövÆæB&’“°¢v—BG6$W†—B†"“°¢&V6÷&B‚&G6"vÖWÆ“¢g&öçBööv÷'FÂ7&÷76–ær&WGW&ç2Fò&–g&÷7B"Âv—B"æWfÇVFR†õööövç66VæRÓÓÒ&&–g&÷7B"bbõööövçG&ç6—F–öæ–æv’“°§ÒÕÒÒ“°¦–b‡&ö6W72æVçbäE4%õ$D”õôÄ•dRÓÓÒ#"’66VæR‚&G6""Â²Æ&VÃ¢&G6"&F–òÆ—fR"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"&F–òÆ—fR"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"æ¶W’‚'r"“²v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢v—B"æWfÇVFR†õööövæVF–òæ'&—fR‚–“°¢6öç7BÆ––ærÒv—BVçF–ÅvR†"Ât"æVF–òç&F–õ7FGW2ç7F'G5v—F‚‚$Æ—fR"’rÂ#“°¢&V6÷&B‚&G6"&F–òÆ—fS¢&öGV7F–öâvRÆ—2F†R7FF–öâgFW"F†RVçG&æ6RvW7GW&R"ÂÆ––ærÂv—B"æWfÇVFR†õööövæVF–òç&F–õ7FGW6’“°¢v—B"æ¶W’‚$W66R"“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°§ÒÕÒÒ“° ¦–b‡&ö6W72æVçbäE4%õEeôÄ•dRÓÓÒ#"’66VæR‚&G6""Â²Æ&VÃ¢&G6"FVÆWf—6–öâÆ—fR"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"FVÆWf—6–öâÆ—fR"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢6öç7BÆ—fRÒv—BVçF–ÅvR†"Ât"æG6"çGbç7FGW2ç7F'G5v—F‚‚$Æ—fR"’rÂ#“°¢&V6÷&B‚&G6"Ec¢&öGV7F–öâvR&VG2F†R&VÂ7FF–öâ’"ÂÆ—fRÂv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×6öær"’çFW‡D6öçFVçB²"ò"²õööövæG6"çGbç7FGW6’“°¢v—B"æ¶W’‚$W66R"“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°§ÒÕÒÒ“° ¦f÷"†6öç7BfÆÆ&6²öb¶fÇ6RÂG'VUÒ’66VæR‚&G6""Â²Æ&VÃ¢&G6"FVÆWf—6–öâ"²†fÆÆ&6²ò&6çf3&B"¢'vV&vÃ""’ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""²†fÆÆ&6²ò"f6çf3&CÓ"¢""’’Â7FW3¢·²æÖS¢&G6"FVÆWf—6–öâ"²†fÆÆ&6²ò&6çf3&B"¢'vV&vÃ""’Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢'&VGV6R"ÕÒÒ“°¢v—B"æ¶W’‚'r"“²v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢v—B"æWfÇVFR†õööövæVF–òçFövvÆR‚“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Â6öFS¢$¶W•r"Ò’“²õööövæGfæ6R…õööövæVF–òæGW&F–öâ²"Âã“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Â6öFS¢$¶W•r"Ò’“¶“°¢&V6÷&B‚&G6"Ec¢VçFW'2F†RÆ–âv—F†÷WB÷Væ–ærÖVçR"Âv—B"æWfÇVFR†õööövæG6"ç†6RÓÓÒ&ÆæB"bbõööövæG6"çGbæ—4÷Væ’“°¢6öç7B&W7VÇBÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7BBÒõööövæG6"ÂÒõööövç–Æ÷C°¢Bæ÷VåGb‚“²6öç7Bf$6Æ÷6VBÒBçGbæ—4÷Vã°¢6öç7BÆæFÖ&²ÒBæÆæBæÆæFÖ&·2çGbÂæ6†÷"ÒÆæFÖ&²çö–çB‚“²ææf–vFR‡²–s¢ÆæFÖ&²ææöFRç&÷FF–öâç’Â—F6ƒ¢ãÂF—7C¢rÂF&vWC¢²ƒ¢æ6†÷"ç‚Â“¢ãrÂ£¢æ6†÷"ç¢ÒÂ÷6—F–öã¢æ6†÷"Ò“²çWFFRƒ“²Bæ÷VåGb‚“°¢6öç7B÷VæVBÒBçGbæ—4÷VâÂ6÷VçBÒFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"6G6"×GbÖÖVçR'WGFöâ"’æÆVæwF‚ÂF—6&ÆVBÒFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"6G6"×GbÖÖVçR'WGFöã¦F—6&ÆVB"’æÆVæwFƒ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ6†ææVÂ"’æ6Æ–6²‚“°¢6öç7B6öærÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×6öær"’çFW‡D6öçFVçBÂVWVRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×VWVR"’çFW‡D6öçFVçBÂ†—7F÷'’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ†—7F÷'’"’çFW‡D6öçFVçC°¢6öç7B‡&VbÒFö7VÖVçBçVW'•6VÆV7F÷"‚"æG6"×Gb×&WVW7B"’æ‡&VbÂ"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×""’çv–GFƒ°¢&WGW&â²f$6Æ÷6VBÂ÷VæVBÂ6÷VçBÂF—6&ÆVBÂ6öærÂVWVRÂ†—7F÷'’Â‡&VbÂ"Âf6W3¢BæÆæBçGe67&VVâævVöÖWG'’æf6W2æÆVæwF‚Ó°¢Ò’‚–“°¢&V6÷&B‚&G6"Ec¢æV&'’÷BÖ–âÖVçRÂf—fR6†ææVÇ2æBÆ—fR7FF–öâ–æfò"Â&W7VÇBæf$6Æ÷6VBbb&W7VÇBæ÷VæVBbb&W7VÇBæ6÷VçBÓÓÒRbb&W7VÇBæF—6&ÆVBÓÓÒBbb&W7VÇBç6öærÓÓÒ%GW'FÆR&F–ò"bb&W7VÇBçVWVRæ–æ6ÇVFW2‚$&ææ&VG2"’bb&W7VÇBæ†—7F÷'’æ–æ6ÇVFW2‚$æVöâ&—fW""’bb&W7VÇBæf6W2âÂ¥4ôâç7G&–æv–g’‡&W7VÇB’“°¢–b‡&ö6W72æVçbäE4%ô4EU$RbbfÆÆ&6²’²v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×GbÖÖVçRçær"’“²v—B"ç6VæB‚$V×VÆF–öâç6WDFWf–6TÖWG&–74÷fW'&–FR"Â²v–GFƒ¢3“Â†V–v‡C¢ƒCBÂFWf–6U66ÆTf7F÷#¢ÂÖö&–ÆS¢G'VRÒ“²v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×Gb×†öæRçær"’“²v—B"ç6VæB‚$V×VÆF–öâæ6ÆV$FWf–6TÖWG&–74÷fW'&–FR"“²Ð¢&V6÷&B‚&G6"Ec¢6öær&WVW7G2W6RF†Röff–6–Â§V¶V&÷‚æBvVæW&FVB""Â&W7VÇBæ‡&VbÓÓÒ&‡GG3¢òöæöFW'VææW'7&F–òæ6öÒóö§V¶V&÷‚"bb&W7VÇBç"â“°¢v—B"æ¶W’‚$W66R"“°¢&V6÷&B‚&G6"Ec¢W66R6Æ÷6W2F†RFVÆWf—6–öâv—F†÷WBÆVf–ærF†R—6ÆæB"Âv—B"æWfÇVFR†õööövç66VæRÓÓÒ&G6""bbõööövæG6"çGbæ—4÷Væ’“°¢v—B"æ¶W’‚""“°¢&V6÷&B‚&G6"Ec¢76R÷Vç2F†RæV&'’EbF‡&÷Vv‚F†Ræ÷&ÖÂÆ–W"6öçG&öÇ2"Âv—B"æWfÇVFR†õööövæG6"çGbæ—4÷Væ’“°¢v—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ6Æ÷6R"’æ6Æ–6²‚–“°¢–b‡&ö6W72æVçbäE4%ô4EU$RbbfÆÆ&6²’²v—B"æWfÇVFR†õööövç–Æ÷Bææf–vFR‡²–s¢ÔÖF‚å’ò"Â—F6ƒ¢ãÂF—7C¢rÂF&vWC¢²ƒ¢BÂ“¢"ãRÂ£¢‚ÒÂ÷6—F–öã¢²ƒ¢‚Â“¢Â£¢‚ÒÒ“²õööövæGfæ6RƒãR–“²v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×Gb×v÷&ÆBçær"’“²Ð¢6öç7BföÇVÖRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BÒõööövæVF–òÂ&öBÒõööövæG6"æÆæBæ&öG5³Òç÷6—F–öã²6öç7B6÷W&6RÒõööövæG6"æÆæBæÆæFÖ&·2çGbçö–çB‚ÓãSRÂ2ã2Âãc2“²æVçf—&öæÖVçB‡²ââåõööövæ6ÖW&Â÷6—F–öã¢6÷W&6RÒÂ&öBÂRÂ6÷W&6R“²6öç7BæV"Òç&F–õföÇVÖS²æVçf—&öæÖVçB‡²ââåõööövæ6ÖW&Â÷6—F–öã¢²ƒ¢3RÂ“¢"Â£¢Ó#ÒÒÂ&öBÂRÂ6÷W&6R“²&WGW&â²æV"Âf#¢ç&F–õföÇVÖRÓ²Ò’‚–“°¢&V6÷&B‚&G6"Ec¢'&öF67B—2Æ÷VFW"æV&'’'WB&VÖ–ç2VF–&ÆR7&÷72F†R—6ÆæB"ÂföÇVÖRææV"âföÇVÖRæf"¢"bbföÇVÖRæf"ãÒãBÂ¥4ôâç7G&–æv–g’‡föÇVÖR’“°¢v—BG6$W†—B†"“°¢&V6÷&B‚&G6"Ec¢ÆVf–ær6Æ÷6W2æB6ÆV'2F†RÖVçR"Âv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb"’æ÷VâbbFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×VWVR"’æ6†–ÆG&VâæÆVæwF†’“°§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"&F–ò6öçG&öÇ2"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"&F–ò6öçG&öÇ2"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"æ¶W’‚'r"“²v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢&V6÷&B‚&G6"&F–ó¢7G&VÒ7F—2F—66öææV7FVB–âF†RGVææVÂ"Âv—B"æWfÇVFR†õöG6%&F–ôf—‡GW&RçÆ—2ÓÓÒ’“°¢v—B"æWfÇVFR†õööövæVF–òæ'&—fR‚–“°¢v—BVçF–ÅvR†"Ât"æVF–òç&F–õ7FGW2ç7F'G5v—F‚‚$Æ—fR"’r“°¢6öç7BÆ—fRÒv—B"æWfÇVFR†‡²W&Ã¢õöG6%&F–ôf—‡GW&RæVÆVÖVçBç7&2ÂföÇVÖS¢õöG6%&F–ôf—‡GW&RæVÆVÖVçBçföÇVÖRÂ×W6–3¢õööövæVF–òæ×W6–4Væ&ÆVBÂÖ&–VçC¢õööövæVF–òæÖ&–VçDVæ&ÆVBÒ–“°¢&V6÷&B‚&G6"&F–ó¢÷WFFö÷"Æ–&6²W6W2F†R7FF–öâÕ27G&VÒB&6¶w&÷VæBföÇVÖR"ÂÆ—fRçW&Âç7F'G5v—F‚‚&‡GG3¢ò÷7G&VÒææöFW'VææW'7&F–òæ6öÒ÷7G&VÓò"’bbÆ—fRçföÇVÖRÓÓÒãsRbbÆ—fRæ×W6–2bbÆ—fRæÖ&–VçBÂ¥4ôâç7G&–æv–g’†Æ—fR’“°¢6öç7B6öçG&öÇ2Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B6Æ–6²Ò†æÖR’ÓâFö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ"r²æÖR²r%Òr’æ6Æ–6²‚’ÂÒõööövæVF–ó°¢6Æ–6²‚&G6"Ö×W6–2"“²6öç7B×W6–4öfbÒæ×W6–4Væ&ÆVBbbæÖ&–VçDVæ&ÆVBbbõöG6%&F–ôf—‡GW&RæVÆVÖVçBç7&2ÓÓÒ"#°¢6Æ–6²‚&G6"ÖÖ&–VçB"“²6öç7BÖ&–VçDöfbÒæÖ&–VçDVæ&ÆVC°¢6Æ–6²‚&G6"Ö×W6–2"“²6öç7B×W6–4öæÇ’Òæ×W6–4Væ&ÆVBbbæÖ&–VçDVæ&ÆVC°¢6Æ–6²‚&G6"Ö×WFR"“²6öç7BÆÄ×WFVBÒæ×WFVBbbõöG6%&F–ôf—‡GW&RæVÆVÖVçBç7&2ÓÓÒ"#°¢6Æ–6²‚&G6"Ö×WFR"“²6öç7B&W7F÷&VBÒæ×WFVBbbæ×W6–4Væ&ÆVBbbæÖ&–VçDVæ&ÆVC°¢&WGW&â²×W6–4öfbÂÖ&–VçDöfbÂ×W6–4öæÇ’ÂÆÄ×WFVBÂ&W7F÷&VBÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"&F–ó¢6W&FR7v—F6†W2&W6W'fR&VfW&Væ6W2æBÖ7FW"×WFR7F÷2WfW'—F†–ær"Âö&¦V7BçfÇVW2†6öçG&öÇ2’æWfW'’„&ööÆVâ’Â¥4ôâç7G&–æv–g’†6öçG&öÇ2’“°¢v—B"æWfÇVFR†õöG6%&F–ôf—‡GW&RæVÆVÖVçBæöæW'&÷"‚–“°¢6öç7Bf–ÆVBÒv—B"æWfÇVFR†‡²7FGW3¢õööövæVF–òç&F–õ7FGW2Â6÷W&6S¢õöG6%&F–ôf—‡GW&RæVÆVÖVçBç7&2Â×W6–3¢õööövæVF–òæ×W6–4Væ&ÆVBÒ–“°¢&V6÷&B‚&G6"&F–ó¢Væf–Æ&ÆR7FF–öâ&W÷'G2â÷WFvRæB&VÆV6W2F†Rf–ÆVB7G&VÒ"Âf–ÆVBç7FGW2æ–æ6ÇVFW2‚&öffÆ–æR"’bbf–ÆVBç6÷W&6RÓÓÒ""bbf–ÆVBæ×W6–2Â¥4ôâç7G&–æv–g’†f–ÆVB’“°¢v—B"æ¶W’‚$W66R"“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢&V6÷&B‚&G6"&F–ó¢ÆVf–ær&VÆV6W2Æ–&6²æB—G2WfVçB†æFÆW'2"Âv—B"æWfÇVFR†õöG6%&F–ôf—‡GW&RæVÆVÖVçBç7&2ÓÓÒ""bbõöG6%&F–ôf—‡GW&RæVÆVÖVçBæöæW'&÷"ÓÓÒçVÆÂbbõöG6%&F–ôf—‡GW&RæVÆVÖVçBæöçÆ––ærÓÓÒçVÆÆ’“°§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"WFöÖF–2fVVG2"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"WFöÖF–2fVVG2"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢&V6÷&B‚&G6"WFöÖF–2fVVG3¢G&ç6—B†2æò6Æ–VçB÷"öÆÆ–ær"Âv—B"æWfÇVFR†õööövæG6"æFFbbõöG6$fVVDf—‡GW&Rç&WVW7G2ÓÓÒbbõöG6$fVVDf—‡GW&Rç6ö6¶WG2ÓÓÒ’“°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B2Ò$Âæ6†–âÂ7V'67&–&RÒ2ç7V'67&–&RÂ7F'BÒ2ç7F'BÂF—7÷6RÒ2æF—7÷6S°¢v–æF÷råõ÷6†&VD÷væW'6†—Ò²7F—fS¢ÂF÷FÃ¢Â7F'G3¢ÂF—7÷6W3¢Ó°¢2ç7V'67&–&RÒfâÓâ²6öç7BG6"ÒfâÓÓÒõööövæG6#òæFFòç&Vg&W6ƒ²–b†G6"’²õ÷6†&VD÷væW'6†—æ7F—fR²³²õ÷6†&VD÷væW'6†—çF÷FÂ²³²Ò6öç7BöfbÒ7V'67&–&R†fâ“²ÆWBFöæRÒfÇ6S²&WGW&â‚’Óâ²–b‚FöæR’²FöæRÒG'VS²–b†G6"’õ÷6†&VD÷væW'6†—æ7F—fRÒÓ²öfb‚“²ÒÓ²Ó°¢2ç7F'BÒ‚ââæ&w2’Óâ²õ÷6†&VD÷væW'6†—ç7F'G2²³²&WGW&â7F'B‚ââæ&w2“²Ó°¢2æF—7÷6RÒ‚ââæ&w2’Óâ²õ÷6†&VD÷væW'6†—æF—7÷6W2²³²&WGW&âF—7÷6R‚ââæ&w2“²Ó°¢6öç7Bæ÷rÒFFRææ÷r‚“²ö&¦V7Bæ76–vâ†2ç6æ6†÷BÂ²g6—¦S¢#Âf7FW7DfVS¢‚ÂæW‡DfVS¢““’Â†V–v‡C¢“Â&–6UW6C¢cCÂ&–6U6÷W&6S¢&f—‡GW&R"Â&6¶ÆötC¢æ÷rÂfVW4C¢æ÷rÂ†V–v‡DC¢æ÷rÂ&–6TC¢æ÷rÒ“°¢Ò’‚–“°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢'&VGV6R"ÕÒÒ“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²$Âç66VæW2æG6"çWFFR…õööövæVF–òæGW&F–öâ²Â“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“¶“°¢6öç7B–æ—F–ÂÒv—B"æWfÇVFR†‡²Æ—fS¢õööövæG6"æFFç7FFRæÆ—fRÂ&–6S¢õööövæG6"æFFç7FFRç&–6U7FGW2Â6·“¢õööövæG6"æFFç7FFRç6·•7FGW2Â&WVW7G3¢õöG6$fVVDf—‡GW&Rç&WVW7G2Â6ö6¶WG3¢õöG6$fVVDf—‡GW&Rç6ö6¶WG2Â&W76VC¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"ÖÆ—fR"’ævWDGG&–'WFR‚&&–×&W76VB"’Ò–“°¢&V6÷&B‚&G6"WFöÖF–2fVVG3¢ÆæB'&—fÂ&VG26†&VBFFæBfWF6†W2öæÇ’Ö–çWFR†—7F÷'’"Â–æ—F–ÂæÆ—fRbb–æ—F–Âç&–6Rç7F'G5v—F‚‚$Æ—fR"’bb–æ—F–Âç6·’ç7F'G5v—F‚‚$Æ—fR"’bb–æ—F–Âç&WVW7G2ÓÓÒbb–æ—F–Âç6ö6¶WG2ÓÓÒbb–æ—F–Âç&W76VBÓÓÒ'G'VR"Â¥4ôâç7G&–æv–g’†–æ—F–Â’“°¢v—B"æWfÇVFR†õööövævò‚&‡V""–“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢&V6÷&B‚&G6"WFöÖF–2fVVG3¢W†—B&VÖ÷fW2öæÇ’F†RE4"7V'67&—F–öâ"Âv—B"æWfÇVFR†õ÷6†&VD÷væW'6†—æ7F—fRÓÓÒbbõ÷6†&VD÷væW'6†—ç7F'G2ÓÓÒbbõ÷6†&VD÷væW'6†—æF—7÷6W2ÓÓÒbbõöG6$fVVDf—‡GW&Rç6ö6¶WG2ÓÓÒ’“°¢v—B"æWfÇVFR†õööövævò‚&G6""–“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÂS“°¢&V6÷&B‚&G6"WFöÖF–2fVVG3¢&WGW&æ–ærG&ç6—B7F–ÆÂ†2æò7V'67&–&W""Âv—B"æWfÇVFR†õ÷6†&VD÷væW'6†—æ7F—fRÓÓÒbbõööövæG6"æFFbbõöG6$fVVDf—‡GW&Rç&WVW7G2ÓÓÒ’“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²$Âç66VæW2æG6"çWFFR…õööövæVF–òæGW&F–öâ²Â“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“¶“°¢&V6÷&B‚&G6"WFöÖF–2fVVG3¢æ÷F†W"ÆæBf—6—BFG2W†7FÇ’öæRÆ—7FVæW"æBöæR†—7F÷'’&WVW7B"Âv—B"æWfÇVFR†õ÷6†&VD÷væW'6†—æ7F—fRÓÓÒbbõ÷6†&VD÷væW'6†—çF÷FÂÓÓÒ"bbõöG6$fVVDf—‡GW&Rç&WVW7G2ÓÓÒ"bbõöG6$fVVDf—‡GW&Rç6ö6¶WG2ÓÓÒ’“°¢v—B"æWfÇVFR†õööövævò‚&‡V""–“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢&V6÷&B‚&G6"WFöÖF–2fVVG3¢6†&VB6†–â7F–ÆÂFVÆ—fW'2gFW"&÷F‚E4"W†—G2"Âv—B"æWfÇVFR††7–æ2‚’Óâ²ÆWBFVÆ—fW&VBÒ²6öç7BöfbÒ$Âæ6†–âç7V'67&–&R‚‚’ÓâFVÆ—fW&VB²²“²$Âæ6†–âæ–ævW7B‡²G—S¢&fVW2"ÂæW‡DfVS¢"Ò“²v—BæWr&öÖ—6R‡&W6öÇfRÓâ6WEF–ÖV÷WB‡&W6öÇfRÂ’“²öfb‚“²&WGW&âFVÆ—fW&VBÓÓÒbbõ÷6†&VD÷væW'6†—æ7F—fRÓÓÒbbõ÷6†&VD÷væW'6†—ç7F'G2ÓÓÒbbõ÷6†&VD÷væW'6†—æF—7÷6W2ÓÓÒ²Ò’‚–’“°§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"fVVG2æBVF–ò"ÂW&Ã¢‡V%vR‡7&2Â'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"fVVG2æBVF–ò"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢6öç7BfVVBÒv—B"æWfÇVFR††7–æ2‚’Óâ°¢6öç7BfWF6„÷&–v–æÂÒv–æF÷ræfWF6‚Â÷&–v–æÄ6†–âÒ$Âæ6†–ã²ÆWB6ö6¶WG2ÒÂ7F÷VBÒÂÆ—7FVæW#°¢6öç7B6ö6¶WD÷&–v–æÂÒv–æF÷råvV%6ö6¶WBÂæ÷rÒFFRææ÷r‚“°¢v–æF÷råvV%6ö6¶WBÒ6Æ72²6öç7G'V7F÷"‚’²6ö6¶WG2²³²ÒÓ°¢$Âæ6†–âÒ²6æ6†÷C¢²g6—¦S¢#Âf7FW7DfVS¢‚Â†V–v‡C¢“Â&–6UW6C¢rÂ&6¶ÆötC¢æ÷rÂfVW4C¢æ÷rÂ†V–v‡DC¢æ÷rÂ&–6TC¢æ÷rÒÂ7V'67&–&R†fâ’²Æ—7FVæW"Òfã²&WGW&â‚’Óâ²7F÷VB²³²Æ—7FVæW"ÒçVÆÃ²Ó²ÒÓ°¢6öç7B&÷w2Òµ³#Â“‚ÂRÂÂ5ÒÂ³cÂ“RÂBÂ“’ÂÕÓ°¢v–æF÷ræfWF6‚Ò7–æ2‚’Óâ‡²ö³¢G'VRÂ§6öã¢7–æ2‚’Óâ&÷w2Ò“°¢6öç7BBÒ$ÂæG6$FFæ7&VFR‚“°¢G'’°¢v—BBç7F'B‚“°¢6öç7B6öææV7FVBÒ²&–6S¢Bç7FFRç&–6RÂ†V–v‡C¢Bç7FFRæ†V–v‡BÂ&6¶Æös¢Bç7FFRæ&6¶ÆörÂ7FGW3¢Bç7FFRç&–6U7FGW2Ó°¢Bç7F÷‚“²6öç7BöfbÒBç7FFRæÆ—fRbbÆ—7FVæW#°¢ÆWBf–æ—6ƒ²v–æF÷ræfWF6‚Ò‚’ÓâæWr&öÖ—6R‡&W6öÇfRÓâ²f–æ—6‚Ò&W6öÇfS²Ò“°¢6öç7Bv—F–ærÒBç7F'B‚“²BæF—7÷6R‚“²f–æ—6‚‡²ö³¢G'VRÂ§6öã¢7–æ2‚’Óâ&÷w2Ò“²v—Bv—F–æs°¢&WGW&â²6öææV7FVBÂöfbÂ6ö6¶WG2Â7F÷VBÓ°¢Òf–æÆÇ’²BæF—7÷6R‚“²v–æF÷ræfWF6‚ÒfWF6„÷&–v–æÃ²v–æF÷råvV%6ö6¶WBÒ6ö6¶WD÷&–v–æÃ²$Âæ6†–âÒ÷&–v–æÄ6†–ã²Ð¢Ò’‚–“°¢&V6÷&B‚&G6"fVVG3¢6†&VB&VF–æw2G&—fRF†Rv÷&ÆBæBW†—B6æ6VÇ2ÆFR†—7F÷'’"ÂfVVBæ6öææV7FVBç&–6RÓÓÒrbbfVVBæ6öææV7FVBæ†V–v‡BÓÓÒ“bbfVVBæ6öææV7FVBæ&6¶ÆörÓÓÒã"bbfVVBæ6öææV7FVBç7FGW2ç7F'G5v—F‚‚$Æ—fR"’bbfVVBæöfbbbfVVBç6ö6¶WG2ÓÓÒbbfVVBç7F÷VBÓÓÒ"Â¥4ôâç7G&–æv–g’†fVVB’“°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B÷&–v–æÂÒVF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT'VffW%6÷W&6S°¢v–æF÷råõöG6%6÷VæE&ö&RÒ²÷&–v–æÂÂ7F'G3¢µÒÂÆö÷3¢µÒÂ6öçFW‡C¢çVÆÂÓ°¢VF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT'VffW%6÷W&6RÒgVæ7F–öâ‚’°¢6öç7B6÷W&6RÒ÷&–v–æÂæ6ÆÂ‡F†—2’Â7F'BÒ6÷W&6Rç7F'Bæ&–æB‡6÷W&6R’Â7G‚ÒF†—3°¢v–æF÷råõöG6%6÷VæE&ö&Ræ6öçFW‡BÒ7Gƒ°¢6÷W&6Rç7F'BÒ‚ââæ&w2’Óâ²–b‚6÷W&6RæÆö÷’v–æF÷råõöG6%6÷VæE&ö&Rç7F'G2çW6‚‡²C¢7G‚æ7W'&VçEF–ÖRÂGW&F–öã¢6÷W&6Ræ'VffW"æGW&F–öâÒ“²VÇ6Rv–æF÷råõöG6%6÷VæE&ö&RæÆö÷2çW6‚‡6÷W&6Ræ'VffW"æGW&F–öâ“²7F'B‚ââæ&w2“²Ó°¢&WGW&â6÷W&6S°¢Ó°¢Ò’‚–“°¢G'’°¢v—B"æ¶W’‚&Ò"“°¢v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢6öç7Bf—†VBÒv—B"æWfÇVFR†‡²WÆöG3¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚%¶FFÖG6"ÖVF–õÒ"’æÆVæwF‚Â6å&WÆ6S¢G—VöbõööövæVF–òæÆöBÓÓÒ&gVæ7F–öâ"Ò–“°¢&V6÷&B‚&G6"VçG&æ6S¢f—†VB7WÆ–VB6÷VæG2"Âf—†VBçWÆöG2ÓÓÒbbf—†VBæ6å&WÆ6RÂ¥4ôâç7G&–æv–g’†f—†VB’“°¢6öç7B7WÆ–VBÒv—B"æWfÇVFR†‡²GW&F–öç3¢õööövæVF–òæGW&F–öç2Â76vS¢õööövæVF–òæGW&F–öâÂf–ÇW&S¢õööövæVF–òæf–ÇW&RÒ–“°¢&V6÷&B‚&G6"VF–ó¢ÆÂf÷W"7WÆ–VBÕ72FV6öFRæBFWFW&Ö–æRF†R76vRÆVæwF‚"Â7WÆ–VBæGW&F–öç2æÆVæwF‚ÓÓÒBbb7WÆ–VBæGW&F–öç2æWfW'’‚†B’ÓâBâbbBÂc’bb7WÆ–VBç76vRãÒ7WÆ–VBæGW&F–öç2ç&VGV6R‚‡7VÒÂB’Óâ7VÒ²BÂ’²bã“’bb7WÆ–VBæf–ÇW&RÂ¥4ôâç7G&–æv–g’‡7WÆ–VB’“°¢6öç7B×W6–2Òv—B"æWfÇVFR†‡²GW&F–öã¢õööövæVF–òæ×W6–4GW&F–öâÂÆö÷3¢õöG6%6÷VæE&ö&RæÆö÷2æf–ÇFW"‚†GW&F–öâ’ÓâGW&F–öââ3’ÂÆWfVÇ3¢õööövæVF–òæÆWfVÇ2Ò–“°¢&V6÷&B‚&G6"×W6–3¢7WÆ–VBG&6²FV6öFW2–çFòöæRV–WBÆö÷&VæVF‚gVÆÂÖÆWfVÂ7VV6‚"Â×W6–2æGW&F–öââ3bb×W6–2æÆö÷2æÆVæwF‚ÓÓÒbb×W6–2æÆö÷5³ÒÓÓÒ×W6–2æGW&F–öâbb×W6–2æÆWfVÇ2æ×W6–2ÃÒãbb×W6–2æÆWfVÇ2ç7VV6‚ÓÓÒÂ¥4ôâç7G&–æv–g’†×W6–2’“°¢v—B"æ¶W’‚&Ò"“°¢6öç7Bfö÷G7FW2Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7BÒõööövæVF–òÂ&Vf÷&RÒæÆWfVÇ2ç7FW3°¢çWFFRƒÂÂG'VR“²6öç7BvÆ¶–ærÒæÆWfVÇ2ç7FW3°¢çWFFRƒÂÂfÇ6R“²6öç7B7F÷VBÒæÆWfVÇ2ç7FW3°¢çWFFRƒÂ"ÂG'VR“²6öç7B&W7VÖVBÒæÆWfVÇ2ç7FW3°¢çFövvÆR‚“²çWFFRƒÂ2ÂG'VR“²6öç7B×WFVBÒæÆWfVÇ2ç7FW3²çFövvÆR‚“°¢&WGW&â²&Vf÷&RÂvÆ¶–ærÂ7F÷VBÂ&W7VÖVBÂ×WFVBÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"fö÷G7FW3¢ööÆVB7FW2föÆÆ÷rÖ÷fVÖVçBÂ7F÷B&W7BæBö&W’×WFR"Âfö÷G7FW2çvÆ¶–ærÓÓÒfö÷G7FW2æ&Vf÷&R²bbfö÷G7FW2ç7F÷VBÓÓÒfö÷G7FW2çvÆ¶–ærbbfö÷G7FW2ç&W7VÖVBÓÓÒfö÷G7FW2çvÆ¶–ær²bbfö÷G7FW2æ×WFVBÓÓÒfö÷G7FW2ç&W7VÖVBÂ¥4ôâç7G&–æv–g’†fö÷G7FW2’“°¢v—B"æWfÇVFR†õööövæVF–òçWFFRƒã’Â–“°¢v—BVçF–ÅvR†"Ât"æVF–òçVæF–ærbb"æVF–òæÆWfVÇ2æ×W6–2Âã’rÂS“°¢6öç7BGV6¶VBÒv—B"æWfÇVFR†õööövæVF–òæÆWfVÇ6“°¢&V6÷&B‚&G6"×W6–3¢7VV6‚GV6·2F†R6÷VæGG&6²v—F†÷WB&VGV6–ærfö–6Rv–â"ÂGV6¶VBæ×W6–2Âã’bbGV6¶VBç7VV6‚ÓÓÒÂ¥4ôâç7G&–æv–g’†GV6¶VB’“°¢v—BVçF–ÅvR†"Âwv–æF÷råõöG6%6÷VæE&ö&Rç7F'G2æÆVæwF‚ÓÓÒBbb"æVF–òçVæF–ærrÂC“°¢6öç7B6÷VæBÒv—B"æWfÇVFR†‚‚’Óâ²õööövæVF–òçWFFRƒÂ"“²õööövæVF–òçWFFRƒÂ2“²&WGW&â²7F'G3¢õöG6%6÷VæE&ö&Rç7F'G2Âf—&VC¢õööövæG6"æf—&VBÓ²Ò’‚–“°¢&V6÷&B‚&G6"VF–ó¢f÷W"7WÆ–VB6Æ—2Æ’6WVVçF–ÆÇ’öæ6RFW7—FR&WfW'6–ær"Â6÷VæBç7F'G2æÆVæwF‚ÓÓÒBbb6÷VæBæf—&VBæWfW'’‚†b’ÓâbÓÓÒ’bb6÷VæBç7F'G2æWfW'’‚‡2Â’Â’Óâ’ÇÂ2æBãÒ¶’ÒÒæB²¶’ÒÒæGW&F–öâÒã’Â¥4ôâç7G&–æv–g’‡6÷VæB’“°¢v—B"æ¶W’‚$W66R"“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢&V6÷&B‚&G6"VF–ó¢ÆVf–ær6Æ÷6W2—G2VF–ò6öçFW‡B"Âv—B"æWfÇVFR†õöG6%6÷VæE&ö&Ræ6öçFW‡Bç7FFRÓÓÒ&6Æ÷6VB&’“°¢Òf–æÆÇ’²v—B"æWfÇVFR†VF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT'VffW%6÷W&6RÒõöG6%6÷VæE&ö&Ræ÷&–v–æÃ²FVÆWFRv–æF÷råõöG6%6÷VæE&ö&S¶“²Ð§ÒÕÒÒ“°§66VæR‚&G6""Â²Æ&VÃ¢&G6"'&—fÂ6ÖW&"ÂW&Ã¢‡V%vR‡7&2Â'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"'&—fÂ6ÖW&"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢&æò×&VfW&Væ6R"ÕÒÒ“°¢v—B"æ¶W’‚'r"“²v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'r"Ò“°¢v—B"æWfÇVFR†õööövæGfæ6Rƒ"ãbÂòc–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Ò“°¢6öç7BÆVgBÒv—B"æWfÇVFR†‡²7VS¢õööövæVF–òæ7VRÂvÆæ6S¢õööövæG6"ævÆæ6RÂ&V†–æC¢õööövæ6ÖW&ç÷6—F–öâç¢ÒõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢Ò–“°¢–b‡&ö6W72æVçbäE4%ô4EU$R’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×76vRçær"’“°¢v—BVçF–ÅvR†"Â""æVF–òçVæF–ær"Â#“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'r"Ò“°¢v—B"æWfÇVFR†õööövæGfæ6Rƒ‚ãrÂòc–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Ò“°¢6öç7B&–v‡BÒv—B"æWfÇVFR†‡²7VS¢õööövæVF–òæ7VRÂvÆæ6S¢õööövæG6"ævÆæ6RÒ–“°¢&V6÷&B‚&G6"76vR6ÖW&¢&VÂfö–6R7F'G2ÇFW&æFRvVçFÆRvÆæ6W2v†–ÆR7F––ær&V†–æBF†Rööv"ÂÆVgBæ7VRÓÓÒbbÆVgBævÆæ6RÂÓã2bbÆVgBæ&V†–æBâ2ã’bb&–v‡Bæ7VRÓÓÒbb&–v‡BævÆæ6Râã2bbÖF‚æ'2†ÆVgBævÆæ6R’ÃÒãbbbÖF‚æ'2‡&–v‡BævÆæ6R’ÃÒãbÂ¥4ôâç7G&–æv–g’‡²ÆVgBÂ&–v‡BÒ’“°¢v—B"æ¶W’‚&Ò"“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'r"Ò“°¢v—B"æWfÇVFR†õööövæGfæ6R…õööövæVF–òæGW&F–öâ¢ƒÒõööövæG6"ç&öw&W72’²ãÂò3–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Ò“°¢v—BVçF–ÅvR†"Â$"æVF–òæÆWfVÇ2æ×W6–2Âã"Â3“°¢v—B"æWfÇVFR†õööövæGfæ6R„ÖF‚æÖ‚ƒÂ"ãRÒõööövæG6"æ'&—fÅF–ÖR’Âòc–“°¢–b‡&ö6W72æVçbäE4%ô4EU$R’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"Ö'&—fÂÖ&÷fRçær"’“°¢v—B"æWfÇVFR†õööövæGfæ6R„ÖF‚æÖ‚ƒÂbãRÒõööövæG6"æ'&—fÅF–ÖR’Âòc–“°¢6öç7BÆ–gFVBÒv—B"æWfÇVFR†‡²†6S¢õööövæG6"ç†6RÂ×W6–3¢õööövæVF–òæÆWfVÇ2æ×W6–2Â“¢õööövæ6ÖW&ç÷6—F–öâç’Ò–“°¢–b‡&ö6W72æVçbäE4%ô4EU$R’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"Ö'&—fÂÖ&VÆ÷rçær"’“°¢&V6÷&B‚&G6"'&—fÂVF–ó¢GVææVÂ×W6–2fFW2÷WBf÷"F†R÷WFFö÷"&F–ò"ÂÆ–gFVBç†6RÓÓÒ&'&—fÂ"bbÆ–gFVBæ×W6–2ÂãbbÆ–gFVBç’ÂÓ#RÂ¥4ôâç7G&–æv–g’†Æ–gFVB’“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ&G6"×6¶—%Òr’æ6Æ–6²‚“²õööövæGfæ6Rƒ–“°¢6öç7B†æFöfbÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒõööövÂ&Vf÷&RÒ²ââä"æ6ÖW&ç÷6—F–öâÓ²"æGfæ6Rƒ“²&WGW&â²†6S¢"æG6"ç†6RÂG&–gC¢ÖF‚æ‡—÷B„"æ6ÖW&ç÷6—F–öâç‚Ò&Vf÷&Rç‚Â"æ6ÖW&ç÷6—F–öâç’Ò&Vf÷&Rç’Â"æ6ÖW&ç÷6—F–öâç¢Ò&Vf÷&Rç¢’Â†–FFVã¢Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"Ö'&—fÂ"’ÂÖöFS¢"ç–Æ÷BæÖöFRÓ²Ò’‚–“°¢&V6÷&B‚&G6"'&—fÂ6ÖW&¢6¶—6WGFÆW2–çFòF†RFVfVÇB6†÷VÆFW"f–Wrv—F†÷WB&W6–GVÂWFöÖF–2Ö÷F–öâ"Â†æFöfbç†6RÓÓÒ&ÆæB"bb†æFöfbæÖöFRÓÓÒ'6†÷VÆFW""bb†æFöfbæG&–gBÂãbb†æFöfbæ†–FFVâÂ¥4ôâç7G&–æv–g’††æFöfb’“°§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"Ö&–Væ6R"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â7FW3¢·²æÖS¢&G6"Ö&–Væ6R"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B'VffW"ÒVF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT'VffW%6÷W&6RÂ÷66–ÆÆF÷"ÒVF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT÷66–ÆÆF÷#°¢6öç7B&ö&RÒv–æF÷råõöÖ&–VçE&ö&RÒ²'VffW"Â÷66–ÆÆF÷"Â7&VFVC¢Â7F÷VC¢Â6öçFW‡C¢çVÆÂÓ°¢f÷"†6öç7BæÖRöb²&7&VFT'VffW%6÷W&6R"Â&7&VFT÷66–ÆÆF÷"%Ò’°¢6öç7B÷&–v–æÂÒæÖRÓÓÒ&7&VFT'VffW%6÷W&6R"ò'VffW"¢÷66–ÆÆF÷#°¢VF–ô6öçFW‡Bç&÷F÷G—U¶æÖUÒÒgVæ7F–öâ‚’²6öç7B6÷W&6RÒ÷&–v–æÂæ6ÆÂ‡F†—2’Â7F÷Ò6÷W&6Rç7F÷æ&–æB‡6÷W&6R“²&ö&Ræ6öçFW‡BÒF†—3²&ö&Ræ7&VFVB²³²6÷W&6Rç7F÷Ò‚ââæ&w2’Óâ²&ö&Rç7F÷VB²³²&WGW&â7F÷‚ââæ&w2“²Ó²&WGW&â6÷W&6S²Ó°¢Ð¢Ò’‚–“°¢G'’°¢v—B"æ¶W’‚'r"“²v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢6öç7BGVææVÂÒv—B"æWfÇVFR†õööövæVF–òæÖ&–Væ6V“°¢&V6÷&B‚&G6"Ö&–Væ6S¢÷WFFö÷"w&‚—2æ÷B6öç7G'V7FVBGW&–ærVçG&æ6R"ÂGVææVÂÓÓÒçVÆÂÂ¥4ôâç7G&–æv–g’‡GVææVÂ’“°¢6öç7B7F–ÂÒv—B"æWfÇVFR†‚‚’Óâ°¢6öç7BÒõööövæVF–òÂ6ÖW&Ò²÷6—F–öã¢²ƒ¢Â“¢ãrÂ£¢ÒÂF&vWC¢²ƒ¢Â“¢ãrÂ£¢ÓÒÒÂ&öBÒ²ƒ¢Â“¢Â£¢CÓ°¢æ'&—fR‚“²æVçf—&öæÖVçB†6ÖW&Â&öB“²6öç7B6VçFW"ÒæÖ&–Væ6S°¢6ÖW&ç÷6—F–öâç¢Ò3“²6ÖW&çF&vWBç¢Ò3ƒ²æVçf—&öæÖVçB†6ÖW&Â&öB“²6öç7B&—fW"ÒæÖ&–Væ6S°¢6ÖW&ç÷6—F–öâç¢ÒCC²6ÖW&ç÷6—F–öâç’ÒÓS²æVçf—&öæÖVçB†6ÖW&Â&öB“²6öç7BfÆÇ2ÒæÖ&–Væ6S°¢6ÖW&ç÷6—F–öâç‚ÒÓƒ²6ÖW&ç÷6—F–öâç¢ÒÓ“²6ÖW&ç÷6—F–öâç’Ò²æVçf—&öæÖVçB†6ÖW&Â&öB“²6öç7B7FvRÒæÖ&–Væ6S°¢6öç7B7&VFVBÒõöÖ&–VçE&ö&Ræ7&VFVC°¢f÷"†ÆWB’Ò²’ÂS²’²²’æVçf—&öæÖVçB†6ÖW&Â&öB“°¢&WGW&â²6VçFW"Â&—fW"ÂfÆÇ2Â7FvRÂ7&VFVBÂgFW#¢õöÖ&–VçE&ö&Ræ7&VFVBÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"Ö&–Væ6S¢vFW"föÆÆ÷w2F†R&—fW"ÂvFW&fÆÂVFvW2ÂÖ÷f–ær&öBæB7FvR"Â7F–Âç&—fW"ç&—fW"â7F–Âæ6VçFW"ç&—fW"¢2bb7F–ÂæfÆÇ2çvFW&fÆÂâ7F–Âæ6VçFW"çvFW&fÆÂ¢2bb7F–Âç&—fW"æÖ÷F÷"â7F–Âæ6VçFW"æÖ÷F÷"¢Bbb7F–Âç7FvRæ7&÷vBâ7F–Âæ6VçFW"æ7&÷vB¢2bb7F–Âæ6VçFW"çv–ÆFÆ–fRâbb7F–Âæ6VçFW"æ6ÆÇ2âÂ¥4ôâç7G&–æv–g’‡7F–Â’“°¢&V6÷&B‚&G6"Ö&–Væ6S¢&WVFVBWFFW2&WW6Rf—†VB6÷W&6Rw&‚"Â7F–Âæ7&VFVBÓÓÒ7F–ÂægFW"bb7F–Âç7FvRç6÷W&6W2ÓÓÒBÂ¥4ôâç7G&–æv–g’‡²&Vf÷&S¢7F–Âæ7&VFVBÂgFW#¢7F–ÂægFW"Ò’“°¢v—B"æWfÇVFR†õööövæVF–òæVçf—&öæÖVçB‡²÷6—F–öã¢²ƒ¢Â“¢Â£¢ÒÂF&vWC¢²ƒ¢Â“¢Â£¢ÓÒÒÂ²ƒ¢Ó#Â“¢Â£¢Ò–“°¢v—BVçF–ÅvR†"Ât"æVF–òæÖ&–Væ6RæÖ÷F÷%âÂÓãrrÂ3“°¢v—B"æWfÇVFR†õööövæVF–òæVçf—&öæÖVçB‡²÷6—F–öã¢²ƒ¢Â“¢Â£¢ÒÂF&vWC¢²ƒ¢Â“¢Â£¢ÓÒÒÂ²ƒ¢#Â“¢Â£¢Ò–“°¢v—BVçF–ÅvR†"Ât"æVF–òæÖ&–Væ6RæÖ÷F÷%ââãrrÂ3“°¢&V6÷&B‚&G6"Ö&–Væ6S¢&öBÖ÷F÷"7&÷76W2F†R7FW&Vòf–VÆBv—F‚—G2v÷&ÆB÷6—F–öâ"ÂG'VR“°¢v—B"æ¶W’‚&Ò"“°¢v—B"æWfÇVFR†õööövæVF–òæVçf—&öæÖVçB…õööövæ6ÖW&Â²ƒ¢Ó#Â“¢Â£¢Ò–“°¢v—BVçF–ÅvR†"Âr"æVF–òæÖ&–Væ6RæVæ&ÆVBbb"æVF–òæÖ&–Væ6Ræv–âÂãrÂC“°¢&V6÷&B‚&G6"Ö&–Væ6S¢×WFR6–ÆVæ6W2ÆÂ÷WFFö÷"Æ–W'2"ÂG'VR“°¢v—B"æ¶W’‚$W66R"“²v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢6öç7B6ÆVçWÒv—B"æWfÇVFR†‡²7&VFVC¢õöÖ&–VçE&ö&Ræ7&VFVBÂ7F÷VC¢õöÖ&–VçE&ö&Rç7F÷VBÂ7FFS¢õöÖ&–VçE&ö&Ræ6öçFW‡Bç7FFRÒ–“°¢&V6÷&B‚&G6"Ö&–Væ6S¢ÆVf–ær7F÷2WfW'’6÷W&6RæB6Æ÷6W2F†RVF–ò6öçFW‡B"Â6ÆVçWæ7&VFVBÓÓÒ6ÆVçWç7F÷VBbb6ÆVçWç7FFRÓÓÒ&6Æ÷6VB"Â¥4ôâç7G&–æv–g’†6ÆVçW’“°¢Òf–æÆÇ’²v—B"æWfÇVFR†VF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT'VffW%6÷W&6RÒõöÖ&–VçE&ö&Ræ'VffW#²VF–ô6öçFW‡Bç&÷F÷G—Ræ7&VFT÷66–ÆÆF÷"ÒõöÖ&–VçE&ö&Ræ÷66–ÆÆF÷#²FVÆWFRv–æF÷råõöÖ&–VçE&ö&S¶“²Ð§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"6†&VBÆ–W""ÂW&Ã¢‡V%vR†F—7B’Â7FW3¢·²æÖS¢&G6"6†&VBÆ–W""Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢'&VGV6R"ÕÒÒ“°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ2Ò"æ6fVÖVâævWB‚''VÆW2×v—F†÷WB×'VÆW'2"“°¢2æ÷fW'&–FRÒ'v÷&¶–ær#²"æ7&Wrç&Vg&W6…7FFW2‡G'VR“²"ç–Æ÷Bç÷76W72†2“°¢"æ7&Wræ6öæf–wW&UvVöâ†2Â"Âr“²"æ7&Wræ6öÆÆV7DÖv¦–æR†2“²2çvVöâç7&TÖÖõ³ÒÒ°¢v–æF÷råõö‡V$ÖÖòÒ²ÖÖó¢2çvVöâæÖÖòÂ7&S¢2çvVöâç7&TÖÖòæ¦ö–â‚’ÂÆWfVÃ¢"æÆWfVÂÓ° ¢Ò’‚–“°¢v—BG6$VçFW"†"“°¢ÆWBVçG'•F–ÖV÷WC°¢6öç7BVçFW&VBÒv—B&öÖ—6Rç&6R…·VçF–ÅvR†"Ât"ç66VæRÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÂS’ÂæWr&öÖ—6R‚…òÂ&V¦V7B’Óâ²VçG'•F–ÖV÷WBÒ6WEF–ÖV÷WB‚‚’Óâ&V¦V7B„W'&÷"‚$E4"VçG'“¢"²"æÆöw2æ¦ö–â‚"Â"’’’Âƒ“²Ò•Ò’æf–æÆÇ’‚‚’Óâ6ÆV%F–ÖV÷WB†VçG'•F–ÖV÷WB’“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Â6öFS¢$¶W•r"Ò“°¢–b‚VçFW&VB’F‡&÷rW'&÷"‚$E4"VçG'’f–ÆVB"“°¢v—B"æ¶W’‚&Ò"“²v—BVçF–ÅvR†"Ât"æVF–òç&VG’rÂ“°¢v—B"æWfÇVFR†v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²õööövæGfæ6R…õööövæVF–òæGW&F–öâ²"Âã“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“¶“°¢–b‚v—BVçF–ÅvR†"Ât"æG6"ç†6RÓÓÒ&ÆæB"rÂS’’F‡&÷rW'&÷"‚$E4"76vRF–Bæ÷Bf–æ—6‚"“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢6æöæ–6Â6VÆV7FVB7F÷"—2÷76W76VBv—F‚–æFWVæFVçBÖ×Væ—F–öâ"Âv—B"æWfÇVFR†õööövæG6"ç†6RÓÓÒ&ÆæB"bbõööövç–Æ÷BçÆ–W"ÓÓÒõööövæG6"æfF"bbõööövç–Æ÷BçÆ–W"çG&—G2ææÖRÓÓÒ''VÆW2×v—F†÷WB×'VÆW'2"bbõööövç–Æ÷BçÆ–W"çvVöâæÖÖòÓÓÒ$Âæ7&WräÔÔõôÔ‚bbõööövç–Æ÷BçÆ–W"æ†VD÷VâÓÓÒ$ÂæÖöFVÇ2æ6fVÖâ„$Âæ6öçG&–'WF÷'2çG&—G4f÷"‚''VÆW2×v—F†÷WB×'VÆW'2"’’æ†VD÷Væ’“°¢6öç7BÖ÷fRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B2Òõööövç–Æ÷BçÆ–W"Â¢Ò2ç&ö÷Bç÷6—F–öâç£²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W–F÷vâ"Â²¶W“¢'r"Ò’“²õööövæGfæ6Rƒã2“²v–æF÷ræF—7F6„WfVçB†æWr¶W–&ö&DWfVçB‚&¶W—W"Â²¶W“¢'r"Ò’“²&WGW&âÖF‚æ'2†2ç&ö÷Bç÷6—F–öâç¢Ò¢“²Ò’‚–“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢6†&VBvÆ¶–ærÖ÷fW2F†R7F÷""ÂÖ÷fRâã"Â7G&–ær†Ö÷fR’“°¢v—B"æ¶W’‚#""“²v—B"æWfÇVFR‚%õööövç–Æ÷BæVçFW$6Æ÷6R‡G'VR“²õööövæGfæ6RƒãB’"“²v—B"æ¶W’‚'b"“°¢6öç7Bf—&VBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B2Òõööövç–Æ÷BçÆ–W#²õööövæGfæ6Rƒã"“²&WGW&â²WV—VC¢2çvVöâæWV—VBÂ6†÷G3¢2çvVöâç6†÷G4f—&VBÂÖÖó¢2çvVöâæÖÖòÂwVã¢2ç'G2æwVâçf—6–&ÆRÂ–Ö–æs¢õööövç–Æ÷Bæ–Ö–ærÂ&V6ö–Ã¢2çvVöâç&V6ö–ÂÓ²Ò’‚–“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢²f—&W2v—F‚6†&VBwVâ÷6RæBÖ×Væ—F–öâ"Âf—&VBæWV—VBbbf—&VBç6†÷G2âbbf—&VBæÖÖòÂ3bbf—&VBæwVâbbf—&VBæ–Ö–ærbbf—&VBç&V6ö–ÂâÂ¥4ôâç7G&–æv–g’†f—&VB’“°¢v—B"æ¶W’‚'""“²v—B"æWfÇVFR‚uõööövæGfæ6Rƒ2’r“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢Æö6Â&VÆöB&W7F÷&W2Ö×Væ—F–öâ"Âv—B"æWfÇVFR‚uõööövç–Æ÷BçÆ–W"çvVöâæÖÖòÓÓÒ$Âæ7&WräÔÔõôÔ‚r’“°¢v—B"æ¶W’‚""“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢76R§V×2v’g&öÒ–çFW&7F–öç2"Âv—B"æWfÇVFR‚uõööövæGfæ6Rƒã“²õööövç–Æ÷BçÆ–W"æ†÷âr’“°¢v—B"æWfÇVFR‚uõööövæGfæ6Rƒ’r“°¢6öç7BÆ6RÒ‡‚Â¢’Óâ"æWfÇVFR†õööövç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ã"ÂF—7C¢rÂF&vWC¢²ƒ¢G·‡ÒÂ“¢ãrÂ£¢G·§ÒÒÂ÷6—F–öã¢²ƒ¢G·‡ÒÂ“¢Â£¢G·§ÒÒÒ“²õööövæGfæ6Rƒã“¶“°¢v—BG6$&ö6‚†"Â'6†÷"“°¢v—B"æWfÇVFR‚uõööövæG6"æ'W’‚'FöÖFò"“²õööövæG6"æ'W’‚&&ææ"’r“°¢v—B"æ¶W’‚'B"“²v—B"æ¶W’‚&""“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢FöÖFöW2æB6æ6·2&VÖ–â6W&FR"Âv—B"æWfÇVFR‚uõööövæG6"æ–çfVçF÷'’çFöÖFöW2ÓÓÒbbõööövæG6"æ–çfVçF÷'’æ&ææ2ÓÓÒbbõööövæG6"ç6†÷G2ÓÓÒr’“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ&G6"Ö6öçFW‡B%Òr’æ6Æ–6²‚–“°¢v—B"æ¶W’‚'b"“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢6†÷7W7VæG2vVöç2"Âv—B"æWfÇVFR‚rFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×6†÷"’æ†–FFVâbbõööövæG6"æfF"çvVöâçG&–vvW$†VÆBr’“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ&G6"Ö6Æ÷6R×6†÷%Òr’æ6Æ–6²‚–“°¢v—BÆ6RƒÂ32“°¢v—B"æWfÇVFR‚uõööövæ7&Wrç6WEvVöåG&–vvW"‡G'VR“²õööövæG6"æ&öEG&—çv—BÒƒ²õööövæG6"æ&ö&B‚&&öB"’r“°¢6öç7B&–FRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BrÒõööövæG6"æfF"çvVöâÂ6†÷G2Òrç6†÷G4f—&VC²õööövæGfæ6RƒãR“²&WGW&âõööövæG6"ç†6RÓÓÒ&&öB"bbrçG&–vvW$†VÆBbbræ'W'7E&VÖ–æ–ærbbrç6†÷G4f—&VBÓÓÒ6†÷G3²Ò’‚–“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢&ö&F–ær7W7VæG2f—&–ær"Â&–FR“°¢v—B"æWfÇVFR‚uõööövæG6"ç7F÷&–FR‚’r“°¢v—BÆ6RƒrÂ#B“°¢v—B"æWfÇVFR‚uõööövæG6"çG&–åG&—çv—BÒƒ²õööövæG6"æ&ö&B‚&6ö7FW""“²õööövæGfæ6Rƒã"’r“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢6ö7FW"¶VW2—G276VævW"6ÖW&"Âv—B"æWfÇVFR‚uõööövæG6"ç†6RÓÓÒ&6ö7FW""bbõööövæG6"æfF"çvVöâçG&–vvW$†VÆBr’“°¢v—B"æWfÇVFR‚uõööövæG6"ç7F÷&–FR‚’r“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ&G6"ÖÆöö¶÷WB%Òr’æ6Æ–6²‚“²õööövæGfæ6RƒãB–“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢Æöö¶÷WB&VÖ–ç2g&VR6ÖW&"Âv—B"æWfÇVFR‚uõööövç–Æ÷BçÆ–W"ÓÓÒçVÆÂbbõööövæ6ÖW&ç÷6—F–öâç’âRr’“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×66VæSÒ&G6"%Ò¶FFÖ7F–öãÒ'&W6WB×f–Wr%Òr’æ6Æ–6²‚“²õööövæGfæ6RƒãB–“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢ÆVf–ærÆöö¶÷WB&W7F÷&W2F†R6ÖRÆ–&ÆR7F÷""Âv—B"æWfÇVFR‚uõööövç–Æ÷BçÆ–W"ÓÓÒõööövæG6"æfF"r’“°¢v—BG6$&ö6‚†"Â'Gb"“²v—B"æWfÇVFR‚uõööövæG6"æ÷VåGb‚’r“°¢v—B"æ¶W’‚'b"“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢Eb÷Vç2v—F‚vVöç27W7VæFVB"Âv—B"æWfÇVFR‚uõööövæG6"çGbæ—4÷VâbbõööövæG6"æfF"çvVöâçG&–vvW$†VÆBr’“°¢v—B"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ6Æ÷6R"’æ6Æ–6²‚“²õööövæGfæ6Rƒã’r“°¢v—BÆ6R‚ÓrÂ3ãR“²v—B"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’æ6Æ–6²‚’r“°¢v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢6öç7B&6²Òv—B"æWfÇVFR†‡²æÖS¢õööövç–Æ÷BçÆ–W#òçG&—G2ææÖRÂÖÖó¢õööövç–Æ÷BçÆ–W#òçvVöâæÖÖòÂ7&S¢õööövç–Æ÷BçÆ–W#òçvVöâç7&TÖÖòæ¦ö–â‚’Â÷&–v–æÃ¢õö‡V$ÖÖòÒ–“°¢&V6÷&B‚&G6"6†&VBÆ–W#¢&WGW&â&W7F÷&W2–FVçF—G’æBÆVfW2‡V"Ö×Væ—F–öâVçF÷V6†VB"Â&6²ææÖRÓÓÒ''VÆW2×v—F†÷WB×'VÆW'2"bb&6²æÖÖòÓÓÒ&6²æ÷&–v–æÂæÖÖòbb&6²ç7&RÓÓÒ&6²æ÷&–v–æÂç7&RÂ¥4ôâç7G&–æv–g’†&6²’“°§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"6†&7FW"6öçF–çV—G’"ÂW&Ã¢‡V%vR†F—7B’Â7FW3¢·²æÖS¢&G6"6†&7FW"6öçF–çV—G’"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢f÷"†6öç7BæÖRöb²%–VÆÆ÷t'&ö¶T—B"Â''VÆW2×v—F†÷WB×'VÆW'2%Ò’°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ6fRÒ"æ6fVÖVâævWB‚G´¥4ôâç7G&–æv–g’†æÖR—Ò“°¢6fRæ÷fW'&–FRÒ'v÷&¶–ær#²"æ7&Wrç&Vg&W6…7FFW2‡G'VR“²"ç–Æ÷Bç÷76W72†6fR“°¢v–æF÷råõöG6%&Wf–÷W5&ö÷BÒ6fRç&ö÷C°¢"æGfæ6Rƒã"“°¢Ò’‚–“°¢v—BG6$VçFW"†"“°¢6öç7BVçFW&VBÒv—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÂS“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Â6öFS¢$¶W•r"Ò“°¢–b‚VçFW&VB’F‡&÷rW'&÷"‚$E4"66VæR†æFöfbF–Bæ÷B6ö×ÆWFR"“°¢6öç7BfF"Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7BÒõööövæG6"æfF"Â6æöæ–6ÂÒ$ÂæÖöFVÇ2æ6fVÖâ„$Âæ6öçG&–'WF÷'2çG&—G4f÷"‚G´¥4ôâç7G&–æv–g’†æÖR—Ò’“°¢&WGW&â²æÖS¢çG&—G2ææÖRÂ&V'V–ÇC¢ç&ö÷BÓÒõöG6%&Wf–÷W5&ö÷BÂ6æöæ–6Ã¢æ†VD÷VâÓÓÒ6æöæ–6Âæ†VD÷VâÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"6†&7FW#¢"²æÖR²"VçFW'2v—F‚F†R6æöæ–6ÂÖöFVÂ"ÂfF"ææÖRÓÓÒæÖRbbfF"ç&V'V–ÇBbbfF"æ6æöæ–6ÂÂ¥4ôâç7G&–æv–g’†fF"’“°¢v—B"æ¶W’‚$W66R"“°¢v—BVçF–ÅvR†"Ât"ç66VæRÓÓÒ&‡V""bb"çG&ç6—F–öæ–ærrÂS“°¢6öç7B&WGW&æVBÒv—B"æWfÇVFR†‡²æÖS¢õööövç–Æ÷BçÆ–W#òçG&—G2ææÖRÂ&V'V–ÇC¢õööövç–Æ÷BçÆ–W#òç&ö÷BÓÒõöG6%&Wf–÷W5&ö÷BÒ–“°¢&V6÷&B‚&G6"6†&7FW#¢"²æÖR²"&WGW&ç2÷76W76VB"Â&WGW&æVBææÖRÓÓÒæÖRbb&WGW&æVBç&V'V–ÇBÂ¥4ôâç7G&–æv–g’‡&WGW&æVB’“°¢v—B"æWfÇVFR‚vFVÆWFRv–æF÷råõöG6%&Wf–÷W5&ö÷Br“°¢Ð§ÒÕÒÒ“° §66VæR‚&G6""Â²Æ&VÃ¢&G6"†öæR"ÂW&Ã¢‡V%vR†F—7BÂ'66VæSÖG6""’Â÷G3¢²s¢3“Âƒ¢ƒCBÂÖö&–ÆS¢G'VRÒÂ7FW3¢·²æÖS¢&G6"†öæR"Âv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢6öç7BÆ–÷WBÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×æVÂ"’ævWD&÷VæF–æt6Æ–VçE&V7B‚’Â¢ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&¦÷’ÖÖ÷fR"’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²v–GFƒ¢–ææW%v–GF‚Â†V–v‡C¢–ææW$†V–v‡BÂÆVgC¢æÆVgBÂ&–v‡C¢ç&–v‡BÂ&÷GFöÓ¢æ&÷GFöÒÂ7F–6³¢¢çv–GF‚âÂ÷fW&Æ¢æÆVgBÂ¢ç&–v‡Bbbç&–v‡Bâ¢æÆVgBbbæ&÷GFöÒâ¢çF÷Ó²Ò’‚–“°¢&V6÷&B‚&G6"†öæS¢VçG&æ6Rf—G2æBÆVfW2F†RÖ÷fVÖVçB7F–6²W6&ÆR"ÂÆ–÷WBæÆVgBãÒbbÆ–÷WBç&–v‡BÃÒÆ–÷WBçv–GF‚bbÆ–÷WBæ&÷GFöÒÃÒÆ–÷WBæ†V–v‡BbbÆ–÷WBç7F–6²bbÆ–÷WBæ÷fW&ÆÂ¥4ôâç7G&–æv–g’†Æ–÷WB’“°¢6öç7BVæ&ÆRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×7F'BÖVF–ò"’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"Ó²Ò’‚–“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6…7F'B"ÂF÷V6…ö–çG3¢¶Væ&ÆUÒÒ“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„VæB"ÂF÷V6…ö–çG3¢µÒÒ“°¢v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢6öç7B7F–6²Òv—B"æWfÇVFR†‚‚’Óâ²6öç7B"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚&¦÷’ÖÖ÷fR"’ævWD&÷VæF–æt6Æ–VçE&V7B‚“²&WGW&â²ƒ¢"ç‚²"çv–GF‚ò"Â“¢"ç’²"æ†V–v‡Bò"ÂF÷¢"ç’²Ó²Ò’‚–“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6…7F'B"ÂF÷V6…ö–çG3¢·²ƒ¢7F–6²ç‚Â“¢7F–6²çF÷ÕÒÒ“°¢v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢v—B"æWfÇVFR†õööövæVF–òçFövvÆR‚“²õööövæGfæ6R…õööövæVF–òæGW&F–öâ¢ã"Âò#–“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Â²G—S¢'F÷V6„VæB"ÂF÷V6…ö–çG3¢µÒÒ“°¢6öç7B†6RÒv—B"æWfÇVFR†‡²†6S¢õööövæG6"ç†6RÂ&öw&W73¢õööövæG6"ç&öw&W72Â×WFVC¢õööövæVF–òæ×WFVBÂVæF–æs¢õööövæVF–òçVæF–ærÂ&VG“¢õööövæVF–òç&VG’ÂGW&F–öã¢õööövæVF–òæGW&F–öâÒ–“°¢&V6÷&B‚&G6"†öæS¢&VGV6VBÖ÷F–öâVçFW'2ÆæBv—F†÷WBâWFöÖF–26ÖW&F÷W""Â†6Rç†6RÓÓÒ&ÆæB"Â¥4ôâç7G&–æv–g’‡†6R’“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ&G6"×6¶—%Òr’æ6Æ–6²‚“²õööövæGfæ6Rƒã–“°¢&V6÷&B‚&G6"†öæS¢6¶—F÷W"&W7F÷&W2F†RÆ–&ÆR6ÖW&"Âv—B"æWfÇVFR†õööövæG6"ç†6RÓÓÒ&ÆæB"bbFö7VÖVçBæ&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"Ö'&—fÂ"–’“°¢v—B"æWfÇVFR†õööövæGfæ6Rƒ–“°¢6öç7BÇ†Òv—B"æWfÇVFR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&÷fW&Æ’"’ævWD6öçFW‡B‚#&B"’ævWD–ÖvTFFƒÂÂÂ’æFF³5Ö“°¢&V6÷&B‚&G6"&WfVÃ¢÷fW&Æ’6ÆV'2gFW"F†Rv†—FRfFR"ÂÇ†ÓÓÒÂ7G&–ær†Ç†’“°¢–b‡&ö6W72æVçbäE4%ô4EU$R’v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×†öæRçær"’“°§ÒÕÒÒ“°¦f÷"†6öç7B&6¶VæBöb²'vV&vÃ""Â&6çf3&B%Ò’66VæR‚&G6""Â²Æ&VÃ¢G6"ÆæBG¶&6¶VæGÖÂW&Ã¢‡V%vR‡7&2Â66VæSÖG6"G¶&6¶VæBÓÓÒ&6çf3&B"ò"f6çf3&CÓ"¢"'Ö’Â7FW3¢·²æÖS¢G6"ÆæBG¶&6¶VæGÖÂv‡“¢&6öçG&7C¢&W6W'fRE4"66VæR&V†f–÷"–æFWVæFVçFÇ’öbF†R‡V"VçG&æ6R"Â'Vã¢7–æ2†"’Óâ°¢v—B"ç6VæB‚$V×VÆF–öâç6WDV×VÆFVDÖVF–"Â²fVGW&W3¢·²æÖS¢'&VfW'2×&VGV6VBÖÖ÷F–öâ"ÂfÇVS¢&æò×&VfW&Væ6R"ÕÒÒ“°¢v—B"æWfÇVFR†‚‚’Óâ²6öç7B66VæRÒ$Âç66VæW2æG6"ÂWFFRÒ66VæRçWFFS²v–æF÷råõöG6$6Æö6µ&ö&RÒ²F–ÖS¢ÂÖ–ã¢Ó²66VæRçWFFRÒ†GBÂF–ÖR’Óâ²õöG6$6Æö6µ&ö&RçF–ÖRÒF–ÖS²õöG6$6Æö6µ&ö&RæÖ–âÒÖF‚æÖ–â…õöG6$6Æö6µ&ö&RæÖ–âÂF–ÖR“²WFFR†GBÂF–ÖR“²Ó²Ò’‚–“°¢6öç7B–æ—F–ÂÒv—B"æWfÇVFR†‡²†6S¢õööövæG6"ç†6RÂ&öw&W73¢õööövæG6"ç&öw&W72ÂÆ—fS¢õööövæG6"æFFÂæöFW3¢õööövç7FG2‚’æÆÄæöFW2Ò–“°¢&V6÷&B‚&G6"VçG&æ6S¢7F'G2F&²v—F†÷WB6öç7G'V7F–ærÆ—fRfVVG2"Â–æ—F–Âç†6RÓÓÒ&VçG&æ6R"bb–æ—F–Âç&öw&W72ÓÓÒbb–æ—F–ÂæÆ—fRÂ¥4ôâç7G&–æv–g’†–æ—F–Â’“°¢v—B"æ¶W’‚&Ò"“°¢v—BVçF–ÅvR†"Â$"æVF–òç&VG’"Â“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'r"Ò“°¢v—B"æWfÇVFR†õööövæGfæ6R…õööövæVF–òæGW&F–öâ¢ã2Âò#–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Ò“°¢6öç7B'F–ÂÒv—B"æWfÇVFR†‡²&öw&W73¢õööövæG6"ç&öw&W72Â£¢õööövæ6ÖW&ç÷6—F–öâç¢ÂfF%£¢õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢Âf—&VC¢õööövæG6"æf—&VBÒ–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'2"Ò“°¢v—B"æWfÇVFR†õööövæGfæ6R…õööövæVF–òæGW&F–öâ¢ãÂò#–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'2"Ò“°¢6öç7B&6²Òv—B"æWfÇVFR†‡²&öw&W73¢õööövæG6"ç&öw&W72Âf—&VC¢õööövæG6"æf—&VBÒ–“°¢&V6÷&B‚&G6"VçG&æ6S¢vÆ¶–ærw&÷w2F†R÷Væ–æræB&WfW'6–ærFöW2æ÷B&WÆ’7VR"Â'F–Âç&öw&W72âã"bb'F–Âç¢Â#BbbÖF‚æ'2‡'F–Âç¢Ò'F–ÂæfF%¢ÒB’Âãbb&6²ç&öw&W72Â'F–Âç&öw&W72bb&6²æf—&VE³ÒÓÓÒÂ¥4ôâç7G&–æv–g’‡²'F–ÂÂ&6²Ò’“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W”F÷vâ"Â¶W“¢'r"Ò“°¢v—B"æWfÇVFR†õööövæGfæ6R…õööövæVF–òæGW&F–öâ¢ãƒ2Âò#–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Â²G—S¢&¶W•W"Â¶W“¢'r"Ò“°¢6öç7BF÷W"Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B"ÒõööövÂ7F'BÒ"æG6"ç†6RÂ6×ÆW2ÒµÓ°¢f÷"†ÆWB’Ò²’Â3²’²²’²"æGfæ6RƒãRÂò3“²6×ÆW2çW6‚‡²ƒ¢"æ6ÖW&ç÷6—F–öâç‚Â“¢"æ6ÖW&ç÷6—F–öâç’Â£¢"æ6ÖW&ç÷6—F–öâç¢Ò“²Ð¢&WGW&â²7F'BÂVæC¢"æG6"ç†6RÂ6×ÆW2ÂÖöFS¢"ç–Æ÷BæÖöFRÂfF#¢"æG6"æfF"ç&ö÷Bçf—6–&ÆRÓ°¢Ò’‚–“°¢&V6÷&B‚&G6"'&—fÃ¢gVÆÂ6—&6ÆR6†÷w2WW"Æ–âæBGW'FÆRVæFW'6–FR&Vf÷&R†æF–ær&6²6†÷VÆFW"6öçG&öÂ"ÂF÷W"ç7F'BÓÓÒ&'&—fÂ"bbF÷W"æVæBÓÓÒ&ÆæB"bbF÷W"ç6×ÆW2ç6öÖR‚‡’Óâç‚âs’bbF÷W"ç6×ÆW2ç6öÖR‚‡’Óâç‚ÂÓs’bbF÷W"ç6×ÆW2ç6öÖR‚‡’Óâç’âC’bbF÷W"ç6×ÆW2ç6öÖR‚‡’Óâç’ÂÓ#R’bbF÷W"æÖöFRÓÓÒ'6†÷VÆFW""bbF÷W"æfF"Â¥4ôâç7G&–æv–g’‡F÷W"’“°¢6öç7BÆæBÒv—B"æWfÇVFR†‡²†6S¢õööövæG6"ç†6RÂf—&VC¢õööövæG6"æf—&VBÂ&öG3¢õööövæG6"æÆæBæ&öG2æÆVæwF‚ÂvFW#¢õööövæG6"æÆæBçvFW"çf—6–&ÆRÂGW'FÆS¢õööövæG6"æÆæBçGW'FÆRæ6†–ÆG&VâæÆVæwF‚Âf–æ—FS¢²ââåõööövæG6"ç&–Å•ÒæWfW'’„çVÖ&W"æ—4f–æ—FR’Ò–“°¢&V6÷&B‚&G6"ÆæC¢ÆÂf÷W"7VW2f—&Röæ6RæBF†R–æFWVæFVçBv÷&ÆB÷Vç2"ÂÆæBç†6RÓÓÒ&ÆæB"bbÆæBæf—&VBæWfW'’‚‡b’ÓâbÓÓÒ’bbÆæBæ&öG2ÓÓÒ2bbÆæBçvFW"bbÆæBçGW'FÆRâ#bbÆæBæf–æ—FRÂ¥4ôâç7G&–æv–g’†ÆæB’“°¢–b‡&ö6W72æVçbäE4%ô4EU$Rbb&6¶VæBÓÓÒ'vV&vÃ""’°¢v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×vÆ²çær"’“°¢v—B"æWfÇVFR†õööövç–Æ÷Bævõ&W6WB‚&Æöö¶÷WB"“²õööövæGfæ6Rƒ"–“°¢v—B"ç67&VVç6†÷B†¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"×GW'FÆRçær"’“°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FF×66VæSÒ&G6"%Ò¶FFÖ7F–öãÒ'&W6WB×f–Wr%Òr’æ6Æ–6²‚“²õööövæGfæ6Rƒã2–“°¢Ð¢6öç7B6†÷Òv—B"æWfÇVFR†‚‚’Óâ²6öç7B"Òõöööv²6öç7BÆæFÖ&²Ò"æG6"æÆæBæÆæFÖ&·2ç6†÷Âæ6†÷"ÒÆæFÖ&²çö–çB‚“²"ç–Æ÷Bææf–vFR‡²–s¢ÆæFÖ&²ææöFRç&÷FF–öâç’Â—F6ƒ¢ÂF—7C¢"Â÷6—F–öã¢æ6†÷"ÂF&vWC¢²ƒ¢æ6†÷"ç‚Â“¢ãrÂ£¢æ6†÷"ç¢ÒÒ“²"æG6"æ'W’‚&'&VB"“²"æG6"æ'W’‚'FöÖFò"“²6öç7B&÷Vv‡BÒ"æG6"æ–çfVçF÷'“²"æG6"æVB‚“²"æG6"çF‡&÷uFöÖFò‚“²6öç7BW6VBÒ"æG6"æ–çfVçF÷'“²&WGW&â²&÷Vv‡BÂW6VBÂ6†÷G3¢"æG6"ç6†÷G2Â6Æö6³¢v–æF÷råõöG6$6Æö6µ&ö&RÓ²Ò’‚–“°¢&V6÷&B‚&G6"6†÷¢6–×VÆFVBW&6†6W26†&vRöæ6RæB6öç7VÖR–çfVçF÷'’"Â6†÷æ&÷Vv‡BçFö¶Vç2ÓÓÒbbb6†÷æ&÷Vv‡Bæ'&VBÓÓÒbb6†÷æ&÷Vv‡BçFöÖFöW2ÓÓÒbb6†÷çW6VBæ'&VBÓÓÒbb6†÷çW6VBçFöÖFöW2ÓÓÒbb6†÷ç6†÷G2ÓÓÒbb6†÷æ6Æö6²æÖ–âãÒÂ¥4ôâç7G&–æv–g’‡6†÷’“°¢6öç7B&–FRÒv—B"æWfÇVFR†‚‚’Óâ²6öç7B"Òõöööv²"ç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ÂF—7C¢"Â÷6—F–öã¢²ƒ¢Â“¢Â£¢32ÒÂF&vWC¢²ƒ¢Â“¢ãrÂ£¢32ÒÒ“²"æG6"æ&öEG&—çv—BÒƒ²"æG6"æ&öEG&—æævÆRÒ²"æG6"æ&ö&B‚&&öB"“²"æGfæ6Rƒã"“²6öç7B&öBÒ"æG6"ç†6S²"æG6"ç7F÷&–FR‚“²6öç7BÆæFVBÒ"æG6"ç†6S²"ç–Æ÷Bææf–vFR‡²–s¢Â—F6ƒ¢ÂF—7C¢"Â÷6—F–öã¢²ƒ¢rÂ“¢Â£¢#BÒÂF&vWC¢²ƒ¢rÂ“¢ãrÂ£¢#BÒÒ“²"æG6"çG&–åG&—çv—BÒƒ²"æG6"çG&–åG&—æævÆRÒ"æG6"çG&–åG&—ç7F'C²"æG6"æ&ö&B‚&6ö7FW""“²"æGfæ6Rƒã"“²6öç7B6ö7FW"Ò"æG6"ç†6RÂ’Ò"æ6ÖW&ç÷6—F–öâç“²"æG6"ç7F÷&–FR‚“²&WGW&â²&öBÂÆæFVBÂ6ö7FW"Â’Â7F÷VC¢"æG6"ç†6RÓ²Ò’‚–“°¢&V6÷&B‚&G6"&–FW3¢&ö&BÂÖ÷fRæBF—6VÖ&&²öâG'’w&÷VæB"Â&–FRæ&öBÓÓÒ&&öB"bb&–FRæÆæFVBÓÓÒ&ÆæB"bb&–FRæ6ö7FW"ÓÓÒ&6ö7FW""bb&–FRç’â2bb&–FRç7F÷VBÓÓÒ&ÆæB"Â¥4ôâç7G&–æv–g’‡&–FR’“°¢6öç7BFFÒv—B"æWfÇVFR†‚‚’Óâ²6öç7BBÒ$ÂæG6$FFæ7&VFR‚’Â&BÒBæ–ævW7D6æFÆW2…µ³ÂÓÂÂ2ÂEÕÒ“²6öç7BvööBÒBæ–ævW7D6æFÆW2…µ³#Â“‚ÂRÂÂ5ÒÂ³cÂ“RÂBÂ“’ÂÕÒ“²6öç7B7FÆRÒBæ–ævW7EF–6²ƒBÂ3“²f÷"†ÆWB’Ò²’Â#²’²²’Bæ–ævW7EF–6²ƒ²’Âƒ²’¢c“²6öç7B÷WBÒ²&BÂvööBÂ7FÆRÂ6÷VçC¢Bç7FFRæ6÷VçBÂ6—¦S¢Bç7FFRæ6æFÆW2æÆVæwF‚Â&–6S¢Bç7FFRç&–6RÓ²BæF—7÷6R‚“²&WGW&â÷WC²Ò’‚–“°¢&V6÷&B‚&G6"FF¢fÆ–FFW2æB÷&FW'2fVVG2Â&V¦V7G27FÆRF–6·2Â62†—7F÷'’"ÂFFæ&BbbFFævööBbbFFç7FÆRbbFFæ6÷VçBÓÓÒC‚bbFFç6—¦RÓÓÒ#CbbFFç&–6RÓÓÒ#“’Â¥4ôâç7G&–æv–g’†FF’“°¢v—BG6$W†—B†"“°¢6öç7B‡V"Òv—B"æWfÇVFR†‡²66VæS¢õööövç66VæRÂG6#¢$Âæ6fW2ç6Æ÷G2æf–æB‚‡2’Óâ2æ–BÓÓÒ&3"’Â6†VWC¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚'6†VWB"’æ†–FFVâÂ&öG“¢Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"Ö7F—fR"’Ò–“°¢&V6÷&B‚&G6"&WGW&ã¢&W7F÷&W2&–g&÷7BæB–çFW&f6RæBÆVfW236VÆVB"Â‡V"ç66VæRÓÓÒ&&–g&÷7B"bb‡V"æG6"ç66VæRÓÓÒçVÆÂbb‡V"æG6"ç7FGW2ÓÓÒ&F&²"bb‡V"æG6"ææÖRÓÓÒçVÆÂbb‡V"ç6†VWBbb‡V"æ&öG’Â¥4ôâç7G&–æv–g’†‡V"’“°¢&V6÷&B‚&G6"ÆæC¢6öç6öÆR&VÖ–ç26ÆVâ"Â"æÆöw2æÆVæwF‚ÓÓÒÂ"æÆöw2æ¦ö–â‚"Â"’“°§ÒÕÒÒ“°  ¦6öç7BÖ"Ò†'—FW2’Óâ†'—FW2òCƒSsb’çFôf—†VBƒ"“°¦6öç7BG6%6ö²Ò7–æ2†"’Óâ°¢v—B"ç6VæB‚$†V&öf–ÆW"æVæ&ÆR"“°¢6öç7BVçF–ÂÒ†6öæBÂ×2’Óâ"æWfÇVFR†æWr&öÖ—6R‚‡&W6öÇfR’Óâ²6öç7B"Òv–æF÷råõöööv²6öç7BCÒW&f÷&Öæ6Rææ÷r‚“²6öç7BF–6²Ò‚’Óâ²6öç7Bö²Ò‚G¶6öæGÒ“²–b†ö²ÇÂW&f÷&Öæ6Rææ÷r‚’ÒCâG¶×7Ò’&W6öÇfR†ö²“²VÇ6R&WVW7Dæ–ÖF–öäg&ÖR‡F–6²“²Ó²F–6²‚“²Ò–“°¢6öç7B&VæFW&VBÒ†g&ÖW2Â×2Òc’Óâ"æWfÇVFR†æWr&öÖ—6R‚‡&W6öÇfR’Óâ²6öç7B"Òv–æF÷råõöööv²6öç7B7F'BÒ"ç&VæFW&VDg&ÖW3²6öç7BCÒW&f÷&Öæ6Rææ÷r‚“²6öç7BF–6²Ò‚’Óâ²–b„"ç&VæFW&VDg&ÖW2ãÒ7F'B²G¶g&ÖW7ÒÇÂW&f÷&Öæ6Rææ÷r‚’ÒCâG¶×7Ò’&W6öÇfR„"ç&VæFW&VDg&ÖW2Ò7F'B“²VÇ6R&WVW7Dæ–ÖF–öäg&ÖR‡F–6²“²Ó²&WVW7Dæ–ÖF–öäg&ÖR‡F–6²“²Ò–“°¢6öç7B6WGFÆVBÒ†×2ÒC’ÓâVçF–Â‚'v–æF÷rä$Âç66VæRçGvVVä6÷VçB‚’ÓÓÒ"Â×2“°¢òòWfW'’66VæRw&—FW2—G2†–çBã"2gFW"VçFW&–æs²F†Rf—'7B6æ6†÷B×W7BÇ&VG’6÷VçBF†BFW‡BæöFRà¢v—BVçF–Â†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&†–çB"’çFW‡D6öçFVçFÂ3“°¢6öç7B†VÒ7–æ2‚’Óâ°¢v—B"ç6VæB‚$†V&öf–ÆW"æ6öÆÆV7Dv&&vR"“°¢òò6÷VçBF†RvR&Vf÷&R6‡&öÖRw2†V×6æ6†÷BÖ6†–æW'’6âFBâ–ç7V7F÷"æöFRà¢6öç7BFöÒÒ†v—B"ç6VæB‚$ÖVÖ÷'’ævWDDôÔ6÷VçFW'2"’’ç&W7VÇC°¢6öç7B6‡Væ·2ÒµÓ°¢"æöâ‚$†V&öf–ÆW"æFD†V6æ6†÷D6‡Væ²"Â‡’Óâ6‡Væ·2çW6‚‡æ6‡Væ²’“°¢v—B"ç6VæB‚$†V&öf–ÆW"çF¶T†V6æ6†÷B"Â²&W÷'E&öw&W73¢fÇ6RÒ“°¢"æöâ‚$†V&öf–ÆW"æFD†V6æ6†÷D6‡Væ²"ÂçVÆÂ“°¢6öç7B6æÒ¥4ôâç'6R†6‡Væ·2æ¦ö–â‚""’“°¢6öç7B²æöFUöf–VÆG3¢f–VÆG2ÂæöFU÷G—W3¢·G—W5ÒÒÒ6æç6æ6†÷BæÖWF°¢6öç7B•G—RÒf–VÆG2æ–æFW„öb‚'G—R"’Â•6—¦RÒf–VÆG2æ–æFW„öb‚'6VÆe÷6—¦R"’Â6öFRÒG—W2æ–æFW„öb‚&6öFR"“°¢ÆWBF÷FÂÒÂ6ö×–ÆVBÒ°¢f÷"†ÆWB’Ò²’Â6æææöFW2æÆVæwFƒ²’³Òf–VÆG2æÆVæwF‚’°¢F÷FÂ³Ò6æææöFW5¶’²•6—¦UÓ°¢–b‡6æææöFW5¶’²•G—UÒÓÓÒ6öFR’6ö×–ÆVB³Ò6æææöFW5¶’²•6—¦UÓ°¢Ð¢&WGW&â²W6VC¢†v—B"ç6VæB‚%'VçF–ÖRævWD†VW6vR"’’ç&W7VÇBçW6VE6—¦RÂö&¦V7G3¢F÷FÂÒ6ö×–ÆVBÂ6öFS¢6ö×–ÆVBÂæöFW3¢FöÒææöFW2ÂÆ—7FVæW'3¢FöÒæ§4WfVçDÆ—7FVæW'2Ó°¢Ó°¢6öç7B6æ6†÷BÒ7–æ2‡7FG2ÒçVÆÂ’Óâ°¢òòg&VW¦RF†RvR6ò7FG2ÂDôÒ6÷VçFW'2æB†VFW67&–&RöæR7FFRFW7—FR÷F†W"ÆæW2rFVÆ—2à¢v—B"æfö7W2†fÇ6R“°¢G'’°¢v—B"ç6VæB‚%vRç6WEvV$Æ–fV7–6ÆU7FFR"Â²7FFS¢&g&÷¦Vâ"Ò“°¢&WGW&â²7FG3¢7FG2ÇÂv—B"æWfÇVFR‚'v–æF÷råõööövç7FG2‚’"’Âââæv—B†V‚’Ó°¢Òf–æÆÇ’°¢v—B"ç6VæB‚%vRç6WEvV$Æ–fV7–6ÆU7FFR"Â²7FFS¢&7F—fR"Ò“°¢v—B"æfö7W2‡G'VR“°¢v—B"ç6VæB‚%vRæ'&–æuFôg&öçB"“°¢Ð¢Ó°¢òòvò‚’GW&–ær'Vææ–ærG&ç6—F–öâ—2–væ÷&VC¢v—Bf÷"7vÂg&ÖW2Âæ–ÖF–öç2æBF†RfFRf—'7Bà¢6öç7BG&fVÂÒ†–B’Óâ"æWfÇVFR†æWr&öÖ—6R‚‡&W6öÇfR’Óâ²6öç7B"Òv–æF÷råõöööv²6öç7BBÒv–æF÷rä$Âç66VæRçGvVVä6÷VçC²6öç7BCÒW&f÷&Öæ6Rææ÷r‚“²ÆWBÆ7BÒCÂ7vÒÂ7vg&ÖRÒÂ7vvÒ²"ævò‚G´¥4ôâç7G&–æv–g’†–B—Ò“²6öç7BF–6²Ò‚’Óâ²6öç7Bæ÷rÒW&f÷&Öæ6Rææ÷r‚“²–b‚7vbb"ç66VæRÓÓÒG´¥4ôâç7G&–æv–g’†–B—Ò’²7vÒæ÷rÒC²7vvÒæ÷rÒÆ7C²7vg&ÖRÒ"ç&VæFW&VDg&ÖW3²ÒÆ7BÒæ÷s²–b‡7vbb"ç&VæFW&VDg&ÖW2ãÒ7vg&ÖR²2bbB‚’ÓÓÒbb"çG&ç6—F–öæ–ær’&W6öÇfR‡²7vÂ7vvÂ6WGFÆVC¢æ÷rÒCÒ“²VÇ6R–b†æ÷rÒCâƒ’&W6öÇfR‡²7GV6³¢²66VæS¢"ç66VæRÂGvVVç3¢B‚’Âg&ÖW56–æ6U7v¢7vò"ç&VæFW&VDg&ÖW2Ò7vg&ÖR¢ÓÂ7v¢ÖF‚ç&÷VæB‡7v’ÒÒ“²VÇ6R&WVW7Dæ–ÖF–öäg&ÖR‡F–6²“²Ó²&WVW7Dæ–ÖF–öäg&ÖR‡F–6²“²Ò–“°¢6öç7B†VFWF–ÂÒ†Â¢’Óâö&¦V7G2G¶Ö"†æö&¦V7G2—ÒÓâG¶Ö"‡¢æö&¦V7G2—ÒÔ"‡W6VBG¶Ö"†çW6VB—ÒÓâG¶Ö"‡¢çW6VB—ÒÔ"Â6öFRG¶Ö"†æ6öFR—ÒÓâG¶Ö"‡¢æ6öFR—ÒÔ"–°¢6öç7Bv—F†–âÒ†Â¢Â6†&R’ÓâÖF‚æ'2‡¢æö&¦V7G2Òæö&¦V7G2’ÃÒæö&¦V7G2¢6†&S°¢&WGW&â²VçF–ÂÂ&VæFW&VBÂ6WGFÆVBÂ6æ6†÷BÂG&fVÂÂ†VFWF–ÂÂv—F†–âÓ°§Ó° §66VæR‚&G6""Â²Æ&VÃ¢&Æ–fV7–6ÆR"ÂW&Ã¢‡V%vR‡7&2’Â7FW3¢·²æÖS¢&G6"Æ–fV7–6ÆR"Âv‡“¢&6öçG&7C¢&WVFVBE4"f—6—G2&VÆV6RæöFW2ÂÆ—7FVæW'2æBuR&W6÷W&6W2"Â'Vã¢7–æ2†"’Óâ°¢6öç7B²&VæFW&VBÂ6WGFÆVBÂ6æ6†÷BÂG&fVÂÂ†VFWF–ÂÂv—F†–âÒÒv—BG6%6ö²†"“°¢òòv&ÒF†RæWr66†VBÖöFVÂ'V–ÆFW'2&Vf÷&R6ö×&–ær&WF–æVBÖVÖ÷'’à¢v—BG&fVÂ‚&G6""“²v—BG&fVÂ‚&‡V""“²v—B6WGFÆVB‚“²v—B&VæFW&VBƒ"“°¢6öç7B&Vf÷&RÒv—B6æ6†÷B‚“°¢f÷"†ÆWB’Ò²’Âc²’²²’²v—BG&fVÂ‚&G6""“²v—BG&fVÂ‚&‡V""“²Ð¢6öç7BgFW"Òv—B6æ6†÷B‚“°¢6öç7B6ÖRÒ†¶W’’Óâ&Vf÷&Rç7FG5¶¶W•ÒÓÓÒgFW"ç7FG5¶¶W•Ó°¢&V6÷&B‚'6ö³¢G6"7–6ÆW3¢6—‚&÷VæBG&—2&WF–âæöFRÂF&vWBÂGvVVâæBDôÒ6÷VçG2"Â6ÖR‚&ÆÄæöFW2"’bb6ÖR‚'F&vWG2"’bb6ÖR‚'GvVVç2"’bb6ÖR‚&FöÒ"’bbgFW"ç7FG2çGvVVç2ÓÓÒÂ¥4ôâç7G&–æv–g’‡²&Vf÷&S¢&Vf÷&Rç7FG2ÂgFW#¢gFW"ç7FG2Ò’“°¢&V6÷&B‚'6ö³¢G6"7–6ÆW3¢uR&V6÷&G2ÂÆ—7FVæW'2æB†V&VÖ–â&÷VæFVB"ÂÖF‚æ'2†gFW"ç7FG2ævÂç&V6÷&G2Ò&Vf÷&Rç7FG2ævÂç&V6÷&G2’ÃÒ2bb&Vf÷&RææöFW2ÓÓÒgFW"ææöFW2bb&Vf÷&RæÆ—7FVæW'2ÓÓÒgFW"æÆ—7FVæW'2bbv—F†–â†&Vf÷&RÂgFW"Âã’Â†VFWF–Â†&Vf÷&RÂgFW"’“°§ÒÕÒÒ“° §66VæR‚&f7F÷'’"Â²Æ&VÃ¢&Æ–fV7–6ÆR"ÂW&Ã¢‡V%vR‡7&2’Â7FW3¢·²æÖS¢&f7F÷'’Æ–fV7–6ÆR"Âv‡“¢&6öçG&7C¢&WVFVBf7F÷'’f—6—G2&VÆV6RF†R†ÆÂw2Æ—7FVæW'2ÂæöFW2æBuR&W6÷W&6W2v†–ÆR&WF–æ–æröæR&÷VæFVB6†&VBæöFR"Â'Vã¢7–æ2†"’Óâ°¢6öç7B²&VæFW&VBÂ6WGFÆVBÂ6æ6†÷BÂG&fVÂÂ†VFWF–ÂÂv—F†–âÒÒv—BG6%6ö²†"“°¢v—B"æWfÇVFR†‚‚’Óâ°¢6öç7BæöFRÒõööövæf7F÷'’ææöFRÂfVVBÒæöFRæfVVBÂ7V'67&–&RÒfVVBç7V'67&–&S°¢v–æF÷råõöf7F÷'”Æ–fRÒ²æöFRÂ7V'67&—F–öç3¢Ó°¢fVVBç7V'67&–&RÒ†fâ’Óâ°¢6öç7BöfbÒ7V'67&–&R†fâ“²ÆWBÆ—fRÒG'VS°¢õöf7F÷'”Æ–fRç7V'67&—F–öç2²³°¢&WGW&â‚’Óâ²–b†Æ—fR’²Æ—fRÒfÇ6S²õöf7F÷'”Æ–fRç7V'67&—F–öç2ÒÓ²Ò&WGW&âöfb‚“²Ó°¢Ó°¢Ò’‚–“°¢òòv&Ò&÷F‚66VæW2Â6òF†R6÷VçG2&VÆ÷r7F'Bg&öÒf—6—BÖFRgFW"F†R–ç7G'VÖVçF–ærà¢v—BG&fVÂ‚&f7F÷'’"“²v—BG&fVÂ‚&‡V""“²v—B6WGFÆVB‚“²v—B&VæFW&VBƒ"“°¢6öç7B&Vf÷&RÒv—B6æ6†÷B‚’Âf—6—G2ÒµÓ°¢f÷"†ÆWB’Ò²’Âc²’²²’°¢v—BG&fVÂ‚&f7F÷'’"“²v—BG&fVÂ‚&‡V""“²v—B6WGFÆVB‚“²v—B&VæFW&VBƒ"“°¢f—6—G2çW6‚†v—B"æWfÇVFR†‚‚’Óâ°¢6öç7BâÒõööövæf7F÷'’ææöFS°¢&WGW&â²6ÖS¢âÓÓÒõöf7F÷'”Æ–fRææöFRÂ7V'67&—F–öç3¢õöf7F÷'”Æ–fRç7V'67&—F–öç2ÂÆ–æW3¢âçÆ6Töbç6—¦RÂÆ6W3¢âæ&—2æÆVæwF‚²âç7FæG2æÆVæwF‚Ó°¢Ò’‚–’“°¢Ð¢6öç7BgFW"Òv—B6æ6†÷B‚’Â6ÖRÒ†¶W’’Óâ&Vf÷&Rç7FG5¶¶W•ÒÓÓÒgFW"ç7FG5¶¶W•Ó°¢&V6÷&B‚'6ö³¢f7F÷'’7–6ÆW3¢öæR&÷VæFVBæöFR7W'f—fW26—‚&÷VæBG&—2ÂF†R†ÆÂw27V'67&—F–öâ&VÆV6VBÂv—F†÷WB&WF–æ–ær66VæRæöFW2ÂF&vWG2÷"DôÒ"Âf—6—G2æWfW'’‚‡b’Óâbç6ÖRbbbç7V'67&—F–öç2ÓÓÒbbbæÆ–æW2ÃÒbçÆ6W2¢bb6ÖR‚&ÆÄæöFW2"’bb6ÖR‚'F&vWG2"’bb6ÖR‚&FöÒ"’bbgFW"ç7FG2çGvVVç2ÓÓÒÂ¥4ôâç7G&–æv–g’‡²f—6—G2Â&Vf÷&S¢&Vf÷&Rç7FG2ÂgFW#¢gFW"ç7FG2Ò’“°¢&V6÷&B‚'6ö³¢f7F÷'’7–6ÆW3¢uR&V6÷&G2ÂÆ—7FVæW'2æB&WF–æVB†V&VÖ–â&÷VæFVB"ÂÖF‚æ'2†gFW"ç7FG2ævÂç&V6÷&G2Ò&Vf÷&Rç7FG2ævÂç&V6÷&G2’ÃÒ2bb&Vf÷&RææöFW2ÓÓÒgFW"ææöFW2bb&Vf÷&RæÆ—7FVæW'2ÓÓÒgFW"æÆ—7FVæW'2bbv—F†–â†&Vf÷&RÂgFW"Âã’Â†VFWF–Â†&Vf÷&RÂgFW"’“°§ÒÕÒÒ“° ¢òòæöFRF–W#¢W&R6ö×WFF–öâ÷fW"v–æF÷rä$ÂVæFW"Ö–æ–ÖÂDôÒ6†–ÒÂ6ÆÆ–ærF†R6ÖR&ö&RgVæ7F–öç2à¢òò36†V6·2–â&÷WBF‡&VR6V6öæG2Âv–ç7Bã2ãr2öbÆVæ6‚æB&ö÷BW"'&÷w6W"F6²à¢òòF†RÆ–v‡Fæ–ærf7F÷'’–âæöFS¢F†RfVVBw2Gvò6öçG&7G2ÂF†RFVÖòæöFRF†B7FæG2–âf÷"&VÂöæRÂæBF†P¢òòvÆ¶&ÆRfÆö÷"öbF†R†ÆÂÂV6‚F‡&÷Vv‚F†RÖöGVÆRw2÷vâgVæ7F–öç2à¦6öç7Bf7F÷'”6†V6·2Ò„$Â’Óâ°¢6öç7BbÒ$Âæf7F÷'”fVVBÂ'V6¶WBÒ††÷W"’Óâ²6öç7BBÒæWrFFR„FFRåUD2ƒ##bÂ‚Â#bÂ"Â†÷W"ò¢3B’“²&WGW&âBçFô•4õ7G&–ær‚“²Ó°¢ÆWB6WÒ°¢6öç7BWfVçBÒ‡G—RÂ–ÆöBÂ²66†VÖÒbäDTÔòÂ†÷W"ÒfÇ6RÂBÒ²·6WÒÒ·Ò’Óâ‡²66†VÖÂ–C¢#Ó###"ÓC332ÓƒCCBÒ"²7G&–ær†B’çE7F'Bƒ"Â#"’Â6W¢BÂ'V6¶WC¢'V6¶WB††÷W"’ÂæöFS¢'&ö&R"Â÷&–v–ã¢&ö'6W'fVB"Â7G&VÓ¢&Æ—fR"ÂG—RÂ–ÆöBÒ“°¢°¢6öç7Bv‡’Ò†R’Óâbç&VgW6Â†R’ÇÂ&ö²#°¢6öç7B"Ò°¢V&Æ–4f÷'v&C¢v‡’†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢'6ÖÆÂ"Â6÷VçC¢ÒÂ²66†VÖ¢båT$Ä”2Ò’’À¢V&Æ–57FF–öã¢v‡’†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢'6ÖÆÂ"Â7FF–öã¢&&V6‚"ÒÂ²66†VÖ¢båT$Ä”2Ò’’À¢V&Æ–4÷WC¢v‡’†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢'6ÖÆÂ"Â÷WC¢&†&&÷""ÒÂ²66†VÖ¢båT$Ä”2Ò’’À¢V&Æ–4fVS¢v‡’†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢'6ÖÆÂ"ÂfVS¢&GW7B"ÒÂ²66†VÖ¢båT$Ä”2Ò’’À¢FVÖõ&÷WFS¢v‡’†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢&Æ&vR"Â7FF–öã¢&&V6‚"Â÷WC¢&†&&÷""ÂfVS¢&GW7B"Ò’’À¢FVÖôf–ÆVC¢v‡’†WfVçB‚&f÷'v&Bæf–ÆVB"Â²66ÆS¢'6ÖÆÂ"Â7FF–öã¢&&V6‚"Â÷WC¢&†&&÷""Ò’’À¢FVÖôÆö÷¢v‡’†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢'6ÖÆÂ"Â7FF–öã¢&&V6‚"Â÷WC¢&&V6‚"Ò’’À¢FVÖô÷WDöä6†ææVÃ¢v‡’†WfVçB‚&6†ææVÂæ7F—fR"Â²66ÆS¢&Æ&vR"Â7FF–öã¢&&V6‚"Â÷WC¢&†&&÷""Ò’’À¢&V&Ææ6TÆ–æS¢v‡’†WfVçB‚'&V&Ææ6Rç7V66VVFVB"Â²66ÆS¢&Æ&vR"Â7FF–öã¢&&V6‚"ÒÂ²†÷W#¢G'VRÒ’’À¢&V&Ææ6TÖ–çWFS¢v‡’†WfVçB‚'&V&Ææ6Rç7V66VVFVB"Â²66ÆS¢&Æ&vR"Ò’’À¢&V&Ææ6T†÷W#¢v‡’†WfVçB‚'&V&Ææ6Rç7V66VVFVB"Â²66ÆS¢&Æ&vR"ÒÂ²†÷W#¢G'VRÒ’¢Ó°¢&V6÷&B‚&f7F÷'’fVVC¢f÷VæG'’w2V&Æ–2WfVçG26''’æòÆ–æRÂ&÷WFR÷"fVS²F†RFVÖò6öçG&7BæÖW2f÷'v&Bw2GvòF–ffW&VçBÆ–æW2æBæ÷F†–ærVÇ6S²&V&Ææ6RæWfW"æÖW2Æ–æRæB—2F–ÖVBFòF†R†÷W""Â"çV&Æ–4f÷'v&BÓÓÒ&ö²"bb"çV&Æ–57FF–öâÓÓÒ'–ÆöB"bb"çV&Æ–4÷WBÓÓÒ'–ÆöB"bb"çV&Æ–4fVRÓÓÒ'–ÆöB"bb"æFVÖõ&÷WFRÓÓÒ&ö²"bb"æFVÖôf–ÆVBÓÓÒ&ö²"bb"æFVÖôÆö÷ÓÓÒ&÷WB"bb"æFVÖô÷WDöä6†ææVÂÓÓÒ&÷WB"bb"ç&V&Ææ6TÆ–æRÓÓÒ'&V&Ææ6R"bb"ç&V&Ææ6TÖ–çWFRÓÓÒ&'V6¶WB"bb"ç&V&Ææ6T†÷W"ÓÓÒ&ö²"Â¥4ôâç7G&–æv–g’‡"’“°¢6öç7BfVVBÒbæ7&VFR‡²æ÷s¢‚’ÓâÒ’Â6VVâÒµÓ°¢fVVBç7V'67&–&R‚†R’Óâ6VVâçW6‚†Rç6W’“°¢f÷"†6öç7BBöb³Â"Â"ÂRÂeÒ’fVVBæ66WB†WfVçB‚&f÷'v&Bç6WGFÆVB"Â²66ÆS¢'6ÖÆÂ"Â7FF–öã¢&&V6‚"Â÷WC¢&†&&÷""ÒÂ²BÒ’“°¢6öç7B2ÒfVVBæ6÷VçG3°¢&V6÷&B‚&f7F÷'’fVVC¢&WVFVB6W—2öæRWfVçBæB6¶—VBöæR—26÷VçFVB2v"Â2æ66WFVBÓÓÒBbb2æGWÆ–6FW2ÓÓÒbb2æv2ÓÓÒbb6VVâæ¦ö–â‚’ÓÓÒ#Ã"ÃRÃb"Â¥4ôâç7G&–æv–g’‡²6÷VçG3¢2Â6VVâÒ’“°¢Ð¢°¢òòGvòFVÖòæöFW2öâF†R6ÖR6VVBæB6Æö6²Æ’F†R6ÖR6†÷s²F†RfVVBF¶W2WfW'’WfVçB—BÆ—2à¢6öç7BÆ’Ò‡6V6öæG2’Óâ°¢6öç7BÖö6²Ò$Âæf7F÷'”Öö6²æ7&VFR‡²6VVC¢#Âæ÷s¢‚’ÓâFFRåUD2ƒ##bÂ‚Â#bÂ"’Ò’ÂfVVBÒbæ7&VFR‡²æ÷s¢‚’ÓâÒ’ÂWfVçG2ÒµÓ°¢ÆWBBÒ°¢6öç7BF¶RÒ†R’Óâ²WfVçG2çW6‚‡²BÂG—S¢RçG—RÂ¢Rç–ÆöBÒ“²fVVBæ66WB†R“²Ó°¢Öö6²ç&WÆ’‡F¶R“°¢f÷"ƒ²BÂ6V6öæG3²B³Òã#R’Öö6²çWFFRƒã#RÂF¶R“°¢&WGW&â²WfVçG2Â6÷VçG3¢fVVBæ6÷VçG2ÂÖö6²Ó°¢Ó°¢6öç7BÒÆ’ƒ3’Â"ÒÆ’ƒ3’Â6ÖRÒ¥4ôâç7G&–æv–g’†æWfVçG2’ÓÓÒ¥4ôâç7G&–æv–g’†"æWfVçG2“°¢6öç7Bf÷'v&G2ÒæWfVçG2æf–ÇFW"‚†R’ÓâRçG—Rç7F'G5v—F‚‚&f÷'v&Bâ"’’Â&÷WFVBÒf÷'v&G2æWfW'’‚†R’ÓâRçæ÷WBbbRçæ÷WBÓÒRçç7FF–öâ“°¢6öç7B&–rÒf÷'v&G2æf–ÇFW"‚†R’ÓâRçç66ÆRÓÓÒ&Æ&vR"ÇÂRçç66ÆRÓÓÒ'fW'•öÆ&vR"’æÆVæwFƒ°¢&V6÷&B‚&f7F÷'’FVÖòæöFS¢F†R6ÖR6VVBÆ—2F†R6ÖR6†÷rÂF†RfVVBF¶W2WfW'’WfVçBÂæBWfW'’f÷'v&B'Vç2g&öÒöæRÆ–æR÷WBÆöæræ÷F†W"Âæ÷ræBF†VâÆ&vRöæR"Â6ÖRbbæ6÷VçG2æG&÷VBÓÓÒbbæ6÷VçG2æv2ÓÓÒbbf÷'v&G2æÆVæwF‚âbb&÷WFVBbb&–râ2Â¥4ôâç7G&–æv–g’‡²6ÖRÂ6÷VçG3¢æ6÷VçG2Âf÷'v&G3¢f÷'v&G2æÆVæwF‚Â&÷WFVBÂ&–rÒ’“°¢òòF†Rf÷&vR†2v÷&²v—F†–â6V6öæG2öbf—6—BæBæWfW"v—G2ÆöærÂæBF†R6‡W&âæV—F†W"G&–ç2æ÷"fÆööG2F†RÆ–æW2à¢6öç7Bf÷&vRÒæWfVçG2æf–ÇFW"‚†R’ÓâRçBâbb†RçG—RÓÓÒ&6†ææVÂæ÷Væ–ær"ÇÂRçG—RÓÓÒ&6†ææVÂæ6Æ÷6VB"’’æÖ‚†R’ÓâRçB’Âv2Òf÷&vRç6Æ–6Rƒ’æÖ‚‡BÂ’’ÓâBÒf÷&vU¶•Ò“°¢6öç7B6÷VçG2ÒæWfVçG2æf–ÇFW"‚†R’ÓâRçBâbbRçæ6†ææVÅö6÷VçBÓÒVæFVf–æVB’æÖ‚†R’ÓâRçæ6†ææVÅö6÷VçB’Â7F'BÒæÖö6²ç6æ6†÷Bæ6†ææVÇ2æÆVæwFƒ°¢&V6÷&B‚&f7F÷'’FVÖòæöFS¢F†Rf—'7B6†ææVÂ&V6†W2F†Rf÷&vRv—F†–âFVâ6V6öæG2æBF†Rf÷&vRæWfW"v—G2Ö–çWFRÂv†–ÆRF†RçVÖ&W"öb÷VâÆ–æW2†öÆG27FVG’"Âf÷&vU³ÒÂbbÖF‚æÖ‚‚ââæv2’Âcbb6÷VçG2æÆVæwF‚â‚bbÖF‚æÖ‚‚ââæ6÷VçG2’ÒÖF‚æÖ–â‚ââæ6÷VçG2’ÃÒ"Â¥4ôâç7G&–æv–g’‡²f—'7C¢f÷&vU³ÒÂÆöævW7C¢ÖF‚æÖ‚‚ââæv2’Â÷VäÆ–æW3¢´ÖF‚æÖ–â‚ââæ6÷VçG2’ÂÖF‚æÖ‚‚ââæ6÷VçG2•ÒÂ6†ææVÇ3¢7F'BÒ’“°¢Ð§Ó°¦6öç7Bö¶W$6†V6·2Ò„$Â’Óâ°¢6öç7B"Ò$Âçö¶W%'VÆW2Â2ÒFW‡BÓâ##3CScsƒ•D¥´"æ–æFW„öb‡FW‡E³Ò’²&6F‡2"æ–æFW„öb‡FW‡E³Ò’¢3°¢6öç7B6&G2ÒFW‡BÓâFW‡Bç7Æ—B‚""’æÖ†2“°¢6öç7Bf—‡GW&W2Ò²$2¦B–‚g262"Â$2B–‚g262"Â$2B–‚—262"Â$2B‚g262"Â$2&B6‚G2V2"Â$2¦2–2f262"Â$2B‚g2f2"Â$2B‚262"Â%F2¦22¶22%Ó°¢6öç7B66÷&W2Òf—‡GW&W2æÖ‡FW‡BÓâ"æWfÇVFR†6&G2‡FW‡B’’“°¢&V6÷&B‚'ö¶W"'VÆW3¢ÆÂ†æB6FVv÷&–W2Â6RÖÆ÷r7G&–v‡BÂ¶–6¶W'2æB6WfVâÖ6&B&W7B†æB"Â66÷&W2æWfW'’‚‡2Â’’Óâ2æ6FVv÷'’ÓÓÒ’bb‚’ÇÂ2ç66÷&Râ66÷&W5¶’ÒÒç66÷&R’’bb"æWfÇVFR†6&G2‚#&26BF‚W2f2"’’ç66÷&Râ66÷&W5³EÒç66÷&Rbb"æWfÇVFR†6&G2‚$2B¶‚262"’’ç66÷&Râ"æWfÇVFR†6&G2‚$2B¶‚§262"’’ç66÷&Rbb"æWfÇVFR†6&G2‚%F2¦22¶22&B&‚"’’ç66÷&RÓÓÒ66÷&W5³…Òç66÷&R“°¢6öç7B&ö&BÒ6&G2‚#&26Bv‚—2¦2"’Â†æG2Ò²$2B"Â$¶2¶B"Â%2B"Â%F2†B%Ó°¢6öç7B6VG2ÒæWr'&’…"å4TE2’æf–ÆÂ†çVÆÂ“°¢³SÂÂ#Â#Òæf÷$V6‚‚†âÂ’’Óâ²6VG5¶•ÒÒ²6&G3¢6&G2††æG5¶•Ò’ÂF÷FÄ&WC¢âÂ–ä†æC¢G'VRÂföÆFVC¢’ÓÓÒ2Ó²Ò“°¢6öç7B–BÒ"ç6WGFÆR‡6VG2Â&ö&BÂ“°¢&V6÷&B‚'ö¶W"÷G3¢VæWVÂÆÂÖ–ç27Æ—BÖ–âæB6–FR÷G2ÂföÆFVB6†—2&VÖ–âæB&¶R—2¦W&ò"Â–Bæv&G2æ¦ö–â‚’ÓÓÒ³#ÂSÂ#ÂââææWr'&’…"å4TE2Ò2’æf–ÆÂƒ•Òæ¦ö–â‚’bb–Bç÷G2ç&VGV6R‚†âÂ’Óââ²æÖ÷VçBÂ’ÓÓÒSSÂ¥4ôâç7G&–æv–g’‡–B’“°¢6VG5³5ÒçF÷FÄ&WBÒ°¢6öç7B&VgVæBÒ"ç6WGFÆR‡6VG2Â&ö&BÂ“°¢&V6÷&B‚'ö¶W"÷G3¢Væ6ÆÆVBW†6W72—2&VgVæFVB"Â&VgVæBæv&G5³%ÒÓÓÒbb&VgVæBç÷G2æB‚Ó’ç&VgVæBbb&VgVæBç÷G2æB‚Ó’æÖ÷VçBÓÓÒ“°¢6öç7BF–U6VG2ÒæWr'&’…"å4TE2’æf–ÆÂ†çVÆÂ“°¢f÷"†ÆWB’Ò²’Â3²’²²’F–U6VG5¶•ÒÒ²6&G3¢6&G2††æG5¶•Ò’ÂF÷FÄ&WC¢Â–ä†æC¢G'VRÂföÆFVC¢’ÓÓÒÓ°¢6öç7BF–RÒ"ç6WGFÆR‡F–U6VG2Â6&G2‚%G2§22·22"’Â“°¢&V6÷&B‚'ö¶W"÷G3¢&ö&BÆ—2æBF†RöFB6†—vöW26Æö6·v—6RÆVgBöbF†R'WGFöâ"ÂF–Ræv&G5³ÒÓÓÒbbF–Ræv&G5³%ÒÓÓÒ"“°¢6öç7B6÷W&6RÒ&VDf–ÆU7–æ2†¦ö–â‡&ö÷BÂ'7&2ö§2÷ö¶W"×'VÆW2æ§2"’Â'WFc‚"“°¢ÆWBG&w2Ò°¢6öç7B&V¦V7F–öâÒ²v–æF÷s¢·ÒÂ7'—Fó¢²vWE&æFöÕfÇVW2†’²³ÒÒG&w2²²òB¢†fffffffc²&WGW&â²ÒÒÓ°¢'Vä–äæWt6öçFW‡B‡6÷W&6RÂ&V¦V7F–öâ“°¢&V6÷&B‚'ö¶W"6‡VffÆS¢&V¦V7G2ÖöGVÆòÖ&–2F–Â&Vf÷&R&WGW&æ–ær&÷VæFVB–çFVvW""Â&V¦V7F–öâçv–æF÷rä$Âçö¶W%'VÆW2ç&æFöÔ–çBƒ2’ÓÓÒbbG&w2ÓÓÒ"“°¢6öç7BVæf–Æ&ÆRÒ²v–æF÷s¢·ÒÓ²'Vä–äæWt6öçFW‡B‡6÷W&6RÂVæf–Æ&ÆR“°¢6öç7B7F÷VBÒVæf–Æ&ÆRçv–æF÷rä$Âçö¶W%'VÆW2æ7&VFR‚“²7F÷VBæ¦ö–â‚&"Â$"“²7F÷VBæ¦ö–â‚&""Â$""“°¢ÆWB6V7W&Tf–ÆVBÒfÇ6S²G'’²7F÷VBç7F'B‚“²Ò6F6‚²6V7W&Tf–ÆVBÒG'VS²Ð¢&V6÷&B‚'ö¶W"6‡VffÆS¢Ö—76–ær6V7W&RVçG&÷’f–Ç2&Vf÷&R†æB÷"&Ææ6R×WFF–öâ"Â6V7W&Tf–ÆVBbb7F÷VBç6æ6†÷B‚’æ†æBÓÓÒbb7F÷VBç6æ6†÷B‚’ç6VG5³Òç7F6²ÓÓÒ“°¢ÆWB6VVBÒƒs“#3°¢6öç7B6VVFVBÒ²v–æF÷s¢·ÒÂ7'—Fó¢²vWE&æFöÕfÇVW2†’²6VVBãÒ6VVBÃÂ3²6VVBãÒ6VVBããâs²6VVBãÒ6VVBÃÂS²³ÒÒ6VVBããâ²&WGW&â²ÒÒÓ°¢'Vä–äæWt6öçFW‡B‡6÷W&6RÂ6VVFVB“°¢6öç7BÒ6VVFVBçv–æF÷rä$Âçö¶W%'VÆW2ÂF&ÆRÒæ7&VFR‚“°¢f÷"†ÆWB’Ò²’Âå4TE3²’²²’F&ÆRæ¦ö–â‚'"²’Â%Æ–W""²’ÂG'VR“°¢ÆWBgVÆÂÒfÇ6S²G'’²F&ÆRæ¦ö–â‚&W‡G&"Â$W‡G&"“²Ò6F6‚²gVÆÂÒG'VS²Ð¢F&ÆRç7F'B‚“°¢6öç7BV&Æ–5f–WrÒF&ÆRç6æ6†÷B‚’Â÷vâÒF&ÆRç6æ6†÷B‚'"’ÂGW&ä–BÒV&Æ–5f–Wrç6VG5·V&Æ–5f–WrçGW&åÒæ–C°¢6öç7B&Vf÷&RÒ¥4ôâç7G&–æv–g’‡F&ÆRç6æ6†÷B‡GW&ä–B’“°¢ÆWB&V¦V7FVBÒ°¢f÷"†6öç7BfÇVRöb²ÓÂãRÂ–æf–æ—G’ÂÒ’G'’²F&ÆRæ7B‡GW&ä–BÂ'&—6R"ÂfÇVR“²Ò6F6‚²&V¦V7FVB²³²Ð¢G'’²F&ÆRæ7B‚&æ÷B×6VFVB"Â&6ÆÂ"“²Ò6F6‚²&V¦V7FVB²³²Ð¢G'’²F&ÆRç7F'B‚“²Ò6F6‚²&V¦V7FVB²³²Ð¢G'’²F&ÆRæÆVfR‚'"“²Ò6F6‚²&V¦V7FVB²³²Ð¢&V6÷&B‚'ö¶W"7F–öç3¢æ–æR×6VB6Â–çfÆ–B&—6W2Â÷WBÖöb×GW&âæBÖ–BÖ†æB6VB6†ævW2f–ÂFöÖ–6ÆÇ’"ÂgVÆÂbb&V¦V7FVBÓÓÒrbb¥4ôâç7G&–æv–g’‡F&ÆRç6æ6†÷B‡GW&ä–B’’ÓÓÒ&Vf÷&R“°¢÷vâç6VG5³Òæ6&G5³ÒÒÓ“²÷vâç6VG5³Òç7F6²Ò°¢&V6÷&B‚'ö¶W"&—f7“¢7V7FF÷"æB÷F†W"×6VB6æ6†÷G2†–FR†öÆR6&G2æB6æ6†÷B×WFF–öâ6ææ÷BÇFW"Æ’"ÂV&Æ–5f–Wrç6VG2æWfW'’‡2Óâ2æ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’’bbF&ÆRç6æ6†÷B‚'"’ç6VG5³Òæ6&G2æWfW'’†2ÓâçVÖ&W"æ—4–çFVvW"†2’bb2ãÒ’bb÷vâç6VG2ç6Æ–6Rƒ’æWfW'’‡2Óâ2æ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’’bbF&ÆRç6æ6†÷B‚’ç6VG5³Òç7F6²âbb‚&FV6²"–âV&Æ–5f–Wr’“°¢ÆWB6öç6W'fF–öâÒG'VRÂ†–FFVäföÆFVBÒG'VRÂ&÷VæFVBÒG'VRÂf–æ—6†VBÒ°¢f÷"†ÆWB‚Ò²‚Â3²‚²²’°¢–b†‚’²f÷"†ÆWB’Ò²’Âå4TE3²’²²’F&ÆRç&Vf–ÆÂ‚'"²’“²F&ÆRç7F'B‚“²Ð¢ÆWB2ÒF&ÆRç6æ6†÷B‚’ÂF÷FÂÒ2ç÷B²2ç6VG2ç&VGV6R‚†âÂ’Óââ²ç7F6²Â’Â7FW2Ò°¢v†–ÆR‡F&ÆRçÆ––ærbb7FW2²²Â’°¢6öç7B–BÒ2ç6VG5·2çGW&åÒæ–BÂÂÒF&ÆRç6æ6†÷B†–B’æÆVvÃ°¢òòÆÂÖ–ç2–çFW&ÆVfVBv—F‚6†÷'B6ÆÇ2ÂföÆG2æBgVÆÂ&—6W2W†W&6—6R&VÀ¢òò6WGFÆVÖVçBF‡27&÷726†æv–ær7F6·3²F†—2—2æ÷B6‡VffÆR&ööbà¢–b†‚R2ÓÓÒbbÂæ6å&—6R’F&ÆRæ7B†–BÂ'&—6R"ÂÂæÖ‚“°¢VÇ6Ræ&÷D7F–öâ‡F&ÆRÂ–B“°¢2ÒF&ÆRç6æ6†÷B‚“°¢6öç6W'fF–öâÒ6öç6W'fF–öâbb2ç÷B²2ç6VG2ç&VGV6R‚†âÂ’Óââ²ç7F6²Â’ÓÓÒF÷FÂbb2ç6VG2æWfW'’‡ÓâçVÖ&W"æ—56fT–çFVvW"‡ç7F6²’bbç7F6²ãÒ“°¢Ð¢f–æ—6†VB³Ò2ç†6RÓÓÒ'6†÷vF÷vâ"ò¢°¢†–FFVäföÆFVBÒ†–FFVäföÆFVBbb2ç6VG2æf–ÇFW"‡ÓâæföÆFVB’æWfW'’‡Óâæ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’“°¢&÷VæFVBÒ&÷VæFVBbb2æ†—7F÷'’æÆVæwF‚ÃÒ"bb2æ&ö&BæÆVæwF‚ÃÒS°¢Ð¢&V6÷&B‚'ö¶W"Æ—F‡&÷Vvƒ¢3æ–æR×Æ–W"†æG2FW&Ö–æFRv—F‚6öç6W'fVBv†öÆR6†—2Â&÷VæFVB7FFRæBföÆFVB6&G2&—fFR"Âf–æ—6†VBÓÓÒ3bb6öç6W'fF–öâbb†–FFVäföÆFVBbb&÷VæFVBÂ¥4ôâç7G&–æv–g’‡²f–æ—6†VBÂ6öç6W'fF–öâÂ†–FFVäföÆFVBÂ&÷VæFVBÒ’“°¢6öç7B†VG5WÒæ7&VFR‚“²†VG5Wæ¦ö–â‚&"Â$"“²†VG5Wæ¦ö–â‚&""Â$""“²†VG5Wç7F'B‚“°¢6öç7B‡RÒ†VG5Wç6æ6†÷B‚“²†VG5Wæ7B‚&"Â&6ÆÂ"“²†VG5Wæ7B‚&""Â&6†V6²"“°¢&V6÷&B‚'ö¶W"†VG2×W¢'WGFöâ—26ÖÆÂ&Æ–æBÂ7G2f—'7B&VfÆ÷æBÆ7B÷7FfÆ÷"Â‡RæFVÆW"ÓÓÒbb‡RçGW&âÓÓÒbb‡Rç6VG5³Òç&÷VæD&WBÓÓÒRbb‡Rç6VG5³Òç&÷VæD&WBÓÓÒbb†VG5Wç6æ6†÷B‚’ç†6RÓÓÒ&fÆ÷"bb†VG5Wç6æ6†÷B‚’çGW&âÓÓÒ“°¢°¢6öç7B&÷w2ÒµÓ°¢òòF‡&VRÆ–W'3¢÷BRÂf6–ærâ÷B×6—¦VB&—6R6ÆÇ2f—'7BÀ¢òòF†Vâ&—6W2#RÂf÷"F÷FÂöb3R†æ÷B#R÷"CR’à¢f÷"†6öç7B·&W6WBÂW‡V7FVEÒöbµ²&Ö–â"Â#ÒÂ²&†Æb"Â#5ÒÂ²'F‡&VUV'FW""Â#•ÒÂ²'÷B"Â3UÒÂ²&ÆÂ"ÂÕÒ’°¢6öç7BBÒæ7&VFR‚“²f÷"†6öç7B–Böb²&"Â&""Â&2%Ò’Bæ¦ö–â†–BÂ–B“°¢Bç7F'B‚“²6öç7B&Vf÷&RÒBç6æ6†÷B‚&"’ÂÖ÷VçBÒ$Âçö¶W$‡VBæ&WDÖ÷VçB†&Vf÷&RÂ&W6WB“°¢Bæ7B‚&"Â'&—6R"ÂÖ÷VçB“²6öç7BgFW"ÒBç6æ6†÷B‚“°¢&÷w2çW6‚‡²&W6WBÂÖ÷VçBÂö³¢Ö÷VçBÓÓÒW‡V7FVBbbgFW"ç6VG5³Òç&÷VæD&WBÓÓÒW‡V7FVBbbgFW"ç÷BÓÓÒW‡V7FVB²RÒ“°¢Ð¢&V6÷&B‚'ö¶W"6—¦–æs¢&W6WG2–æ6ÇVFRF†R6ÆÂÂ7V&Ö—BÆVvÂ7G&VWBF÷FÇ2æBÖ÷fRF†RF—7Æ–VB6†—2"Â&÷w2æWfW'’‡"Óâ"æö²’Â¥4ôâç7G&–æv–g’‡&÷w2’“°¢6öç7BBÒæ7&VFR‚“²f÷"†6öç7B–Böb²&"Â&""Â&2%Ò’Bæ¦ö–â†–BÂ–B“°¢Bç7F'B‚“²Bæ7B‚&"Â'&—6R"Â““R“°¢6öç7B6†÷'BÒBç6æ6†÷B‚&""’ÂÖ÷VçBÒ$Âçö¶W$‡VBæ&WDÖ÷VçB‡6†÷'BÂ'÷B"“°¢Bæ7B‚&""Â'&—6R"ÂÖ÷VçB“²Bæ7B‚&2"Â&6ÆÂ"“²6öç7BÆö6¶VBÒBç6æ6†÷B‚&"“°¢&V6÷&B‚'ö¶W"6—¦–æs¢6†÷'BÆÂÖ–â62F†R&W6WBæBæWfW"'—76W26Æ÷6VB&—6R&–v‡G2"Â6†÷'BæÆVvÂæÖ–ââ6†÷'BæÆVvÂæÖ‚bbÖ÷VçBÓÓÒbbÆö6¶VBæÆVvÂæ6å&—6Rbb$Âçö¶W$‡VBæ&WDÖ÷VçB†Æö6¶VBÂ&ÆÂ"’ÓÓÒçVÆÂ“°¢&V6÷&B‚'ö¶W"V&Æ–27FFS¢&Æ–æBÖ&¶W'2æB6öçG&–'WF–öç2&RW‡÷6VBv—F†÷WB&—fFR6&G2"Â‡Rç6ÖÆÄ&Æ–æBÓÓÒ‡RæFVÆW"bb‡Ræ&–t&Æ–æBÓÓÒbb‡Rç6VG5³ÒçF÷FÄ&WBÓÓÒRbb‡Rç6VG5³ÒçF÷FÄ&WBÓÓÒbb‡Rç6VG5³ÒæÆ7D7F–öâÓÓÒ%6ÖÆÂ&Æ–æB"bb‡Rç6VG2æWfW'’‡ÓâÇÂæ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’’“°¢Ð¢6öç7BvÆ²Ò$Âçö¶W$ÖöFVÇ2çvÆ¶&ÆRÂ7F÷"Ò²&öG•&F—W3¢ãcRÓ°¢&V6÷&B‚'ö¶W"fÆö÷#¢v–FR7V7FF÷'26âG&fW'6RF†RÖ–âæB&÷r—6ÆW3²F&ÆRæB6†—"7vVW26öÆÆ–FR"ÂvÆ²ƒÂ3BÂÂÓ3BÂÂ"Â7F÷"’bbvÆ²‚Ó#Â‚Â#Â‚ÂÂ"Â7F÷"’bbvÆ²‚Ó‚Â#BÂÓBÂ#BÂÂ"Â7F÷"’bbvÆ²ƒ#"ÂÂ#bÂÂÂ"Â7F÷"’“°¢°¢òò6öçG&7C¢6†æv–ærF†R66VæW'’GW&–ær†æB×W7B¶VW–6²F&vWG2À¢òò6†—'2ÂFVÆW'2æB&—fFR÷V&Æ–26&BæöFW2Æ—fRv—F†÷WBw&÷v–ærF†R&ööÒà¢6öç7B&ööÒÒ$Âçö¶W$ÖöFVÇ2æ'V–ÆB‚’ÂF&vWG2Ò&ööÒçF&ÆW2æÖ‡BÓâBçF÷’ÂFVÆW'2Ò&ööÒçF&ÆW2æÖ‡BÓâBævVçB“°¢6öç7B6†—'2Ò&ööÒçF&ÆW2æÖ‡BÓâBæ6†—'2ç6Æ–6R‚’’Â6÷VçBÒæöFRÓâ²æöFRæ6†–ÆG&Vâç&VGV6R‚†âÂ2’Óââ²6÷VçB†2’Â“°¢6öç7B&6VÆ–æRÒ6÷VçB‡&ööÒç&ö÷B’Âf—'7BÒ&ööÒçF&ÆW5³ÒÂf6RÒ$Âçö¶W$6&G2ævVöÖWG'’ƒ“°¢f—'7Bæ&ö&E³ÒævVöÖWG'’Òf6S²f—'7Bæ&ö&E³Òçf—6–&ÆRÒG'VS²f—'7Bæ&6·5³Òçf—6–&ÆRÒG'VS²f—'7Bæ6†—5³Òç66ÆRç’Òs°¢ÆWB7F&ÆRÒG'VS°¢G'’°¢f÷"†ÆWB72Ò²72Â#²72²²’f÷"†6öç7BF†VÖRöb$Âçö¶W%F†VÖW2çF†VÖW2’°¢&ööÒç6WEF†VÖR‡F†VÖRæ–B“°¢7F&ÆRbcÒ&ööÒçF†VÖRÓÓÒF†VÖRæ–Bbb&ööÒç&ö÷Bæ6†–ÆG&VâæÆVæwF‚ÓÓÒb`¢&ööÒçF&ÆW2æWfW'’‚‡BÂ’’ÓâBçF÷ÓÓÒF&vWG5¶•ÒbbBævVçBÓÓÒFVÆW'5¶•ÒbbBæ6†—'2æWfW'’‚†2Â¢’Óâ2ÓÓÒ6†—'5¶•Õ¶¥Ò’’b`¢f—'7Bæ&ö&E³ÒævVöÖWG'’ÓÓÒf6Rbbf—'7Bæ&ö&E³Òçf—6–&ÆRbbf—'7Bæ&6·5³Òçf—6–&ÆRbbf—'7Bæ6†—5³Òç66ÆRç’ÓÓÒs°¢Ð¢&ööÒç6WEF†VÖR‚&vG6'’"“°¢&V6÷&B‚'ö¶W"F†VÖW3¢&WVFVB7v—F6†W2&W6W'fR6VG2ÂFVÆW'2æBFVÇB6&G2v—F‚&÷VæFVB66VæR"Â7F&ÆRbb6÷VçB‡&ööÒç&ö÷B’ÓÓÒ&6VÆ–æRbb$Âçö¶W$ÖöFVÇ2ævVöÖWG'’‚&–çfÆ–B"’ÓÓÒ$Âçö¶W$ÖöFVÇ2ævVöÖWG'’‚&vG6'’"’“°¢Òf–æÆÇ’²f÷"†6öç7BBöb&ööÒçF&ÆW2’BævVçBæF—7÷6R‚“²Ð¢Ð§Ó°¦6öç7Bö¶W%&÷Fö6öÄ6†V6·2Ò7–æ2‚’Óâ°¢6öç7B²ÆöE&÷Fö6öÂÂ6÷W&6S¢&÷Fö6öÅ6÷W&6RÒÒv—B–×÷'B‚"ââ÷6W'fW"÷ö¶W"öÆöBæÖ§2"“°¢6öç7B²7&VFTT4D‚Â&æFöÔ'—FW2ÒÒv—B–×÷'B‚&æöFS¦7'—Fò"“°¢6öç7B²7&VFUö¶W%6W'fW"ÒÒv—B–×÷'B‚"ââ÷6W'fW"÷ö¶W"÷6W'fW"æÖ§2"“°¢6öç7B²v÷&¶W"ÒÒv—B–×÷'B‚&æöFS§v÷&¶W%÷F‡&VG2"“°¢6öç7B$ÂÒÆöE&÷Fö6öÂ‚’Â2Ò$Âçö¶W$7'—FòÂÒÒ$Âçö¶W$ÖF6‚ÂRÒ2æÖFƒ°¢6öç7B6ÆöæRÒfÇVRÓâ¥4ôâç'6R„¥4ôâç7G&–æv–g’‡fÇVR’“°¢6öç7B6†V6²Ò†6öæF—F–öâÂÖW76vR’Óâ²–b‚6öæF—F–öâ’F‡&÷ræWrW'&÷"†ÖW76vR“²Ó°¢6öç7B&V¦V7G2Ò7–æ2fâÓâ²G'’²v—Bfâ‚“²&WGW&âfÇ6S²Ò6F6‚²&WGW&âG'VS²ÒÓ°¢G'’°¢6öç7B66Æ'2Ò³âÂ&âÂ6âÂRäâÒâÂââä'&’æg&öÒ‡²ÆVæwFƒ¢"ÒÂ‚’Óâ&–t–çB‚#‚"²&æFöÔ'—FW2ƒ3"’çFõ7G&–ær‚&†W‚"’’R„RäâÒâ’²â•Ó°¢f÷"†6öç7Bâöb66Æ'2’°¢6öç7BæF—fRÒ7&VFTT4D‚‚'&–ÖS#Sgc"“²æF—fRç6WE&—fFT¶W’„'VffW"æg&öÒ†âçFõ7G&–ærƒb’çE7F'BƒcBÂ#"’Â&†W‚"’“°¢6öç7BÒRæ×VÂ„RärÂâ“²6†V6²„RæVæ6öFR‡’ÓÓÒæF—fRævWEV&Æ–4¶W’‚&†W‚"Â'Væ6ö×&W76VB"’Â%Ó#SbF—6w&VW2v—F‚æF—fR÷Vå54Â"“°¢6†V6²„Rç6ÖR‡ÂRæFV6öFR„RæVæ6öFR‡’’’bbRç6ÖR„RæFB‡ÂRç7V"„RäòÂ’’ÂRäò’Â$w&÷W–çfW'6R÷"Væ6öF–ærf–ÆVB"“°¢6öç7BVW"Ò7&VFTT4D‚‚'&–ÖS#Sgc"“²VW"ævVæW&FT¶W—2‚“°¢6öç7B6†&VBÒRæVæ6öFR„Ræ×VÂ„RæFV6öFR‡VW"ævWEV&Æ–4¶W’‚&†W‚"Â'Væ6ö×&W76VB"’’Ââ’’ç6Æ–6Rƒ"Âcb“°¢6†V6²‡6†&VBÓÓÒæF—fRæ6ö×WFU6V7&WB‡VW"ævWEV&Æ–4¶W’‚’’çFõ7G&–ær‚&†W‚"’Â$T4D‚F—6w&VW2v—F‚æF—fR÷Vå54Â"“°¢Ð¢6†V6²„Rç6ÖR„Ræ×VÂ„RärÂRäâ’ÂRäò’Â%w&öærw&÷W÷&FW""“°¢f÷"†6öç7B&Böb²#"Â#B"²#"ç&WVBƒ#‚’Â#B"²&b"ç&WVBƒ#‚’Â#""²#"ç&WVBƒcB’Â·ÒÂ"%Ò’6†V6²†v—B&V¦V7G2‚‚’ÓâRæFV6öFR†&BÂG'VR’’Â$–çfÆ–BV&Æ–2ö–çB66WFVB"“°¢6öç7BÒ2çÆ–W"‚’Â6–væGW&RÒv—Bç6–vâ‚'FW7B"Â²ã¢Ò“°¢6†V6²†v—B2ç6–væGW&UfÆ–B‡çV&Æ–4¶W’Â'FW7B"Â²ã¢ÒÂ6–væGW&R’bbv—B2ç6–væGW&UfÆ–B‡çV&Æ–4¶W’Â'FW7B"Â²ã¢"ÒÂ6–væGW&R’bbv—B2ç6–væGW&UfÆ–B‡çV&Æ–4¶W’Â&÷F†W""Â²ã¢ÒÂ6–væGW&R’Â%6–væGW&RFöÖ–â&–æF–ærf–ÆVB"“°¢æF—7÷6R‚“²6†V6²†v—B&V¦V7G2‚‚’Óâç6–vâ‚'FW7B"Â·Ò’’Â$F—7÷6VB¶W’7F–ÆÂ6–vç2"“°¢&V6÷&B‚'ö¶W"&÷Fö6öÃ¢7W'fR&—F†ÖWF–2ÖF6†W2æF—fRÓ#SbæB&V¦V7G2–çfÆ–Bö–çG2æB6–væGW&W2"ÂG'VR“°¢Ò6F6‚†R’²&V6÷&B‚'ö¶W"&÷Fö6öÃ¢7W'fR&—F†ÖWF–2ÖF6†W2æF—fRÓ#SbæB&V¦V7G2–çfÆ–Bö–çG2æB6–væGW&W2"ÂfÇ6RÂRç7F6²“²&WGW&ã²Ð¢G'’°¢ÆWB6÷VçBÒ°¢6öç7BW†W&6—6RÒ7–æ2Óâ°¢6öç7B÷WBÒv—BRçvÆ´æWGv÷&²‡æÖ‚…òÂ’’Óâ’’ÂRç&÷WFR‡’Â7–æ2‡—"Â7v’Óâ7vò·—%³ÒÂ—%³ÕÒ¢—"“°¢6†V6²‡æWfW'’‚†FW7F–æF–öâÂ’’Óâ÷WE¶FW7F–æF–öåÒÓÓÒ’’Â%W&×WFF–öâv2æ÷B&÷WFVB"“²6÷VçB²³°¢Ó°¢6öç7BW&×2ÒgVæ7F–öâ¢†Â7F'BÒ’²–b‡7F'BÓÓÒæÆVæwF‚’²––VÆBç6Æ–6R‚“²&WGW&ã²Òf÷"†ÆWB’Ò7F'C²’ÂæÆVæwFƒ²’²²’²¶·7F'EÒÂ¶•ÕÒÒ¶¶•ÒÂ·7F'EÕÓ²––VÆB¢W&×2†Â7F'B²“²¶·7F'EÒÂ¶•ÕÒÒ¶¶•ÒÂ·7F'EÕÓ²ÒÓ°¢f÷"†ÆWBâÒ²âÃÒc²â²²’f÷"†6öç7BöbW&×2„'&’æg&öÒ‡²ÆVæwFƒ¢âÒÂ…òÂ’’Óâ’’’’v—BW†W&6—6R‡“°¢f÷"†ÆWB’Ò²’ÂcC²’²²’v—BW†W&6—6R„$Âçö¶W%'VÆW2ç6‡VffÆVDFV6²‚’“°¢6†V6²†v—B&V¦V7G2‚‚’ÓâRç&÷WFR…³ÂÒ’’bb6÷VçBâ“Â$ÖÆf÷&ÖVBW&×WFF–öâ66WFVB"“°¢&V6÷&B‚'ö¶W"&÷Fö6öÃ¢7v—F6‚&÷WF–ær&VÆ—¦W2&&—G&'’W&×WFF–öç2–æ6ÇVF–æröFB7V&æWGv÷&·2"ÂG'VRÂG¶6÷VçGÒ&÷WFW6“°¢Ò6F6‚†R’²&V6÷&B‚'ö¶W"&÷Fö6öÃ¢7v—F6‚&÷WF–ær&VÆ—¦W2&&—G&'’W&×WFF–öç2–æ6ÇVF–æröFB7V&æWGv÷&·2"ÂfÇ6RÂRç7F6²“²&WGW&ã²Ð¢ÆWB6ö×ÆWFVE&V6÷&C°¢G'’°¢6öç7B7F'FVBÒW&f÷&Öæ6Rææ÷r‚’ÂâÒ$Âçö¶W%'VÆW2å4TE2Â–FVçF—F–W2Ò'&’æg&öÒ‡²ÆVæwFƒ¢âÒÂ‚’Óâ2çÆ–W"‚’’Â†æD¶W—2Ò–FVçF—F–W2æÖ‚‚’Óâ2çÆ–W"‚’“°¢6öç7B7F6·2Ò³Â“ÂcÂ#CÂ3#ÂCÂCƒÂScÂcCÒç6Æ–6RƒÂâ’ÂF÷FÂÒ7F6·2ç&VGV6R‚†Â"’Óâ²"“°¢6öç7B–æ—F–ÂÒ²vÖS¢²6VG3¢–FVçF—F–W2æÖ‚‡Â’’Óâ‡²–C¢çV&Æ–4¶W’ÂæÖS¢%Æ–W""²†’²’Â7F6³¢7F6·5¶•ÒÒ’’ÂFVÆW#¢ÓÂ†æC¢ÂfW'6–öã¢ÒÂ6÷VçFW'3¢µÒÂWö6ƒ¢Ó°¢6öç7BÖF6‚ÒÒæ7&VFRƒÂ–æ—F–Â“°¢6öç7B&WVW7BÒ7–æ2†’Â÷ÂFF’Óâ°¢6öç7B7FFRÒÖF6‚ç7FFR‚’ÂfÇVRÒ²F&ÆS¢Â6–væW#¢–FVçF—F–W5¶•ÒçV&Æ–4¶W’Â6W¢‡7FFRæ6÷VçFW'2æf–æB‚…¶–EÒ’Óâ–BÓÓÒ–FVçF—F–W5¶•ÒçV&Æ–4¶W’“òå³ÒÇÂ’²Â÷À¢FF¢²âââ‡7FFRæ6öçFW‡Bbb÷ÓÒ'7F'B"ò²†æC¢7FFRæ6öçFW‡Bææöæ6RÂWö6ƒ¢7FFRæ6öçFW‡BæWö6‚Ò¢·Ò’ÂââæFFÒÓ°¢&WGW&â²ââçfÇVRÂ6–væGW&S¢v—B–FVçF—F–W5¶•Òç6–vâ‚&6öÖÖæB"ÂfÇVR’Ó°¢Ó°¢6öç7B6VæBÒ7–æ2†’Â÷ÂFF’Óâ²6öç7B&WÒv—B&WVW7B†’Â÷ÂFF“²v—BÖF6‚ç7V&Ö—B‡&W“²&WGW&â&W²Ó°¢v—B6VæBƒÂ'7F'B"Â²æöæ6S¢2ææöæ6R‚’Ò“°¢f÷"†ÆWB’Ò²’Âã²’²²’v—B6VæB†’Â&¶W’"Â²¶W“¢†æD¶W—5¶•ÒçV&Æ–4¶W’Â&ööc¢v—B†æD¶W—5¶•Òç6–vâ‚&†æBÖ¶W’"Â¶ÖF6‚ç7FFR‚’æ6öçFW‡BÂ–FVçF—F–W5¶•ÒçV&Æ–4¶W•Ò’Ò“°¢f÷"†ÆWB’Ò²’Âã²’²²’°¢6öç7B2ÒÖF6‚ç7FFR‚’Â6öçFW‡BÒv—BÖF6‚ç6‡VffÆT6öçFW‡B†–FVçF—F–W5¶•ÒçV&Æ–4¶W’“°¢6öç7B6‡VffÆRÒv—B2ç6‡VffÆR‡2æFV6²Â2ævw&VvFRÂ6öçFW‡B“°¢–b‚’’°¢6öç7B&Vf÷&RÒÖF6‚ç7FFR‚’ç&ö÷BÂ'&ö¶VâÒ6ÆöæR‡6‡VffÆR“²'&ö¶VâævFW5³Òæ÷WE³ÒÒ'&ö¶VâævFW5³Òæ÷WE³Ó°¢6†V6²†v—B&V¦V7G2†7–æ2‚’ÓâÖF6‚ç7V&Ö—B†v—B&WVW7B†’Â'6‡VffÆR"Â²6‡VffÆS¢'&ö¶VâÒ’’’bbÖF6‚ç7FFR‚’ç&ö÷BÓÓÒ&Vf÷&RÂ$f÷&vVB6‡VffÆR×WFFVBF†R†æB"“°¢6†V6²†v—B&V¦V7G2‚‚’Óâ2çfW&–g•6‡VffÆR‡2æFV6²Â2ævw&VvFRÂ²'w&öær†æB%ÒÂ6‡VffÆR’’Â%6‡VffÆR&ööb&WÆ–VB–âæ÷F†W"†æB"“°¢6†V6²†v—B&V¦V7G2‚‚’Óâ2çfW&–g•6‡VffÆR‡2æFV6²Â2ævw&VvFRÂ6öçFW‡BÂ²vFW3¢6‡VffÆRævFW2ç6Æ–6Rƒ’Ò’’Â%G'Væ6FVB&ööb66WFVB"“°¢Ð¢v—B6VæB†’Â'6‡VffÆR"Â²6‡VffÆRÒ“°¢Ð¢6†V6²†ÖF6‚ç†6RÓÓÒ&6²"Â$FV6²v2FVÇB&Vf÷&Rw&VVÖVçB"“°¢f÷"†ÆWB’Ò²’Âã²’²²’v—B6VæB†’Â&6²"Â²&ö÷C¢ÖF6‚ç7FFR‚’æ6µ&ö÷BÒ“°¢6öç7B†öÆU7FFRÒÖF6‚ç7FFR‚’Â÷vå÷6—F–öâÒ†öÆU7FFRçÆâæ†öÆW5³Òç÷6—F–öç5³ÒÂæVVBÒ†öÆU7FFRç&WVW7FVE³Òæ–æF–6W3°¢6öç7Bf÷&&–FFVâÒæVVBæÖ†’Óâ¶’ÂµÕÒ“²f÷&&–FFVå³ÒÒ¶÷vå÷6—F–öâÂv—B†æD¶W—5³Òç6†&R††öÆU7FFRæFV6µ¶÷vå÷6—F–öåÒÂÖF6‚ç6†&T6öçFW‡B†–FVçF—F–W5³ÒçV&Æ–4¶W’Â÷vå÷6—F–öâ’•Ó°¢6öç7B&Vf÷&RÒ†öÆU7FFRç&ö÷C°¢6†V6²†v—B&V¦V7G2†7–æ2‚’ÓâÖF6‚ç7V&Ö—B†v—B&WVW7BƒÂ'6†&W2"Â²6†&W3¢f÷&&–FFVâÒ’’’bbÖF6‚ç7FFR‚’ç&ö÷BÓÓÒ&Vf÷&RÂ%&—fFR÷væW"6†&Rv266WFVB&Vf÷&R6†÷vF÷vâ"“°¢ÆWBföÆFVBÒÓÂGWÆ–6FT6†V6¶VBÒfÇ6S°¢f÷"†ÆWBÖ÷fW2Ò²ÖF6‚æ7F—fRbbÖ÷fW2Â#²Ö÷fW2²²’°¢6öç7B2ÒÖF6‚ç7FFR‚“°¢–b…²&†öÆR"Â&&ö&B"Â'6†÷vF÷vâ%Òæ–æ6ÇVFW2‡2ç†6R’’°¢6öç7B&WVW7FVBÒ2ç&WVW7FVBæf–æB‡"Óâ"æ–æF–6W2ç6öÖR†’Óâ2ç6†&W2æf–æB‚…¶–EÒ’Óâ–BÓÓÒ"æ–B“òå³Òç6öÖR‚…¶¥Ò’Óâ¢ÓÓÒ’’’“°¢6†V6²‚&WVW7FVBÂ$æò'F–6—çB6âGfæ6RFVÆ–ær"“°¢6öç7B’Ò–FVçF—F–W2æf–æD–æFW‚‡ÓâçV&Æ–4¶W’ÓÓÒ&WVW7FVBæ–B’Â¶æ÷vâÒæWrÖ‡2ç6†&W2æf–æB‚…¶–EÒ’Óâ–BÓÓÒ&WVW7FVBæ–B“òå³ÒÇÂµÒ’Â6†&W2ÒµÓ°¢f÷"†6öç7B–æFW‚öb&WVW7FVBæ–æF–6W2æf–ÇFW"†–æFW‚Óâ¶æ÷vâæ†2†–æFW‚’’’6†&W2çW6‚…¶–æFW‚Âv—B†æD¶W—5¶•Òç6†&R‡2æFV6µ¶–æFW…ÒÂÖF6‚ç6†&T6öçFW‡B‡&WVW7FVBæ–BÂ–æFW‚’•Ò“°¢–b‡6†&W2æÆVæwF‚’°¢6öç7B·÷6—F–öâÂ&ööeÒÒ6†&W5³Ó°¢6†V6²‚v—B2ç6†&UfÆ–B††æD¶W—5¶•ÒçV&Æ–4¶W’Â2æFV6µ·÷6—F–öåÒÂ²'w&öær6&B6öçFW‡B%ÒÂ&ööb’Â%6†&R66WFVBVæFW"F†Rw&öær6öçFW‡B"“°¢Ð¢v—B6VæB†’Â'6†&W2"Â²6†&W2Ò“°¢ÒVÇ6R–b‡2ç†6RÓÓÒ&&WGF–ær"’°¢–b†föÆFVBÂ’°¢6öç7BÆÄ6&G2ÒµÓ°¢f÷"†ÆWB’Ò²’Âã²’²²’°¢6öç7BÖ–æRÒ2çÆâæ†öÆW5¶•Ó°¢f÷"†6öç7B÷6—F–öâöbÖ–æRç÷6—F–öç2’°¢6öç7B÷F†W"Ò2ç6†&W2æf–ÇFW"‚…¶–EÒ’Óâ–BÓÒÖ–æRæ–B’æÖ‚…²ÂVçG&–W5Ò’ÓâæWrÖ†VçG&–W2’ævWB‡÷6—F–öâ’“°¢6†V6²†÷F†W"æÆVæwF‚ÓÓÒâÒbb÷F†W"æWfW'’„&ööÆVâ’Â$Ö—76–ær&—fFRFVÆ–ær6†&R"“°¢6öç7B6&BÒ†æD¶W—5¶•Òæ÷Vâ‡2æFV6µ·÷6—F–öåÒÂ÷F†W"“²ÆÄ6&G2çW6‚†6&B“°¢6†V6²‚æWrÖ‡2ç6†&W2æf–æB‚…¶–EÒ’Óâ–BÓÓÒÖ–æRæ–B“òå³ÒÇÂµÒ’æ†2‡÷6—F–öâ’Â$÷væW"6†&RÆV¶VBGW&–ær&—fFRFVÆ–ær"“°¢Ð¢Ð¢6†V6²†æWr6WB†ÆÄ6&G2’ç6—¦RÓÓÒâ¢"bb2ç7FFRç6VG2æWfW'’‡Óâæ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’’Â%&—fFR†æG2&Ræ÷BVæ—VRæB†–FFVâ"“°¢föÆFVBÒ2ç7FFRçGW&ã°¢v—B6VæB†föÆFVBÂ&7B"Â²7F–öã¢&föÆB"ÂÖ÷VçC¢çVÆÂÂfW'6–öã¢2ç7FFRçfW'6–öâÒ“°¢ÒVÇ6R°¢6öç7B’Ò2ç7FFRçGW&âÂÆVvÂÒÖF6‚ç7FFR†–FVçF—F–W5¶•ÒçV&Æ–4¶W’’ç7FFRæÆVvÃ°¢6öç7B&WÒv—B6VæB†’Â&7B"Â²7F–öã¢ÆVvÂæ6å&—6Rò'&—6R"¢ÆVvÂæ6†V6²ò&6†V6²"¢&6ÆÂ"ÂÖ÷VçC¢ÆVvÂæ6å&—6RòÆVvÂæÖ‚¢çVÆÂÂfW'6–öã¢2ç7FFRçfW'6–öâÒ“°¢–b‚GWÆ–6FT6†V6¶VB’²6öç7BgFW"ÒÖF6‚ç7FFR‚’ç&ö÷C²v—BÖF6‚ç7V&Ö—B‡&W“²6†V6²†ÖF6‚ç7FFR‚’ç&ö÷BÓÓÒgFW"Â$&WVFVB6öÖÖæB7VçB6†—2Gv–6R"“²6öç7BÇFW&VBÒ6ÆöæR‡&W“²ÇFW&VBæFFæÖ÷VçBÒ²6†V6²†v—B&V¦V7G2‚‚’ÓâÖF6‚ç7V&Ö—B†ÇFW&VB’’Â$ÇFW&VB&WÆ’66WFVB"“²GWÆ–6FT6†V6¶VBÒG'VS²Ð¢Ð¢ÒVÇ6RF‡&÷ræWrW'&÷"‚%VæW‡V7FVB†6R"²2ç†6R“°¢Ð¢6öç7Bf–æÂÒÖF6‚ç7FFR‚“²6ö×ÆWFVE&V6÷&BÒÖF6‚æW‡÷'B‚“°¢6†V6²†f–æÂç†6RÓÓÒ&6ö×ÆWFR"bbf–æÂç7FFRç&W7VÇBç÷G2æÆVæwF‚â2bbf–æÂç7FFRç6VG2ç&VGV6R‚†âÂ’Óââ²ç7F6²Â’ÓÓÒF÷FÂÂ$æ–æR×Æ–W"6–FR÷G2F–Bæ÷B6öç6W'fR6†—2"“°¢6†V6²†f–æÂç7FFRç6VG5¶föÆFVEÒæ6&G2æWfW'’†2Óâ2ÓÓÒçVÆÂ’Â$föÆFVB6&G2&V6ÖRV&Æ–2"“°¢f÷"†6öç7B÷6—F–öâöbf–æÂçÆâæ†öÆW5¶föÆFVEÒç÷6—F–öç2’6†V6²‚æWrÖ†f–æÂç6†&W2æf–æB‚…¶–EÒ’Óâ–BÓÓÒ–FVçF—F–W5¶föÆFVEÒçV&Æ–4¶W’•³Ò’æ†2‡÷6—F–öâ’Â$föÆFVB÷væW"w26†&RVçFW&VBF†R&V6÷&B"“°¢6öç7B&WÆ–VBÒv—BÒç&WÆ’†6ö×ÆWFVE&V6÷&B“°¢6†V6²„2æ6æöæ–6Â‡&WÆ–VBç7FFR‚’ç7FFRç&W7VÇB’ÓÓÒ2æ6æöæ–6Â†f–æÂç7FFRç&W7VÇB’bb&WÆ–VBç7FFR‚’ç&ö÷BÓÓÒf–æÂç&ö÷BÂ$–æFWVæFVçB&WÆ’F—6w&VW2v—F‚F†R–÷WB"“°¢6öç7B6†ævVBÒ6ÆöæR†6ö×ÆWFVE&V6÷&B“²6†ævVBæWfVçG5³Òç&WVW7BæFFææöæ6RÒ2ææöæ6R‚“²6†V6²†v—B&V¦V7G2‚‚’ÓâÒç&WÆ’†6†ævVB’’Â$6†ævVBG&ç67&—B66WFVB"“°¢6öç7B6VÆVBÒ$Âçö¶W%'VÆW2æ7&VFU6VÆVB†–æ—F–ÂævÖR“²6VÆVBç7F'B‚“²6VÆVBæ7B‡6VÆVBç6æ6†÷B‚’ç6VG5·6VÆVBç6æ6†÷B‚’çGW&åÒæ–BÂ'&—6R"Â“²6VÆVBæ&÷'B‚“°¢6†V6²‡6VÆVBç6æ6†÷B‚’ç6VG2æWfW'’‚‡Â’’Óâç7F6²ÓÓÒ7F6·5¶•Ò’bb6VÆVBç6æ6†÷B‚’ç÷BÓÓÒÂ$6æ6VÆVB6öÖÖ—FÖVçG2vW&Ræ÷B&VgVæFVBW†7FÇ’"“°¢f÷"†6öç7B¶W’öb²ââæ–FVçF—F–W2Âââæ†æD¶W—5Ò’¶W’æF—7÷6R‚“°¢&V6÷&B‚'ö¶W"&÷Fö6öÃ¢æ–æR×Æ–W"&—fFRFVÂÂ†÷7F–ÆR&öög2Â6–FR÷G2Â&WÆ’æBföÆFVBÖ6&B&—f7’"ÂG'VRÂG´ÖF‚ç&÷VæB‚‡W&f÷&Öæ6Rææ÷r‚’Ò7F'FVB’ò—×3²G´¥4ôâç7G&–æv–g’†6ö×ÆWFVE&V6÷&B’æÆVæwF‡Ò'—FRV&Æ–2&V6÷&F“°¢Ò6F6‚†R’²&V6÷&B‚'ö¶W"&÷Fö6öÃ¢æ–æR×Æ–W"&—fFRFVÂÂ†÷7F–ÆR&öög2Â6–FR÷G2Â&WÆ’æBföÆFVBÖ6&B&—f7’"ÂfÇ6RÂRç7F6²“²&WGW&ã²Ð¢òòÆ—F‡&÷Vvƒ¢Gvò7GVÂv÷&¶W"6Æ–VçG2¦ö–âF†R…EE6W'f–6RÂ¦ö–çFÇ’6‡VffÆRÀ¢òòÆ’Fò6WGFÆVÖVçBæBW‡÷'B&V6÷&BâF†—2—2æöFRÂæ÷B'&÷w6W"76W'F–öâà¢6öç7B÷&–v–ç2ÒæWr6WB‚’Â6W'f–6RÒ7&VFUö¶W%6W'fW"‡²÷&–v–ç2Ò“°¢6öç7Bv÷&¶W'2ÒµÒÂ7FFW2ÒµÒÂf–ÇW&W2ÒµÓ°¢G'’°¢v—BæWr&öÖ—6R‡&W6öÇfRÓâ6W'f–6Rç6W'fW"æÆ—7FVâƒÂ##rããã"Â&W6öÇfR’“°¢6öç7B÷&–v–âÒ‡GG¢òó#rããã¢G·6W'f–6Rç6W'fW"æFG&W72‚’ç÷'GÖ²÷&–v–ç2æFB†÷&–v–â“°¢6öç7Bv÷&¶W%6÷W&6RÒ'6VÆbçv–æF÷rÒ6VÆcµÆâ"²&÷Fö6öÅ6÷W&6R²%Æâ"²&VDf–ÆU7–æ2†¦ö–â‡&ö÷BÂ'7&2ö§2÷ö¶W"×v÷&¶W"æ§2"’Â'WFc‚"“°¢6öç7Bw&W"Ò6öç7B²&VçE÷'BÂv÷&¶W$FFÒÒ&WV—&R‚væöFS§v÷&¶W%÷F‡&VG2r“²6öç7BfÒÒ&WV—&R‚væöFS§fÒr“²6öç7B²vV&7'—FòÒÒ&WV—&R‚væöFS¦7'—Fòr“°¢6öç7B7G‚Ò²7'—Fó¢vV&7'—FòÂFW‡DVæ6öFW"Â6WEF–ÖV÷WBÂ6ÆV%F–ÖV÷WBÂ&÷'D6öçG&öÆÆW"ÂU$Å6V&6…&×2Â÷7DÖW76vS¢ÒÓâ&VçE÷'Bç÷7DÖW76vR†Ò’À¢fWF6ƒ¢‡F‚Â÷F–öç2Ò·Ò’ÓâfWF6‚†æWrU$Â‡F‚Âv÷&¶W$FFæ÷&–v–â’Â²ââæ÷F–öç2Â†VFW'3¢²÷&–v–ã¢v÷&¶W$FFæ÷&–v–âÂââæ÷F–öç2æ†VFW'2ÒÒ’Ó°¢7G‚ç6VÆbÒ7Gƒ²fÒç'Vä–äæWt6öçFW‡B‡v÷&¶W$FFç6÷W&6RÂ7G‚“²&VçE÷'Bæöâ‚vÖW76vRrÂFFÓâ7G‚æöæÖW76vR‡²FFÒ’“¶°¢6öç7Bv—Df÷"Ò7–æ2‡&VF–6FRÂÖ‚Òƒ’Óâ²6öç7B7F'BÒFFRææ÷r‚“²v†–ÆR‚&VF–6FR‚’’²–b†f–ÇW&W2æÆVæwF‚’F‡&÷ræWrW'&÷"†f–ÇW&W2æ¦ö–â‚#²"’“²–b„FFRææ÷r‚’Ò7F'BâÖ‚’F‡&÷ræWrW'&÷"‚%v÷&¶W"Æ—F‡&÷Vv‚F–ÖVB÷WC¢"²7FFW2æÖ‡2Óâ3òæf—&æW72ç†6R’æ¦ö–â‚"Â"’“²v—BæWr&öÖ—6R‡"Óâ6WEF–ÖV÷WB‡"ÂC’“²ÒÓ°¢f÷"†ÆWB’Ò²’Â#²’²²’°¢6öç7BrÒæWrv÷&¶W"‡w&W"Â²WfÃ¢G'VRÂv÷&¶W$FF¢²÷&–v–âÂ6÷W&6S¢v÷&¶W%6÷W&6RÒÒ“²v÷&¶W'2çW6‚‡r“°¢ræöâ‚&W'&÷""ÂRÓâf–ÇW&W2çW6‚†RæÖW76vR’“°¢ræöâ‚&ÖW76vR"ÂÒÓâ²–b†ÒçG—RÓÓÒ'7FFR"’7FFW5¶•ÒÒÒç6¶WC²–b†ÒçG—RÓÓÒ&fFÂ"’f–ÇW&W2çW6‚†ÒæÖW76vR“²Ò“°¢rç÷7DÖW76vR‡²G—S¢&6öææV7B"ÂF&ÆS¢Ò“°¢Ð¢v—Bv—Df÷"‚‚’Óâ7FFW2æf–ÇFW"„&ööÆVâ’æÆVæwF‚ÓÓÒ"“°¢v÷&¶W'5³Òç÷7DÖW76vR‡²G—S¢&7F–öâ"ÂæÖS¢&¦ö–â"ÂfÇVS¢²æÖS¢$f—'7B"ÒÒ“°¢v÷&¶W'5³Òç÷7DÖW76vR‡²G—S¢&7F–öâ"ÂæÖS¢&¦ö–â"ÂfÇVS¢²æÖS¢%6V6öæB"ÒÒ“°¢v—Bv—Df÷"‚‚’Óâ7FFW2æWfW'’‡2Óâ2çF&ÆW5³Òç7FFRç6VG2æf–ÇFW"„&ööÆVâ’æÆVæwF‚ÓÓÒ"’“°¢v÷&¶W'5³Òç÷7DÖW76vR‡²G—S¢&7F–öâ"ÂæÖS¢'7F'B"Ò“°¢v—Bv—Df÷"‚‚’Óâ7FFW2æWfW'’‡2Óâ2æf—&æW72ç†6RÓÓÒ&&WGF–ær"’“°¢f÷"†ÆWB&÷VæG2Ò²&÷VæG2ÂCbb7FFW2æWfW'’‡2Óâ2æf—&æW72ç†6RÓÓÒ&6ö×ÆWFR"“²&÷VæG2²²’°¢6öç7B6VBÒ7FFW5³ÒçF&ÆW5³Òç7FFRçGW&âÂ7F–æt–BÒ7FFW5³ÒçF&ÆW5³Òç7FFRç6VG5·6VEÓòæ–BÂ’Ò7FFW2æf–æD–æFW‚‡2Óâ2æ–FVçF—G’ÓÓÒ7F–æt–B“°¢–b†’ãÒbb7FFW5¶•ÒçF&ÆW5³Òç7FFRæÆVvÂ’°¢6öç7BfW'6–öâÒ7FFW5¶•ÒçF&ÆW5³Òç7FFRçfW'6–öã°¢v÷&¶W'5¶•Òç÷7DÖW76vR‡²G—S¢&7F–öâ"ÂæÖS¢&6ÆÂ"ÂW‡V7FVEfW'6–öã¢fW'6–öâÒ“°¢v—Bv—Df÷"‚‚’Óâ7FFW2æWfW'’‡2Óâ2çF&ÆW5³Òç7FFRçfW'6–öâÓÒfW'6–öâ’“°¢Ð¢v—Bv—Df÷"‚‚’Óâ7FFW2æWfW'’‡2Óâ²&&WGF–ær"Â&6ö×ÆWFR%Òæ–æ6ÇVFW2‡2æf—&æW72ç†6R’’“°¢Ð¢6†V6²‡7FFW2æWfW'’‡2Óâ2æf—&æW72ç†6RÓÓÒ&6ö×ÆWFR"bb2çF&ÆW5³Òç7FFRç6VG2æf–ÇFW"„&ööÆVâ’ç&VGV6R‚†âÂ’Óââ²ç7F6²Â’ÓÓÒ#’Â$…EE6Æ–VçG2F–Bæ÷Bf–æ—6‚F†R6ÖR†æB"“°¢6†V6²‡7FFW5³Òæf—&æW72ç&ö÷BÓÓÒ7FFW5³Òæf—&æW72ç&ö÷BÂ$6Æ–VçG2F—6w&VVB&÷WBF†R†æBf–ævW'&–çB"“°¢6öç7BFVæ–VBÒv—BfWF6‚†÷&–v–â²"÷ö¶W"ö’ö6öÖÖæB"Â²ÖWF†öC¢%õ5B"Â†VFW'3¢²÷&–v–ã¢&‡GG3¢ò÷Vç&VÆFVBæ–çfÆ–B"Â$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"ÒÂ&öG“¢'·Ò"Ò“°¢6†V6²†FVæ–VBç7FGW2ÓÓÒC2Â$7&÷72Ö÷&–v–â×WFF–öâv266WFVB"“°¢6öç7BVæWF‚Òv—BfWF6‚†÷&–v–â²"÷ö¶W"ö’÷7FFS÷F&ÆSÓ"“²6†V6²‡VæWF‚ç7FGW2ÓÓÒCÂ%VæWF†VçF–6FVB6W76–öâFFW‡÷6VB"“°¢&V6÷&B‚'ö¶W"&÷Fö6öÃ¢&VÂ…EEv÷&¶W"6Æ–VçG26ö×ÆWFR†æBæBVæf÷&6R6öææV7F–öâ&÷VæF&–W2"ÂG'VR“°¢Ò6F6‚†R’²&V6÷&B‚'ö¶W"&÷Fö6öÃ¢&VÂ…EEv÷&¶W"6Æ–VçG26ö×ÆWFR†æBæBVæf÷&6R6öææV7F–öâ&÷VæF&–W2"ÂfÇ6RÂRç7F6²“²Ð¢f–æÆÇ’²f÷"†6öç7Bröbv÷&¶W'2’v—BrçFW&Ö–æFR‚“²6W'f–6Rç6W'fW"æ6Æ÷6TÆÄ6öææV7F–öç2‚“²v—BæWr&öÖ—6R‡&W6öÇfRÓâ6W'f–6Rç6W'fW"æ6Æ÷6R‡&W6öÇfR’“²Ð¢G'’°¢ÆWBF–ÖRÒ²6öç7B÷&–v–ç2ÒæWr6WB‚’Â6W'f–6RÒ7&VFUö¶W%6W'fW"‡²÷&–v–ç2Â6Æö6³¢‚’ÓâF–ÖRÒ“°¢6öç7B–FVçF—F–W2Ò´2çÆ–W"‚’Â2çÆ–W"‚•ÒÂFö¶Vç2ÒµÓ°¢G'’°¢v—BæWr&öÖ—6R‡&W6öÇfRÓâ6W'f–6Rç6W'fW"æÆ—7FVâƒÂ##rããã"Â&W6öÇfR’“²6öç7B÷&–v–âÒ‡GG¢òó#rããã¢G·6W'f–6Rç6W'fW"æFG&W72‚’ç÷'GÖ²÷&–v–ç2æFB†÷&–v–â“°¢6öç7B÷7BÒ‡F‚Â&öG’ÂFö¶Vâ’ÓâfWF6‚†÷&–v–â²F‚Â²ÖWF†öC¢%õ5B"Â†VFW'3¢²÷&–v–ã¢÷&–v–âÂ$6öçFVçBÕG—R#¢&Æ–6F–öâö§6öâ"Ââââ‡Fö¶Vâò²WF†÷&—¦F–öã¢$&V&W""²Fö¶VâÒ¢·Ò’ÒÂ&öG“¢¥4ôâç7G&–æv–g’†&öG’’Ò“°¢f÷"†6öç7B–FVçF—G’öb–FVçF—F–W2’²6öç7Bæöæ6RÒ2ææöæ6R‚’Â"Òv—B÷7B‚"÷ö¶W"ö’÷6W76–öâ"Â²V&Æ–4¶W“¢–FVçF—G’çV&Æ–4¶W’Âæöæ6RÂ6–væGW&S¢v—B–FVçF—G’ç6–vâ‚&6öææV7B"Âæöæ6R’Ò“²Fö¶Vç2çW6‚‚†v—B"æ§6öâ‚’’çFö¶Vâ“²Ð¢6öç7B&WVW7BÒ7–æ2†’Â6WÂ÷ÂFF’Óâ²6öç7BfÇVRÒ²F&ÆS¢Â6–væW#¢–FVçF—F–W5¶•ÒçV&Æ–4¶W’Â6WÂ÷ÂFFÓ²&WGW&â²ââçfÇVRÂ6–væGW&S¢v—B–FVçF—F–W5¶•Òç6–vâ‚&6öÖÖæB"ÂfÇVR’Ó²Ó°¢f÷"†ÆWB’Ò²’Â#²’²²’6†V6²‚†v—B÷7B‚"÷ö¶W"ö’ö6öÖÖæB"Âv—B&WVW7B†’ÂÂ&¦ö–â"Â²æÖS¢%F–ÖV÷WB"Ò’ÂFö¶Vç5¶•Ò’’æö²Â$¦ö–âf–ÆVB"“°¢6öç7B7F'BÒv—B&WVW7BƒÂ"Â'7F'B"Â²æöæ6S¢2ææöæ6R‚’Ò“²6†V6²‚†v—B÷7B‚"÷ö¶W"ö’ö6öÖÖæB"Â7F'BÂFö¶Vç5³Ò’’æö²Â%7F'Bf–ÆVB"“°¢F–ÖRÒƒ²6†V6²‚†v—B÷7B‚"÷ö¶W"ö’ö6öÖÖæB"Â7F'BÂFö¶Vç5³Ò’’æö²Â$–FV×÷FVçB&WG'’f–ÆVB"“°¢F–ÖRÒ“²v—B6W'f–6Rç7vVW‚“°¢6öç7B7FFRÒ6W'f–6RçF&ÆW5³Òç7FFR‚“²6†V6²‡7FFRç†6RÓÓÒ&–FÆR"bb7FFRç7FFRç6VG2æWfW'’‡2Óâ2’Â$Ö—76–ær¶W’6öçG&–'WF÷'2vW&Ræ÷BWf–7FVBgFW"&VgVæB"“°¢6öç7B&W7öç6RÒv—BfWF6‚†÷&–v–â²÷ö¶W"ö’÷7FFS÷F&ÆSÓf†æCÒG·7F'BæFFææöæ6WÒfg&öÓÓÂ²†VFW'3¢²WF†÷&—¦F–öã¢$&V&W""²Fö¶Vç5³ÒÒÒ“°¢6öç7B6æ6VÆVBÒ†v—B&W7öç6Ræ§6öâ‚’’ç&Wf–÷W2Â&WÆ’Òv—BÒç&WÆ’†6æ6VÆVB“°¢6†V6²‡&WÆ’ç†6RÓÓÒ&&÷'FVB"bb&WÆ’ç7FFR‚’ç7FFRç6VG2æf–ÇFW"„&ööÆVâ’æWfW'’‡2Óâ2ç7F6²ÓÓÒ’Â$6æ6VÆÆF–öâ&V6÷&BÆ÷7BF†RW†7B&VgVæG2"“°¢6öç7B6ööÆF÷vâÒv—B÷7B‚"÷ö¶W"ö’ö6öÖÖæB"Âv—B&WVW7BƒÂ2Â'7F'B"Â²æöæ6S¢2ææöæ6R‚’Ò’ÂFö¶Vç5³Ò“²6†V6²‚6ööÆF÷vâæö²Â%F–ÖVBÖ÷WB'F–6—çB–ÖÖVF–FVÇ’&W7F'FVB"“°¢6öç7B7ööbÒv—B÷7B‚"÷ö¶W"ö’ö6öÖÖæB"Âv—B&WVW7BƒÂ"Â'&Vf–ÆÂ"Â·Ò’ÂFö¶Vç5³Ò“²6†V6²‚7ööbæö²Â$6öææV7F–öâ–×W'6öæFVBæ÷F†W"6–væW""“°¢Òf–æÆÇ’²6W'f–6Rç6W'fW"æ6Æ÷6TÆÄ6öææV7F–öç2‚“²v—BæWr&öÖ—6R‡&W6öÇfRÓâ6W'f–6Rç6W'fW"æ6Æ÷6R‡&W6öÇfR’“²f÷"†6öç7Böb–FVçF—F–W2’æF—7÷6R‚“²Ð¢&V6÷&B‚'ö¶W"&÷Fö6öÃ¢F–ÖV÷WG2&VgVæB6†—2Â&WVFVB&WVW7G26ææ÷B7FÆÂÂæB6–væW'26ææ÷B&R–×W'6öæFVB"ÂG'VR“°¢Ò6F6‚†R’²&V6÷&B‚'ö¶W"&÷Fö6öÃ¢F–ÖV÷WG2&VgVæB6†—2Â&WVFVB&WVW7G26ææ÷B7FÆÂÂæB6–væW'26ææ÷B&R–×W'6öæFVB"ÂfÇ6RÂRç7F6²“²Ð§Ó° ¢òò&Vw&W76–öã¢E4"W6W2F†RÖV7W&VBÖ&&ÆRW'GW&Rv—F†÷WB6†æv–ær6—&7VÆ"vFW2÷"6öçG&öÆÆW"F–Ö–ærà¦6öç7B÷'FÄ6†V6·3Ò„$ÂÆVÂ“Óç°¢°¢òò6öçG&7C¢&÷F‚F—&V7F–öç2W6RF†R&öGV7F–öâ7vWBW'GW&RæBvÆÂÖ6Æö6²7–6ÆRà¢6öç7BvWBÒFö7VÖVçBævWDVÆVÖVçD'”–BÂÆ—7FVâÒv–æF÷ræFDWfVçDÆ—7FVæW"ÂVæÆ—7FVâÒv–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#°¢Fö7VÖVçBævWDVÆVÖVçD'”–BÒ‚’Óâ²6öç7BæöFRÒVÂ‚“²æöFRçVW'•6VÆV7F÷"Ò‚’ÓâVÂ‚“²&WGW&âæöFS²Ó°¢v–æF÷ræFDWfVçDÆ—7FVæW"Òv–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW"Ò‚’Óâ·Ó°¢ÆWBF–ÖRÒÂ7&÷76–æw2Ò°¢6öç7BvFRÒ$Âæööv÷'FÂæ7&VFR‡²&F—W3¢"ã"Â÷WFW%&F—W3¢"ãRÂ÷6—F–öã¢²ƒ¢Â“¢"Â£¢#‚ÒÂ&÷FF–öã¢²ƒ¢ÔÖF‚å’ò"Â“¢Â£¢ÒÂæ÷s¢‚’ÓâF–ÖRÂFW7F–æF–öç3¢·²–C¢&‡V""ÂVæ&ÆVC¢G'VRÕÒÂöåG&fW'6S¢‚’Óâ7&÷76–æw2²²Ò“°¢6öç7Bg&öÒÒ²ƒ¢Â“¢Â£¢#ÒÂFòÒ²ƒ¢Â“¢Â£¢cÓ°¢6öç7BöfbÒvFRçG&fW'6R†g&öÒÂFòÂã‚’Â7F—fFVBÒvFRæ7F—fFRƒ’ÂGWÆ–6FRÒvFRæ7F—fFRƒ’Âv&Ö–ærÒvFRçG&fW'6R†g&öÒÂFòÂã‚“°¢F–ÖRÒ“““²vFRçWFFR‚“²6öç7B7F—fF–öâÒvFRç7FFRÓÓÒ$5D•dD”är#°¢F–ÖRÒ#²vFRçWFFR‚“²6öç7B7F—fRÒvFRç7FFRÓÓÒ$5D•dR#°¢6öç7Bw&öærÒvFRçG&fW'6R‡FòÂg&öÒÂã‚’Â÷WG6–FRÒvFRçG&fW'6R‡²ââæg&öÒÂƒ¢2ÒÂ²ââçFòÂƒ¢2ÒÂã‚“°¢6öç7B7vWBÒvFRçG&fW'6R†g&öÒÂFòÂã‚’Âöæ6RÒvFRçG&fW'6R†g&öÒÂFòÂã‚“°¢F–ÖRÒ“““²vFRçWFFR‚“²6öç7BgVÆÅv–æF÷rÒvFRç7FFRÓÓÒ$5D•dR#°¢F–ÖRÒ#²vFRçWFFR‚“²6öç7B6‡WFF÷vâÒvFRç7FFRÓÓÒ%4…UDDõtâ"bbvFRçG&fW'6R†g&öÒÂFòÂã‚“°¢F–ÖRÒ#CS²vFRçWFFR‚“²6öç7BW‡—&VBÒvFRç7FFRÓÓÒ$ôdb"bbvFRçG&fW'6R†g&öÒÂFòÂã‚“°¢&V6÷&B‚$ööv÷'FÂ&WGW&ã¢F—&V7F–öæÂ7vWBg&öçB7&÷76–ærÂW†7BFVFÆ–æW2æBöæR×W6R7–6ÆR"Âöfbbb7F—fFVBbbGWÆ–6FRbbv&Ö–ærbb7F—fF–öâbb7F—fRbbw&öærbb÷WG6–FRbb7vWBbböæ6RbbgVÆÅv–æF÷rbb6‡WFF÷vâbbW‡—&VBbb7&÷76–æw2ÓÓÒ“°¢vFRç&V6V—fR‚“²F–ÖR³Òc²vFRçWFFR‚“²6öç7B&V6V—f–ærÒvFRç&V6V—f–ærbbvFRç7FFRÓÓÒ$5D•dR"bbvFRæ7F—fFRƒ“°¢vFRæf–æ—6…&V6V—f–ær‡G'VR“²6öç7BfF–ærÒvFRç7FFRÓÓÒ%4…UDDõtâ#°¢F–ÖR³ÒCS²vFRçWFFR‚“°¢&V6÷&B‚$ööv÷'FÂ&V6V—f–æs¢†÷7B÷vç2GW&F–öâF†Vâ&W7F÷&W2&WW6&ÆR÷WF&÷VæB7–6ÆR"Â&V6V—f–ærbbfF–ærbbvFRç&V6V—f–ærbbvFRç7FFRÓÓÒ$ôdb"bbvFRæ7F—fFRƒ’“°¢vFRæF—7÷6R‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–BÒvWC²v–æF÷ræFDWfVçDÆ—7FVæW"ÒÆ—7FVã²v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW"ÒVæÆ—7FVã°¢Ð¢6öç7BvWCÖFö7VÖVçBævWDVÆVÖVçD'”–BÆÆ—7FVã×v–æF÷ræFDWfVçDÆ—7FVæW"ÇVæÆ—7FVã×v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#°¢6öç7BÆ—7FVæW'3ÖæWr6WB‚’ÆæöFW3ÕµÓ°¢6öç7BVÆVÖVçCÒ‚“Óç¶6öç7BãÖVÂ‚“¶âæFDWfVçDÆ—7FVæW#Ò‡G—RÆfâ“ÓæÆ—7FVæW'2æFB†fâ“¶âç&VÖ÷fTWfVçDÆ—7FVæW#Ò‡G—RÆfâ“ÓæÆ—7FVæW'2æFVÆWFR†fâ“¶æöFW2çW6‚†â“·&WGW&âã·Ó°¢Fö7VÖVçBævWDVÆVÖVçD'”–CÒ‚“Óç¶6öç7BãÖVÆVÖVçB‚“¶âçVW'•6VÆV7F÷#Ò‚“ÓæVÆVÖVçB‚“·&WGW&âã·Ó·v–æF÷ræFDWfVçDÆ—7FVæW#Ò‡G—RÆfâ“ÓæÆ—7FVæW'2æFB†fâ“·v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#Ò‡G—RÆfâ“ÓæÆ—7FVæW'2æFVÆWFR†fâ“°¢G'—°¢6öç7BÔ$ÂæG6$FÖ÷7†W&Rç÷'F&W'GW&RÅ3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚“¶ÆWBF–ÖSÓÆ7&÷76–æw3Ó°¢6öç7BvFSÔ$Âæööv÷'FÂæ7&VFR‡·&F—W3£"ãRÆ÷WFW%&F—W3£"ã‚ÆW'GW&S¥Ç÷6—F–öã§·ƒ£Ç“¥æ†V–v‡Bó"Ç££ÒÇ&÷FF–öã§·ƒ¤ÖF‚å’ó"Ç“£Ç££ÒÆæ÷s¢‚“ÓçF–ÖRÆFW7F–æF–öç3¥·¶–C¢&&–g&÷7B"ÆVæ&ÆVC§G'VWÕÒÆöåG&fW'6S¢‚“Óæ7&÷76–æw2²·Ò“°¢vFRç&–ærçf—6–&ÆSÖfÇ6Sµ2æFD6†–ÆB‡&ö÷BÆvFRç&ö÷BÆvFRæF–ÆW"“°¢6öç7BÖ&&ÆSÔ¥4ôâç7G&–æv–g’„$ÂæG6$FÖ÷7†W&Rç÷'F&‚’“¶ÆWB†6ƒÓ#cc3c#c¶f÷"†ÆWB“Ó¶“ÆÖ&&ÆRæÆVæwFƒ¶’²²–†6ƒÔÖF‚æ–×VÂ††6…æÖ&&ÆRæ6†$6öFTB†’’Ãcsssc’“°¢&V6÷&B‚%÷'F&¢&÷fVBÖ&&ÆR'—FW2æBÖV7W&VBR'’bãR÷Væ–ær&VÖ–âVæ6†ævVB"Â††6ƒããã’çFõ7G&–ærƒb“ÓÓÒ&#FF“fB"beçv–GFƒÓÓÓRbeæ†V–v‡CÓÓÓbãRbeæfö÷Ev–GFƒÓÓÓBãRbeæfö÷D†V–v‡CÓÓÒãR“°¢6öç7BsÖvFRæ†÷&—¦öâævVöÖWG'’ÇcÖrçfW'G2Æ6—&6ÆSÔ$Âæööv÷'FÄÖöFVÇ2æ'V–ÆBƒ"ãRÃ"ã‚’Æ6÷“Ô$Âæööv÷'FÄÖöFVÇ2æ'V–ÆBƒ"ãRÃ"ã‚Å’Æ÷&–v–æÃÖ6—&6ÆRæ†÷&—¦öâævVöÖWG'’çfW'G2ç6Æ–6R‚“°¢6öç7B6÷&æW'3ÕµÓ¶f÷"†6öç7B‚öb²ÓÃÒ–f÷"†6öç7B¢öb²ÓÃÒ–6÷&æW'2çW6‚‡bç6öÖR‚†Æ’“Óæ’S3ÓÓÓbdÖF‚æ'2†×‚“ÃRÓbbdÖF‚æ'2‡e¶’³%Ò×¢“ÃRÓb’“°¢&V6÷&B‚%÷'F&¢7GVÂ&V7FæwVÆ"ÖW6‚f–ÆÇ2f÷W"6÷&æW'2Â66†W26W&FVÇ’æBf—G2v—F†–âF†RÖ&&ÆR6†gG2öÆ–çFVÂ"Ærç÷'FÅ&V7Bbf6÷&æW'2æWfW'’„&ööÆVâ’bfsÓÓÖ6÷’æ†÷&—¦öâævVöÖWG'’bfrÓÖ6—&6ÆRæ†÷&—¦öâævVöÖWG'’bfvFRæ†Æev–GFƒÓÓÓ"ãCsRbfvFRæ†Æd†V–v‡CÓÓÓ2ã##RbgbæWfW'’‚†Æ’“Óæ’S3ÓÓÓöÓÓÓ¤ÖF‚æ'2†“ÃÓã’“°¢6öç7BvfSÔ$Âæööv÷'FÄÖöFVÇ2æÆ—V–D†V–v‡C°¢&V6÷&B‚%÷'F&¢&V7FæwVÆ"&—ÆRVçfVÆ÷R&V6†W2F†R6÷&æW'2æB–ç2WfW'’W'GW&RVFvR"ÇvfR‚ã‚Âã‚Âã2ÃÇG'VR’Ó×vfR‚ã‚Âã‚ÂãbÃÇG'VR’be²ÓÃÒæWfW'’‡ƒÓå²ÓÂÒãRÃÂãRÃÒæWfW'’‡£ÓçvfR‡‚Ç¢ÂãBÃÇG'VR“ÓÓÓbgvfR‡¢Ç‚ÂãBÃÇG'VR“ÓÓÓ’’bgvfR‚ã‚Âã‚Âã2Ã“ÓÓÓ“°¢6öç7B&÷w3ÕµÓ¶f÷"†6öç7B¶æÖRÇ‚Ç’Ç"Æ‚ÆW‡V7FVBÇ&WfW'6UÒöbµ²&fÆö÷""ÃÂãrÂãrÃãBÇG'VRÆfÇ6UÒÅ²'WW"6÷&æW""Ã"ÃRã‚Âã"ÂãRÇG'VRÆfÇ6UÒÅ²&fö÷F–ær"Ã"ã"ÂãrÂã"ÃãBÆfÇ6RÆfÇ6UÒÅ²&6öÇVÖâ"Ã"ãCRÃ2Âã"ÃÆfÇ6RÆfÇ6UÒÅ²&Æ–çFVÂ"ÃÃbã"Âã"ÃÆfÇ6RÆfÇ6UÒÅ²&&VÆ÷rF‡&W6†öÆB"ÃÂã"Âã"ÃÆfÇ6RÆfÇ6UÒÅ²'w&öærv’"ÃÂãrÂãrÃãBÆfÇ6RÇG'VUÕÒ—°¢vFRç&V6V—fR‚“¶6öç7B×·‚Ç’Ç£§&WfW'6SòÓ£ÒÆ#×·‚Ç’Ç£§&WfW'6Só¢ÓÒÆ†—CÖvFRçG&fW'6R†Æ"Ç"ÃÆ‚“·&÷w2çW6‚‡¶æÖRÆ†—BÆW‡V7FVGÒ“°¢Ð¢&V6÷&B‚%÷'F&¢7vWB&V7FævÆR66WG2—G2WW"6÷&æW'2æB&V¦V7G26öÇVÖç2Âfö÷F–æw2ÂÆ–çFVÂÂ&VÆ÷rÖw&÷VæBæB&WfW'6RVçG'’"Ç&÷w2æWfW'’‡#Óç"æ†—CÓÓ×"æW‡V7FVB’bf7&÷76–æw3ÓÓÓ"Ä¥4ôâç7G&–æv–g’‡&÷w2’“°¢vFRæf–æ—6…&V6V—f–ær‚“¶ÆWB7–6ÆW3×G'VS¶6öç7B6Æ÷G3ÖvFRç&ö÷Bæ6†–ÆG&Vâç6Æ–6R‚’Ç6æ6†÷CÔ¥4ôâç7G&–æv–g’†rçfW'G2“°¢f÷"†ÆWB“Ó¶“Ã¶’²²—°¢6öç7B&6S×F–ÖS¶7–6ÆW2bcÖvFRæ7F—fFR‚“·F–ÖSÖ&6R³¶vFRçWFFR‚“¶7–6ÆW2bcÖvFRç7FFSÓÓÒ$5D•dD”är"bfvFRæ¶vö÷6‚çf—6–&ÆRbfvFRæ†÷&—¦öâç÷'FÅ&WfVÃÓÓÒãRbfvFRæ¶vö÷6‚ç66ÆRçƒÓÓÖvFRæ†Æev–GF‚¢ãRbfvFRæ¶vö÷6‚ç66ÆRç£ÓÓÖvFRæ†Æd†V–v‡B¢ãS°¢F–ÖSÖ&6R³#¶vFRçWFFR‚“¶7–6ÆW2bcÖvFRç7FFSÓÓÒ$5D•dR"bfvFRæ†÷&—¦öâç÷'FÅ&WfVÃÓÓÓbbvFRæ¶vö÷6‚çf—6–&ÆS°¢F–ÖSÖ&6R³#¶vFRçWFFR‚“¶7–6ÆW2bcÖvFRç7FFSÓÓÒ%4…UDDõtâ#·F–ÖSÖ&6R³#CS¶vFRçWFFR‚“¶7–6ÆW2bcÖvFRç7FFSÓÓÒ$ôdb"bbvFRæ†÷&—¦öâçf—6–&ÆRbbvFRæ¶vö÷6‚çf—6–&ÆRbfvFRç&ö÷Bæ6†–ÆG&VâæWfW'’‚†âÆ²“ÓæãÓÓ×6Æ÷G5¶µÒ“°¢Ð¢&V6÷&B‚%÷'F&¢FVâ7–6ÆW2&WF–â6†&VB&WfVÂ÷7W&vR÷6‡WFF÷vâFVFÆ–æW2æBf—†VBæöFW2övVöÖWG'’"Æ7–6ÆW2bg6æ6†÷CÓÓÔ¥4ôâç7G&–æv–g’†rçfW'G2’bf÷&–v–æÂæWfW'’‚†âÆ’“ÓæãÓÓÖ6—&6ÆRæ†÷&—¦öâævVöÖWG'’çfW'G5¶•Ò’bf6÷’æ¶vö÷6‚ævVöÖWG'“ÓÓÖvFRæ¶vö÷6‚ævVöÖWG'’“°¢vFRæF—7÷6R‚“¶vFRæF—7÷6R‚“·&V6÷&B‚%÷'F&¢F—7÷6Â&VÆV6W266VæRæöFW2æBÆÂ6öçG&öÆÆW"Æ—7FVæW'2"Ç&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÓbfÆ—7FVæW'2ç6—¦SÓÓÓbfvFRæF—7÷6VB“°¢Öf–æÆÇ—¶Fö7VÖVçBævWDVÆVÖVçD'”–CÖvWC·v–æF÷ræFDWfVçDÆ—7FVæW#ÖÆ—7FVã·v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#×VæÆ—7FVã·Ð§Ó° ¢òò'VÆS¢öæR7W÷'BÖW6‚Â&÷VæFVBvFW"VffV7G2æBF†R&VÂ7&Wr×W7Bw&VR&÷WB–ÖÖW'6–öâà¦6öç7BvFW%v÷&ÆBÒ$ÂÓâ°¢6öç7B3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÆÆæCÔ$ÂæG6$vVöw&‡’æ'V–ÆB‚’Ç&VæFW&W#×¶¶–æC¢'vV&vÃ""ÇVÆ—G“¢&†–v‚'ÒÆ6ÖW&Õ2æ7&VFT6ÖW&‚“°¢2æFD6†–ÆB‡&ö÷BÆÆæBç&ö÷B“µ2ç&VÖ÷fT6†–ÆB†ÆæBç&ö÷BÆÆæBç6V“¶6ÖW&ç÷6—F–öâçƒÓ#¶6ÖW&ç÷6—F–öâç“Óƒ¶6ÖW&ç÷6—F–öâç£Óƒ3°¢6öç7BvFW#Ô$ÂæG6%vFW"æ7&VFR†ÆæB“µ2æFD6†–ÆB‡&ö÷BÇvFW"ææöFR“°¢6öç7BæGW&SÔ$ÂæG6$æGW&Ræ7&VFR‡·&ö÷BÆÆæBÇ&VæFW&W"Æ6ÖW&ÇvVF†W#§·7FFS§·v–æC§·7G&VæwFƒ¢ã'×××Ò’ÆFWF–ÃÔ$ÂæG6$W‡FW&–÷"æ7&VFR‡·&ö÷BÆÆæBÆæGW&WÒ“°¢6öç7BVç&–6†ÖVçCÔ$ÂæG6$Vç&–6†ÖVçBæ7&VFR‡·&ö÷BÆÆæBÆæGW&RÆFWF–ÂÇ&VæFW&W"Æ6ÖW&Ò’ÇF÷vãÔ$ÂæG6%F÷vâæ7&VFR‡·&ö÷BÆÆæBÆæGW&RÆFWF–ÂÆVç&–6†ÖVçGÒ“°¢6öç7BöÇ–×W3Ô$ÂæG6$öÇ–×W2æ7&VFR‡·&ö÷BÆÆæBÆæGW&RÆFWF–ÂÆVç&–6†ÖVçBÇ&VæFW&W'Ò“°¢6öç7Bæö÷Ò‚“Óç·ÒÆgƒ×·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷Ó°¢6öç7BvÆ¶&ÆSÒ‚ââæ“ÓæÆæBçvÆ¶&ÆR‚ââæ’bgF÷vâæ6ÆV%6VvÖVçB‚ââæ’bföÇ–×W2æ6ÆV%6VvÖVçB‚ââæ“°¢6öç7Bw&÷VæCÒ‡‚Ç¢“ÓæöÇ–×W2ç7W÷'DB‡‚Ç¢ÆÆæBæw&÷VæDB‡‚Ç¢’“°¢6öç7B7&WsÔ$Âæ7&Wræ7&VFR‡·&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦æö÷Ç&VÖ÷fS¦æö÷ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¦w&÷VæBÇvÆ¶&ÆRÆg‡Ò“°¢6öç7BfF#Ö7&Wræ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“¶7&Wræ6öçG&öÂ†fF"“°¢6öç7BF—7÷6SÒ‚“Óç¶7&WræF—7÷6R‚“¶öÇ–×W2æF—7÷6R‚“·F÷vâæF—7÷6R‚“¶Vç&–6†ÖVçBæF—7÷6R‚“¶FWF–ÂæF—7÷6R‚“¶æGW&RæF—7÷6R‚“·Ó°¢&WGW&â·&ö÷BÆÆæBÇvFW"ÆæGW&RÆFWF–ÂÆVç&–6†ÖVçBÇF÷vâÆöÇ–×W2Ç&VæFW&W"Æ6ÖW&Æg‚Æ7&WrÆfF"ÇvÆ¶&ÆRÆw&÷VæBÆF—7÷6WÓ°§Ó°¦6öç7BvFW$vöÆFVâÒrÓâ°¢6öç7B†6ƒ×fÇVW3Óç¶ÆWBƒÓ#cc3c#c¶6öç7BFW‡CÔ¥4ôâç7G&–æv–g’‡fÇVW2“¶f÷"†ÆWB“Ó¶“ÇFW‡BæÆVæwFƒ¶’²²–ƒÔÖF‚æ–×VÂ†…çFW‡Bæ6†$6öFTB†’’Ãcsssc’“·&WGW&â†ƒããã’çFõ7G&–ærƒb“·Ó°¢6öç7Bw&÷VæCÕµÓ¶f÷"†ÆWBƒÒÓ“c·ƒÃÓ“c·‚³ÓãR–f÷"†ÆWB£ÒÓ“c·£ÃÓ“c·¢³ÓãR––b‚‡ƒâÓRbgƒÃSRbg£ãS‚’–w&÷VæBçW6‚…ræÆæBæ†V–v‡DB‡‚Ç¢’“°¢6öç7BæöFW3ÕµÓ¶6öç7Bf—6—CÖãÓç¶–b†âævVöÖWG'’–æöFW2çW6‚†âævVöÖWG'’çfW'G2ÆâævVöÖWG'’æf6W2æÖ†cÓæbæ’’Æâç÷6—F–öâÆâç&÷FF–öâÆâç66ÆR“¶f÷"†6öç7B2öbâæ6†–ÆG&Vâ—f—6—B†2“·Ó·f—6—B…ræöÇ–×W2æw&÷W“°¢rçvFW"çWFFRƒ“°¢&WGW&â¶w&÷VæC¦†6‚†w&÷VæB’ÆöÇ–×W3¦†6‚†æöFW2’Æ'&–FvW3¦†6‚…ræöÇ–×W2æ'&–FvW2’Æ'V–ÆF–æw3¦†6‚…ræÆæBæ'V–ÆF–æw2’ÆfgC¦†6‚„'&’æg&öÒ…rçvFW"ç—†VÇ2’—Ó°§Ó°¢òò&Vw&W76–öã¢66†VBG&W76–ær6†W2W6VB'’W‡Æ–6—Bf–VÆG2æB÷&F–æ'’öÇ–×W2æöFW2×W7Bæ÷@¢òòÆ–2&VæFW&W"&V6÷&BâW†W&6—6RF†R&VÂ6öÆÆV7F÷"÷WÆöFW"v–ç7B'—FRÖ&÷VæFVBtÂ6–æ³°¢òò6†FW"6ö×–ÆF–öâæB—†VÇ2&VÖ–âF†R6W&FRÂÖæFF÷'’vV$tÂ'&÷w6W"6†V6·ö–çBà¦6öç7BvFW%WÆöE&ö&RÒ„$ÂÂr’Óâ°¢6öç7B'VffW'3ÖæWrÖ‚’Æ&–æF–æw3ÖæWrÖ‚’ÆW'&÷'3ÕµÒÇWÆöG3ÖæWrÖ‚’ÆÆ—7FVæW'3ÖæWr6WB‚“¶ÆWB6W&–ÃÓÇF–W#Ò""ÆG&w3Ó°¢6öç7B“×°¢vWDW‡FVç6–öã¢‚“ÓæçVÆÂÆvWE&öw&Õ&ÖWFW#¢‚“ÓçG'VRÆvWE&ÖWFW#¢‚“ÓãBÀ¢7&VFT'VffW#¢‚“Óç¶6öç7B#×¶–C¢²·6W&–ÇÓ¶'VffW'2ç6WB†"Ã“·&WGW&â#·ÒÀ¢&–æD'VffW#¢‡F&vWBÆ"“Óæ&–æF–æw2ç6WB‡F&vWBÆ"’À¢'VffW$FF¢‡F&vWBÆFF“Óæ'VffW'2ç6WB†&–æF–æw2ævWB‡F&vWB’ÇG—VöbFFÓÓÒ&çVÖ&W"#öFF¦FFæ'—FTÆVæwF‚’À¢'VffW%7V$FF¢‡F&vWBÆöfg6WBÆFFÇ7F'CÓÆÆVæwFƒÓ“Óç°¢6öç7B6÷VçCÖÆVæwF‡ÇÆFFæÆVæwF‚×7F'BÆ66—G“Ö'VffW'2ævWB†&–æF–æw2ævWB‡F&vWB’’ÆVæCÖöfg6WB¶6÷VçB¦FFä%•DU5õU%ôTÄTÔTåC°¢–b‡7F'CÃÇÆ6÷VçCÃÇÇ7F'B¶6÷VçCæFFæÆVæwF‡ÇÆVæCæ66—G’–W'&÷'2çW6‚‡·F–W"Ç6÷W&6S¦FFæÆVæwF‚Ç7F'BÆÆVæwFƒ¦6÷VçBÆ66—G’Æöfg6WGÒ“°¢WÆöG2ç6WB†FFÇ¶6÷VçBÆ66—G—Ò“°¢ÒÀ¢FVÆWFT'VffW#¦#Óæ'VffW'2æFVÆWFR†"’ÆG&t'&—4–ç7Fæ6VC¢‚“ÓæG&w2²°¢Ó°¢6öç7BvÃÖæWr&÷‡’†’Ç¶vWC¢†òÆ²“Óæ²–âóöõ¶µÓ¦õ¶µÓÒõå´Õ£Ó•õÒ²BòçFW7B†²“ò²·6W&–Ã¦²ç7F'G5v—F‚‚&7&VFR"—ÇÆ³ÓÓÒ&vWEVæ–f÷&ÔÆö6F–öâ#ò‚“Óâ‡¶–C¢²·6W&–ÇÒ“¢‚“Óç·×Ò“°¢6öç7B6çf3×¶6Æ–VçEv–GFƒ£cBÆ6Æ–VçD†V–v‡C£cBÆvWD6öçFW‡C¢‚“ÓævÂÆFDWfVçDÆ—7FVæW#¦³ÓæÆ—7FVæW'2æFB†²’Ç&VÖ÷fTWfVçDÆ—7FVæW#¦³ÓæÆ—7FVæW'2æFVÆWFR†²—Ó°¢6öç7B#Ô$ÂævÅ&VæFW&W"æ7&VFU&VæFW&W"†6çf2’Æ÷G3×²ââä$Âç66VæW2æG6"ç&VæFW$÷G2ÆG6%vFW#¥rçvFW'ÒÇ&÷w3ÕµÓ°¢6öç7B'&—3ÖæWrÖ‚“´$Âç66VæRçG&fW'6Uf—6–&ÆR…rç&ö÷BÆãÓç¶–b†âæ–ç7Fæ6TFF–'&—2ç6WB†âÆâæ–ç7Fæ6TFF“·Ò“°¢f÷"‡F–W"öb²&†–v‚"Â&ÖVF—VÒ"Â&Æ÷r"Â&†–v‚%Ò—°¢rç&VæFW&W"çVÆ—G“×F–W#µ"ç6WEVÆ—G’‡F–W"“°¢f÷"†6öç7B·‚Ç’Ç¥Òöbµ³#Ã‚Ãƒ5ÒÅ²ÓCÃ#RÂÓ…ÒÅ³ÃÃÕÒ—°¢ö&¦V7Bæ76–vâ…ræ6ÖW&ç÷6—F–öâÇ·‚Ç’Ç§Ò“µrææGW&RçWFFR‚ã"Ã“µræVç&–6†ÖVçBçWFFRƒÃ“µræöÇ–×W2çWFFR‚ã"Ã“°¢6öç7B÷væW'3ÖæWrÖ‚“´$Âç66VæRçG&fW'6Uf—6–&ÆR…rç&ö÷BÆãÓç¶–b†âævVöÖWG'’—¶6öç7BÖ÷væW'2ævWB†âævVöÖWG'’—ÇÅµÓ¶çW6‚†â“¶÷væW'2ç6WB†âævVöÖWG'’Æ“·×Ò“°¢ÆWBW†6ÇW6—fS×G'VRÆ&÷VæFVC×G'VS°¢f÷"†6öç7BæöFW2öb÷væW'2çfÇVW2‚’–f÷"†6öç7BâöbæöFW2––b†âæ–ç7Fæ6TFF—¶W†6ÇW6—fRbcÖæöFW2æÆVæwFƒÓÓÓ¶&÷VæFVBbcÔçVÖ&W"æ—4–çFVvW"†âæ–ç7Fæ6T6÷VçB’bfâæ–ç7Fæ6T6÷VçCãÓbfâæ–ç7Fæ6T6÷VçB£#ÃÖâæ–ç7Fæ6TFFæÆVæwF‚bfâæ–ç7Fæ6TFFÓÓÖ'&—2ævWB†â’bfâæ–ç7Fæ6TFFæWfW'’„çVÖ&W"æ—4f–æ—FR“·Ð¢WÆöG2æ6ÆV"‚“¶6öç7BG&vãÕ"ç&VæFW"…rç&ö÷BÅræ6ÖW&Æ÷G2“°¢ÆWBW†7C×G'VS¶f÷"†6öç7B¶âÆFFÒöb'&—2––b‡WÆöG2æ†2†FF’—¶6öç7BWÆöC×WÆöG2ævWB†FF“¶W†7Bbc×WÆöBæ6÷VçCÓÓÖâæ–ç7Fæ6T6÷VçB£#bgWÆöBæ66—G“ÓÓÖFFæ'—FTÆVæwFƒ·Ð¢&÷w2çW6‚‡·F–W"Ç‚Ç’Ç¢ÆW†6ÇW6—fRÆ&÷VæFVBÆG&vâÆW†7GÒ“°¢Ð¢Ð¢"ç&VÆV6UVçW6VB†æWr6WB‚’“¶6öç7B&VÆV6VCÕ"ç7FG2ç&V6÷&G3ÓÓÓbe"ç7FG2çvFW%FW‡GW&W3ÓÓÓµ"æF—7÷6R‚“°¢&WGW&â·&÷w2ÆW'&÷'2ÆG&w2Ç&VÆV6VBÆ'VffW'3¦'VffW'2ç6—¦RÆÆ—7FVæW'3¦Æ—7FVæW'2ç6—¦WÓ°§Ó°¦6öç7BvFW$6†V6·2Ò$ÂÓâ°¢6öç7Bs×vFW%v÷&ÆB„$Â’Ç¶ÆæC¤ÂÇvFW"ÆöÇ–×W3¤òÆ7&WrÆfF#¤Ç&VæFW&W"Æ6ÖW&ÓÕrÄ3Ô$ÂæG6$6ö7C°¢6öç7B“Ô$ÂæG6%vFW$–çFW&7F–öâæ7&VFR…r’Æ–çWCÔ’ç7FVW&–ær†7&WrÂ‚“ÓçG'VR’Çö–çCÒ‡&F–òÇƒÓ#“Óç°¢ÆWBÆóÓcbÆ†“Ó“c¶f÷"†ÆWB“Ó¶“Ã3¶’²²—¶6öç7B£Ò†Æò¶†’’ó#¶–b„2äÄUdTÂÔÂæ†V–v‡DB‡‚Ç¢“Ç&F–ò¤æ&öG”†V–v‡B–Æó×£¶VÇ6R†“×£·Ö6öç7B£Ò†Æò¶†’’ó#·&WGW&â·‚Ç“¤Âæ†V–v‡DB‡‚Ç¢’Ç§Ó°¢Ó°¢ÆWBF–ÖSÓ°¢6öç7B7FWÒ‡6V6öæG2ÇƒÓÇ£ÓÇ7VVCÓ“Óç¶f÷"†ÆWB“Ó¶“ÄÖF‚æ6V–Â‡6V6öæG2£c“¶’²²—¶–çWBç7FVW"‡‚Ç¢ÃÇ¢Ç‚Ç7VVB“¶7&WrçWFFRƒócÇF–ÖR“´’çWFFRƒócÇF–ÖRÄ“·F–ÖR³Óóc·×Ó°¢6öç7BÆö6FS×&F–óÓç¶6öç7B×ö–çB‡&F–ò“¶7&Wrç&VÆö6FUÆ–W"‡Ã“´’æ6ÆV"‚“·7FW‚ã"“·&WGW&â·Ó°¢6öç7BvöÆFVã×vFW$vöÆFVâ…r“°¢&V6÷&B‚$E4"vFW#¢&÷FV7FVBFW'&–âÂöÇ–×W2vVöÖWG'’Â'&–FvW2ÂÆ÷G2æB6ÆV'vFW"deBÖF6‚7F'F–ær6†V6·ö–çB"Ä¥4ôâç7G&–æv–g’†vöÆFVâ“ÓÓÔ¥4ôâç7G&–æv–g’…tDU%ôtôÄDTâ’Ä¥4ôâç7G&–æv–g’†vöÆFVâ’“°¢6öç7B6–Ç3Ôòæw&÷Wæ6†–ÆG&VâæfÆDÖ†ãÓæâæ6†–ÆG&Vâ’ÆævÆW3×6–Ç2æÖ†ãÓæâç&÷FF–öâç¢“´òçWFFR‚ãRÃ“°¢&V6÷&B‚$E4"öÇ–×W3¢&÷F‚v–æFÖ–ÆÇ27F–ÆÂGW&âæBF†V—"÷&–v–æÂF÷vW'2&VÖ–â6öÆ–B"Ç6–Ç2æÆVæwFƒÓÓÓ"bg6–Ç2æWfW'’‚†âÆ’“Óæâç&÷FF–öâç£æævÆW5¶•Ò’bdòæ–ç6–FR‚ÓBÂÓS‚ÂãB’bdòæ–ç6–FR‚Ó#BÂÓcbÂãB’“°¢&V6÷&B‚$E4"vFW#¢&÷fVBÖVâ7W&f6R7F—2BÓã2v—F‚æòæWrFW‡GW&R÷"g&ÖV'VffW""ÇvFW"ævVöÖWG'’çfW'G2æWfW'’‚‡bÆ’“Óæ’S2ÓÓÇÇcÓÓÒÒã2’bgvFW"ç6—¦SÓÓÓcBbgvFW"æFWF…6—¦SÓÓÓ#SbbgvFW"æFWF‡2æÆVæwFƒÓÓÓ#Sb£#Sb£B“°¢òòW†V7WFRF†R7GVÂ66Æ"tÅ4ÂföÒW‡&W76–öâÂæ÷B6V6öæB–×ÆVÖVçFF–öâöb—G2f÷&×VÆà¢6öç7BW‡&W76–öãÔ$ÂæG6%vFW"ç6†FW"æÖF6‚‚öfÆöBföÓÒ…µãµÒ²“²ò•³ÒÇ6Öö÷F‡7FWÒ†Æ"Ç‚“Óç¶6öç7BCÔÖF‚æÖ‚ƒÄÖF‚æÖ–âƒÂ‡‚Ö’ò†"Ö’’“·&WGW&âB§B¢ƒ2Ó"§B“·Ó°¢6öç7BföÓÖæWrgVæ7F–öâ‚&&VB"Â&FWF‚"Â'6†÷&UvfR"Â'TE4$Vçf—&öæÖVçB"Â'6Öö÷F‡7FW"Â'&WGW&â"¶W‡&W76–öâ’Ç6×ÆTföÓÒ‡6æBÆFWF‚Æ7&W7B“ÓæföÒ‡¶s§6æGÒÆFWF‚Æ7&W7BÇ·s£7ÒÇ6Öö÷F‡7FW“°¢6öç7BÖ6³Ò‡‚Ç¢“ÓçvFW"æFWF‡5²„ÖF‚æfÆö÷"‚‡¢ócS²ãR’£#Sb’£#Sb´ÖF‚æfÆö÷"‚‡‚ócS²ãR’£#Sb’’£B³Ó°¢&V6÷&B‚$E4"6ö7BföÓ¢æöâÖ&V6‚6ö7G2æB¦W&òFWF‚†fRæòVæ—fW'6Â&–Ó²6æB6†öÇ2&WF–âÖ÷f–ær7&W7G2"Å³ÂãBÂã"ÂãbÃã%ÒæWfW'’†CÓå³ÂãRÃÒæWfW'’†3Óç6×ÆTföÒƒÆBÆ2“ÓÓÓ’’bg6×ÆTföÒƒÃÃ“ÓÓÓbg6×ÆTföÒƒÂãBÃ“ãbg6×ÆTföÒƒÂãBÃ“ÓÓÓbböföÕÇ2¥Â³ÒòçFW7B„$ÂæG6%vFW"ç6†FW"’bfÖ6²ƒ#Ãƒ“ã#Sbeµ²Ó3’ÃSEÒÅ³ƒRÃEÒÅ²ÓSRÂÓ“ÕÒæWfW'’‡ÓæÖ6²‚ââç“ÓÓÓ’“°¢6öç7B&öäf6W3ÔÂç&ö÷Bæ6†–ÆG&VâæfÆDÖ†ãÓæâævVöÖWG'“öâævVöÖWG'’æf6W2æf–ÇFW"†cÓæbæ’æWfW'’†“ÓæâævVöÖWG'’çfW'G5¶’£2³ÓãÒÒã#’bfâævVöÖWG'’çfW'G5¶’£2³ÓÃÒÒã#b’“¥µÒ“°¢&V6÷&B‚$E4"6ö7BföÓ¢F†RöÆB&÷fR×vFW"&öâ7G&——2vWBÖ–æW&ÂÖFW&–ÂÂæ÷B–çFVBv†—FRföÒ"Æ&öäf6W2æÆVæwFƒã3bf&öäf6W2æWfW'’†cÓäÖF‚æÖ‚‚ââæbæ6öÆ÷"“Ã#bbbæVÖ—76—fR’Ä¥4ôâç7G&–æv–g’‡¶f6W3¦&öäf6W2æÆVæwF‡Ò’“°¢6öç7BFWF‡3Õ²Òã3RÃÂã"Âã2ÂãRÂãrÂãƒuÒÇ÷6—F–öç3ÖFWF‡2æÖ‡#Óçö–çB‡"’’Ç&÷WFW3ÕµÓ°¢f÷"†6öç7B‚öb³’Ã#Ã3’ÃCUÒ—°¢ÆWB&Wf–÷W3×ö–çB‚Òã3RÇ‚’ÆÖ…7FWÓÆ&Æö6¶VCÓ°¢6öç7BVæC×ö–çB‚ãƒbÇ‚“°¢f÷"†ÆWB£×&Wf–÷W2ç¢²ãS·£ÃÖVæBç£·¢³ÒãR—¶6öç7B“ÔÂæ†V–v‡DB‡‚Ç¢“¶Ö…7FWÔÖF‚æÖ‚†Ö…7FWÄÖF‚æ'2‡’×&Wf–÷W2ç’’“¶–b‚rçvÆ¶&ÆR‡‚Ç&Wf–÷W2ç¢Ç‚Ç¢Ç&Wf–÷W2ç’Äæ&öG”†V–v‡BÄ—ÇÂrçvÆ¶&ÆR‡‚Ç¢Ç‚Ç&Wf–÷W2ç¢Ç’Äæ&öG”†V–v‡BÄ’–&Æö6¶VB²³·&Wf–÷W3×·‚Ç’Ç§Ó·Ð¢&÷WFW2çW6‚‡·‚ÆÖ…7FWÆ&Æö6¶VGÒ“°¢Ð¢&V6÷&B‚$E4"vF–æs¢G'’6æBF‡&÷Vv‚æ¶ÆR¶æVRv—7B6†W7B†VBæB&6²†26öçF–çV÷W2&öG’×v–FR7W÷'B"Ç&÷WFW2æWfW'’‡#Óâ"æ&Æö6¶VBbg"æÖ…7FWÂã‚’bg÷6—F–öç2æWfW'’‚‡Æ’“Óâ—ÇÇç£ç÷6—F–öç5¶’ÓÒç¢’Ä¥4ôâç7G&–æv–g’‡¶†V–v‡C¤æ&öG”†V–v‡BÇ&F—W3¤æ&öG•&F—W2Ç&÷WFW2Ç÷6—F–öç7Ò’“°¢Æö6FR‚Òã3R“¶6öç7B7F'CÔç&ö÷Bç÷6—F–öâç£·7FWƒ#BÃÃ“¶6öç7BFVWW7CÔ2äÄUdTÂÕræw&÷VæB„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢’ÆFVW£Ôç&ö÷Bç÷6—F–öâç£·7FWƒBÃÃ“¶6öç7B7F÷VCÔÖF‚æ'2„ç&ö÷Bç÷6—F–öâç¢ÖFVW¢“Âã#·7FWƒ3ÃÂÓ“°¢&V6÷&B‚$E4"vF–æs¢&VÂ–VÆÆ÷r&V6†W2&÷VæB†VBFWF‚Â6ææ÷B7&÷72ö6VâfÆö÷"æBvÆ·2&6²6†÷&R"ÆFVWW7Cäæ&öG”†V–v‡B¢ãƒ2bfFVWW7CÃÔ2æÖ„FWF‚„’bg7F÷VBbdç&ö÷Bç÷6—F–öâç£Ç7F'Bbd’ç7FG2æFWFƒÓÓÓÄ¥4ôâç7G&–æv–g’‡¶FVWW7BÆ†V–v‡C¤æ&öG”†V–v‡BÆFVW¢Ç7F÷VBÇ&WGW&æVC¤ç&ö÷Bç÷6—F–öâç¢Ç7F'GÒ’“°¢6öç7B&FW3ÕµÓ°¢f÷"†6öç7B&F–òöb³Âã"Âã2ÂãRÂãrÂãƒUÒ—¶Æö6FR‡&F–ò“¶6öç7BƒÔç&ö÷Bç÷6—F–öâçƒ·7FW‚ã#RÃÃ“·&FW2çW6‚‚„ç&ö÷Bç÷6—F–öâç‚×‚’òã#R“·Ð¢&V6÷&B‚$E4"vF–æs¢&VÂÖ÷fVÖVçB6Æ÷w26Öö÷F†Ç’v—F‚FWF‚v†–ÆRæ¶ÆRÖ÷fVÖVçB&VÖ–ç2&W7öç6—fR"Ç&FW2æWfW'’‚‡"Æ’“Óç#ãbb‚—ÇÇ#Ã×&FW5¶’ÓÒ²ãR’’bg&FW5³Óç&FW5³Ò¢ã“rbg&FW2æB‚Ó“Ç&FW5³Ò¢ãRÄ¥4ôâç7G&–æv–g’‡&FW2’“°¢ÆWB6Öö÷Fƒ×G'VRÆÆ7CÓ¶f÷"†ÆWB³Ó¶³ÃÓ¶²²²—¶6öç7BcÔ2ç7VVB†²ó“·6Öö÷F‚bcÔçVÖ&W"æ—4f–æ—FR‡b’bgcÃÖÆ7BbfÆ7B×cÂã#¶Æ7C×c·Ð¢&V6÷&B‚$E4"vF–æs¢FWF‚7W'fR†2æò7VVB7FW2æB7F—2&÷fRöæR×F†—&BvÆ¶–ær7VVB"Ç6Öö÷F‚bfÆ7CãÒã32“°¢6öç7BFVW×ö–çBƒãR“¶7&Wrç&VÆö6FUÆ–W"†FVWÃ“´’æ6ÆV"‚“·7FWƒÃÂÓ“°¢&V6÷&B‚$E4"vF–æs¢&VÆö6FVB÷fW"ÖFWF‚7F÷"6âÇv—2&WG&VBFò6†ÆÆ÷vW"w&÷VæB"Äç&ö÷Bç÷6—F–öâç£ÆFVWç¢Ó2bd’ç7FG2æFWFƒÄæ&öG”†V–v‡BÄ¥4ôâç7G&–æv–g’‡¶g&öÓ¦FVWÇFó¤ç&ö÷Bç÷6—F–öâÆFWFƒ¤’ç7FG2æFWF‡Ò’“°¢&V6÷&B‚$E4"6ö7BG—W3¢öæÇ’6†÷&6æB†26†VÆc²&V"öÇ–×W2Â&ö6·’V7BæB†&&÷"&WF–âFVWvFW""ÄÂæ†V–v‡DB‚ÓSRÂÓ““ÓÓÒÓRbdÂæ†V–v‡DBƒ“"ÃB“ÓÓÒÓRbdÂæ†V–v‡DB‚Ó3’ÃSB“ÓÓÒÓRbd2æ&V6‚‚ÓSRÂÓƒ“ÓÓÓbd2æ&V6‚‚Ó3’ÃSB“ÓÓÓbd2æ&V6‚ƒƒRÃB“ÓÓÓbbrçvÆ¶&ÆR‚Ó3’ÃSBÂÓ3’ÃSBÂÓRÄæ&öG”†V–v‡BÄ’“°¢6öç7Bf—'7CÔ’ç7FG2æVÖ—GFVC¶Æö6FR‚ãR“¶6öç7BVçG&–W3Ô’ç7FG2ç7Æ6†W3·7FWƒb“¶6öç7B–FÆSÔ’ç7FG2æVÖ—GFVBÖf—'7C·7FWƒ"ÃÃ“¶6öç7BÖ÷f–æsÔ’ç7FG2æVÖ—GFVBÖf—'7BÖ–FÆRÇv¶W3Ô’ç7FG2çv¶W3°¢&V6÷&B‚$E4"&—ÆW3¢–FÆRF—7GW&&æ6W2&R7'6S²Ö÷f–ær7&VFW27G&öævW"G&–Æ–ærv¶W2"Æ–FÆSÃbfÖ÷f–æsæ–FÆRbgv¶W3ãbd’ç7FG2çÆ–W#ãÄ¥4ôâç7G&–æv–g’‡¶–FÆRÆÖ÷f–ærÇv¶W2Ç7FG3¤’ç7FG7Ò’“°¢6öç7B7Æ6†W3Ô’ç7FG2ç7Æ6†W3¶7&Wræ§V×Æ–W"‚“·7FWƒ"“°¢&V6÷&B‚$E4"7Æ6†W3¢6†ÆÆ÷rVçG'’æBâ7GVÂ§V×ÆæF–ær&öGV6R6ÖÆÂ&÷VæFVBWfVçG2"ÆVçG&–W3ãbd’ç7FG2ç7Æ6†W3ç7Æ6†W2Ä¥4ôâç7G&–æv–g’‡¶VçG&–W2Ç7Æ6†W2ÆgFW#¤’ç7FG2ç7Æ6†W7Ò’“°¢6ÖW&ç÷6—F–öâçƒÒÓC¶6ÖW&ç÷6—F–öâç£ÒÓƒ´’æ6ÆV"‚“¶Æö6FR‚ãR“·7FWƒ"ÃÃ“°¢&V6÷&B‚$E4"vFW&fÆÃ¢ÆÂf—fR–×7G26öW†—7Bv—F‚Æ–W"F—7GW&&æ6W2–â&W6W'fVB6Æ÷G2"Äòæ–×7G2æÆVæwFƒÓÓÓRbd’ç7FG2æ–×7G3ÓÓÓRbd’ç7FG2çÆ–W#ãÄ¥4ôâç7G&–æv–g’„’ç7FG2’“°¢ÆWB&V6†&ÆSÖçVÆÃ¶6öç7BVW'“×·Ó°¢f÷"†6öç7Böbòç7G&VÒ––b„òçvFW$B‡ç‚Çç¢ÇVW'’’bgVW'’ç’Õræw&÷VæB‡ç‚Çç¢“âã#RbgVW'’ç’Õræw&÷VæB‡ç‚Çç¢“Äæ&öG”†V–v‡BberçvÆ¶&ÆR‡ç‚Çç¢Çç‚Çç¢Åræw&÷VæB‡ç‚Çç¢’Äæ&öG”†V–v‡BÄ’—·&V6†&ÆS×¶'&V³·Ð¢–b‡&V6†&ÆR—¶7&Wrç&VÆö6FUÆ–W"‡·ƒ§&V6†&ÆRç‚Ç“¥ræw&÷VæB‡&V6†&ÆRç‚Ç&V6†&ÆRç¢’Ç£§&V6†&ÆRç§ÒÃ“´’æ6ÆV"‚“·7FW‚ã“·Ð¢&V6÷&B‚$E4"vFW&fÆÃ¢–VÆÆ÷r&öGV6W2Æö6Â7G&VÒ&—ÆW2v†W&RF†R&÷fVB6÷W'6R—2&V6†&ÆR"Â&V6†&ÆRbd’ç7FG2çÆ–W#ãbd’ç7FG2æFWFƒãbd’ç7FG2æ–×7G3ÓÓÓRÄ¥4ôâç7G&–æv–g’‡·&V6†&ÆRÇ7FG3¤’ç7FG7Ò’“°¢6öç7BæöFW3Ô’æw&÷Wæ6†–ÆG&VâæÆVæwF‚ÆvVöÖWG&–W3ÖæWr6WB„’æw&÷Wæ6†–ÆG&VâæÖ†ãÓæâævVöÖWG'’’’Ç6Æ÷G3Ô’æ–×VÇ6W2æÖ‡ÓçææöFR’ÇF–W'3ÕµÓ°¢f÷"†6öç7BVÆ—G’öb²&†–v‚"Â&ÖVF—VÒ"Â&Æ÷r%Ò—·&VæFW&W"çVÆ—G“×VÆ—G“¶f÷"†ÆWB³Ó¶³Ãc¶²²²—´’æVÖ—Bƒ#ÂÒã2Ãƒ2Âã2Âã2Ã“´’çWFFRƒócÆ²ócÆçVÆÂ“·×F–W'2çW6‚‡·VÆ—G’Æ7F—fS¤’ç7FG2æ7F—fRÇ7v6ƒ¤’ç7FG2ç7v6‚Æ6öçF7G3¤’ç7FG2æ6öçF7G2Ç7G&V·3¤’ç7FG2ç7G&V·2Æ'VFvWC¤’æ'VFvWBç&—ÆW2Ç7VVC¤’ç7VVDB„—Ò“·Ð¢&V6÷&B‚$E4"VffV7G3¢F†÷W6æG2öb–×VÇ6W2&WW6Rf—†VB6Æ÷G2æBBÖ÷7BGvò6†&VBVffV7BvVöÖWG&–W2"Ä’æw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÖæöFW2bfvVöÖWG&–W2ç6—¦SÓÓÓ"bd’æ–×VÇ6W2æWfW'’‚‡Æ’“ÓçææöFSÓÓ×6Æ÷G5¶•Ò’bgF–W'2æWfW'’‡CÓçBæ7F—fSÃ×Bæ'VFvWB’Ä¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦RÇF–W'7Ò’“°¢&V6÷&B‚$E4"VffV7G3¢VÆ—G’66ÆW2öæÇ’f—7VÇ2æB¶VW2W76VçF–ÂÆ÷r×F–W"&—ÆW2æB7v6‚"ÇF–W'5³Òç7v6ƒçF–W'5³%Òç7v6‚bgF–W'5³Òç7G&V·3çF–W'5³%Òç7G&V·2bgF–W'5³%Òç7v6ƒãbgF–W'5³%Òæ7F—fSãbgF–W'2æWfW'’‡CÓçBç7VVCÓÓ×F–W'5³Òç7VVB’“°¢&VæFW&W"çVÆ—G“Ò&†–v‚#´’æ6ÆV"‚“¶6ÖW&ç÷6—F–öâçƒÓ#S¶6ÖW&ç÷6—F–öâç£Ó#S´’æVÖ—Bƒ#ÂÒã2Ãƒ2Âã2ÂãBÃ“´’çWFFRƒ"Ã"ÆçVÆÂ“°¢&V6÷&B‚$E4"&—ÆW3¢&–æw2W‡—&R–ç7FVBöb&V6öÖ–ærW&ÖæVçBö6VâvVöÖWG'’"Ä’ç7FG2æ7F—fSÓÓÓ“°¢6öç7Bv6ƒÕµÓ¶f÷"†6öç7BBöb³ÃãRÃ2ÃBãRÃeÒ—´’çWFFR‚ã"ÇBÆçVÆÂ“¶6öç7BãÔ’ç7v6…´ÖF‚æfÆö÷"„’ç7v6‚æÆVæwF‚ó"•ÒææöFS·v6‚çW6‚…¶âç÷6—F–öâç‚Æâç÷6—F–öâç’Æâç÷6—F–öâç¢Æâç6Öö¶T÷6—G•Ò“·Ð¢&V6÷&B‚$E4"7v6ƒ¢g&öçBGfæ6W2Â&WG&VG2ÂfFW2æBföÆÆ÷w2FW'&–â&÷fRF†RÖVâ6V"ÆæWr6WB‡v6‚æÖ‡Óç³%ÒçFôf—†VBƒ2’’’ç6—¦Sã2bgv6‚æWfW'’‡Óç³ÓãÔ2äÄUdTÂbg³ÓãÔÂæ†V–v‡DB‡³ÒÇ³%Ò’’bdÖF‚æÖ‚‚ââçv6‚æÖ‡Óç³5Ò’’ÔÖF‚æÖ–â‚ââçv6‚æÖ‡Óç³5Ò’“âãÄ¥4ôâç7G&–æv–g’‡v6‚’“°¢vFW"ç6WDVçf—&öæÖVçB‡·vfTVæW&w“£2Ç&÷Vv†æW73£ÆvÆ–çC¢ã"ÆföÓ£7Ò“´’çWFFR‚ã"Ã2ÆçVÆÂ“¶6öç7B7F÷&ÓÔ’æ6öçF7G5³ÒææöFRç66ÆRç£·vFW"ç6WDVçf—&öæÖVçB‡·vfTVæW&w“£Ç&÷Vv†æW73£ÆvÆ–çC£ÆföÓ£Ò“´’çWFFR‚ã"Ã2ÆçVÆÂ“°¢&V6÷&B‚$E4"6öçF7C¢7F÷&ÒföÒ—27G&öævW#²†&&÷"W6W2&W7G&–æVB÷7B×6—¦VBfö÷G&–çG2"Ç7F÷&Óä’æ6öçF7G5³ÒææöFRç66ÆRç¢bd’æ6öçF7G2æf–ÇFW"‡Óçæ†&&÷"’æÆVæwFƒÓÓÓbbd’æ6öçF7G2æf–ÇFW"‡Óçæ†&&÷"’æWfW'’‡ÓçææöFRç66ÆRçƒÂãR’“°¢6öç7B&ö6³Ô’æ6öçF7G2æf–æB‡Óâæ†&&÷"’ÇVÇ6S×&ö6²ææöFRç6Öö¶T÷6—G“´’çWFFR‚ã"Ã2ãRÆçVÆÂ“°¢&V6÷&B‚$E4"6ö7BföÓ¢&ö6²6öçF7G2&VÖ–âÆö6Æ—¦VBæBVÇ6R–æFWVæFVçFÇ’öbF†R6æG’7v6‚"Ä’ç7v6‚æÆVæwFƒãbd’æ6öçF7G2æf–ÇFW"‡Óâæ†&&÷"’æÆVæwFƒãbd’æ6öçF7G2æÆVæwFƒÃSbg&ö6²ææöFRç6Öö¶T÷6—G’Ó×VÇ6Rbd’ç7v6‚æWfW'’‡Óä2æ&V6‚‡ç‚Çç¢“ã’“°¢&V6÷&B‚$E4"vFW&fÆÃ¢&WF–æVB6†VWG27âWfW'’fÆÂæBÆÂvFW"÷7&’7W&f6W2W6R66VæRÆ–v‡F–ær"Äòç6†VWG2æÆVæwFƒÓÓÓRbdòç6†VWG2æWfW'’†cÓæbçF÷æbæ&÷GFöÒbfbçF÷Öbæ&÷GFöÓÃR’be²ââævVöÖWG&–W5ÒæWfW'’†sÓæræf6W2æWfW'’†cÓâbæVÖ—76—fR’’bd$ÂæG6%vFW"ç6†FW"æ–æ6ÇVFW2‚'ev÷&ÆBç’¢ã‚·Uv–æEF–ÖR£2ã""’bb$ÂæG6%vFW"ç6†FW"æ–æ6ÇVFW2‚&Æ6R¢ãR"’“°¢’çWFFR‚ã"ÃÆçVÆÂ“¶6öç7B7G&Vµ“Ô’ç7G&V·5³ÒææöFRç÷6—F–öâç“´’çWFFR‚ã"ÃãRÆçVÆÂ“°¢&V6÷&B‚$E4"vFW&fÆÃ¢†–v†Æ–v‡G2Ö÷fRF÷vçv&BöâF†RVæ6†ævVBfÆÂ6†VWG2"Ä’ç7G&V·5³ÒææöFRç÷6—F–öâç“Ç7G&Vµ’“°¢òòÖ&–æR7W÷'BæWfW"&WÆ6W2†V–v‡DC¢÷F–72ö–ÖÖW'6–öâ7F–ÆÂ6VRF†R÷&–v–æÂFVW6V&VBà¢6öç7B'&–FvSÔ$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷C¥rç&ö÷BÆW‡FW&–÷#§·f—6–&ÆS§G'VWÒÆÆæC¤ÂÇvVF†W#§·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÇ6WD–çFW&–÷"‚—·×ÒÇ&VÆö6FR‚—·ÒÆÆö6²‚—·ÒÆöä6†ævR‚—·×Ò“°¢f÷"†6öç7BBöbÂæ†&&÷$FV6·2æf–ÇFW"†CÓæBæ–BÓÒ'V’"’—°¢ÆWBÆVgCÖBç‚ÖBçró"Ç&–v‡CÖBç‚¶Bçró"Ç&÷3Ó°¢6öç7BVFvU&÷Ò‡bÆÒ“Óç¶ÆWBÆóÔ–æf–æ—G’Æ†“ÒÔ–æf–æ—G’Æ&÷GFöÓÔ–æf–æ—G’ÇF÷ÒÔ–æf–æ—G’Ç£Ô–æf–æ—G’Ç£ÒÔ–æf–æ—G“°¢f÷"†ÆWB£Ó¶£ÇbæÆVæwFƒ¶¢³Ó2—¶6öç7BƒÖÕ³Ò§e¶¥Ò¶Õ³…Ò§e¶¢³%Ò¶Õ³%ÒÇ“ÖÕ³Ò§e¶¥Ò¶Õ³UÒ§e¶¢³Ò¶Õ³•Ò§e¶¢³%Ò¶Õ³5ÒÇ£ÖÕ³%Ò§e¶¥Ò¶Õ³Ò§e¶¢³%Ò¶Õ³EÓ¶ÆóÔÖF‚æÖ–â†ÆòÇ‚“¶†“ÔÖF‚æÖ‚††’Ç‚“¶&÷GFöÓÔÖF‚æÖ–â†&÷GFöÒÇ’“·F÷ÔÖF‚æÖ‚‡F÷Ç’“·£ÔÖF‚æÖ–â‡£Ç¢“·£ÔÖF‚æÖ‚‡£Ç¢“·Ð¢–b‡£ÃC7ÇÇ£ãS‚ãWÇÇF÷ÃÖBçF÷ÇÆ&÷GFöÓãÖBçF÷´æ&öG”†V–v‡GÇÆÆóæBç‚³'ÇÆ†“ÆBç‚Ó"—&WGW&ã°¢&÷2²³¶–b‚†Æò¶†’’ó#ÆBç‚–ÆVgCÔÖF‚æÖ‚†ÆVgBÆ†’“¶VÇ6R&–v‡CÔÖF‚æÖ–â‡&–v‡BÆÆò“°¢Ó°¢f÷"†6öç7BböbræVç&–6†ÖVçBæf–VÆG2–f÷"†ÆWB“Ó¶“ÆbæÆ—7BæÆVæwFƒ¶’²²––b†bæÆ—7E¶•Òç&Vv–öãÓÓÒ'–W""–VFvU&÷†bævVöÖWG'’çfW'G2Æbç6÷W&6Rç7V&'&’†’£#Æ’£#³b’“°¢f÷"†6öç7BâöbræFWF–Âæw&÷Wæ6†–ÆG&Vâ––b†âævVöÖWG'“ÓÓÔ$ÂæG&W76–æræ6†÷&‚&&öÆÆ&B"’–VFvU&÷†âævVöÖWG'’çfW'G2Å³ÃÃÃÃÃÃÃÃÃÃÃÆâç÷6—F–öâç‚Æâç÷6—F–öâç’Æâç÷6—F–öâç¢ÃÒ“°¢6öç7B7–æSÒ†ÆVgB·&–v‡B’ó#°¢&V6÷&B‚$E4"–W""¶Bæ–B²#¢W†—7F–ær÷7G2Â&÷W2ÂÆ×2æBfVæFW'2ÆVfR&öG’×v–FRvÆ¶–ær7–æR"Ç&÷3ãbg&–v‡BÖÆVgCäæ&öG•&F—W2£"berçvÆ¶&ÆR‡7–æRÃC2Ç7–æRÃSrÆBçF÷Äæ&öG”†V–v‡BÄ’Ä¥4ôâç7G&–æv–g’‡¶ÆVgBÇ&–v‡BÇv–GFƒ§&–v‡BÖÆVgBÆ&öG“¤æ&öG•&F—W2£"Ç&÷7Ò’“°¢7&Wrç&VÆö6FUÆ–W"‡·ƒ¦Bç‚Ç“¥ræw&÷VæB†Bç‚Ã3‚’Ç££3‡ÒÃ“´’æ6ÆV"‚“¶ÆWBF–6·3ÓÆW'&÷#ÓÇvWCÖfÇ6S°¢v†–ÆR„ç&ö÷Bç÷6—F–öâç£ÃSrãbbgF–6·2²³Ã#—·7FWƒócÃÃ“¶–b„ç&ö÷Bç÷6—F–öâç£ãC2—¶W'&÷#ÔÖF‚æÖ‚†W'&÷"ÄÖF‚æ'2„ç&ö÷Bç÷6—F–öâç’Ôæ&6U’ÖBçF÷’“·vWBÇÃÒ’ç7FG2æFWFƒãÇÄ’ç7VVDB„’ÓÓ·×Ð¢6öç7BVæCÔç&ö÷Bç÷6—F–öâç£·7FWƒ"ÃÃ“¶6öç7BVFvSÔç&ö÷Bç÷6—F–öâç£°¢6öç7B3×·ƒ¦Bç‚Ç“¢Ó2Ç££SÓ¶'&–FvRæ6Æ×6ÖW&†2“°¢6öç7B7W÷'CÔÂæw&÷VæDB†Bç‚ÃS“ÓÓÖBçF÷bdÂç7W÷'DB†Bç‚ÃS“ÓÓÖBçF÷bf'&–FvRæw&÷VæDB†Bç‚ÃS“ÓÓÖBçF÷bf2ç“ÓÓÖBçF÷³°¢F–6·3Ó·v†–ÆR„ç&ö÷Bç÷6—F–öâç£ã3‚ãbgF–6·2²³Ã#—7FWƒócÃÂÓ“°¢&V6÷&B‚$E4"–W""¶Bæ–B²#¢&VÂ–VÆÆ÷rvÆ·2g&öÒ6†÷&RFòFV6²VæBæB&6²v—F‚G'’ÂW†7BFV6²7W÷'B"ÆVæCãSrãRbfVFvSÃÓS‚ãRÔæ&öG•&F—W2³RÓbbdç&ö÷Bç÷6—F–öâç£Ã3‚ã"bfW'&÷#ÃRÓbbbvWBbg7W÷'BÄ¥4ôâç7G&–æv–g’‡¶VæBÆVFvRÇ&WGW&æVC¤ç&ö÷Bç÷6—F–öâç¢ÆW'&÷"ÇvWBÇ7W÷'GÒ’“°¢&V6÷&B‚$E4"–W""¶Bæ–B²#¢FV6²VFvW2&WF–âFVWæöçvÆ¶&ÆR†&&÷"vFW"æBVæ6†ævVB÷F–72"ÄÂæ†V–v‡DB†Bç‚ÃS“ÓÓÒÓRbgvFW"æFWF„B†Bç‚ÃS“ãÓBãrbdÂæw&÷VæDB†Bç‚³"ÃS“ÓÓÒÓRbbrçvÆ¶&ÆR†Bç‚ÃSÆBç‚³"ÃSÆBçF÷Äæ&öG”†V–v‡BÄ’bbrçvÆ¶&ÆR†Bç‚³"ÃSÆBç‚³"ÃSÂÓRÄæ&öG”†V–v‡BÄ’“°¢Ð¢'&–FvRæF—7÷6R‚“°¢6öç7B6†–ÆG&VãÕrç&ö÷Bæ6†–ÆG&VâæÆVæwFƒ¶ÆWBÆ–fV7–6ÆS×G'VS°¢’çWFFR‚ã"ÃRÄÆfÇ6R“¶Æ–fV7–6ÆRbcÔ’ç7FG2æ7F—fSÓÓÓbd’ç7FG2æFWFƒÓÓÓbb’æw&÷Wçf—6–&ÆS´’æF—7÷6R‚“´’æF—7÷6R‚“¶Æ–fV7–6ÆRbcÔ’æw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓberç&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆG&VâÓ°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—¶6öç7BæW‡CÔ$ÂæG6%vFW$–çFW&7F–öâæ7&VFR…r“¶æW‡BçWFFR‚ã"Æ’Ä“¶Æ–fV7–6ÆRbcÖæW‡Bæw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÖæöFW2bfæW‡Bç7FG2æ7F—fSÃÓ#C¶æW‡BæF—7÷6R‚“¶Æ–fV7–6ÆRbcÖæW‡Bæw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓberç&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆG&VâÓ·Ð¢&V6÷&B‚$E4"vFW"Æ–fV7–6ÆS¢–æFö÷"vF–æræB&WVBF—7÷6Â÷&RÖVçG'’6ÆV"–×VÇ6W2v—F†÷WBw&÷v–æræöFW2"ÆÆ–fV7–6ÆR“°¢6öç7BWÆöC×vFW%WÆöE&ö&R„$ÂÅr“°¢&V6÷&B‚$E4"vV$tÂWÆöG3¢–æFWVæFVçBG&W76–ærf–VÆG2÷vâF†V—"&V6÷&G27&÷72F–W'2Âf–Ww2æBF—7÷6Â"ÇWÆöBç&÷w2æWfW'’‡#Óç"æW†6ÇW6—fRbg"æ&÷VæFVBbg"æG&vâbg"æW†7B’bbWÆöBæW'&÷'2æÆVæwF‚bgWÆöBæG&w3ãbgWÆöBç&VÆV6VBbbWÆöBæ'VffW'2bbWÆöBæÆ—7FVæW'2Ä¥4ôâç7G&–æv–g’‡WÆöB’“°¢ræF—7÷6R‚“°§Ó°¢òò&V6÷&FVBg&öÒcSs†c–6FfSssCcƒC–#VSS3&6S“sƒ–"&Vf÷&RÇ––ærF†RvFW"W‡FVç6–öâà¦6öç7BtDU%ôtôÄDTâÒ¶w&÷VæC¢#c–Cƒc6""ÆöÇ–×W3¢#C&6#Ffb"Æ'&–FvW3¢#“cF3Sb"Æ'V–ÆF–æw3¢#c3F33s“’"ÆfgC¢&33cf"'Ó° ¢òò'VÆS¢W‡FW&–÷"G&W76–ær×W7B&W6W'fRF†RW†7B7W÷'B7W&f6RæBW6&ÆR&÷WFW2BWfW'’F–W"à¦6öç7BW‡FW&–÷$Vç&–6†ÖVçD6†V6·2Ò$ÂÓâ°¢6öç7B3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÆÆæCÔ$ÂæG6$vVöw&‡’æ'V–ÆB‚’Ç&VæFW&W#×¶¶–æC¢'vV&vÃ""ÇVÆ—G“¢&†–v‚'ÒÆ6ÖW&Õ2æ7&VFT6ÖW&‚“¶6ÖW&ç÷6—F–öâç“Ó°¢6öç7BæGW&SÔ$ÂæG6$æGW&Ræ7&VFR‡·&ö÷BÆÆæBÇ&VæFW&W"Æ6ÖW&ÇvVF†W#§·7FFS§·v–æC§·7G&VæwFƒ¢ã'×××Ò’ÆFWF–ÃÔ$ÂæG6$W‡FW&–÷"æ7&VFR‡·&ö÷BÆÆæBÆæGW&WÒ“°¢6öç7B÷&–v–æÃÔ¥4ôâç7G&–æv–g’†ÆæBç&ö÷Bæ6†–ÆG&Vå³ÒævVöÖWG'’’Æ†V–v‡E6×ÆW3ÕµÓ°¢f÷"†ÆWBƒÒÓ“·ƒÃ“·‚³Ó2–f÷"†ÆWB£ÒÓ“·£Ãƒ·¢³Ó2–†V–v‡E6×ÆW2çW6‚†ÆæBæ†V–v‡DB‡‚Ç¢’“°¢6öç7BSÔ$ÂæG6$Vç&–6†ÖVçBæ7&VFR‡·&ö÷BÆÆæBÆæGW&RÆFWF–ÂÇ&VæFW&W"Æ6ÖW&Ò“´RçWFFRƒÃ“°¢6öç7B6÷VçG3Ôö&¦V7Bæg&öÔVçG&–W2„Ræf–VÆG2æÖ†cÓå¶bæ¶–æBÆbæÆ—7BæÆVæwF…Ò’“°¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢gW&æ—6†VB6æBÂ†&&÷"ÂfÆ÷vW&–ærF÷vâæBÆçFVB'V–ç2&R'V–ÇB"ÄRç7FG2ç6æDf6W3ã#bf6÷VçG2ç&6öÃãÓ2bf6÷VçG2æÆ÷VævW#ãÓBbf6÷VçG2çW&vöÆ&ööcÓÓÓ"bf6÷VçG2æ&öCÓÓÓ2bf6÷VçG2æ6öÇVÖããÓ"bf6÷VçG2æ'&ö¶VããÓ"bf6÷VçG2æfÆ÷vW&&÷ƒãbf6÷VçG2çf–æSãCÄ¥4ôâç7G&–æv–g’†6÷VçG2’“°¢ÆWBfÆöF–æsÓÆ'W&–VCÓÆ–çfÆ–CÓÆ6öçF7G3Ó°¢f÷"†6öç7BböbRæf–VÆG2—°¢f÷"†ÆWBãÓ¶ãÆbæÆ—7BæÆVæwFƒ¶â²²—°¢6öç7BÖbæÆ—7E¶åÒÆÖbç6÷W&6RÆóÖâ£#ÇcÖbævVöÖWG'’çfW'G3¶ÆWBF÷ÒÔ–æf–æ—G“°¢f÷"†ÆWB£Ó¶£ÇbæÆVæwFƒ¶¢³Ó2—¶6öç7BƒÖ¶õÒ§e¶¥Ò¶¶ò³…Ò§e¶¢³%Ò¶¶ò³%ÒÇ“Ö¶ò³Ò§e¶¥Ò¶¶ò³UÒ§e¶¢³Ò¶¶ò³•Ò§e¶¢³%Ò¶¶ò³5ÒÇ£Ö¶ò³%Ò§e¶¥Ò¶¶ò³Ò§e¶¢³%Ò¶¶ò³EÓ°¢–b‚·‚Ç’Ç¥ÒæWfW'’„çVÖ&W"æ—4f–æ—FR’––çfÆ–B²³°¢–b‡æ&÷GFöÒÓ×VæFVf–æVBbdÖF‚æ'2‡e¶¢³Ò×æ&÷GFöÒ“Âã—¶6öçF7G2²³¶–b‡“æÆæBæ†V–v‡DB‡‚Ç¢’²ã"–fÆöF–ær²³·×F÷ÔÖF‚æÖ‚‡F÷Ç’“°¢Ð¢–b‡æ&÷GFöÒÓ×VæFVf–æVBbgF÷ÆÆæBæ†V–v‡DB‡ç‚Çç¢’²ãb–'W&–VB²³°¢Ð¢Ð¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢&VÂG&ç6f÷&ÖVB6öçF7BfW'F–6W2&Rw&÷VæFVBæBvVöÖWG'’f–æ—FR"Æ6öçF7G3ãSbbfÆöF–ærbb'W&–VBbb–çfÆ–BÄ¥4ôâç7G&–æv–g’‡¶6öçF7G2ÆfÆöF–ærÆ'W&–VBÆ–çfÆ–GÒ’“°¢6öç7Bæö÷Ò‚“Óç·ÒÄ3Ô$Âæ7&Wræ7&VFR‡·&ö÷C¥2æ7&VFTæöFR‚’Çv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦æö÷Ç&VÖ÷fS¦æö÷ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¦ÆæBæ†V–v‡DBÇvÆ¶&ÆS¦ÆæBçvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò’ÄÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“°¢6öç7B&Æö6¶VCÕµÒÆ–çG'W6–öç3ÕµÓ°¢f÷"†6öç7B¶æÖRÆÆ–æUÒöbµ²&&V6‚"ÄRæ&V6…&÷WFUÒÅ²''V–ç2"ÄRç'V–å&÷WFUÒÅ²'G&–Â"ÆÆæBçG&–ÅÕÒ–f÷"†ÆWB“Ó¶“ÆÆ–æRæÆVæwFƒ¶’²²—°¢6öç7BÖÆ–æU¶’ÓÒÆ#ÖÆ–æU¶•Ó¶–b‚ÆæBçvÆ¶&ÆR†³ÒÆ³ÒÆ%³ÒÆ%³ÒÆÆæBæ†V–v‡DB‚ââæ’Äæ&öG”†V–v‡BÄ’–&Æö6¶VBçW6‚…¶æÖRÆ•Ò“°¢Ð¢òò–æFWVæFVçB6÷'&–F÷"6×Æ–ær6ö×&W26ö×ÆWFRw&÷VæB×&÷&÷VæG2v–ç7BF†R7F÷"&F—W2à¢f÷"†6öç7BÆ–æRöb¶ÆæBçG&–ÂÆÆæBçvFW&g&öçBÂââæÆæBæÆæW2ÄRæ&V6…&÷WFRÄRç'V–å&÷WFUÒ–f÷"†ÆWB“Ó¶“ÆÆ–æRæÆVæwFƒ¶’²²—°¢6öç7BÖÆ–æU¶’ÓÒÆ#ÖÆ–æU¶•ÒÆãÔÖF‚æ6V–Â„ÖF‚æ‡—÷B†%³ÒÖ³ÒÆ%³ÒÖ³Ò’£2“°¢f÷"†ÆWB£Ó¶£ÃÖã¶¢²²—¶6öç7BƒÖ³Ò²†%³ÒÖ³Ò’¦¢öâÇ£Ö³Ò²†%³ÒÖ³Ò’¦¢öã°¢f÷"†6öç7BöbRçÆ6VÖVçG2––b‡ç"bdÖF‚æ‡—÷B‡‚×ç‚Ç¢×ç¢“Çç"´æ&öG•&F—W2––çG'W6–öç2çW6‚…·æ¶–æBÇç‚Çç¥Ò“°¢Ð¢Ð¢2æF—7÷6R‚“°¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢ÖV7W&VB–VÆÆ÷r&V6†W2&V6‚Â'V–ç2æBG&–Âv—F‚ÆÂWF†÷&VB6÷'&–F÷'26ÆV""Â&Æö6¶VBæÆVæwF‚bb–çG'W6–öç2æÆVæwF‚Ä¥4ôâç7G&–æv–g’‡·&F—W3¤æ&öG•&F—W2Æ&Æö6¶VBÆ–çG'W6–öç3¦–çG'W6–öç2ç6Æ–6RƒÃR—Ò’“°¢6öç7BgFW#ÕµÓ¶f÷"†ÆWBƒÒÓ“·ƒÃ“·‚³Ó2–f÷"†ÆWB£ÒÓ“·£Ãƒ·¢³Ó2–gFW"çW6‚†ÆæBæ†V–v‡DB‡‚Ç¢’“°¢6öç7B6æCÔRç7W&f6W5³ÒÆ6ö7FÃÔRçÆ6VÖVçG2æf–ÇFW"‡Óå²&&V6‚"Â&÷WF7&÷"Â&6ö7B%Òæ–æ6ÇVFW2‡ç&Vv–öâ’“°¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢&÷fVBFW'&–â—2'—FRÖ–FVçF–6ÂæBæòæWr&V6‚&V6†W2&V"öÇ–×W2"Æ÷&–v–æÃÓÓÔ¥4ôâç7G&–æv–g’†ÆæBç&ö÷Bæ6†–ÆG&Vå³ÒævVöÖWG'’’bd¥4ôâç7G&–æv–g’†gFW"“ÓÓÔ¥4ôâç7G&–æv–g’††V–v‡E6×ÆW2’bf6ö7FÂæWfW'’‡Óçç£ãÒÓ#2’bg6æBçfW'G2æWfW'’‚‡bÆ’“Óæ’S2ÓÓ'ÇÇcãÓc’Ä¥4ôâç7G&–æv–g’‡¶6ö7FÃ¦6ö7FÂæÆVæwF‚Ç6æDf6W3§6æBæf6W2æÆVæwF‡Ò’“°¢6öç7B6–væGW&SÔ¥4ôâç7G&–æv–g’„RçÆ6VÖVçG2’Æ'VffW'3ÔRæf–VÆG2æÖ†cÓæbææöFRæ–ç7Fæ6TFF’Æ†–vƒÔRç7FG2çf—6–&ÆRÆföÓÔRæf–VÆG2æf–æB†cÓæbæ¶–æCÓÓÒ&föÒ"“°¢&VæFW&W"çVÆ—G“Ò&ÖVF—VÒ#´RçWFFRƒÃ“¶6öç7BÖVF—VÓÔRç7FG2çf—6–&ÆS·&VæFW&W"çVÆ—G“Ò&Æ÷r#´RçWFFRƒ"Ã“¶6öç7BÆ÷sÔRç7FG2çf—6–&ÆRÆÆ÷tföÓÔ'&’æg&öÒ†föÒææöFRæ–ç7Fæ6TFF“´RçWFFRƒÃ“°¢6öç7B7F&ÆSÔ¥4ôâç7G&–æv–g’†Æ÷tföÒ“ÓÓÔ¥4ôâç7G&–æv–g’„'&’æg&öÒ†föÒææöFRæ–ç7Fæ6TFF’“°¢&VæFW&W"æ¶–æCÒ&6çf3&B#·&VæFW&W"çVÆ—G“Ò&†–v‚#´RçWFFRƒÃ“¶6öç7B6çf3ÔRç7FG2çf—6–&ÆS°¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢&÷VæFVBF–W'2&WF–âÆæFÖ&·2Â7F÷Æ÷r×F–W"v6‚æB&WW6RWfW'’'VffW""Æ†–vƒæÖVF—VÒbfÖVF—VÓæÆ÷rbf6çf3ÓÓÖÆ÷rbg7F&ÆRbdRç7FG2æ&F6†W3ÃÓC"bdRç7FG2æÆ–v‡G3ÓÓÓbdRæf–VÆG2æWfW'’‚†bÆ’“ÓæbææöFRæ–ç7Fæ6TFFÓÓÖ'VffW'5¶•Ò’bdRæf–VÆG2æf–ÇFW"†cÓå²&6öÇVÖâ"Â&&öB"Â'&6öÂ"Â'W&vöÆ&ööb%Òæ–æ6ÇVFW2†bæ¶–æB’’æWfW'’†cÓæbææöFRæ–ç7Fæ6T6÷VçCÓÓÖbæÆ—7BæÆVæwF‚’Ä¥4ôâç7G&–æv–g’‡¶†–v‚ÆÖVF—VÒÆÆ÷rÆ6çf2Æ&F6†W3¤Rç7FG2æ&F6†W2ÆföÓ¤Rç7FG2æfö×Ò’“°¢&VæFW&W"æ¶–æCÒ'vV&vÃ"#·&VæFW&W"çVÆ—G“Ò&†–v‚#´RçWFFRƒ"Ã“¶6öç7BÆ—CÔRæf–VÆG2æf–ÇFW"†cÓå²&vÆ72"Â'v–æF÷vvÆ÷r%Òæ–æ6ÇVFW2†bæ¶–æB’’æWfW'’†cÓæbævVöÖWG'’æf6W2ç6öÖR†f6SÓæf6RæVÖ—76—fSã’bfbææöFRævÆ÷sâãrbfbææöFRæ–ç7Fæ6TFFæWfW'’‚‡bÆ’“Óæ’S#ÓÓgÇÆ“ãÖbææöFRæ–ç7Fæ6T6÷VçB£#ÇÇcâãr’“´RçWFFRƒ2Ã“°¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢&7F–6ÂÆ–v‡G2föÆÆ÷rF†RW†—7F–ærÆ×f7F÷"v—F†÷WBFF–ær&VÂÆ–v‡G2"ÆÆ—BbdRæf–VÆG2æf–ÇFW"†cÓå²&vÆ72"Â'v–æF÷vvÆ÷r%Òæ–æ6ÇVFW2†bæ¶–æB’’æWfW'’†cÓæbææöFRævÆ÷sÓÓÓbfbææöFRæ–ç7Fæ6TFFæWfW'’‚‡bÆ’“Óæ’S#ÓÓgÇÆ“ãÖbææöFRæ–ç7Fæ6T6÷VçB£#ÇÇcÓÓÓ’’bdRç7FG2æÆ–v‡G3ÓÓÓ“°¢6öç7B6†–ÆG&Vã×&ö÷Bæ6†–ÆG&VâæÆVæwFƒ¶ÆWBÆ–fV7–6ÆS×G'VS°¢RæF—7÷6R‚“´RæF—7÷6R‚“°¢Æ–fV7–6ÆRbcÔRæw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓbg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆG&VâÓbdRæf–VÆG2æÆVæwFƒÓÓÓ°¢f÷"†ÆWB“Ó¶“Ã#¶’²²—¶6öç7BæW‡CÔ$ÂæG6$Vç&–6†ÖVçBæ7&VFR‡·&ö÷BÆÆæBÆæGW&RÆFWF–ÂÇ&VæFW&W"Æ6ÖW&Ò“¶æW‡BçWFFR†’Ã“¶Æ–fV7–6ÆRbcÔ¥4ôâç7G&–æv–g’†æW‡BçÆ6VÖVçG2“ÓÓ×6–væGW&Rbg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆG&Vã¶æW‡BæF—7÷6R‚“¶Æ–fV7–6ÆRbcÖæW‡Bæw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓbg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆG&VâÓ·Ð¢FWF–ÂæF—7÷6R‚“¶æGW&RæF—7÷6R‚“°¢&V6÷&B‚$W‡FW&–÷"Vç&–6†ÖVçC¢&WVBf—6—G2&VÆV6RWfW'’æöFRæB&V'V–ÆBF†R6ÖR&÷VæFVBÆ–÷WB"ÆÆ–fV7–6ÆRbg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÓ“°§Ó° ¢òò'VÆS¢F†RWF†÷&VBÖ†—2&÷WFW2æB7FæBö–çG2×W7Bf—BF†R&VÂ–VÆÆ÷r7F÷"Âæ÷BwVW76VB&F—W2à¦6öç7BÖ†—46†V6·2Ò$ÂÓâ°¢6öç7Bæö÷Ò‚“Óç·ÒÅ3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÇF&vWG3ÖæWr6WB‚“°¢6öç7BÆæC×¶'V–ÆF–æw3¥·¶æÖS¢$Ö†—26ÇV"F†VFW""Çƒ£Ç££Ç–s£ÆC£'ÕÒÆ†V–v‡DC¢‚“ÓãÇvÆ¶&ÆS¢‚“ÓçG'VWÓ°¢6öç7B“Ô$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷BÆW‡FW&–÷#§·f—6–&ÆS§G'VWÒÆÆæBÇvVF†W#§·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÇ6WD–çFW&–÷#¦æö÷ÒÇ&VÆö6FS¦æö÷ÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“°¢’ç&Wf–Wr‚&Ö†—2Ö6ÇV""ÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÓ°¢6öç7B3Ô$Âæ7&Wræ7&VFR‡·&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦ãÓçF&vWG2æFB†â’Ç&VÖ÷fS¦ãÓçF&vWG2æFVÆWFR†â—ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¤’æw&÷VæDBÇvÆ¶&ÆS¤’çvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“´2æ6öçG&öÂ„“°¢6öç7B6ÆV#Ò†‚Æ¢Æ'ƒÖ‚Æ'£Ö¢“Óä’çvÆ¶&ÆR†‚Æ¢Æ'‚Æ'¢Å"æw&÷VæDB†‚Æ¢’Äæ&öG”†V–v‡BÄ“°¢&V6÷&B‚$Ö†—3¢S&WW6&ÆR6VG2f—BÖV7W&VB–VÆÆ÷r66ÆR"Å"ç6VG2æÆVæwFƒÓÓÓSbdæ&öG”†V–v‡Cãã2bdæ&öG”†V–v‡CÃãRbe"ç6VG2æWfW'’‡3Óç2æÆÆ÷uvVöç2bg2æÆö6´Ö÷fVÖVçBbf6ÆV"‡2çvÆ´Bç‚Ç2çvÆ´Bç¢’’Ä¥4ôâç7G&–æv–g’‡¶†V–v‡C¤æ&öG”†V–v‡BÇ&F—W3¤æ&öG•&F—W2Æ&Æö6¶VC¥"ç6VG2æÖ‚‡2Æ’“Óâ6ÆV"‡2çvÆ´Bç‚Ç2çvÆ´Bç¢“ö“¦çVÆÂ’æf–ÇFW"†“Óæ’ÓÖçVÆÂ—Ò’“°¢6öç7B6VE&W7VÇG3ÕµÓ°¢f÷"†6öç7B¶’Ç6VEÒöb"ç6VG2æVçG&–W2‚’—°¢ö&¦V7Bæ76–vâ„ç&ö÷Bç÷6—F–öâÇ·ƒ§6VBçvÆ´Bç‚Ç“§6VBæfÆö÷"´æ&6U’Ç£§6VBçvÆ´Bç§Ò“´æ†÷Ôæ†÷cÓ°¢6öç7B6CÔ2ç6—EÆ–W"‡6VB’ÆÆ–væVCÔç&ö÷Bç&÷FF–öâç“ÓÓ×6VBç'“°¢2æ6öæf–wW&UvVöâ„Ã"Ã3“´2ç7FVW"‚ãRÃ“´2æÆöö²‡6VBç'’ÂãÃ“´2çWFFR‚ã"Æ’¢ã"“°¢6öç7BÆö6¶VCÔç&ö÷Bç÷6—F–öâçƒÓÓ×6VBç‚bdç&ö÷Bç÷6—F–öâç£ÓÓ×6VBç¢Ç6†÷G3ÔçvVöâç6†÷G4f—&VC°¢6öç7BwVã×6Bbd2æf—&UvVöâ„Ç·ƒ§6VBç‚Ç“§6VBç’³Ç£¢Ó7ÒÃ’bdçvVöâç6†÷G4f—&VCÓÓ×6†÷G2³°¢2ç7FVW"ƒÃ“¶6öç7BF‡&Ws×6Bbd2çF‡&÷uFöÖFò‚“´2æ6ÆV%&ö¦V7F–ÆW2‚“°¢6öç7B7FööCÔ2ç7FæEÆ–W"‚“·6VE&W7VÇG2çW6‚‡¶’Æö³§6BbfÆ–væVBbfÆö6¶VBbfwVâbgF‡&Wrbg7FööBbb6VBç6—GFW"bbæ6×ç6VBbf6ÆV"„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢—Ò“°¢Ð¢&V6÷&B‚$Ö†—3¢&VÂ7&Wr6—G2ÂÆö6·2Ö÷fVÖVçBÂ–×2öf—&W2ÂF‡&÷w2æB7FæG2BÆÂS6†—'2"Ç6VE&W7VÇG2æWfW'’‡ƒÓç‚æö²’Ä¥4ôâç7G&–æv–g’‡6VE&W7VÇG2æf–ÇFW"‡ƒÓâ‚æö²’’“°¢òòfÆööBF†R7GVÂ6öÆÆ—6–öâVW&–W2BV'FW"×Væ—B&W6öÇWF–öâÂ&V¦V7F–ærF—66öçF–çV÷W2fÆö÷"7FW2à¢6öç7B7FWÒã#RÇsÓÆƒÓ#RÇ6VVãÖæWrV–çC„'&’‡r¦‚’ÇVWVSÕµÒÆ–æFWƒÒ‡‚Ç¢“ÓäÖF‚ç&÷VæB‚‡¢³2ãR’÷7FW’§r´ÖF‚ç&÷VæB‚‡‚³"ãR’÷7FW“°¢6öç7B7F'CÖ–æFW‚…"ç7vâç‚Å"ç7vâç¢“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—°¢6öç7B“×VWVU¶†VEÒÆ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r’ÇƒÒÓ"ãR¶—‚§7FWÇ£ÒÓ2ãR¶—¢§7FW°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—°¢6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢ÆãÖç¢§r¶çƒ¶–b†çƒÃÇÆçƒã×wÇÆç£ÃÇÆç£ãÖ‡ÇÇ6VVå¶åÒ–6öçF–çVS°¢6öç7Bƒ×‚¶G‚§7FWÇ£×¢¶G¢§7FW°¢–b„ÖF‚æ'2…"æw&÷VæDB‡‚Ç¢’Õ"æw&÷VæDB‡‚Ç¢’“âãWÇÂ6ÆV"‡‚Ç¢Ç‚Ç¢’–6öçF–çVS°¢6VVå¶åÓÓ·VWVRçW6‚†â“°¢Ð¢Ð¢6öç7B&V6†&ÆSÒ‡‚Ç¢“Óç¶6öç7B“Ö–æFW‚‡‚Ç¢’Æ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r“¶f÷"†ÆWBGƒÒÓ#¶GƒÃÓ#¶G‚²²–f÷"†ÆWBG£ÒÓ#¶G£ÃÓ#¶G¢²²—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G£¶–b†çƒãÓbfçƒÇrbfç£ãÓbfç£Æ‚bg6VVå¶ç¢§r¶ç…Òbf6ÆV"‚Ó"ãR¶ç‚§7FWÂÓ2ãR¶ç¢§7FWÇ‚Ç¢’—&WGW&âG'VS·×&WGW&âfÇ6S·Ó°¢6öç7BvöÇ3Õµ"æÖVF–BÇ·ƒ£Ç£¢ÓÒÇ·ƒ£Ç£¢Ó"ã7ÒÇ·ƒ¢Óã2Ç£¢Ó‚ã#WÒÇ·ƒ£ã2Ç£¢Ó‚ã#WÒÇ·ƒ£bÇ££ÒÂââå"ç6VG2æÖ‡3Óç2çvÆ´B•Ó°¢&V6÷&B‚$Ö†—3¢Æö&'’&V6†W267&VVâÂ7F—'2Â&÷F‚vÆÆW&–W2Â&"æBWfW'’6VB"ÆvöÇ2æWfW'’‡Óç&V6†&ÆR‡ç‚Çç¢’’Ä¥4ôâç7G&–æv–g’†vöÇ2æf–ÇFW"‡Óâ&V6†&ÆR‡ç‚Çç¢’’’“°¢6öç7BvVöÖWG&–W3ÖæWr6WB‚“¶ÆWBæöFW3ÓÆf–æ—FS×G'VSµ2çWFFUv÷&ÆB…"ç&ö÷B“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’—¶vVöÖWG&–W2æFB†âævVöÖWG'’“¶f–æ—FRbcÖâævVöÖWG'’çfW'G2æWfW'’„çVÖ&W"æ—4f–æ—FR“·Öâæ6†–ÆG&Vâæf÷$V6‚‡f—6—B“·Ó·f—6—B…"ç&ö÷B“°¢&V6÷&B‚$Ö†—3¢6†&VBvVöÖWG'’Âf–æ—FRG&ç6f÷&×2æBf—fRWF†÷&VBÆ–v‡G2"Æf–æ—FRbfvVöÖWG&–W2ç6—¦SÃ“bfæöFW3Ã##be"æÆ–v‡F–æræÆ–v‡D6÷VçCÓÓÓRÄ¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦WÒ’“°¢&V6÷&B‚$Ö†—3¢Ö–âF†VFW"v–âW†6VVG2Æö&'’æB‡—6–6Â67&VVâ6†ævW27FFR"Å"æv–äBƒÃ“å"æv–äB‚ÓRãbÃb’be"æv–äB‚ÓRãbÃb“ãbgG—Vöb"ç6WDÖVF–ÓÓÒ&gVæ7F–öâ"“°¢6öç7B&ööÕ&ö÷CÕ"ç&ö÷C´2æF—7÷6R‚“´’æF—7÷6R‚“·&V6÷&B‚$Ö†—3¢7F÷"æB&ööÒF—7÷6Â&VÖ÷fR–çWBF&vWG2æB66VæR6†–ÆG&Vâ"ÇF&vWG2ç6—¦SÓÓÓbb&ö÷Bæ6†–ÆG&Vâæ–æ6ÇVFW2‡&ööÕ&ö÷B’“°¢6öç7BCÔ$ÂæÖ†—4ÖVF–FF°¢6öç7BvööCÕµ²'–÷WGV&R"Â&‡GG3¢ò÷–÷WGRæ&RôÓvÆ3UfbÕdR%ÒÅ²'–÷WGV&R"Â&‡GG3¢ò÷wwrç–÷WGV&Ræ6öÒ÷Æ–Æ—7CöÆ—7CÕÃ#3CScsƒ“#3CR%ÒÅ²'Gv—F6‚"Â&‡GG3¢ò÷Gv—F6‚çGb÷–VÆÆ÷r%ÒÅ²'Gv—F6‚"Â&‡GG3¢ò÷Gv—F6‚çGb÷f–FV÷2ó#3CR%ÒÅ²'Gv—F6‚"Â&‡GG3¢òö6Æ—2çGv—F6‚çGbôW†×ÆT6Æ—%ÒÅ²'‚"Â&‡GG3¢ò÷‚æ6öÒöW†×ÆR÷7FGW2ó#3CSb%ÒÅ²&F—&V7B"Â&‡GG3¢òöW†×ÆRæ6öÒöf–ÆÒæ×B%ÒÅ²&F—&V7B"Â&‡GG3¢òöW†×ÆRæ6öÒöÆ—fRæÓ7S‚%ÕÓ°¢&V6÷&B‚$Ö†—2ÖVF–¢6æöæ–6Âf–FVòÂÆ–Æ—7BÂ6†ææVÂÂdôBÂ6Æ—Â÷7BæBF—&V7Bf÷&ÖG2"ÆvööBæWfW'’‚…·ÇUÒ“ÓäBç'6R‡ÇR’ç&÷f–FW#ÓÓ×’“°¢6öç7B&CÕµ²&F—&V7B"Â&¦f67&—C¦ÆW'Bƒ’%ÒÅ²&F—&V7B"Â&‡GG3¢ò÷W6W#§6V7&WDW†×ÆRæ6öÒöæ×B%ÒÅ²&F—&V7B"Â&‡GG3¢òöÆö6Æ†÷7Böæ×B%ÒÅ²&F—&V7B"Â&‡GG3¢òó#rãããöæ×B%ÒÅ²'–÷WGV&R"Â&‡GG3¢ò÷–÷WGV&Ræ6öÒæWf–ÂæW†×ÆR÷vF6ƒ÷cÔÓvÆ3UfbÕdR%ÒÅ²'‚"Â&‡GG3¢ò÷‚æ6öÒöW†×ÆR%ÒÅ²&F—&V7B"Â&‡GG3¢òöW†×ÆRæ6öÒ÷vRæ‡FÖÂ%ÕÓ°¢&V6÷&B‚$Ö†—2ÖVF–¢&V¦V7G2Vç6fRU$Ç2æBVç7W÷'FVB&÷f–FW"6†W2"Æ&BæWfW'’‚…·ÇUÒ“Óç·G'—´Bç'6R‡ÇR“·&WGW&âfÇ6S·Ö6F6‡·&WGW&âG'VS·×Ò’“°¢&V6÷&B‚$Ö†—2ÖVF–¢öffÆ–æRÆ—fRæBÆö6Âf–ÇFW&–ær&WV—&Ræò&6¶VæB÷"7&VFVçF–Ç2"ÄBç'6R‚&Æ—fR"Â""’æöffÆ–æRbdBç6V&6‚‚'–VÆÆ÷r"’æÆVæwFƒÓÓÓbdBç6V&6‚‚&æ÷B6öæf–wW&VB"’æÆVæwFƒÓÓÓbdBç6V&6‚‚&'6VçBF—FÆR"’æÆVæwFƒÓÓÓ“°¢òò6öçG&7C¢W†W&6—6RF†R7GVÂÖVF–6öçG&öÆÆW"v—F‚6ÖÆÂDôÒG&ç7÷'BF÷V&ÆRÂv—F†÷WBfWF6†–ær&÷f–FW'2à¢6öç7B6fVC×·6†VÆÃ¤$ÂæG6$ÖVçU6†VÆÂÆFö7VÖVçC¦vÆö&ÅF†—2æFö7VÖVçBÆÆö6F–öã¦vÆö&ÅF†—2æÆö6F–öâÆFC§v–æF÷ræFDWfVçDÆ—7FVæW"Ç&VÖ÷fS§v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW'ÒÆÆ—7FVæW'3ÖæWrÖ‚’Æg&ÖW3ÕµÓ°¢6öç7BVÆVÖVçC×FsÓç°¢6öç7B6VÆV7F÷'3ÖæWrÖ‚’ÆS×·FrÆ6†–ÆG&Vã¥µÒÆFF6WC§·ÒÇfÇVS§FsÓÓÒ&–çWB#ò"#¢""Æ†–FFVã¦fÇ6RÇ&VçC¦çVÆÂÀ¢6Æ74Æ—7C§¶FC¦æö÷Ç&VÖ÷fS¦æö÷ÇFövvÆS¦æö÷ÒÇ6WDGG&–'WFS¦æö÷Ç&VÖ÷fTGG&–'WFS¦æö÷ÆFDWfVçDÆ—7FVæW#¦æö÷Ç&VÖ÷fTWfVçDÆ—7FVæW#¦æö÷À¢VæD6†–ÆB†2—¶2ç&VçC×F†—3·F†—2æ6†–ÆG&VâçW6‚†2“·&WGW&â3·ÒÇ&WÆ6T6†–ÆG&Vâ‚—¶f÷"†6öç7B2öbF†—2æ6†–ÆG&Vâ–2ç&VçCÖçVÆÃ·F†—2æ6†–ÆG&VãÕµÓ·ÒÇ&VÖ÷fR‚—¶–b‡F†—2ç&VçB—F†—2ç&VçBæ6†–ÆG&Vã×F†—2ç&VçBæ6†–ÆG&Vâæf–ÇFW"†3Óæ2Ó×F†—2“·F†—2ç&VçCÖçVÆÃ·ÒÆ&ÇW#¦æö÷À¢VW'•6VÆV7F÷"‡—¶–b‚6VÆV7F÷'2æ†2‡’—¶6öç7BãÖVÆVÖVçB‡ÓÓÒ&–çWB#ò&–çWB#¢&F—b"“¶–b‡ÓÓÒ"æÖ†—2×föÇVÖR"–âçfÇVSÒ#ã‚#·6VÆV7F÷'2ç6WB‡Æâ“·×&WGW&â6VÆV7F÷'2ævWB‡“·Ð¢Ó¶–b‡FsÓÓÒ&–g&ÖR"—¶Ræ6öçFVçEv–æF÷s×·÷7DÖW76vS¦æö÷Ó¶g&ÖW2çW6‚†R“·×&WGW&âS°¢Ó°¢vÆö&ÅF†—2æFö7VÖVçC×¶7&VFTVÆVÖVçC¦VÆVÖVçBÆ&öG“¦VÆVÖVçB‚&&öG’"’Æ†–FFVã¦fÇ6RÆ7F—fTVÆVÖVçC¦çVÆÂÆgVÆÇ67&VVäVÆVÖVçC¦çVÆÂÆFDWfVçDÆ—7FVæW#¢†²Æb“ÓæÆ—7FVæW'2ç6WB‚&C¢"¶²Æb’Ç&VÖ÷fTWfVçDÆ—7FVæW#¦³ÓæÆ—7FVæW'2æFVÆWFR‚&C¢"¶²—Ó°¢vÆö&ÅF†—2æÆö6F–öã×¶‡&Vc¢&‡GG3¢ò÷–VÆÆ÷v'&ö¶V—Bæv—F‡V"æ–òöööv&öövÆæBöG6"×&Wf–Wrö–æFW‚æ‡FÖÂ"Æ÷&–v–ã¢&‡GG3¢ò÷–VÆÆ÷v'&ö¶V—Bæv—F‡V"æ–ò'Ó°¢v–æF÷ræFDWfVçDÆ—7FVæW#Ò†²Æb“ÓæÆ—7FVæW'2ç6WB‚'s¢"¶²Æb“·v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#Ö³ÓæÆ—7FVæW'2æFVÆWFR‚'s¢"¶²“°¢G'—°¢$ÂæG6$ÖVçU6†VÆÃ×·&W6VçC¦æö÷Ó°¢6öç7BÓÔ$ÂæÖ†—4ÖVF–æ7&VFR‚“¶ÆWBö¶“×G'VS°¢6öç7B&WÇ“Ò†g&ÖRÇ7FFRÆÖW76vSÒ""Æ÷&–v–ãÖÆö6F–öâæ÷&–v–â“ÓæÆ—7FVæW'2ævWB‚'s¦ÖW76vR"’‡·6÷W&6S¦g&ÖRæ6öçFVçEv–æF÷rÆ÷&–v–âÆFF§¶¶–æC¢&Ö†—2×Æ–W""Ç7FFRÆÖW76vW×Ò“°¢f÷"†ÆWB73Ó·73Ã3·72²²—°¢ÒæVçFW"‚“´Òç6WDv–â‚ã‚ÆfÇ6R“´ÒæÆöB‚'–÷WGV&R"Â&‡GG3¢ò÷–÷WGRæ&RôÓvÆ3UfbÕdR"“¶6öç7B7FÆSÖg&ÖW2æB‚Ó“´ÒæÆöB‚'Gv—F6‚"Â&‡GG3¢ò÷Gv—F6‚çGb÷–VÆÆ÷r"“¶6öç7BGv—F6ƒÖg&ÖW2æB‚Ó“°¢ÒæÆöB‚'‚"Â&‡GG3¢ò÷‚æ6öÒöW†×ÆR÷7FGW2ó#3CSb"“¶6öç7B÷7CÖg&ÖW2æB‚Ó“´ÒæÆöB‚&F—&V7B"Â&‡GG3¢òöW†×ÆRæ6öÒöf–ÆÒæ×B"“¶6öç7B7W'&VçCÖg&ÖW2æB‚Ó“°¢6öç7B7FGW3ÖFö7VÖVçBæ&öG’æ6†–ÆG&Vå³ÒçVW'•6VÆV7F÷"‚"æÖ†—2×7FGW2"’Æ&Vf÷&S×7FGW2çFW‡D6öçFVçC°¢&WÇ’‡7FÆRÂ&W'&÷""Â'7FÆR"“·&WÇ’†7W'&VçBÂ&W'&÷""Â&f÷&vVB"Â&‡GG3¢ò÷Vç&VÆFVBæW†×ÆR"“°¢ö¶’bc×7FGW2çFW‡D6öçFVçCÓÓÖ&Vf÷&RbbGv—F6‚ç&VçBbb÷7Bç&VçC°¢&WÇ’†7W'&VçBÂ&'&–FvR×&VG’"“·&WÇ’†7W'&VçBÂ&ÆöF–ær"Â$ÆöF–ærF—&V7B"“¶ö¶’bcÔÒç7FG2çVæF–æsÓÓÓ°¢&WÇ’†7W'&VçBÂ'&VG’"Â%&VG’"“¶ö¶’bcÔÒç7FG2çVæF–æsÓÓÓ°¢ÒægVÆÇ67&VVâ‚“´ÒægVÆÇ67&VVâ‚“´Òæ6Æ÷6R‚“´Òç6WDv–â‚ã"ÇG'VR“°¢ö¶’bcÒ7FÆRç&VçBbb7W'&VçBç&VçBbdÒç7FG2çÆ–W'3ÓÓÓbdÒç7FG2ç&÷f–FW#ÓÓÒ&F—&V7B"bdÒç7FG2æÆ7EföÇVÖSÓÓÓ°¢Òç6WDv–â‚ã‚ÆfÇ6R“¶Fö7VÖVçBæ†–FFVã×G'VS¶Æ—7FVæW'2ævWB‚&C§f—6–&–Æ—G–6†ævR"’‚“¶ö¶’bcÔÒç7FG2æÆ7EföÇVÖSÓÓÓ¶Fö7VÖVçBæ†–FFVãÖfÇ6S°¢ÒæÆöB‚&Æ—fR"Â""“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓbb7W'&VçBç&VçC°¢ÒæÆVfR‚“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓbdÒç7FG2çVæF–æsÓÓÓbb7W'&VçBç&VçC°¢Ð¢ÒæVçFW"‚“´Òç6WDv–â‚ã‚ÆfÇ6R“´ÒæÆöB‚'‚"Â&‡GG3¢ò÷‚æ6öÒöW†×ÆR÷7FGW2ó#3CSb"“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓ´Òæ6Æ÷6R‚“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓ°¢f÷"†6öç7B·&÷f–FW"ÇW&ÅÒöbµ²'‚"Â&‡GG3¢ò÷‚æ6öÒöW†×ÆR÷7FGW2ó#3CSb%ÒÅ²'Gv—F6‚"Â&‡GG3¢òö6Æ—2çGv—F6‚çGbôW†×ÆT6Æ—%ÕÒ—°¢Òç6WDv–â‚ã‚ÆfÇ6R“´ÒæÆöB‡&÷f–FW"ÇW&Â“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓ´Òç6WDv–â‚ã‚ÇG'VR“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓ°¢ö¶’bcÒÒæÆöB‡&÷f–FW"ÇW&Â’bdÒç7FG2çÆ–W'3ÓÓÓ´Òç6WDv–â‚ã‚ÆfÇ6R“´ÒæÆöB‡&÷f–FW"ÇW&Â“¶Fö7VÖVçBæ†–FFVã×G'VS¶Æ—7FVæW'2ævWB‚&C§f—6–&–Æ—G–6†ævR"’‚“¶ö¶’bcÔÒç7FG2çÆ–W'3ÓÓÓ¶Fö7VÖVçBæ†–FFVãÖfÇ6S°¢Ð¢ÒæF—7÷6R‚“·&V6÷&B‚$Ö†—2ÖVF–¢7v—F6†–ærÂ7FÆR&WÆ–W2ÂgVÆÇ67&VVâÂ×WFRæBF‡&VRf—6—B7–6ÆW2&WF–âöæRÆ–W"F†VâF—7÷6R"Æö¶’bfÆ—7FVæW'2ç6—¦SÓÓÓbfFö7VÖVçBæ&öG’æ6†–ÆG&VâæÆVæwFƒÓÓÓbdÒç7FG2æF—7÷6VB“°¢Öf–æÆÇ—´$ÂæG6$ÖVçU6†VÆÃ×6fVBç6†VÆÃ¶vÆö&ÅF†—2æFö7VÖVçC×6fVBæFö7VÖVçC¶vÆö&ÅF†—2æÆö6F–öã×6fVBæÆö6F–öã·v–æF÷ræFDWfVçDÆ—7FVæW#×6fVBæFC·v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#×6fVBç&VÖ÷fS·Ð§Ó° ¢òò'VÆS¢F†R6†÷w&ööÒ×W7B&R&V6†&ÆR'’F†R&VÂ–VÆÆ÷ræB×W7BöæÇ’W‡÷6RV&Æ–26FÆörÆ–æ·2à¦6öç7B'VÆW'46†V6·2Ò$ÂÓâ°¢6öç7Bæö÷Ò‚“Óç·ÒÅ3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÇF&vWG3ÖæWr6WB‚’ÆW‡FW&–÷#×·f—6–&ÆS§G'VWÒÇvVF†W#×·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÆ–ç6–FS¦fÇ6RÇ6WD–çFW&–÷"†öâ—·F†—2æ–ç6–FSÖöã·×Ó°¢6öç7BÆæC×¶'V–ÆF–æw3¥·¶æÖS¢%v—F†÷WB'VÆW'26†÷"Çƒ£Ç££Ç–s£ÆC£gÕÒÆ†V–v‡DC¢‚“ÓãÇvÆ¶&ÆS¢‚“ÓçG'VWÓ°¢6öç7B“Ô$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷BÆW‡FW&–÷"ÆÆæBÇvVF†W"Ç&VÆö6FS¦æö÷ÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“°¢’ç&Wf–Wr‚'v—F†÷WB×'VÆW'2"ÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÓ°¢6öç7B3Ô$Âæ7&Wræ7&VFR‡·&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦ãÓçF&vWG2æFB†â’Ç&VÖ÷fS¦ãÓçF&vWG2æFVÆWFR†â—ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¤’æw&÷VæDBÇvÆ¶&ÆS¤’çvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“´2æ6öçG&öÂ„“°¢6öç7B6ÆV#Ò†‚Æ¢Æ'ƒÖ‚Æ'£Ö¢“Óä’çvÆ¶&ÆR†‚Æ¢Æ'‚Æ'¢ÃÄæ&öG”†V–v‡BÄ“°¢6öç7B7FWÒã#RÇsÓ“2ÆƒÓƒRÇ6VVãÖæWrV–çC„'&’‡r¦‚’ÇVWVSÕµÒÆ–æFWƒÒ‡‚Ç¢“ÓäÖF‚ç&÷VæB‚‡¢³ãR’÷7FW’§r´ÖF‚ç&÷VæB‚‡‚³ãR’÷7FW’Ç7F'CÖ–æFW‚…"ç7vâç‚Å"ç7vâç¢“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—°¢6öç7Bã×VWVU¶†VEÒÆ—ƒÖâWrÆ—£ÔÖF‚æfÆö÷"†â÷r’ÇƒÒÓãR¶—‚§7FWÇ£ÒÓãR¶—¢§7FW°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢Æ“Öç¢§r¶çƒ¶–b†çƒÃÇÆçƒã×wÇÆç£ÃÇÆç£ãÖ‡ÇÇ6VVå¶•×ÇÂ6ÆV"‡‚Ç¢Ç‚¶G‚§7FWÇ¢¶G¢§7FW’–6öçF–çVS·6VVå¶•ÓÓ·VWVRçW6‚†’“·Ð¢Ð¢6öç7B&V6†&ÆS×Óç¶6öç7B“Ö–æFW‚‡ç‚Çç¢’Æ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r“¶f÷"†ÆWBGƒÒÓ¶GƒÃÓ¶G‚²²–f÷"†ÆWBG£ÒÓ¶G£ÃÓ¶G¢²²—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G£¶–b†çƒãÓbfçƒÇrbfç£ãÓbfç£Æ‚bg6VVå¶ç¢§r¶ç…Òbf6ÆV"‚ÓãR¶ç‚§7FWÂÓãR¶ç¢§7FWÇç‚Çç¢’—&WGW&âG'VS·×&WGW&âfÇ6S·Ó°¢6öç7BvöÇ3Õµ"æW†—BÂââå"æ'&÷w6TvöÇ2Âââäö&¦V7BçfÇVW2…"ç&Wf–Ww2’æÖ‡cÓçbç÷6—F–öâ•Ó·&V6÷&B‚%v—F†÷WB'VÆW'3¢VçG&æ6R&V6†W2¶–÷6²Â&VÂÂ&–çBvÆÆW'’ÂFW6²æB&÷F‚Æ÷VævR6VG2B–VÆÆ÷r66ÆR"Æ6ÆV"…"ç7vâç‚Å"ç7vâç¢’bfvöÇ2æWfW'’‡&V6†&ÆR’Ä¥4ôâç7G&–æv–g’‡·&F—W3¤æ&öG•&F—W2ÇVç&V6†&ÆS¦vöÇ2æf–ÇFW"‡Óâ&V6†&ÆR‡’—Ò’“°¢ÆWB6VFVC×G'VS¶f÷"†6öç7B6VBöb"ç6VG2—´ö&¦V7Bæ76–vâ„ç&ö÷Bç÷6—F–öâÇ·ƒ§6VBçvÆ´Bç‚Ç“¤æ&6U’Ç£§6VBçvÆ´Bç§Ò“´æ†÷Ôæ†÷cÓ·6VFVBbcÔ2ç6—EÆ–W"‡6VB“´2ç7FVW"‚ãRÃ“´2æÆöö²‡6VBç'’Âã"Ã“´2çWFFR‚ã"Ã“·6VFVBbcÔæ6×ç6VCÓÓ×6VBbdç&ö÷Bç÷6—F–öâçƒÓÓ×6VBç‚bdç&ö÷Bç÷6—F–öâç£ÓÓ×6VBç£´2ç7FVW"ƒÃ“·6VFVBbcÔ2ç7FæEÆ–W"‚’bbæ6×ç6VBbb6VBç6—GFW"bf6ÆV"„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢“·Ð¢&V6÷&B‚%v—F†÷WB'VÆW'3¢&÷F‚Æ÷VævR6VG2&WW6R&VÂ7&Wr6—BÂg&VRÆöö²ÂÆö6¶VBÖ÷fVÖVçBæB6fR7FæB"Å"ç6VG2æÆVæwFƒÓÓÓ"bg6VFVB“°¢2çWFFUv÷&ÆB…"ç&ö÷B“¶ÆWBæöFW3ÓÆf–æ—FS×G'VS¶6öç7BvVöÖWG&–W3ÖæWr6WB‚“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’—¶vVöÖWG&–W2æFB†âævVöÖWG'’“¶f–æ—FRbcÖâævVöÖWG'’çfW'G2æWfW'’„çVÖ&W"æ—4f–æ—FR“·Öâæ6†–ÆG&Vâæf÷$V6‚‡f—6—B“·Ó·f—6—B…"ç&ö÷B“°¢&V6÷&B‚%v—F†÷WB'VÆW'3¢FVç6RF—7F–æ7B&WF–Â¦öæW2W6R&÷VæFVB6†&VBvVöÖWG'’æBF‡&VRÆ–v‡G2"Æf–æ—FRbfæöFW3ÃƒbfvVöÖWG&–W2ç6—¦SÃ#be"æÆ–v‡F–æræÆ–v‡D6÷VçCÓÓÓ2be"æ6÷VçG2ç6†—'G3ãÓbe"æ6÷VçG2æ†ööF–W3ãÓbe"æ6÷VçG2æföÆFVCãÓ3Rbe"æ6÷VçG2æ63ãÓCRbe"æ6÷VçG2ç&–çG3ãÓbbe"æ6÷VçG2æÖææWV–ç3ÓÓÓ"Ä¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦RÂââå"æ6÷VçG7Ò’“°¢ÆWBÆ–fV7–6ÆS×G'VS¶6öç7B6†–ÆD6÷VçC×&ö÷Bæ6†–ÆG&VâæÆVæwF‚Ç&ööÕ&ö÷CÕ"ç&ö÷C°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—¶Æ–fV7–6ÆRbc×vVF†W"æ–ç6–FRbbW‡FW&–÷"çf—6–&ÆRbd’æVF–òç7FG2æ7F—fS´’ç&WVW7B…"æW†—B“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÒ’æ7F—fRbbvVF†W"æ–ç6–FRbfW‡FW&–÷"çf—6–&ÆRbb’æVF–òç7FG2æ7F—fRbb’æVF–òç7FG2æ6öææV7FVBbb&ööÕ&ö÷Bçf—6–&ÆS´’ç&Wf–Wr‚'v—F†÷WB×'VÆW'2"ÇG'VR“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÔ’æ7F—fRç&ööÓÓÓÕ"bg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆD6÷VçBbd’ç&öö×2ç6—¦SÓÓÓ·Ð¢2æF—7÷6R‚“´’æF—7÷6R‚“·&V6÷&B‚%v—F†÷WB'VÆW'3¢F‡&VRVçG'’öW†—B7–6ÆW2&WW6RöæR&ööÒÂ7W&W72W‡FW&–÷"Â7F÷&ööÒVF–òæBF—7÷6R"ÆÆ–fV7–6ÆRbgF&vWG2ç6—¦SÓÓÓbb&ö÷Bæ6†–ÆG&Vâæ–æ6ÇVFW2‡&ööÕ&ö÷B’bb’æVF–òç7FG2æ6öçFW‡G2“°¢òò'VÆS¢&VÂÖ&–Væ6R&÷WF–ær7F—2Æö6ÂæB&WW6W2—G2W†—7F–ærF‡&VR×6÷W&6RVF–òööÂà¢6öç7B6fVDVF–ó×v–æF÷räVF–ô6öçFW‡BÆ7F—fF–öãÔö&¦V7BævWD÷vå&÷W'G”FW67&—F÷"†æf–vF÷"Â'W6W$7F—fF–öâ"’ÆVF–ôæöFW3ÕµÒÆ6öçFW‡G3ÕµÓ°¢6öç7BæöFSÒ‚“Óç¶6öç7Bã×¶6öææV7FVC¦fÇ6RÇ7F÷VC¦fÇ6RÆv–ã§·fÇVS£Ç6WEF&vWDEF–ÖR‡b—·F†—2çfÇVS×c·×ÒÆg&WVVæ7“§·fÇVS£Ç6WEF&vWDEF–ÖR‡b—·F†—2çfÇVS×c·×ÒÅ§·fÇVS£ÒÆ6öææV7B‚—·F†—2æ6öææV7FVC×G'VS·ÒÆF—66öææV7B‚—·F†—2æ6öææV7FVCÖfÇ6S·ÒÇ7F'B‚—·ÒÇ7F÷‚—·F†—2ç7F÷VC×G'VS·×Ó¶VF–ôæöFW2çW6‚†â“·&WGW&âã·Ó°¢v–æF÷räVF–ô6öçFW‡CÖ6Æ72¶6öç7G'V7F÷"‚—·F†—2æFW7F–æF–öã×·Ó·F†—2æ7W'&VçEF–ÖSÓ·F†—2ç6×ÆU&FSÓƒ·F†—2ç7FFSÒ''Vææ–ær#¶6öçFW‡G2çW6‚‡F†—2“·Ö7&VFTv–â‚—·&WGW&âæöFR‚“·Ö7&VFT÷66–ÆÆF÷"‚—·&WGW&âæöFR‚“·Ö7&VFT'VffW%6÷W&6R‚—·&WGW&âæöFR‚“·Ö7&VFT&—VDf–ÇFW"‚—·&WGW&âæöFR‚“·Ö7&VFT'VffW"†2Æâ—·&WGW&â¶vWD6†ææVÄFF¢‚“ÓææWrfÆöC3$'&’†â—Ó·Ö6Æ÷6R‚—·F†—2ç7FFSÒ&6Æ÷6VB#·&WGW&â&öÖ—6Rç&W6öÇfR‚“·×Ó°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"Â'W6W$7F—fF–öâ"Ç¶6öæf–wW&&ÆS§G'VRÇfÇVS§¶†4&VVä7F—fS§G'VW×Ò“°¢G'—¶6öç7BVF–óÔ$ÂæG6$–çFW&–÷$VF–òæ7&VFR‚“¶ÆWB6ÆVã×G'VS¶f÷"†ÆWB“Ó¶“Ã3¶’²²—¶VF–òç6WD7F—fR‡G'VRÂ'6†÷"“¶VF–òçWFFR†fÇ6R“¶6ÆVâbcÖVF–òç7FG2æ6öçFW‡G3ÓÓÓbfVF–òç7FG2ç6÷W&6W3ÓÓÓ2bfVF–òç7FG2æ6öææV7FVBbfVF–ôæöFW5³Òæv–âçfÇVSÓÓÒã#¶VF–òç6WD7F—fR†fÇ6R“¶6ÆVâbcÒVF–òç7FG2æ6öææV7FVC·ÖVF–òç6WD7F—fR‡G'VRÂ'6†÷"“¶VF–òçWFFR‡G'VR“¶6ÆVâbcÒVF–òç7FG2æ6öææV7FVC¶VF–òæF—7÷6R‚“·&V6÷&B‚%v—F†÷WB'VÆW'2VF–ó¢V–WB6†÷v–âÂ×WFRÂF‡&VRf—6—G2æBF—7÷6ÂæWfW"GWÆ–6FR6öçFW‡G2÷"ÆV²6öææV7F–öç2"Æ6ÆVâbf6öçFW‡G2æÆVæwFƒÓÓÓbf6öçFW‡G5³Òç7FFSÓÓÒ&6Æ÷6VB"bfVF–ôæöFW2æWfW'’†ãÓââæ6öææV7FVB’“·Öf–æÆÇ—·v–æF÷räVF–ô6öçFW‡C×6fVDVF–ó¶–b†7F—fF–öâ”ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"Â'W6W$7F—fF–öâ"Æ7F—fF–öâ“¶VÇ6RFVÆWFRæf–vF÷"çW6W$7F—fF–öã·Ð¢6öç7BCÔ$Âçv—F†÷WE'VÆW'4FF°¢&V6÷&B‚%v—F†÷WB'VÆW'26FÆös¢ÆÂ6FVv÷&–W2æBf—fRF†VÖW26öçF–â&VÂ&÷VæFVBöff–6–Â&öGV7B&Wf–Ww2"ÄBç&öGV7G2æÆVæwFƒÓÓÓBbdBæ6FVv÷&–W2æWfW'’†3ÓäBæf–ÇFW"†2æ–B’æÆVæwFƒã’bdBæ6öÆÆV7F–öç2æWfW'’†3ÓäBæf–ÇFW"‚&†öÖR"Â""Æ2æ–B’æÆVæwFƒã’bdBç&öGV7G2æWfW'’‡ÓäBæöff–6–Â‡çW&Â’bgçF—FÆRbgç&–6SãbbõæFF¦–ÖvUÂò‡æwÆ§VwÇvV'“¶&6ScBÂòçFW7B‡æ–ÖvR’’bdBæ6öÆÆV7F–öç2æWfW'’†3ÓäBæöff–6–Â†2çW&Â’’“°¢&V6÷&B‚%v—F†÷WB'VÆW'26FÆös¢Æö6Â6V&6‚—266R–ç6Vç6—F—fRæB÷WF&÷VæBÆ–æ·2&V¦V7BÆöö¶Æ–¶W2æBVç6fRU$Ç2"ÄBæf–ÇFW"‚&†öÖR"Â$&•ÓƒR"’æÖ‡Óçæ–B’ç6÷'B‚’æ¦ö–â‚’ÓÓÒ²&ç–¶ç–2Ö&—ÓƒR×B×6†—'B"Â&ç–¶ç–2Ö&—ÓƒRÖ†ööF–RÖ&Æ6²ÖæB×v†—FR"Â&&—ÓƒRÖ'V6¶WBÖ†B%Òç6÷'B‚’æ¦ö–â‚’bdBæf–ÇFW"‚&†öÖR"Â&–×÷76–&ÆRæöç&öGV7B"’æÆVæwFƒÓÓÓbe²&¦f67&—C¦ÆW'Bƒ’"Â&‡GG3¢ò÷wwrçv—F†÷WB×'VÆW'2æ6öÒæWf–ÂçFW7B÷&öGV7G2ö"Â&‡GG3¢ò÷v—F†÷WB×'VÆW'2æ6öÒ÷&öGV7G2ö"Â&‡GG3¢ò÷W6W#§74wwrçv—F†÷WB×'VÆW'2æ6öÒò"Â&‡GG3¢ò÷wwrçv—F†÷WB×'VÆW'2æ6öÒö6'B"Â&‡GG3¢ò÷wwrçv—F†÷WB×'VÆW'2æ6öÒóöVÖ–Ã×&—fFR%ÒæWfW'’‡SÓâBæöff–6–Â‡R’’“°¢òò6öçG&7C¢7GVÂÖVçRWfVçB†æFÆW'2Âv—F†÷WBÆöF–ærç’&VÖ÷FR6W'f–6R÷"7W7FöÖW"7FFRà¢6öç7B6fVDFö3ÖvÆö&ÅF†—2æFö7VÖVçBÇ6fVE6†VÆÃÔ$ÂæG6$ÖVçU6†VÆÂÆÆ—7FVæW'3ÖæWrÖ‚’ÆVÆVÖVçG3ÕµÓ°¢6öç7BVÆVÖVçC×FsÓç°¢6öç7BS×·FrÆ6†–ÆG&Vã¥µÒÆFF6WC§·ÒÆ†–FFVã¦fÇ6RÇfÇVS¢""ÆGG&–'WFW3§·ÒÇ&VçC¦çVÆÂÆ—46öææV7FVC§G'VRÇFW‡D6öçFVçC¢""ÆÆ—7FVæW'3¦æWrÖ‚’À¢6WDGG&–'WFR†²Çb—·F†—2æGG&–'WFW5¶µÓ×c·ÒÆVæD6†–ÆB†2—¶2ç&VçC×F†—3·F†—2æ6†–ÆG&VâçW6‚†2“·&WGW&â3·ÒÇ&WÆ6T6†–ÆG&Vâ‚—·F†—2æ6†–ÆG&Vâæf÷$V6‚†3Óæ2ç&VçCÖçVÆÂ“·F†—2æ6†–ÆG&VãÕµÓ·ÒÀ¢6öçF–ç2†â—¶f÷"ƒ¶ã¶ãÖâç&VçB––b†ãÓÓ×F†—2—&WGW&âG'VS·&WGW&âfÇ6S·ÒÆ6Æ÷6W7B‡2—¶–b‡3ÓÓÒ&'WGFöâ"—&WGW&âF†—2çFsÓÓÒ&'WGFöâ#÷F†—3§F†—2ç&VçCòæ6Æ÷6W7B‡2“¶–b‡3ÓÓÒ%¶†–FFVåÒ"—&WGW&âF†—2æ†–FFVã÷F†—3§F†—2ç&VçCòæ6Æ÷6W7B‡2“·&WGW&âçVÆÃ·ÒÀ¢fö7W2‚—¶Fö7VÖVçBæ7F—fTVÆVÖVçC×F†—3·ÒÆ&ÇW"‚—¶–b†Fö7VÖVçBæ7F—fTVÆVÖVçCÓÓ×F†—2–Fö7VÖVçBæ7F—fTVÆVÖVçCÖçVÆÃ·ÒÆFDWfVçDÆ—7FVæW"†²Æb—·F†—2æÆ—7FVæW'2ç6WB†²Æb“·ÒÇ&VÖ÷fTWfVçDÆ—7FVæW"†²—·F†—2æÆ—7FVæW'2æFVÆWFR†²“·Ð¢Ó¶VÆVÖVçG2çW6‚†R“·&WGW&âS°¢Ó°¢6öç7BæVÃÖVÆVÖVçB‚'6V7F–öâ"’Ç6VÆV7F÷'3ÖæWrÖ‚“°¢f÷"†6öç7B·ÇFuÒöbµ²&æb"Â&æb%ÒÅ²"ç'VÆW'2×&W7VÇG2"Â&F—b%ÒÅ²"ç'VÆW'2Ö†VF–ær"Â&ƒ2%ÒÅ²&–çWB"Â&–çWB%ÒÅ²"ç'VÆW'2×6V&6‚"Â&Æ&VÂ%ÒÅ²"ç'VÆW'2×7FGW2"Â'%ÒÅ²u¶FF×w#Ò&&6²%ÒrÂ&'WGFöâ%ÒÅ²u¶FF×w#Ò&6Æ÷6R%ÒrÂ&'WGFöâ%ÕÒ—¶6öç7BSÖVÆVÖVçB‡Fr“·æVÂæVæD6†–ÆB†R“·6VÆV7F÷'2ç6WB‡ÆR“·Ð¢6VÆV7F÷'2ævWB‚u¶FF×w#Ò&6Æ÷6R%Òr’æFF6WBçw#Ò&6Æ÷6R#·6VÆV7F÷'2ævWB‚u¶FF×w#Ò&&6²%Òr’æFF6WBçw#Ò&&6²#°¢æVÂçVW'•6VÆV7F÷#×Óç6VÆV7F÷'2ævWB‡“·æVÂçVW'•6VÆV7F÷$ÆÃÒ‚“ÓæVÆVÖVçG2æf–ÇFW"†SÓçæVÂæ6öçF–ç2†R’be²&'WGFöâ"Â&–çWB"Â&%Òæ–æ6ÇVFW2†RçFr’“°¢vÆö&ÅF†—2æFö7VÖVçC×¶vWDVÆVÖVçD'”–C¢‚“ÓçæVÂÆ7&VFTVÆVÖVçC¦VÆVÖVçBÆ7F—fTVÆVÖVçC¦çVÆÂÆFDWfVçDÆ—7FVæW#¢†²Æb“ÓæÆ—7FVæW'2ç6WB†²Æb’Ç&VÖ÷fTWfVçDÆ—7FVæW#¦³ÓæÆ—7FVæW'2æFVÆWFR†²—Ó°¢G'—°¢$ÂæG6$ÖVçU6†VÆÃ×·&W6VçC¦æö÷Ó°¢6öç7BÓÔ$Âçv—F†÷WE'VÆW'4ÖVçRæ7&VFR‚’Ç&W7VÇG3×6VÆV7F÷'2ævWB‚"ç'VÆW'2×&W7VÇG2"’Ç6V&6ƒ×6VÆV7F÷'2ævWB‚&–çWB"“¶ÆWBö¶“ÒÒæ÷Vâ‚“°¢6öç7BFW66VæFçG3Ò†æöFRÆ÷WCÕµÒ“Óç¶÷WBçW6‚†æöFR“¶æöFRæ6†–ÆG&Vâæf÷$V6‚†3ÓæFW66VæFçG2†2Æ÷WB’“·&WGW&â÷WC·Ó°¢6öç7B6Æ–6³Ò†7F–öâÇfÇVR“Óç¶6öç7B#ÖFW66VæFçG2‡æVÂ’æf–æB†ãÓæâçFsÓÓÒ&'WGFöâ"bfâæFF6WBçw#ÓÓÖ7F–öâbb‚fÇVWÇÆâæFF6WBçfÇVSÓÓ×fÇVR’“¶–b‚"—F‡&÷rW'&÷"‚$Ö—76–ærÖVçR7F–öâ"¶7F–öâ“·æVÂæÆ—7FVæW'2ævWB‚&6Æ–6²"’‡·F&vWC¦'Ò“·Ó°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—°¢ÒæVçFW"‚“¶6öç7B÷VæVCÔÒæ÷Vâ‚“¶ö¶’bcÖ÷VæVBbdÒæ—4÷VâbbæVÂæ†–FFVâbg6VÆV7F÷'2ævWB‚&æb"’æ6†–ÆG&VâæÆVæwFƒÓÓÓƒ¶6Æ–6²‚'6V7F–öâ"Â&†G2"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&Vâæf–ÇFW"†3Óæ2çFsÓÓÒ&'F–6ÆR"’æÆVæwFƒÓÓÔBæf–ÇFW"‚&†G2"’æÆVæwFƒ°¢6Æ–6²‚'6V7F–öâ"Â'6V&6‚"“·6V&6‚çfÇVSÒ$&•ÓƒR#·6V&6‚æÆ—7FVæW'2ævWB‚&–çWB"’‚“¶ö¶’bc×&W7VÇG2æ6†–ÆG&VâæÆVæwFƒÓÓÓ3°¢6Æ–6²‚'&öGV7B"ÄBç&öGV7G5³Òæ–B“¶6öç7BÆ–æ·3ÖFW66VæFçG2‡&W7VÇG2’æf–ÇFW"†ãÓæâçFsÓÓÒ&"“¶ö¶’bcÖÆ–æ·2æÆVæwFƒÓÓÓbfÆ–æ·5³Òæ‡&VcÓÓÔBç&öGV7G5³ÒçW&ÂbfÆ–æ·5³ÒçF&vWCÓÓÒ%ö&Ææ²"bfÆ–æ·5³Òç&VÃÓÓÒ&æö÷VæW"æ÷&VfW'&W"#°¢6Æ–6²‚&&6²"“¶6Æ–6²‚'6V7F–öâ"Â&6öÆÆV7F–öç2"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&VâæÆVæwFƒÓÓÓS¶6Æ–6²‚&6öÆÆV7F–öâ"Â##C"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&Vâæf–ÇFW"†3Óæ2çFsÓÓÒ&'F–6ÆR"’æÆVæwFƒÓÓÓ3°¢æVÂæÆ—7FVæW'2ævWB‚&¶W–F÷vâ"’‡·G—S¢&¶W–F÷vâ"Æ¶W“¢$W66R"Ç7F÷&÷vF–öã¦æö÷Ç&WfVçDFVfVÇC¦æö÷Ò“¶ö¶’bcÒÒæ—4÷VâbgæVÂæ†–FFVã°¢Òæ÷Vâ‚“´ÒæÆVfR‚“¶ö¶’bcÒÒæ—4÷VâbgæVÂæ†–FFVâbg&W7VÇG2æ6†–ÆG&VâæÆVæwFƒÓÓÓbg6V&6‚çfÇVSÓÓÒ"#°¢Ð¢f÷"†6öç7B&÷WFRöb²'6†—'G2"Â&†ööF–W2"Â&†G2"Â&'B"Â&&—ƒR"Â'6Ö÷W&’"Â'6ÆfW'’"Â&6'FVÂ"Â##C"Â&æöç6Vç6R%Ò—´ÒæVçFW"‚“´Òæ÷Vâ‡&÷WFR“¶ö¶’bcÔBæ6öÆÆV7F–öç2ç6öÖR†3Óæ2æ–CÓÓ×&÷WFR“ôÒç7FG2æ6öÆÆV7F–öãÓÓ×&÷WFS¤Òç7FG2ç6V7F–öãÓÓÒ„Bæ6FVv÷&–W2ç6öÖR†3Óæ2æ–CÓÓ×&÷WFR“÷&÷WFS¢&†öÖR"“´ÒæÆVfR‚“·Ð¢ÒæF—7÷6R‚“´ÒæF—7÷6R‚“·&V6÷&B‚%v—F†÷WB'VÆW'2ÖVçS¢6FVv÷&–W2Â6öÆÆV7F–öâ6V&6‚Â&öGV7B&VF—&V7BÂW66RæB&WVFVBf—6—G26ÆVâÆÂ†æFÆW'2"Æö¶’bfÆ—7FVæW'2ç6—¦SÓÓÓbfVÆVÖVçG2æWfW'’†SÓæRæÆ—7FVæW'2ç6—¦SÓÓÓ’bdÒç7FG2æF—7÷6VB“°¢Öf–æÆÇ—¶vÆö&ÅF†—2æFö7VÖVçC×6fVDFö3´$ÂæG6$ÖVçU6†VÆÃ×6fVE6†VÆÃ·Ð§Ó° ¢òò&ööböb–æ²W6W2F†R&VÂÆ–W"6öÆÆ—6–öâÂ6VF–ærÂG&ç6—F–öâæBÖVçR†æFÆW'2à¦6öç7B–æ´6†V6·2Ò$ÂÓâ°¢6öç7Bæö÷Ò‚“Óç·ÒÅ3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÇF&vWG3ÖæWr6WB‚’ÆW‡FW&–÷#×·f—6–&ÆS§G'VWÒÇvVF†W#×·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÆ–ç6–FS¦fÇ6RÇ6WD–çFW&–÷"†öâ—·F†—2æ–ç6–FSÖöã·×Ó°¢6öç7BÆæC×¶'V–ÆF–æw3¥·¶æÖS¢%&ööböb–æ²"Çƒ£Ç££Ç–s£ÆC£gÕÒÆ†V–v‡DC¢‚“ÓãÇvÆ¶&ÆS¢‚“ÓçG'VWÓ°¢6öç7B“Ô$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷BÆW‡FW&–÷"ÆÆæBÇvVF†W"Ç&VÆö6FS¦æö÷ÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“°¢’ç&Wf–Wr‚'&ööbÖöbÖ–æ²"ÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÓ°¢6öç7B3Ô$Âæ7&Wræ7&VFR‡·&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦ãÓçF&vWG2æFB†â’Ç&VÖ÷fS¦ãÓçF&vWG2æFVÆWFR†â—ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¤’æw&÷VæDBÇvÆ¶&ÆS¤’çvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“´2æ6öçG&öÂ„“°¢6öç7B6ÆV#Ò†‚Æ¢Æ'ƒÖ‚Æ'£Ö¢“Óä’çvÆ¶&ÆR†‚Æ¢Æ'‚Æ'¢ÃÄæ&öG”†V–v‡BÄ“°¢6öç7B7FWÒã#RÇsÓ’ÆƒÓÇ6VVãÖæWrV–çC„'&’‡r¦‚’ÇVWVSÕµÒÆ–æFWƒÒ‡‚Ç¢“ÓäÖF‚ç&÷VæB‚‡¢³"ãR’÷7FW’§r´ÖF‚ç&÷VæB‚‡‚³2ãR’÷7FW’Ç7F'CÖ–æFW‚…"ç7vâç‚Å"ç7vâç¢“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—°¢6öç7Bã×VWVU¶†VEÒÆ—ƒÖâWrÆ—£ÔÖF‚æfÆö÷"†â÷r’ÇƒÒÓ2ãR¶—‚§7FWÇ£ÒÓ"ãR¶—¢§7FW°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢Æ“Öç¢§r¶çƒ¶–b†çƒÃÇÆçƒã×wÇÆç£ÃÇÆç£ãÖ‡ÇÇ6VVå¶•×ÇÂ6ÆV"‡‚Ç¢Ç‚¶G‚§7FWÇ¢¶G¢§7FW’–6öçF–çVS·6VVå¶•ÓÓ·VWVRçW6‚†’“·Ð¢Ð¢6öç7B&V6†&ÆS×Óç¶6öç7B“Ö–æFW‚‡ç‚Çç¢’Æ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r“¶f÷"†ÆWBGƒÒÓ¶GƒÃÓ¶G‚²²–f÷"†ÆWBG£ÒÓ¶G£ÃÓ¶G¢²²—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G£¶–b†çƒãÓbfçƒÇrbfç£ãÓbfç£Æ‚bg6VVå¶ç¢§r¶ç…Òbf6ÆV"‚Ó2ãR¶ç‚§7FWÂÓ"ãR¶ç¢§7FWÇç‚Çç¢’—&WGW&âG'VS·×&WGW&âfÇ6S·Ó°¢6öç7BvöÇ3Õµ"æW†—BÂââå"æ'&÷w6TvöÇ2Âââäö&¦V7BçfÇVW2…"ç&Wf–Ww2’æÖ‡cÓçbç÷6—F–öâ•Ó·&V6÷&B‚%&ööböb–æ³¢VçG&æ6R&V6†W2¶–÷6²Â&VÂÂ&–çBvÆÆW'’ÂFW6²æBF‡&VRÆ÷VævR6VG2B–VÆÆ÷r66ÆR"Æ6ÆV"…"ç7vâç‚Å"ç7vâç¢’bfvöÇ2æWfW'’‡&V6†&ÆR’Ä¥4ôâç7G&–æv–g’‡·&F—W3¤æ&öG•&F—W2ÇVç&V6†&ÆS¦vöÇ2æf–ÇFW"‡Óâ&V6†&ÆR‡’—Ò’“°¢ÆWB6VFVC×G'VS¶f÷"†6öç7B6VBöb"ç6VG2—´ö&¦V7Bæ76–vâ„ç&ö÷Bç÷6—F–öâÇ·ƒ§6VBçvÆ´Bç‚Ç“¤æ&6U’Ç£§6VBçvÆ´Bç§Ò“´æ†÷Ôæ†÷cÓ·6VFVBbcÔ2ç6—EÆ–W"‡6VB“´2ç7FVW"‚ãRÃ“´2æÆöö²‡6VBç'’Âã"Ã“´2çWFFR‚ã"Ã“·6VFVBbcÔæ6×ç6VCÓÓ×6VBbdç&ö÷Bç÷6—F–öâçƒÓÓ×6VBç‚bdç&ö÷Bç÷6—F–öâç£ÓÓ×6VBç£´2ç7FVW"ƒÃ“·6VFVBbcÔ2ç7FæEÆ–W"‚’bbæ6×ç6VBbb6VBç6—GFW"bf6ÆV"„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢“·Ð¢&V6÷&B‚%&ööböb–æ³¢F‡&VRÆ÷VævR6VG2&WW6R&VÂ7&Wr6—BÂg&VRÆöö²ÂÆö6¶VBÖ÷fVÖVçBæB6fR7FæB"Å"ç6VG2æÆVæwFƒÓÓÓ2bg6VFVB“°¢2çWFFUv÷&ÆB…"ç&ö÷B“¶ÆWBæöFW3ÓÆf–æ—FS×G'VS¶6öç7BvVöÖWG&–W3ÖæWr6WB‚“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’—¶vVöÖWG&–W2æFB†âævVöÖWG'’“¶f–æ—FRbcÖâævVöÖWG'’çfW'G2æWfW'’„çVÖ&W"æ—4f–æ—FR“·Öâæ6†–ÆG&Vâæf÷$V6‚‡f—6—B“·Ó·f—6—B…"ç&ö÷B“°¢&V6÷&B‚%&ööböb–æ³¢FVç6RF—7F–æ7B&WF–Â¦öæW2W6R&÷VæFVB6†&VBvVöÖWG'’æBF‡&VRÆ–v‡G2"Æf–æ—FRbfæöFW3Ã#bfvVöÖWG&–W2ç6—¦SÃSbe"æÆ–v‡F–æræÆ–v‡D6÷VçCÓÓÓ2be"æ6÷VçG2æ&VÃãÓRbe"æ6÷VçG2æföÆFVCãÓCbe"æ6÷VçG2æ63ãÓ#Rbe"æ6÷VçG2æ'CãÓ‚be"æ6÷VçG2æ–æ³ãÓsbe"æ6÷VçG2ç&W76W3ÓÓÓ"be"æ6÷VçG2æG'–W'3ÓÓÓ"Ä¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦RÂââå"æ6÷VçG7Ò’“°¢ÆWBÆ–fV7–6ÆS×G'VS¶6öç7B6†–ÆD6÷VçC×&ö÷Bæ6†–ÆG&VâæÆVæwF‚Ç&ööÕ&ö÷CÕ"ç&ö÷C°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—¶Æ–fV7–6ÆRbc×vVF†W"æ–ç6–FRbbW‡FW&–÷"çf—6–&ÆRbd’æVF–òç7FG2æ7F—fS´’ç&WVW7B…"æW†—B“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÒ’æ7F—fRbbvVF†W"æ–ç6–FRbfW‡FW&–÷"çf—6–&ÆRbb’æVF–òç7FG2æ7F—fRbb’æVF–òç7FG2æ6öææV7FVBbb&ööÕ&ö÷Bçf—6–&ÆS´’ç&Wf–Wr‚'&ööbÖöbÖ–æ²"ÇG'VR“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÔ’æ7F—fRç&ööÓÓÓÕ"bg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆD6÷VçBbd’ç&öö×2ç6—¦SÓÓÓ·Ð¢2æF—7÷6R‚“´’æF—7÷6R‚“·&V6÷&B‚%&ööböb–æ³¢F‡&VRVçG'’öW†—B7–6ÆW2&WW6RöæR&ööÒÂ7W&W72W‡FW&–÷"Â7F÷&ööÒVF–òæBF—7÷6R"ÆÆ–fV7–6ÆRbgF&vWG2ç6—¦SÓÓÓbb&ö÷Bæ6†–ÆG&Vâæ–æ6ÇVFW2‡&ööÕ&ö÷B’bb’æVF–òç7FG2æ6öçFW‡G2“°¢òò&W6W'fRF†R&VÂW‡FW&–÷"Fö÷"&Vv—7G'’æBÆÂ&Wf–÷W6Ç’–×ÆVÖVçFVB&ööÒf7F÷&–W2à¢6öç7B&VÄÆæCÔ$ÂæG6$vVöw&‡’æ'V–ÆB‚’ÆÆÅ&ö÷CÕ2æ7&VFTæöFR‚’ÆÆÄW‡FW&–÷#×·f—6–&ÆS§G'VWÓ¶ÆWBÆ7Eö–çCÖçVÆÃ°¢6öç7BÆÃÔ$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷C¦ÆÅ&ö÷BÆW‡FW&–÷#¦ÆÄW‡FW&–÷"ÆÆæC§&VÄÆæBÇvVF†W"Ç&VÆö6FS§ÓæÆ7Eö–çC×²ââçÒÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“¶ÆWB&W6W'fVC×G'VS°¢f÷"†6öç7B–Böb²&ÖVÖRÖf7F÷'’"Â&G6"×7GVF–ò"Â&Ö†—2Ö6ÇV""Â'v—F†÷WB×'VÆW'2"Â'&ööbÖöbÖ–æ²%Ò—¶6öç7BVçG'“ÖÆÂç&Vv—7G'’ævWB†–B“·&W6W'fVBbcÖÆÂçF&vWB†VçG'’æVçG'’“òæ–CÓÓÖ–C¶ÆÂç&Wf–Wr†–BÇG'VR“¶ÆÂçWFFR‚ãB“·&W6W'fVBbcÖÆÂæ7F—fSòç&ööÒæ–CÓÓÖ–BbbÆÄW‡FW&–÷"çf—6–&ÆRbgvVF†W"æ–ç6–FS¶6öç7B&ööÓÖÆÂæ7F—fRç&ööÓ¶ÆÂç&WVW7B‡&ööÒæW†—B“¶ÆÂçWFFR‚ãB“·&W6W'fVBbcÒÆÂæ7F—fRbfÆÄW‡FW&–÷"çf—6–&ÆRbbvVF†W"æ–ç6–FRbfÆ7Eö–çBçƒÓÓÖVçG'’æVçG'’ç‚bfÆ7Eö–çBç£ÓÓÖVçG'’æVçG'’ç¢bbÆÂæVF–òç7FG2æ6öææV7FVC·Ð¢ÆÂæF—7÷6R‚“¶6öç7Bå#Ô$ÂæG6$æöFW'VææW"æ7&VFR‡·&ö÷C¦ÆÅ&ö÷BÆÆæC§&VÄÆæGÒ“¶6öç7BæV#Ôå"ææV"„å"ç&Wf–Wr“´å"çWFFR‚ãbÄå"ç&Wf–WrÇ¶VF–ôVæ&ÆVC¦fÇ6WÒÂãR“¶6öç7Bç%67&VVãÒå"ç67&VVäf6RævVöÖWG'’ÇV–WCÔå"ç7FG2ç6÷W&6W3ÓÓÓ´å"æF—7÷6R‚“°¢&V6÷&B‚$E4"&W6W'fF–öã¢ÆÂf—fR&VÂFö÷'2&WGW&âFòF†V—"÷vâf6FW3²W†—7F–ær–çFW&–÷'2æBæöFW'VææW"7F–ÆÂ'V–ÆBæBF—7÷6R"Ç&W6W'fVBbfæV"bfç%67&VVâbgV–WBbfÆÅ&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÓ“°¢6öç7B66VæU6÷W&6S×&VDf–ÆU7–æ2†æWrU$Â‚"ââ÷7&2ö§2÷66VæRÖG6"æ§2"Æ–×÷'BæÖWFçW&Â’Â'WFc‚"’ÆÖVçU6÷W&6S×&VDf–ÆU7–æ2†æWrU$Â‚"ââ÷7&2ö§2÷&ööbÖöbÖ–æ²ÖÖVçRæ§2"Æ–×÷'BæÖWFçW&Â’Â'WFc‚"“°¢&V6÷&B‚%&ööböb–æ²&—f7’æB6†&VB6öçG&öÇ3¢æòæWGv÷&²÷"7W7FöÖW"W'6—7FVæ6RÂæBöæR6†&VB7FæB7F–öâ"ÂöfWF6…Â‡Å„ÔÄ‡GG&WVW7GÆÆö6Å7F÷&vWÇ6W76–öå7F÷&vWÇ6WD–çFW'fÇÆ7&VFTVÆVÖVçEÂ‚"ƒó¦–g&ÖWÆf÷&Ò’"òçFW7B†ÖVçU6÷W&6R’bg66VæU6÷W&6Ræ–æ6ÇVFW2‚&6öçFW‡Bæ†–FFVãÒfF"æ6×ç6VB"’bg66VæU6÷W&6Ræ–æ6ÇVFW2‚"ÖVçT÷Vâ‚’bb–çFW&–÷'2çG&ç6—F–öæ–ær"’bg66VæU6÷W&6Ræ–æ6ÇVFW2‚&VÇ6R–æ´ÖVçSòæÆVfR‚’"’“°¢6öç7BCÔ$Âç&öödöd–æ´FF°¢&V6÷&B‚%&ööböb–æ²6FÆös¢fW&–f–VB&öGV7G26÷fW"WfW'’f–Æ&ÆR6FVv÷'’æB7W&FVB6öÆÆV7F–öâ"ÄBç&öGV7G2æÆVæwFƒÓÓÓ‚bdBæ6FVv÷&–W2æf–ÇFW"†3Óæ2æ–BÓÒ'Fæ·2"’æWfW'’†3ÓäBæf–ÇFW"‚&fVGW&VB"Â""Æ2æ–B’æÆVæwFƒã’bdBæf–ÇFW"‚&fVGW&VB"Â""Â'Fæ·2"’æÆVæwFƒÓÓÓbdBæ6öÆÆV7F–öç2æf–ÇFW"†3Óæ2æ¶–æBÓÒ'6W'f–6R"’æWfW'’†3ÓäBæf–ÇFW"‚&fVGW&VB"Â""Æ2æ–B’æÆVæwFƒã’bdBç&öGV7G2æWfW'’‡ÓäBæöff–6–Â‡çW&Â’bgçF—FÆRbgç&–6SãbbõæFF¦–ÖvUÂö§Vs¶&6ScBÂòçFW7B‡æ–ÖvR’’bdBæ6öÆÆV7F–öç2æWfW'’†3ÓäBæöff–6–Â†2çW&Â’’“°¢&V6÷&B‚%&ööböb–æ²6FÆös¢Æö6Â6V&6‚æBW†7Böff–6–ÂFW7F–æF–öâÆÆ÷vÆ—7B"ÄBæf–ÇFW"‚'6V&6‚"Â&%F26U56–öç2"’æÆVæwFƒÓÓÓBbdBæf–ÇFW"‚'6V&6‚"Â&æò7V6‚'Gv÷&²"’æÆVæwFƒÓÓÓbe²&¦f67&—C¦ÆW'Bƒ’"Â&‡GG3¢ò÷&ööföf–æ²æ6öÒæWf–ÂçFW7Bò"Â&‡GG3¢ò÷W6W#§74&ööföf–æ²æ6öÒò"Â&‡GG3¢ò÷&ööföf–æ²æ6öÒö6'B"Â&‡GG3¢ò÷&ööföf–æ²æ6öÒóöVÖ–Ã×&—fFR"Â&‡GG3¢ò÷&ööföf–æ²æ6öÓ£CC2ö6'B%ÒæWfW'’‡SÓâBæöff–6–Â‡R’’“°¢òò6öçG&7C¢7GVÂÖVçRWfVçB†æFÆW'2Âv—F†÷WBÆöF–ærç’&VÖ÷FR6W'f–6R÷"7W7FöÖW"7FFRà¢6öç7B6fVDFö3ÖvÆö&ÅF†—2æFö7VÖVçBÇ6fVE6†VÆÃÔ$ÂæG6$ÖVçU6†VÆÂÆÆ—7FVæW'3ÖæWrÖ‚’ÆVÆVÖVçG3ÕµÓ°¢6öç7BVÆVÖVçC×FsÓç°¢6öç7BS×·FrÆ6†–ÆG&Vã¥µÒÆFF6WC§·ÒÆ†–FFVã¦fÇ6RÇfÇVS¢""ÆGG&–'WFW3§·ÒÇ&VçC¦çVÆÂÆ—46öææV7FVC§G'VRÇFW‡D6öçFVçC¢""ÆÆ—7FVæW'3¦æWrÖ‚’À¢6WDGG&–'WFR†²Çb—·F†—2æGG&–'WFW5¶µÓ×c·ÒÆVæD6†–ÆB†2—¶2ç&VçC×F†—3·F†—2æ6†–ÆG&VâçW6‚†2“·&WGW&â3·ÒÇ&WÆ6T6†–ÆG&Vâ‚—·F†—2æ6†–ÆG&Vâæf÷$V6‚†3Óæ2ç&VçCÖçVÆÂ“·F†—2æ6†–ÆG&VãÕµÓ·ÒÀ¢6öçF–ç2†â—¶f÷"ƒ¶ã¶ãÖâç&VçB––b†ãÓÓ×F†—2—&WGW&âG'VS·&WGW&âfÇ6S·ÒÆ6Æ÷6W7B‡2—¶–b‡3ÓÓÒ&'WGFöâ"—&WGW&âF†—2çFsÓÓÒ&'WGFöâ#÷F†—3§F†—2ç&VçCòæ6Æ÷6W7B‡2“¶–b‡3ÓÓÒ%¶†–FFVåÒ"—&WGW&âF†—2æ†–FFVã÷F†—3§F†—2ç&VçCòæ6Æ÷6W7B‡2“·&WGW&âçVÆÃ·ÒÀ¢fö7W2‚—¶Fö7VÖVçBæ7F—fTVÆVÖVçC×F†—3·ÒÆ&ÇW"‚—¶–b†Fö7VÖVçBæ7F—fTVÆVÖVçCÓÓ×F†—2–Fö7VÖVçBæ7F—fTVÆVÖVçCÖçVÆÃ·ÒÆFDWfVçDÆ—7FVæW"†²Æb—·F†—2æÆ—7FVæW'2ç6WB†²Æb“·ÒÇ&VÖ÷fTWfVçDÆ—7FVæW"†²—·F†—2æÆ—7FVæW'2æFVÆWFR†²“·Ð¢Ó¶VÆVÖVçG2çW6‚†R“·&WGW&âS°¢Ó°¢6öç7BæVÃÖVÆVÖVçB‚'6V7F–öâ"’Ç6VÆV7F÷'3ÖæWrÖ‚“°¢f÷"†6öç7B·ÇFuÒöbµ²&æb"Â&æb%ÒÅ²"æ–æ²×&W7VÇG2"Â&F—b%ÒÅ²"æ–æ²Ö†VF–ær"Â&ƒ2%ÒÅ²&–çWB"Â&–çWB%ÒÅ²"æ–æ²Öf–ÇFW'2"Â&F—b%ÒÅ²"æ–æ²×7FGW2"Â'%ÒÅ²u¶FFÖ–æ³Ò&&6²%ÒrÂ&'WGFöâ%ÒÅ²u¶FFÖ–æ³Ò&6Æ÷6R%ÒrÂ&'WGFöâ%ÕÒ—¶6öç7BSÖVÆVÖVçB‡Fr“·æVÂæVæD6†–ÆB†R“·6VÆV7F÷'2ç6WB‡ÆR“·Ð¢6VÆV7F÷'2ævWB‚u¶FFÖ–æ³Ò&6Æ÷6R%Òr’æFF6WBæ–æ³Ò&6Æ÷6R#·6VÆV7F÷'2ævWB‚u¶FFÖ–æ³Ò&&6²%Òr’æFF6WBæ–æ³Ò&&6²#°¢æVÂçVW'•6VÆV7F÷#×Óç6VÆV7F÷'2ævWB‡“·æVÂçVW'•6VÆV7F÷$ÆÃÒ‚“ÓæVÆVÖVçG2æf–ÇFW"†SÓçæVÂæ6öçF–ç2†R’be²&'WGFöâ"Â&–çWB"Â&%Òæ–æ6ÇVFW2†RçFr’“°¢vÆö&ÅF†—2æFö7VÖVçC×¶vWDVÆVÖVçD'”–C¢‚“ÓçæVÂÆ7&VFTVÆVÖVçC¦VÆVÖVçBÆ7F—fTVÆVÖVçC¦çVÆÂÆFDWfVçDÆ—7FVæW#¢†²Æb“ÓæÆ—7FVæW'2ç6WB†²Æb’Ç&VÖ÷fTWfVçDÆ—7FVæW#¦³ÓæÆ—7FVæW'2æFVÆWFR†²—Ó°¢G'—°¢$ÂæG6$ÖVçU6†VÆÃ×·&W6VçC¦æö÷Ó°¢6öç7BÓÔ$Âç&öödöd–æ´ÖVçRæ7&VFR‚’Ç&W7VÇG3×6VÆV7F÷'2ævWB‚"æ–æ²×&W7VÇG2"’Ç6V&6ƒ×6VÆV7F÷'2ævWB‚&–çWB"“¶ÆWBö¶“ÒÒæ÷Vâ‚“°¢6öç7BFW66VæFçG3Ò†æöFRÆ÷WCÕµÒ“Óç¶÷WBçW6‚†æöFR“¶æöFRæ6†–ÆG&Vâæf÷$V6‚†3ÓæFW66VæFçG2†2Æ÷WB’“·&WGW&â÷WC·Ó°¢6öç7B6Æ–6³Ò†7F–öâÇfÇVR“Óç¶6öç7B#ÖFW66VæFçG2‡æVÂ’æf–æB†ãÓæâçFsÓÓÒ&'WGFöâ"bfâæFF6WBæ–æ³ÓÓÖ7F–öâbb‚fÇVWÇÆâæFF6WBçfÇVSÓÓ×fÇVR’“¶–b‚"—F‡&÷rW'&÷"‚$Ö—76–ærÖVçR7F–öâ"¶7F–öâ“·æVÂæÆ—7FVæW'2ævWB‚&6Æ–6²"’‡·F&vWC¦'Ò“·Ó°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—°¢ÒæVçFW"‚“¶6öç7B÷VæVCÔÒæ÷Vâ‚“¶ö¶’bcÖ÷VæVBbdÒæ—4÷VâbbæVÂæ†–FFVâbg6VÆV7F÷'2ævWB‚&æb"’æ6†–ÆG&VâæÆVæwFƒÓÓÓc°¢6Æ–6²‚'6V7F–öâ"Â&&VÂ"“¶6Æ–6²‚&f–ÇFW""Â&†G2"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&Vâæf–ÇFW"†3Óæ2çFsÓÓÒ&'F–6ÆR"’æÆVæwFƒÓÓÔBæf–ÇFW"‚&&VÂ"Â""Â&†G2"’æÆVæwFƒ°¢6Æ–6²‚&f–ÇFW""Â'Fæ·2"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&Vâç6öÖR†3Óæ2çFW‡D6öçFVçBæ–æ6ÇVFW2‚&æòFæ²&öGV7G2"’“°¢6Æ–6²‚'6V7F–öâ"Â'6V&6‚"“·6V&6‚çfÇVSÒ$%D26W76–öç2#·6V&6‚æÆ—7FVæW'2ævWB‚&–çWB"’‚“¶ö¶’bc×&W7VÇG2æ6†–ÆG&Vâæf–ÇFW"†3Óæ2çFsÓÓÒ&'F–6ÆR"bf2æ6Æ74æÖSÓÓÒ&–æ²Ö6&B"’æÆVæwFƒÓÓÓC°¢6Æ–6²‚'&öGV7B"ÄBç&öGV7G5³Òæ–B“¶6öç7BÆ–æ·3ÖFW66VæFçG2‡&W7VÇG2’æf–ÇFW"†ãÓæâçFsÓÓÒ&"“¶ö¶’bcÖÆ–æ·2æÆVæwFƒÓÓÓbfÆ–æ·5³Òæ‡&VcÓÓÔBç&öGV7G5³ÒçW&ÂbfÆ–æ·5³ÒçF&vWCÓÓÒ%ö&Ææ²"bfÆ–æ·5³Òç&VÃÓÓÒ&æö÷VæW"æ÷&VfW'&W""bfÆ–æ·5³Òç&VfW'&W%öÆ–7“ÓÓÒ&æò×&VfW'&W"#°¢6Æ–6²‚&&6²"“¶6Æ–6²‚'6V7F–öâ"Â&6öÆÆV7F–öç2"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&VâæÆVæwFƒÓÓÓc¶6Æ–6²‚&f–ÇFW""Â&æ¶Ö÷FòÖ6öÆÆV7F–öâ"“¶ö¶’bc×&W7VÇG2æ6†–ÆG&Vâæf–ÇFW"†3Óæ2çFsÓÓÒ&'F–6ÆR"’æÆVæwFƒÓÓÓC°¢6Æ–6²‚'6V7F–öâ"Â'7GVF–ò"“¶ö¶’bcÖFW66VæFçG2‡&W7VÇG2’ç6öÖR†3Óæ2æ‡&VcÓÓÔBçv†öÆW6ÆR’bfFW66VæFçG2‡&W7VÇG2’ç6öÖR†3Óæ2æ‡&VcòæVæG5v—F‚‚"÷&ööbÖöb×v÷&²"’“°¢æVÂæÆ—7FVæW'2ævWB‚&¶W–F÷vâ"’‡·G—S¢&¶W–F÷vâ"Æ¶W“¢$W66R"Ç7F÷&÷vF–öã¦æö÷Ç&WfVçDFVfVÇC¦æö÷Ò“¶ö¶’bcÒÒæ—4÷VâbgæVÂæ†–FFVã°¢Òæ÷Vâ‚“´ÒæÆVfR‚“¶ö¶’bcÒÒæ—4÷VâbgæVÂæ†–FFVâbg&W7VÇG2æ6†–ÆG&VâæÆVæwFƒÓÓÓbg6V&6‚çfÇVSÓÓÒ""bg6VÆV7F÷'2ævWB‚&æb"’æ6†–ÆG&VâæÆVæwFƒÓÓÓ°¢Ð¢f÷"†6öç7B&÷WFRöb²&fVGW&VB"Â&&VÂ"Â'6†—'G2"Â&†G2"Â&f–æRÖ'G2"Â&6öÆÆ'2"Â'7F6¶6†–âÖÖv¦–æR"Â'&ööbÖöb×v÷&²"Â&æöç6Vç6R%Ò—´ÒæVçFW"‚“´Òæ÷Vâ‡&÷WFR“¶ö¶’bc×&÷WFSÓÓÒ&æöç6Vç6R#ôÒç7FG2ç6V7F–öãÓÓÒ&fVGW&VB#¤Òç7FG2ç6V7F–öãÓÓ×&÷WFWÇÄÒç7FG2çFsÓÓ×&÷WFS´ÒæÆVfR‚“·Ð¢ÒæF—7÷6R‚“´ÒæF—7÷6R‚“·&V6÷&B‚%&ööböb–æ²ÖVçS¢6FVv÷&–W2Â6öÆÆV7F–öâ6V&6‚Â&öGV7B&VF—&V7BÂW66RæB&WVFVBf—6—G26ÆVâÆÂ†æFÆW'2"Æö¶’bfÆ—7FVæW'2ç6—¦SÓÓÓbfVÆVÖVçG2æWfW'’†SÓæRæÆ—7FVæW'2ç6—¦SÓÓÓ’bdÒç7FG2æF—7÷6VB“°¢Öf–æÆÇ—¶vÆö&ÅF†—2æFö7VÖVçC×6fVDFö3´$ÂæG6$ÖVçU6†VÆÃ×6fVE6†VÆÃ·Ð§Ó° ¢òò'VÆRö6öçG&7C¢W†W&6—6RF†R&VÂ&ööÒ6öÆÆ—6–öâæB6†&VB7&Wr6VF–ærB–VÆÆ÷rw2F–ÖVç6–öç2à¦6öç7B&–t&—F6ö–ä6†V6·2Ò$ÂÓâ°¢6öç7Bæö÷Ò‚“Óç·ÒÅ3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÇF&vWG3ÖæWr6WB‚’ÆW‡FW&–÷#×·f—6–&ÆS§G'VWÒÇvVF†W#×·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÆ–ç6–FS¦fÇ6RÇ6WD–çFW&–÷"†öâ—·F†—2æ–ç6–FSÖöã·×Ó°¢6öç7BÆæCÔ$ÂæG6$vVöw&‡’æ'V–ÆB‚“¶ÆWB&WGW&æVCÖçVÆÃ°¢6öç7B“Ô$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷BÆW‡FW&–÷"ÆÆæBÇvVF†W"Ç&VÆö6FS§Óç&WGW&æVC×²ââçÒÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“°¢6öç7BVçG'“Ô’ç&Vv—7G'’ævWB‚&&–rÖ&—F6ö–â"“´’ç&Wf–Wr‚&&–rÖ&—F6ö–â"ÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÓ°¢6öç7B3Ô$Âæ7&Wræ7&VFR‡·&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦ãÓçF&vWG2æFB†â’Ç&VÖ÷fS¦ãÓçF&vWG2æFVÆWFR†â—ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¤’æw&÷VæDBÇvÆ¶&ÆS¤’çvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“´2æ6öçG&öÂ„“°¢6öç7B6ÆV#Ò†‚Æ¢Æ'ƒÖ‚Æ'£Ö¢“Óä’çvÆ¶&ÆR†‚Æ¢Æ'‚Æ'¢ÃÄæ&öG”†V–v‡BÄ“°¢6öç7B7FWÒã2ÆÖ–åƒÒÓ#ãBÆÖ–å£ÒÓ#bãBÇsÓ3rÆƒÓsrÇ6VVãÖæWrV–çC„'&’‡r¦‚’ÇVWVSÕµÓ°¢6öç7B–æFWƒÒ‡‚Ç¢“ÓäÖF‚ç&÷VæB‚‡¢ÖÖ–å¢’÷7FW’§r´ÖF‚ç&÷VæB‚‡‚ÖÖ–å‚’÷7FW’Ç7F'CÖ–æFW‚…"ç7vâç‚Å"ç7vâç¢“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—°¢6öç7Bã×VWVU¶†VEÒÆ—ƒÖâWrÆ—£ÔÖF‚æfÆö÷"†â÷r’ÇƒÖÖ–å‚¶—‚§7FWÇ£ÖÖ–å¢¶—¢§7FW°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢Æ“Öç¢§r¶çƒ¶–b†çƒÃÇÆçƒã×wÇÆç£ÃÇÆç£ãÖ‡ÇÇ6VVå¶•×ÇÂ6ÆV"‡‚Ç¢Ç‚¶G‚§7FWÇ¢¶G¢§7FW’–6öçF–çVS·6VVå¶•ÓÓ·VWVRçW6‚†’“·Ð¢Ð¢6öç7B&V6†&ÆS×Óç¶6öç7B“Ö–æFW‚‡ç‚Çç¢’Æ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r“¶f÷"†ÆWBGƒÒÓ¶GƒÃÓ¶G‚²²–f÷"†ÆWBG£ÒÓ¶G£ÃÓ¶G¢²²—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G£¶–b†çƒãÓbfçƒÇrbfç£ãÓbfç£Æ‚bg6VVå¶ç¢§r¶ç…Òbf6ÆV"†Ö–å‚¶ç‚§7FWÆÖ–å¢¶ç¢§7FWÇç‚Çç¢’—&WGW&âG'VS·×&WGW&âfÇ6S·Ó°¢6öç7BvöÇ3Õµ"æW†—BÅ"æÖVF–BÂââå"æ'&÷w6TvöÇ5Ó°¢&V6÷&B‚$$”r$•D4ô”âæf–vF–öã¢–VÆÆ÷r&V6†W2WfW'’v–ærÂ&Wf–WrÂFW&Ö–æÂæB6VBg&öÒF†R7GVÂf6FRVçG&æ6R"Æ6ÆV"…"ç7vâç‚Å"ç7vâç¢’bfvöÇ2æWfW'’‡&V6†&ÆR’Ä¥4ôâç7G&–æv–g’‡·&F—W3¤æ&öG•&F—W2ÇVç&V6†&ÆS¦vöÇ2æf–ÇFW"‡Óâ&V6†&ÆR‡’—Ò’“°¢ÆWB6VF–æs×G'VS°¢f÷"†6öç7B6VBöb"ç6VG2—´ö&¦V7Bæ76–vâ„ç&ö÷Bç÷6—F–öâÇ·ƒ§6VBçvÆ´Bç‚Ç“¤æ&6U’Ç£§6VBçvÆ´Bç§Ò“´æ†÷Ôæ†÷cÓ·6VF–ærbcÔ2ç6—EÆ–W"‡6VB“´2ç7FVW"‚ãbÃ“´2æÆöö²‡6VBç'’Âã"Ã“´2çWFFR‚ã"Ã“·6VF–ærbcÔæ6×ç6VCÓÓ×6VBbdç&ö÷Bç÷6—F–öâçƒÓÓ×6VBç‚bdç&ö÷Bç÷6—F–öâç£ÓÓ×6VBç£´2ç7FVW"ƒÃ“·6VF–ærbcÔ2ç7FæEÆ–W"‚’bbæ6×ç6VBbb6VBç6—GFW"bf6ÆV"„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢“·Ð¢&V6÷&B‚$$”r$•D4ô”â6VF–æs¢&ö&G&ööÒÂ&W72Â6öçG&öÂæB&6†—fRW6R6†&VB6—Bög&VRÖÆöö²÷7FæBv—F‚6fRW†—G2"Ç6VF–ærbe"ç6VG2æf–ÇFW"‡3Óç2ç¦öæSÓÓÒ&&ö&G&ööÒ"’æÆVæwFƒÓÓÓbe"ç6VG2æf–ÇFW"‡3Óç2ç¦öæSÓÓÒ'&W72"’æÆVæwFƒÓÓÓ"Ä¥4ôâç7G&–æv–g’…"ç6VG2æf–ÇFW"‡3Óâ6ÆV"‡2çvÆ´Bç‚Ç2çvÆ´Bç¢’’’“°¢ÆWBæöFW3ÓÆf–æ—FS×G'VS¶6öç7BvVöÖWG'“ÖæWr6WB‚“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’—¶vVöÖWG'’æFB†âævVöÖWG'’“¶f–æ—FRbcÖâævVöÖWG'’çfW'G2æWfW'’„çVÖ&W"æ—4f–æ—FR“·Öâæ6†–ÆG&Vâæf÷$V6‚‡f—6—B“·Óµ2çWFFUv÷&ÆB…"ç&ö÷B“·f—6—B…"ç&ö÷B“°¢&V6÷&B‚$$”r$•D4ô”â&VæFW"'VFvWC¢FVç6R&ööÒW6W2f–æ—FR6†&VB76VÖ&Æ–W2Â7FF–267&VVç2æB6WfVâÆ–v‡G2"Æf–æ—FRbfæöFW3Ã#CbfvVöÖWG'’ç6—¦SÃƒbe"æÆ–v‡F–æræÆ–v‡D6÷VçCÓÓÓrbe"æ6÷VçG2æ&öö·3ãÓCbe"æ6÷VçG2æÖöæ—F÷'3ãÓ#Ä¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG'“¦vVöÖWG'’ç6—¦RÂââå"æ6÷VçG7Ò’“°¢ÆWB6ÖW&6ÆV#×G'VS¶f÷"†6öç7B‚öb²Órã"Ãrã%Ò–f÷"†6öç7B¢öb²ÓÃÒ—¶6öç7Bfö7W3×·ƒ§ƒÃ÷‚³§‚ÓÇ“£"Ç§ÒÇ×·ƒ§ƒÃ÷‚Ó3§‚³2Ç“£"Ç§Óµ"æ6Æ×6ÖW&‡Æfö7W2“¶6ÖW&6ÆV"bc×ƒÃ÷çƒç‚²ãs§çƒÇ‚Òãs·Ð¢&V6÷&B‚$$”r$•D4ô”â6ÖW&¢G&–Æ–ærf–Wr7F—2öâF†RÆ–W"w26–FRöb6öÆ–B'F—F–öç2"Æ6ÖW&6ÆV"“°¢ÆWBÆ–fV7–6ÆS×G'VS¶6öç7B6÷VçC×&ö÷Bæ6†–ÆG&VâæÆVæwFƒ°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—¶Æ–fV7–6ÆRbc×vVF†W"æ–ç6–FRbbW‡FW&–÷"çf—6–&ÆRbd’æVF–òç7FG2æ7F—fS´’ç&WVW7B…"æW†—B“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÒ’æ7F—fRbbvVF†W"æ–ç6–FRbfW‡FW&–÷"çf—6–&ÆRbb’æVF–òç7FG2æ7F—fRbb’æVF–òç7FG2æ6öææV7FVBbb"ç&ö÷Bçf—6–&ÆRbg&WGW&æVBçƒÓÓÖVçG'’æVçG'’ç‚bg&WGW&æVBç£ÓÓÖVçG'’æVçG'’ç£´’ç&Wf–Wr‚&&–rÖ&—F6ö–â"ÇG'VR“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÔ’æ7F—fRç&ööÓÓÓÕ"bg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6÷VçBbd’ç&öö×2ç6—¦SÓÓÓ·Ð¢2æF—7÷6R‚“´’æF—7÷6R‚“·&V6÷&B‚$$”r$•D4ô”âÆ–fV7–6ÆS¢&WVBVçG'’öW†—B&WGW&ç2FòF†R6ÖR'V–ÆF–ærÂ&W7F÷&W2W‡FW&–÷"æB&WW6W2öF—7÷6W2&ööÒ&W6÷W&6W2"ÆÆ–fV7–6ÆRbgF&vWG2ç6—¦SÓÓÓbb&ö÷Bæ6†–ÆG&Vâæ–æ6ÇVFW2…"ç&ö÷B’bb’æVF–òç7FG2æ6öçFW‡G2“°¢6öç7BCÔ$Âæ&–t&—F6ö–äFFÇ6÷W&6S×&VDf–ÆU7–æ2†æWrU$Â‚"ââ÷7&2ö§2ö&–rÖ&—F6ö–âÖÖVçRæ§2"Æ–×÷'BæÖWFçW&Â’Â'WFc‚"’Ç66VæS×&VDf–ÆU7–æ2†æWrU$Â‚"ââ÷7&2ö§2÷66VæRÖG6"æ§2"Æ–×÷'BæÖWFçW&Â’Â'WFc‚"“°¢&V6÷&B‚$$”r$•D4ô”â&—f7“¢&÷VæFVBöff–6–ÂFW7F–æF–öç2ÂæòÆ—fR&–6W2Â7W7FöÖW"6öÆÆV7F–öâÂöÆÆ–ær÷"W'6—7FVæ6R"ÄBæ6&G2æWfW'’†3ÓäBæöff–6–Â†2çW&Â’bf2çW&Âç7F'G5v—F‚„Bæ†öÖR’bb2ç&–6R’be²&¦f67&—C¦ÆW'Bƒ’"Â&‡GG3¢ò÷öF6öæbç‡—¢æWf–ÂçFW7Bò"Â&‡GG3¢ò÷öF6öæbç‡—¢óöVÖ–Ã×‚"Â&‡GG3¢ò÷öF6öæbç‡—¢ö6'Bò%ÒæWfW'’‡SÓâBæöff–6–Â‡R’’bböfWF6…Â‡Å„ÔÄ‡GG&WVW7GÆÆö6Å7F÷&vWÇ6W76–öå7F÷&vWÇ6WD–çFW'fÇÆ7&VFTVÆVÖVçEÂ‚"ƒó¦–g&ÖWÆf÷&×Æ–çWB’"òçFW7B‡6÷W&6R’bg66VæRæ–æ6ÇVFW2‚&6öçFW‡Bæ†–FFVãÒfF"æ6×ç6VB"’“°¢òò6öçG&7C¢F†R7GVÂFW&Ö–æÂWfVçB†æFÆW'2×W7B&W6WBÆÂ6öçFVçBæBÆ—7FVæW'2V6‚f—6—Bà¢6öç7B6fVDFö3ÖvÆö&ÅF†—2æFö7VÖVçBÇ6fVE6†VÆÃÔ$ÂæG6$ÖVçU6†VÆÂÆÆ—7FVæW'3ÖæWrÖ‚’ÆVÆVÖVçG3ÕµÓ°¢6öç7BVÆVÖVçC×FsÓç°¢6öç7BS×·FrÆ6†–ÆG&Vã¥µÒÆFF6WC§·ÒÆ†–FFVã¦fÇ6RÆGG&–'WFW3§·ÒÇ&VçC¦çVÆÂÆ—46öææV7FVC§G'VRÇFW‡D6öçFVçC¢""ÆÆ—7FVæW'3¦æWrÖ‚’À¢6WDGG&–'WFR†²Çb—·F†—2æGG&–'WFW5¶µÓ×c·ÒÆVæD6†–ÆB†2—¶2ç&VçC×F†—3·F†—2æ6†–ÆG&VâçW6‚†2“·&WGW&â3·ÒÇ&WÆ6T6†–ÆG&Vâ‚—·F†—2æ6†–ÆG&Vâæf÷$V6‚†3Óæ2ç&VçCÖçVÆÂ“·F†—2æ6†–ÆG&VãÕµÓ·ÒÀ¢6öçF–ç2†â—¶f÷"ƒ¶ã¶ãÖâç&VçB––b†ãÓÓ×F†—2—&WGW&âG'VS·&WGW&âfÇ6S·ÒÆ6Æ÷6W7B‡2—¶–b‡3ÓÓÒ&'WGFöâ"—&WGW&âF†—2çFsÓÓÒ&'WGFöâ#÷F†—3§F†—2ç&VçCòæ6Æ÷6W7B‡2“¶–b‡3ÓÓÒ%¶†–FFVåÒ"—&WGW&âF†—2æ†–FFVã÷F†—3§F†—2ç&VçCòæ6Æ÷6W7B‡2“·&WGW&âçVÆÃ·ÒÆfö7W2‚—¶Fö7VÖVçBæ7F—fTVÆVÖVçC×F†—3·ÒÆFDWfVçDÆ—7FVæW"†²Æb—·F†—2æÆ—7FVæW'2ç6WB†²Æb“·ÒÇ&VÖ÷fTWfVçDÆ—7FVæW"†²—·F†—2æÆ—7FVæW'2æFVÆWFR†²“·Ð¢Ó¶VÆVÖVçG2çW6‚†R“·&WGW&âS°¢Ó°¢6öç7BæVÃÖVÆVÖVçB‚'6V7F–öâ"’Ç6VÆV7F÷'3ÖæWrÖ‚“¶f÷"†6öç7B·ÇFuÒöbµ²&æb"Â&æb%ÒÅ²"æ&–r×&W7VÇG2"Â&F—b%ÒÅ²u¶FFÖ&–sÒ&6Æ÷6R%ÒrÂ&'WGFöâ%ÕÒ—¶6öç7BSÖVÆVÖVçB‡Fr“·æVÂæVæD6†–ÆB†R“·6VÆV7F÷'2ç6WB‡ÆR“·×6VÆV7F÷'2ævWB‚u¶FFÖ&–sÒ&6Æ÷6R%Òr’æFF6WBæ&–sÒ&6Æ÷6R#°¢æVÂçVW'•6VÆV7F÷#×Óç6VÆV7F÷'2ævWB‡“·æVÂçVW'•6VÆV7F÷$ÆÃÒ‚“ÓæVÆVÖVçG2æf–ÇFW"†SÓçæVÂæ6öçF–ç2†R’be²&'WGFöâ"Â&%Òæ–æ6ÇVFW2†RçFr’“°¢vÆö&ÅF†—2æFö7VÖVçC×¶vWDVÆVÖVçD'”–C¢‚“ÓçæVÂÆ7&VFTVÆVÖVçC¦VÆVÖVçBÆ7F—fTVÆVÖVçC¦çVÆÂÆFDWfVçDÆ—7FVæW#¢†²Æb“ÓæÆ—7FVæW'2ç6WB†²Æb’Ç&VÖ÷fTWfVçDÆ—7FVæW#¦³ÓæÆ—7FVæW'2æFVÆWFR†²—Ó°¢G'—°¢$ÂæG6$ÖVçU6†VÆÃ×·&W6VçC¦æö÷Ó°¢6öç7BÓÔ$Âæ&–t&—F6ö–äÖVçRæ7&VFR‚’Ç&W7VÇG3×6VÆV7F÷'2ævWB‚"æ&–r×&W7VÇG2"’Ææc×6VÆV7F÷'2ævWB‚&æb"“¶ÆWBö¶“ÒÒæ÷Vâ‚“°¢f÷"†ÆWB“Ó¶“Ã3¶’²²—°¢ÒæVçFW"‚“¶ö¶’bcÔÒæ÷Vâ‚’bdÒæ—4÷Vâbfæbæ6†–ÆG&VâæÆVæwFƒÓÓÔBç6V7F–öç2æÆVæwFƒ°¢f÷"†6öç7B¶–EÒöbBç6V7F–öç2—¶6öç7B#Öæbæ6†–ÆG&Vâæf–æB†ãÓæâæFF6WBç6V7F–öãÓÓÖ–B“·æVÂæÆ—7FVæW'2ævWB‚&6Æ–6²"’‡·F&vWC¦'Ò“¶ö¶’bc×&W7VÇG2æ6†–ÆG&VâæÆVæwFƒÓÓÔBæ6&G2æf–ÇFW"†3Óæ2ç6V7F–öãÓÓÖ–B’æÆVæwF‚bg&W7VÇG2æ6†–ÆG&VâæWfW'’†3Óç¶6öç7BÖ2æ6†–ÆG&Vâæf–æB†ãÓæâçFsÓÓÒ&"“·&WGW&âBæöff–6–Â†æ‡&Vb’bfçF&vWCÓÓÒ%ö&Ææ²"bfç&VÃÓÓÒ&æö÷VæW"æ÷&VfW'&W""bfç&VfW'&W%öÆ–7“ÓÓÒ&æò×&VfW'&W"#·Ò“·Ð¢æVÂæÆ—7FVæW'2ævWB‚&¶W–F÷vâ"’‡·G—S¢&¶W–F÷vâ"Æ¶W“¢$W66R"Ç7F÷&÷vF–öã¦æö÷Ç&WfVçDFVfVÇC¦æö÷Ò“¶ö¶’bcÒÒæ—4÷VâbgæVÂæ†–FFVã°¢Òæ÷Vâ‚“´ÒæÆVfR‚“¶ö¶’bcÒÒæ—4÷VâbgæVÂæ†–FFVâbbæbæ6†–ÆG&VâæÆVæwF‚bb&W7VÇG2æ6†–ÆG&VâæÆVæwF‚bdÒç7FG2ç6V7F–öãÓÓÒ&÷fW'f–Wr#°¢Ð¢f÷"†6öç7B&÷WFRöb²&÷fW'f–Wr"Â&æWw2"Â'&W6V&6‚"Â&ÖW&6‚"Â&f–7F–öæÂÖ&ö&G&ööÒ%Ò—´ÒæVçFW"‚“´Òæ÷Vâ‡&÷WFR“¶ö¶’bcÔÒç7FG2ç6V7F–öãÓÓÒ‡&÷WFSÓÓÒ&f–7F–öæÂÖ&ö&G&ööÒ#ò&÷fW'f–Wr#§&÷WFR“´ÒæÆVfR‚“·Ð¢ÒæF—7÷6R‚“´ÒæF—7÷6R‚“·&V6÷&B‚$$”r$•D4ô”âFW&Ö–æÃ¢7GVÂ6V7F–öç2Â6fR&VF—&V7G2ÂW66RæBF‡&VRf—6—G2ÆVfRöæRæVÂv—F‚æò7FÆR†æFÆW'2"Æö¶’bfÆ—7FVæW'2ç6—¦SÓÓÓbfVÆVÖVçG2æWfW'’†SÓæRæÆ—7FVæW'2ç6—¦SÓÓÓ’“°¢Öf–æÆÇ—¶vÆö&ÅF†—2æFö7VÖVçC×6fVDFö3´$ÂæG6$ÖVçU6†VÆÃ×6fVE6†VÆÃ·Ð§Ó° ¢òò'VÆS¢F†R6öæ6WBw26V7F–öç2æBWfW'’6VB×W7B&R&V6†&ÆR'’F†R&VÂ–VÆÆ÷r6öçG&öÆÆW"à¦6öç7BÖVÖTf7F÷'”6†V6·2Ò$ÂÓâ°¢6öç7Bæö÷Ò‚“Óç·ÒÅ3Ô$Âç66VæRÇ&ö÷CÕ2æ7&VFTæöFR‚’ÇF&vWG3ÖæWr6WB‚’ÆW‡FW&–÷#×·f—6–&ÆS§G'VWÒÇvVF†W#×·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÆ–ç6–FS¦fÇ6RÇ6WD–çFW&–÷"†öâ—·F†—2æ–ç6–FSÖöã·×Ó°¢6öç7BÆæCÔ$ÂæG6$vVöw&‡’æ'V–ÆB‚“¶ÆWB&WGW&æVCÖçVÆÃ°¢6öç7B“Ô$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷BÆW‡FW&–÷"ÆÆæBÇvVF†W"Ç&VÆö6FS§Óç&WGW&æVC×²ââçÒÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“°¢’ç&Wf–Wr‚&ÖVÖRÖf7F÷'’"ÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÓ°¢6öç7B3Ô$Âæ7&Wræ7&VFR‡·&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦ãÓçF&vWG2æFB†â’Ç&VÖ÷fS¦ãÓçF&vWG2æFVÆWFR†â—ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¤’æw&÷VæDBÇvÆ¶&ÆS¤’çvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“´2æ6öçG&öÂ„“°¢6öç7B6ÆV#Ò†‚Æ¢Æ'ƒÖ‚Æ'£Ö¢“Óä’çvÆ¶&ÆR†‚Æ¢Æ'‚Æ'¢ÃÄæ&öG”†V–v‡BÄ“°¢6öç7B7FWÒã#RÆÖ–åƒÒÓrãRÆÖ–å£ÒÓ#ãRÇsÓCÆƒÓcRÇ6VVãÖæWrV–çC„'&’‡r¦‚’ÇVWVSÕµÓ°¢6öç7B–æFWƒÒ‡‚Ç¢“ÓäÖF‚ç&÷VæB‚‡¢ÖÖ–å¢’÷7FW’§r´ÖF‚ç&÷VæB‚‡‚ÖÖ–å‚’÷7FW’Ç7F'CÖ–æFW‚…"ç7vâç‚Å"ç7vâç¢“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—°¢6öç7Bã×VWVU¶†VEÒÆ—ƒÖâWrÆ—£ÔÖF‚æfÆö÷"†â÷r’ÇƒÖÖ–å‚¶—‚§7FWÇ£ÖÖ–å¢¶—¢§7FW°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢Æ“Öç¢§r¶çƒ¶–b†çƒÃÇÆçƒã×wÇÆç£ÃÇÆç£ãÖ‡ÇÇ6VVå¶•×ÇÂ6ÆV"‡‚Ç¢Ç‚¶G‚§7FWÇ¢¶G¢§7FW’–6öçF–çVS·6VVå¶•ÓÓ·VWVRçW6‚†’“·Ð¢Ð¢6öç7B&V6†&ÆS×Óç¶6öç7B“Ö–æFW‚‡ç‚Çç¢’Æ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r“¶f÷"†ÆWBGƒÒÓ¶GƒÃÓ¶G‚²²–f÷"†ÆWBG£ÒÓ¶G£ÃÓ¶G¢²²—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G£¶–b†çƒãÓbfçƒÇrbfç£ãÓbfç£Æ‚bg6VVå¶ç¢§r¶ç…Òbf6ÆV"†Ö–å‚¶ç‚§7FWÆÖ–å¢¶ç¢§7FWÇç‚Çç¢’—&WGW&âG'VS·×&WGW&âfÇ6S·Ó°¢6öç7BvöÇ3Õµ"æW†—BÂââå"æ'&÷w6TvöÇ2Âââå"ç6VG2æÖ‡3Óç2çvÆ´B’Âââå"æÖVçU¦öæW2æf–ÇFW"‡£Óç¢ç&–÷&—G“ÓÓÓ2•Ó°¢&V6÷&B‚$ÖVÖRf7F÷'’æf–vF–öã¢&VÂ–VÆÆ÷r&V6†W26—‚6V7F–öç2ÂWfW'’÷'G&—BÂÆÂ6VG2æBW†—B"Æ6ÆV"…"ç7vâç‚Å"ç7vâç¢’bfvöÇ2æWfW'’‡&V6†&ÆR’Ä¥4ôâç7G&–æv–g’‡·&F—W3¤æ&öG•&F—W2ÇVç&V6†&ÆS¦vöÇ2æf–ÇFW"‡Óâ&V6†&ÆR‡’—Ò’“°¢ÆWB6VF–æs×G'VS°¢f÷"†6öç7B6VBöb"ç6VG2—´ö&¦V7Bæ76–vâ„ç&ö÷Bç÷6—F–öâÇ·ƒ§6VBçvÆ´Bç‚Ç“¤æ&6U’Ç£§6VBçvÆ´Bç§Ò“´æ†÷Ôæ†÷cÓ·6VF–ærbcÔ2ç6—EÆ–W"‡6VB“´2ç7FVW"‚ãbÃ“´2æÆöö²‡6VBç'’Âã2Ã“´2çWFFR‚ã"Ã“·6VF–ærbcÔæ6×ç6VCÓÓ×6VBbdç&ö÷Bç÷6—F–öâçƒÓÓ×6VBç‚bdç&ö÷Bç÷6—F–öâç£ÓÓ×6VBç£´2ç7FVW"ƒÃ“·6VF–ærbcÔ2ç7FæEÆ–W"‚’bbæ6×ç6VBbb6VBç6—GFW"bf6ÆV"„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢“·Ð¢&V6÷&B‚$ÖVÖRf7F÷'’6VF–æs¢6WfVâ6†&VB6VG27W÷'B÷6RÂg&VRÆöö²ÂÖ÷fVÖVçBÆö6²æB6fR7FæB"Ç6VF–ærbe"ç6VG2æÆVæwFƒÓÓÓr“°¢ÆWBæöFW3ÓÆf–æ—FS×G'VRÆf6W3Ó¶6öç7BvVöÖWG&–W3ÖæWr6WB‚“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’—¶vVöÖWG&–W2æFB†âævVöÖWG'’“¶f–æ—FRbcÖâævVöÖWG'’çfW'G2æWfW'’„çVÖ&W"æ—4f–æ—FR“·Öâæ6†–ÆG&Vâæf÷$V6‚‡f—6—B“·Óµ2çWFFUv÷&ÆB…"ç&ö÷B“·f—6—B…"ç&ö÷B“¶f÷"†6öç7BröbvVöÖWG&–W2–f6W2³Öræf6W2æÆVæwFƒ°¢&V6÷&B‚$ÖVÖRf7F÷'’&W6÷W&6R'VFvWC¢66†VBgW&æ—GW&RæB÷'G&—G2Â7FF–267&VVç2æB6—‚Æ–v‡G2"Æf–æ—FRbfæöFW3Ã##bfvVöÖWG&–W2ç6—¦SÃ“bff6W3Ã3Sbe"æÆ–v‡F–æræÆ–v‡D6÷VçCÓÓÓbbe"æ6÷VçG2çv÷&·7FF–öç3ÓÓÓBÄ¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦RÆf6W2Âââå"æ6÷VçG7Ò’“°¢6öç7B£Ô$ÂæG6$ÖVçU¦öæW2Ç&÷WFSÒ‡‚Ç¢“Óå¢ç&W6öÇfR…"Ç·‚Ç§Ò’ç&÷WFS°¢6öç7B66W3Õµ³ÃbÂ&†öÖR%ÒÅ²Ó‚ÂÓ’ãrÂ&Æ6W"%ÒÅ³ã‚ÂÓãRÂ&6öçG&–'WF÷'2%ÒÅ³’ã"ÂÓ‚ã2Â'–VÆÆ÷r%ÒÅ²ÓãBÃ"Â&†öÖR%ÒÅ³Âã"Â'öF67B%ÒÅ³rã"ÃÂ&†öÖR%ÕÓ°¢&V6÷&B‚$ÖVÖRf7F÷'’6öçFW‡C¢‡—6–6Â6V7F–öç26VÆV7B&VÂvW2ÂW†7B÷'G&—G2÷fW'&–FRvÆÆW'’Â&öGV7F–öâö&6†—fRfÆÂ†öÖR"Æ66W2æWfW'’‚…·‚Ç¢Ç%Ò“Óç&÷WFR‡‚Ç¢“ÓÓ×"’be"æÖVçU¦öæW2æf–ÇFW"‡£Óç¢ç&–÷&—G“ÓÓÓ2’æWfW'’‡£Óç&÷WFR‡¢ç‚Ç¢ç¢“ÓÓ×¢ç&÷WFR’Ä¥4ôâç7G&–æv–g’†66W2æÖ‚…·‚Ç¢Ç%Ò“Óâ‡·vçC§"Æv÷C§&÷WFR‡‚Ç¢—Ò’’’“°¢6öç7BfVçVW3×²'v—F†÷WB×'VÆW'2#¥µ²ÓRã2ÃãRÂ'6†—'G2%ÒÅ³Rã2ÃãRÂ&†ööF–W2%ÒÅ³’ãBÂÒãƒRÂ&†G2%ÒÅ³‚ãÃbÂ&'B%ÒÅ²Ó’ãRÂÓrã‚Â&&—ƒR%ÒÅ³ÃrÂ&†öÖR%ÕÒÂ'&ööbÖöbÖ–æ²#¥µ³ÃÂ&fVGW&VB%ÒÅ²ÓãbÃÂ&f–æRÖ'G2%ÒÅ³‚ÂÓãÂ&6öÆÆ'2%ÒÅ²Ó’Ã‚ã‚Â'7F6¶6†–âÖÖv¦–æR%ÒÅ³ÂÓrÂ&fVGW&VB%ÕÒÂ&&–rÖ&—F6ö–â#¥µ³ÃrÂ&÷fW'f–Wr%ÒÅ³Bã"ÂÓrÂ&æWw2%ÒÅ³Bã"ÃÂ'&W6V&6‚%ÒÅ²ÓBã"ÃrÂ&ÖW&6‚%ÒÅ²ÓBã"ÂÓrÂ&÷fW'f–Wr%ÕÒÂ&Ö†—2Ö6ÇV"#¥µ³rãBÂÓãBÂ&†öÖR%ÒÅ³ÃÂ&†öÖR%Õ×Ó°¢f÷"†6öç7B¶–BÆ6†V6·5Òöbö&¦V7BæVçG&–W2‡fVçVW2’—¶6öç7B#×¶–GÓ·"æÖVçU¦öæW3Õ¢æf÷%&ööÒ‡"“·&V6÷&B‚$E4"6öçFW‡GVÂ&÷WFW3¢"¶–BÆ6†V6·2æWfW'’‚…·‚Ç¢ÇvçEÒ“Óå¢ç&W6öÇfR‡"Ç·‚Ç§Ò’ç&÷WFSÓÓ×vçB’Ä¥4ôâç7G&–æv–g’†6†V6·2æÖ‚…·‚Ç¢ÇvçEÒ“Óâ‡·vçBÆv÷C¥¢ç&W6öÇfR‡"Ç·‚Ç§Ò’ç&÷WFWÒ’’’“·Ð¢ÆWBÆ–fV7–6ÆS×G'VS¶6öç7B6†–ÆD6÷VçC×&ö÷Bæ6†–ÆG&VâæÆVæwF‚ÆVçG'“Ô’ç&Vv—7G'’ævWB‚&ÖVÖRÖf7F÷'’"’æVçG'“°¢f÷"†ÆWB“Ó¶“Ã¶’²²—¶Æ–fV7–6ÆRbc×vVF†W"æ–ç6–FRbbW‡FW&–÷"çf—6–&ÆRbd’æVF–òç7FG2æ7F—fS´’ç&WVW7B…"æW†—B“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÒ’æ7F—fRbbvVF†W"æ–ç6–FRbfW‡FW&–÷"çf—6–&ÆRbb’æVF–òç7FG2æ7F—fRbb’æVF–òç7FG2æ6öææV7FVBbg&WGW&æVBçƒÓÓÖVçG'’ç‚bg&WGW&æVBç£ÓÓÖVçG'’ç£´’ç&Wf–Wr‚&ÖVÖRÖf7F÷'’"ÇG'VR“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÔ’æ7F—fRç&ööÓÓÓÕ"bg&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆD6÷VçC·Ð¢òòW†W&6—6RF†RÖW&vVBVçG&æ6Rw27GVÂGVææVÂÂ÷'F&fÆ–v‡BæB&WGW&âFòW‡FW&–÷"v—F‚FWFW&Ö–æ—7F–2–çWB6÷W&6Rà¢6öç7B6fVEsÖvÆö&ÅF†—2æ–ææW%v–GF‚Ç6fVDƒÖvÆö&ÅF†—2æ–ææW$†V–v‡C¶vÆö&ÅF†—2æ–ææW%v–GFƒÓCC¶vÆö&ÅF†—2æ–ææW$†V–v‡CÓ“°¢ÆWBW‡FW&æÃÖfÇ6RÆ†VÆCÖfÇ6RÆ'&—fÇ3ÓÇ&V6V—fVCÓÆf–æ—6†VCÓ°¢6öç7B–Æ÷C×¶6öçG&öÇ3§·&VC¢‚“Óâ‡·“£Ò—ÒÇ6WDW‡FW&æÄ6öçG&öÃ¦öãÓæW‡FW&æÃÖöçÒÆ6ÖW&×·÷6—F–öã§·ƒ£Ç“£Ç££ÒÇF&vWC§·ƒ£Ç“£Ç££×ÒÇ66VæS×·&VæFW$÷G3§·×ÒÇ&VæFW$÷G3×66VæRç&VæFW$÷G3°¢6öç7BVçG&æ6SÔ$ÂæG6$VçG&æ6Ræ7&VFR‡·&ö÷BÆ6ÖW&ÆfF#¤Ç–Æ÷BÆgƒ§·WFFS¦æö÷ÒÆW‡FW&–÷"Ç66VæRÇ&VæFW$÷G2ÆÆæBÆvFS§·&ö÷C§·÷6—F–öã§·ƒ¢ÓS‚Ç“£Ç£¢ÓcG×ÒÇ&V6V—fS¢‚“Óç&V6V—fVB²²Æf–æ—6…&V6V—f–æs¢‚“Óæf–æ—6†VB²·ÒÆ†öÆC¦öãÓæ†VÆCÖöâÆ×WFVC¢‚“ÓçG'VRÆöä'&—fS¢‚“Óæ'&—fÇ2²²ÆöäÆVfS¦æö÷Ò“°¢VçG&æ6RçWFFRƒócÃ“¶VçG&æ6RçWFFRƒócÃóc“¶6öç7BGVææVÃÖVçG&æ6Rç†6SÓÓÒ'GVææVÂ"bfVçG&æ6Ræw&÷Wçf—6–&ÆRbbW‡FW&–÷"çf—6–&ÆRbfW‡FW&æÃ°¢f÷"†ÆWB“Ó¶“ÃSbfVçG&æ6Rç†6SÓÓÒ'GVææVÂ#¶’²²–VçG&æ6RçWFFRƒócÆ’óc“°¢6öç7B'&—fÃÖVçG&æ6Rç†6SÓÓÒ&'&—fÂ"bf†VÆBbg&V6V—fVCÓÓÓbfW‡FW&–÷"çf—6–&ÆRbbVçG&æ6Ræw&÷Wçf—6–&ÆRÇ÷6W3ÕµÓ°¢f÷"†ÆWB“Ó¶“Ã#bfVçG&æ6Rç†6RÓÒ&FöæR#¶’²²—¶VçG&æ6RçWFFRƒócÆ’óc“¶–b†’S#ÓÓÓ—÷6W2çW6‚‡²ââæ6ÖW&ç÷6—F–öçÒ“·Ð¢&V6÷&B‚$ÖW&vVBE4"VçG&æ6S¢vÆ¶–ær7&÷76W2v÷&Ö†öÆRÂ&V6V—fW2B÷'F&ÂfÆ–W2—6ÆæBæB&WGW&ç26öçG&öÇ2FòW‡FW&–÷""ÇGVææVÂbf'&—fÂbfVçG&æ6Rç†6SÓÓÒ&FöæR"bb†VÆBbbW‡FW&æÂbf'&—fÇ3ÓÓÓbff–æ—6†VCÓÓÓbg66VæRç&VæFW$÷G3ÓÓ×&VæFW$÷G2bg÷6W2æÆVæwFƒãRbg÷6W2æWfW'’‡Óäö&¦V7BçfÇVW2‡’æWfW'’„çVÖ&W"æ—4f–æ—FR’’Ä¥4ôâç7G&–æv–g’‡·GVææVÂÆ'&—fÂÇ†6S¦VçG&æ6Rç†6RÆ'&—fÇ2Ç&V6V—fVBÆf–æ—6†VBÇ÷6W3§÷6W2æÆVæwF‡Ò’“°¢VçG&æ6RæF—7÷6R‚“¶vÆö&ÅF†—2æ–ææW%v–GFƒ×6fVEs¶vÆö&ÅF†—2æ–ææW$†V–v‡C×6fVDƒ°¢2æF—7÷6R‚“´’æF—7÷6R‚“·&V6÷&B‚$ÖVÖRf7F÷'’Æ–fV7–6ÆS¢FVâf—6—G2&W6W'fRf6FR&WGW&âöVF–òvF–æræB&VÆV6R66VæRö–çWB&W6÷W&6W2"ÆÆ–fV7–6ÆRbgF&vWG2ç6—¦SÓÓÓbb&ö÷Bæ6†–ÆG&Vâæ–æ6ÇVFW2…"ç&ö÷B’bb’æVF–òç7FG2æ6öçFW‡G2“°§Ó° ¢òò'VÆS¢F†RV&Æ–6F–öâw2&VÂ6öçFVçBÂæf–vF–öâÂ6VBæBW‡FW&–÷"6öçG&7G2&R&÷VæFVBà¦6öç7B7F6¶6†–ä6†V6·2Ò$ÂÓâ°¢6öç7B&ö÷EFƒ×&ö÷C°¢6öç7Bæö÷Ò‚“Óç·ÒÅ3Ô$Âç66VæRÇ&ööÕ&ö÷CÕ2æ7&VFTæöFR‚’ÇF&vWG3ÖæWr6WB‚’ÆW‡FW&–÷#×·f—6–&ÆS§G'VWÒÇvVF†W#×·6†&VC§·7FFS§¶×WFVC§G'VW×ÒÆ–ç6–FS¦fÇ6RÇ6WD–çFW&–÷"†öâ—·F†—2æ–ç6–FSÖöã·×Ó°¢6öç7BÆæCÔ$ÂæG6$vVöw&‡’æ'V–ÆB‚“¶ÆWB&WGW&æVCÖçVÆÃ°¢6öç7B“Ô$ÂæG6$–çFW&–÷'2æ7&VFR‡·&ö÷C§&ööÕ&ö÷BÆW‡FW&–÷"ÆÆæBÇvVF†W"Ç&VÆö6FS§Óç&WGW&æVC×²ââçÒÆÆö6³¦æö÷Æöä6†ævS¦æö÷Ò“°¢’ç&Wf–Wr‚'7F6¶6†–âÖÖv¦–æR"ÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÒÄCÔ$Âç7F6¶6†–äFF°¢6öç7B3Ô$Âæ7&Wræ7&VFR‡·&ö÷C§&ööÕ&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦ãÓçF&vWG2æFB†â’Ç&VÖ÷fS¦ãÓçF&vWG2æFVÆWFR†â—ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¤’æw&÷VæDBÇvÆ¶&ÆS¤’çvÆ¶&ÆRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BÔ2æ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“´2æ6öçG&öÂ„“°¢6öç7B6ÆV#Ò†‚Æ¢Æ'ƒÖ‚Æ'£Ö¢“Óä’çvÆ¶&ÆR†‚Æ¢Æ'‚Æ'¢ÃÄæ&öG”†V–v‡BÄ’Ç7FWÒã#RÆÖ–åƒÒÓRãRÆÖ–å£ÒÓ‚ãRÇsÓ#RÆƒÓC’Ç6VVãÖæWrV–çC„'&’‡r¦‚’ÇVWVSÕµÓ°¢6öç7B–æFWƒÒ‡‚Ç¢“ÓäÖF‚ç&÷VæB‚‡¢ÖÖ–å¢’÷7FW’§r´ÖF‚ç&÷VæB‚‡‚ÖÖ–å‚’÷7FW’Ç7F'CÖ–æFW‚…"ç7vâç‚Å"ç7vâç¢“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—¶6öç7Bã×VWVU¶†VEÒÆ—ƒÖâWrÆ—£ÔÖF‚æfÆö÷"†â÷r’ÇƒÖÖ–å‚¶—‚§7FWÇ£ÖÖ–å¢¶—¢§7FW°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢Æ“Öç¢§r¶çƒ¶–b†çƒÃÇÆçƒã×wÇÆç£ÃÇÆç£ãÖ‡ÇÇ6VVå¶•×ÇÂ6ÆV"‡‚Ç¢Ç‚¶G‚§7FWÇ¢¶G¢§7FW’–6öçF–çVS·6VVå¶•ÓÓ·VWVRçW6‚†’“·×Ð¢6öç7B&V6†&ÆS×Óç¶6öç7B“Ö–æFW‚‡ç‚Çç¢’Æ—ƒÖ’WrÆ—£ÔÖF‚æfÆö÷"†’÷r“¶f÷"†ÆWBGƒÒÓ¶GƒÃÓ¶G‚²²–f÷"†ÆWBG£ÒÓ¶G£ÃÓ¶G¢²²—¶6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G£¶–b†çƒãÓbfçƒÇrbfç£ãÓbfç£Æ‚bg6VVå¶ç¢§r¶ç…Òbf6ÆV"†Ö–å‚¶ç‚§7FWÆÖ–å¢¶ç¢§7FWÇç‚Çç¢’—&WGW&âG'VS·×&WGW&âfÇ6S·Ó°¢6öç7BvöÇ3Õµ"æW†—BÂââå"æ'&÷w6TvöÇ2Âââå"ç6VG2æÖ‡3Óç2çvÆ´B•Ó°¢&V6÷&B‚%7F6¶6†–âæf–vF–öã¢&VÂ–VÆÆ÷r&V6†W2ÆÂ&Wf–Wr&V2ÂWfW'’6VBæBF†RW†—7F–ærW†—B"Æ6ÆV"…"ç7vâç‚Å"ç7vâç¢’bfvöÇ2æWfW'’‡&V6†&ÆR’Ä¥4ôâç7G&–æv–g’‡·&F—W3¤æ&öG•&F—W2ÇVç&V6†&ÆS¦vöÇ2æf–ÇFW"‡Óâ&V6†&ÆR‡’—Ò’“°¢ÆWB6VF–æs×G'VS¶f÷"†6öç7B6VBöb"ç6VG2—´ö&¦V7Bæ76–vâ„ç&ö÷Bç÷6—F–öâÇ·ƒ§6VBçvÆ´Bç‚Ç“¤æ&6U’Ç£§6VBçvÆ´Bç§Ò“´æ†÷Ôæ†÷cÓ·6VF–ærbcÔ2ç6—EÆ–W"‡6VB“´2ç7FVW"‚ãbÃ“´2æÆöö²‡6VBç'’Âã2Ã“´2çWFFR‚ã"Ã“·6VF–ærbcÔæ6×ç6VCÓÓ×6VBbdç&ö÷Bç÷6—F–öâçƒÓÓ×6VBç‚bdç&ö÷Bç÷6—F–öâç£ÓÓ×6VBç£´2ç7FVW"ƒÃ“·6VF–ærbcÔ2ç7FæEÆ–W"‚’bbæ6×ç6VBbb6VBç6—GFW"bf6ÆV"„ç&ö÷Bç÷6—F–öâç‚Äç&ö÷Bç÷6—F–öâç¢“·Ð¢&V6÷&B‚%7F6¶6†–â6VF–æs¢V–v‡B6†&VB6VG27W÷'B÷6RÂÆöö²ÂÖ÷fVÖVçBÆö6²æB6fR7FæB"Ç6VF–ærbe"ç6VG2æÆVæwFƒÓÓÓ‚“°¢6öç7B66W3Õµ³ÃbãRÂ&†öÖR%ÒÅ²Ó‚ÃÂ&'F–6ÆW2%ÒÅ²ÓÃ‚ãRÂ&'F–6ÆW2%ÒÅ³bÂÓ2Â&'F–6ÆW2%ÒÅ³ÂÓBÂ&'F–6ÆW2%ÒÅ³ÃãRÂ'ÆV"ÖÆ÷6÷‡’%ÒÅ³RÃ"Â'7V&Ö—76–öç2%ÒÅ³Ã"Â&æWw6ÆWGFW"%ÒÅ²ÓbÃRÂ&FöæF–öç2%ÒÅ³bÃRÂ&6öçF7B%ÒÅ³’ÂÓBãRÂ'‡—6–6ÂÖ6÷–W2%ÒÅ³ÃBÂ&†öÖR%ÕÓ°¢&V6÷&B‚%7F6¶6†–â6öçFW‡C¢ÆÂFVâ6VÖçF–2&V26VÆV7Böff–6–Â&÷WFW2v—F‚†öÖRfÆÆ&6²æB7V6–f–2&–÷&—G’"Æ66W2æWfW'’‚…·‚Ç¢Ç%Ò“Óç&V6†&ÆR‡·‚Ç§Ò’bd$ÂæG6$ÖVçU¦öæW2ç&W6öÇfR…"Ç·‚Ç§Ò’ç&÷WFSÓÓ×"’Ä¥4ôâç7G&–æv–g’†66W2æÖ‚…·‚Ç¢ÇvçEÒ“Óâ‡·vçBÆv÷C¤$ÂæG6$ÖVçU¦öæW2ç&W6öÇfR…"Ç·‚Ç§Ò’ç&÷WFRÇ&V6†&ÆS§&V6†&ÆR‡·‚Ç§Ò—Ò’’’“°¢ÆWBæöFW3ÓÆf–æ—FS×G'VRÆf6W3Ó¶6öç7BvVöÖWG'“ÖæWr6WB‚“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’—¶vVöÖWG'’æFB†âævVöÖWG'’“¶f–æ—FRbcÖâævVöÖWG'’çfW'G2æWfW'’„çVÖ&W"æ—4f–æ—FR“·Öâæ6†–ÆG&Vâæf÷$V6‚‡f—6—B“·Óµ2çWFFUv÷&ÆB…"ç&ö÷B“·f—6—B…"ç&ö÷B“¶f÷"†6öç7BröbvVöÖWG'’–f6W2³Öræf6W2æÆVæwFƒ°¢&V6÷&B‚%7F6¶6†–â'VFvWC¢66†VBÖv¦–æRöÆ–'&'’ÖW6†W2Âf÷W"v÷&·7FF–öç2Â7FF–267&VVç2æB6—‚Æ–v‡G2"Æf–æ—FRbfæöFW3Ã#3bfvVöÖWG'’ç6—¦SÃ“bff6W3Ã3Sbe"æÆ–v‡F–æræÆ–v‡D6÷VçCÓÓÓbbe"æ6÷VçG2çv÷&·7FF–öç3ÓÓÓBÄ¥4ôâç7G&–æv–g’‡¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG'’ç6—¦RÆf6W2Âââå"æ6÷VçG7Ò’“°¢&V6÷&B‚%7F6¶6†–âVF—F÷&–ÂFF¢&÷VæFVBFFVB'F–6ÆR6VÆV7F–öâv—F‚7GVÂ'–Æ–æW2æBöff–6–ÂgVÆÂ×&VF–ærÆ–æ·2"ÄBæ'F–6ÆW2æÆVæwFƒÓÓÓbbdBæ'F–6ÆW2æWfW'’†ÓæçF—FÆRbfæWF†÷"bbõã##bÓ’ÕÆEÆBBòçFW7B†æFFR’bfç7VÖÖ'’æÆVæwFƒÃ#bfæWrU$Â†çW&Â’æ†÷7FæÖSÓÓÒ'wwrç7F6¶6†–æÖv¦–æRææWB"bd$Âç7F6¶6†–ä'E¶æ'EÒç6÷W&6Rç7F'G5v—F‚‚&‡GG3¢ò÷wwrç7F6¶6†–æÖv¦–æRææWBò"’’bdBæ'F–6ÆW2æÖ†ÓææWF†÷"’æ¦ö–â‚'Â"“ÓÓÒ$GVwÅ7ööæÖçÄçF†öç’b&Gö—6öçÅ&Gö—6öçÅ&Gö—6öçÅ6÷7’"“°¢&V6÷&B‚%7F6¶6†–â‡—6–6Â6÷–W3¢öæÇ’WF†÷&—¦VB6FVv÷'’&öGV7G2ÂW†7BF—7Æ–VB&–6W2æBV&Æ–27Fö6²Æ&VÇ2"ÄBç6†÷6÷W&6SÓÓÒ&‡GG3¢ò÷&ööföf–æ²æ6öÒ÷7F6¶6†–âÖÖv¦–æR"bdBç&öGV7G2æÆVæwFƒÓÓÓ"bdBç&öGV7G2æWfW'’‡ÓææWrU$Â‡çW&Â’æ†÷7FæÖSÓÓÒ'&ööföf–æ²æ6öÒ"bfæWrU$Â‡çW&Â’çF†æÖRç7F'G5v—F‚‚"÷&öGV7Bò"’bbõåÂEÆBµÂåÆEÆBBòçFW7B‡ç&–6R’be²$Æ—7FVBf–Æ&ÆR"Â%&RÖ÷&FW""Â$÷WBöb7Fö6²%Òæ–æ6ÇVFW2‡ç7FGW2’’bdBç&öGV7G5³Òç&–6SÓÓÒ"Cc’ã"bdBç&öGV7G2æf–æB‡Óçæ–CÓÓÒ&6÷’Ó"’çF—FÆSÓÓÒ%&÷FV7F—fRÖv¦–æRF÷ÖÆöFW""“°¢6öç7B6÷W&6S×&VDf–ÆU7–æ2†¦ö–â‡&ö÷EF‚Â'7&2ö§2÷7F6¶6†–âÖÖVçRæ§2"’Â'WFc‚"’·&VDf–ÆU7–æ2†¦ö–â‡&ö÷EF‚Â'7&2ö§2÷7F6¶6†–â×&ööÒæ§2"’Â'WFc‚"“°¢&V6÷&B‚%7F6¶6†–â&—f7“¢'&÷w6RÖöæÇ’Âæò7W7FöÖW"7F÷&vRÂf÷&×2Â6†V6¶÷WBÂG&6¶–ær÷"öÆÆ–ær"ÂöfWF6…Â‡Å„ÔÄ‡GG&WVW7GÆÆö6Å7F÷&vWÇ6W76–öå7F÷&vWÇ6WD–çFW'fÇÆ7&VFTVÆVÖVçEÂ‚"ƒó¦–g&ÖWÆf÷&Ò’"òçFW7B‡6÷W&6R’bdBçvW2æWfW'’‡Óçæ–CÓÓÒ'‡—6–6ÂÖ6÷–W2#÷çW&ÃÓÓÔBç6†÷6÷W&6S¦æWrU$Â‡çW&Â’æ†÷7FæÖSÓÓÒ'wwrç7F6¶6†–æÖv¦–æRææWB"’“°¢ÆWBÆ–fV7–6ÆS×G'VS¶6öç7B6†–ÆG&Vã×&ööÕ&ö÷Bæ6†–ÆG&VâæÆVæwF‚ÆVçG'“Ô’ç&Vv—7G'’ævWB‚'7F6¶6†–âÖÖv¦–æR"’æVçG'“°¢f÷"†ÆWB“Ó¶“Ã¶’²²—¶Æ–fV7–6ÆRbc×vVF†W"æ–ç6–FRbbW‡FW&–÷"çf—6–&ÆRbd’æVF–òç7FG2æ7F—fS´’ç&WVW7B…"æW†—B“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÒ’æ7F—fRbbvVF†W"æ–ç6–FRbfW‡FW&–÷"çf—6–&ÆRbb’æVF–òç7FG2æ7F—fRbb’æVF–òç7FG2æ6öææV7FVBbg&WGW&æVBçƒÓÓÖVçG'’ç‚bg&WGW&æVBç£ÓÓÖVçG'’ç£´’ç&Wf–Wr‚'7F6¶6†–âÖÖv¦–æR"ÇG'VR“´’çWFFR‚ãB“¶Æ–fV7–6ÆRbcÔ’æ7F—fRç&ööÓÓÓÕ"bg&ööÕ&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÖ6†–ÆG&Vã·Ð¢2æF—7÷6R‚“´’æF—7÷6R‚“·&V6÷&B‚%7F6¶6†–âÆ–fV7–6ÆS¢FVâf—6—G2&W6W'fRW‡FW&–÷"&WGW&âæBVF–òvFW2v—F†÷WBw&÷v–ær&ööÒö–çWB&W6÷W&6W2"ÆÆ–fV7–6ÆRbgF&vWG2ç6—¦SÓÓÓbb&ööÕ&ö÷Bæ6†–ÆG&Vâæ–æ6ÇVFW2…"ç&ö÷B’bb’æVF–òç7FG2æ6öçFW‡G2“°§Ó° ¢òò6öçG&7C¢7GVÂ6†&VB6†VÆÂ²Æ§’ÖVçRÆ–fV7–6ÆRÂW6–ærDôÒG&ç7÷'BF÷V&ÆR†æò'&÷w6W"Æ–÷WB6Æ–×2’à¦6öç7BÖVçU6†VÆÄ6†V6·2Ò$ÂÓâ°¢6öç7B¶W—3Õ²&Fö7VÖVçB"Â&–ææW%v–GF‚"Â&–ææW$†V–v‡B"Â'f—7VÅf–Ww÷'B"Â&FDWfVçDÆ—7FVæW""Â'&VÖ÷fTWfVçDÆ—7FVæW"%ÒÇ6fVCÔö&¦V7Bæg&öÔVçG&–W2†¶W—2æÖ†³Óå¶²ÆvÆö&ÅF†—5¶µÕÒ’“°¢6öç7BÆ—7FVæW'3ÖæWrÖ‚’ÇfÆ—7FVæW'3ÖæWrÖ‚’ÆVÆVÖVçG3ÕµÒÆæö÷Ò‚“Óç·Ó°¢6öç7BWfVçD†÷7CÖÖÓâ‡¶FDWfVçDÆ—7FVæW#¢†²Æb“ÓæÖç6WB†²Æb’Ç&VÖ÷fTWfVçDÆ—7FVæW#¦³ÓæÖæFVÆWFR†²—Ò“°¢6öç7BVÆVÖVçC×FsÓç°¢6öç7B6Æ76W3ÖæWr6WB‚’Ç7G–ÆW3ÖæWrÖ‚“°¢6öç7BS×·FrÆ6†–ÆG&Vã¥µÒÆFF6WC§·ÒÆGG&–'WFW3§·ÒÇ7G–ÆS§·6WE&÷W'G“¢†²Çb“Óç7G–ÆW2ç6WB†²Çb’ÆvWE&÷W'G•fÇVS¦³Óç7G–ÆW2ævWB†²—ÒÆ†–FFVã¦fÇ6RÆ–æW'C¦fÇ6RÆ÷Vã¦fÇ6RÇ&VçDVÆVÖVçC¦çVÆÂÇFW‡D6öçFVçC¢""ÆÆ—7FVæW'3¦æWrÖ‚’À¢6Æ74Æ—7C§¶FC¢‚ââçb“Óçbæf÷$V6‚‡ƒÓæ6Æ76W2æFB‡‚’’Ç&VÖ÷fS¢‚ââçb“Óçbæf÷$V6‚‡ƒÓæ6Æ76W2æFVÆWFR‡‚’’Æ6öçF–ç3§cÓæ6Æ76W2æ†2‡b—ÒÀ¢6WDGG&–'WFR†²Çb—·F†—2æGG&–'WFW5¶µÓ×c·ÒÇ&VÖ÷fTGG&–'WFR†²—¶FVÆWFRF†—2æGG&–'WFW5¶µÓ·ÒÆVæD6†–ÆB†2—¶2ç&VçDVÆVÖVçC×F†—3·F†—2æ6†–ÆG&VâçW6‚†2“·&WGW&â3·ÒÆVæB‚ââçb—·bæf÷$V6‚‡ƒÓçF†—2æVæD6†–ÆB‡‚’“·ÒÇ&WÆ6T6†–ÆG&Vâ‚—·F†—2æ6†–ÆG&Vâæf÷$V6‚†3Óæ2ç&VçDVÆVÖVçCÖçVÆÂ“·F†—2æ6†–ÆG&VãÕµÓ·ÒÀ¢6öçF–ç2†â—¶f÷"ƒ¶ã¶ãÖâç&VçDVÆVÖVçB––b†ãÓÓ×F†—2—&WGW&âG'VS·&WGW&âfÇ6S·ÒÆ6Æ÷6W7B‡—¶–b‡ÓÓÒ&'WGFöâ"—&WGW&âF†—2çFsÓÓÒ&'WGFöâ#÷F†—3§F†—2ç&VçDVÆVÖVçCòæ6Æ÷6W7B‡“¶–b‡ÓÓÒ%¶†–FFVåÒ"—&WGW&âF†—2æ†–FFVã÷F†—3§F†—2ç&VçDVÆVÖVçCòæ6Æ÷6W7B‡“·&WGW&âçVÆÃ·ÒÀ¢VW'•6VÆV7F÷$ÆÂ‡—¶6öç7B÷WCÕµÓ¶6öç7BvÆ³ÖãÓç¶f÷"†6öç7B2öbâæ6†–ÆG&Vâ—¶–b‡æ–æ6ÇVFW2†2çFr’–÷WBçW6‚†2“·vÆ²†2“·×Ó·vÆ²‡F†—2“·&WGW&â÷WC·ÒÇVW'•6VÆV7F÷"‡—·&WGW&âF†—2çVW'•6VÆV7F÷$ÆÂ‡•³×ÇÆçVÆÃ·ÒÀ¢vWD6Æ–VçE&V7G3¢‚“Óå··ÕÒÆfö7W2‚—¶Fö7VÖVçBæ7F—fTVÆVÖVçC×F†—3·ÒÇ6†÷tÖöFÂ‚—·F†—2æ÷Vã×G'VS·ÒÆ6Æ÷6R‚—·F†—2æ÷VãÖfÇ6S·ÒÇ&VÖ÷fR‚—¶–b‡F†—2ç&VçDVÆVÖVçB—F†—2ç&VçDVÆVÖVçBæ6†–ÆG&Vã×F†—2ç&VçDVÆVÖVçBæ6†–ÆG&Vâæf–ÇFW"†ãÓæâÓ×F†—2“·F†—2ç&VçDVÆVÖVçCÖçVÆÃ·ÒÀ¢FDWfVçDÆ—7FVæW"†²Æb—·F†—2æÆ—7FVæW'2ç6WB†²Æb“·ÒÇ&VÖ÷fTWfVçDÆ—7FVæW"†²—·F†—2æÆ—7FVæW'2æFVÆWFR†²“·ÒÆvWB—46öææV7FVB‚—·&WGW&âF†—3ÓÓÖFö7VÖVçBæ&öG—ÇÂF†—2ç&VçDVÆVÖVçC·Ð¢Ó¶VÆVÖVçG2çW6‚†R“·&WGW&âS°¢Ó°¢6öç7B&öG“ÖVÆVÖVçB‚&&öG’"’Çv÷&ÆCÖVÆVÖVçB‚&Ö–â"’ÇG&–vvW#ÖVÆVÖVçB‚&'WGFöâ"“·v÷&ÆBæVæB‡G&–vvW"“¶&öG’æVæB‡v÷&ÆB“°¢vÆö&ÅF†—2æFö7VÖVçC×¶&öG’Æ7&VFTVÆVÖVçC¦VÆVÖVçBÆ7F—fTVÆVÖVçC§G&–vvW"ÂââæWfVçD†÷7B†Æ—7FVæW'2—Ó°¢vÆö&ÅF†—2æ–ææW%v–GFƒÓCC¶vÆö&ÅF†—2æ–ææW$†V–v‡CÓ“¶vÆö&ÅF†—2çf—7VÅf–Ww÷'C×·v–GFƒ£CCÆ†V–v‡C£“Æöfg6WDÆVgC£Æöfg6WEF÷£ÂââæWfVçD†÷7B‡fÆ—7FVæW'2—Ó°¢6öç7Bv–æF÷tÆ—7FVæW'3ÖæWrÖ‚“´ö&¦V7Bæ76–vâ†vÆö&ÅF†—2ÆWfVçD†÷7B‡v–æF÷tÆ—7FVæW'2’“°¢G'—°¢ÆWBæ÷F–6W3Ó¶6öç7BÓÔ$ÂæÖVÖTf7F÷'”ÖVçRæ7&VFR‡¶öä÷Vã¢‚“Óææ÷F–6W2²·Ò“´ÒæVçFW"‚“°¢ÆWB&÷WFW3×G'VRÆ—6öÆFVC×G'VRÇ÷6—F–öç3×G'VS¶6öç7B–æ—F–ÃÕ²&†öÖR"Â&Æ6W""Â&6öçG&–'WF÷'2"Â'–VÆÆ÷r"Â'öF67B"Â&–çfÆ–B%Ó°¢f÷"†ÆWB“Ó¶“Ã#¶’²²—°¢6öç7B&÷WFSÖ–æ—F–Å¶’V–æ—F–ÂæÆVæwF…Ó´Òæ÷Vâ‡&÷WFR“¶6öç7BæVÃÖ&öG’æ6†–ÆG&Vâæf–æB†ãÓæâçFsÓÓÒ&F–Æör"“·&÷WFW2bcÔÒç7FG2ç&÷WFSÓÓÒ‡&÷WFSÓÓÒ&–çfÆ–B#ò&†öÖR#§&÷WFR“¶—6öÆFVBbc×v÷&ÆBæ–æW'Bbd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓbf&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"ÖÖVçRÖ÷Vâ"“°¢f÷"†6öç7B·v–GF‚Æ†V–v‡EÒöbµ³CCÃ“ÒÅ³3“ÃƒCEÒÅ³ƒCBÃ3“ÕÒ—´ö&¦V7Bæ76–vâ‡f—7VÅf–Ww÷'BÇ·v–GF‚Æ†V–v‡BÆöfg6WEF÷£‚Æöfg6WDÆVgC£'Ò“·fÆ—7FVæW'2ævWB‚'&W6—¦R"’‚“·÷6—F–öç2bc×æVÂç7G–ÆRævWE&÷W'G•fÇVR‚"ÒÖÖVçR×‚"“ÓÓÒ‡v–GF‚ó"³"’²'‚"bgæVÂç7G–ÆRævWE&÷W'G•fÇVR‚"ÒÖÖVçR×’"“ÓÓÒ††V–v‡Bó"³‚’²'‚#·Ð¢òòæf–vF–öâ—2g&VRgFW"‡—6–6ÂVçG'“²âÇ&VG’Ö÷Vâ6ÆÂ6ææ÷BÖ÷fRF†RvR&V†–æBF†RW6W"à¢6öç7Bæc×æVÂæ6†–ÆG&Vâæf–æB†ãÓæâçFsÓÓÒ&æb"’Æ'WGFöãÖæbæ6†–ÆG&Vâæf–æB†ãÓæâæFF6WBç&÷WFSÓÓÒ&6öçG&–'WF÷'2"“·æVÂæÆ—7FVæW'2ævWB‚&6Æ–6²"’‡·F&vWC¦'WGFöçÒ“´Òæ÷Vâ‚&†öÖR"“·&÷WFW2bcÔÒç7FG2ç&÷WFSÓÓÒ&6öçG&–'WF÷'2#°¢Òæ6Æ÷6R‚“¶—6öÆFVBbcÒv÷&ÆBæ–æW'Bbd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓbb&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"ÖÖVçRÖ÷Vâ"’bfFö7VÖVçBæ7F—fTVÆVÖVçCÓÓ×G&–vvW"bfÆ—7FVæW'2ç6—¦SÓÓÓbgfÆ—7FVæW'2ç6—¦SÓÓÓbgv–æF÷tÆ—7FVæW'2ç6—¦SÓÓÓ°¢ÒæÆVfR‚“´ÒæVçFW"‚“·&÷WFW2bcÔÒç7FG2ç&÷WFSÓÓÒ&†öÖR#°¢Ð¢&V6÷&B‚$E4"6†VÆÃ¢f—7VÂ×f–Ww÷'B6ö÷&F–æFW2föÆÆ÷rFW6·F÷Â÷'G&—BÂÆæG66RæBöfg6WG2"Ç÷6—F–öç2“°¢&V6÷&B‚$E4"6†VÆÃ¢GvVÇfR÷Væ–æw2—6öÆFRv÷&ÆBÂ&W7F÷&Rfö7W2æBÆVfRæòÆ—7FVæW'2÷6†FW2"Æ—6öÆFVBbfæ÷F–6W3ÓÓÓ#Bbf&öG’æ6†–ÆG&VâæÆVæwFƒÓÓÓ"“°¢&V6÷&B‚$ÖVÖRÖVçS¢g&W6‚6öçFW‡BÂF—&V7BW'6öâ&–÷&—G’Âg&VRæf–vF–öâæBW†—B&W6WB"Ç&÷WFW2“°¢6öç7BFW7F–æF–öç3Ô$ÂæÖVÖTf7F÷'”FF·&V6÷&B‚$ÖVÖR6÷W&6W3¢GvVÇfR&VÂV&Æ–2&öf–ÆW2Âöff–6–ÂÆ—7FVæ–ærÆ–æ·2æB6÷W&6VBÆ6W"†—7F÷'’"ÆFW7F–æF–öç2æ6öçG&–'WF÷'2æÆVæwFƒÓÓÓ"bfFW7F–æF–öç2æ6öçG&–'WF÷'2æWfW'’‡Óâõæ‡GG3¥ÂõÂ÷wwræÖVÖVf7F÷'—FÒæ6öÕÂòòçFW7B‡çW&Â’bgæ–ÖvRç7F'G5v—F‚‚&FF¦–ÖvRö§Vr"’’bfFW7F–æF–öç2æ†—7F÷'’æ–æ6ÇVFW2‚&¶æ÷w–÷W&ÖVÖRæ6öÒöÖVÖW2öÆ6W"ÖW–W2Ö&—F6ö–â×G&VæBÖÆ6W'&—VçF–Ã²"’bfFW7F–æF–öç2æÆ–æ·2æÆVæwFƒãÓb“°¢ÒæF—7÷6R‚“·&V6÷&B‚$ÖVÖRÖVçS¢Æ§’6–ævÆWFöâF—7÷6Â&VÆV6W2ÆÂ†æFÆW'2æBæVÂ"Æ&öG’æ6†–ÆG&VâæÆVæwFƒÓÓÓbfVÆVÖVçG2æWfW'’†SÓâRæÆ—7FVæW'2ç6—¦R’bd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓ“°¢6öç7BÔ$Âç7F6¶6†–äÖVçRæ7&VFR‚“¶ÆWBö¶“Òæ÷Vâ‚’Ç6V&6ƒ×G'VSµæVçFW"‚“°¢f÷"†ÆWB“Ó¶“Ã#¶’²²—°¢6öç7B&÷WFSÔ$Âç7F6¶6†–äFFçvW5¶’S•Òæ–Cµæ÷Vâ‡&÷WFR“¶6öç7BæVÃÖ&öG’æ6†–ÆG&Vâæf–æB†ãÓæâçFsÓÓÒ&F–Æör"’Ææc×æVÂæ6†–ÆG&Vâæf–æB†ãÓæâçFsÓÓÒ&æb"“°¢ö¶’bcÕç7FG2ç&÷WFSÓÓ×&÷WFRbgv÷&ÆBæ–æW'Bbd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓ·æVÂæÆ—7FVæW'2ævWB‚&6Æ–6²"’‡·F&vWC¦æbæ6†–ÆG&Vâæf–æB†ãÓæâæFF6WBç&÷WFSÓÓÒ&'F–6ÆW2"—Ò“°¢6öç7B–çWC×æVÂçVW'•6VÆV7F÷$ÆÂ‚&–çWB"’æf–æB†ãÓæâçFsÓÓÒ&–çWB"“¶–çWBçfÇVSÒ%7ööæÖâ#·æVÂæÆ—7FVæW'2ævWB‚&–çWB"’‡·F&vWC¦–çWGÒ“·6V&6‚bc×æVÂçVW'•6VÆV7F÷$ÆÂ‚&'F–6ÆR"’æf–ÇFW"†ãÓæâçFsÓÓÒ&'F–6ÆR"’æÆVæwFƒÓÓÓ°¢–çWBçfÇVSÒ&æò×7V6‚ÖWF†÷"#·æVÂæÆ—7FVæW'2ævWB‚&–çWB"’‡·F&vWC¦–çWGÒ“·6V&6‚bc×æVÂçVW'•6VÆV7F÷$ÆÂ‚&'F–6ÆR"’æf–ÇFW"†ãÓæâçFsÓÓÒ&'F–6ÆR"’æÆVæwFƒÓÓÓ°¢æVÂæÆ—7FVæW'2ævWB‚&6Æ–6²"’‡·F&vWC¦æbæ6†–ÆG&Vâæf–æB†ãÓæâæFF6WBç&÷WFSÓÓÒ'‡—6–6ÂÖ6÷–W2"—Ò“°¢6öç7BÆ–æ·3×æVÂçVW'•6VÆV7F÷$ÆÂ‚&"“¶ö¶’bcÖÆ–æ·2æÆVæwFƒÓÓÓ2bfÆ–æ·2æWfW'’†Óææ‡&Vbç7F'G5v—F‚‚&‡GG3¢ò÷&ööföf–æ²æ6öÒò"’bfçF&vWCÓÓÒ%ö&Ææ²"bfç&VÃÓÓÒ&æö÷VæW"æ÷&VfW'&W""“°¢æ÷Vâ‚&†öÖR"“¶ö¶’bcÕç7FG2ç&÷WFSÓÓÒ'‡—6–6ÂÖ6÷–W2#µæÆVfR‚“¶ö¶’bcÒv÷&ÆBæ–æW'Bbeç7FG2ç&÷WFSÓÓÒ&†öÖR"beç7FG2çVW'“ÓÓÒ""bd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓbfÆ—7FVæW'2ç6—¦SÓÓÓbgfÆ—7FVæW'2ç6—¦SÓÓÓµæVçFW"‚“°¢Ð¢æ÷Vâ‚'Vç7W÷'FVB"“¶ö¶’bcÕç7FG2ç&÷WFSÓÓÒ&†öÖR#µæF—7÷6R‚“°¢&V6÷&B‚%7F6¶6†–âÖVçS¢'F–6ÆR6V&6‚æBV×G’&W7VÇG2÷fW"&÷VæFVBF—FÆW2Â'–Æ–æW2æB7VÖÖ&–W2"Ç6V&6‚“°¢&V6÷&B‚%7F6¶6†–âÖVçS¢GvVÇfRf—6—G2Âg&VR'&÷w6–ærÂ6fR&öGV7BÆ–æ·2Â†öÖR&W6WBæB6ö×ÆWFRÆ—7FVæW"F—7÷6Â"Æö¶’bf&öG’æ6†–ÆG&VâæÆVæwFƒÓÓÓbfVÆVÖVçG2æWfW'’†SÓâRæÆ—7FVæW'2ç6—¦R’bbv–æF÷tÆ—7FVæW'2ç6—¦R“° ¢Öf–æÆÇ—¶f÷"†6öç7B¶²ÇeÒöbö&¦V7BæVçG&–W2‡6fVB’–vÆö&ÅF†—5¶µÓ×c·Ð§Ó° ¦6öç7BVæ—D6†V6·2Ò7–æ2‚’Óâ°¢6öç7B6çf57GV"Ò‚’Óâ‡°¢v–GFƒ¢Â†V–v‡C¢À¢vWD6öçFW‡C¢‚’Óâ‡°¢6çf3¢çVÆÂÂf–ÆÅ&V7B‚’·ÒÂ6ÆV%&V7B‚’·ÒÂG&t–ÖvR‚’·ÒÂ6fR‚’·ÒÂ&W7F÷&R‚’·ÒÀ¢6WEG&ç6f÷&Ò‚’·ÒÂG&ç6ÆFR‚’·ÒÂ66ÆR‚’·ÒÂ&Vv–åF‚‚’·ÒÂÖ÷fUFò‚’·ÒÂÆ–æUFò‚’·ÒÀ¢6Æ÷6UF‚‚’·ÒÂf–ÆÂ‚’·ÒÂ7G&ö¶R‚’·ÒÂ&2‚’·ÒÂ&V7B‚’·ÒÂ6Æ—‚’·ÒÀ¢ÖV7W&UFW‡C¢‚’Óâ‡²v–GFƒ¢Ò’Âf–ÆÅFW‡B‚’·ÒÂ7G&ö¶UFW‡B‚’·ÒÂ7&VFTÆ–æV$w&F–VçC¢‚’Óâ‡²FD6öÆ÷%7F÷‚’·ÒÒ’À¢vWD–ÖvTFF¢‡‚Â’ÂrÂ‚’Óâ‡²FF¢æWrV–çC„6Æ×VD'&’„ÖF‚æÖ‚ƒÂr¢‚¢B’’Âv–GFƒ¢rÂ†V–v‡C¢‚Ò’À¢WD–ÖvTFF‚’·ÒÂ7&VFT–ÖvTFF¢‡rÂ‚’Óâ‡²FF¢æWrV–çC„6Æ×VD'&’„ÖF‚æÖ‚ƒÂr¢‚¢B’’Âv–GFƒ¢rÂ†V–v‡C¢‚Ò¢Ò¢Ò“°¢6öç7BVÂÒ‚’Óâ‡°¢7G–ÆS¢·ÒÂFF6WC¢·ÒÂ6Æ74Æ—7C¢²FB‚’·ÒÂ&VÖ÷fR‚’·ÒÂFövvÆR‚’·ÒÂ6öçF–ç3¢‚’ÓâfÇ6RÒÀ¢6†–ÆG&Vã¢µÒÂf—'7DVÆVÖVçD6†–ÆC¢çVÆÂÂFW‡D6öçFVçC¢""Â†–FFVã¢fÇ6RÀ¢VæD6†–ÆB†2’²F†—2æ6†–ÆG&VâçW6‚†2“²&WGW&â3²ÒÂVæB‚’·ÒÂ&WÆ6T6†–ÆG&Vâ‚’·ÒÀ¢6WDGG&–'WFR‚’·ÒÂ&VÖ÷fTGG&–'WFR‚’·ÒÂvWDGG&–'WFS¢‚’ÓâçVÆÂÂFDWfVçDÆ—7FVæW"‚’·ÒÀ¢&VÖ÷fTWfVçDÆ—7FVæW"‚’·ÒÂVW'•6VÆV7F÷#¢‚’ÓâçVÆÂÂVW'•6VÆV7F÷$ÆÃ¢‚’ÓâµÒÂ&VÖ÷fR‚’·ÒÀ¢vWD&÷VæF–æt6Æ–VçE&V7C¢‚’Óâ‡²ÆVgC¢ÂF÷¢Âv–GFƒ¢ƒÂ†V–v‡C¢cÒ’Âfö7W2‚’·ÒÂ&ÇW"‚’·Ð¢Ò“°¢vÆö&ÅF†—2çv–æF÷rÒvÆö&ÅF†—3°¢vÆö&ÅF†—2ç6VÆbÒvÆö&ÅF†—3°¢vÆö&ÅF†—2æFö7VÖVçBÒ°¢7&VFTVÆVÖVçC¢‡Fr’Óâ‡FrÓÓÒ&6çf2"òö&¦V7Bæ76–vâ†VÂ‚’Â6çf57GV"‚’’¢VÂ‚’’À¢7&VFTVÆVÖVçDå3¢‚’ÓâVÂ‚’À¢vWDVÆVÖVçD'”–C¢‚’ÓâVÂ‚’À¢VW'•6VÆV7F÷#¢‚’ÓâçVÆÂÀ¢VW'•6VÆV7F÷$ÆÃ¢‚’ÓâµÒÀ¢FDWfVçDÆ—7FVæW"‚’·ÒÂ&VÖ÷fTWfVçDÆ—7FVæW"‚’·ÒÀ¢Fö7VÖVçDVÆVÖVçC¢VÂ‚’Â&öG“¢VÂ‚’À¢vWDVÆVÖVçG4'•FtæÖS¢‚’ÓâµÐ¢Ó°¢vÆö&ÅF†—2æÆö6F–öâÒ²6V&6ƒ¢""ÂF†æÖS¢"ò"Â&WÆ6R‚’·ÒÓ°¢vÆö&ÅF†—2æÆö6Å7F÷&vRÒ²vWD—FVÓ¢‚’ÓâçVÆÂÂ6WD—FVÒ‚’·ÒÂ&VÖ÷fT—FVÒ‚’·ÒÓ°¢vÆö&ÅF†—2æÖF6„ÖVF–Ò‚’Óâ‡²ÖF6†W3¢fÇ6RÂFDWfVçDÆ—7FVæW"‚’·ÒÂ&VÖ÷fTWfVçDÆ—7FVæW"‚’·ÒÒ“°¢vÆö&ÅF†—2ç&WVW7Dæ–ÖF–öäg&ÖRÒ‚’Óâ°¢vÆö&ÅF†—2æ6æ6VÄæ–ÖF–öäg&ÖRÒ‚’Óâ·Ó°¢vÆö&ÅF†—2æFWf–6U—†VÅ&F–òÒ°¢vÆö&ÅF†—2æFDWfVçDÆ—7FVæW"Ò‚’Óâ·Ó°¢vÆö&ÅF†—2ç&VÖ÷fTWfVçDÆ—7FVæW"Ò‚’Óâ·Ó°¢–b‚vÆö&ÅF†—2æ7'—Fò’ö&¦V7BæFVf–æU&÷W'G’†vÆö&ÅF†—2Â&7'—Fò"Â²fÇVS¢²vWE&æFöÕfÇVW3¢†’Óâæf–ÆÂƒ’ÒÒ“° ¢6öç7B÷&FW"Ò²ââç&VDf–ÆU7–æ2†¦ö–â‡&ö÷BÂ'7&2ö–æFW‚æ‡FÖÂ"’Â'WFc‚"’æÖF6„ÆÂ‚óÇ67&—B7&3Ò&§5Âò…µâ%Ò²’#ãÅÂ÷67&—Câör•ÒæÖ‚†Ò’ÓâÕ³Ò“°¢6öç7B6¶—VBÒµÓ°¢f÷"†6öç7Bf–ÆRöb÷&FW"’°¢G'’°¢æWrgVæ7F–öâ‡&VDf–ÆU7–æ2†¦ö–â‡&ö÷BÂ'7&2ö§2"Âf–ÆR’Â'WFc‚"’’‚“°¢Ò6F6‚†W'"’°¢6¶—VBçW6‚†G¶f–ÆWÓ¢Gµ7G&–ær†W'"æÖW76vR’ç6Æ–6RƒÂ#—Ö“°¢Ð¢Ð¢6öç7B$ÂÒvÆö&ÅF†—2ä$Ã°¢–b„$u2æ–æ6ÇVFW2‚'vFW"Ö&6VÆ–æR"’—°¢–b‚&ö6W72æVçbäE4%ô$4TÄ”äR—F‡&÷rW'&÷"‚%&÷f–FRF†RVæÖöF–f–VB6†V6·ö–çB6÷W&6RF—&V7F÷'’"“°¢f÷"†6öç7BæÖRöb²&G6"ÖvVöw&‡’æ§2"Â&G6"ÖöÇ–×W2æ§2"Â&G6"×vFW"æ§2%Ò–æWrgVæ7F–öâ‡&VDf–ÆU7–æ2†¦ö–â‡&ö6W72æVçbäE4%ô$4TÄ”äRÆæÖR’Â'WFc‚"’’‚“°¢6öç7Bs×vFW%v÷&ÆB„$Â“¶6öç6öÆRæÆör„¥4ôâç7G&–æv–g’‡vFW$vöÆFVâ…r’’“µræF—7÷6R‚“·&WGW&ã°¢Ð¢–b„$u2æ–æ6ÇVFW2‚'vFW"×&Wf–Wr"’—°¢–b‚&ö6W72æVçbåtDU%ô4åd2—F‡&÷rW'&÷"‚%&÷f–FRtDU%ô4åd2f÷"öffÆ–æR&VæFW"W‡÷'B"“°¢6öç7B¶7&VFT6çf7ÓÖv—B–×÷'B‡&ö6W72æVçbåtDU%ô4åd2’ÆöÆD7&VFSÖFö7VÖVçBæ7&VFTVÆVÖVçC°¢Fö7VÖVçBæ7&VFTVÆVÖVçC×FsÓçFsÓÓÒ&6çf2#ö7&VFT6çf2ƒÃ“¦öÆD7&VFR‡Fr“°¢6öç7Bs×vFW%v÷&ÆB„$Â’Ä“Ô$ÂæG6%vFW$–çFW&7F–öâæ7&VFR…r’ÄÕræfF"Æ6çf3Ö7&VFT6çf2ƒ#ƒÃƒ’Ç&VæFW&W#Ô$Âæ6çf5&VæFW&W"æ7&VFU&VæFW&W"†6çf2Ç·v–GFƒ£#ƒÆ†V–v‡C£ƒÒ“°¢rç&VæFW&W"æ¶–æCÒ&6çf3&B#°¢6öç7B÷WCÖ¦ö–â‡&ö÷BÂ'VçG&6¶VB÷vFW"×&Wf–Wr"“¶Ö¶F—%7–æ2†÷WBÇ·&V7W'6—fS§G'VWÒ“°¢6öç7B÷G3Ô$Âç66VæW2æG6"ç&VæFW$÷G2Ç&÷w3ÕµÓ°¢f÷"†6öç7B¶æÖRÇ&F–õÒöbµ²&G'’"ÂÒã3UÒÅ²&æ¶ÆR"Âã%ÒÅ²&¶æVR"Âã5ÒÅ²'v—7B"ÂãUÒÅ²&6†W7B"ÂãuÒÅ²&†VB"ÂãƒUÒÅ²'7v6‚"ÃÕÒ—°¢ÆWBÆóÓc’Æ†“Ó“c¶f÷"†ÆWB“Ó¶“Ã3¶’²²—¶6öç7B£Ò†Æò¶†’’ó#¶–b‚Òã2ÕræÆæBæ†V–v‡DBƒ#Ç¢“Ç&F–ò¤æ&öG”†V–v‡B–Æó×£¶VÇ6R†“×£·×&÷w2çW6‚‡¶æÖRÇƒ£#Ç£¢†Æò¶†’’ó"Ç–s¤ÖF‚å’ÆF—7C£wÒ“°¢Ð¢&÷w2çW6‚‡¶æÖS¢'&ö6·2"Çƒ£s2Ç££C2Ç–s¢ÓãÆF—7C£ÒÇ¶æÖS¢&†&&÷""Çƒ¢Ó3’Ç££C"Ç–s¤ÖF‚å’ÆF—7C£wÒ“°¢&÷w2çW6‚‡¶æÖS¢'–W"×vW7B"Çƒ¢ÓC2Ç££CbÇ–s¤ÖF‚å’ÆF—7C£gÒÇ¶æÖS¢'–W"ÖV7B"Çƒ¢Ó3BÇ££CbÇ–s¤ÖF‚å’ÆF—7C£gÒÇ¶æÖS¢&†&&÷"Öæ–v‡B"Çƒ¢Ó3’Ç££C"Ç–s¢ãRÆF—7C£#rÆ†÷W#£#7Ò“°¢f÷"†6öç7B¶æÖRÆ’Æ†÷W%Òöbµ²&fÆÇ2"ÃÃ%ÒÅ²'ööÂ"ÃÃ%ÒÅ²&fÆÇ2Öæ–v‡B"ÃÃ#5ÒÅ²&fÆÇ2ÖvöÆFVâ"ÃÃ…ÒÅ²&fÆÇ2×7F÷&Ò"ÃÃ%ÕÒ—¶6öç7BcÕræöÇ–×W2æ–×7G5¶•Ó·&÷w2çW6‚‡¶æÖRÇƒ¦bç‚³BÇ£¦bç¢³BÇ–s£ÆF—7C£"Æ†÷W'Ò“·Ð¢f÷"†6öç7B&÷röb&÷w2—°¢6öç7B“Õræw&÷VæB‡&÷rç‚Ç&÷rç¢“µræ7&Wrç&VÆö6FUÆ–W"‡·ƒ§&÷rç‚Ç’Ç£§&÷rç§ÒÃ“°¢ö&¦V7Bæ76–vâ…ræ6ÖW&ç÷6—F–öâÇ·ƒ§&÷rç‚´ÖF‚ç6–â‡&÷rç–r’§&÷ræF—7BÇ“¤ÖF‚æÖ‚ƒ"Ç’³R’Ç£§&÷rç¢´ÖF‚æ6÷2‡&÷rç–r’§&÷ræF—7GÒ“°¢ö&¦V7Bæ76–vâ…ræ6ÖW&çF&vWBÇ·ƒ§&÷rç‚Ç“§’²ãRÇ£§&÷rç§Ò“µræ6ÖW&æf#Óƒ°¢–b‡&÷rææÖRç7F'G5v—F‚‚&fÆÇ2"—ÇÇ&÷rææÖSÓÓÒ'ööÂ"—°¢6öç7BcÕræöÇ–×W2æ–×7G5·&÷rææÖSÓÓÒ'ööÂ#ó£Ó´ö&¦V7Bæ76–vâ…ræ6ÖW&çF&vWBÇ·ƒ¦bç‚Ç“¦bç’³"Ç£¦bç§Ò“´ö&¦V7Bæ76–vâ…ræ6ÖW&ç÷6—F–öâÇ·ƒ¦bç‚Ó2Ç“¦bç’³BÇ£¦bç¢³‡Ò“°¢Ð¢$ÂæF–Æ–v‡Bç6×ÆR‡&÷ræ†÷W'ÇÃ"Æ÷G2ÃƒÃ3r“´$ÂæG6$FÖ÷7†W&RæÆ–v‡B†÷G2“°¢–b‡&÷rææÖRæ–æ6ÇVFW2‚'7F÷&Ò"’—¶÷G2æF—&V7E7G&VæwF‚£Òãƒ¶f÷"†ÆWB³Ó¶³Ã3¶²²²—¶÷G2ç6·•¶µÒ£ÒãC¶÷G2æ†÷&—¦öå¶µÒ£ÒãC¶÷G2ç¦Væ—F…¶µÒ£ÒãC·×Ð¢rææGW&RçWFFRƒÃ2“µræVç&–6†ÖVçBçWFFRƒ2Æ÷G2æÆ×f7F÷"“µræFWF–ÂçWFFR†÷G2æÆ×f7F÷"“µræöÇ–×W2çWFFR‚ã"Æ÷G2æÆ×f7F÷"“°¢’æ6ÆV"‚“´’çWFFR‚ã"Ã2Ä“´’æVÖ—B‡&÷rç‚ÂÒã2Ç&÷rç¢ÂãBÂãrÃ"“´’çWFFR‚ã3RÃ2ã3RÄ“µrçvFW"çWFFRƒ2“°¢&VæFW&W"ç&VæFW"…rç&ö÷BÅræ6ÖW&Æ÷G2“·w&—FTf–ÆU7–æ2†¦ö–â†÷WBÇ&÷rææÖR²"çær"’Æ6çf2çFô'VffW"‚&–ÖvR÷ær"’“°¢Ð¢&VæFW&W"æF—7÷6R‚“´’æF—7÷6R‚“µræF—7÷6R‚“¶Fö7VÖVçBæ7&VFTVÆVÖVçCÖöÆD7&VFS¶6öç6öÆRæÆör‚$W‡÷'FVB"·&÷w2æÆVæwF‚²"7GVÂ6çf2vFW"&Wf–Wrf–Ww2Fò"¶÷WB“·&WGW&ã°¢Ð¢–b„$u2æ–æ6ÇVFW2‚'÷'FÂ×Væ—B"’—·÷'FÄ6†V6·2„$ÂÆVÂ“·&WGW&ã·Ð¢–b„$u2æ–æ6ÇVFW2‚'vFW"×Væ—B"’—¶v—B6†÷&VÆ–æT†&æW746†V6·2‚“·vFW$6†V6·2„$Â“·&WGW&ã·Ð¢òòöffÆ–æRf—7VÂW‡÷'BF‡&÷Vv‚F†R7GVÂ6çf2&VæFW&W"v†VâF†—2v÷&·76R6ææ÷B7F'B6‡&öÖRà¢òòFFW"—27WÆ–VB'’F†R&Wf–WrVçf—&öæÖVçC²—B—2æWfW"&öGV7F–öâ÷6¶vRFWVæFVæ7’à¢–b„$u2æ–æ6ÇVFW2‚'7F6¶6†–â×&Wf–Wr"’—°¢–b‚&ö6W72æVçbå5D4´4„”åô4åd2—F‡&÷rW'&÷"‚%6WB5D4´4„”åô4åd2Fò6çf2$BFFW"ÖöGVÆRf÷"öffÆ–æR&Wf–Wr"“°¢6öç7B¶7&VFT6çf7ÓÖv—B–×÷'B‡&ö6W72æVçbå5D4´4„”åô4åd2’ÆöÆD7&VFSÖFö7VÖVçBæ7&VFTVÆVÖVçC°¢Fö7VÖVçBæ7&VFTVÆVÖVçC×FsÓçFsÓÓÒ&6çf2#ö7&VFT6çf2ƒÃ“¦öÆD7&VFR‡Fr“°¢6öç7B3Ô$Âç66VæRÇ66VæU&ö÷CÕ2æ7&VFTæöFR‚’Å#Ô$Âç7F6¶6†–å&ööÒæ'V–ÆB‚’Ææö÷Ò‚“Óç·Ó°¢"ç&ö÷Bçf—6–&ÆS×G'VSµ2æFD6†–ÆB‡66VæU&ö÷BÅ"ç&ö÷B“°¢6öç7B7&WsÔ$Âæ7&Wræ7&VFR‡·&ö÷C§66VæU&ö÷BÇv÷&ÆC§¶ÆWfVÃ£ÒÇÆ–W$æÖS¢%–VÆÆ÷t'&ö¶T—B"Æ–çWC§¶FC¦æö÷Ç&VÖ÷fS¦æö÷ÒÆ‡VC§·6WE&÷7FW%&÷s¦æö÷ÒÆvÖS§·7FFS§¶76–væÖVçG3§·ÒÆ–çfVçF÷'“¥µ××ÒÇf–Wu–s£Æw&÷VæDC¢‚“ÓãÇvÆ¶&ÆS¢‚“ÓçG'VRÆgƒ§·6“¦æö÷Ç§§¤C¦æö÷Æ'W'7C¦æö÷ÇVfc¦æö÷Ç7vå'F–6ÆS¦æö÷ÆFÖvTçVÖ&W#¦æö÷×Ò“°¢6öç7BfF#Ö7&Wræ6fVÖVâævWB‚%–VÆÆ÷t'&ö¶T—B"“¶7&Wræ6öçG&öÂ†fF"“°¢6öç7B6çf3Ö7&VFT6çf2ƒCCÃ“’Ç&VæFW&W#Ô$Âæ6çf5&VæFW&W"æ7&VFU&VæFW&W"†6çf2Ç·v–GFƒ£CCÆ†V–v‡C£“Ò’Æ6ÖW&Õ2æ7&VFT6ÖW&‡¶f÷c£SbÆæV#¢ãÆf#£Ò’Æ÷WCÖ¦ö–â‡&ö÷BÂ'VçG&6¶VB÷7F6¶6†–â×&Wf–Wr"“¶Ö¶F—%7–æ2†÷WBÇ·&V7W'6—fS§G'VWÒ“°¢f÷"†6öç7B¶æÖRÇ÷6UÒöbö&¦V7BæVçG&–W2…"ç&Wf–Ww2’—°¢6öç7B×÷6Rç÷6—F–öã´ö&¦V7Bæ76–vâ†fF"ç&ö÷Bç÷6—F–öâÇ·ƒ§ç‚Ç“¦fF"æ&6U’Ç£§ç§Ò“¶fF"ç&ö÷Bç&÷FF–öâç“×÷6Rç–r´ÖF‚å“°¢ö&¦V7Bæ76–vâ†6ÖW&ç÷6—F–öâÇ·ƒ§ç‚´ÖF‚ç6–â‡÷6Rç–r’£2ã2Ç“£"ã’Ç£§ç¢´ÖF‚æ6÷2‡÷6Rç–r’£2ã7Ò“°¢ö&¦V7Bæ76–vâ†6ÖW&çF&vWBÇ·ƒ§ç‚ÔÖF‚ç6–â‡÷6Rç–r’£BÇ“£"ã’ÔÖF‚ç6–â‡÷6Rç—F6‚’£rÇ£§ç¢ÔÖF‚æ6÷2‡÷6Rç–r’£GÒ“°¢6ÖW&ç÷6—F–öâçƒÔÖF‚æÖ‚‚ÓRã2ÄÖF‚æÖ–âƒRã2Æ6ÖW&ç÷6—F–öâç‚’“¶6ÖW&ç÷6—F–öâç£ÔÖF‚æÖ‚‚Ó‚ã2ÄÖF‚æÖ–âƒ‚ã2Æ6ÖW&ç÷6—F–öâç¢’“°¢&VæFW&W"ç&VæFW"‡66VæU&ö÷BÆ6ÖW&Å"æÆ–v‡F–ær“·w&—FTf–ÆU7–æ2†¦ö–â†÷WBÆæÖR²"çær"’Æ6çf2çFô'VffW"‚&–ÖvR÷ær"’“°¢Ð¢&VæFW&W"æF—7÷6R‚“¶7&WræF—7÷6R‚“¶Fö7VÖVçBæ7&VFTVÆVÖVçCÖöÆD7&VFS°¢6öç6öÆRæÆör‚%&VæFW&VB6WfVâ7GVÂ&ööÒf–Ww2Fò"¶÷WB²"‡f—7VÂW‡÷'BÂæò'&÷w6W"76W'F–öç2’"“·&WGW&ã°¢Ð¢–b„$u2æ–æ6ÇVFW2‚'7F6¶6†–â×Væ—B"’—·7F6¶6†–ä6†V6·2„$Â“¶ÖVçU6†VÆÄ6†V6·2„$Â“·&WGW&ã·Ð¢–b„$u2æ–æ6ÇVFW2‚&G6"ÖÖVçW2×Væ—B"’—·7F6¶6†–ä6†V6·2„$Â“¶ÖVÖTf7F÷'”6†V6·2„$Â“¶ÖVçU6†VÆÄ6†V6·2„$Â“¶Ö†—46†V6·2„$Â“·'VÆW'46†V6·2„$Â“¶–æ´6†V6·2„$Â“¶&–t&—F6ö–ä6†V6·2„$Â“·&WGW&ã·Ð¢W‡FW&–÷$Vç&–6†ÖVçD6†V6·2„$Â“°¢–b„$u2æ–æ6ÇVFW2‚&W‡FW&–÷"×Væ—B"’—&WGW&ã°¢Ö†—46†V6·2„$Â“°¢–b„$u2æ–æ6ÇVFW2‚&Ö†—2×Væ—B"’—&WGW&ã°¢'VÆW'46†V6·2„$Â“°¢–b„$u2æ–æ6ÇVFW2‚''VÆW'2×Væ—B"’—&WGW&ã°¢–æ´6†V6·2„$Â“°¢–b„$u2æ–æ6ÇVFW2‚&–æ²×Væ—B"’—&WGW&ã°¢&–t&—F6ö–ä6†V6·2„$Â“°¢–b„$u2æ–æ6ÇVFW2‚&&–r×Væ—B"’—&WGW&ã°¢ö¶W$6†V6·2„$Â“°¢°¢òòæÇ—F–2†Æb×76W2&Râ–æFWVæFVçBæ÷&ÖÂ÷&6ÆS¢â–æ6öÖ–æp¢òò&V&–ærÂWfVâsFVw&VW2öfbÂ×W7Bæ÷B&V6öÖRF†R6Æ–Ö&–ærF—&V7F–öâà¢6öç7B&÷w2ÒµÒÂæ÷&ÖÂÒãs2Âç‚ÒÖF‚ç6–â†æ÷&ÖÂ’Âç¢ÒÖF‚æ6÷2†æ÷&ÖÂ“°¢f÷"†6öç7BævÆRöb²ÓsÂÓCRÂÓ#ÂÂ#ÂCRÂsÒ’f÷"†6öç7B&–Òöb¶fÇ6RÂG'VUÒ’°¢6öç7BæVÇ2Ò$ÂçvÆÅæVÇ2æ7&VFR‚‡‚Â’Â¢’Óâ‚¢ç‚²¢¢ç¢ãÒ‡&–Òbb’âòÓã#R¢’“°¢6öç7BæVÂÒ·ÒÂf—GFVBÒæVÇ2æf—B‚Öç‚¢ãƒrÂÂÖç¢¢ãƒrÂæ÷&ÖÂ²ævÆR¢ÖF‚å’òƒÂæVÂ“°¢6öç7BW'&÷"Òf—GFVBòÖF‚æ'2„ÖF‚æFã"„ÖF‚ç6–â‡æVÂæ†VF–ærÒæ÷&ÖÂ’ÂÖF‚æ6÷2‡æVÂæ†VF–ærÒæ÷&ÖÂ’’’¢–æf–æ—G“°¢ÆWB6ö÷&F–æFW2ÒfÇ6S°¢–b†f—GFVB’°¢6öç7Bö–çBÒ·Ó°¢æVÇ2çö–çB‡æVÂÂ2ã#RÂÓ"ãBÂÓãƒrÂö–çB“°¢æVÇ2æ6ö÷&F–æFW2‡æVÂÂö–çBç‚Âö–çBç’Âö–çBç¢“°¢6ö÷&F–æFW2ÒÖF‚æ'2‡æVÂçRÒ2ã#R’ÂRÓ’bbÖF‚æ'2‡æVÂçb²"ãB’ÂRÓ’bbÖF‚æ'2‡æVÂæFWF‚²ãƒr’ÂRÓ“°¢Ð¢&÷w2çW6‚‡²ævÆRÂ&–ÒÂf—GFVBÂW'&÷"Â6ö÷&F–æFW2Ò“°¢Ð¢6öç7B÷Væ–ærÒ$ÂçvÆÅæVÇ2æ7&VFR‚‡‚Â’Â¢’Óâ¢ãÒbb„ÖF‚æ'2‡‚’âãRÇÂ’ÂÓÇÂ’â2’“°¢6öç7Bæ'&÷rÒ$ÂçvÆÅæVÇ2æ7&VFR‚‡‚Â’Â¢’Óâ¢ãÒbbÖF‚æ'2‡‚’Âã#R“°¢&V6÷&B‚&v÷&–ÆÆvÆÂæVÇ3¢ö&Æ—VR6öçF7G2f6RF†RÖV7W&VBÆæS²ÆVFvW26†ævRFWF‚v—F†÷WB6†æv–ær–s²÷Væ–æw26ææ÷Bf'&–6FRw&—2"À¢&÷w2æWfW'’‡&÷rÓâ&÷ræf—GFVBbb&÷ræW'&÷"Âã"bb&÷ræ6ö÷&F–æFW2¢bb÷Væ–æræf—BƒÂÂÓãƒrÂÂ·Ò’bbæ'&÷ræf—BƒÂÂÓãƒrÂÂ·Ò’Â¥4ôâç7G&–æv–g’‡&÷w2’“°¢Ð¢°¢òò&WVFVBãsRÖ†–v‚G&VB†2ã#Rw&FRFW7—FR—G2fW'F–6Âf÷†VÀ¢òòf6W2âF†R6ÖRÆö6Â&—6R&W6–FR&VÂ6Æ–fb×W7Bæ÷Bv—fR6Æ–Ö&–ærà¢6öç7B7F—'2Ò‡‚Â¢’Óâ²ÖF‚æfÆö÷"‡¢òãb’¢ãsS°¢6öç7B&÷w2ÒµÓ°¢f÷"†6öç7BævÆRöb³ÂCRÂ“Â3RÂƒÂ##RÂ#sÂ3UÒ’°¢6öç7B†VF–ærÒævÆR¢ÖF‚å’òƒÂÆæRÒ·Ó°¢6öç7B&×Ò$ÂçvÆÅæVÇ2ç&×B‡7F—'2ÂÂ7F—'2ƒÂã#2’Âã#2Â†VF–ærÂÆæR“°¢&÷w2çW6‚‡²ævÆRÂ&×ÂÆöæs¢ÆæRæw&÷VæE¢Â7&÷73¢ÆæRæw&÷VæE‚À¢6÷'&V7C¢&×bbÖF‚æ'2‡ÆæRæw&÷VæE¢ÒÖF‚æ6÷2††VF–ær’¢ã#R’Âã ¢bbÖF‚æ'2‡ÆæRæw&÷VæE‚²ÖF‚ç6–â††VF–ær’¢ã#R’Âã"Ò“°¢Ð¢6öç7B7&W7BÒ‡‚Â¢’Óâ²ÖF‚æÖ–âƒ2ÂÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡¢òãb’¢ãsR’“°¢6öç7B6Æ–fbÒ‡‚Â¢’Óâ¢Âãbò¢c°¢6öç7BFöõ7FVWÒ‡‚Â¢’Óâ²ÖF‚æfÆö÷"‡¢òã#R’¢ãsS°¢6öç7B÷Væ–ærÒ‡‚Â¢’Óâ¢Â"ò7F—'2‡‚Â¢’¢æã°¢&V6÷&B‚&v÷&–ÆÆFW'&–â&×3¢&V6†&ÆRFW'&6W2F–ÇBW†–ÆÂÂF÷væ†–ÆÂæB6–FWv—3²''WB6Æ–fg2Â÷Væ–æw2æB÷fW&†VB&öög2&WF–âvÆÂ†æFÆ–ær"À¢&÷w2æWfW'’‡&÷rÓâ&÷ræ6÷'&V7B¢bb$ÂçvÆÅæVÇ2ç&×B†7&W7BÂÂ7&W7BƒÂã’ÂãÂÂ·Ò¢bb$ÂçvÆÅæVÇ2ç&×B†7&W7BÂÂ7&W7BƒÂ"’Â"ÂÂ·Ò¢bb$ÂçvÆÅæVÇ2ç&×B†6Æ–fbÂÂÂÂÂ·Ò¢bb$ÂçvÆÅæVÇ2ç&×B‡Föõ7FVWÂÂFöõ7FVWƒÂ’ÂÂÂ·Ò¢bb$ÂçvÆÅæVÇ2ç&×B†÷Væ–ærÂÂ7F—'2ƒÂ’ÂÂÂ·Ò¢bb$ÂçvÆÅæVÇ2ç&×B‡7F—'2ÂÂ7F—'2ƒÂ’Ò2ÂÂÂ·Ò¢bb$ÂçvÆÅæVÇ2ç&×B‚‚’ÓâÂÂÂÂÂ·Ò’Â¥4ôâç7G&–æv–g’‡&÷w2’“°¢Ð¢°¢òò–æFWVæFVçBT42ÔÒÖG&—‚f–ævW'&–çG2g&öÒ&ö¦V7Bæ—V¶’w2&VfW&Væ6RVæ6öFW"À¢òòf÷&6VBFòF†R6VÆV7FVBÖ6²â6÷fW'2Æöær–çfö–6W2F‡&÷Vv‚Ö†–×VÒ66—G’à¢6öç7Bf—‡GW&W2Òµ³ÃÃCsƒSCS3uÒÅ³#ÃÃ##cC##ÒÅ³#SÃÃ3CƒC3SsÒÅ³3CÃBÃCS“3cSsUÒÅ³SÃrÃs#C#C#EÒÅ³ccbÃ#Ã#c#ƒƒS#5ÒÅ³Ã#bÃC3“cC“S5ÒÅ³ƒÃ3RÃCcc3sƒ#eÒÅ³#33ÃCÃ#sCCS“ceÕÓ°¢6öç7B&÷w2Òf—‡GW&W2æÖ‚…¶ÆVæwF‚ÂfW'6–öâÂW‡V7FVEÒ’Óâ²6öç7B6öFRÒ$Âç"æVæ6öFR‚&Ææ&3"²'"ç&WVB†ÆVæwF‚ÒR’“²ÆWB†6‚Ò#cc3c#c²f÷"†6öç7B&—Böb6öFRæÖöGVÆW2’†6‚ÒÖF‚æ–×VÂ††6‚â&—BÂcsssc’“²&WGW&â²ÆVæwF‚ÂfW'6–öã¢6öFRçfW'6–öâÂ73¢6öFRçfW'6–öâÓÓÒfW'6–öâbb††6‚ããâ’ÓÓÒW‡V7FVBÓ²Ò“°¢ÆWB&V¦V7FVBÒfÇ6S²G'’²$Âç"æVæ6öFR‚'"ç&WVBƒ#33"’“²Ò6F6‚†W'&÷"’²&V¦V7FVBÒW'&÷"–ç7Fæ6Vöb&ævTW'&÷#²Ð¢&V6÷&B‚%"–çfö–6W3¢ÖG&–6W2ÖF6‚–æFWVæFVçB&VfW&Væ6RB6†÷'BæBÆöær66—F–W2"Â&÷w2æWfW'’‡"Óâ"ç72’bb&V¦V7FVBÂ¥4ôâç7G&–æv–g’‡&÷w2’“°¢Ð¢f7F÷'”6†V6·2„$Â“°¢v—B6†&7FW$6†V6·2‚“²v—B6öçG&–'WF÷$7F—f—G”6†V6·2‚“²v—BÖV×ööÄfVVD6†V6·2‚“²v—BFV'Vt7F—f—G•7FGW46†V6·2‚“²v—B6öÆôFV'Vt6†V6·2‚“²v—BFF—fUVÆ—G”6†V6·2‚“²v—B6†–å6æ6†÷D6†V6·2‚“²v—BG6%6†&VDFF6†V6·2‚“²v—BF–ÖV6†–äFF6†V6·2‚“²v—BvVF†W%7FW6†V6·2‚“²v—BvÖU'VÆW46†V6·2‚“° ¢òò66VæR7FFR'V–ÇBF—&V7FÇ’–ç7FVBöb&ö÷FVC²6VVBÖF6†W266VæRÖ‡V"æ§2à¢òò6VÆVB6fRwV–FW2æVVBF†R‡V"w26VÂæöFW2Â6ò&ö&W2&VF–ærF†VÒ7F’–âF†R'&÷w6W"F–W"à¢6öç7B—6ÆæBÒ$ÂçFW'&–âæ—6ÆæB‡²6VVC¢Ò“°¢°¢6öç7BW‡V7FVBÒ°¢3¢³bã#RÂãsRÂbãsUÒÂ3¢³bã#RÂãsRÂbãsUÒÂ3“¢³rÂãRÂbãsUÒÀ¢3¢³bã#RÂãsRÂbãsUÒÂ3#¢³bã#RÂãsRÂbãsUÒÂ33¢³rÂãRÂbãsUÐ¢Ó°¢6öç7B6öÇVÖâÒ²6fT–æFWƒ¢ÂfÆö÷#¢Â6V–Æ–æs¢ÒÂ&÷w2ÒµÓ°¢f÷"†ÆWB6fT–æFW‚Ò²6fT–æFW‚Â—6ÆæBæÖ÷WF‡2æÆVæwFƒ²6fT–æFW‚²²’°¢6öç7BÖ÷WF‚Ò—6ÆæBæÖ÷WF‡5¶6fT–æFW…ÒÂ6†RÒW‡V7FVE¶Ö÷WF‚æ–EÓ°¢–b‚6†R’6öçF–çVS°¢6öç7B&ööÒÒÖ÷WF‚ç&ööÒÂ7"ÒÖF‚ç6–â†Ö÷WF‚ç'’’Â7"ÒÖF‚æ6÷2†Ö÷WF‚ç'’“°¢6öç7BBÒ†7&÷72ÂÆöær’Óâ‡²ƒ¢Ö÷WF‚ç‚²7"¢7&÷72Ò7"¢ÆöærÂ£¢Ö÷WF‚ç¢Ò7"¢7&÷72Ò7"¢ÆöærÒ“°¢ÆWB6×ÆW2ÒÂ÷væVBÒG'VRÂ6ÆV"ÒG'VRÂVæ6Æ÷6VBÒG'VS°¢f÷"†ÆWBÆöærÒ&ööÒæg&öÒ²ãS²ÆöærÃÒ&ööÒçFòÒãR²RÓs²Æöær³ÒãR’f÷"†6öç7B7&÷72öb²×&ööÒçrò"²ãRÂÂ&ööÒçrò"ÒãUÒ’°¢6öç7BÒB†7&÷72ÂÆöær’Â6f—G’Ò—6ÆæBæ6f—G”B‡ç‚Âç¢Â6öÇVÖâÂ6fT–æFW‚²Â“°¢÷væVBÒ÷væVBbb6f—G’bb6öÇVÖâæ6fT–æFW‚ÓÓÒ6fT–æFW‚²bb6öÇVÖâæfÆö÷"ÓÓÒbb6öÇVÖâæ6V–Æ–ærÓÓÒ&ööÒæƒ°¢6ÆV"Ò6ÆV"bb—6ÆæBæ6ÆV$B‡ç‚ÂãRÂç¢Âã2Â&ööÒæ‚Òã#R“°¢Væ6Æ÷6VBÒVæ6Æ÷6VBbb—6ÆæBç6öÆ–DB‡ç‚ÂÓã#RÂç¢’bb—6ÆæBç6öÆ–DB‡ç‚Â&ööÒæ‚²ãC’Âç¢“°¢6×ÆW2²³°¢Ð¢6öç7BÖ–FFÆRÒ‡&ööÒæg&öÒ²&ööÒçFò’ò#°¢6öç7BvÆÇ2Ò¶B‚×&ööÒçrò"ÒãRÂÖ–FFÆR’ÂB‡&ööÒçrò"²ãRÂÖ–FFÆR’ÂBƒÂ&ööÒçFò²ãR•Ó°¢6öç7B7vVWg&öÒÒBƒÂÓãB’Â7vVWFòÒBƒÂ&ööÒçFòÒãR“°¢&÷w2çW6‚‡²–C¢Ö÷WF‚æ–BÂF–ÖVç6–öç3¢&ööÒçrÓÓÒ6†U³Òbb&ööÒæ‚ÓÓÒBbb&ööÒæg&öÒÓÓÒ6†U³Òbb&ööÒçFòÓÓÒ6†U³%ÒÂ6×ÆW2Â÷væVBÂ6ÆV"ÂVæ6Æ÷6VBÀ¢7vWC¢—6ÆæBçf÷†VÅ6VvÖVçD6ÆV$B‡7vVWg&öÒç‚ÂãRÂ7vVWg&öÒç¢Â7vVWFòç‚ÂãRÂ7vVWFòç¢Âã2Âãr’ÂvÆÇ3¢vÆÇ2æWfW'’‚‡’Óâ—6ÆæBç6öÆ–DB‡ç‚ÂÂç¢’’Ò“°¢Ð¢6öç7B&×2Ò—6ÆæBæÖ÷WF‡2æf–ÇFW"‚†Ö÷WF‚’ÓâÖ÷WF‚æ–BÓÓÒ&3s3"ÇÂÖ÷WF‚æ–BÓÓÒ&3R"“°¢&V6÷&B‚'7W&f6R6fW3¢WfW'’æöâÔ…Ö÷WF‚W6W2FW'&–âÖf—GFVBgVÆÂÖ†V–v‡B6'fVB6†Ö&W"v—F‚÷væVB—"Â6öÆ–BfÆö÷'2Â&öög2æBVæ6Æ÷6–ærvÆÇ2"Â&÷w2æÆVæwF‚ÓÓÒbbb²ââææWr6WB‡&÷w2æÖ‚‡&÷r’Óâ&÷ræ–B’•Òç6÷'B‚’æ¦ö–â‚’ÓÓÒö&¦V7Bæ¶W—2†W‡V7FVB’ç6÷'B‚’æ¦ö–â‚¢bb&÷w2æWfW'’‚‡&÷r’Óâ&÷ræF–ÖVç6–öç2bb&÷rç6×ÆW2ÓÓÒ32bb&÷ræ÷væVBbb&÷ræ6ÆV"bb&÷ræVæ6Æ÷6VBbb&÷rç7vWBbb&÷rçvÆÇ2¢bb&×2æÆVæwF‚ÓÓÒ"bb&×2æWfW'’‚†Ö÷WF‚’ÓâÖ÷WF‚ç&ööÒçrÓÓÒbbbÖ÷WF‚ç&ööÒæ‚ÓÓÒBbbÖ÷WF‚ç&ööÒæg&öÒÓÓÒ"ãRbbÖ÷WF‚ç&ööÒçFòÓÓÒbãR’Â¥4ôâç7G&–æv–g’‡²&÷w2Â&×3¢&×2æÖ‚†Ö÷WF‚’Óâ‡²–C¢Ö÷WF‚æ–BÂ&ööÓ¢Ö÷WF‚ç&ööÒÒ’’Ò’“°¢Ð¢÷'FÄ6†V6·2„$ÂÆVÂ“°¢°¢òò&Vw&W76–öã¢ÆÂ6æöæ–6Â‡—6–6Â&öF–W2f—BE4"w2÷'FÂæBÆæFÖ&²ÆæW2à¢6öç7B2Ò$Âç66VæRÂ&ö÷BÒ2æ7&VFTæöFR‚’Âæö÷Ò‚’Óâ·Ó°¢6öç7B7&WrÒ$Âæ7&Wræ7&VFR‡²&ö÷BÂv÷&ÆC¢²ÆWfVÃ¢ÒÂ–çWC¢²FC¢æö÷Â&VÖ÷fS¢æö÷ÒÂ‡VC¢²6WE&÷7FW%&÷s¢æö÷ÒÂvÖS¢²7FFS¢²76–væÖVçG3¢·ÒÂ–çfVçF÷'“¢µÒÒÒÂ–ÆS¢²fö÷G&–çDVFvS¢Â–ÆTVFvS¢‚’ÓâÒÂf–Wu–s¢Â'V–ÆE7÷G3¢µÒÂvÆ´–ã¢²ƒ¢Â£¢2ÒÂw&÷VæDC¢‚’ÓâÂvÆ¶&ÆS¢‚’ÓâG'VRÂ&VG&öÆÇ3¢$Âæ6öçG&–'WF÷'2ç&÷7FW"æÖ‚…òÂ’’Óâ‡²ƒ¢3²’¢"Â“¢Â£¢3Â†–FFVã¢G'VRÒ’’Âgƒ¢²6“¢æö÷Â§§¤C¢æö÷Â'W'7C¢æö÷ÂVfc¢æö÷Â7vå'F–6ÆS¢æö÷ÂFÖvTçVÖ&W#¢æö÷ÒÒ“°¢6öç7BvWBÒFö7VÖVçBævWDVÆVÖVçD'”–BÂÆ—7FVâÒv–æF÷ræFDWfVçDÆ—7FVæW"ÂVæÆ—7FVâÒv–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW#°¢Fö7VÖVçBævWDVÆVÖVçD'”–BÒ‚’Óâ²6öç7BæöFRÒVÂ‚“²æöFRçVW'•6VÆV7F÷"Ò‚’ÓâVÂ‚“²&WGW&âæöFS²Ó°¢v–æF÷ræFDWfVçDÆ—7FVæW"Òv–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW"Ò‚’Óâ·Ó°¢6öç7BW'GW&W2ÒµÓ°¢f÷"†6öç7B7F÷"öb7&Wræ6fVÖVâçfÇVW2‚’’°¢ÆWB6÷VçBÒ°¢6öç7BvFRÒ$Âæööv÷'FÂæ7&VFR‡²&F—W3¢"ã"Â÷WFW%&F—W3¢"ãRÂ÷6—F–öã¢²ƒ¢Â“¢"Â£¢ÒÂ&÷FF–öã¢²ƒ¢ÔÖF‚å’ò"Â“¢Â£¢ÒÂ&V6V—f–æs¢G'VRÂöåG&fW'6S¢‚’Óâ6÷VçB²²Ò“°¢6öç7B&6²Ò²ƒ¢Â“¢7F÷"æ&öG”†V–v‡Bò"Â£¢#RÒÂg&öçBÒ²ƒ¢Â“¢7F÷"æ&öG”†V–v‡Bò"Â£¢ÓãÓ°¢6öç7Bw&öærÒvFRçG&fW'6R†g&öçBÂ&6²Â7F÷"æ&öG•&F—W2ÂÓ’Â÷WG6–FRÒvFRçG&fW'6R‡²ââæ&6²Âƒ¢2ÒÂ²ââæg&öçBÂƒ¢2ÒÂ7F÷"æ&öG•&F—W2ÂÓ“°¢6öç7B66WFVBÒvFRçG&fW'6R†&6²Âg&öçBÂ7F÷"æ&öG•&F—W2ÂÓ’Âöæ6RÒvFRçG&fW'6R†&6²Âg&öçBÂ7F÷"æ&öG•&F—W2ÂÓ“°¢vFRæf–æ—6…&V6V—f–ær‚“²6öç7B6Æ÷6VBÒvFRç7FFRÓÓÒ$ôdb#²vFRæF—7÷6R‚“°¢W'GW&W2çW6‚‡²æÖS¢7F÷"çG&—G2ææÖRÂ73¢w&öærbb÷WG6–FRbb66WFVBbböæ6Rbb6Æ÷6VBbb6÷VçBÓÓÒÒ“°¢Ð¢Fö7VÖVçBævWDVÆVÖVçD'”–BÒvWC²v–æF÷ræFDWfVçDÆ—7FVæW"ÒÆ—7FVã²v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW"ÒVæÆ—7FVã°¢&V6÷&B‚$ööv÷'FÂG&ç6—B&Vw&W76–öã¢ÆÂ6æöæ–6Â&öF–W2&WF–âöæR×v’&6·6–FRW'GW&RæBf–æ—6‚ôdb"ÂW'GW&W2æÆVæwF‚ÓÓÒ45BbbW'GW&W2æWfW'’‡&÷rÓâ&÷rç72’Â¥4ôâç7G&–æv–g’†W'GW&W2’“°¢6öç7BÆæBÒ$ÂæG6$ÖöFVÇ2æ'V–ÆB‚’ÂÆæFÖ&·2Òö&¦V7BçfÇVW2†ÆæBæÆæFÖ&·2’Â&÷WFW2Ò°¢µ³ÂuÒÂ³Â#eÕÒÂµ³Â#eÒÂ³Â35ÕÒÂµ³Â#eÒÂ³2ãrÂ#RãeÕÒÂµ³Â#ÒÂ³rÂ#EÕÒÀ¢µ³Â…ÒÂ²ÓãRÂ…ÕÒÂµ³Â…ÒÂ³ãRÂ…ÕÐ¢Ó°¢6öç7BÆ–÷WBÒµÓ°¢2çWFFUv÷&ÆB†ÆæBç&ö÷B“°¢f÷"†6öç7B7F÷"öb7&Wræ6fVÖVâçfÇVW2‚’’°¢ÆWB6ÆV"ÒG'VS°¢f÷"†6öç7B¶Â%Òöb&÷WFW2’f÷"†ÆWB’Ò²’ÃÒ#ƒ²’²²’°¢6öç7B‚Ò³Ò²†%³ÒÒ³Ò’¢’ò#‚Â¢Ò³Ò²†%³ÒÒ³Ò’¢’ò#ƒ°¢6ÆV"bcÒÆæFÖ&·2æWfW'’†ÂÓâÂæ6ÆV$B‡‚Â¢Â7F÷"æ&öG•&F—W2’“°¢Ð¢f÷"†6öç7BÂöbÆæFÖ&·2’°¢6öç7BÒÂçö–çB‚“²6ÆV"bcÒÂæ6ÆV$B‡ç‚Âç¢Â7F÷"æ&öG•&F—W2’bbÂææV"‡“°¢6ÆV"bcÒÂæ6ÆV$B†ÂææöFRç÷6—F–öâç‚ÂÂææöFRç÷6—F–öâç¢Â7F÷"æ&öG•&F—W2“°¢6ÆV"bcÒÂæ6ÆV$B‚Ó#Â2Â7F÷"æ&öG•&F—W2’bbÂæ6ÆV$B‚ÓÂ2Â7F÷"æ&öG•&F—W2’bbÂææV"‡²ƒ¢Ó#Â£¢2Ò’bbÂææV"‡²ƒ¢ÓÂ£¢2Ò“°¢òò–æFWVæFVçB66VæRÖG&–6W2fW&–g’F†R†VÇW"W6W2F†R&VæFW&VB÷&–VçFF–öâà¢6öç7BrÒÂææöFRçv÷&ÆC²6ÆV"bcÒÖF‚æ‡—÷B‡ç‚Ò‡u³…Ò¢2ãR²u³%Ò’Âç¢Ò‡u³Ò¢2ãR²u³EÒ’’ÂRÓS°¢6öç7BVFvRÒÂçö–çB†Âçv–GF‚²7F÷"æ&öG•&F—W2²ãÂÂ’Â–ç6–FRÒÂçö–çB†Âçv–GF‚ÒãÂÂ“°¢6ÆV"bcÒÂæ6ÆV$B†VFvRç‚ÂVFvRç¢Â7F÷"æ&öG•&F—W2’bbÂæ6ÆV$B†–ç6–FRç‚Â–ç6–FRç¢Â7F÷"æ&öG•&F—W2“°¢Ð¢Æ–÷WBçW6‚‡²æÖS¢7F÷"çG&—G2ææÖRÂ6ÆV"Ò“°¢Ð¢&V6÷&B‚$E4"Æ¦¢ÆÂ6æöæ–6Â&öF–W26ÆV"G&ç6f÷&ÖVBg&öçG2æBG&fVÂÆæW2v—F‚öÆBfö÷G&–çG2&VÖ÷fVB"ÂÆ–÷WBæÆVæwF‚ÓÓÒ45BbbÆ–÷WBæWfW'’‡&÷rÓâ&÷ræ6ÆV"’Â¥4ôâç7G&–æv–g’†Æ–÷WB’“°¢7&WræF—7÷6R‚“°¢Ð¢6öç7B&ö6´wV–FW2Ò$Âç&ö6´wV–FW2æ7&VFR‡²—6ÆæBÂ6VÆVC¢µÒÒ“°¢vÆö&ÅF†—2åõööövÒ²—6ÆæBÂ†VGV'FW'3¢²&ö6´wV–FW2ÒÓ° ¢6öç7B&6¶VæG2Ò²'vV&vÃ"%Ó° ¢°¢6öç7B2Ò$Âç66VæRÂ&ö÷BÒ2æ7&VFTæöFR‚’Â&÷‚Ò‚Óâ$ÂæÖöFVÇ2æ&÷‚‡²s¢ã#RÂƒ¢ã#RÂC¢ã#RÂöfg6WC¢²‚ÒÂ6öÆ÷#¢"6fffffb"Ò“°¢6öç7BvVöÖWG'’Ò$ÂæÖöFVÇ2æÖW&vR†&÷‚‚Ó’Â&÷‚ƒ’’Âf—'7BÒ2æ7&VFTæöFR‡²vVöÖWG'’Ò’Â6V6öæBÒ2æ7&VFTæöFR‡²vVöÖWG'’Ò“°¢2æFD6†–ÆB‡&ö÷BÂf—'7BÂ6V6öæB“°¢6öç7B6öçF7G2Ò$ÂçvVöåF&vWG2æ7&VFR…·²æöFS¢f—'7BÂ÷væW#¢·ÒÒÂ²æöFS¢6V6öæBÂ÷væW#¢·ÒÕÒ“°¢6öçF7G2ç&Vv—7FW"†f—'7B“²6öçF7G2ç&Vv—7FW"‡6V6öæB“°¢6öç7B&Vf÷&RÒ$ÂæÖF‚æÖCBæ7&VFR‚’ÂgFW"Ò$ÂæÖF‚æÖCBæ7&VFR‚’Â÷WBÒ·Ó°¢6öç7B6ÇV"Ò$ÂæÖöFVÇ2æ&÷‚‡²s¢2Âƒ¢ã#RÂC¢ã#RÂ6öÆ÷#¢"6fffffb"Ò“°¢&Vf÷&U³EÒÒ#°¢6öç7B†—BÒ6öçF7G2ç7G&–¶R†÷WBÂ&Vf÷&RÂgFW"Â6ÇV"’Â6VÆV7FVBÒ÷WBææöFRÓÓÒf—'7BÂö–çBÒ¶÷WBæF—7Fæ6RÂ÷WBç‚Â÷WBç’Â÷WBç¥Ó°¢6öç7B&WVFVBÒ6öçF7G2ç7G&–¶R†÷WBÂ&Vf÷&RÂgFW"Â6ÇV"’bb÷WBææöFRÓÓÒf—'7Bbb¶÷WBæF—7Fæ6RÂ÷WBç‚Â÷WBç’Â÷WBç¥ÒæWfW'’‚‡fÇVRÂ’’ÓâfÇVRÓÓÒö–çE¶•Ò“°¢&V6÷&B‚'vVöâ6öçF7G3¢WVÂÖF—7Fæ6R7vVW2&WF–â÷&–v–æÂG&–ævÆRæBF&vWB÷&FW"v—F‚&WVF&ÆR6öçF7Bö–çG2"Â†—Bbb6VÆV7FVBbbö–çE³ÒÂbb&WVFVBÂ¥4ôâç7G&–æv–g’‡²†—BÂ6VÆV7FVBÂö–çBÂ&WVFVBÒ’“°¢Ð ¢°¢6öç7BÖ¶RÒ‚’Óâ$ÂæÖöFVÇ2æ6fVÖâ„$Âæ6öçG&–'WF÷'2çG&—G4f÷"‚'r×2Ö&—F6ö–â"’’ÂÒÖ¶R‚’Â"ÒÖ¶R‚“°¢6öç7B¶W—2Ò²&wVâ"Â&f–ævW'4Â"Â&f–ævW'5"%ÒÂVFW&æ–öç2Ò¶W—2æÖ†¶W’Óâ'&’æg&öÒ†"ç'G5¶¶W•ÒçVFW&æ–öâ’“°¢6öç7B&ææÒ²f—6–&ÆS¢"ç'G2æwVä&ææ5³Òçf—6–&ÆRÂ66ÆS¢²ââæ"ç'G2æwVä&ææ5³Òç66ÆRÒÓ°¢6öç7B–æFWVæFVçBÒç&ö÷BÓÒ"ç&ö÷Bbbç'G2æwVä&öG’ævVöÖWG'’ÓÓÒ"ç'G2æwVä&öG’ævVöÖWG'¢bbç'G2æwVä&ææ2ÓÒ"ç'G2æwVä&ææ2bbç'G2æwVä&ææ2æÆVæwF‚ÓÓÒ¢bb"ç'G2æwVä&ææ2æWfW'’‚†æöFRÂ’’ÓâæöFRÓÒç'G2æwVä&ææ5¶•ÒbbæöFRç&VçBÓÓÒ"ç'G2æwVâ¢bb¶W—2æWfW'’†¶W’Óâç'G5¶¶W•ÒçVFW&æ–öâÓÒ"ç'G5¶¶W•ÒçVFW&æ–öâ“°¢f÷"†6öç7B¶W’öb¶W—2’ç'G5¶¶W•ÒçVFW&æ–öâæf–ÆÂƒã2“°¢ç'G2æwVä&ææ5³Òçf—6–&ÆRÒ&ææçf—6–&ÆS²ç'G2æwVä&ææ5³Òç66ÆRç‚Òs°¢ç&ö÷Bç÷6—F–öâç‚ÒC#°¢6öç7B2ÒÖ¶R‚’Âg&W6‚Ò¶"Â5ÒæWfW'’†ÖöFVÂÓâÖöFVÂç&ö÷Bç÷6—F–öâç‚ÓÓÒ ¢bb¶W—2æWfW'’‚†¶W’Â’’Óâ'&’æg&öÒ†ÖöFVÂç'G5¶¶W•ÒçVFW&æ–öâ’æWfW'’‚‡fÇVRÂ¢’ÓâfÇVRÓÓÒVFW&æ–öç5¶•Õ¶¥Ò’¢bbÖöFVÂç'G2æwVä&ææ5³Òçf—6–&ÆRÓÓÒ&ææçf—6–&ÆRbbö&¦V7Bæ¶W—2†&ææç66ÆR’æWfW'’†¶W’ÓâÖöFVÂç'G2æwVä&ææ5³Òç66ÆU¶¶W•ÒÓÓÒ&ææç66ÆU¶¶W•Ò’“°¢&V6÷&B‚&6fVÖâ66†S¢6ÆöæW26†&R–Ö×WF&ÆRvVöÖWG'’v†–ÆR÷væ–ærg&W6‚wVâ'&—2ÂVFW&æ–öç2æBG&ç6f÷&×2"Â–æFWVæFVçBbbg&W6‚bb2æwVä†VD&÷VæG2ÓÓÒ$Âç66VæRæ&÷VæG4öb†2æ†VD÷Vâ’Â¥4ôâç7G&–æv–g’‡²–æFWVæFVçBÂg&W6‚ÂwVä&ææ3¢2ç'G2æwVä&ææ2æÆVæwF‚Ò’“°¢Ð¢°¢6öç7B2Ò$Âç66VæRÂ&ö÷BÒ2æ7&VFTæöFR‚’ÂæVÂÒ2æ7&VFTæöFR‡²vVöÖWG'“¢$Âæ‡V$ÖöFVÇ2æÖ—'&÷%æVÂ‚’ÂÖ—'&÷#¢G'VRÒ“°¢2æFD6†–ÆB‡&ö÷BÂæVÂ“²6öç7B÷&–v–æÂÒæVÂævVöÖWG'’ÂFÖvRÒ$ÂæÖ—'&÷$FÖvRæ7&VFR‡æVÂ’ÂæöFW2Ò²ââç&ö÷Bæ6†–ÆG&VåÓ°¢6öç7BÆ–Ö—BÒ$ÂæÖ—'&÷$FÖvRäDT%$•5ôÄ”Ô•C°¢6öç7B–væ÷&VBÒFÖvRæ†—BƒÂÂÂ’bbFÖvRæ†—B‚ÓÂÂÂ’bbFÖvRæFÖvRÓÓÒbbæVÂævVöÖWG'’ÓÓÒ÷&–v–æÃ°¢FÖvRæ†—Bƒ"Âã"ÂãÂ“²6öç7Bf—'7E6V×2ÒFÖvRç6V×2Âf—'7D†öÆW2ÒFÖvRæ†öÆW3°¢6öç7BVFvW2ÒæöFW5³ÒævVöÖWG'“°¢ÆWBf—'7D7&6´&VÒ°¢f÷"†6öç7Bf6RöbVFvW2æf6W2’°¢ÆWB&VÒ°¢f÷"†ÆWB’ÒÂ¢Òf6Ræ’æÆVæwF‚Ò²’Âf6Ræ’æÆVæwFƒ²¢Ò’²²’°¢6öç7BÒf6Ræ•¶¥Ò¢2Â"Òf6Ræ•¶•Ò¢3°¢&V³ÒVFvW2çfW'G5¶Ò¢VFvW2çfW'G5¶"²ÒÒVFvW2çfW'G5¶%Ò¢VFvW2çfW'G5¶²Ó°¢Ð¢f—'7D7&6´&V³ÒÖF‚æ'2†&V’¢ãS°¢Ð¢6öç7B&÷w2ÒµÓ°¢f÷"†6öç7B÷vW"öb´$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÒ"Â"ÂbÂ„$ÂæÖ—'&÷$FÖvRåäTÅôÄ”Ô•BÒ’¢$ÂæÖ—'&÷$FÖvRåäTÅô„TÅD‚Â$ÂæÖ—'&÷$FÖvRäÔ…ôDÔtUÒ’°¢FÖvRæ†—B‡÷vW"Âã"ÂãÂ“°¢6öç7BÆ—fRÒæWr6WB‚“²FÖvRæÆ—fTvVöÖWG'’†Æ—fR“°¢&÷w2çW6‚‡²7FvS¢FÖvRç7FvRÂ6V×3¢FÖvRç6V×2Â7F—fS¢FÖvRæ7F—fRÂ†öÆW3¢FÖvRæ†öÆW2ÂÖ–æ–×VÔ†VÇFƒ¢ÖF‚æÖ–â‚ââæFÖvRçæVÄ†VÇF‚’ÂÆ—fS¢Æ—fRç6—¦RÂæöFW3¢&ö÷Bæ6†–ÆG&VâæÆVæwF‚Ò“°¢Ð¢6öç7B6†&G2ÒæöFW2æf–ÇFW"†æöFRÓâæöFRæÖ—'&÷%6†&BÓÓÒæVÂ’ÂfÆö÷"Ò2æ&÷VæG4öb†÷&–v–æÂ’æÖ–å³Ó°¢6öç7B&VfÆV7F—fRÒ6†&G2æWfW'’†æöFRÓâæöFRævVöÖWG'’bbæöFRævVöÖWG'’æÖ—'&÷%6÷W&6RæÆVæwF‚ÓÓÒæöFRævVöÖWG'’çfW'G2æÆVæwF‚“°¢ÆWBfÆÆ–ærÒfÇ6RÂÆæFVBÒfÇ6RÂfFVBÒfÇ6RÂ&VÆ÷tw&÷VæBÒfÇ6S°¢6öç7Bö–çBÒæWrfÆöCcD'&’ƒ2“°¢f÷"†ÆWBF–6²Ò²F–6²Â3c²F–6²²²’°¢FÖvRçWFFRƒò#“²2çWFFUv÷&ÆB‡&ö÷B“°¢f÷"†6öç7B6†&Böb6†&G2’°¢–b‚6†&Bçf—6–&ÆR’6öçF–çVS°¢–b‡6†&Bç&÷FF–öâç‚ÓÒÔÖF‚å’ò"ÇÂ6†&Bç&÷FF–öâç¢ÓÒ’fÆÆ–ærÒG'VS°¢VÇ6R°¢ÆæFVBÒG'VS°¢f÷"†ÆWB’Ò²’Â6†&BævVöÖWG'’çfW'G2æÆVæwFƒ²’³Ò2’°¢6öç7BbÒ6†&BævVöÖWG'’çfW'G3²$ÂæÖF‚æÖCBçG&ç6f÷&Õö–çB‡ö–çBÂ6†&Bçv÷&ÆBÂe¶•ÒÂe¶’²ÒÂe¶’²%Ò“°¢–b‡ö–çE³ÒÂfÆö÷"ÒRÓr’&VÆ÷tw&÷VæBÒG'VS°¢Ð¢Ð¢–b‡6†&Bç6Öö¶T÷6—G’âbb6†&Bç6Öö¶T÷6—G’Âbb6†&Bç66ÆRç‚ÓÓÒ’fFVBÒG'VS°¢Ð¢Ð¢6öç7B6WGFÆVBÒFÖvRæ7F—fRÓÓÒbb6†&G2æWfW'’†æöFRÓâæöFRçf—6–&ÆR“°¢FÖvRæF—7÷6R‚“°¢&V6÷&B‚&Ö—'&÷"FÖvS¢öæR‡VæG&VB7&6²FÖvR&V6VFW2V–v‡BÖ†VÇF‚æVÇ2Âv—F‚&÷VæFVB&VfÆV7F—fRFV'&—2ÂfÆBÆæF–æw2&÷fR7W÷'BÂfFRæB6ö×ÆWFRF—7÷6Â"Â–væ÷&VBbbf—'7E6V×2ãÒCbbf—'7D†öÆW2ÓÓÒbbf—'7D7&6´&Vâã2bb&÷w5³Òæ7F—fRÓÓÒbb&÷w5³ÒæÆ—fRÓÓÒ2bb&÷w5³Òç6V×2âf—'7E6V×2bb&÷w5³Òæ7F—fRÓÓÒbb&÷w5³ÒæÖ–æ–×VÔ†VÇF‚ÓÓÒbbb&÷w5³%Òæ†öÆW2ÓÓÒbb&÷w5³%Òæ7F—fRÓÓÒbb&÷w2æWfW'’‡&÷rÓâ&÷ræ7F—fRÃÒÆ–Ö—Bbb&÷ræÆ—fRÃÒÆ–Ö—B²2bb&÷rææöFW2ÓÓÒÆ–Ö—B²"’bb6†&G2æÆVæwF‚ÓÓÒÆ–Ö—Bbb&÷w5³5Òæ7F—fRÓÓÒÆ–Ö—Bbb&VfÆV7F—fRbbfÆÆ–ærbbÆæFVBbbfFVBbb&VÆ÷tw&÷VæBbb6WGFÆVBbbFÖvRæFÖvRÓÓÒ$ÂæÖ—'&÷$FÖvRäÔ…ôDÔtRbb&ö÷Bæ6†–ÆG&VâæÆVæwF‚ÓÓÒbb&ö÷Bæ6†–ÆG&Vå³ÒÓÓÒæVÂbbæVÂævVöÖWG'’ÓÓÒ÷&–v–æÂbbæVÂæÖ—'&÷$FÖvRÓÓÒçVÆÂbbæVÂæÖ—'&÷$6GW&TvVöÖWG'’ÓÓÒçVÆÂbbæöFW2ç6Æ–6Rƒ’æWfW'’†æöFRÓâæöFRç&VçBÓÓÒçVÆÂ’Â¥4ôâç7G&–æv–g’‡²–væ÷&VBÂÆ–Ö—BÂf—'7E6V×2Âf—'7D†öÆW2Âf—'7D7&6´&VÂ&÷w2Â&VfÆV7F—fRÂfÆÆ–ærÂÆæFVBÂfFVBÂ&VÆ÷tw&÷VæBÂ6WGFÆVBÂ6†–ÆG&Vã¢&ö÷Bæ6†–ÆG&VâæÆVæwF‚Ò’“°¢Ð¢°¢6öç7B2Ò$Âç66VæRÂÖ¶RÒ‚’Óâ°¢6öç7B&ö÷BÒ2æ7&VFTæöFR‚’ÂæVÂÒ2æ7&VFTæöFR‡²vVöÖWG'“¢$Âæ‡V$ÖöFVÇ2æÖ—'&÷%æVÂ‚’ÂÖ—'&÷#¢G'VRÒ“°¢2æFD6†–ÆB‡&ö÷BÂæVÂ“²&WGW&â²&ö÷BÂæVÂÂFÖvS¢$ÂæÖ—'&÷$FÖvRæ7&VFR‡æVÂ’Ó°¢Ó°¢6öç7B&W6VçBÒ†vVòÂ‚Â’Â6÷W&6RÒfÇ6R’Óâ°¢6öç7BbÒ6÷W&6RòvVòæÖ—'&÷%6÷W&6R¢vVòçfW'G3°¢&WGW&âvVòæf6W2ç6öÖR†f6RÓâ°¢–b‡6÷W&6RbbvVòçfW'G5¶f6Ræ•³Ò¢2²%ÒÓÒ’&WGW&âfÇ6S°¢f÷"†ÆWB’ÒÂ¢Òf6Ræ’æÆVæwF‚Ò²’Âf6Ræ’æÆVæwFƒ²¢Ò’²²’°¢6öç7BÒf6Ræ•¶¥Ò¢2Â"Òf6Ræ•¶•Ò¢3°¢–b‚‡e¶%ÒÒe¶Ò’¢‡’Òe¶²Ò’Ò‡e¶"²ÒÒe¶²Ò’¢‡‚Òe¶Ò’ÂÓRÓ‚’&WGW&âfÇ6S°¢Ð¢&WGW&âG'VS°¢Ò“°¢Ó°¢6öç7B†VÇF‚ÒÖ¶R‚’Â†VÇF„'&’Ò†VÇF‚æFÖvRçæVÄ†VÇFƒ°¢6öç7B66GFW&VBÒµÒÂ–ÒÒ·ÒÂ&WVFVBÒ·Ó°¢f÷"†ÆWB6×ÆRÒ²6×ÆRÂƒ²6×ÆR²²’°¢†VÇF‚æFÖvRæ–Ô6VçFW"†–ÒÂÂÂÂ6×ÆR“°¢†VÇF‚æFÖvRæ–Ô6VçFW"‡&WVFVBÂÂÂÂ6×ÆR“°¢66GFW&VBçW6‚‡²ƒ¢–Òç‚Â“¢–Òç’Â&W6VçC¢†VÇF‚æFÖvRæ6öçF–ç2†–Òç‚Â–Òç’’Â7F&ÆS¢–Òç‚ÓÓÒ&WVFVBç‚bb–Òç’ÓÓÒ&WVFVBç’bb–Òç¢ÓÓÒ&WVFVBç¢Ò“°¢Ð¢†VÇF‚æFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÂã"ÂãÂ“°¢6öç7B7&6¶VEfW'F–6W2Ò'&’æg&öÒ††VÇF‚çæVÂævVöÖWG'’çfW'G2’ÂÆÄ7&6¶VBÒ†VÇF‚æFÖvRæ7&6´FÖvRÓÓÒƒbb†VÇF‚æFÖvRæ†öÆW2bb†VÇF„'&’æWfW'’‡fÇVRÓâfÇVRÓÓÒ‚“°¢†VÇF‚æFÖvRæ†—Bƒ"Âã"ÂãÂ“°¢6öç7B†Æd†VÇF‚Ò'&’æg&öÒ††VÇF„'&’’Â†Æd–çF7BÒ†VÇF‚æFÖvRæ†öÆW2bb†VÇF‚æFÖvRæ7F—fRbb7&6¶VEfW'F–6W2æWfW'’‚‡fÇVRÂ’’ÓâfÇVRÓÓÒ†VÇF‚çæVÂævVöÖWG'’çfW'G5¶•Ò“°¢†VÇF‚æFÖvRæ†—BƒbÂã"ÂãÂ“°¢6öç7B&÷VæD'&V²Ò†VÇF‚æFÖvRæ†öÆW2ÓÓÒbb†VÇF‚æFÖvRæ7F—fRÓÓÒbb†VÇF„'&’æf–ÇFW"‡fÇVRÓâfÇVRÓÓÒ’æÆVæwF‚ÓÓÒ°¢†VÇF‚æFÖvRæF—7÷6R‚“°¢6öç7B6†&vVBÒÖ¶R‚“²6†&vVBæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÂã"ÂãÂ“²6†&vVBæFÖvRæ†—BƒÂã"ÂãÂ“°¢6öç7B6†&vVD†VÇF‚Ò'&’æg&öÒ†6†&vVBæFÖvRçæVÄ†VÇF‚’Â'&ö¶Vä–æFW‚Ò6†&vVD†VÇF‚æ–æFW„öbƒ’Âv÷VæFVD–æFW‚Ò6†&vVD†VÇF‚æ–æFW„öbƒb“°¢6öç7B6†—Ò6†&vVBç&ö÷Bæ6†–ÆG&Vâæf–æB†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒ6†&vVBçæVÂ’Â6†—vVöÖWG'’Ò6†—ævVöÖWG'’Â7‚Ò6†—ç÷6—F–öâç‚Â7’Ò6†—ç÷6—F–öâç“°¢6öç7BæVÄ–ÒÒ·ÒÂ–ÖVDE7W'f—f÷"Ò6†&vVBæFÖvRæ–Ô6VçFW"‡æVÄ–ÒÂ7‚Â7’ÂÂr¢bb6†&vVBæFÖvRæ6öçF–ç2‡æVÄ–Òç‚ÂæVÄ–Òç’’bbÖF‚æ‡—÷B‡æVÄ–Òç‚Ò7‚ÂæVÄ–Òç’Ò7’’âRÓS°¢6öç7BæT&VÒ†vVòÂ6÷W&6RÒfÇ6R’Óâ°¢6öç7BbÒ6÷W&6RòvVòæÖ—'&÷%6÷W&6R¢vVòçfW'G3²ÆWBF÷FÂÒ°¢f÷"†6öç7Bf6RöbvVòæf6W2’°¢–b‡6÷W&6RbbvVòçfW'G5¶f6Ræ•³Ò¢2²%ÒÓÒ’6öçF–çVS°¢ÆWB‚ÒÂ’ÒÂ&VÒ°¢f÷"†ÆWB’ÒÂ¢Òf6Ræ’æÆVæwF‚Ò²’Âf6Ræ’æÆVæwFƒ²¢Ò’²²’°¢6öç7BÒf6Ræ•¶¥Ò¢2Â"Òf6Ræ•¶•Ò¢3°¢‚³Òe¶%Ó²’³Òe¶"²Ó²&V³Òe¶Ò¢e¶"²ÒÒe¶%Ò¢e¶²Ó°¢Ð¢–b‡6÷W&6RÇÂ&W6VçB†6†—vVöÖWG'’Â‚òf6Ræ’æÆVæwF‚Â’òf6Ræ’æÆVæwF‚ÂG'VR’’F÷FÂ³ÒÖF‚æ'2†&V’¢ãS°¢Ð¢&WGW&âF÷FÃ°¢Ó°¢6öç7BgVÆÄ&VÒæT&V†6†—vVöÖWG'’ÂG'VR“°¢6†&vVBæFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä„TÅôDTÄ’²ò$ÂæÖ—'&÷$FÖvRåäTÅô„TÅõ$DR“°¢6öç7B&V6÷fW&VBÒ6†&vVBæFÖvRçæVÄ†VÇF…¶'&ö¶Vä–æFW…ÒÂv÷VæFVE&V6÷fW&VBÒ6†&vVBæFÖvRçæVÄ†VÇF…·v÷VæFVD–æFW…ÒÂ&Vg&7F–öâÒæT&V†6†&vVBçæVÂævVöÖWG'’’ògVÆÄ&V°¢6öç7B&Vw&÷våfW'F–6W2Ò'&’æg&öÒ†6†&vVBçæVÂævVöÖWG'’çfW'G2“°¢6†&vVBæFÖvRæ†—BƒãBÂ7‚Â7’Â“°¢6öç7B'F–Ä†VÇF‚Ò6†&vVBæFÖvRçæVÄ†VÇF…¶'&ö¶Vä–æFW…ÒÂW‡FVçE&WF–æVBÒ&Vw&÷våfW'F–6W2æÆVæwF‚ÓÓÒ6†&vVBçæVÂævVöÖWG'’çfW'G2æÆVæwF‚bb&Vw&÷våfW'F–6W2æWfW'’‚‡fÇVRÂ’’ÓâfÇVRÓÓÒ6†&vVBçæVÂævVöÖWG'’çfW'G5¶•Ò“°¢6†&vVBæFÖvRæ†—B‡'F–Ä†VÇF‚Â7‚Â7’Â“°¢6öç7BfÆÆVâÒ6†&vVBç&ö÷Bæ6†–ÆG&Vâæf–ÇFW"†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒ6†&vVBçæVÂ’ÂfÆÆVä&VÒfÆÆVâç&VGV6R‚‡7VÒÂæöFR’Óâ7VÒ²æT&V†æöFRævVöÖWG'’ÂG'VR’Â’ògVÆÄ&V°¢6öç7B&÷÷'F–öæÄ'&V²Ò6†&vVBæFÖvRçæVÄ†VÇF…¶'&ö¶Vä–æFW…ÒÓÓÒbb6†&vVBæFÖvRçæVÄ†VÇF…·v÷VæFVD–æFW…ÒÓÓÒv÷VæFVE&V6÷fW&VBbb6†&vVBæFÖvRæ6öçF–ç2†7‚Â7’“°¢6†&vVBæFÖvRæF—7÷6R‚“°¢&V6÷&B‚&Ö—'&÷"FÖvS¢–çF7BvÆ72vWG2f&–VB7F&ÆR6†÷BF&vWG2æBWFò–ÒF‡&÷Vv‚†öÆR&W6öÇfW2Fò7W'f—f–ærvÆ72"Â66GFW&VBæWfW'’††—BÓâ†—Bç&W6VçBbb†—Bç7F&ÆR’bbæWr6WB‡66GFW&VBæÖ††—BÓâG¶†—Bç‡ÒÂG¶†—Bç—Ö’’ç6—¦RÓÓÒ66GFW&VBæÆVæwF‚bbÖF‚æÖ‚‚ââç66GFW&VBæÖ††—BÓâ†—Bç‚’’ÒÖF‚æÖ–â‚ââç66GFW&VBæÖ††—BÓâ†—Bç‚’’âbbÖF‚æÖ‚‚ââç66GFW&VBæÖ††—BÓâ†—Bç’’’ÒÖF‚æÖ–â‚ââç66GFW&VBæÖ††—BÓâ†—Bç’’’âbb–ÖVDE7W'f—f÷"Â¥4ôâç7G&–æv–g’‡²66GFW&VBÂ–ÖVDE7W'f—f÷"ÂæVÄ–ÒÂ†öÆS¢¶7‚Â7•ÒÒ’“°¢&V6÷&B‚&Ö—'&÷"FÖvS¢V6‚æVÂ†2V–v‡B†VÇF‚Â6†&vVB÷fW&fÆ÷r&V6†W2F†RæW‡BæVÂÂæB&Vw&÷vâ&V&W7F÷&W2ÖF6†–ærg&7F–öæÂ†VÇF‚"Â$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÓÓÒbb$ÂæÖ—'&÷$FÖvRåäTÅô„TÅD‚ÓÓÒ‚bb$ÂæÖ—'&÷$FÖvRåäTÅôÄ”Ô•BÓÓÒSbb$ÂæÖ—'&÷$FÖvRäÔ…ôDÔtRÓÓÒSbb†VÇF„'&’ÓÓÒ†VÇF‚æFÖvRçæVÄ†VÇF‚bbÆÄ7&6¶VBbb†Æd–çF7Bbb†Æd†VÇF‚æf–ÇFW"‡fÇVRÓâfÇVRÓÓÒb’æÆVæwF‚ÓÓÒbb†Æd†VÇF‚æWfW'’‡fÇVRÓâfÇVRÓÓÒ‚ÇÂfÇVRÓÓÒb’bb&÷VæD'&V²bb6†&vVD†VÇF‚æf–ÇFW"‡fÇVRÓâfÇVRÓÓÒ’æÆVæwF‚ÓÓÒbb6†&vVD†VÇF‚æf–ÇFW"‡fÇVRÓâfÇVRÓÓÒb’æÆVæwF‚ÓÓÒbbÖF‚æ'2‡&V6÷fW&VBÒ’ÂRÓ’bbÖF‚æ'2‡v÷VæFVE&V6÷fW&VBÒr’ÂRÓ’bbÖF‚æ'2†&Vg&7F–öâÒ&V6÷fW&VBò$ÂæÖ—'&÷$FÖvRåäTÅô„TÅD‚’ÂRÓbbbÖF‚æ'2‡'F–Ä†VÇF‚Òãb’ÂRÓ’bbW‡FVçE&WF–æVBbb&÷÷'F–öæÄ'&V²bbfÆÆVâæÆVæwF‚ÓÓÒbbÖF‚æ'2†fÆÆVä&VÒ&Vg&7F–öâ’ÂRÓbÂ¥4ôâç7G&–æv–g’‡²ÆÄ7&6¶VBÂ†Æd†VÇF‚Â†Æd–çF7BÂ&÷VæD'&V²Â6†&vVD†VÇF‚Â&V6÷fW&VBÂv÷VæFVE&V6÷fW&VBÂ&Vg&7F–öâÂ'F–Ä†VÇF‚ÂW‡FVçE&WF–æVBÂ&÷÷'F–öæÄ'&V²ÂfÆÆVã¢fÆÆVâæÆVæwF‚ÂfÆÆVä&VÒ’“°¢6öç7B7&6¶VE&VfW&Væ6RÒÖ¶R‚“²7&6¶VE&VfW&Væ6RæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÂã"ÂãÂ“°¢6öç7B7&6¶VEFV×ÆFRÒ7&6¶VE&VfW&Væ6RçæVÂævVöÖWG'“²7&6¶VE&VfW&Væ6RæFÖvRæF—7÷6R‚“°¢6öç7B÷F†W$–×7BÒÖ¶R‚“²÷F†W$–×7BæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÂÓãBÂã‚Â“°¢6öç7Bf—†VDÆ–÷WBÒ¥4ôâç7G&–æv–g’†÷F†W$–×7BçæVÂævVöÖWG'’çfW'G2’ÓÓÒ¥4ôâç7G&–æv–g’†7&6¶VEFV×ÆFRçfW'G2¢bb¥4ôâç7G&–æv–g’†÷F†W$–×7BçæVÂævVöÖWG'’æf6W2’ÓÓÒ¥4ôâç7G&–æv–g’†7&6¶VEFV×ÆFRæf6W2“°¢÷F†W$–×7BæFÖvRæF—7÷6R‚“°¢6öç7B&W—&VBÒÖ¶R‚’Â&W—$FÖvRÒ$ÂæÖ—'&÷$FÖvRåäTÅôDÔtR²cBÂæVÅF–ÖRÒ$ÂæÖ—'&÷$FÖvRåäTÅô„TÅD‚ò$ÂæÖ—'&÷$FÖvRåäTÅô„TÅõ$DS°¢&W—&VBæFÖvRæ†—B‡&W—$FÖvRÂã"ÂãÂ“°¢6öç7B6VçFW'2Ò&W—&VBç&ö÷Bæ6†–ÆG&Vâæf–ÇFW"†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒ&W—&VBçæVÂ’æÖ†æöFRÓâ°¢6öç7B‚ÒæöFRç÷6—F–öâç‚Â’ÒæöFRç÷6—F–öâç’ÂbÒ7&6¶VEFV×ÆFRçfW'G3°¢ÆWBf"ÒÓÂW‚Ò‚ÂW’Ò“°¢òò'VÆ²†—BG&÷2F†Rf÷&ÖW&Ç’–çF7BæS²—G2÷&–v–æÂF—2W‡FVæ@¢òò–çFògWGW&R7&6·2âÖV7W&Rw&÷wF‚F÷v&BF†R7GVÂ7&6¶VB&÷&FW"à¢f÷"†6öç7Bf6Röb7&6¶VEFV×ÆFRæf6W2’°¢ÆWB7‚ÒÂ7’Ò°¢f÷"†6öç7B–æFW‚öbf6Ræ’’²7‚³Òe¶–æFW‚¢5Ó²7’³Òe¶–æFW‚¢2²Ó²Ð¢–b‚&W6VçB†æöFRævVöÖWG'’Â7‚òf6Ræ’æÆVæwF‚Â7’òf6Ræ’æÆVæwF‚ÂG'VR’’6öçF–çVS°¢f÷"†6öç7B–æFW‚öbf6Ræ’’°¢6öç7B’Ò–æFW‚¢2ÂBÒ‡e¶•ÒÒ‚’¢¢"²‡e¶’²ÒÒ’’¢¢#°¢–b†Bâf"’²f"ÒC²W‚Ò‚²‡e¶•ÒÒ‚’¢ãs²W’Ò’²‡e¶’²ÒÒ’’¢ãs²Ð¢Ð¢Ð¢&WGW&â²‚Â’ÂW‚ÂW’Ó°¢Ò“°¢6öç7B&W—%7FFRÒ‚’Óâ‡²FÖvS¢&W—&VBæFÖvRæFÖvRÂ†öÆW3¢&W—&VBæFÖvRæ†öÆW2Â7&6·3¢&W—&VBæFÖvRæ7&6·2ÂfW'6–öã¢&W—&VBæFÖvRçfW'6–öâÀ¢6VçFW'3¢6VçFW'2æf–ÇFW"‡Óâ&W—&VBæFÖvRæ6öçF–ç2‡ç‚Âç’’’æÆVæwF‚ÂVFvW3¢6VçFW'2æf–ÇFW"‡Óâ&W—&VBæFÖvRæ6öçF–ç2‡æW‚ÂæW’’’æÆVæwF‚Ò“°¢6öç7BV×G’Ò&W—%7FFR‚“²&W—&VBæFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä„TÅôDTÄ’Òã“°¢6öç7BV–WBÒ&W—%7FFR‚“²&W—&VBæFÖvRçWFFRƒã²æVÅF–ÖR¢ã#R“°¢6öç7BV'FW"Ò&W—%7FFR‚“²&W—&VBæFÖvRçWFFR‡æVÅF–ÖR¢ãR“°¢6öç7BF‡&VUV'FW"Ò&W—%7FFR‚“²&W—&VBæFÖvRçWFFR‡æVÅF–ÖR¢ã#R²ã“°¢6öç7BæW2Ò&W—%7FFR‚“²&W—&VBæFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä5$4µô„TÅõD”ÔR¢ãR“°¢6öç7B7&6·2Ò&W—%7FFR‚“²&W—&VBæFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä5$4µô„TÅõD”ÔR¢ãR²ã“°¢6öç7B&W7F÷&VBÒ&W—%7FFR‚“²&W—&VBæFÖvRæF—7÷6R‚“°¢&V6÷&B‚&Ö—'&÷"FÖvS¢æR&÷&FW'2&R–æFWVæFVçBöbF†Rf—'7B–×7BæBWfW'’Ö—76–æræRw&÷w2g&öÒ—G2f—†VB6VçFW"&Vf÷&R7&6·26VÂ"Âf—†VDÆ–÷WBbb6VçFW'2æÆVæwF‚âbbV×G’æ†öÆW2ÓÓÒ6VçFW'2æÆVæwF‚bbV×G’æ6VçFW'2bbV×G’æVFvW2bbV–WBçfW'6–öâÓÓÒV×G’çfW'6–öâbbV–WBæFÖvRÓÓÒV×G’æFÖvP¢bbV'FW"æ6VçFW'2ÓÓÒ6VçFW'2æÆVæwF‚bbV'FW"æVFvW2bbV'FW"æ†öÆW2ÓÓÒV×G’æ†öÆW2bbV'FW"æ7&6·2ÓÓÒV×G’æ7&6·2bbV'FW"æFÖvRÂV×G’æFÖvP¢bbF‡&VUV'FW"æ6VçFW'2ÓÓÒ6VçFW'2æÆVæwF‚bbF‡&VUV'FW"æVFvW2ÓÓÒ6VçFW'2æÆVæwF‚bbF‡&VUV'FW"æFÖvRÂV'FW"æFÖvRbbF‡&VUV'FW"æ7&6·2ÓÓÒV×G’æ7&6·0¢bbæW2æ†öÆW2bbæW2æVFvW2ÓÓÒ6VçFW'2æÆVæwF‚bbæW2æ7&6·2ÓÓÒV×G’æ7&6·2bb7&6·2æ†öÆW2bb7&6·2æ7&6·2âbb7&6·2æ7&6·2ÂæW2æ7&6·0¢bb&W7F÷&VBæFÖvRbb&W7F÷&VBæ†öÆW2bb&W7F÷&VBæ7&6·2Â¥4ôâç7G&–æv–g’‡²f—†VDÆ–÷WBÂ6÷VçC¢6VçFW'2æÆVæwF‚ÂV×G’ÂV–WBÂV'FW"ÂF‡&VUV'FW"ÂæW2Â7&6·2Â&W7F÷&VBÒ’“°¢6öç7B'&ö¶Vå&W—'2ÒµÓ°¢f÷"†6öç7BÖöFRöb²&6Æ÷6VB"Â&÷Vâ"Â'&W7F÷&VB%Ò’°¢6öç7BÒÒÖ¶R‚’Â÷&–v–æÂÒÒçæVÂævVöÖWG'“°¢–b†ÖöFRÓÓÒ'&W7F÷&VB"’ÒæFÖvRç&W7F÷&R‚“°¢VÇ6RÒæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRäÔ…ôDÔtRÂÓãBÂã‚Â“°¢6öç7BfW'6–öâÒÒæFÖvRçfW'6–öã°¢ÒæFÖvRçWFFRƒ’ÂÖöFRÓÒ&÷Vâ"“°¢6öç7Bv—F–ærÒÒæFÖvRæ'&ö¶VâbbÒæFÖvRæFÖvRÓÓÒ$ÂæÖ—'&÷$FÖvRäÔ…ôDÔtRbbÒæFÖvRçfW'6–öâÓÓÒfW'6–öâbbÒçæVÂævVöÖWG'’æf6W2æÆVæwFƒ°¢ÒæFÖvRçWFFR†ÖöFRÓÓÒ&÷Vâ"ò#C¢ÂÖöFRÓÒ&÷Vâ"“°¢6öç7BFVÆ’ÒÒæFÖvRæ'&ö¶VâbbÒæFÖvRçfW'6–öâÓÓÒfW'6–öã°¢ÒæFÖvRçWFFR‡æVÅF–ÖR¢ã#RÂG'VR“°¢6öç7Bw&÷v–ærÒÒæFÖvRæ'&ö¶VâbbÒæFÖvRçæVÄ†VÇF‚æWfW'’†‡Óâ‡ÓÓÒ"’bbÒçæVÂævVöÖWG'’æf6W2æÆVæwF‚â°¢6öç7Bw&÷wF…fW'6–öâÒÒæFÖvRçfW'6–öâÂw&÷wF„FÖvRÒÒæFÖvRæFÖvS°¢ÒæFÖvRçWFFRƒ#CÂfÇ6R“°¢6öç7BW6VBÒÒæFÖvRçfW'6–öâÓÓÒw&÷wF…fW'6–öâbbÒæFÖvRæFÖvRÓÓÒw&÷wF„FÖvS°¢ÒæFÖvRçWFFR‡æVÅF–ÖR¢ãsR²$ÂæÖ—'&÷$FÖvRä5$4µô„TÅõD”ÔR²ãÂG'VR“°¢6öç7B6ö×ÆWFRÒÒæFÖvRæ'&ö¶VâbbÒæFÖvRæFÖvRÓÓÒbbÒçæVÂævVöÖWG'’ÓÓÒ÷&–v–æÃ°¢'&ö¶Vå&W—'2çW6‚‡²ÖöFRÂv—F–ærÂFVÆ’Âw&÷v–ærÂW6VBÂ6ö×ÆWFRÒ“²ÒæFÖvRæF—7÷6R‚“°¢Ð¢&V6÷&B‚&Ö—'&÷"FÖvS¢gVÆÇ’6†GFW&VBæB&W7F÷&VBÖ—'&÷'2v—B#6V6öæG2Â&Vw&÷röæÇ’v—F‚6Æ÷6VBvFRæBW6Rv—F†÷WB§V×–ærv†–ÆR÷Vâ"Â'&ö¶Vå&W—'2æWfW'’‡&÷rÓâ&÷rçv—F–ærbb&÷ræFVÆ’bb&÷ræw&÷v–ærbb&÷rçW6VBbb&÷ræ6ö×ÆWFR’Â¥4ôâç7G&–æv–g’†'&ö¶Vå&W—'2’“°¢6öç7B7&6´öæÇ’ÒÖ¶R‚“²7&6´öæÇ’æFÖvRæ†—Bƒ3Âã"ÂãÂ“°¢6öç7Bf—'7D7&6²Ò7&6´öæÇ’æFÖvRæ7&6·2Â7&6µfW'6–öâÒ7&6´öæÇ’æFÖvRçfW'6–öã°¢7&6´öæÇ’æFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä„TÅôDTÄ’Òã“°¢6öç7Bv—FVBÒ7&6´öæÇ’æFÖvRçfW'6–öâÓÓÒ7&6µfW'6–öâbb7&6´öæÇ’æFÖvRæ7&6·2ÓÓÒf—'7D7&6³°¢7&6´öæÇ’æFÖvRçWFFRƒã²$ÂæÖ—'&÷$FÖvRä5$4µô„TÅõD”ÔRò"“°¢6öç7B†Æd7&6²Ò7&6´öæÇ’æFÖvRæ7&6·2ÂæõæU†6RÒ7&6´öæÇ’æFÖvRæ†öÆW2ÓÓÒ°¢7&6´öæÇ’æFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä5$4µô„TÅõD”ÔRò"²ã“°¢6öç7B7&6µ&W7F÷&VBÒ7&6´öæÇ’æFÖvRæFÖvRÓÓÒbb7&6´öæÇ’æFÖvRæ7&6·2ÓÓÒbb7&6´öæÇ’æFÖvRæ†öÆW2ÓÓÒ°¢7&6´öæÇ’æFÖvRæF—7÷6R‚“°¢&V6÷&B‚&Ö—'&÷"FÖvS¢7&6²ÖöæÇ’FÖvRv—G2V–WFÇ’F†Vâ6VÇ2F—&V7FÇ’v—F†÷WBÖ—76–ær×æR†6R"Âv—FVBbbæõæU†6Rbb†Æd7&6²âbb†Æd7&6²Âf—'7D7&6²bb7&6µ&W7F÷&VBÂ¥4ôâç7G&–æv–g’‡²v—FVBÂf—'7D7&6²Â†Æd7&6²ÂæõæU†6RÂ7&6µ&W7F÷&VBÒ’“°¢6öç7B6VÆ–æt†—G2ÒµÒÂf6T¶W’Ò†vVòÂf6R’Óâf6Ræ’æÖ†–æFW‚Óâ'&’æg&öÒ†vVòçfW'G2ç7V&'&’†–æFW‚¢2Â–æFW‚¢2²2’’æ¦ö–â‚"Â"’’ç6÷'B‚’æ¦ö–â‚'Â"“°¢f÷"†6öç7B&öw&W72öb³ã#RÂãRÂãsUÒ’°¢6öç7BÒÒÖ¶R‚“²ÒæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtR²“bÂã"ÂãÂ“°¢6öç7B6†&BÒÒç&ö÷Bæ6†–ÆG&Vâæf–æB†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒÒçæVÂ’Â7G'V6²Ò6†&BævVöÖWG'“°¢6öç7B‚Ò6†&Bç÷6—F–öâç‚Â’Ò6†&Bç÷6—F–öâç“°¢ÒæFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä„TÅôDTÄ’²æVÅF–ÖR²$ÂæÖ—'&÷$FÖvRä5$4µô„TÅõD”ÔR¢&öw&W72“°¢6öç7B&Vf÷&RÒÒçæVÂævVöÖWG'’Â&Vf÷&T7&6·2ÒÒæFÖvRæ7&6·2Â6ö×ÆWFRÒÒæFÖvRæ†öÆW2bbÒæFÖvRæ6öçF–ç2‡‚Â’“°¢6öç7B†—BÒÒæFÖvRæ†—Bƒ‚Â‚Â’Â’ÂgFW"ÒÒçæVÂævVöÖWG'’Â¶W—2ÒæWr6WB†gFW"æf6W2æÖ†f6RÓâf6T¶W’†gFW"Âf6R’’“°¢ÆWB&VÖ÷FRÒÂ6†ævVBÒ°¢f÷"†6öç7Bf6Röb&Vf÷&Ræf6W2’°¢ÆWB7‚ÒÂ7’Ò°¢f÷"†6öç7B–æFW‚öbf6Ræ’’²7‚³Ò&Vf÷&RçfW'G5¶–æFW‚¢5Ó²7’³Ò&Vf÷&RçfW'G5¶–æFW‚¢2²Ó²Ð¢–b‡&W6VçB‡7G'V6²Â7‚òf6Ræ’æÆVæwF‚Â7’òf6Ræ’æÆVæwF‚ÂG'VR’’6öçF–çVS°¢&VÖ÷FR²³²–b‚¶W—2æ†2†f6T¶W’†&Vf÷&RÂf6R’’’6†ævVB²³°¢Ð¢6öç7BfW'6–öâÒÒæFÖvRçfW'6–öã²ÒæFÖvRçWFFR„$ÂæÖ—'&÷$FÖvRä„TÅôDTÄ’Òã“°¢6VÆ–æt†—G2çW6‚‡²&öw&W72Â&Vf÷&T7&6·2Â6ö×ÆWFRÂ†—BÂ&VÖ÷FRÂ6†ævVBÂV–WC¢ÒæFÖvRçfW'6–öâÓÓÒfW'6–öâÒ“²ÒæFÖvRæF—7÷6R‚“°¢Ð¢&V6÷&B‚&Ö—'&÷"FÖvS¢†—G2GW&–ærf–æÂ7&6²6VÆ–ær&W6W'fRWfW'’VçF÷V6†VBæR6öçF÷W"æB&W7F'BF†RV–WBFVÆ’"Â6VÆ–æt†—G2æWfW'’‡&÷rÓâ&÷ræ6ö×ÆWFRbb&÷ræ†—Bbb&÷ræ&Vf÷&T7&6·2âbb&÷ræ&Vf÷&T7&6·2Âbb&÷rç&VÖ÷FRâ#bb&÷ræ6†ævVBbb&÷rçV–WB’Â¥4ôâç7G&–æv–g’‡6VÆ–æt†—G2’“°¢6öç7BÆö6Æ—G’ÒµÓ°¢f÷"†6öç7B‚öb²Óã‚Âã…Ò’°¢6öç7BÒÒÖ¶R‚“²ÒæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtRÂÂÂ“²ÒæFÖvRæ†—BƒB¢$ÂæÖ—'&÷$FÖvRåäTÅô„TÅD‚Â‚ÂãÂ“°¢6öç7B6†&G2ÒÒç&ö÷Bæ6†–ÆG&Vâæf–ÇFW"†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒÒçæVÂ“°¢6öç7BÖVâÒ6†&G2ç&VGV6R‚‡7VÒÂæöFR’Óâ7VÒ²æöFRç÷6—F–öâç‚Â’ò6†&G2æÆVæwFƒ°¢Æö6Æ—G’çW6‚‡²‚Â6÷VçC¢6†&G2æÆVæwF‚ÂÖVâÒ“²ÒæFÖvRæF—7÷6R‚“°¢Ð¢6öç7BÒÒÖ¶R‚“²ÒæFÖvRæ†—B„$ÂæÖ—'&÷$FÖvRåäTÅôDÔtR²CBÂã"ÂãÂ“°¢6öç7Bg&vÖVçBÒÒç&ö÷Bæ6†–ÆG&Vâæf–æB†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒÒçæVÂ“°¢6öç7B‚Òg&vÖVçBç÷6—F–öâç‚Â’Òg&vÖVçBç÷6—F–öâç’Âv4Ö—76–ærÒÒæFÖvRæ6öçF–ç2‡‚Â’“°¢ÒæFÖvRçWFFRƒ"“°¢6öç7B&Vf÷&RÒÒçæVÂævVöÖWG'’Â&Vw&÷vä6VçFW"ÒÒæFÖvRæ6öçF–ç2‡‚Â’’Â&Vf÷&TFÖvRÒÒæFÖvRæFÖvS°¢6öç7BÖ„g&vÖVçG2ÒÖF‚æ6V–Âƒ‚òÖF‚æÖ–â‚ââæÒæFÖvRçæVÄ†VÇF‚æf–ÇFW"††VÇF‚Óâ†VÇF‚â’’“°¢ÒæFÖvRæ†—Bƒ‚Â‚Â’Â“°¢6öç7B6†&G2ÒÒç&ö÷Bæ6†–ÆG&Vâæf–ÇFW"†æöFRÓâæöFRçf—6–&ÆRbbæöFRæÖ—'&÷%6†&BÓÓÒÒçæVÂ’æÖ†æöFRÓâæöFRævVöÖWG'’“°¢ÆWB÷fW$†öÆRÒÂ&VÖ÷FU&VÖ÷fVBÒÂ†öÆTf–ÆÆVBÒÂ&VÖ÷fVBÒÂ6×ÆW2Ò°¢f÷"†6öç7BvVòöb6†&G2’f÷"†6öç7Bf6RöbvVòæf6W2’°¢–b†vVòçfW'G5¶f6Ræ•³Ò¢2²%ÒÓÒ’6öçF–çVS°¢6öç7B2ÒvVòæÖ—'&÷%6÷W&6RÂÒf6Ræ•³Ò¢2Â"Òf6Ræ•³Ò¢2Â2Òf6Ræ•³%Ò¢3°¢f÷"†ÆWB’Ò²’ÂS²’²²’f÷"†ÆWB¢Ò²¢ÂRÒ“²¢²²’°¢6öç7BRÒ†’²ã"’òRÂBÒ†¢²ã"’òS°¢6öç7B‚Ò5¶Ò¢ƒÒRÒB’²5¶%Ò¢R²5¶5Ò¢BÂ’Ò5¶²Ò¢ƒÒRÒB’²5¶"²Ò¢R²5¶2²Ò¢C°¢6×ÆW2²³²–b‚&W6VçB†&Vf÷&RÂ‚Â’’’÷fW$†öÆR²³°¢Ð¢Ð¢f÷"†ÆWB—‚Ò²—‚Âc²—‚²²’f÷"†ÆWB—’Ò²—’ÂC²—’²²’°¢6öç7B‚ÒÓ"ãCr²—‚¢Bã“BòcÂ’ÒÓãs"²—’¢2ã’òCÂv2Ò&W6VçB†&Vf÷&RÂ‚Â’’Âæ÷rÒÒæFÖvRæ6öçF–ç2‡‚Â’“°¢–b‚v2bbæ÷r’†öÆTf–ÆÆVB²³°¢–b‡v2bbæ÷r’²&VÖ÷fVB²³²–b‚6†&G2ç6öÖR†vVòÓâ&W6VçB†vVòÂ‚Â’ÂG'VR’’’&VÖ÷FU&VÖ÷fVB²³²Ð¢Ð¢6öç7B7VçBÒÒæFÖvRæFÖvRÒ&Vf÷&TFÖvS²ÒæFÖvRæF—7÷6R‚“°¢&V6÷&B‚&Ö—'&÷"FÖvS¢7V'6WVVçB–×7G26†ö÷6RæV&'’æW2æB–çFW''WFVB&W—"7VæG2&÷÷'F–öæÂ†VÇF‚v†–ÆRG&÷–æröæÇ’&W6VçBvÆ72"ÂÆö6Æ—G•³ÒæÖVâÂÓã‚bbÆö6Æ—G•³ÒæÖVââã‚bbÆö6Æ—G’æWfW'’‡&÷rÓâ&÷ræ6÷VçBÓÓÒB’bbv4Ö—76–ærbb&Vw&÷vä6VçFW"bbÖF‚æ'2‡7VçBÒ‚’ÂRÓ’bb6†&G2æÆVæwF‚âbb6†&G2æÆVæwF‚ÃÒÖ„g&vÖVçG2bb6×ÆW2âbb&VÖ÷fVBâbb÷fW$†öÆRbb&VÖ÷FU&VÖ÷fVBbb†öÆTf–ÆÆVBÂ¥4ôâç7G&–æv–g’‡²Æö6Æ—G’Âv4Ö—76–ærÂ&Vw&÷vä6VçFW"Â7VçBÂÖ„g&vÖVçG2Â6†&G3¢6†&G2æÆVæwF‚Â6×ÆW2Â&VÖ÷fVBÂ÷fW$†öÆRÂ&VÖ÷FU&VÖ÷fVBÂ†öÆTf–ÆÆVBÒ’“°¢Ð¢°¢6öç7B2Ò$Âç66VæRÂ&ö÷BÒ2æ7&VFTæöFR‚’Â÷væW'2ÒµÒÂFÖvRÒµÒÂÆ–W"Ò·ÒÂ7—7FVÒÒ$Âæ'&V¶&ÆW2æ7&VFR‡²&ö÷BÂ&VæFW&W#¢·ÒÂgƒ¢²'W'7B‚’·ÒÂFÖvTçVÖ&W"‡‚Â’Â¢ÂÖ÷VçB’²FÖvRçW6‚‡²‚Â’Â¢ÂÖ÷VçBÒ“²ÒÒÂ7&Ws¢²Æ–W"ÒÀ¢FV7F—fFR†÷væW"’²÷væW"æ7F—fRÒ÷væW"ææöFRçf—6–&ÆRÒfÇ6S²ÒÂ&VÆö6FS¢‚’ÓâfÇ6RÂ6öÆÆV7E&Wv&C¢‚’ÓâfÇ6RÒ“°¢f÷"†ÆWB’Ò²’Â#c²’²²’°¢6öç7B÷væW"Ò²¶–æC¢'&÷"Â&÷¢&7&FR"ÂæöFS¢2æ7&VFTæöFR‡²vVöÖWG'“¢$ÂæÖöFVÇ2æ&÷‚‡²s¢Âƒ¢ÂC¢Â6öÆ÷#¢"3ƒƒƒƒƒ‚"Ò’Ò’Â7F—fS¢G'VRÓ°¢2æFD6†–ÆB‡&ö÷BÂ÷væW"ææöFR“²÷væW'2çW6‚†÷væW"“²7—7FVÒç&Vv—7FW"†÷væW"“°¢Ð¢6öç7B6÷VçBÒ&ö÷Bæ6†–ÆG&VâæÆVæwF‚Â6ÖRÒ7—7FVÒç&Vv—7FW"†÷væW'5³Ò’ÓÓÒ÷væW'5³Òæ'&V¶&ÆS°¢ÆWB&VgW6VBÒfÇ6S°¢G'’²7—7FVÒç&Vv—7FW"‡²¶–æC¢'&÷"Â&÷¢&7&FR"Ò“²Ò6F6‚†W'&÷"’²&VgW6VBÒW'&÷"æÖW76vRÓÓÒ$÷WFFö÷"'&V¶&ÆR66—G’W†6VVFVB#²Ð¢6öç7B—FVÒÒ÷væW'5³Òæ'&V¶&ÆS°¢7—7FVÒæ†—B†çVÆÂÂ²÷væW#¢÷væW'5³ÒÂƒ¢Â“¢Â£¢Ò“°¢6öç7Bg&7F–öæÂÒ²÷væW#¢÷væW'5³ÒÂƒ¢Â“¢Â£¢Ó°¢7—7FVÒæ†—B‡Æ–W"Âg&7F–öæÂÂã#R“²7—7FVÒæ†—B‡Æ–W"Âg&7F–öæÂÂ"“²7—7FVÒæ†—B‡Æ–W"Âg&7F–öæÂÂ"“°¢7—7FVÒæ†—B‡Æ–W"Â²÷væW#¢÷væW'5³%ÒÂƒ¢Â“¢Â£¢ÒÂ“°¢7—7FVÒæ†—B‡·ÒÂ²÷væW#¢÷væW'5³%ÒÂƒ¢Â“¢Â£¢ÒÂã#R“°¢7—7FVÒæ†—B†çVÆÂÂ²÷væW#¢÷væW'5³5ÒÂƒ¢Â“¢Â£¢ÒÂã#R“°¢7—7FVÒæ†—B‡·ÒÂ²÷væW#¢÷væW'5³EÒÂƒ¢Â“¢Â£¢ÒÂãRÂG'VR“°¢7—7FVÒæ†—B†çVÆÂÂ²÷væW#¢²¶–æC¢'&÷"ÒÂƒ¢Â“¢Â£¢Ò“°¢&V6÷&B‚&'&V¶&ÆRFÖvRçVÖ&W'3¢öæÇ’Æ–W"GF6·26†÷rgVÆÂ†—B÷vW"Â–æ6ÇVF–ær÷fW&¶–ÆÂÂv†–ÆRå2GF6·27F–ÆÂFÖvRö&¦V7G2"ÂFÖvRæÆVæwF‚ÓÓÒ2bbFÖvRæÖ††—BÓâ†—BæÖ÷VçB’æ¦ö–â‚’ÓÓÒ#Ã‚Ãb"bbFÖvRæWfW'’††—BÓâ†—Bç’âãR’bb÷væW'5³Òæ'&V¶&ÆRæ†VÇF‚ÓÓÒbb÷væW'5³%Òæ'&V¶&ÆRæ†VÇF‚ÓÓÒ2bb÷væW'5³5Òæ'&V¶&ÆRæ†VÇF‚ÓÓÒ2Â¥4ôâç7G&–æv–g’†FÖvR’“°¢7—7FVÒçWFFRƒÂ—FVÒç&W7väB“°¢6öç7BFVfW'&VBÒ—FVÒæ'&ö¶Vâbb÷væW'5³Òæ7F—fRbb—FVÒç&Wv&Bbb—FVÒç&W7väBâ°¢6öç7B&Wv&DæöFW2Ò7—7FVÒæÆ—7BæÖ‡&V6÷&BÓâ&V6÷&BææöFR“²7—7FVÒæF—7÷6R‚“°¢&V6÷&B‚&'&V¶&ÆR&÷3¢&Vv—7G&F–öâ—2&÷VæFVBæB–FV×÷FVçBÂVæf–Æ&ÆR&W7vç2FVfW"ÂæBF—7÷6Â&VÖ÷fW2WfW'’–6·W"Â6ÖRbb&VgW6VBbb6÷VçBÓÓÒS"bbFVfW'&VBbb7—7FVÒæÆ—7BæÆVæwF‚ÓÓÒbb&ö÷Bæ6†–ÆG&VâæÆVæwF‚ÓÓÒ#bbb÷væW'2æWfW'’†÷væW"Óâ÷væW"æ'&V¶&ÆRÓÓÒçVÆÂ’bb&Wv&DæöFW2æWfW'’†æöFRÓâæöFRç&VçBÓÓÒçVÆÂ’bb7—7FVÒç7FG2‚’æ'&V¶&ÆW5&Wv&G2ÓÓÒÂ¥4ôâç7G&–æv–g’‡²6ÖRÂ&VgW6VBÂ6÷VçBÂFVfW'&VBÂ6†–ÆG&Vã¢&ö÷Bæ6†–ÆG&VâæÆVæwF‚Ò’“°¢Ð ¢°¢6öç7B"Ò6öçfW…&ö&R‚“°¢&V6÷&B‚&6öçfW‚6öÆÆ—6–öã¢7–Æ–æFW"6öçF7BæB7vWBF†–â×vÆÂ6öÆÆ—6–öç2w&VRv—F‚–æFWVæFVçB&÷‚÷&6ÆW2"Â"ç7FF–öæ'’ÓÓÒ#bb"ç7vWBÓÓÒS‚bb"æ6öçF7G2ÓÓÒRbb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡"’“°¢&V6÷&B‚&6öçfW‚6öÆÆ—6–öã¢ö&Æ—VRg&vÖVçG2æBFWG&†VG&öâ–çFW&–÷'2&W6W'fRW†7B6öçF7B&÷VæF&–W2"Â"ç&÷FFVBÓÓÒbb"çFWG&†VG&ÓÓÒSbb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡"’“°¢&V6÷&B‚&6öçfW‚6öÆÆ—6–öã¢F–ÇFVB6V–Æ–æw26ÆV"w&¦–ær&öF–W2æB&Æö6²VæWG&F–öç2æB7&÷76–ær7vVW2"Â"çF–ÇFVBÓÓÒbb"æ6V–Æ–ærÓÓÒBbb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡"’“°¢Ð ¢°¢òò&Vw&W76–öã¢F–ÇFVBv÷&–ÆÆf—G2&×v†W&RâW&–v‡B7–Æ–æFW"FöW0¢òòæ÷Bâ—G2&WÆ6VÖVçB‡VÆÂVW'’×W7B7F–ÆÂ6F6‚F†–â7&÷76VB7FöæRà¢6öç7B÷fW&ÆÒ$Âæ6öçfW‚æ‡VÆÇ4÷fW&ÆÂ&æFöÒÒ$ÂæÖF‚æ×VÆ&W''“3"ƒƒC3cB’Âf–ÇW&W2ÒµÓ°¢6öç7BF÷BÒ†Â"’Óâç&VGV6R‚‡7VÒÂâÂ’’Óâ7VÒ²â¢%¶•ÒÂ“°¢6öç7B7&÷72Ò†Â"’Óâ¶³Ò¦%³%ÒÖ³%Ò¦%³ÒÂ³%Ò¦%³ÒÖ³Ò¦%³%ÒÂ³Ò¦%³ÒÖ³Ò¦%³ÕÓ°¢6öç7B&÷‚Ò‡–rÂ—F6‚Â6VçFW"Â†Æb’Óâ°¢6öç7B2ÒÖF‚æ6÷2‡–r’Â2ÒÖF‚ç6–â‡–r’Â7ÒÖF‚æ6÷2‡—F6‚’Â7ÒÖF‚ç6–â‡—F6‚“°¢6öç7B†W2Òµ¶2ÂÂ×5ÒÂ·2§7Â7Â2§7ÒÂ·2¦7Â×7Â2¦7ÕÒÂfW'F–6W2ÒµÓ°¢f÷"†ÆWB’Ò²’Âƒ²’²²’f÷"†ÆWB²Ò²²Â3²²²²’°¢fW'F–6W2çW6‚†6VçFW%¶µÒ²†W2ç&VGV6R‚‡7VÒÂ†—2Â¢’Óâ7VÒ²†—5¶µÒ¢†Æe¶¥Ò¢†’bÃÂ¢ò¢Ó’Â’“°¢Ð¢&WGW&â²†W2ÂfW'F–6W2Â6VçFW"Â†ÆbÓ°¢Ó°¢òò–æFWVæFVçB6W&F–ærÖ†—2÷&6ÆRÂ&F†W"F†âæ÷F†W"t¤²VW'’à¢6öç7B6W&FVBÒ†Â"’Óâ°¢6öç7BFVÇFÒæ6VçFW"æÖ‚†âÂ’’ÓââÒ"æ6VçFW%¶•Ò“°¢&WGW&â²ââææ†W2Âââæ"æ†W2Âââææ†W2æfÆDÖ‡‚Óâ"æ†W2æÖ‡’Óâ7&÷72‡‚Â’’’•Òç6öÖR††—2Óâ°¢–b„ÖF‚æ‡—÷B‚ââæ†—2’ÂRÓ’&WGW&âfÇ6S°¢6öç7BW‡FVçBÒæ†W2ç&VGV6R‚‡7VÒÂbÂ’’Óâ7VÒ²ÖF‚æ'2†F÷B††—2Âb’’¢æ†Æe¶•ÒÂ¢²"æ†W2ç&VGV6R‚‡7VÒÂbÂ’’Óâ7VÒ²ÖF‚æ'2†F÷B††—2Âb’’¢"æ†Æe¶•ÒÂ“°¢&WGW&âÖF‚æ'2†F÷B†FVÇFÂ†—2’’ãÒW‡FVçBÒRÓs°¢Ò“°¢Ó°¢ÆWB6×ÆW2Ò°¢f÷"ƒ²6×ÆW2Â#²6×ÆW2²²’°¢6öç7BÒ&÷‚‡&æFöÒ‚’£bã#‚Â&æFöÒ‚’£"ÓÂ³ÂÂÒÂ·&æFöÒ‚’²ãÂ&æFöÒ‚’²ãÂ&æFöÒ‚’²ãÒ“°¢6öç7B"Ò&÷‚‡&æFöÒ‚’£bã#‚Â&æFöÒ‚’£"ÓÂ·&æFöÒ‚’£BÓ"Â&æFöÒ‚’£BÓ"Â&æFöÒ‚’£BÓ%ÒÂ·&æFöÒ‚’²ãÂ&æFöÒ‚’²ãÂ&æFöÒ‚’²ãÒ“°¢–b†÷fW&Æ†çfW'F–6W2Â"çfW'F–6W2’ÓÓÒ6W&FVB†Â"’bbf–ÇW&W2æÆVæwF‚Â‚’f–ÇW&W2çW6‚‡²6×ÆW2ÂÂ"Ò“°¢Ð¢6öç7B7FöæRÒ&÷‚ƒÂÂ³ÂÂÒÂ²ã"ÂÂÒ“°¢6öç7Bg&öÒÒ&÷‚‚ã"Âã2Â²Ó2ÂÂÒÂ²ãBÂã2ÂãEÒ’ÂFòÒ&÷‚‚ã"Âã2Â³2ÂÂÒÂ²ãBÂã2ÂãEÒ“°¢6öç7B7vWBÒ÷fW&Æ†g&öÒçfW'F–6W2Â7FöæRçfW'F–6W2’bb÷fW&Æ‡FòçfW'F–6W2Â7FöæRçfW'F–6W2¢bb÷fW&Æ…²ââæg&öÒçfW'F–6W2ÂââçFòçfW'F–6W5ÒÂ7FöæRçfW'F–6W2“°¢6öç7B&6RÒ&÷‚ƒÂÂ³ÂÂÒÂ²ãRÂãRÂãUÒ“°¢6öç7B6öçF7BÒ³ÓRÓRÂÂ³RÓUÒæWfW'’‡’Óâ÷fW&Æ†&6RçfW'F–6W2Â&÷‚ƒÂÂ³Â’ÂÒÂ²ãRÂãRÂãUÒ’çfW'F–6W2’ÓÓÒ‡’Â’“°¢&V6÷&B‚&6öçfW‚6öÆÆ—6–öã¢÷6VB&öG’‡VÆÇ2w&VRv—F‚–æFWVæFVçB÷&–VçFVBÖ&÷‚6W&F–öâÂ&W6W'fR6öçF7BÂæB6F6‚7&÷76VBF†–âvÆÇ2"À¢6×ÆW2ÓÓÒ#bbf–ÇW&W2æÆVæwF‚ÓÓÒbb7vWBbb6öçF7BÂ¥4ôâç7G&–æv–g’‡²6×ÆW2Âf–ÇW&W2Â7vWBÂ6öçF7BÒ’“°¢Ð ¢°¢6öç7B†—BÒ$Âæ6öçfW‚ç7vWD7–Æ–æFW"Â&æFöÒÒ$ÂæÖF‚æ×VÆ&W''“3"ƒƒCr’ÂG&–ævÆRÒæWrfÆöCcD'&’ƒ’’Â&WVFVBÒæWrfÆöCcD'&’ƒ‚“°¢ÆWB6×ÆW2ÒÂF–ffW&Væ6W2ÒÂ6öçF7G2ÒÂ&÷VæF&–W2Ò°¢6öç7B6ö×&RÒ‚ââæ&w2’Óâ°¢òò&WVF–ærWfW'’fW'FW‚&W6W'fW2F†—26öçfW‚‡VÆÂæB—G26VçG&ö–B'W@¢òò'—76W2F†RG&–ævÆRÖöæÇ’6†÷'F7WBÂW†W&6—6–ærF†R÷&–v–æÂt¤²F‚à¢&WVFVBç6WB‡G&–ævÆR“²&WVFVBç6WB‡G&–ævÆRÂ’“°¢6öç7BW‡V7FVBÒ†—B‡&WVFVBÂââæ&w2’Â7GVÂÒ†—B‡G&–ævÆRÂââæ&w2“°¢F–ffW&Væ6W2³Ò²†7GVÂÓÒW‡V7FVB“²6öçF7G2³Ò¶W‡V7FVC²6×ÆW2²³°¢Ó°¢f÷"†ÆWB’Ò²’ÂS²’²²’°¢6öç7B66ÆRÒ’R’ÓÓÒòòcSS3b¢’R’ÓÓÒò#B¢°¢6öç7BfÇVRÒ‚’Óâ„ÖF‚æfÆö÷"‡&æFöÒ‚’¢#C‚’Ò#B’¢66ÆRò#Sc°¢f÷"†ÆWB¢Ò²¢ÂG&–ævÆRæÆVæwFƒ²¢²²’G&–ævÆU¶¥ÒÒfÇVR‚“°¢–b†’RrÓÓÒ’G&–ævÆU³ÒÒG&–ævÆU³EÒÒG&–ævÆU³uÒÒfÇVR‚“°¢–b†’R2ÓÓÒ’f÷"†ÆWB¢Ò²¢Â3²¢²²’G&–ævÆU³b²¥ÒÒG&–ævÆU¶¥Ó°¢6öç7B‚ÒfÇVR‚’Â’ÒfÇVR‚’Â¢ÒfÇVR‚’ÂÖ÷f–ærÒ’RBÓÓÒ°¢6öç7B&F—W2ÒÖF‚æ'2‡fÇVR‚’’Â†V–v‡BÒÖF‚æ'2‡fÇVR‚’“°¢6ö×&R‡‚Â’Â¢ÂÖ÷f–æròfÇVR‚’¢‚ÂÖ÷f–æròfÇVR‚’¢’ÂÖ÷f–æròfÇVR‚’¢¢À¢&F—W2Â†V–v‡BÂÖF‚æ'2‡fÇVR‚’’ÂÖF‚æ'2‡fÇVR‚’’“°¢Ð¢f÷"†6öç7Bvöb²Ó&RÓrÂÓRÓrÂÂRÓrÂ&RÓuÒ’°¢G&–ævÆRç6WB…³ÂÓ"ÂÓ"ÂÂ2Â"ÂÂ2ÂÓ%Ò“°¢6ö×&Rƒ²vÂÂÂ²vÂÂÂÂ“²&÷VæF&–W2²³°¢G&–ævÆRç6WB…²Ó"ÂÂÓ"ÂÂÂ"Â"ÂÂÓ%Ò“°¢6ö×&RƒÂvÂÂÂvÂÂãRÂ“²&÷VæF&–W2²³°¢6ö×&RƒÂÓ²vÂÂÂÓ²vÂÂãRÂ“²&÷VæF&–W2²³°¢Ð¢&V6÷&B‚&6öçfW‚6öÆÆ—6–öã¢7FF–öæ'’G&–ævÆR&V¦V7F–öâw&VW2v—F‚Væ6†ævVBt¤²f÷"f&–VB6—¦W2ÂFVvVæW&6–W2ÂÖ÷f–ær7vVW2æB6öVFvR6öçF7G2"À¢6×ÆW2ÓÓÒSRbb&÷VæF&–W2ÓÓÒRbb6öçF7G2âbbF–ffW&Væ6W2ÓÓÒÀ¢¥4ôâç7G&–æv–g’‡²6×ÆW2Â&÷VæF&–W2Â6öçF7G2ÂF–ffW&Væ6W2Ò’“°¢Ð¢°¢6öç7B"Òv—BÆ–fV†6…&ö&R‚“°¢&V6÷&B‚'&ööÒÆ–fT†6ƒ¢W†7Bc"–ÖvW2ÖF6‚–æFWVæFVçB&VfW&Væ6RfV7F÷'2Â–æ6ÇVF–ærUDbÓ‚æB6ö÷&F–æFRFöÖ–ç2"Â"çfV7F÷'2ÓÓÒBbb"ç&VfW&Væ6TÖF6†W2ÓÓÒBbb"ç6†TÖF6†W2ÓÓÒBbb"ç&WVDÖF6†W2ÓÓÒBbb"çVæ—VRÓÓÒBbb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡"’“°¢Ð¢°¢6öç7BÖW6†W2Ò6öÆ–E&÷5&ö&R‚“°¢f÷"†6öç7B&6¶VæBöb&6¶VæG2’&V6÷&B†6öÆ–B&÷2G¶&6¶VæGÓ¢7GVÂ&÷ÖW6†W2&Æö6²&öF–W2æB7W÷'BÆæF–æw27&÷72G&VR7&÷vç2v†–ÆR&W6W'f–ærF†RvFRw2÷Væ–æw6ÂÖW6†W2æÆVæwF‚ÓÓÒBbbÖW6†W2æWfW'’‚‡&÷r’Óâ&÷ræö²’Â¥4ôâç7G&–æv–g’†ÖW6†W2’“°¢Ð¢°¢6öç7B"Òv–æF÷tfÆ&U&ö&R‚“°¢&V6÷&B‚'v–æF÷rfÆ&W3¢ÆÂW†—7F–ærg&ÖW2&WF–âF†V—"–ææW"6—¦W2æBW‡æBF÷v&BF†R7GVÂ÷WFW"6†VÆÂ"Â"çv–æF÷w2æÆVæwF‚ÓÓÒ3bb"æfÖ–Æ–W5²$…&ööÒ%ÒÓÓÒrbb"æfÖ–Æ–W5²&&6VÖVçB&ööÒ%ÒÓÓÒbb"æfÖ–Æ–W5²$…&×%ÒÓÓÒbbb"æfÖ–Æ–W5²&&6VÖVçB&×%ÒÓÓÒbbb"æfÖ–Æ–W2çæ÷&ÖÓÓÒbb"çv–æF÷w2æWfW'’‚‡r’Óâræ÷WFW%v–GF‚âræ–ææW%v–GF‚bbræ÷WFW$†V–v‡Bâræ–ææW$†V–v‡Bbb‡ræ¶–æBÓÓÒ'&ööÒ"òræ–ææW%v–GF‚ÓÓÒ2ãRbbræ–ææW$†V–v‡BÓÓÒ"¢ræ¶–æBÓÓÒ'&×"òræ–ææW%v–GF‚ÓÓÒ2bbræ–ææW$†V–v‡BãÒãsR¢ræ–ææW$†V–v‡BÓÓÒ"ã#R’’Â¥4ôâç7G&–æv–g’‡²fÖ–Æ–W3¢"æfÖ–Æ–W2Âv–æF÷w3¢"çv–æF÷w2Ò’“°¢&V6÷&B‚'v–æF÷rfÆ&W3¢6Öö÷F‚ÖW&vVB&WfVÂG&–ævÆW2w&VRv—F‚6öÆ–B&ö6²Â6ÆV"—"ÂæB6öçF–çV÷W27–Æ–æFW"7vVW2"Â"æg&vÖVçG2âbb"æg&vÖVçG2ÂCbb"çF÷FÄf6W2Â##bb"æf6W2âbb"ç6×ÆW2âbb"ç7vVW2âbb"ç6Æ÷VBâbb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²g&vÖVçG3¢"æg&vÖVçG2ÂF÷FÄf6W3¢"çF÷FÄf6W2Âf6W3¢"æf6W2Â6×ÆW3¢"ç6×ÆW2Â7vVW3¢"ç7vVW2Â6Æ÷VC¢"ç6Æ÷VBÂf–ÇW&W3¢"æf–ÇW&W2Ò’“°¢&V6÷&B‚'v–æF÷rfÆ&W3¢æV–v†&÷&–æræB7F6¶VBW'GW&W2&WF–âF†R&WV—&VB&ö6²6W&F–öâF‡&÷Vv‚F†R6†VÆÂ"Â"ç—'2âbb"ç6W&F–öå6×ÆW2âSbb"ææV–v†&÷$vãÒ"ç&ö6´6÷fW"bb"ç7F6¶VDvãÒ"ç&ö6´6÷fW"bb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²—'3¢"ç—'2Â6×ÆW3¢"ç6W&F–öå6×ÆW2ÂæV–v†&÷$v¢"ææV–v†&÷$vÂ7F6¶VDv¢"ç7F6¶VDvÂ&WV—&VC¢"ç&ö6´6÷fW"Âf–ÇW&W3¢"æf–ÇW&W2Ò’“°¢&V6÷&B‚'v–æF÷rfÆ&W3¢WfW'’&ööÒ6VW2F‡&÷Vv‚—G2gVÆÂ–ææW"g&ÖRv—F†÷WB&WF–æVBvÆÂvVöÖWG'’"Â"ç&ööÕf–Ww2ÓÓÒrbb"ç&ööÕf–Wu&—2ÓÓÒ3bbb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²&öö×3¢"ç&ööÕf–Ww2Â&—3¢"ç&ööÕf–Wu&—2Âf–ÇW&W3¢"æf–ÇW&W2Ò’“°¢&V6÷&B‚'v–æF÷rfÆ&W3¢ÆÂGvVÇfR&×÷Væ–æw26ÆV"F†V—"&VæFW&VBfÆö÷'2Âv—F‚FVâg&ÖVBF‡&öG2æBGvò÷Vâ&Æ6öç’W†—G2"Â"ç&×g&ÖW2æÆVæwF‚ÓÓÒ"bb"ç&×g&ÖW2æf–ÇFW"†bÓâbæ÷Vä&Æ6öç’’æÆVæwF‚ÓÓÒ"bb"ç&×g&ÖW2æWfW'’‚†b’Óâbçv–GF‚ÓÓÒ2bbbæ†V–v‡BÓÓÒãsRbbbç6×ÆW2ÓÓÒcbbbæÖ—76–ærÓÓÒbbbæ6ÆV&æ6RãÒ"çVæ—BbbbçF‡&öD6ÆV&æ6RãÒ"çVæ—BbbbæfÆö÷%–V6W2âbbbæ–çFW'6V7F–öç2ÓÓÒbb†bæ÷Vä&Æ6öç’òbæ÷Vä6†V6·2ÓÓÒ’bbbæ÷Vä6ÆV"bbÖF‚æ'2†bæg&ÖRÒbæÖ&¶W"’ÂRÓrbbbæfÆö÷$W‡FVçBÃÒbæg&ÖR²RÓr¢bæg&ÖRâbæfÆö÷$W‡FVçBbbbæg&ÖRâbæÖ&¶W"’bbbçF‡&öEv–GF‚ÓÓÒ2bbbçF‡&öD†÷&—¦öçFÂÓÓÒbbbçF‡&öEfW'F–6ÂÓÓÒ’Â¥4ôâç7G&–æv–g’‡"ç&×g&ÖW2’“°¢&V6÷&B‚'v–æF÷rfÆ&W3¢F†Rv–FW"76vRFÖ—G2â&ö6‚÷WG6–FRF†RöÆBg&ÖRæB—G2fÆö÷"æB6V–Æ–ær&R6öçF–çV÷W26Æ÷W2"Â"æVæÆ&vVD–Òæ6ÆV"bb"æVæÆ&vVD–Òæ7&÷72â"æVæÆ&vVD–ÒæöÆD†Æev–GF‚bb"æVæÆ&vVD–Òçv–GF„†W&Râ"æVæÆ&vVD–ÒæöÆD†Æev–GF‚²ãBbb"æfÆö÷%6×ÆW2â3bb"æ6V–Æ–æu6×ÆW2âCbb"æfÆö÷$W'&÷"ÂRÓbbb"æ6V–Æ–ætW'&÷"ÂRÓbÂ¥4ôâç7G&–æv–g’‡²–Ó¢"æVæÆ&vVD–ÒÂfÆö÷%6×ÆW3¢"æfÆö÷%6×ÆW2Â6V–Æ–æu6×ÆW3¢"æ6V–Æ–æu6×ÆW2ÂfÆö÷$W'&÷#¢"æfÆö÷$W'&÷"Â6V–Æ–ætW'&÷#¢"æ6V–Æ–ætW'&÷"Ò’“°¢Ð¢°¢6öç7B&6VÖVçBÒ†VGV'FW'4&6VÖVçE&ö&R‚“°¢&V6÷&B‚&†VGV'FW'3¢6V6öæB6öÖÖöâfÆö÷"W6W2F†RÖ–æ–×VÒFWF‚F†B&W6W'fW2gVÆÂ†V–v‡BæB&ö6²&VæVF‚F†RWW"…"Â&6VÖVçBæ†V–v‡BÓÓÒBã#Rbb&6VÖVçBç&F—W2ÓÓÒ’bb&6VÖVçBæfÆö÷"ÂÓbb&6VÖVçBçWW$fÆö÷"ÓÓÒÓrbb&6VÖVçBçWW%7W÷'BÓÓÒÓrbb&6VÖVçBæ6V–Æ–ærÃÒ&6VÖVçBç&WV—&VD6V–Æ–ær²RÓrbb&6VÖVçBç&WV—&VD6V–Æ–ærÒ&6VÖVçBæ6V–Æ–ærÂ&6VÖVçBçVæ—B²RÓrbb&6VÖVçBç&ö6´6÷fW"ãÒãsRÂ¥4ôâç7G&–æv–g’†&6VÖVçB’“°¢&V6÷&B‚&†VGV'FW'3¢FVâVæ6Æ–ÖVB&6VÖVçB&öö×2†fRfÆBfÆö÷'2Â6ÆV"6öææV7FVB6÷'&–F÷'2ÂW‡FW&–÷"v–æF÷w2æB6öÆ–B6W&F–ær&ö6²"Â&6VÖVçBç&öö×2æÆVæwF‚ÓÓÒbb&6VÖVçBç&öö×2æWfW'’‚‡&ööÒÂ’’Óâ&ööÒæ–æFW‚ÓÓÒ’bb&ööÒæ&6VÖVçBbb&ööÒæfÆö÷"ÓÓÒ&6VÖVçBæfÆö÷"bb&ööÒæ6V–Æ–ærÓÓÒ&6VÖVçBæ6V–Æ–ærbb&ööÒç&F—W2ÓÓÒ‚bb&ööÒçv–GF‚ÓÓÒ†’ÂbòRãR¢R’bb&ööÒæFWF‚ÓÓÒRbb&ööÒæfÆö÷%6×ÆW2ãÒ#ƒ’bb&ööÒæ6÷'&–F÷%6×ÆW2âCbb&ööÒçvÆÇ2æWfW'’„&ööÆVâ’bb&ööÒçv–æF÷tfÆö÷"ÓÓÒ&6VÖVçBæfÆö÷"bb&ööÒç&W6–FVçBÓÓÒçVÆÂ’bb&6VÖVçBæ6öÖÖöå6×ÆW2âSbb&6VÖVçBç&ö6µ6×ÆW2âbb&6VÖVçBæf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²&öö×3¢&6VÖVçBç&öö×2Â6öÖÖöå6×ÆW3¢&6VÖVçBæ6öÖÖöå6×ÆW2Â&ö6µ6×ÆW3¢&6VÖVçBç&ö6µ6×ÆW2Âf–ÇW&W3¢&6VÖVçBæf–ÇW&W2Ò’“°¢&V6÷&B‚&†VGV'FW'3¢WfW'’&VæFW&VB&6VÖVçBfÆö÷"&WF–ç2&ö6²FòF†RæGW&ÂVæFW'6–FRæBWfW'’7F6¶VB&×6öÇVÖâ&W6W'fW2—G26V–Æ–ær6÷fW""Â&6VÖVçBæfÆö÷$6VÆÇ2âSbb&6VÖVçBç&VæFW$6VÆÇ2âSbb&6VÖVçBæfö÷F–æu6×ÆW2ÓÓÒ&6VÖVçBæfÆö÷$6VÆÇ2¢2bb&6VÖVçBæfö÷F–æu&ö6²âbb&6VÖVçBæfö÷F–æt—"âbb&6VÖVçBæfö÷F–æu&ö6²²&6VÖVçBæfö÷F–æt—"ÓÓÒ&6VÖVçBæfö÷F–æu6×ÆW2bb&6VÖVçBç7F6¶VD6VÆÇ2âbb&6VÖVçBæf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²fÆö÷$6VÆÇ3¢&6VÖVçBæfÆö÷$6VÆÇ2Â&VæFW$6VÆÇ3¢&6VÖVçBç&VæFW$6VÆÇ2Âfö÷F–æu6×ÆW3¢&6VÖVçBæfö÷F–æu6×ÆW2Âfö÷F–æu&ö6³¢&6VÖVçBæfö÷F–æu&ö6²Âfö÷F–æt—#¢&6VÖVçBæfö÷F–æt—"Â7F6¶VD6VÆÇ3¢&6VÖVçBç7F6¶VD6VÆÇ2Âf–ÇW&W3¢&6VÖVçBæf–ÇW&W2Ò’“°¢&V6÷&B‚&†VGV'FW'3¢F†RGvòf÷&ÖW"6V6öæBÖæV&W7BVçG&æ6W2FW66VæBvVçFÇ’–çFòF†R6ÖR&6VÖVçB6—&7VÆF–öâ&V"Â&6VÖVçBç&×2æÖ‚‡&×’Óâ&×æ–æFW‚’æ¦ö–â‚'Â"’ÓÓÒ#Ãr"bb&6VÖVçBç&×2æWfW'’‚‡&×’Óâ&×æf—'7BÓÓÒÓrbb&×æÆ7BÓÓÒ&6VÖVçBæfÆö÷"bb&×çv–GF‚ãÒ2ãRbb&×æVæE&F—W2Â&6VÖVçBç&F—W2bb&×æÖ…6Æ÷RÂãRbb&×æÖ…7FWÂã2bb&×ç6Öö÷F…6×ÆW2â#bb&×ç6×ÆW2âS’Â¥4ôâç7G&–æv–g’†&6VÖVçBç&×2’“°¢Ð¢°¢6öç7BFW'&–âÒFW'&–å6–v‡E&ö&R‚“°¢f÷"†6öç7B&6¶VæBöb&6¶VæG2’°¢&V6÷&B†6ÖW&6–v‡BwV–FW2G¶&6¶VæGÓ¢W†7BFW'&–â&—2w&VRv—F‚&VæFW&VBf6W2ÂFVç6Rö67Wæ7’æB&WfW'6RG&fW'6ÆÂö&¦V7BçfÇVW2‡FW'&–âæ6÷VçG2’æÆVæwF‚ÓÓÒBbbö&¦V7BçfÇVW2‡FW'&–âæ6÷VçG2’æWfW'’‚†6÷VçB’Óâ6÷VçBÓÓÒ#’bbFW'&–âç&—2âCbbFW'&–âæf–ÇW&W2æÆVæwF‚ÓÓÒbbFW'&–âç6VÔ6÷fW&VBbbFW'&–âæ÷WG6–FRbbFW'&–âçF‡&÷Vv„—6ÆæBbbFW'&–âç6†gBÂ¥4ôâç7G&–æv–g’‡FW'&–â’“°¢&V6÷&B†6ÖW&6–v‡BwV–FW2G¶&6¶VæGÓ¢V×G’FW'&–â&÷‚6W'F–f–6FW2w&VRv—F‚–æFWVæFVçBö67Wæ7’æB&—6ÂFW'&–âæ6W'F–f–VE&—2âbbFW'&–âæ6ÆV$&÷†W2â3bbFW'&–âæ&÷…&—2ÓÓÒFW'&–âæ6ÆV$&÷†W2¢‚bbFW'&–âæ&÷…ö–çG2ÓÓÒFW'&–âæ6ÆV$&÷†W2¢#rbbFW'&–âç6öÆ–D&÷†W2âbbFW'&–âç6öÆ–Eö–çG2ÓÓÒFW'&–âç6öÆ–D&÷†W2¢#rbbFW'&–âæf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²6W'F–f–VE&—3¢FW'&–âæ6W'F–f–VE&—2Â6ÆV$&÷†W3¢FW'&–âæ6ÆV$&÷†W2Â&÷…&—3¢FW'&–âæ&÷…&—2Â&÷…ö–çG3¢FW'&–âæ&÷…ö–çG2Â6öÆ–D&÷†W3¢FW'&–âç6öÆ–D&÷†W2Â6öÆ–Eö–çG3¢FW'&–âç6öÆ–Eö–çG2Âf–ÇW&W3¢FW'&–âæf–ÇW&W2Ò’“°¢&V6÷&B†6ÖW&6–v‡BwV–FW2G¶&6¶VæGÓ¢WfW'’v–æF÷r6W'F–f–W27GVÂ6öçfW‚7FöæRg&vÖVçG2v†–ÆR&V¦V7F–ærGvòÖÖ–ÆÆ–ÖWG&R—"7&÷76–æw6ÂFW'&–âæg&vÖVçEv–æF÷w2æÆVæwF‚ÓÓÒ3bbFW'&–âæg&vÖVçEv–æF÷w2æWfW'’‚†6÷VçB’Óâ6÷VçBÓÓÒ2’bbFW'&–âæg&vÖVçD&÷†W2ÓÓÒ“bbFW'&–âæg&vÖVçD—$&÷†W2ÓÓÒFW'&–âæg&vÖVçD&÷†W2bbFW'&–âæg&vÖVçEö–çG2ÓÓÒFW'&–âæg&vÖVçD&÷†W2¢#rbbFW'&–âæf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡²v–æF÷w3¢FW'&–âæg&vÖVçEv–æF÷w2Â6öÆ–C¢FW'&–âæg&vÖVçD&÷†W2Â—#¢FW'&–âæg&vÖVçD—$&÷†W2Âö–çG3¢FW'&–âæg&vÖVçEö–çG2Âf–ÇW&W3¢FW'&–âæf–ÇW&W2Ò’“°¢Ð¢Ð¢°¢6öç7B&ööbÒ6æ÷”6W'F–f–6FU&ö&R‚“°¢f÷"†6öç7B&6¶VæBöb&6¶VæG2’&V6÷&B†6æ÷’ö66ÇW6–öâG¶&6¶VæGÓ¢6öÆ–B&÷6÷fW&vRfö–G2FVç6R&’6V&6†W2v†–ÆR&W6W'f–ærF–ç’v2Â'F–ÂVFvW2Â6Æ—ÆæW2æBÖ÷f–ær&Æö6¶W'6Â&ööbç&÷w2æÆVæwF‚ÓÓÒ’bb&ööbæf–ÇW&W2æÆVæwF‚ÓÓÒbb&ööbæF—7÷6VBÂ¥4ôâç7G&–æv–g’‡&ööb’“°¢Ð¢°¢6öç7BVçG&æ6RÒ&×÷WFÆ–æU6V7F–öç5&ö&R‚“°¢f÷"†6öç7B&6¶VæBöb&6¶VæG2’&V6÷&B†6ÖW&&ö6²wV–FW2G¶&6¶VæGÓ¢&÷F‚&×VçG&æ6W2¶VWF‡&VR6ö×ÆWFRvÆÂ6V7F–öç2f—6–&ÆRöâ66VçBæBFW66VçBÂW†6ÇVF–ær6V–Æ–ær7FW2æB'W&–VBW‡FW&–÷"f6W6ÂVçG&æ6Ræg&öçG2ÓÓÒ"bbVçG&æ6RævVöÖWG'’ç&×2ÓÓÒBbbVçG&æ6RævVöÖWG'’çG&–ævÆW2âbbVçG&æ6RævVöÖWG'’æW‡FW&–÷%6×ÆW2âbbVçG&æ6Rç†6W2ç6V7F–öç2ÓÓÒbbbVçG&æ6Rç†6W2æ7F—fU6V7F–öç2ÓÓÒbbbVçG&æ6Rç†6W2ç6×ÆVBâbbVçG&æ6Rç†6W2ç6VÆd†–FFVââbbVçG&æ6Rç†6W2æ6ÖW&f—6–&ÆRâbbVçG&æ6Rç&÷w2æÆVæwF‚ÓÓÒ"bbVçG&æ6Rç&÷w2æWfW'’‚‡&÷r’Óâ&÷rç&WGW&å6×ÆW2ÓÓÒRbb&÷rçf—6–&ÆTW†—D–ç6–FRâbb&÷ræ÷WFÆ–æVDW†—D–ç6–FRâ’bbVçG&æ6Ræf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’†VçG&æ6R’“°¢Ð¢°¢6öç7B6Æ÷W2Ò6Æ÷T÷WFÆ–æU6V7F–öç5&ö&R‚“°¢f÷"†6öç7B&6¶VæBöb&6¶VæG2’&V6÷&B†6Æ÷R÷WFÆ–æW2G¶&6¶VæGÓ¢7FWVB†–ÆÇ6–FR6–FW2¦ö–âWFòF†R7&W7BÂW†6ÇVFRfÆBÆFf÷&×2ÂæB&WfVÂF†Rf"6–FRöæÇ’g&öÒ—G2÷vâÆ–æRöb6–v‡FÂ6Æ÷W2ç7–çF†WF–2æ¦ö–æVBâ#bb6Æ÷W2ç7–çF†WF–2æW†6ÇVFVBãÒrbb6Æ÷W2ç7–çF†WF–2æ÷÷6—FU6–FW2bb6Æ÷W2ç7–çF†WF–2æF–vöæÄ¦ö–æVBbb6Æ÷W2ævVöÖWG'’æÖ—†VE6–FW2âbb6Æ÷W2ævVöÖWG'’ç&—6W'2âbb6Æ÷W2ævVöÖWG'’çG&VG2âbb6Æ÷W2ç'VçF–ÖRæ&Æö6¶VD&VÆ÷râbb6Æ÷W2ç'VçF–ÖRç&WfVÆVD&÷fRÓÓÒ6Æ÷W2ç'VçF–ÖRæ&Æö6¶VD&VÆ÷rbb6Æ÷W2ç'VçF–ÖRç'F–ÄfFT–âÓÓÒ6Æ÷W2ç'VçF–ÖRæ&Æö6¶VD&VÆ÷rbb6Æ÷W2ç'VçF–ÖRç'F–ÄfFT÷WBÓÓÒ6Æ÷W2ç'VçF–ÖRæ&Æö6¶VD&VÆ÷rbb6Æ÷W2æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡6Æ÷W2’“°¢Ð¢°¢6öç7B"Ò÷WFÆ–æUW&f÷&Öæ6U&ö&R‚“°¢f÷"†6öç7B&6¶VæBöb&6¶VæG2’&V6÷&B†÷WFÆ–æRf—6–&–Æ—G’66†RG¶&6¶VæGÓ¢v†öÆR×vÆÂv—FæW76W2&VÖ–â6÷'&V7B2&Æö6¶W'26†ævRv—F†÷WB&WG&6–ærf—†VBÖ6ÖW&FW'&–æÂ"ç&÷w2æÆVæwF‚ÓÓÒ2bb"æf–ÇW&W2æÆVæwF‚ÓÓÒÂ¥4ôâç7G&–æv–g’‡"’“°¢Ð¢°¢òòööv÷&&—Bw2'VÆW2æBfÆ–v‡BÖöFVÂÂ7G&–v‡Bg&öÒ&ö6¶WB×'G2æ§2æB&ö6¶WBæ§2ÂBF†Rf—†VBó#7FWà¢6öç7BÒ$Âç&ö6¶WE'G2Â²Ò$Âç&ö6¶WBÂ²VBÒÒ$ÂæÖF‚ÂEBÒò#Â”âÒ²F‡&÷GFÆS¢ÂÆVã¢Â—F6ƒ¢Â&öÆÃ¢Â–s¢Ó°¢6öç7B6Æ–Ö"Ò‡7F6²’Óâ°¢6öç7BbÒ²æ7&VFR‡²7F6²Âw&÷VæDC¢‚’ÓâÔ–æf–æ—G’Ò’Â2Òbç7FFS°¢bç&W6WBƒÂ"ã2ÂCb“°¢bæ–væ—FR‚“°¢ÆWB6W2Ò°¢f÷"†ÆWBBÒ²BÂ3bb2æf–ÇW&Rbb2æÇBÃÒ²äõ$$•EôÅC²B³ÒEB’°¢bç7V'7FW„EBÂ”â“°¢–b‡2æfÆÖV÷WB’°¢2æfÆÖV÷WBÒfÇ6S°¢–b†bç6W&FR‚’’6W2²²Âbæ–væ—FR‚“°¢Ð¢Ð¢&WGW&â²ÇC¢ÖF‚ç&÷VæB‡2æÇB’Âf–ÇW&S¢2æf–ÇW&RÂ6W2Ó°¢Ó°¢òò†VÆB÷fW"F†RBBF†RF÷ÂöBÆöæRÂF‡&÷vâF÷vâ6†–VÆBf—'7B†÷"fÆ—VB’Â6‡WFR26ööâ2—B—2&VG’à¢6öç7B†öÖRÒ‡7F6²Â²fÆ—ÒfÇ6RÂ6‡WFRÒG'VRÒÒ·Ò’Óâ°¢6öç7BbÒ²æ7&VFR‡²7F6²Âw&÷VæDC¢‚’ÓâÔ–æf–æ—G’Ò’Â2Òbç7FFS°¢bç&W6WBƒÂ"ã2ÂCb“°¢2æÖöFRÒ&66VçB#°¢bæ†öÆBƒÂ²ä5’²²å"²²äõ$$•EôÅBÂ“°¢bæ†öÖWv&B‚“°¢bç7FæB‚“°¢–b†fÆ—’VBæ×VÇF—Ç’‡2çÂ2çÂVBæg&öÔ†—4ævÆR‡VBæ7&VFR‚’ÂÂÂÂÖF‚å’’“°¢2çbç’ÒÓ#°¢f÷"†ÆWBBÒ²BÂCbb2æf–ÇW&Rbb2æÖöFRÓÒ&F÷vâ#²B³ÒEB’°¢bç7V'7FW„EBÂ”â“°¢–b†6‡WFRbbbæ6‡WFU&VG’‚’’bæFWÆ÷’‚“°¢Ð¢&WGW&â²öC¢bæ—5öB‚’Âf–ÇW&S¢2æf–ÇW&RÂÆæF–æs¢2æÆæF–ærÂV´†VC¢·2çV´†VBçFôf—†VBƒ2’Â6‡WFS¢2æ6‡WFRÓ°¢Ó°¢6öç7B&W6WG2Òå$U4UE2æÖ‚‡’Óâ‡²æÖS¢ææÖRÂö³¢æ6†V6²‡ç7F6²’æö²Âv&æ–æw3¢æ6†V6²‡ç7F6²’çv&æ–æw2æÆVæwF‚Â7FvW3¢ç7FvW4öb‡ç7F6²’æÆVæwF‚ÂGc¢µç7FG2‡ç7F6²’æGbçFôf—†VBƒ’Âââæ6Æ–Ö"‡ç7F6²’Ò’“°¢&V6÷&B‚&÷&&—B'G3¢WfW'’&VG’&ö6¶WB76W2F†R'V–ÆFW"Â†2F†R7VVBf÷"Æ÷r÷&&—BæB6Æ–Ö'27G&–v‡BFò—BÂG&÷–ær—G27FvW2"Â&W6WG2æÆVæwF‚ÓÓÒ2bb&W6WG2æWfW'’‚‡’Óâæö²bbæGbãÒåDõôEbbbæÇBãÒ²äõ$$•EôÅBbbæf–ÇW&Rbbç6W2ÓÓÒÖF‚æÖ‚ƒÂç7FvW2Ò"’’bb&W6WG5³Òç7FvW2ÓÓÒBbb&W6WG5³Òç7FvW2ÓÓÒBbb&W6WG5³Òçv&æ–æw2ÓÓÒbb&W6WG5³Òçv&æ–æw2ÓÓÒbb&W6WG5³%Òçv&æ–æw2ÓÓÒÂ¥4ôâç7G&–æv–g’‡&W6WG2’“°¢6öç7B'VÆW2Ò°¢æôVæv–æS¢æ6†V6²…²&&'&VÂ"Â'7F–6·öB%Ò’æö²À¢æõöC¢æ6†V6²…²'÷B"Â&&'&VÂ%Ò’æö²À¢ÆöæU6†–VÆC¢æ6†V6²…²'÷B"Â&×VG6†–VÆB"Â&&'&VÂ"Â'7F–6·öB%Ò’æö²À¢fÆöF–ætVæv–æS¢æ6†V6²…²'÷B"Â&&'&VÂ"Â'GW6²"Â'7F–6·öB%Ò’æö²À¢GvõöG3¢æ6†V6²…²'÷B"Â'7F–6·öB"Â&v÷W&GöB%Ò’æö²À¢æõ6†–VÆC¢æ6†V6²…²'÷B"Â'f–æR"Â'7F–6·öB%Ò’çv&æ–æw2À¢6æ—F—¦VC¢ç6æ—F—¦R…²'÷B"Â&æ÷R"ÂrÂ&&'&VÂ"Âââä'&’ƒ3’æf–ÆÂ‚&çWB"•Ò’À¢æ÷DÆ—7C¢ç6æ—F—¦R‚'÷B"¢Ó°¢&V6÷&B‚&÷&&—B'G3¢F†R'V–ÆFW"&VgW6W2&ö6¶WBv—F†÷WBâVæv–æRBF†R&÷GFöÒ÷"öBöâF÷Â7G&’6†–VÆB÷"Væv–æRÂGvòöG2ÂæB6æ—F—6W27F÷&VB7F6·2"Â'VÆW2ææôVæv–æRbb'VÆW2ææõöBbb'VÆW2æÆöæU6†–VÆBbb'VÆW2æfÆöF–ætVæv–æRbb'VÆW2çGvõöG2bb'VÆW2ææõ6†–VÆBç6öÖR‚‡r’Óâræ–æ6ÇVFW2‚&†VB6†–VÆB"’’bb'VÆW2ç6æ—F—¦VBæÆVæwF‚ÓÓÒäÔ…õ%E2bb'VÆW2ç6æ—F—¦VE³ÒÓÓÒ'÷B"bb'VÆW2ç6æ—F—¦VE³ÒÓÓÒ&&'&VÂ"bb'VÆW2ææ÷DÆ—7BÓÓÒçVÆÂÂ¥4ôâç7G&–æv–g’‡'VÆW2’“°¢6öç7BöövÒå$U4UE5³Òç7F6²Â6†–VÆBÒ†öÖR†ööv’ÂfÆ—VBÒ†öÖR†öövÂ²fÆ—¢G'VRÒ’Â&&RÒ†öÖR†öövÂ²6‡WFS¢fÇ6RÒ“°¢&V6÷&B‚&÷&&—BfÆ–v‡C¢g&öÒÆ÷r÷&&—BF†RöB6öÖW2†öÖRÆöæRÂ6†–VÆBf—'7B'Vç26ööÆW"F†âfÆ—VBÂF†R6‡WFRÆæG2—B6ögBæBæò6‡WFR'&V·2—BöâF†R6V"Â6†–VÆBçöBbb6†–VÆBæf–ÇW&Rbb6†–VÆBæÆæF–ærÓÓÒ'6ögB"bb6†–VÆBæ6‡WFRÓÓÒ&÷Vâ"bb6†–VÆBçV´†VBâbbfÆ—VBçV´†VBâ6†–VÆBçV´†VB¢ãRbb&&Ræf–ÇW&RÓÓÒ'7ÆB"Â¥4ôâç7G&–æv–g’‡²6†–VÆBÂfÆ—VBÂ&&RÒ’“°¢Ð§Ó°  ¦6öç7BG6%6†÷&VÆ–æT6†V6·ö–çC×¶æÖS¢&G6"6†÷&VÆ–æR6†V6·ö–çB"Çv‡“¢'Æ—F‡&÷Vvƒ¢7GVÂ–çWBvFW2FòF†R†VBÖFWF‚&÷VæF'’Â&WGW&ç2Âf—6—G2fÆÇ2Â6†ævW2vVF†W"æB&VÆV6W266VæRVffV7G2"Ç'Vã¦7–æ2#Óç°¢6öç7B&ö÷CÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“°¢v—B"æWfÇVFR‚væWr&öÖ—6R‡&W6öÇfSÓç&WVW7Dæ–ÖF–öäg&ÖR‚‚“Óç&WVW7Dæ–ÖF–öäg&ÖR‡&W6öÇfR’’’r“°¢6öç7BÆ—fSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢vV$tÂ7F'GWG&w2æBGfæ6W2v—F†÷WB’W'&÷'2÷"—†VÂ&VF&6²"Ç6†÷&VÆ–æT†VÇF‡’†Æ—fR’bfÆ—fRæg&ÖW3æ&ö÷Bæg&ÖW2bfÆ—fRæG&w3æ&ö÷BæG&w2bfÆ—fRç&VF&6·3ÓÓÓÄ¥4ôâç7G&–æv–g’†Æ—fR’“°¢v—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRæGfæ6R‚ã#R’r“°¢6öç7B7F&ÆSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢7F'GW&WF–ç2f—†VBvFW"&W6÷W&6W2æBuR&V6÷&B6÷VçB"Ç6†÷&VÆ–æT†VÇF‡’‡7F&ÆR’bg7F&ÆRææöFW3ÓÓÖÆ—fRææöFW2bg7F&ÆRç&V6÷&G3ÓÓÖÆ—fRç&V6÷&G2bg7F&ÆRæG&w3æÆ—fRæG&w2Ä¥4ôâç7G&–æv–g’‡7F&ÆR’“°¢6öç7B–æfóÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6#·&WGW&â¶¶–æC¤"ç&VæFW&W"æ¶–æBÆ–×VÇ6W3¤BçvFW$–çFW&7F–öâç7FG2æ66—G’Æ†V–v‡C¤BæfF"æ&öG”†V–v‡BÆÖVã¤BçvFW"ævVöÖWG'’çfW'G5³×Ó·Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢6†FW"6ö×–ÆW2æB&÷fVBvFW"7W&f6R—2&WF–æVB"Æ–æfòæ¶–æCÓÓÒ'vV&vÃ""bf–æfòæ–×VÇ6W3ÓÓÓ#Bbf–æfòæÖVãÓÓÒÒã2Ä¥4ôâç7G&–æv–g’†–æfò’“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢6öç7BÖ÷f–æsÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BsÕõööövæG6"çvFW$–çFW&7F–öâÇ7F'C×²ââårç7FG7ÒÇ6VVã×·Æ–W#¦fÇ6RÆG&vã¦fÇ6RÇv¶W3£Ç7Æ6†W3£ÆÖ„7F—fS£Ó¶ÆWBv¶W3×7F'Bçv¶W2Ç7Æ6†W3×7F'Bç7Æ6†W3°¢õ÷6†÷&VÆ–æRæGfæ6Rƒ#BÆG&vãÓç¶6öç7B3Õrç7FG3·6VVâæÖ„7F—fSÔÖF‚æÖ‚‡6VVâæÖ„7F—fRÇ2æ7F—fR“°¢–b‡2æFWFƒãbg2çfVÆö6—G“âã—¶6öç7Bf—6–&ÆSÕræ–×VÇ6W2ç6Æ–6RƒR’ç6öÖR‡ÓçævSãÓbgævSÇæÆ–fRbgææöFRçf—6–&ÆRbgææöFRç6Öö¶T÷6—G“ã“·6VVâçÆ–W"ÇÃÒ2çÆ–W#ãbgf—6–&ÆS·6VVâæG&vâÇÃÒG&vâbg2çÆ–W#ãbgf—6–&ÆS·6VVâçv¶W2³×2çv¶W2×v¶W3·6VVâç7Æ6†W2³×2ç7Æ6†W2×7Æ6†W3·Ð¢v¶W3×2çv¶W3·7Æ6†W3×2ç7Æ6†W3°¢Ò“·&WGW&â²ââç6VVâÆVÖ—GFVC¥rç7FG2æVÖ—GFVB×7F'BæVÖ—GFVGÓ·Ò’‚–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢6öç7BFVWÖv—B"æWfÇVFR‚r‡·7FG3§²ââåõööövæG6"çvFW$–çFW&7F–öâç7FG7ÒÇ£¥õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢Æ6ÖW&¥õööövæ6ÖW&ç÷6—F–öâç—Ò’r“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢¶W–&ö&B&V6†W26fR†VBFWF‚v—F‚&—ÆW2æB&W7öç6—fR7W&f6R6ÖW&"ÆFVWç7FG2æFWFƒæ–æfòæ†V–v‡B¢ãƒ2bfFVWç7FG2æFWFƒÃÖ–æfòæ†V–v‡B¢ã“‚bfÖ÷f–ærçÆ–W"bfÖ÷f–æræG&vâbfFVWæ6ÖW&âÒã2Ä¥4ôâç7G&–æv–g’‡¶FVWÆÖ÷f–æwÒ’“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢Ö÷fVÖVçBVÖ—G2Æ–W"–×VÇ6W2Âv¶W2æB6†ÆÆ÷r7Æ6†W2v—F†–âF†Rf—†VB'VFvWB"ÆÖ÷f–æræVÖ—GFVCãbfÖ÷f–ærçv¶W3ãbfÖ÷f–ærç7Æ6†W3ãbfÖ÷f–æræÖ„7F—fSÃÓ#BÄ¥4ôâç7G&–æv–g’†Ö÷f–ær’“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'2"Æ6öFS¢$¶W•2'Ò“¶v—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRæGfæ6Rƒ3’r“¶v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'2"Æ6öFS¢$¶W•2'Ò“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢&WfW'6R–çWB&WGW&ç2FòG'’ÆæB"Æv—B"æWfÇVFR‚uõööövæG6"çvFW$–çFW&7F–öâç7FG2æFWFƒÓÓÓbeõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç£Ãsbr’“°¢6öç7BW‡—&VCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BsÕõööövæG6"çvFW$–çFW&7F–öãµõ÷6†÷&VÆ–æRçVçF–Â‚‚“Óårç7FG2çÆ–W#ÓÓÓÃ2“·&WGW&â¶FWFƒ¥rç7FG2æFWF‚ÇÆ–W#¥rç7FG2çÆ–W"Æ†–FFVã¥ræ–×VÇ6W2ç6Æ–6RƒR’æWfW'’‡ÓçævSÃbbææöFRçf—6–&ÆR’Æ66—G“¥rç7FG2æ66—G—Ó·Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢Æ–W"&—ÆW2W‡—&Ræ÷&ÖÆÇ’gFW"&WGW&æ–ærFò6†÷&R"ÆÖ÷f–ærçÆ–W"bfW‡—&VBæFWFƒÓÓÓbfW‡—&VBçÆ–W#ÓÓÓbfW‡—&VBæ†–FFVâbfW‡—&VBæ66—G“ÓÓÓ#BÄ¥4ôâç7G&–æv–g’†W‡—&VB’“°¢f÷"†6öç7B¶æÖRÆ†÷W"ÇvVF†W%Òöbµ²&æööâ"Ã"Â&6ÆV"%ÒÅ²&vöÆFVâ"Ã‚Â&6ÆV"%ÒÅ²&æ–v‡B"Ã#2Â&6ÆV"%ÒÅ²'&–â"Ã"Â'&–â%ÒÅ²'7F÷&Ò"Ã"Â'7F÷&Ò%ÕÒ—°¢òò&W6W'fVB–×7B&–æw2W‡—&RæB&VæWröâ7V66W76—fRWFFW2âö'6W'fRF†V—"f—6–&ÆRÆ–fWF–ÖRÀ¢òò¶VW–ærÆÂf—fR&WV—&VBÂ&F†W"F†â&WV—&–ærF†Rf–æÂ6×ÆRFòÖ—72WfW'’&VæWvÂvà¢6öç7B#Öv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"ÅsÔBçvFW$–çFW&7F–öâÆcÔBæöÇ–×W2æ–×7G5³Ó´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¦bç‚³RÇ“¤BæÆæBæ†V–v‡DB†bç‚³RÆbç¢³2’Ç£¦bç¢³7ÒÇ–s£ãRÇ—F6ƒ¢ãBÆF—7C£‡Ò“´"æF–Æ–v‡Bç&VCÒ‚“ÓâG¶†÷W'Ó´"æF–Æ–v‡Bæ6öçF–çV÷W4F“Ô"æF–Æ–v‡BæF”öe–V"Ó²G¶†÷W'Òó#C´BçvVF†W"ç6WDÖöFR‚G´¥4ôâç7G&–æv–g’‡vVF†W"—Ò“¶ÆWB7FG3ÖçVÆÂÆf–æ—FS×G'VRÆÖ„7F—fSÓµõ÷6†÷&VÆ–æRæGfæ6Rƒ"Â‚“Óç¶f–æ—FRbcÔBçvFW"æVçf—&öæÖVçBæWfW'’„çVÖ&W"æ—4f–æ—FR“¶Ö„7F—fSÔÖF‚æÖ‚†Ö„7F—fRÅrç7FG2æ7F—fR“¶–b…rç7FG2æ–×7G3ÓÓÓRberæ–×VÇ6W2ç6Æ–6RƒÃR’æWfW'’‡ÓçææöFRçf—6–&ÆRbgææöFRç6Öö¶T÷6—G“ã’—7FG3×²ââårç7FG7Ó·Ò“·&WGW&â·7FG3§7FG7ÇÇ²ââårç7FG7ÒÇf—6–&ÆS¢7FG2Æf–æ—FRÆÖ„7F—fRÆÆ–v‡C¤BçvVF†W"ç7FFRæÖöFRÆæöFW3¥ræw&÷Wæ6†–ÆG&VâæÆVæwF‡Ó·Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢"¶æÖR²"†2f–æ—FRvFW"æB&÷VæFVBvFW&fÆÂ–×7G2"Ç"æf–æ—FRbg"çf—6–&ÆRbg"ç7FG2æ–×7G3ÓÓÓRbg"ç7FG2ç7G&V·3ãbg"ç7FG2æ7F—fSÃÓ#Bbg"æÖ„7F—fSÃÓ#BÄ¥4ôâç7G&–æv–g’‡"’“°¢Ð¢6öç7B&W6W'fVCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BCÕõööövæG6"ÄóÔBæöÇ–×W2ÄÃÔBæÆæBÄÔBæfF#¶ÆWB&Æö6¶VCÓ¶f÷"†ÆWB“Ó¶“ÄÂçG&–ÂæÆVæwFƒ¶’²²—¶6öç7BÔÂçG&–Å¶’ÓÒÆ#ÔÂçG&–Å¶•Ó¶–b‚ÂçvÆ¶&ÆR‚ââæç6Æ–6RƒÃ"’Âââæ"ç6Æ–6RƒÃ"’ÄÂæ†V–v‡DB‚ââæ’Äæ&öG”†V–v‡BÄ—ÇÂòæ6ÆV%6VvÖVçB‚ââæç6Æ–6RƒÃ"’Âââæ"ç6Æ–6RƒÃ"’ÄÂæ†V–v‡DB‚ââæ’Äæ&öG”†V–v‡BÄ’–&Æö6¶VB²³·×&WGW&â¶&Æö6¶VBÆ'&–FvW3¤òæ'&–FvW2æÆVæwF‚Ç&V#¤Âæ†V–v‡DB‚ÓSRÂÓ“’ÆÖ–ÆW7FöæW3¤Bæ–çFW&–÷'2ç&Vv—7G'’ç6—¦WÓ·Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢67&VBv’Â&÷F‚'&–FvW2Â6WfVâfVçVW2æBFVW&V"öÇ–×W2&VÖ–â–çF7B"Ç&W6W'fVBæ&Æö6¶VCÓÓÓbg&W6W'fVBæ'&–FvW3ÓÓÓ"bg&W6W'fVBç&V#ÓÓÒÓRbg&W6W'fVBæÖ–ÆW7FöæW3ÓÓÓrÄ¥4ôâç7G&–æv–g’‡&W6W'fVB’“°¢6öç7B&Vf÷&SÖv—B"æWfÇVFR‚r‡¶æöFW3¥õööövæG6"çvFW$–çFW&7F–öâæw&÷Wæ6†–ÆG&VâæÆVæwF‚Ç&V6÷&G3¥õööövç&VæFW&W"ç7FG2ç&V6÷&G7Ò’r“°¢6öç7Bf—6—G3ÕµÓ°¢f÷"†ÆWB“Ó¶“Ã#¶’²²—°¢6öç7BGVææVÃÖv—B"æWfÇVFR†‚‚“Óç·v–æF÷råõööÆEvFW#ÕõööövæG6"çvFW$–çFW&7F–öã·v–æF÷råõööÆDVçG&æ6SÕõööövæG6"æVçG&æ6S°¢õööövævò‚&&–g&÷7B"ÆçVÆÂÇG'VR“µõ÷6†÷&VÆ–æRçVçF–Â‚‚“Óåõööövç66VæSÓÓÒ&&–g&÷7B"bbõööövçG&ç6—F–öæ–ærÃ"“°¢6öç7B&–g&÷7CÕõööövç66VæSµõööövævò‚&G6""ÆçVÆÂÇG'VR“µõ÷6†÷&VÆ–æRçVçF–Â‚‚“Óåõööövç66VæSÓÓÒ&G6""bbõööövçG&ç6—F–öæ–ærÃ"“°¢6öç7BCÕõööövæG6#·&WGW&â¶&–g&÷7BÇ†6S¤BæVçG&æ6Sòç†6RÇ&öw&W73¤BæVçG&æ6Sòç&öw&W72ÆW‡FW&–÷#¤BæW‡FW&–÷"çf—6–&ÆRÇFW‡GW&W3¥õööövç&VæFW&W"ç7FG2çvFW%FW‡GW&W7Ó·Ò’‚–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢òòvÆ²F†R&W6W'fVBGVææVÂv—F‚&VÂ–çWBâ&VGV6VBÖÖ÷F–öâ'&÷w6W'2W6R—G2æ÷&ÖÂF—&V7@¢òò'&—fÃ²÷F†W"'&÷w6W'2Ç6òv—BF‡&÷Vv‚F†RfÆ–v‡BâæWfW"6ÆÂVçG&æ6Rç6¶—‚’à¢6öç7B6V6öæG3Öv—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRçVçF–Â‚‚“ÓåõööövæG6"æVçG&æ6Sòç†6SÓÓÒ&FöæR"beõööövæG6"æW‡FW&–÷"çf—6–&ÆRbbõööövçG&ç6—F–öæ–ær’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢v—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRæGfæ6R‚ã#R’r“°¢6öç7B#Öv—B"æWfÇVFR†‚‚“Óç¶6öç7BCÕõööövæG6#·&WGW&â¶6ÆV&VC¥õööÆEvFW"ÓÔBçvFW$–çFW&7F–öâbeõööÆEvFW"æw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓbeõööÆEvFW"ç7FG2æ7F—fSÓÓÓbb‚õööÆDVçG&æ6WÇÅõööÆDVçG&æ6Ræw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓ’À¢†6S¤BæVçG&æ6Rç†6RÇ&öw&W73¤BæVçG&æ6Rç&öw&W72ÆW‡FW&–÷#¤BæW‡FW&–÷"çf—6–&ÆRÇvFW#¤BçvFW"æ†V–v‡G2æWfW'’„çVÖ&W"æ—4f–æ—FR’Æ7F—fS¤BçvFW$–çFW&7F–öâæw&÷Wçf—6–&ÆRbdBçvFW$–çFW&7F–öâç7FG2ç7v6ƒãÀ¢æöFW3¤BçvFW$–çFW&7F–öâæw&÷Wæ6†–ÆG&VâæÆVæwF‚Æ66—G“¤BçvFW$–çFW&7F–öâç7FG2æ66—G’ÆFWFƒ¤BçvFW$–çFW&7F–öâç7FG2æFWF‚ÇFW‡GW&W3¥õööövç&VæFW&W"ç7FG2çvFW%FW‡GW&W2Ç&V6÷&G3¥õööövç&VæFW&W"ç7FG2ç&V6÷&G7Ó·Ò’‚–“°¢f—6—G2çW6‚‡·GVææVÂÇ6V6öæG2Âââç'Ò“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢÷'F&66VæRG&—"¶’²"&VÆV6W2VffV7G2æB7&VFW26ÆVâ&÷VæFVBf—6—B"ÇGVææVÂæ&–g&÷7CÓÓÒ&&–g&÷7B"bgGVææVÂç†6SÓÓÒ'GVææVÂ"bgGVææVÂç&öw&W73ÃbbGVææVÂæW‡FW&–÷"bgGVææVÂçFW‡GW&W3ÓÓÓbg"ç†6SÓÓÒ&FöæR"bg"ç&öw&W73ÓÓÓbg"æW‡FW&–÷"bg"çvFW"bg"æ7F—fRbg"æ6ÆV&VBbg"ææöFW3ÓÓÖ&Vf÷&RææöFW2bg"æ66—G“ÓÓÓ#Bbg"æFWFƒÓÓÓbg"çFW‡GW&W3ÓÓÓ"Ä¥4ôâç7G&–æv–g’‡f—6—G5¶•Ò’“°¢Ð¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢6ö×ÆWFVB&RÖVçG'’&WF–ç2–FVçF–6Â&VæFW&W"&V6÷&G2ÂvFW"æöFW2æBFW‡GW&W2"Çf—6—G5³Òç&V6÷&G3ÓÓ×f—6—G5³Òç&V6÷&G2bgf—6—G2æWfW'’‡cÓçbææöFW3ÓÓÖ&Vf÷&RææöFW2bgbçFW‡GW&W3ÓÓÓ"’Ä¥4ôâç7G&–æv–g’‡f—6—G2’“°¢6öç7Bf–æÃÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“°¢&V6÷&B‚$E4"6†÷&VÆ–æR'&÷w6W#¢Æ—F‡&÷Vv‚&WF–ç2vV$tÃ"v—F‚æò’W'&÷"Â6†FW"f–ÇW&R÷"6öçFW‡BÆ÷72"Ç6†÷&VÆ–æT†VÇF‡’†f–æÂ’Ä¥4ôâç7G&–æv–g’†f–æÂ’“°¢"ç6†÷&VÆ–æT†VÇF‡“×6†÷&VÆ–æT†VÇF‡’†Æ—fR’bg6†÷&VÆ–æT†VÇF‡’‡7F&ÆR’bg6†÷&VÆ–æT†VÇF‡’†f–æÂ’bf÷WGWBævWE7F÷&R‚’ç&W7VÇG2æWfW'’‡#Óç"æö²“°¢"ç6†÷&VÆ–æU6ögGv&SÒõ7v–gE6†FW'ÆÆÇf×—WÇ6ögGv&Rö’çFW7B†f–æÂæwR“°¢6öç7BWf–FVæ6SÖ¦ö–â‡&ö÷BÂ'VçG&6¶VB÷vFW"×&Wf–Wr"“¶Ö¶F—%7–æ2†Wf–FVæ6RÇ·&V7W'6—fS§G'VWÒ“°¢w&—FTf–ÆU7–æ2†¦ö–â†Wf–FVæ6RÂ'vV&vÂ×7FFRæ§6öâ"’Ä¥4ôâç7G&–æv–g’‡¶&ö÷BÆÆ—fRÇ7F&ÆRÆÖ÷f–ærÆFVWÆW‡—&VBÇf—6—G2Æf–æÂÆÆöw3¦"æÆöw7ÒÆçVÆÂÃ"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢'6†÷&VÆ–æR6†V6·ö–çB"ÇVW'“¢"gf–Ws×vFW"ÖG'’gvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£CƒÆƒ£3#ÒÇ7FW3¥¶G6%6†÷&VÆ–æT6†V6·ö–çE×Ò“° §66VæR‚&G6""Ç¶Æ&VÃ¢'6†÷&VÆ–æR6†V6·ö–çB–W'2"ÇVW'“¢"gf–Ws×vFW"×–W"×vW7BgvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£CƒÆƒ£3#ÒÇ7FW3¥·¶æÖS¢&G6"6†÷&VÆ–æR–W"66W72"Çv‡“¢'&Vw&W76–öã¢f—6–&ÆR†&&÷"FV6·2×W7B7W÷'B&VÂ¶W–&ö&BvÆ¶–ærv—F†÷WB6†æv–ærF†R6V&VB÷"W&Ö—GF–ærö6VâÖfÆö÷"66W72"Ç'Vã¦7–æ2#Óç°¢6öç7Bf—6—G3ÕµÓ°¢f÷"†6öç7B‚öb²ÓC2ÂÓ3EÒ—°¢v—B"æWfÇVFR†õööövç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¢G·‡ÒÇ“¥õööövæG6"æÆæBæw&÷VæDB‚G·‡ÒÃ3‚’Ç££3‡ÒÇ–s¤ÖF‚å’Ç—F6ƒ¢ãbÆF—7C£WÒ“µõ÷6†÷&VÆ–æRæGfæ6R‚ã–“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢v—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRçVçF–Â‚‚“ÓåõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç£ãÓSrãbÃ#’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢6öç7BVæCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"ÄÔBæfF"ÇÔç&ö÷Bç÷6—F–öã·&WGW&â·ƒ§ç‚Ç£§ç¢ÆfVWC§ç’Ôæ&6U’Ç7W÷'C¤Bæ–çFW&–÷'2æw&÷VæDB‡ç‚Çç¢’ÆFWFƒ¤BçvFW$–çFW&7F–öâç7FG2æFWF‚Ç7VVC¤BçvFW$–çFW&7F–öâç7VVDB„’Æ6ÖW&¤"æ6ÖW&ç÷6—F–öâç’Æ&VC¤BæÆæBæ†V–v‡DB‡ç‚Çç¢’Æ÷F–73¤BçvFW"æFWF„B‡ç‚Çç¢’ÆöfdVFvS¤BæÆæBçvÆ¶&ÆR‡ç‚Çç¢Çç‚³"Çç¢Ãã3RÄæ&öG”†V–v‡BÄ—Ó·Ò’‚–“°¢&V6÷&B‚$E4"–W"'&÷w6W""·‚²#¢6†÷&R–çWB&V6†W2F†RFV6²VæBv—F‚G'’fö÷F–ær&÷fRFVW†&&÷"vFW""ÄÖF‚æ'2†VæBç‚×‚“ÂãbfVæBç£ãÓSrãbbdÖF‚æ'2†VæBæfVWBÓã3R“ÃRÓbbfVæBç7W÷'CÓÓÓã3RbfVæBæFWFƒÓÓÓbfVæBç7VVCÓÓÓbfVæBæ6ÖW&ãã3RbfVæBæ&VCÓÓÒÓRbfVæBæ÷F–73ãÓBãrbbVæBæöfdVFvRÄ¥4ôâç7G&–æv–g’†VæB’“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'2"Æ6öFS¢$¶W•2'Ò“°¢v—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRçVçF–Â‚‚“ÓåõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç£Ã3‚ã"Ã#’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'2"Æ6öFS¢$¶W•2'Ò“°¢6öç7B&6³Öv—B"æWfÇVFR‚r‡·£¥õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢ÆFWFƒ¥õööövæG6"çvFW$–çFW&7F–öâç7FG2æFWF‡Ò’r“°¢&V6÷&B‚$E4"–W"'&÷w6W""·‚²#¢&WfW'6R–çWB&WGW&ç26†÷&R"Æ&6²ç£Ã3‚ã"bf&6²æFWFƒÓÓÓÄ¥4ôâç7G&–æv–g’†&6²’“·f—6—G2çW6‚‡·‚ÆVæBÆ&6·Ò“°¢Ð¢6öç7B7FFSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“°¢&V6÷&B‚$E4"–W"'&÷w6W#¢&Wf—6VB6V6†FW"æB7W÷'FVB†&&÷"&WF–â†VÇF‡’vV$tÂæB&÷VæFVBVffV7G2"Ç6†÷&VÆ–æT†VÇF‡’‡7FFR’bg7FFRææöFW3ÓÓÓ3bbg7FFRç&VF&6·3ÓÓÓÄ¥4ôâç7G&–æv–g’‡7FFR’“°¢"ç6†÷&VÆ–æT†VÇF‡“×6†÷&VÆ–æT†VÇF‡’‡7FFR’bf÷WGWBævWE7F÷&R‚’ç&W7VÇG2æWfW'’‡#Óç"æö²“¶"ç6†÷&VÆ–æU6ögGv&SÒõ7v–gE6†FW'ÆÆÇf×—WÇ6ögGv&Rö’çFW7B‡7FFRæwR“°¢6öç7BWf–FVæ6SÖ¦ö–â‡&ö÷BÂ'VçG&6¶VB÷vFW"×&Wf–Wr"“¶Ö¶F—%7–æ2†Wf–FVæ6RÇ·&V7W'6—fS§G'VWÒ“·w&—FTf–ÆU7–æ2†¦ö–â†Wf–FVæ6RÂ'–W"×7FFRæ§6öâ"’Ä¥4ôâç7G&–æv–g’‡·f—6—G2Ç7FFRÆÆöw3¦"æÆöw7ÒÆçVÆÂÃ"’“°§×Õ×Ò“° ¦f÷"†6öç7BfÆÆ&6²öb¶fÇ6RÇG'VUÒ—66VæR‚&G6""Ç¶Æ&VÃ¢%÷'F&W'GW&R"²†fÆÆ&6³ò$6çf2†öæR#¢%vV$tÂ"’ÇVW'“¢"gf–Ws×÷'F&gvVF†W#Ö6ÆV"gF–ÖSÓ#"²†fÆÆ&6³ò"f6çf3&CÓ#¢""’Æ÷G3¦fÆÆ&6³÷²ââå„ôäUõ4•¤RÆÖ÷F–öã§G'VWÓ§·s£cCÆƒ£CƒÆÖ÷F–öã§G'VWÒÇ7FW3¥·¶æÖS¢&G6"÷'F&W'GW&R"²†fÆÆ&6³ò$6çf2†öæR#¢%vV$tÂ"’Çv‡“¢'&Vw&W76–öã¢F†R÷'F&f–ÆÇ2—G2&V7FæwVÆ"Ö&&ÆR÷Væ–ærv†–ÆRF†R6†&VBF–ÆW"Âæ–ÖF–öâÂW'GW&RæB&WGW&âG&ç7÷'B¶VWv÷&¶–ær"Ç'Vã¦7–æ2#Óç°¢òòf–æ—6‚F†R÷&F–æ'’6ÖW&&W6WB&Vf÷&R6ö×&–ær7F—fRÖvFR&VæFW&W"&W6–FVæ7’à¢v—B"æWfÇVFR‚uõ÷6†÷&VÆ–æRæGfæ6Rƒ"’r“°¢6öç7B¶–æCÖv—B"æWfÇVFR‚uõööövç&VæFW&W"æ¶–æBr“·&V6÷&B‚%÷'F&"¶¶–æB²#¢W‡V7FVB&VæFW&W"—27F—fR"Æ¶–æCÓÓÒ†fÆÆ&6³ò&6çf3&B#¢'vV&vÃ""’“°¢6öç7B6†SÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄsÔ"æG6"ævFRÅÔræW'GW&RÅcÔræ†÷&—¦öâævVöÖWG'’çfW'G3·&WGW&â¶öfc¤rç7FFSÓÓÒ$ôdb"bbræ†÷&—¦öâçf—6–&ÆRbbræ¶vö÷6‚çf—6–&ÆRÇ&V7C¤ræ†÷&—¦öâævVöÖWG'’ç÷'FÅ&V7BÇv–GFƒ¤ræ†÷&—¦öâç66ÆRç‚£"Æ†V–v‡C¤ræ†÷&—¦öâç66ÆRç¢£"Æ6VçFW#¤rç&ö÷Bç÷6—F–öâç’Ô"æG6"æÆæBæ†V–v‡DB‚ÓCRÂÓC‚’Æ6÷&æW'3¥µ²ÓÂÓÒÅ²ÓÃÒÅ³ÂÓÒÅ³ÃÕÒæWfW'’‚…·‚Ç¥Ò“Óåbç6öÖR‚‡bÆ’“Óæ’S3ÓÓÓbdÖF‚æ'2‡b×‚“ÃRÓbbdÖF‚æ'2…e¶’³%Ò×¢“ÃRÓb’—Ó·Ò’‚–“°¢&V6÷&B‚%÷'F&"¶¶–æB²#¢–æ7F—fRÖVÖ'&æR—2†–FFVâæB&VÂ&V7FæwVÆ"6÷&æW'2ÖF6‚F†RÖV7W&VB÷Væ–ær"Ç6†Ræöfbbg6†Rç&V7Bbg6†Ræ6÷&æW'2bg6†Rçv–GFƒÓÓÓBã“Rbg6†Ræ†V–v‡CÓÓÓbãCRbdÖF‚æ'2‡6†Ræ6VçFW"Ó2ã#R“ÃRÓbÄ¥4ôâç7G&–æv–g’‡6†R’“°¢6öç7B7–6ÆW3Öv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄsÔ"æG6"ævFRÇ&V6÷&G3ÕµÒÇ&÷w3ÕµÒÆvVöÖWG'“Ôræ†÷&—¦öâævVöÖWG'’Æ6†–ÆG&VãÔrç&ö÷Bæ6†–ÆG&Vâç6Æ–6R‚“¶f÷"†ÆWB“Ó¶“Ã3¶’²²—¶6öç7B7F'CÖ’£3µõövFT6Æö6³×7F'C¶6öç7B7F—fFVCÔræ7F—fFR‚“µõövFT6Æö6³×7F'B³µõ÷6†÷&VÆ–æRæGfæ6R‚ãR“¶6öç7B7W&vSÔræ¶vö÷6‚çf—6–&ÆRbdræ†÷&—¦öâç÷'FÅ&WfVÃÓÓÒãRbdræ¶vö÷6‚ç66ÆRçƒÓÓÔræ†Æev–GF‚¢ãRbdræ¶vö÷6‚ç66ÆRç£ÓÓÔræ†Æd†V–v‡B¢ãSµõövFT6Æö6³×7F'B³#µõ÷6†÷&VÆ–æRæGfæ6R‚ãR“·&V6÷&G2çW6‚„"ç&VæFW&W"ç7FG3òç&V6÷&G7ÇÃ“¶6öç7B7F—fSÔrç7FFSÓÓÒ$5D•dR"bdræ†÷&—¦öâçf—6–&ÆRbdræ†÷&—¦öâç÷'FÅ&WfVÃÓÓÓbbræ¶vö÷6‚çf—6–&ÆSµõövFT6Æö6³×7F'B³###Sµõ÷6†÷&VÆ–æRæGfæ6R‚ãR“¶6öç7B6Æ÷6–æsÔrç7FFSÓÓÒ%4…UDDõtâ"bdræ†÷&—¦öâç÷'FÅ&WfVÃÓÓÒãSµõövFT6Æö6³×7F'B³#CSµõ÷6†÷&VÆ–æRæGfæ6R‚ãR“·&÷w2çW6‚†7F—fFVBbg7W&vRbf7F—fRbf6Æ÷6–ærbdrç7FFSÓÓÒ$ôdb"bbræ†÷&—¦öâçf—6–&ÆRbbræ¶vö÷6‚çf—6–&ÆRbdræ†÷&—¦öâævVöÖWG'“ÓÓÖvVöÖWG'’bdrç&ö÷Bæ6†–ÆG&VâæWfW'’‚†âÆ²“ÓæãÓÓÖ6†–ÆG&Vå¶µÒ’“·×&WGW&â·&÷w2Ç&V6÷&G7Ó·Ò’‚–“°¢&V6÷&B‚%÷'F&"¶¶–æB²#¢&WVFVB&WfVÂÂ&V7FæwVÆ"7W&vRæB6‡WFF÷vâ&WF–âf—†VBvVöÖWG'’æB&VæFW&W"&V6÷&G2"Æ7–6ÆW2ç&÷w2æWfW'’„&ööÆVâ’bf7–6ÆW2ç&V6÷&G2æWfW'’†ãÓæãÓÓÖ7–6ÆW2ç&V6÷&G5³Ò’Ä¥4ôâç7G&–æv–g’†7–6ÆW2’“°¢–b‚fÆÆ&6²—¶6öç7B7FFSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“·&V6÷&B‚%÷'F&vV$tÃ¢&V7FæwVÆ"6†FW"6ö×–ÆW2æBG&w2v—F†÷WB’W'&÷'2÷"6öçFW‡BÆ÷72"Ç6†÷&VÆ–æT†VÇF‡’‡7FFR’bg7FFRç&VF&6·3ÓÓÓÄ¥4ôâç7G&–æv–g’‡7FFR’“¶"ç6†÷&VÆ–æT†VÇF‡“×6†÷&VÆ–æT†VÇF‡’‡7FFR’bf÷WGWBævWE7F÷&R‚’ç&W7VÇG2æWfW'’‡#Óç"æö²“¶"ç6†÷&VÆ–æU6ögGv&SÒõ7v–gE6†FW'ÆÆÇf×—WÇ6ögGv&Rö’çFW7B‡7FFRæwR“·Ð¢v—B"æWfÇVFR†‚‚“Óç¶Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ'&W6WB×f–Wr%Òr’æ6Æ–6²‚“¶6öç7B#ÕõööövÄCÔ"æG6#´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¢ÓCRÇ“¤BæÆæBæw&÷VæDB‚ÓCRÂÓCB’Ç£¢ÓCGÒÇ–s£Ç—F6ƒ¢ã"ÆF—7C£gÒ“µõ÷6†÷&VÆ–æRæGfæ6R‚ã“·v–æF÷råõ÷÷'F&vFSÔBævFS¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’æ6Æ–6²‚“·Ò’‚–“°¢&V6÷&B‚%÷'F&"¶¶–æB²#¢W†—7F–ær6öçFW‡GVÂF–ÆW"÷Vç2"Æv—B"æWfÇVFR‚uõööövæG6"ævFRæ—4÷VâbfFö7VÖVçBævWDVÆVÖVçD'”–B‚&ööv×÷'FÂÖÖVçR"’æ÷Vâr’“°¢v—B"æWfÇVFR‚uõövFT6Æö6³ÓS¶Fö7VÖVçBçVW'•6VÆV7F÷"‚"6ööv×÷'FÂÖÖVçR'WGFöå¶FFÖFW7F–æF–öåÒ"’æ6Æ–6²‚“µõövFT6Æö6³ÓS#µõ÷6†÷&VÆ–æRæGfæ6R‚ã’r“°¢òò&WGW&â—2F—&V7BF—&V7F÷"fFRÂæWfW"F†R–æ&÷VæBE4"GVææVÂâ&WF–âF†P¢òò6ÖRFVFÆ–æRæBf–æÂ×7FFR76W'F–öâÂ'WBW‡÷6Rv†W&Rf–ÆVBG&—7F÷2à¢6öç7B7F—fF–öãÖv—B"æWfÇVFR‚r‡·7FFS¥õööövæG6"ævFRç7FFRÆ÷Vã¥õööövæG6"ævFRæ—4÷VâÆF–Æös¦Fö7VÖVçBævWDVÆVÖVçD'”–B‚&ööv×÷'FÂÖÖVçR"’æ÷VâÇÆ–W#¢õööövç–Æ÷BçÆ–W"Æfö7W3¦Fö7VÖVçBæ7F—fTVÆVÖVçCòçFtæÖWÒ’r“°¢&V6÷&B‚%÷'F&"¶¶–æB²#¢FW7F–æF–öâ6Æ–6²7F—fFW2F†RÖVÖ'&æRæB&VÆV6W2F†RF–ÆW""Æ7F—fF–öâç7FFSÓÓÒ$5D•dR"bb7F—fF–öâæ÷Vâbb7F—fF–öâæF–Æörbf7F—fF–öâçÆ–W"Ä¥4ôâç7G&–æv–g’†7F—fF–öâ’“°¢ÆWB&WGW&æVC°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢G'—°¢&WGW&æVCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄsÕõ÷÷'F&vFRÇ&÷w3ÕµÒÆVçFW&VCÕõövFTF÷&Öæ7’æVçFW#¶ÆWBF–6·3ÓÆÆ7CÒ""Ç6V6öæG3Ó°¢6öç7B6×ÆSÒ‚“Óç¶6öç7BÔ"æ7&WsòçÆ–W"ÇÔòç&ö÷Bç÷6—F–öâÆ¶W“Ô"ç66VæR²#¢"´"çG&ç6—F–öæ–æs²–b†¶W’ÓÖÆ7GÇÇF–6·2ScÓÓÓ—·&÷w2çW6‚‡·F–6³§F–6·2Ç66VæS¤"ç66VæRÇG&ç6—F–öã¤"çG&ç6—F–öæ–ærÆvFS¤rç7FFRÆ÷Vã¤ræ—4÷VâÆ–çWC¤"ç–Æ÷Còæ6öçG&öÇ2ç&VB‚’ç’ÇÆ–W#¤òçG&—G2ææÖRÇƒ§òç‚Ç“§òç’Ç£§òç§Ò“¶Æ7CÖ¶W“·×F–6·2²³·Ó°¢6×ÆR‚“·v†–ÆR‚„"ç66VæSÓÓÒ&&–g&÷7B"bb"çG&ç6—F–öæ–ær’bg6V6öæG3Ã‚—µõ÷6†÷&VÆ–æRæGfæ6RƒÇ6×ÆR“·6V6öæG2²³·Ð¢&WGW&â·&VG“¤"ç66VæSÓÓÒ&&–g&÷7B"bb"çG&ç6—F–öæ–ærÆF—7÷6VC¤ræF—7÷6VBbbrç&ö÷Bç&VçBbbræ†÷&—¦öâçf—6–&ÆRÆæôG6%&VVçG'“¥õövFTF÷&Öæ7’æVçFW#ÓÓÖVçFW&VBÇ6V6öæG2Ç&÷w7Ó·Ò’‚–“°¢Öf–æÆÇ—¶v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“·Ð¢&V6÷&B‚%÷'F&"¶¶–æB²#¢¶W–&ö&B7&÷76W2F†RW'GW&RFò&–g&÷7BæBF—7÷6W2F†RöÆBvFR"Ç&WGW&æVBç&VG’bg&WGW&æVBæF—7÷6VBbg&WGW&æVBææôG6%&VVçG'’Ä¥4ôâç7G&–æv–g’‡&WGW&æVB’“°§×Õ×Ò“° ¦f÷"†6öç7BfÆÆ&6²öb¶fÇ6RÇG'VUÒ—66VæR‚&G6""Ç¶Æ&VÃ¢%÷'F&f—7VÂWf–FVæ6R"²†fÆÆ&6³ò$6çf2†öæR#¢%vV$tÂ"’ÇVW'“¢"gf–Ws×÷'F&gvVF†W#Ö6ÆV"gF–ÖSÓ#"²†fÆÆ&6³ò"f6çf3&CÓ#¢""’Æ÷G3¦fÆÆ&6³÷²ââå„ôäUõ4•¤RÆÖ÷F–öã§G'VWÓ§·s£ƒÆƒ£cÆÖ÷F–öã§G'VWÒÇ7FW3¥·¶æÖS¢&G6"÷'F&W'GW&Rf—7VÂWf–FVæ6R"²†fÆÆ&6³ò$6çf2#¢%vV$tÂ"’Çv‡“¢&6öçG&7C¢&WF–â‡VÖâWf–FVæ6RöbF†RW†7BW'GW&R–â&÷F‚&VæFW&W'2gFW"gVæ7F–öæÂ6†V6·2"Ç'Vã¦7–æ2#Óç°¢6öç7B÷WCÖ¦ö–â‡&ö÷BÂ'VçG&6¶VB÷vFW"×&Wf–Wr"“¶Ö¶F—%7–æ2†÷WBÇ·&V7W'6—fS§G'VWÒ“¶v—B"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&÷fW&Æ’"’ç7G–ÆRçf—6–&–Æ—G“Ò&†–FFVâ"r“°¢f÷"†6öç7B¶æÖRÇF–ÖUÒöbµ²&öfb"ÃÒÅ²'7W&vR"ÃÒÅ²&7F—fR"Ã#ÕÒ—°¢v—B"æWfÇVFR†õövFT6Æö6³ÒG·F–ÖWÓ¶–b‚G·F–ÖWÓÓÓÓ—µõövFT6Æö6³ÓµõööövæG6"ævFRæ7F—fFR‚“µõövFT6Æö6³Ó·Õõ÷6†÷&VÆ–æRæGfæ6R‚ãR–“°¢–b‚fÆÆ&6²—¶6öç7B7FFSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“¶–b‚6†÷&VÆ–æT†VÇF‡’‡7FFR’—F‡&÷rW'&÷"‚%÷'F&Wf–FVæ6RvV$tÃ¢"´¥4ôâç7G&–æv–g’‡7FFR’“¶"ç6†÷&VÆ–æT†VÇF‡“×G'VS¶"ç6†÷&VÆ–æU6ögGv&SÒõ7v–gE6†FW'ÆÆÇf×—WÇ6ögGv&Rö’çFW7B‡7FFRæwR“·Ð¢6öç7B6†÷CÖv—B"ç6VæB‚%vRæ6GW&U67&VVç6†÷B"Ç¶f÷&ÖC¢'ær'ÒÃS“¶–b‚6†÷Bç&W7VÇCòæFF—F‡&÷rW'&÷"‚%÷'F&67&VVç6†÷B&WGW&æVBæò–ÖvR"“·w&—FTf–ÆU7–æ2†¦ö–â†÷WBÂ'÷'F&Ò"²†fÆÆ&6³ò&6çf2#¢'vV&vÂ"’²"Ò"¶æÖR²"çær"’Ä'VffW"æg&öÒ‡6†÷Bç&W7VÇBæFFÂ&&6ScB"’“°¢Ð§×Õ×Ò“° ¢òò÷F–öæÂ‡VÖâWf–FVæ6S¢6W&FR6‡&öÖR÷6W76–öâgFW"F†RgVæ7F–öæÂvFRÂæWfW"—G2&VF–æW72÷&6ÆRà§66VæR‚&G6""Ç¶Æ&VÃ¢'6†÷&VÆ–æRf—7VÂWf–FVæ6R"ÇVW'“¢"gf–Ws×vFW"ÖG'’gvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£cCÆƒ£CÒÇ7FW3¥·¶æÖS¢&G6"6†÷&VÆ–æRf—7VÂWf–FVæ6R"Çv‡“¢&6öçG&7C¢&W6W'fR&Wf–Wr67&VVç6†÷G2gFW"vV$tÂ&VF–æW72v—F†÷WB&Æö6¶–ærgVæ7F–öæÂFWÆ÷–ÖVçBfÆ–FF–öâ"Ç'Vã¦7–æ2#Óç°¢6öç7BF‡3Ö¦ö–â‡&ö÷BÂ'VçG&6¶VB÷vFW"×&Wf–Wr"“¶Ö¶F—%7–æ2‡F‡2Ç·&V7W'6—fS§G'VWÒ“°¢f÷"†6öç7B¶æÖRÆ†÷W"ÇvVF†W%Òöbµ²&æööâ"Ã"Â&6ÆV"%ÒÅ²&vöÆFVâ"Ã‚Â&6ÆV"%ÒÅ²&æ–v‡B"Ã#2Â&6ÆV"%ÒÅ²'&–â"Ã"Â'&–â%ÒÅ²'7F÷&Ò"Ã"Â'7F÷&Ò%ÕÒ—°¢v—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"ÆcÔBæöÇ–×W2æ–×7G5³Ó´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¦bç‚³RÇ“¤BæÆæBæ†V–v‡DB†bç‚³RÆbç¢³2’Ç£¦bç¢³7ÒÇ–s£ãRÇ—F6ƒ¢ãBÆF—7C£‡Ò“´"æF–Æ–v‡Bç&VCÒ‚“ÓâG¶†÷W'Ó´"æF–Æ–v‡Bæ6öçF–çV÷W4F“Ô"æF–Æ–v‡BæF”öe–V"Ó²G¶†÷W'Òó#C´BçvVF†W"ç6WDÖöFR‚G´¥4ôâç7G&–æv–g’‡vVF†W"—Ò“µõ÷6†÷&VÆ–æRæGfæ6R‚ã#R“·Ò’‚–“°¢6öç7B7FFSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“°¢–b‚6†÷&VÆ–æT†VÇF‡’‡7FFR’—F‡&÷rW'&÷"‚%f—7VÂWf–FVæ6RvV$tÂ7FFS¢"´¥4ôâç7G&–æv–g’‡7FFR’“°¢"ç6†÷&VÆ–æT†VÇF‡“×G'VS¶"ç6†÷&VÆ–æU6ögGv&SÒõ7v–gE6†FW'ÆÆÇf×—WÇ6ögGv&Rö’çFW7B‡7FFRæwR“°¢6öç7B6†÷CÖv—B"ç6VæB‚%vRæ6GW&U67&VVç6†÷B"Ç¶f÷&ÖC¢'ær'ÒÃS“°¢–b‚6†÷Bç&W7VÇCòæFF—F‡&÷rW'&÷"‚%67&VVç6†÷B6GW&R&WGW&æVBæò–ÖvR"“°¢w&—FTf–ÆU7–æ2†¦ö–â‡F‡2Â'vFW&fÆÂÒ"¶æÖR²"çær"’Ä'VffW"æg&öÒ‡6†÷Bç&W7VÇBæFFÂ&&6ScB"’“°¢Ð§×Õ×Ò“° §66VæR‚&G6""Ç¶Æ&VÃ¢'6†÷&VÆ–æRf—7VÂWf–FVæ6R6ö7B"ÇVW'“¢"gf–Ws×vFW"×–W"×vW7BgvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£cCÆƒ£CÒÇ7FW3¥·¶æÖS¢&G6"6†÷&VÆ–æR6ö7Bf—7VÂWf–FVæ6R"Çv‡“¢&6öçG&7C¢–ç7V7B&V6‚Â&ö6·’6ö7BæB&÷F‚7W÷'FVB–W'2gFW"gVæ7F–öæÂfÆ–FF–öâÂ–æ6ÇVF–æræ–v‡B&–â"Ç'Vã¦7–æ2#Óç°¢6öç7BF‡3Ö¦ö–â‡&ö÷BÂ'VçG&6¶VB÷vFW"×&Wf–Wr"“¶Ö¶F—%7–æ2‡F‡2Ç·&V7W'6—fS§G'VWÒ“°¢f÷"†6öç7B¶æÖRÇ‚Ç¢Ç–rÇ—F6‚ÆF—7BÆ†÷W"ÇvVF†W%Òöbµ²&&V6‚"Ã#ÃsbÄÖF‚å’Âã#"Ã’Ã"Â&6ÆV"%ÒÅ²'&ö6·2"Ãs"ÃCRÂÓãÂã#RÃbÃ"Â&6ÆV"%ÒÅ²&†&&÷""ÂÓ3’ÃC"ÂãRÂãC"Ã3‚Ã"Â&6ÆV"%ÒÅ²'–W"×vW7B"ÂÓC2ÃCbÄÖF‚å’ÂãbÃRÃ"Â&6ÆV"%ÒÅ²'–W"ÖV7B"ÂÓ3BÃCbÄÖF‚å’ÂãbÃRÃ"Â&6ÆV"%ÒÅ²&†&&÷"Öæ–v‡B×&–â"ÂÓ3’ÃC"ÂãRÂãC"Ã3‚Ã#2Â'&–â%ÕÒ—°¢v—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6#´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¢G·‡ÒÇ“¤BæÆæBæw&÷VæDB‚G·‡ÒÂG·§Ò’Ç£¢G·§×ÒÇ–s¢G·–wÒÇ—F6ƒ¢G·—F6‡ÒÆF—7C¢G¶F—7G×Ò“´"æF–Æ–v‡Bç&VCÒ‚“ÓâG¶†÷W'Ó´"æF–Æ–v‡Bæ6öçF–çV÷W4F“Ô"æF–Æ–v‡BæF”öe–V"Ó²G¶†÷W'Òó#C´BçvVF†W"ç6WDÖöFR‚G´¥4ôâç7G&–æv–g’‡vVF†W"—Ò“µõ÷6†÷&VÆ–æRæGfæ6R‚ã#R“·Ò’‚–“°¢6öç7B7FFSÖv—B"æWfÇVFR†‚G·6†÷&VÆ–æU7FFRçFõ7G&–ær‚—Ò’‚–“¶–b‚6†÷&VÆ–æT†VÇF‡’‡7FFR’—F‡&÷rW'&÷"‚$6ö7BWf–FVæ6RvV$tÂ7FFS¢"´¥4ôâç7G&–æv–g’‡7FFR’“°¢"ç6†÷&VÆ–æT†VÇF‡“×G'VS¶"ç6†÷&VÆ–æU6ögGv&SÒõ7v–gE6†FW'ÆÆÇf×—WÇ6ögGv&Rö’çFW7B‡7FFRæwR“°¢6öç7B6†÷CÖv—B"ç6VæB‚%vRæ6GW&U67&VVç6†÷B"Ç¶f÷&ÖC¢'ær'ÒÃS“¶–b‚6†÷Bç&W7VÇCòæFF—F‡&÷rW'&÷"‚$6ö7B67&VVç6†÷B&WGW&æVBæò–ÖvR"“°¢w&—FTf–ÆU7–æ2†¦ö–â‡F‡2Â&6ö7BÒ"¶æÖR²"çær"’Ä'VffW"æg&öÒ‡6†÷Bç&W7VÇBæFFÂ&&6ScB"’“°¢Ð§×Õ×Ò“° ¦6öç7BG6%vFW$6†V6·ö–çBÒ²æÖS¢&G6"vFW"6†V6·ö–çB"Âv‡“¢&6öçG&7C¢VvVâvFW"&W6W'fW2Ö÷fVÖVçBæB&VÆV6W2—G2uRFW‡GW&W27&÷72÷'F&G&—2"Â'Vã¢7–æ2"Óâ°¢6öç7B#Öv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B#ÕõööövÅsÔ"æG6"çvFW"Æf—'7CÖæWrV–çC„'&’…rç—†VÇ2“°¢rçWFFRƒ2“¶6öç7BÖ÷fVCÕrç—†VÇ2ç6öÖR‚‡‚Æ’“Óç‚ÓÖf—'7E¶•Ò“°¢rçWFFRƒ“¶6öç7B¦W&óÖæWrV–çC„'&’…rç—†VÇ2“µrçWFFRƒ#“°¢6öç7BÆö÷Õrç—†VÇ2æWfW'’‚‡‚Æ’“ÓçƒÓÓ×¦W&õ¶•Ò’Æf–æ—FSÕræ†V–v‡G2æWfW'’„çVÖ&W"æ—4f–æ—FR“°¢6öç7B7F'C×W&f÷&Öæ6Rææ÷r‚“¶f÷"†ÆWB“Ó¶“Ãc¶’²²•rçWFFR†’óc“°¢&WGW&â¶¶–æC¤"ç&VæFW&W"æ¶–æBÇFW‡GW&W3¤"ç&VæFW&W"ç7FG2çvFW%FW‡GW&W2ÆÖ÷fVBÆÆö÷Æf–æ—FRÆ6÷7C¢‡W&f÷&Öæ6Rææ÷r‚’×7F'B’ócÀ¢FWF„æV#¥ræFWF„B‚Ó3’ÃSB’ÆFWF„f#¥ræFWF„Bƒ#SÃ#S’Æ6ÖW&¤"æG6"æ÷fW'f–WwÓ°¢Ò’‚–“°¢6öç7B6çf3Öv—B"æWfÇVFR‚væWrU$Å6V&6…&×2†Æö6F–öâç6V&6‚’æ†2‚&6çf3&B"’r“°¢&V6÷&B‚$E4"deC¢f–æ—FRÂW&–öF–2Âæ–ÖFVC²FWF‚w&÷w2öfg6†÷&S²&VæFW&W"7F—2f–Æ&ÆR"Ç"æf–æ—FRbg"æÆö÷bg"æÖ÷fVBbg"æFWF„f#ç"æFWF„æV"bb†6çf3÷"æ¶–æCÓÓÒ&6çf3&B#§"æ¶–æCÓÓÒ'vV&vÃ""bg"çFW‡GW&W3ÓÓÓ"’Ä¥4ôâç7G&–æv–g’‡"’“°¢–b‚6çf2—°¢v—B"æWfÇVFR†Fö7VÖVçBçVW'•6VÆV7F÷"‚u¶FFÖ7F–öãÒ'&W6WB×f–Wr%Òr’æ6Æ–6²‚–“°¢6öç7B&Vf÷&SÖv—B"æWfÇVFR‚r‡·ƒ¥õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç‚Ç£¥õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç§Ò’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'2"Æ6öFS¢$¶W•2'Ò“°¢v—B"æWfÇVFR‚uõööövæGfæ6R‚ã2’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'2"Æ6öFS¢$¶W•2'Ò“°¢6öç7BgFW#Öv—B"æWfÇVFR‚r‡·ƒ¥õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç‚Ç£¥õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç§Ò’r“°¢&V6÷&B‚$E4"¶W–&ö&BÖ÷fVÖVçB7F–ÆÂvÆ·2öâ&÷fVBÆæB"ÄÖF‚æ‡—÷B†gFW"ç‚Ö&Vf÷&Rç‚ÆgFW"ç¢Ö&Vf÷&Rç¢“âãRÄ¥4ôâç7G&–æv–g’‡¶&Vf÷&RÆgFW'Ò’“°¢Ð¢6öç7BæÖSÖv—B"æWfÇVFR‚uõööövæG6"æfF"çG&—G2ææÖRr“°¢f÷"†ÆWB“Ó¶“Ã#¶’²²—°¢6öç7B7&÷76VCÖv—B"æWfÇVFR†‚‚’Óâ¶6öç7B#ÕõööövÄsÔ"æG6"ævFS´rç&V6V—fR‚“·&WGW&ârçG&fW'6R‡·ƒ¢ÓCRÇ“£CãBÇ£¢ÓCgÒÇ·ƒ¢ÓCRÇ“£CãBÇ£¢ÓSÒÂã2“·Ò’‚–“°¢v—BVçF–ÅvR†"Ât"ç66VæSÓÓÒ&&–g&÷7B"bb"çG&ç6—F–öæ–ærrÃ#“°¢6öç7B&VÆV6VCÖv—B"æWfÇVFR‚uõööövç&VæFW&W"ç7FG2çvFW%FW‡GW&W2r“°¢v—B"æWfÇVFR‚uõööövævò‚&G6""’r“°¢v—BVçF–ÅvR†"Ât"ç66VæSÓÓÒ&G6""bb"çG&ç6—F–öæ–ærrÃ#“°¢6öç7B&WGW&æVCÖv—B"æWfÇVFR‚r‡¶æÖS¥õööövæG6"æfF"çG&—G2ææÖRÇFW‡GW&W3¥õööövç&VæFW&W"ç7FG2çvFW%FW‡GW&W7Ò’r“°¢&V6÷&B‚$E4"vFW"G&—"¶’²#¢÷'F&7&÷76–ær&W6W'fW2–FVçF—G’æB&VÆV6W2FW‡GW&W2"Æ7&÷76VBbg&VÆV6VCÓÓÓbg&WGW&æVBææÖSÓÓÖæÖRbg&WGW&æVBçFW‡GW&W3ÓÓÒ†6çf3ó£"’Ä¥4ôâç7G&–æv–g’‡¶7&÷76VBÇ&VÆV6VBÇ&WGW&æVGÒ’“°¢Ð§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢'vFW"6†V6·ö–çB"ÇVW'“¢"f÷fW'f–WsÓ"Ç7FW3¥¶G6%vFW$6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢'vFW"6†V6·ö–çB6çf2"ÇVW'“¢"f÷fW'f–WsÓf6çf3&CÓ"Ç7FW3¥¶G6%vFW$6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢'vFW"6†V6·ö–çB†öæR"ÇVW'“¢"f÷fW'f–WsÓ"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6%vFW$6†V6·ö–çE×Ò“° ¢òòF†R7W'&VçBÖ7FW"66VæRFVÆ–&W&FVÇ’öÖ—G2F†RöÆBGG&7F–öâ&÷F÷G—RâW†W&6—6R—G0¢òòVçf—&öæÖVçBF‡&÷Vv‚F†R6ÖRV&Æ–2FV'Vr7W&f6RW6VB'’F†Rf—7VÂ&Wf–Wrà¦6öç7BG6%vVF†W$6†V6·ö–çBÒ²æÖS¢&G6"vVF†W"6†V6·ö–çB"Âv‡“¢''VÆS¢vVF†W"&V6÷fW'2Fò6ÆV"Â&W6W'fW2æ–v‡BæBvFW2W‡FW&–÷"6÷VæBv—F†÷WBw&÷v–ær'F–6ÆR÷"uRööÇ2"Â'Vã¢7–æ2"Óâ°¢v—B"æ¶W’‚&Ò"“²v—B"æ¶W’‚&Ò"“²òò&VÂvW7GW&RVæÆö6·2F†R6†&VB6÷VæBw&‚à¢6öç7B"Òv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B#ÕõööövÄCÔ"æG6"ÅsÔBçvVF†W"Å3Õrç6†&VBç7FFRÄóÔ"ç&VæFW$÷G3°¢ÆWBVÆ6VCÓ¶6öç7BGfæ6S×6V6öæG3Óç¶f÷"†ÆWBCÓ·CÇ6V6öæG3·B³Óóc”$Âç66VæW2æG6"çWFFRƒócÆVÆ6VB³Óóc“·Ó°¢6öç7B6WGFÆSÒ‚“ÓæGfæ6Rƒ‚“°¢rç6WDÖöFR‚&6ÆV""“·6WGFÆR‚“°¢6öç7B&6S×¶Æ–v‡C¤òæF—&V7E7G&VæwF‚Ç6·“¤'&’æg&öÒ„òç6·’’ÇvfS¤BçvFW"æVçf—&öæÖVçE³ÒÆG&÷3¥2æG&÷7Ó°¢rç6WDÖöFR‚&Æ–v‡B×&–â"“·6WGFÆR‚“°¢6öç7B&–ã×¶Æ–v‡C¤òæF—&V7E7G&VæwF‚ÆG&÷3¥2æG&÷2Æ6Æ÷VC¥rç7FFRæ6Æ÷VBÇvfS¤BçvFW"æVçf—&öæÖVçE³×Ó°¢rç6WDÖöFR‚'7F÷&Ò"“·6WGFÆR‚“°¢6öç7B7F÷&Ó×¶Æ–v‡C¤òæF—&V7E7G&VæwF‚ÆG&÷3¥2æG&÷2Æ6Æ÷VC¥rç7FFRæ6Æ÷VBÇvfS¤BçvFW"æVçf—&öæÖVçE³ÒÇ7G&–¶W3¥2ç7G&–¶W7Ó°¢rç7G&–¶R‚“¶Gfæ6R‚ãB“¶6öç7BfÆ6ƒÕ2æfÆ6ƒ¶Gfæ6Rƒ"“¶6öç7BW‡—&VCÕ2æfÆ6ƒÓÓÓ°¢Bç6WD–çFW&–÷"‡G'VR“¶Gfæ6R‚ã“°¢6öç7BvFVCÒ2æW‡FW&–÷"be2æG&÷3ÓÓÓbe2æÖ7FW$ÆWfVÃÓÓÓbb2çF‡VæFW%VæF–æs°¢Bç6WD–çFW&–÷"†fÇ6R“¶Gfæ6Rƒ“°¢6öç7B&W7VÖVCÕ2æW‡FW&–÷"be2æG&÷3ãbe2æÖ7FW$ÆWfVÃã°¢6öç7BF–W#Ô"ç&VæFW&W"çVÆ—G“´"ç&VæFW&W"ç6WEVÆ—G’‚&Æ÷r"“¶Gfæ6Rƒ"“°¢6öç7B&÷VæFVCÕ2æG&÷3ÃÓ#cbe2æFV6µ6†÷vãÃÓ##°¢"ç&VæFW&W"ç6WEVÆ—G’‡F–W"“µrç6WDÖöFR‚&6ÆV""“·6WGFÆR‚“°¢6öç7B&V6÷fW&VCÔÖF‚æ'2„òæF—&V7E7G&VæwF‚Ö&6RæÆ–v‡B“Âãbe2æG&÷3ÓÓÓbdBçvFW"æVçf—&öæÖVçE³ÓÓÓÓ°¢6öç7Bf–æ—FSÔ'&’æg&öÒ„BçvFW"æVçf—&öæÖVçB’æWfW'’„çVÖ&W"æ—4f–æ—FR’bdBçvFW"æ†V–v‡G2æWfW'’„çVÖ&W"æ—4f–æ—FR“°¢&WGW&â¶&6RÇ&–âÇ7F÷&ÒÆfÆ6‚ÆW‡—&VBÆvFVBÇ&W7VÖVBÆ&÷VæFVBÇ&V6÷fW&VBÆf–æ—FRÇF‡VæFW'3¥2çF‡VæFW'2Æ¶–æC¤"ç&VæFW&W"æ¶–æBÇFW‡GW&W3¤"ç&VæFW&W"ç7FG2çvFW%FW‡GW&W7Ó°¢Ò’‚–“°¢&V6÷&B‚$E4"vVF†W#¢&–âæB7F÷&ÒGFVçVFRF–Æ–v‡BæB&—6R&÷VæFVBvFW"VæW&w’"Ç"æ&6RæG&÷3ÓÓÓbg"ç&–âæG&÷3ãbg"ç&–âæÆ–v‡CÇ"æ&6RæÆ–v‡Bbg"ç7F÷&ÒæÆ–v‡CÇ"ç&–âæÆ–v‡Bbg"ç7F÷&ÒçvfSç"ç&–âçvfRbg"ç7F÷&Òç7G&–¶W3ãÄ¥4ôâç7G&–æv–g’‡"’“°¢&V6÷&B‚$E4"vVF†W#¢fÆ6‚W‡—&W2ÂW‡FW&–÷"vFR6–ÆVæ6W2æB&W7VÖW2ÂF–W'2&÷VæBööÇ2æB6ÆV"&V6÷fW'2"Ç"æfÆ6ƒãbg"æW‡—&VBbg"çF‡VæFW'3ãbg"ævFVBbg"ç&W7VÖVBbg"æ&÷VæFVBbg"ç&V6÷fW&VBbg"æf–æ—FRÄ¥4ôâç7G&–æv–g’‡"’“°¢6öç7Bæ–v‡CÖv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B#ÕõööövÄCÔ"æG6#´BçvVF†W"ç6WDÖöFR‚'&–â"“¶f÷"†ÆWB“Ó¶“Ã#C¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc“´$ÂæF–Æ–v‡Bç6×ÆRƒÄ"ç&VæFW$÷G2ÃƒÃ3r“´BçvVF†W"çWFFRƒÄ"ç&VæFW$÷G2“°¢&WGW&â¶F“¤"ç&VæFW$÷G2æF’ÆÆ×3¤"ç&VæFW$÷G2æÆ×f7F÷"ÆG&÷3¤BçvVF†W"ç6†&VBç7FFRæG&÷2ÆvÆ–çC¤BçvFW"æVçf—&öæÖVçE³%ÒÇ6·“¤'&’æg&öÒ„"ç&VæFW$÷G2ç6·’—Ó°¢Ò’‚–“°¢&V6÷&B‚$E4"æ–v‡B&–ã¢6Æö6²7F—2Bæ–v‡BÂÆ×27F’Æ—BÂ&V6——FF–öâ7F—2f—6–&ÆRæB6öÆ"vÆ–çG2fæ—6‚"Ææ–v‡BæF“ÓÓÓbfæ–v‡BæÆ×3âã’bfæ–v‡BæG&÷3ãbfæ–v‡BævÆ–çCÓÓÓbfæ–v‡Bç6·’æWfW'’„çVÖ&W"æ—4f–æ—FR’Ä¥4ôâç7G&–æv–g’†æ–v‡B’“°¢&V6÷&B‚$E4"vVF†W#¢'VçF–ÖR6öç6öÆR&VÖ–ç26ÆVâ"Æ"æÆöw2æÆVæwFƒÓÓÓÆ"æÆöw2æ¦ö–â‚"Â"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢'vVF†W"6†V6·ö–çB"ÇVW'“¢"f÷fW'f–WsÓgvVF†W#Ö6ÆV"gF–ÖSÓ#"Ç7FW3¥¶G6%vVF†W$6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢'vVF†W"6†V6·ö–çB†öæR"ÇVW'“¢"f÷fW'f–WsÓgvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6%vVF†W$6†V6·ö–çE×Ò“° ¦6öç7BG6%&F–õGd6÷'&V7F–öâÒ²æÖS¢&G6"&F–òEb6÷'&V7F–öâ"Âv‡“¢'&Vw&W76–öã¢&W7F÷&RF†R‡—6–6Â&F–òEbÂ6fR–çfö–6RfÆ÷ræBW†6ÇW6—fRÆ—fRöfÆÆ&6²VF–òv—F‚F†R6†&VB–çFW&–÷"vFR"Â'Vã¦7–æ2#Óç°¢6öç7B7FWÒ‚“Óæ"æWfÇVFR‚vf÷"†ÆWB“Ó¶“Ãc¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc’r“°¢6öç7B6Æ–6³Ö7–æ2–CÓç¶6öç7BÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚G´¥4ôâç7G&–æv–g’†–B—Ò“¶Rç67&öÆÄ–çFõf–Wr‡¶&Æö6³¢&6VçFW"'Ò“¶6öç7B#ÖRævWD&÷VæF–æt6Æ–VçE&V7B‚“·&WGW&â·ƒ§"ç‚·"çv–GF‚ó"Ç“§"ç’·"æ†V–v‡Bó'Ó·Ò’‚–“¶v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Ç·G—S¢'F÷V6…7F'B"ÇF÷V6…ö–çG3¥·×Ò“¶v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Ç·G—S¢'F÷V6„VæB"ÇF÷V6…ö–çG3¥µ×Ò“·Ó°¢v—B"æ¶W’‚&Ò"“¶v—B"æ¶W’‚&Ò"“¶v—B7FW‚“°¢v—B"æWfÇVFR‚wv–æF÷råõö6÷'&V7F–öã×¶VF–ó¥õööövæG6"ææöFW'VææW"æVF–òÇGc¥õööövæG6"çGgÓµõööövæG6"çGbæ6Æ÷6R‚’r“°¢v—B6Æ–6²‚&G6"Ö6öçFW‡B"“¶v—B7FW‚“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢‡—6–6ÂæV&'’F÷V6‚7F–öâ÷Vç2f—fRÖ6†ææVÂÖVçR"Æv—B"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb"’æ÷VâbfFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"6G6"×GbÖÖVçR'WGFöâ"’æÆVæwFƒÓÓÓRbfFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"6G6"×GbÖÖVçR'WGFöã¦F—6&ÆVB"’æÆVæwFƒÓÓÓBr’“°¢v—B6Æ–6²‚&G6"×GbÖ6†ææVÂ"“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢&÷VæFVBÖWFFFæBÆö6Âöff–6–Â"&Rf—6–&ÆR"Æv—B"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×6öær"’çFW‡D6öçFVçCÓÓÒ%GW'FÆR&F–ò"bfFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"6G6"×Gb×VWVRÆ’"’æÆVæwFƒÓÓÓbfFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×""’çv–GFƒãr’“°¢v—B"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×VW'’"’çfÇVSÒ$ööv"r“¶v—B6Æ–6²‚&G6"×Gb×6V&6‚"“°¢v—B"æWfÇVFR‚wv–æF÷råõ÷–ÖVçD6Æö6³×¶æF—fS§v–æF÷rç6WEF–ÖV÷WBæ&–æB‡v–æF÷r—Ó·v–æF÷rç6WEF–ÖV÷WCÒ†fâÆ×2Âââæ&w2“Óç¶–b†×3ÓÓÓS—µõ÷–ÖVçD6Æö6²çF–6³Öfãµõ÷–ÖVçD6Æö6²æ–CÕõ÷–ÖVçD6Æö6²ææF—fR‚‚“Óç·ÒÆ×2“·&WGW&âõ÷–ÖVçD6Æö6²æ–C·×&WGW&âõ÷–ÖVçD6Æö6²ææF—fR†fâÆ×2Âââæ&w2“·Ó¶Fö7VÖVçBçVW'•6VÆV7F÷"‚"6G6"×Gb×&W7VÇG2'WGFöâ"’æ6Æ–6²‚’r“¶v—B"ç6ÆVWƒ“°¢6öç7B–çfö–6SÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BCÔ$ÂæG6%GbÆvööC×²&&öÇC#¢&Ææ&3#ãGg§S'SG6s·†f3W&×G¦ÃvW§wcGV×‡3‡Vgƒ“†7–¦§6£—v·£vÃ6Ãvg6GÇFg6‡ws&3c—c&cg—·§VãF77–¶ÖÓ–FSV·vwG—†¦'&FV·Vw§§cG6·ƒg7§§7‡§W—7S3Vg—c6f6FæcS—7Gãƒ&fCf×—vC#CW#†ã—¦sfÖ6çƒ“‡w3c‡c'3—‡—6w†£C3&×§†çS“7cvg‡g3††cSƒF¦wfV¦36×'w&¶†W—F†‡6S–ÆF³ƒ&Æ3C6æ¦ã3–F733fÓF¦g†wVs&3sFV7¦¦fÓ6WsSGC‡¦6æ‚"Â'6G2#¢#Â'–ÖVçEö†6‚#¢#v#cCs6V3cFSf3VCc&ff###s3&6V6C6c#c#–cC“F#&&3&cvS6fcsS2'ÒÆ&C×²ââævööBÇ6G3£ÒÆÆöæsÒ%ÇS"²'‚"ç&WVBƒS“·&WGW&â·fÆ–C¥BçfÆ–D–çfö–6R†vööB’Æ&C¥BçfÆ–D–çfö–6R†&B’Æ†6ƒ¥BçfÆ–D–çfö–6R‡²ââævööBÇ–ÖVçEö†6ƒ¢&&B'Ò’Æ6†V6³¥BçfÆ–D–çfö–6R‡²ââævööBÆ&öÇC¦vööBæ&öÇCç6Æ–6RƒÂÓ’²''Ò’Æ6ÆVã¥Bæ6ÆVâ†Æöær’æÆVæwF‚Æ&÷VæFVC¥Bç&W7VÇG2‡·&W7VÇG3¤'&’æg&öÒ‡¶ÆVæwFƒ£3ÒÂ‚“Óâ‡·F—FÆS¦ÆöærÆ'F—7C¢#Æ–Ösâ"Ç6÷W&6S¢&Æ–'&'’'Ò’—Ò’æÆVæwF‚Æ÷Vã¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ–çfö–6R"’æ†–FFVâÇ#¦Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ–çfö–6R×""’çv–GF‚ÆÆ–æ³¦Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×vÆÆWB"’ævWDGG&–'WFR‚&‡&Vb"’Çv–GFƒ¦Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb"’ç67&öÆÅv–GFƒÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb"’æ6Æ–VçEv–GF‡Ó·Ò’‚–“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢fÆ–B7FF–öâ–çfö–6RÂÆö6Â"Â&÷VæFVBFFæBÖö&–ÆRÆ–÷WB"Æ–çfö–6RçfÆ–Bbb–çfö–6Ræ&Bbb–çfö–6Ræ†6‚bb–çfö–6Ræ6†V6²bf–çfö–6Ræ6ÆVãÓÓÓcbf–çfö–6Ræ&÷VæFVCÓÓÓ"bf–çfö–6Ræ÷Vâbf–çfö–6Rç#ã#bf–çfö–6RæÆ–æ²ç7F'G5v—F‚‚&Æ–v‡Fæ–æs¦Ææ&2"’bf–çfö–6Rçv–GF‚Ä¥4ôâç7G&–æv–g’†–çfö–6R’“°¢v—B"æWfÇVFR‚vFö7VÖVçBçVW'•6VÆV7F÷"‚"6G6"×Gb×&W7VÇG2'WGFöâ"’æ6Æ–6²‚’r“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢GWÆ–6FR–çfö–6R—2&VgW6VB"Æv—B"æWfÇVFR‚uõöG6%Gdf—‡GW&Ræ–çfö–6W3ÓÓÓr’“°¢6öç7B–ÖVçCÖ7–æ2‡fÇVRÆW'&÷#ÖfÇ6R“Óç¶v—B"æWfÇVFR†õöG6%Gdf—‡GW&Rç–ÖVçCÒG´¥4ôâç7G&–æv–g’‡fÇVR—ÓµõöG6%Gdf—‡GW&Rç–ÖVçDW'&÷#ÒG¶W'&÷'Ó¶6ÆV%F–ÖV÷WB…õ÷–ÖVçD6Æö6²æ–B“µõ÷–ÖVçD6Æö6²çF–6²‚–“¶v—B"ç6ÆVWƒC“·&WGW&â"æWfÇVFR‚vFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×–ÖVçB×7FGW2"’çFW‡D6öçFVçBr“·Ó°¢6öç7BVç–CÖv—B–ÖVçB‡·–C¦fÇ6RÇVWVVC¦fÇ6WÒ’ÆöffÆ–æSÖv—B–ÖVçB†çVÆÂÇG'VR’Ç–CÖv—B–ÖVçB‡·–C§G'VRÇVWVVC¦fÇ6WÒ’ÇVWVVCÖv—B–ÖVçB‡·–C§G'VRÇVWVVC§G'VWÒ“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢Vç–BÂf–ÇW&RÂ–BæBVWVVB7FFW2æWfW"7VvvW7B6V6öæB–ÖVçB"ÇVç–Bæ–æ6ÇVFW2‚%v—F–ærf÷"–ÖVçB"’bföffÆ–æRæ–æ6ÇVFW2‚&Fòæ÷B’Gv–6R"’bg–Bæ–æ6ÇVFW2‚'v—F–ærf÷"F†R7FF–öâ"’bgVWVVBæ–æ6ÇVFW2‚'–÷W"6öær—2VWVVB"’“°¢v—B6Æ–6²‚&G6"×GbÖ6÷’"“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢6÷’7V66VVG2÷"6VÆV7G2F†RgVÆÂ–çfö–6R"Æv—B"æWfÇVFR‚rô–çfö–6R6÷–VGÄ–çfö–6R6VÆV7FVBòçFW7B†Fö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb×–ÖVçB×7FGW2"’çFW‡D6öçFVçB’r’“°¢v—B"æWfÇVFR‚wv–æF÷råõö6÷'&V7F–öâæWö6ƒÕõööövæG6"çGbç7FG2ç–ÖVçDWö6‚r“¶v—B6Æ–6²‚&G6"×GbÖ6æ6VÂÖ–çfö–6R"“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢6Æ÷6–ær–çfö–6R–çfÆ–FFW2öÆÆ–ærWö6‚"Æv—B"æWfÇVFR‚rõööövæG6"çGbç7FG2æ–çfö–6RbeõööövæG6"çGbç7FG2ç–ÖVçDWö6ƒåõö6÷'&V7F–öâæWö6‚bfFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ–çfö–6R"’æ†–FFVâr’“°¢v—B"æWfÇVFR‚v6ÆV%F–ÖV÷WB…õ÷–ÖVçD6Æö6²æ–B“µõ÷–ÖVçD6Æö6²çF–6²‚“·v–æF÷rç6WEF–ÖV÷WCÕõ÷–ÖVçD6Æö6²ææF—fRr“¶v—B"ç6ÆVWƒC“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢6æ6VÆÆVBWö6‚6ææ÷B&Wf—fR—G2–çfö–6R"Æv—B"æWfÇVFR‚rõööövæG6"çGbç7FG2æ–çfö–6RbfFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×GbÖ–çfö–6R"’æ†–FFVâr’“°¢v—B"æ¶W’‚$W66R"“¶v—B7FW‚“°¢&V6÷&B‚$E4"Eb6÷'&V7F–öã¢W66R6Æ÷6W2Ebv—F†÷WB7F÷–ærF†RÆ—fR7G&VÒ"Æv—B"æWfÇVFR‚rõööövæG6"çGbæ—4÷Vâbeõö6÷'&V7F–öâæVF–òç7FG2æÖöFSÓÓÒ&Æ—fR"beõö6÷'&V7F–öâæVF–òç7FG2ç7F'G3ÓÓÓr’“°¢6öç7BVF–óÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BCÕõööövæG6"ÄÔBææöFW'VææW"æVF–òÄSÕõöG6%&F–ôf—‡GW&RæVÆVÖVçC´çWFFRƒÃBÇG'VR“¶6öç7BÆ—fSÔç7FG3´BçvVF†W"ç6WD–çFW&–÷"‡G'VR“¶6öç7BvFVCÔRæ×WFVBbbç7FG2æVæ&ÆVC´BçvVF†W"ç6WD–çFW&–÷"†fÇ6R“´çWFFRƒÃƒÇG'VR“¶6öç7Bf#ÔRæ×WFVC´RæöæW'&÷"‚“´çWFFRƒÃBÇG'VR“¶6öç7BöffÆ–æSÔç7FG3´çÆ’‚“´çWFFRƒÃBÇG'VR“·&WGW&â¶Æ—fRÆvFVBÆf"ÆöffÆ–æRÆ6öææV7F–æs¤ç7FG7Ó·Ò’‚–“°¢v—B"ç6ÆVWƒS“¶v—B7FW‚“°¢&V6÷&B‚$E4"&F–ò6÷'&V7F–öã¢Æ—fRöfÆÆ&6²&RW†6ÇW6—fRæBF†R6†&VBvFR6–ÆVæ6W2…DÔÂVF–ò–ÖÖVF–FVÇ’"ÆVF–òæÆ—fRæÆ—fTVF–&ÆRbfVF–òævFVBbfVF–òæf"bfVF–òæöffÆ–æRæfÆÆ&6´ÆWfVÃãbbVF–òæöffÆ–æRæÆ—fTVF–&ÆRbfVF–òæ6öææV7F–æræfÆÆ&6´ÆWfVÃÓÓÓÄ¥4ôâç7G&–æv–g’†VF–ò’“°¢&V6÷&B‚$E4"&F–ò6÷'&V7F–öã¢&V6÷fW'’&WGW&ç2FòöæRÆ—fR7G&VÒ"Æv—B"æWfÇVFR‚uõö6÷'&V7F–öâæVF–òç7FG2æÖöFSÓÓÒ&Æ—fR"beõö6÷'&V7F–öâæVF–òç7FG2æfÆÆ&6´ÆWfVÃÓÓÓr’“°¢v—B"æWfÇVFR‚uõööövævò‚&&–g&÷7B"ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“°¢&V6÷&B‚$E4"&F–ò6÷'&V7F–öã¢66VæRF—7÷6Â7F÷27G&VÒÂfÆÆ&6²æBEbF–ÖW'2"Æv—B"æWfÇVFR‚uõö6÷'&V7F–öâæVF–òç7FG2æF—7÷6VBbeõö6÷'&V7F–öâæVF–òç7FG2ç6÷W&6W3ÓÓÓbeõö6÷'&V7F–öâæVF–òç7FG2çF–ÖW'3ÓÓÓbeõö6÷'&V7F–öâæVF–òç7FG2æfÆÆ&6µ6÷W&6W3ÓÓÓbeõö6÷'&V7F–öâçGbç7FG2æF—7÷6VBbeõö6÷'&V7F–öâçGbç7FG2çF–ÖW'3ÓÓÓbeõö6÷'&V7F–öâçGbç7FG2ç&WVW7G3ÓÓÓr’“°¢v—B"æWfÇVFR‚uõööövævò‚&G6""ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“¶v—B7FW‚“°¢&V6÷&B‚$E4"&F–ò6÷'&V7F–öã¢&RÖVçG'’7&VFW2öæRg&W6‚7FF–öâ"Æv—B"æWfÇVFR‚uõööövæG6"ææöFW'VææW"æVF–òç7FG2ç7F'G3ÓÓÓbeõööövæG6"ææöFW'VææW"æVF–òç7FG2ç6÷W&6W3ÓÓÓr’“°¢&V6÷&B‚$E4"&F–ò6÷'&V7F–öã¢6öç6öÆR&VÖ–ç26ÆVâ"Æ"æÆöw2æÆVæwFƒÓÓÓÆ"æÆöw2æ¦ö–â‚"Â"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢'&F–òEb6÷'&V7F–öâ"ÇVW'“¢"gf–WsÖæöFW'VææW"gvVF†W#Ö6ÆV"gF–ÖSÓ#"Ç7FW3¥¶G6%&F–õGd6÷'&V7F–öå×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢'&F–òEb6÷'&V7F–öâ†öæR"ÇVW'“¢"gf–WsÖæöFW'VææW"gvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6%&F–õGd6÷'&V7F–öå×Ò“° ¦6öç7BG6$†&&÷$6†V6·ö–çBÒ²æÖS¢&G6"†&&÷"6†V6·ö–çB"Âv‡“¢''VÆS¢æ÷&ÖÂvÆ¶–ær&V6†W2F†R†&&÷"ÂæBöæRF—7Fæ6RÖ&6VBW‡FW&–÷"7FF–öâ7W'f—fW2vVF†W"Â&öö×2æB66VæR6†ævW2"Â'Vã¦7–æ2#Óç°¢6öç7B7FWÒ‚“Óæ"æWfÇVFR‚vf÷"†ÆWB“Ó¶“Ãc¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc’r“°¢v—B"æWfÇVFR‚wv–æF÷råõö†&&÷%7F'C×²ââåõööövæG6"æfF"ç&ö÷Bç÷6—F–öçÒr“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“¶v—B7FW‚“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢6öç7BÖ÷F–öãÖv—B"æWfÇVFR‚r‡¶F—7Fæ6S¤ÖF‚æ‡—÷B…õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç‚Õõö†&&÷%7F'Bç‚ÅõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢Õõö†&&÷%7F'Bç¢’Æ6öçG&öÆÆVC¥õööövç–Æ÷BçÆ–W#ÓÓÕõööövæG6"æfF'Ò’r“°¢&V6÷&B‚$E4"†&&÷#¢æ÷&ÖÂæöâÖ÷fW'f–WrvÖWÆ’vÆ·2F†R6VÆV7FVBÆ–W""ÆÖ÷F–öâæ6öçG&öÆÆVBbfÖ÷F–öâæF—7Fæ6SâãRÄ¥4ôâç7G&–æv–g’†Ö÷F–öâ’“°¢v—B"æ¶W’‚&Ò"“¶v—B"æ¶W’‚&Ò"“°¢6öç7BÖ—ƒÖv—B"æWfÇVFR†‚‚“Óç°¢6öç7B#ÕõööövÄCÔ"æG6"ÄãÔBææöFW'VææW"ÅsÔBçvVF†W#¶6öç7B&÷w3ÕµÓ°¢6öç7BÖ÷fS×Óç´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ§ç‚Ç“¤BæÆæBæ†V–v‡DB‡ç‚Çç¢’Ç£§ç§ÒÇ–s¤âæ'V–ÆF–ærç–rÇ—F6ƒ¢ã#"ÆF—7C£wÒ“¶f÷"†ÆWB“Ó¶“Ã#C¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc“·&÷w2çW6‚‡²ââäâç7FG7Ò“·Ó°¢Ö÷fR‡·ƒ¢ÓÇ££CWÒ“¶Ö÷fR‡·ƒ¢Ó3‚Ç££3GÒ“¶Ö÷fR„âç&Wf–Wr“¶Ö÷fR‡·ƒ¢Ó3‚Ç££3GÒ“¶Ö÷fR‡·ƒ¢ÓÇ££CWÒ“°¢Ö÷fR„âç&Wf–Wr“¶6öç7B6ÆV#Ôâç7FG2çF&vWCµrç6WDÖöFR‚'7F÷&Ò"“¶f÷"†ÆWB“Ó¶“ÃCƒ¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc“°¢v–æF÷råõö†&&÷%FW7C×¶VF–ó¤âæVF–òÇ6÷W&6S¤âç6÷W&6WÓ°¢&WGW&â·&÷w2Æ6ÆV"Ç7F÷&Ó¤âç7FG2çF&vWBÇ&–ã¥rç6†&VBç7FFRç&–äÆWfVÂÇ7F'G3¤âæVF–òç7FG2ç7F'G2Ç6÷W&6W3¤âæVF–òç7FG2ç6÷W&6W7Ó°¢Ò’‚–“°¢&V6÷&B‚$E4"†&&÷#¢&÷†–Ö—G’fFW2–âö÷WBÂ—26–ÆVçBf"v’æBæWfW"&ö÷7G2—G6VÆb÷fW"7F÷&×2"ÆÖ—‚ç&÷w5³ÒæÆWfVÃÂãbfÖ—‚ç&÷w5³ÒæÆWfVÃãbfÖ—‚ç&÷w5³%ÒæÆWfVÃæÖ—‚ç&÷w5³ÒæÆWfVÂbfÖ—‚ç&÷w5³5ÒæÆWfVÃÆÖ—‚ç&÷w5³%ÒæÆWfVÂbfÖ—‚ç&÷w5³EÒæÆWfVÃÂãbfÖ—‚æ6ÆV#ÓÓÖÖ—‚ç7F÷&ÒbfÖ—‚ç&–ããbfÖ—‚ç7F'G3ÓÓÓbfÖ—‚ç6÷W&6W3ÓÓÓÄ¥4ôâç7G&–æv–g’†Ö—‚’“°¢6öç7B&öCÖv—B"æWfÇVFR†‚‚“Óç°¢6öç7BCÕõööövæG6"ÄãÔBææöFW'VææW"ÄÃÔBæÆæC¶ÆWBö'7G'V7FVCÓ°¢f÷"†ÆWB“Ó¶“ÄÂçvFW&g&öçBæÆVæwFƒ¶’²²—°¢6öç7BÔÂçvFW&g&öçE¶’ÓÒÆ#ÔÂçvFW&g&öçE¶•ÒÆãÔÖF‚æ6V–Â„ÖF‚æ‡—÷B†%³ÒÖ³ÒÆ%³ÒÖ³Ò’“°¢f÷"†ÆWB£Ó¶£ÃÖã¶¢²²—¶6öç7BƒÖ³Ò²†%³ÒÖ³Ò’¦¢öâÇ£Ö³Ò²†%³ÒÖ³Ò’¦¢öâÇ“ÔÂæ†V–v‡DB‡‚Ç¢“¶–b‚âæ6ÆV%6VvÖVçB‡‚Ç¢Ç‚Ç¢Ç’ÄBæfF"æ&öG”†V–v‡BÄBæfF"’–ö'7G'V7FVB²³·Ð¢Ð¢òòfÆööBF†RW†—7F–ær7W÷'FVBvÆ¶–ær7W&f6RâæòÇFW&æFR6öÆÆ—6–öâ÷"FW'&–âf÷&×VÆà¢6öç7B6—¦SÓÇ7FWÓãRÆÖ–ãÒÓ“Ç6VVãÖæWrV–çC„'&’‡6—¦R§6—¦R’ÇVWVSÕµÓ°¢6öç7B–æFWƒ×ÓäÖF‚ç&÷VæB‚‡ç¢ÖÖ–â’÷7FW’§6—¦R´ÖF‚ç&÷VæB‚‡ç‚ÖÖ–â’÷7FW“°¢6öç7B7F'CÖ–æFW‚…õö†&&÷%7F'B“·6VVå·7F'EÓÓ·VWVRçW6‚‡7F'B“°¢f÷"†ÆWB†VCÓ¶†VCÇVWVRæÆVæwFƒ¶†VB²²—°¢6öç7B×VWVU¶†VEÒÆ—ƒ×W6—¦RÆ—£Ò‡÷6—¦R—ÃÇƒÖÖ–â¶—‚§7FWÇ£ÖÖ–â¶—¢§7FWÇ“ÔÂæ†V–v‡DB‡‚Ç¢“°¢f÷"†6öç7B¶G‚ÆG¥Òöbµ³ÃÒÅ²ÓÃÒÅ³ÃÒÅ³ÂÓÕÒ—°¢6öç7BçƒÖ—‚¶G‚Æç£Ö—¢¶G¢Æ³Öç¢§6—¦R¶çƒ¶–b†çƒÃÇÆç£ÃÇÆçƒã×6—¦WÇÆç£ã×6—¦WÇÇ6VVå¶µÒ–6öçF–çVS°¢6öç7BGƒÖÖ–â¶ç‚§7FWÇG£ÖÖ–â¶ç¢§7FW°¢–b„ÂçvÆ¶&ÆR‡‚Ç¢ÇG‚ÇG¢Ç’ÄBæfF"æ&öG”†V–v‡BÄBæfF"’bdâæ6ÆV%6VvÖVçB‡‚Ç¢ÇG‚ÇG¢Ç’ÄBæfF"æ&öG”†V–v‡BÄBæfF"’—·6VVå¶µÓÓ·VWVRçW6‚†²“·Ð¢Ð¢Ð¢6öç7B&V6†&ÆS×Óç¶6öç7B³Ö–æFW‚‡’ÇƒÖÖ–â²†²W6—¦R’§7FWÇ£ÖÖ–â²‚†²÷6—¦R—Ã’§7FW·&WGW&â6VVå¶µÒbdÂçvÆ¶&ÆR‡‚Ç¢Çç‚Çç¢ÄÂæ†V–v‡DB‡‚Ç¢’ÄBæfF"æ&öG”†V–v‡BÄBæfF"’bdâæ6ÆV%6VvÖVçB‡‚Ç¢Çç‚Çç¢ÄÂæ†V–v‡DB‡‚Ç¢’ÄBæfF"æ&öG”†V–v‡BÄBæfF"“·Ó°¢&WGW&â¶ö'7G'V7FVBÇf—6—FVC§VWVRæÆVæwF‚Æ†&&÷#§&V6†&ÆR„âç&Wf–Wr’Æ6†÷&§&V6†&ÆR‡·ƒ£#"Ç££CÒ’ÆÖVÖS§&V6†&ÆR„Bæ–çFW&–÷'2ç&Vv—7G'’ævWB‚&ÖVÖRÖf7F÷'’"’æVçG'’—Ó°¢Ò’‚–“°¢&V6÷&B‚$E4"†&&÷#¢&öÖVæFR7F—26ÆV"æBF†Ræ÷&ÖÂw&÷VæBw&‚&V6†W2†&&÷"Â6†÷&æBÖVÖRf7F÷'’"Â&öBæö'7G'V7FVBbg&öBæ†&&÷"bg&öBæ6†÷&bg&öBæÖVÖRÄ¥4ôâç7G&–æv–g’‡&öB’“°¢v—B"æWfÇVFR‚r‚‚“Óç¶6öç7B#ÕõööövÆCÔ"æG6"æ–çFW&–÷'2ç&Vv—7G'’ævWB‚&ÖVÖRÖf7F÷'’"“´"ç–Æ÷Bææf–vFR‡·÷6—F–öã¦BæVçG'’Ç–s¦Bæ'V–ÆF–ærç–rÇ—F6ƒ¢ã#"ÆF—7C£wÒ“·Ò’‚’r“°¢v—B"æ¶W’‚""“¶v—B7FW‚“°¢6öç7B–ç6–FSÖv—B"æWfÇVFR‚r‡·&ööÓ¢õööövæG6"æ–çFW&–÷'2æ7F—fRÆvFS¥õööövæG6"çvVF†W"ç6†&VBç7FFRæÖ7FW$ÆWfVÂÇ&F–ó¥õööövæG6"ææöFW'VææW"ç7FG2Æ–æFö÷#¥õööövæG6"æ–çFW&–÷'2æVF–òç7FG2æ6öææV7FVGÒ’r“°¢v—B"æ¶W’‚""“¶v—B7FW‚“°¢6öç7B÷WG6–FSÖv—B"æWfÇVFR‚r‡·&ööÓ¢õööövæG6"æ–çFW&–÷'2æ7F—fRÆvFS¥õööövæG6"çvVF†W"ç6†&VBç7FFRæÖ7FW$ÆWfVÂÇ&F–ó¥õööövæG6"ææöFW'VææW"ç7FG2Ç6ÖS¥õööövæG6"ææöFW'VææW"æVF–óÓÓÕõö†&&÷%FW7BæVF–÷Ò’r“°¢&V6÷&B‚$E4"†&&÷#¢F†R&VÂ–çFW&–÷"F—66öææV7G2ÆÂW‡FW&–÷"6÷VæBæBW†—BW6W27W'&VçBÆ—7FVæW"F—7Fæ6R"Æ–ç6–FRç&ööÒbf–ç6–FRævFSÓÓÓbf–ç6–FRç&F–òæÆWfVÃÓÓÓbf–ç6–FRæ–æFö÷"bb÷WG6–FRç&ööÒbf÷WG6–FRævFSãbf÷WG6–FRç&F–òçF&vWCÓÓÓbf÷WG6–FRç6ÖRÄ¥4ôâç7G&–æv–g’‡¶–ç6–FRÆ÷WG6–FWÒ’“°¢f÷"†ÆWBf—6—CÓ·f—6—CÃ3·f—6—B²²—°¢v—B"æWfÇVFR‚uõö†&&÷%FW7BæöÆCÕõööövæG6"ææöFW'VææW#µõööövævò‚&&–g&÷7B"ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“°¢6öç7B&VÆV6VCÖv—B"æWfÇVFR‚r‡¶F—7÷6VC¥õö†&&÷%FW7BæöÆBæVF–òç7FG2æF—7÷6VBÇ6÷W&6W3¥õö†&&÷%FW7BæöÆBæVF–òç7FG2ç6÷W&6W2ÆGF6†VC¢õö†&&÷%FW7BæöÆBæw&÷Wç&VçBÇ6öÆ–G3¥õö†&&÷%FW7BæöÆBç6öÆ–G2ç7FG2ææöFW7Ò’r“°¢v—B"æWfÇVFR‚uõööövævò‚&G6""ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“°¢v—B7FW‚“°¢6öç7Bg&W6ƒÖv—B"æWfÇVFR‚r‡·6÷W&6W3¥õööövæG6"ææöFW'VææW"æVF–óòç7FG2ç6÷W&6W2Ç7F'G3¥õööövæG6"ææöFW'VææW"æVF–óòç7FG2ç7F'G7Ò’r“°¢&V6÷&B‚$E4"†&&÷#¢66VæR&÷VæBG&—"²‡f—6—B³’²"7F÷2F†RöÆB7FF–öâæB7&VFW2öæÇ’öæRæWr6÷W&6R"Ç&VÆV6VBæF—7÷6VBbg&VÆV6VBç6÷W&6W3ÓÓÓbb&VÆV6VBæGF6†VBbg&VÆV6VBç6öÆ–G3ÓÓÓbfg&W6‚ç6÷W&6W3ÓÓÓbfg&W6‚ç7F'G3ÓÓÓÄ¥4ôâç7G&–æv–g’‡·&VÆV6VBÆg&W6‡Ò’“°¢Ð¢v—B"æWfÇVFR‚vFVÆWFRv–æF÷råõö†&&÷%FW7C¶FVÆWFRv–æF÷råõö†&&÷%7F'Br“°¢&V6÷&B‚$E4"†&&÷#¢'VçF–ÖR6öç6öÆR&VÖ–ç26ÆVâ"Æ"æÆöw2æÆVæwFƒÓÓÓÆ"æÆöw2æ¦ö–â‚"Â"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢&†&&÷"6†V6·ö–çB"ÇVW'“¢"gvVF†W#Ö6ÆV"gF–ÖSÓ#"Ç7FW3¥¶G6$†&&÷$6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢&†&&÷"6†V6·ö–çB†öæR"ÇVW'“¢"gvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6$†&&÷$6†V6·ö–çE×Ò“° ¦6öç7BG6$–çFW&–÷$6†V6·ö–çBÒ²æÖS¢&G6"–çFW&–÷"6†V6·ö–çB"Âv‡“¢''VÆS¢&VÂFö÷"—6öÆFW2—G2&ööÒæB&WGW&ç2F†R6ÖRÆ–W"Fò7W'&VçBW‡FW&–÷"vVF†W"v—F†÷WB67V×VÆF–ær&W6÷W&6W2"Â'Vã¢7–æ2"Óâ°¢6öç7B7FWÒ‚“Óæ"æWfÇVFR‚vf÷"†ÆWB“Ó¶“Ã3c¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc’r“°¢6öç7BFÖ7–æ2‚“Óç°¢6öç7BÖv—B"æWfÇVFR‚r‚‚“Óç¶6öç7BSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"Ö6öçFW‡B"’Ç#ÖRævWD&÷VæF–æt6Æ–VçE&V7B‚“·&WGW&â·ƒ§"ç‚·"çv–GF‚ó"Ç“§"ç’·"æ†V–v‡Bó"Çf—6–&ÆS¢Ræ†–FFVçÓ·Ò’‚’r“°¢–b‚çf—6–&ÆR—F‡&÷ræWrW'&÷"‚$W‡V7FVB&V6†&ÆR–çFW&–÷"Fö÷""“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Ç·G—S¢'F÷V6…7F'B"ÇF÷V6…ö–çG3¥··ƒ§ç‚Ç“§ç—Õ×Ò“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Ç·G—S¢'F÷V6„VæB"ÇF÷V6…ö–çG3¥µ×Ò“¶v—B7FW‚“°¢Ó°¢v—B"æ¶W’‚""“¶v—B7FW‚“°¢6öç7BVçG'“Öv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"Ä“ÔBæ–çFW&–÷'2Å3ÔBçvVF†W"ç6†&VBç7FFS·v–æF÷råõö–çFW&–÷$6†V6³×¶fF#¤BæfF"ÆÆæC¤BæÆæBÆæGW&S¤BææGW&RÇvFW#¤BçvFW"Æ–æFö÷#¤’æÆ–v‡F–ærÇ&VC¤"æF–Æ–v‡Bç&VGÓ°¢&WGW&â¶7F—fS¢’æ7F—fRÆW‡FW&–÷#¤BæW‡FW&–÷"çf—6–&ÆRÆG&÷3¥2æG&÷2ÆÖ7FW#¥2æÖ7FW$ÆWfVÂÆfVWC¤BæfF"ç&ö÷Bç÷6—F–öâç’ÔBæfF"æ&6U’Æ6ÖW&§²ââä"æ6ÖW&ç÷6—F–öçÒÆVF–ó¤’æVF–òç7FG2ÆÆ&VÃ¦Fö7VÖVçBçVW'•6VÆV7F÷"‚"6G6"Ö6öçFW‡B"’çFW‡D6öçFVçGÓ·Ò’‚–“°¢&V6÷&B‚$E4"–çFW&–÷#¢76RBF†RW‡FW&–÷"Fö÷"VçFW'2ÂvFW2vVF†W"æB7F'G2öæRv÷&·6†÷w&‚"ÆVçG'’æ7F—fRbbVçG'’æW‡FW&–÷"bfVçG'’æG&÷3ÓÓÓbfVçG'’æÖ7FW#ÓÓÓbdÖF‚æ'2†VçG'’æfVWBÓ“ÂãbdÖF‚æ'2†VçG'’æ6ÖW&ç‚“Ã"bfVçG'’æVF–òæ6öææV7FVBbfVçG'’æVF–òç6÷W&6W3ÓÓÓ2Ä¥4ôâç7G&–æv–g’†VçG'’’“°¢òò7GVÂ†VÆBÖ÷fVÖVçBÂF†Vâ7W÷'FVBFö÷'v’&WGW&âF‡&÷Vv‚F†R6ÖR6öçG&öÆÆW"à¢6öç7B&Vf÷&SÖv—B"æWfÇVFR‚r‡²ââåõööövæG6"æfF"ç&ö÷Bç÷6—F–öçÒ’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢&B"Æ6öFS¢$¶W”B'Ò“¶v—B7FW‚“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢&B"Æ6öFS¢$¶W”B'Ò“°¢6öç7BÖ÷fVCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BCÕõööövæG6"Ä“ÔBæ–çFW&–÷'2ÇÔBæfF"ç&ö÷Bç÷6—F–öã·&WGW&â·§²ââçÒÆfÆö÷#¤’æw&÷VæDB‡ç‚Çç¢’ÇvÆÃ¤’çvÆ¶&ÆRƒÃ‚ÃÃ#2ÃÃ"ÄBæfF"’Æ6÷VçFW#¤’çvÆ¶&ÆRƒÂÓÃÂÓrÃÃ"ÄBæfF"’ÇF&ÆS¤’çvÆ¶&ÆRƒÃrÃÃ2ÃÃ"ÄBæfF"—Ó·Ò’‚–“°¢&V6÷&B‚$E4"–çFW&–÷#¢†VÆBÖ÷fVÖVçBv÷&·2öâF†RfÆö÷"æB7vWB6öÆÆ—6–öâ&Æö6·2vÆÇ2ÂF&ÆW2æB6÷VçFW""ÄÖF‚æ‡—÷B†Ö÷fVBçç‚Ö&Vf÷&Rç‚ÆÖ÷fVBçç¢Ö&Vf÷&Rç¢“âã"bfÖ÷fVBæfÆö÷#ÓÓÓbbÖ÷fVBçvÆÂbbÖ÷fVBæ6÷VçFW"bbÖ÷fVBçF&ÆRÄ¥4ôâç7G&–æv–g’†Ö÷fVB’“°¢v—B"æWfÇVFR‚r‚‚“Óç¶6öç7B#ÕõööövÄ“Ô"æG6"æ–çFW&–÷'3´"ç–Æ÷Bææf–vFR‡·÷6—F–öã¤’æ7F—fRç&ööÒç7vâÇ–s£Ç—F6ƒ¢ã#"ÆF—7C£7Ò“´"æG6"çvVF†W"ç6WDÖöFR‚'&–â"“´"æF–Æ–v‡Bç&VCÒ‚“Óã¶f÷"†ÆWB“Ó¶“ÃCƒ¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc“·Ò’‚’r“°¢6öç7B—6öÆF–öãÖv—B"æWfÇVFR‚r‡·6ÖS¤$Âç66VæW2æG6"ç&VæFW$÷G3ÓÓÕõö–çFW&–÷$6†V6²æ–æFö÷"ÆW‡FW&–÷#¥õööövæG6"çvVF†W"ç7FFRæW‡FW&–÷"ÆG&÷3¥õööövæG6"çvVF†W"ç6†&VBç7FFRæG&÷2Ææ–v‡C¥õööövç&VæFW$÷G2æF—Ò’r“°¢v—BF‚“°¢6öç7BW†—CÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"Ä“ÔBæ–çFW&–÷'2ÇÔBæfF"ç&ö÷Bç÷6—F–öâÆSÔ’ç&Vv—7G'’ævWB‚&ÖVÖRÖf7F÷'’"’æVçG'“·&WGW&â¶7F—fS¢’æ7F—fRÇ6ÖS¤BæfF#ÓÓÕõö–çFW&–÷$6†V6²æfF"bdBæÆæCÓÓÕõö–çFW&–÷$6†V6²æÆæBbdBçvFW#ÓÓÕõö–çFW&–÷$6†V6²çvFW"bdBææGW&SÓÓÕõö–çFW&–÷$6†V6²ææGW&RÆF—7Fæ6S¤ÖF‚æ‡—÷B‡ç‚ÖRç‚Çç¢ÖRç¢’ÆfÆö÷#§ç’ÔBæfF"æ&6U’ÔBæÆæBæ†V–v‡DB‡ç‚Çç¢’Æ6ÖW&6ÆV#¤BæÆæBæ6ÆV$B„"æ6ÖW&ç÷6—F–öâç‚Ä"æ6ÖW&ç÷6—F–öâç¢Âã’ÇvVF†W#¤BçvVF†W"ç7FFRæÖöFRÆæ–v‡C¤"ç&VæFW$÷G2æF’ÆÆ×3¤"ç&VæFW$÷G2æÆ×f7F÷"ÆG&÷3¤BçvVF†W"ç6†&VBç7FFRæG&÷2ÆÖ7FW#¤BçvVF†W"ç6†&VBç7FFRæÖ7FW$ÆWfVÂÆVF–ó¤’æVF–òç7FG7Ó·Ò’‚–“°¢&V6÷&B‚$E4"–çFW&–÷#¢F÷V6‚W†—B&W7F÷&W2F†R6ÖRÆ–W"ö'V–ÆF–æræB7W'&VçBæ–v‡B&–âÂæ÷BVçG'’vVF†W""Æ—6öÆF–öâç6ÖRbb—6öÆF–öâæW‡FW&–÷"bf—6öÆF–öâæG&÷3ÓÓÓbf—6öÆF–öâææ–v‡CÓÓÓbbW†—Bæ7F—fRbfW†—Bç6ÖRbfW†—BæF—7Fæ6SÂãbfW†—Bæ6ÖW&6ÆV"bdÖF‚æ'2†W†—BæfÆö÷"“ÂãbfW†—BçvVF†W#ÓÓÒ'&–â"bfW†—Bææ–v‡CÓÓÓbfW†—BæÆ×3âã’bfW†—BæG&÷3ãbfW†—BæÖ7FW#ãbbW†—BæVF–òæ6öææV7FVBÄ¥4ôâç7G&–æv–g’‡¶—6öÆF–öâÆW†—GÒ’“°¢v—B"æWfÇVFR‚uõööövæF–Æ–v‡Bç&VCÕõö–çFW&–÷$6†V6²ç&VBr“°¢6öç7B6æ6†÷CÒ‚“Óæ"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄ“Ô"æG6"æ–çFW&–÷'3¶ÆWBæöFW3Ó¶6öç7BvVöÖWG&–W3ÖæWr6WB‚“¶6öç7Bf—6—CÖãÓç¶æöFW2²³¶–b†âævVöÖWG'’–vVöÖWG&–W2æFB†âævVöÖWG'’“¶f÷"†6öç7B2öbâæ6†–ÆG&Vâ—f—6—B†2“·Ó·f—6—B„$Âç66VæW2æG6"ç&ö÷B“·&WGW&â¶æöFW2ÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦RÇ&öö×3¤’ç&öö×2ç6—¦RÇF&vWG3¤$Âç66VæW2æG6"æ–çWBçF&vWD6÷VçBÆVF–ó¤’æVF–òç7FG2ç6÷W&6W2Æ6öçFW‡G3¤’æVF–òç7FG2æ6öçFW‡G2Ç&F–õ6÷W&6W3¤"æG6"ææöFW'VææW"æVF–óòç7FG2ç6÷W&6W2Ç&F–õ7F'G3¤"æG6"ææöFW'VææW"æVF–óòç7FG2ç7F'G2Ç&V6÷&G3¤"ç&VæFW&W"ç7FG2ç&V6÷&G7Ó·Ò’‚–“°¢6öç7BÆ—7FVæW$6÷VçCÖ7–æ2‚“Óç°¢6öç7Bö&£Öv—B"ç6VæB‚%'VçF–ÖRæWfÇVFR"Ç¶W‡&W76–öã¢&Fö7VÖVçB'Ò“°¢6öç7B&W7VÇCÖv—B"ç6VæB‚$DôÔFV'VvvW"ævWDWfVçDÆ—7FVæW'2"Ç¶ö&¦V7D–C¦ö&¢ç&W7VÇBç&W7VÇBæö&¦V7D–GÒ“°¢v—B"ç6VæB‚%'VçF–ÖRç&VÆV6Tö&¦V7B"Ç¶ö&¦V7D–C¦ö&¢ç&W7VÇBç&W7VÇBæö&¦V7D–GÒ“·&WGW&â&W7VÇBç&W7VÇBæÆ—7FVæW'2æÆVæwFƒ°¢Ó°¢6öç7B&6SÖv—B6æ6†÷B‚’ÆÆ—7FVæW'3Öv—BÆ—7FVæW$6÷VçB‚“°¢ÆWB7–6ÆW3Ó°¢f÷"ƒ¶7–6ÆW3Ã¶7–6ÆW2²²—¶v—BF‚“¶v—BF‚“·Ð¢6öç7BVæCÖv—B6æ6†÷B‚’ÆÆ—7FVæW'4VæCÖv—BÆ—7FVæW$6÷VçB‚“°¢&V6÷&B‚$E4"–çFW&–÷#¢FVâ6ö×ÆWFRFö÷"7–6ÆW2&WF–â&÷VæFVBæöFW2ÂvVöÖWG'’Â†æFÆW'2æBVF–ò6÷W&6W2"Äö&¦V7Bæ¶W—2†&6R’æWfW'’†¶W“Óæ¶W“ÓÓÒ'&V6÷&G2#öVæE¶¶W•ÓÃÖ&6U¶¶W•Ó¦VæE¶¶W•ÓÓÓÖ&6U¶¶W•Ò’bfÆ—7FVæW'3ÓÓÖÆ—7FVæW'4VæBÄ¥4ôâç7G&–æv–g’‡¶7–6ÆW2Æ&6RÆVæBÆÆ—7FVæW'2ÆÆ—7FVæW'4VæGÒ’“°¢v—B"æWfÇVFR‚wv–æF÷råõö–çFW&–÷$6†V6²æöÆCÕõööövæG6"æ–çFW&–÷'3µõööövævò‚&G6""ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“°¢6öç7B6ÆVãÖv—B"æWfÇVFR‚r‡·&öö×3¥õö–çFW&–÷$6†V6²æöÆBç&öö×2ç6—¦RÆVF–ó¥õö–çFW&–÷$6†V6²æöÆBæVF–òç7FG2æ6öçFW‡G2Æg&W6ƒ¥õööövæG6"æ–çFW&–÷'2ç&öö×2ç6—¦RÇf—6–&ÆS¥õööövæG6"æW‡FW&–÷"çf—6–&ÆWÒ’r“°¢&V6÷&B‚$E4"–çFW&–÷#¢66VæRFW'GW&R&VÆV6W2F†R&ööÒæB—G2VF–ô6öçFW‡B"Æ6ÆVâç&öö×3ÓÓÓbf6ÆVâæVF–óÓÓÓbf6ÆVâæg&W6ƒÓÓÓbf6ÆVâçf—6–&ÆRÄ¥4ôâç7G&–æv–g’†6ÆVâ’“°¢v—B"æWfÇVFR‚vFVÆWFRv–æF÷råõö–çFW&–÷$6†V6²r“°¢&V6÷&B‚$E4"–çFW&–÷#¢'VçF–ÖR6öç6öÆR&VÖ–ç26ÆVâ"Æ"æÆöw2æÆVæwFƒÓÓÓÆ"æÆöw2æ¦ö–â‚"Â"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢&–çFW&–÷"6†V6·ö–çB"ÇVW'“¢"gf–WsÖÖVÖRÖf7F÷'’gvVF†W#×7F÷&ÒgF–ÖSÓ#"Ç7FW3¥¶G6$–çFW&–÷$6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢&–çFW&–÷"6†V6·ö–çB†öæR"ÇVW'“¢"gf–WsÖÖVÖRÖf7F÷'’gvVF†W#×7F÷&ÒgF–ÖSÓ#"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6$–çFW&–÷$6†V6·ö–çE×Ò“° ¢òò'VÆS¢ÖV7W&RF†R7GVÂ&VæFW&VB6†VÆÂæB&VÂ‡—6–6Â×&÷WFR6öçG&öÆÆW"–âÆÂ7W÷'FVB÷&–VçFF–öç2à¦6öç7BG6%fVçVTÖVçW46†V6·ö–çC×¶æÖS¢&G6"fVçVRÖVçW26†V6·ö–çB"Çv‡“¢''VÆS¢7F–ÂÖVçW26VçFW"v—F†–âF†Rf–Ww÷'BÂ—6öÆFRvÖWÆ’æB&VÆV6R&W6÷W&6W2v—F†÷WB7FÆR&÷WFW2"Ç'Vã¦7–æ2#Óç°¢6öç7B7FWÒ‚“Óæ"æWfÇVFR‚vf÷"†ÆWB“Ó¶“Ã3¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc’r“°¢v—B7FW‚“°¢6öç7B6æ6†÷CÖ7–æ2‚“Óç°¢6öç7Bö&£Öv—B"ç6VæB‚%'VçF–ÖRæWfÇVFR"Ç¶W‡&W76–öã¢&Fö7VÖVçB'Ò“°¢6öç7B&W7VÇCÖv—B"ç6VæB‚$DôÔFV'VvvW"ævWDWfVçDÆ—7FVæW'2"Ç¶ö&¦V7D–C¦ö&¢ç&W7VÇBç&W7VÇBæö&¦V7D–GÒ“°¢v—B"ç6VæB‚%'VçF–ÖRç&VÆV6Tö&¦V7B"Ç¶ö&¦V7D–C¦ö&¢ç&W7VÇBç&W7VÇBæö&¦V7D–GÒ“°¢&WGW&â¶Æ—7FVæW'3§&W7VÇBç&W7VÇBæÆ—7FVæW'2æÆVæwF‚ÆFöÓ¦v—B"æWfÇVFR‚vFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"æG6"ÖÖVçR×6†FR"’æÆVæwF‚r—Ó°¢Ó°¢6öç7B&6VÆ–æSÖv—B6æ6†÷B‚“°¢6öç7BfVçVW3Õ°¢²&ÖVÖRÖf7F÷'’"Â&ÖVÖTÖVçR"Â"æÖVÖRÖÖVçR"Å²Ó‚ÂÓ’ãuÒÂ&Æ6W""Â'&÷WFR%ÒÀ¢²'v—F†÷WB×'VÆW'2"Â'6†÷ÖVçR"Â"7'VÆW'2Ö6FÆör"Å³Rã2ÃãUÒÂ&†ööF–W2"Â'6V7F–öâ%ÒÀ¢²'&ööbÖöbÖ–æ²"Â&–æ´ÖVçR"Â"6–æ²Ö6FÆör"Å²ÓãbÃÒÂ&f–æRÖ'G2"Â'Fr%ÒÀ¢²&&–rÖ&—F6ö–â"Â&&–tÖVçR"Â"6&–r×FW&Ö–æÂ"Å³Bã"ÃÒÂ'&W6V&6‚"Â'6V7F–öâ%ÒÀ¢²&Ö†—2Ö6ÇV""Â&Ö†—4ÖVF–"Â"æÖ†—2ÖÖVF–"Å³rãBÂÓãEÒÂ&†öÖR"Â&6FVv÷'’%Ð¢Ó°¢6öç7BF‡3Ö¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â&G6"ÖÖVçR×&Wf–Wr"“¶Ö¶F—%7–æ2‡F‡2Ç·&V7W'6—fS§G'VWÒ“°¢f÷"†6öç7B¶–BÆ6öçG&öÆÆW"Ç6VÆV7F÷"Çö–çBÇvçBÆ¶W•ÒöbfVçVW2—°¢v—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"Ä“ÔBæ–çFW&–÷'3¶–b„’æ7F—fR—´’ç&WVW7B„’æ7F—fRç&ööÒæW†—B“´’çWFFR‚ãB“·Ô’ç&Wf–Wr‚G´¥4ôâç7G&–æv–g’†–B—ÒÇG'VR“´’çWFFR‚ãB“¶6öç7B#Ô’æ7F—fRç&ööÓ´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¢G·ö–çE³×ÒÇ“¥"æw&÷VæDB‚G·ö–çE³×ÒÂG·ö–çE³×Ò’Ç£¢G·ö–çE³××ÒÇ–s£Ç—F6ƒ¢ã"ÆF—7C£7Ò“·Ò’‚–“¶v—B7FW‚“°¢–b†–CÓÓÒ&ÖVÖRÖf7F÷'’"—°¢f÷"†6öç7Bf–Wröb²&ÖVÖRÖVçG&æ6R"Â&ÖVÖRÖÆ6W""Â&ÖVÖRÖ6öçG&–'WF÷'2"Â&ÖVÖR×&öGV7F–öâ"Â&ÖVÖR×&V6÷&F–ær"Â&ÖVÖRÖ&6†—fR%Ò—¶v—B"æWfÇVFR†õööövç–Æ÷Bææf–vFR…õööövæG6"æ–çFW&–÷'2æ7F—fRç&ööÒç&Wf–Ww5²G´¥4ôâç7G&–æv–g’‡f–Wr—ÕÒ–“¶v—B7FW‚“¶v—B"ç67&VVç6†÷B†¦ö–â‡F‡2Çf–Wr²"çær"’“·Ð¢v—B"æWfÇVFR†õööövç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ¢Ó‚Ç“£Ç£¢Ó’ãwÒÇ–s£Ç—F6ƒ¢ã"ÆF—7C£7Ò–“¶v—B7FW‚“°¢Ð¢f÷"†6öç7B·rÆ…Òöbµ³CCÃ“ÒÅ³3“ÃƒCEÒÅ³ƒCBÃ3“ÕÒ—°¢v—B"ç6VæB‚$V×VÆF–öâç6WDFWf–6TÖWG&–74÷fW'&–FR"Ç·v–GFƒ§rÆ†V–v‡C¦‚ÆFWf–6U66ÆTf7F÷#£ÆÖö&–ÆS§rÓÓCCÒ“°¢v—B"æWfÇVFR‚uõööövæG6"æ÷VåfVçVR‚’r“¶v—B7FW‚“°¢6öç7B#Öv—B"æWfÇVFR†‚‚“Óç¶6öç7BCÕõööövæG6"ÆÓÔE²G´¥4ôâç7G&–æv–g’†6öçG&öÆÆW"—ÕÒÇÖFö7VÖVçBçVW'•6VÆV7F÷"‚G´¥4ôâç7G&–æv–g’‡6VÆV7F÷"—Ò—ÇÆFö7VÖVçBçVW'•6VÆV7F÷"‚ræG6"ÖÖVçRÖVævvVBr’Ç#×ævWD&÷VæF–æt6Æ–VçE&V7B‚’Çc×f—7VÅf–Ww÷'C·&WGW&â·&÷WFS¦Òç7FG5²G´¥4ôâç7G&–æv–g’†¶W’—ÕÒÇ7FG3¦Òç7FG2Æ7ƒ¤ÖF‚æ'2‡"ç‚·"çv–GF‚ó"×bæöfg6WDÆVgB×bçv–GF‚ó"’Æ7“¤ÖF‚æ'2‡"ç’·"æ†V–v‡Bó"×bæöfg6WEF÷×bæ†V–v‡Bó"’Æf—G3§"çƒã×bæöfg6WDÆVgBbg"ç“ã×bæöfg6WEF÷bg"ç&–v‡CÃ×bæöfg6WDÆVgB·bçv–GF‚²ãRbg"æ&÷GFöÓÃ×bæöfg6WEF÷·bæ†V–v‡B²ãRÇ67&öÆÃ§ç67&öÆÅv–GFƒÃ×æ6Æ–VçEv–GF‚³Æ—6öÆFVC¦Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚vG6"ÖÖVçRÖ÷Vâr’bd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓÆ‡VC¦vWD6ö×WFVE7G–ÆR†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG6"Ö6öçFW‡Br’’çf—6–&–Æ—G’Æ÷fW&fÆ÷s¦vWD6ö×WFVE7G–ÆR‡’æ÷fW&fÆ÷u—Ó·Ò’‚–“°¢òòf–æR'G2—2ÆVv—F–ÖFRÖ–â6V7F–öâ–âF†—26FÆös²6öÆÆV7F–öç2W6R—G2Frf–VÆBà¢6öç7B6÷'&V7C×"ç&÷WFSÓÓ×vçGÇÆ–CÓÓÒ'&ööbÖöbÖ–æ²"bg"ç7FG2ç6V7F–öãÓÓ×vçC°¢&V6÷&B†E4"ÖVçW2G¶–GÒG·w×‚G¶‡Ó¢6öçFW‡GVÂ&÷WFRÂ6VçFW&VB67&öÆÆ–ær6†VÆÂÂ6fR&÷VæG2æB†–FFVâ6öçG&öÇ6Æ6÷'&V7Bbg"æ7ƒÃbg"æ7“Ãbg"æf—G2bg"ç67&öÆÂbg"æ—6öÆFVBbg"æ‡VCÓÓÒ&†–FFVâ"be²&WFò"Â'67&öÆÂ%Òæ–æ6ÇVFW2‡"æ÷fW&fÆ÷r’Ä¥4ôâç7G&–æv–g’‡"’“°¢v—B"ç67&VVç6†÷B†¦ö–â‡F‡2Æ–B²"ÖÖVçRÒ"·r²"çær"’“°¢v—B"æWfÇVFR†õööövæG6%²G´¥4ôâç7G&–æv–g’†6öçG&öÆÆW"—ÕÒæ6Æ÷6R‚–“¶v—B7FW‚“°¢&V6÷&B†E4"ÖVçW2G¶–GÒG·w×‚G¶‡Ó¢6Æ÷6R&W7F÷&W26öçG&öÂÆ–W&Æv—B"æWfÇVFR‚rFö7VÖVçBæ&öG’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"ÖÖVçRÖ÷Vâ"’bd$ÂæG6$ÖVçU6†VÆÂæ6÷VçCÓÓÓbbFö7VÖVçBçVW'•6VÆV7F÷"‚"æG6"ÖÖVçR×6†FR"’r’“°¢Ð¢v—B"æWfÇVFR†‚‚“Óç¶6öç7BCÕõööövæG6"Ä“ÔBæ–çFW&–÷'3´’ç&WVW7B„’æ7F—fRç&ööÒæW†—B“´’çWFFR‚ãB“´’ç&Wf–Wr‚G´¥4ôâç7G&–æv–g’†–B—ÒÇG'VR“´’çWFFR‚ãB“´Bæ÷VåfVçVR‚“·Ò’‚–“¶v—B7FW‚“°¢6öç7BfÆÆ&6³×²&ÖVÖRÖf7F÷'’#¢&†öÖR"Â'v—F†÷WB×'VÆW'2#¢&†öÖR"Â'&ööbÖöbÖ–æ²#¢&fVGW&VB"Â&&–rÖ&—F6ö–â#¢&÷fW'f–Wr"Â&Ö†—2Ö6ÇV"#¢&†öÖR'Õ¶–EÓ°¢&V6÷&B†E4"ÖVçW2G¶–GÓ¢W†—BæBg&W6‚VçG&æ6RF—66&B7FÆR&÷WFVÆv—B"æWfÇVFR†‚‚“Óç¶6öç7B3ÕõööövæG6%²G´¥4ôâç7G&–æv–g’†6öçG&öÆÆW"—ÕÒç7FG3·&WGW&â‡2ç&÷WFWÇÇ2ç6V7F–öçÇÇ2æ6FVv÷'’“ÓÓÒG´¥4ôâç7G&–æv–g’†fÆÆ&6²—Ó·Ò’‚–’“°¢v—B"æWfÇVFR†õööövæG6%²G´¥4ôâç7G&–æv–g’†6öçG&öÆÆW"—ÕÒæ6Æ÷6R‚–“°¢Ð¢v—B"æWfÇVFR‚r‚‚“Óç¶6öç7BCÕõööövæG6"Ä“ÔBæ–çFW&–÷'3´’ç&WVW7B„’æ7F—fRç&ööÒæW†—B“´’çWFFR‚ãB“´’ç&Wf–Wr‚&G6"×7GVF–ò"ÇG'VR“´’çWFFR‚ãB“µõööövç–Æ÷Bææf–vFR‡·÷6—F–öã¤’æ7F—fRç&ööÒæ§V¶V&÷„BÇ–s¤ÖF‚å’ó"Ç—F6ƒ¢ã"ÆF—7C£7Ò“·Ò’‚’r“¶v—B7FW‚“°¢v—B"æ¶W’‚""“¶v—B7FW‚“°¢&V6÷&B‚$E4"76W3¢‡—6–6Â§V¶V&÷‚÷Vç26†&VB6VçFW&VBF–Æör"Æv—B"æWfÇVFR‚uõööövæG6"ç76W2æ—4÷VâbfFö7VÖVçBçVW'•6VÆV7F÷"‚"æG6"×76W2"’æ6Æ74Æ—7Bæ6öçF–ç2‚&G6"ÖÖVçRÖVævvVB"’r’“°¢f÷"†6öç7B·rÆ…Òöbµ³CCÃ“ÒÅ³3“ÃƒCEÒÅ³ƒCBÃ3“ÕÒ—°¢v—B"ç6VæB‚$V×VÆF–öâç6WDFWf–6TÖWG&–74÷fW'&–FR"Ç·v–GFƒ§rÆ†V–v‡C¦‚ÆFWf–6U66ÆTf7F÷#£ÆÖö&–ÆS§rÓÓCCÒ“¶v—B7FW‚“°¢&V6÷&B†E4"76W2G·w×‚G¶‡Ó¢6VçFW&VBæB–çFW&æÆÇ’67&öÆÆ&ÆVÆv—B"æWfÇVFR‚r‚‚“Óç¶6öç7BÖFö7VÖVçBçVW'•6VÆV7F÷"‚"æG6"×76W2"’Ç#×ævWD&÷VæF–æt6Æ–VçE&V7B‚’Çc×f—7VÅf–Ww÷'C·&WGW&âÖF‚æ'2‡"ç‚·"çv–GF‚ó"×bçv–GF‚ó"“ÃbdÖF‚æ'2‡"ç’·"æ†V–v‡Bó"×bæ†V–v‡Bó"“Ãbg"çƒãÓbg"ç“ãÓbg"æ&÷GFöÓÃ×bæ†V–v‡B²ãRbgç67&öÆÅv–GFƒÃ×æ6Æ–VçEv–GF‚³bfvWD6ö×WFVE7G–ÆR‡’æ÷fW&fÆ÷u“ÓÓÒ&WFò#·Ò’‚’r’“°¢Ð¢v—B"æWfÇVFR‚uõööövæG6"ç76W2æ6Æ÷6R‚“µõööövæG6"æ–çFW&–÷'2ç&WVW7B…õööövæG6"æ–çFW&–÷'2æ7F—fRç&ööÒæW†—B“µõööövæG6"æ–çFW&–÷'2çWFFR‚ãB’r“°¢f÷"†6öç7B&÷WFRöb²&Ö–â"Â'&F–ò"Â&§V¶V&÷‚%Ò–f÷"†6öç7B·rÆ…Òöbµ³CCÃ“ÒÅ³3“ÃƒCEÒÅ³ƒCBÃ3“ÕÒ—°¢v—B"ç6VæB‚$V×VÆF–öâç6WDFWf–6TÖWG&–74÷fW'&–FR"Ç·v–GFƒ§rÆ†V–v‡C¦‚ÆFWf–6U66ÆTf7F÷#£ÆÖö&–ÆS§rÓÓCCÒ“°¢v—B"æWfÇVFR†õööövæG6"çGbæ÷Vâ‚G´¥4ôâç7G&–æv–g’‡&÷WFR—Ò–“¶v—B7FW‚“°¢6öç7B#Öv—B"æWfÇVFR‚r‚‚“Óç¶6öç7BCÕõööövæG6"ÆSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚&G6"×Gb"’Ç#ÖRævWD&÷VæF–æt6Æ–VçE&V7B‚’Çc×f—7VÅf–Ww÷'C·&WGW&â·&÷WFS¤BçGbç7FG2ç&÷WFRÆ7ƒ¤ÖF‚æ'2‡"ç‚·"çv–GF‚ó"×bçv–GF‚ó"’Æ7“¤ÖF‚æ'2‡"ç’·"æ†V–v‡Bó"×bæ†V–v‡Bó"’Çv–GFƒ¦Rç67&öÆÅv–GFƒÃÖRæ6Æ–VçEv–GF‚³Æfö7W3¦Fö7VÖVçBæ7F—fTVÆVÖVçBæ–GÓ·Ò’‚’r“°¢&V6÷&B†æöFW'VææW"G·&÷WFWÒG·w×‚G¶‡Ó¢6VçFW&VB6öçFW‡BæB&WVW7Bfö7W6Ç"ç&÷WFSÓÓ×&÷WFRbg"æ7ƒÃbg"æ7“Ãbg"çv–GF‚bb‡&÷WFRÓÒ&§V¶V&÷‚'ÇÇ"æfö7W3ÓÓÒ&G6"×Gb×VW'’"’Ä¥4ôâç7G&–æv–g’‡"’“°¢v—B"ç67&VVç6†÷B†¦ö–â‡F‡2Â&æöFW'VææW"Ò"·&÷WFR²"Ò"·r²"çær"’“¶v—B"æWfÇVFR‚uõööövæG6"çGbæ6Æ÷6R‚’r“°¢Ð¢f÷"†ÆWB“Ó¶“Ã#¶’²²–v—B"æWfÇVFR‚uõööövæG6"çGbæ÷Vâ‚'&F–ò"“µõööövæG6"çGbæ6Æ÷6R‚’r“°¢6öç7BgFW#Öv—B6æ6†÷B‚“·&V6÷&B‚$E4"ÖVçRÆ–fV7–6ÆS¢&WVFVB÷Væ–æw2&VÆV6R6†&VBÆ—7FVæW'2æB6†FR"ÆgFW"æÆ—7FVæW'3ÓÓÖ&6VÆ–æRæÆ—7FVæW'2bfgFW"æFöÓÓÓÖ&6VÆ–æRæFöÒÄ¥4ôâç7G&–æv–g’‡¶&6VÆ–æRÆgFW'Ò’“°¢&V6÷&B‚$E4"6öçFW‡GVÂÖVçW3¢'VçF–ÖR6öç6öÆR&VÖ–ç26ÆVâ"Æ"æÆöw2æÆVæwFƒÓÓÓÆ"æÆöw2æ¦ö–â‚"Â"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢'fVçVRÖVçW26†V6·ö–çB"ÇVW'“¢"f–çFW&–÷#ÖÖVÖRÖf7F÷'’gf–WsÖÖVÖRÖVçG&æ6RgvVF†W#Ö6ÆV"gF–ÖSÓ#"Ç7FW3¥¶G6%fVçVTÖVçW46†V6·ö–çE×Ò“° ¦6öç7BG6$æGW&T6†V6·ö–çBÒ²æÖS¢&G6"æGW&R6†V6·ö–çB"Âv‡“¢''VÆS¢FW'&–â6öçF7BÂFWFW&Ö–æ—7F–2Æ–÷WBÂ6ÆV"&÷WFW2æB&÷VæFVBF–W"÷VÆF–öç27W'f—fR66VæR&RÖVçG'’"Â'Vã¢7–æ2"Óâ°¢6öç7BW‡FW&–÷#Öv—B"æWfÇVFR†‚‚“Óç°¢6öç7BCÕõööövæG6"ÄÃÔBæÆæBÄSÔBæFWF–Ã¶ÆWBfÆöF–æsÓÆ'W&–VCÓÆ&Æö6¶VCÓÆ–çfÆ–CÓ°¢6öç7BvVöÖWG&–W3ÖæWr6WB‚’Çf—6—CÖãÓç¶–b†âævVöÖWG'’–vVöÖWG&–W2æFB†âævVöÖWG'’“¶f÷"†6öç7B2öbâæ6†–ÆG&Vâ—f—6—B†2“·Ó·f—6—B„Ræw&÷W“°¢f÷"†6öç7BâöbRæw&÷Wæ6†–ÆG&Vâ––b†âæ–ç7Fæ6TFF—¶6öç7BÖâæ–ç7Fæ6TFFÇcÖâævVöÖWG'’çfW'G3¶f÷"†ÆWBóÓ¶óÆæÆVæwFƒ¶ò³Ó#—¶ÆWBF÷ÒÔ–æf–æ—G“¶f÷"†ÆWB£Ó¶£ÇbæÆVæwFƒ¶¢³Ó2—¶6öç7BƒÖ¶õÒ§e¶¥Ò¶¶ò³…Ò§e¶¢³%Ò¶¶ò³%ÒÇ“Ö¶ò³Ò§e¶¥Ò¶¶ò³UÒ§e¶¢³Ò¶¶ò³•Ò§e¶¢³%Ò¶¶ò³5ÒÇ£Ö¶ò³%Ò§e¶¥Ò¶¶ò³Ò§e¶¢³%Ò¶¶ò³EÓ¶–b‚·‚Ç’Ç¥ÒæWfW'’„çVÖ&W"æ—4f–æ—FR’––çfÆ–B²³¶–b„ÖF‚æ'2‡e¶¢³Ò“Âãbg“äÂæ†V–v‡DB‡‚Ç¢’²ãR–fÆöF–ær²³·F÷ÔÖF‚æÖ‚‡F÷Ç’“·Ö–b‡F÷ÄÂæ†V–v‡DB†¶ò³%ÒÆ¶ò³EÒ’²ãb–'W&–VB²³·×Ð¢f÷"†6öç7BöbRçÆ6VÖVçG2––b‡ç&Vv–öâÓÒ'–W""–f÷"†6öç7BÆ–æRöb´ÂçG&–ÂÄÂçvFW&g&öçBÂââäÂæÆæW5Ò–f÷"†ÆWB“Ó¶“ÆÆ–æRæÆVæwFƒ¶’²²—¶6öç7BÖÆ–æU¶’ÓÒÆ#ÖÆ–æU¶•ÒÆãÔÖF‚æ6V–Â„ÖF‚æ‡—÷B†%³ÒÖ³ÒÆ%³ÒÖ³Ò’£"“¶f÷"†ÆWB£Ó¶£ÃÖã¶¢²²––b„ÖF‚æ‡—÷B‡ç‚Ö³ÒÒ†%³ÒÖ³Ò’¦¢öâÇç¢Ö³ÒÒ†%³ÒÖ³Ò’¦¢öâ“Çç"³ãR–&Æö6¶VB²³·Ð¢v–æF÷råõöW‡FW&–÷$6†V6³×·6–væGW&S¤¥4ôâç7G&–æv–g’„RçÆ6VÖVçG2’ÆöÆC¤WÓ°¢&WGW&â¶fÆöF–ærÆ'W&–VBÆ&Æö6¶VBÆ–çfÆ–BÆvVöÖWG&–W3¦vVöÖWG&–W2ç6—¦RÆf6FW3¤Ræf6FW2æÆVæwF‚Æ6ö7C¤RçÆ6VÖVçG2æf–ÇFW"‡Óçç&Vv–öãÓÓÒ&6ö7B"’æÆVæwF‚Ç&V#¤RçÆ6VÖVçG2ç6öÖR‡Óçç&Vv–öãÓÓÒ&6ö7B"bgçƒÃbgç£ÂÓ#‚—Ó°¢Ò’‚–“°¢&V6÷&B‚$E4"W‡FW&–÷#¢6VFVB&÷2ÆVfR&÷WFW2æB&V"öÇ–×W26ÆV"v—F‚6WfVâ&÷VæFVBf6FW2"ÂW‡FW&–÷"æfÆöF–ærbbW‡FW&–÷"æ'W&–VBbbW‡FW&–÷"æ&Æö6¶VBbbW‡FW&–÷"æ–çfÆ–BbbW‡FW&–÷"ç&V"bfW‡FW&–÷"æf6FW3ÓÓÓrbfW‡FW&–÷"æ6ö7CãbfW‡FW&–÷"ævVöÖWG&–W3ÃcRÄ¥4ôâç7G&–æv–g’†W‡FW&–÷"’“°¢6öç7B#Öv—B"æWfÇVFR†‚‚’Óâ°¢6öç7B#ÕõööövÄCÔ"æG6"ÄãÔBææGW&RÄÃÔBæÆæC°¢6öç7B6–væGW&SÔ¥4ôâç7G&–æv–g’„âçÆ6VÖVçG2’Æ6÷VçG3×·Ó¶ÆWBfÆöF–æsÓÆ'W&–VCÓÆ&Æö6¶VCÓÆ–çfÆ–CÓ°¢f÷"†6öç7Bböbâæf–VÆG2’°¢6÷VçG5¶bæ¶–æEÓÖbæÆ—7BæÆVæwFƒ°¢6öç7BcÖbææöFRævVöÖWG'’çfW'G2ÆÖbç6÷W&6S°¢f÷"†ÆWB“Ó¶“ÆbæÆ—7BæÆVæwFƒ¶’²²’°¢6öç7BóÖ’£#ÇÖbæÆ—7E¶•Ó¶ÆWBF÷ÒÔ–æf–æ—G“°¢f÷"†ÆWB£Ó¶£ÇbæÆVæwFƒ¶¢³Ó2’°¢6öç7BƒÖ¶õÒ§e¶¥Ò¶¶ò³…Ò§e¶¢³%Ò¶¶ò³%Ó°¢6öç7B“Ö¶ò³Ò§e¶¥Ò¶¶ò³UÒ§e¶¢³Ò¶¶ò³•Ò§e¶¢³%Ò¶¶ò³5Ó°¢6öç7B£Ö¶ò³%Ò§e¶¥Ò¶¶ò³Ò§e¶¢³%Ò¶¶ò³EÓ°¢–b‚·‚Ç’Ç¥ÒæWfW'’„çVÖ&W"æ—4f–æ—FR’––çfÆ–B²³°¢–b„ÖF‚æ'2‡e¶¢³Ò“Âãbg“äÂæ†V–v‡DB‡‚Ç¢’²ãR–fÆöF–ær²³°¢F÷ÔÖF‚æÖ‚‡F÷Ç’“°¢Ð¢–b‡F÷ÄÂæ†V–v‡DB‡ç‚Çç¢’²ã‚–'W&–VB²³°¢òò6×ÆR7GVÂ&öB÷G&–Â6VçG&RÆ–æW3²æòÆ&vR6–Æ†÷VWGFR6â7&÷72F†V—"vÆ¶–ær7W&f6Rà¢–b†bæ¶–æBÓÒ&&÷Vv–çf–ÆÆV"bfbæ¶–æBÓÒ'ÆçFW""–f÷"†6öç7BÆ–æRöb´ÂçG&–ÂÄÂçvFW&g&öçBÂââäÂæÆæW5Ò’°¢f÷"†ÆWB³Ó¶³ÆÆ–æRæÆVæwFƒ¶²²²’°¢6öç7Bg&öÓÖÆ–æU¶²ÓÒÇFóÖÆ–æU¶µÒÇ7FW3ÔÖF‚æ6V–Â„ÖF‚æ‡—÷B‡Fõ³ÒÖg&öÕ³ÒÇFõ³ÒÖg&öÕ³Ò’£"“°¢f÷"†ÆWBÓ·Ã×7FW3·²²––b„ÖF‚æ‡—÷B‡ç‚Ög&öÕ³ÒÒ‡Fõ³ÒÖg&öÕ³Ò’§÷7FW2Çç¢Ög&öÕ³ÒÒ‡Fõ³ÒÖg&öÕ³Ò’§÷7FW2“Æbç7V2ç"§ç66ÆR³ãR–&Æö6¶VB²³°¢Ð¢Ð¢Ð¢Ð¢6öç7B÷&–v–æÅF–W#Ô"ç&VæFW&W"çVÆ—G’ÇF–W'3×·Ó°¢f÷"†6öç7BF–W"öb²&†–v‚"Â&ÖVF—VÒ"Â&Æ÷r%Ò’°¢"ç&VæFW&W"ç6WEVÆ—G’‡F–W"“´âçWFFRƒÃ“°¢F–W'5·F–W%Ó×·f—6–&ÆS¤âç7FG2çf—6–&ÆRÆwVÆÇ3¤âç7FG2æwVÆÇ2ÇG&VW3¤âæf–VÆG2ç6Æ–6RƒÃ"’ç&VGV6R‚†âÆb“Óæâ¶bææöFRæ–ç7Fæ6T6÷VçBÃ—Ó°¢Ð¢"ç&VæFW&W"ç6WEVÆ—G’‚&†–v‚"“´âçWFFRƒÃ“¶6öç7B6ÆÓÔâç7FG2ç7v“°¢BçvVF†W"ç6WDÖöFR‚'7F÷&Ò"“¶f÷"†ÆWB“Ó¶“Ã#C¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc“°¢6öç7Bv–æG“Ôâç7FG2ç7v“æ6ÆÓ°¢BçvVF†W"ç6WDÖöFR‚&6ÆV""“´"ç&VæFW&W"ç6WEVÆ—G’†÷&–v–æÅF–W"“°¢òò&V'V–ÆF–ær÷fW"G&ç6ÆFVB7W&f6R×W7BG&ç6ÆFR&ö÷G2Âæ÷B&WF–âf—†VBÕ’66VæW'’à¢6öç7B&ö÷CÔ$Âç66VæRæ7&VFTæöFR‚’Ç&—6VC×²ââäÂÆ†V–v‡DC¢‡‚Ç¢“ÓäÂæ†V–v‡DB‡‚Ç¢’³'Ó°¢6öç7BW‡G&Ô$ÂæG6$æGW&Ræ7&VFR‡·&ö÷BÆÆæC§&—6VBÇ&VæFW&W#¤"ç&VæFW&W"Æ6ÖW&¤"æ6ÖW&ÇvVF†W#¤BçvVF†W'Ò“°¢6öç7B÷&–v–æÇ3ÖæWrÖ„âçÆ6VÖVçG2æÖ‡Óå·æ¶–æB²#¢"·ç‚²#¢"·ç¢ÇÒ’“¶ÆWBÖF6†VCÓÇ6†–gFVCÓ°¢f÷"†6öç7BöbW‡G&çÆ6VÖVçG2—¶6öç7BöÆCÖ÷&–v–æÇ2ævWB‡æ¶–æB²#¢"·ç‚²#¢"·ç¢“¶–b†öÆB—¶ÖF6†VB²³¶–b„ÖF‚æ'2‡ç’ÖöÆBç’Ó"“ÃRÓb—6†–gFVB²³·×Ð¢W‡G&æF—7÷6R‚“¶W‡G&æF—7÷6R‚“°¢v–æF÷råõöæGW&T6†V6³×·6–væGW&RÆöÆC¤âÆöÆE&ö÷C¤$Âç66VæW2æG6"ç&ö÷GÓ°¢&WGW&â¶6÷VçG2ÆfÆöF–ærÆ'W&–VBÆ&Æö6¶VBÆ–çfÆ–BÇF–W'2Çv–æG’ÆÖF6†VBÇ6†–gFVBÆF—7÷6VC§&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÓbfW‡G&æw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓÓ°¢Ò’‚–“°¢&V6÷&B‚$E4"æGW&S¢WfW'’6öçF7BfW'FW‚—2w&÷VæFVBÂF‡27F’6ÆV"æBG&ç6f÷&ÖVBvVöÖWG'’7F—2f–æ—FR"Â"æfÆöF–ærbb"æ'W&–VBbb"æ&Æö6¶VBbb"æ–çfÆ–BÄ¥4ôâç7G&–æv–g’‡"’“°¢&V6÷&B‚$E4"æGW&S¢7W&f6R6†ævW2Ö÷fR&ö÷G2æBF—7÷6Â&VÖ÷fW2F†Rv†öÆR&÷VæFVBf–VÆB"Ç"æÖF6†VCãSbg"æÖF6†VCÓÓ×"ç6†–gFVBbg"æF—7÷6VBÄ¥4ôâç7G&–æv–g’‡"’“°¢&V6÷&B‚$E4"æGW&S¢Æ÷rF–W"&WF–ç2G&VW2Â&VGV6W2FWF–ÂæB6†&W27F÷&Òv–æB"Ç"çF–W'2æ†–v‚çf—6–&ÆSç"çF–W'2æÖVF—VÒçf—6–&ÆRbg"çF–W'2æÖVF—VÒçf—6–&ÆSç"çF–W'2æÆ÷rçf—6–&ÆRbg"çF–W'2æÆ÷rçG&VW3ãCbg"çF–W'2æÆ÷ræwVÆÇ3ÓÓÓbg"çv–æG’Ä¥4ôâç7G&–æv–g’‡"’“°¢f÷"†ÆWBf—6—CÓ·f—6—CÃ#·f—6—B²²’°¢v—B"æWfÇVFR‚uõööövævò‚&G6""ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“°¢6öç7B7FFSÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B×v–æF÷råõöæGW&T6†V6²ÆãÕõööövæG6"ææGW&S·&WGW&â·6ÖS¤¥4ôâç7G&–æv–g’†âçÆ6VÖVçG2“ÓÓ×ç6–væGW&RÆ6ÆV&VC§æöÆE&ö÷Bæ6†–ÆG&VâæÆVæwFƒÓÓÓbgæöÆBæw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓÆf–VÆG3¦âæw&÷Wæ6†–ÆG&VâæÆVæwF‚ÇF÷FÃ¦âç7FG2çF÷FÂÇFW‡GW&W3¥õööövç&VæFW&W"ç7FG2çvFW%FW‡GW&W7Ó·Ò’‚–“°¢&V6÷&B†E4"æGW&S¢f—6—BG·f—6—B³'Ò&W6W'fW26VVFVBÆ–÷WBæB&VÆV6W2öÆB66VæVÇ7FFRç6ÖRbg7FFRæ6ÆV&VBbg7FFRæf–VÆG3ÓÓÓbg7FFRçF÷FÃãbg7FFRçFW‡GW&W3ÓÓÓ"Ä¥4ôâç7G&–æv–g’‡7FFR’“°¢6öç7BFWF–ÃÖv—B"æWfÇVFR‚r‡·6ÖS¤¥4ôâç7G&–æv–g’…õööövæG6"æFWF–ÂçÆ6VÖVçG2“ÓÓÕõöW‡FW&–÷$6†V6²ç6–væGW&RÆ6ÆV&VC¥õöW‡FW&–÷$6†V6²æöÆBæw&÷Wæ6†–ÆG&VâæÆVæwFƒÓÓÓÒ’r“°¢&V6÷&B†E4"W‡FW&–÷#¢f—6—BG·f—6—B³'Ò&VÆV6W2G&W76–ærv—F†÷WBGWÆ–6FW6ÆFWF–Âç6ÖRbfFWF–Âæ6ÆV&VBÄ¥4ôâç7G&–æv–g’†FWF–Â’“°¢Ð¢v—B"æWfÇVFR‚vFVÆWFRv–æF÷råõöæGW&T6†V6³¶FVÆWFRv–æF÷råõöW‡FW&–÷$6†V6²r“°¢&V6÷&B‚$E4"æGW&S¢'VçF–ÖR6öç6öÆR&VÖ–ç26ÆVâ"Æ"æÆöw2æÆVæwFƒÓÓÓÆ"æÆöw2æ¦ö–â‚"Â"’“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢&æGW&R6†V6·ö–çB"ÇVW'“¢"f÷fW'f–WsÓgvVF†W#Ö6ÆV"gF–ÖSÓ#"Ç7FW3¥¶G6$æGW&T6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢&æGW&R6†V6·ö–çB†öæR"ÇVW'“¢"f÷fW'f–WsÓgvVF†W#Ö6ÆV"gF–ÖSÓ#"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6$æGW&T6†V6·ö–çE×Ò“° ¦6öç7BG6%7GVF–ô6†V6·ö–çBÒ¶æÖS¢&G6"7GVF–ò6†V6·ö–çB"Çv‡“¢'Æ—F‡&÷Vvƒ¢7GVF–ò6VF–ær&W6W'fW2Æö6öÖ÷F–öâÆö6²Â–Òöf—&RæBF‡&÷w3²&6†—fRæBVçf—&öæÖVçBF—7÷6RF‡&÷Vv‚&WVFVBf—6—G2"Ç'Vã¦7–æ2#Óç°¢6öç7B7FWÒ‚“Óæ"æWfÇVFR‚vf÷"†ÆWB“Ó¶“ÃCƒ¶’²²”$Âç66VæW2æG6"çWFFRƒócÆ’óc’r“°¢6öç7BFÖ7–æ26VÆV7F÷#Óç°¢6öç7BÖv—B"æWfÇVFR†‚‚“Óç¶6öç7BSÖFö7VÖVçBçVW'•6VÆV7F÷"‚G´¥4ôâç7G&–æv–g’‡6VÆV7F÷"—Ò“¶Rç67&öÆÄ–çFõf–Wr‡¶&Æö6³¢&6VçFW"'Ò“¶6öç7B#ÖRævWD&÷VæF–æt6Æ–VçE&V7B‚“·&WGW&â·ƒ§"ç‚·"çv–GF‚ó"Ç“§"ç’·"æ†V–v‡Bó'Ó·Ò’‚–“°¢v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Ç·G—S¢'F÷V6…7F'B"ÇF÷V6…ö–çG3¥·×Ò“¶v—B"ç6VæB‚$–çWBæF—7F6…F÷V6„WfVçB"Ç·G—S¢'F÷V6„VæB"ÇF÷V6…ö–çG3¥µ×Ò“¶v—B7FW‚“°¢Ó°¢v—B"æ¶W’‚""“¶v—B7FW‚“°¢6öç7BÆ–÷WCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"Å#ÔBæ–çFW&–÷'2æ7F—fSòç&ööÓ·&WGW&â¶–C¥#òæ–BÇ6VG3¥#òç6VG2æÆVæwF‚ÆVçG'“¥#òæw&÷VæDBƒÃr’ÆÆ÷vW#¥#òæw&÷VæDBƒÂÓb’Ç7FvS¥#òæw&÷VæDBƒÂÓ"’ÆW‡FW&–÷#¤BæW‡FW&–÷"çf—6–&ÆRÇ&–ã¤BçvVF†W"ç6†&VBç7FFRæG&÷2ÆÖ7FW#¤BçvVF†W"ç6†&VBç7FFRæÖ7FW$ÆWfVÂÆÆ–v‡G3¥#òæÆ–v‡F–æræÆ–v‡D6÷VçGÓ·Ò’‚–“°¢&V6÷&B‚%7GVF–ó¢6÷'&V7BFö÷"&WfVÇ2WW"VçG&æ6RÂFW66VæF–ær&ööÒæB—6öÆFVB7FvR"ÆÆ–÷WBæ–CÓÓÒ&G6"×7GVF–ò"bfÆ–÷WBç6VG3ÓÓÓ3’bfÆ–÷WBæVçG'“ÓÓÓ2bfÆ–÷WBæÆ÷vW#ÓÓÓbfÆ–÷WBç7FvSÓÓÒãbbbÆ–÷WBæW‡FW&–÷"bfÆ–÷WBç&–ãÓÓÓbfÆ–÷WBæÖ7FW#ÓÓÓbfÆ–÷WBæÆ–v‡G3ÓÓÓ2Ä¥4ôâç7G&–æv–g’†Æ–÷WB’“°¢6öç7B&÷WFW3Öv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"Å#ÔBæ–çFW&–÷'2æ7F—fRç&ööÒÄÔBæfF"Æ6ÆV#Ò†Æ"“ÓäBæ–çFW&–÷'2çvÆ¶&ÆR†³ÒÆ³ÒÆ%³ÒÆ%³ÒÃ2Ã"Ä“·&WGW&â¶ÆVgC¥"æ§V¶V&÷„BçƒÃÆ&ö÷Fƒ¦6ÆV"…³Ã%ÒÅ³RÃ%Ò’bf6ÆV"…³RÃ%ÒÅ³RÃRãUÒ’Æ6÷'&–F÷#¦6ÆV"…³ÃuÒÅ³Ã‚ãUÒ’Æ&Æ6öç“¦6ÆV"…³Ã‚ãUÒÅ³2ãRÃ‚ãUÒ’bf6ÆV"…³2ãRÃ‚ãUÒÅ³"ãRÃbã…Ò’Ç6VG3¥"ç6VG2æWfW'’‡3Óæ6ÆV"…·2çvÆ´Bç‚Ç2çvÆ´Bç¥ÒÅ·2çvÆ´Bç‚Ç2çvÆ´Bç¥Ò’—Ó·Ò’‚–“°¢&V6÷&B‚%7GVF–ó¢ÆVgB&6†—fRÂVçFW&&ÆR&–v‡B&ö÷F‚Â6÷'&–F÷"æB&Æ6öç’&ö6†W27F’6ÆV""Äö&¦V7BçfÇVW2‡&÷WFW2’æWfW'’„&ööÆVâ’Ä¥4ôâç7G&–æv–g’‡&÷WFW2’“°¢6öç7B6VE&÷VæEG&—Öv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÅ#Ô"æG6"æ–çFW&–÷'2æ7F—fRç&ööÓ·&WGW&â"ç6VG2æWfW'’‡3Óç´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ§2çvÆ´Bç‚Ç“§2æfÆö÷"Ç£§2çvÆ´Bç§ÒÇ–s§2çf–Wu–sóóÇ—F6ƒ¢ã"ÆF—7C£7Ò“·&WGW&â"æ7&Wrç6—EÆ–W"‡2’bd"æ7&Wrç7FæEÆ–W"‚’bb2ç6—GFW#·Ò“·Ò’‚–“°¢&V6÷&B‚%7GVF–ó¢WfW'’VF–Væ6RÂ&Æ6öç’æB7FvR6VB6—G2æB7FæG26fVÇ’"Ç6VE&÷VæEG&—“°¢v—B"æWfÇVFR‚uõööövç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ£Ç“£2Ç££7ÒÇ–s£Ç—F6ƒ¢ã"ÆF—7C£7Ò’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“¶v—B7FW‚“¶v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢v—BF‚"67B"“¶v—B7FW‚“¶v—B7FW‚“°¢6öç7B7VW3Öv—B"æWfÇVFR‚uõööövæG6"æ–çFW&–÷'2æVF–òç7FG2r“°¢&V6÷&B‚%7GVF–ó¢vÆ¶–æræB§V×–ærFBæò7GVF–ò×7V6–f–2VF–ò6÷W&6W2"Æ7VW2ç6÷W&6W3ÓÓÓ2bf7VW2æ6öçFW‡G3ÓÓÓbb7VW2æ7VW2Ä¥4ôâç7G&–æv–g’†7VW2’“°¢òòÆ–&6²—2FWFW&Ö–æ—7F–2†W&S²6W&FRÆ—fR6Öö¶R6†V6·2F†R&VÂV&Æ–26÷W&6RæBÖVF–à¢v—B"æWfÇVFR†‚‚“Óç°¢v–æF÷råõ÷7GVF–ô6†V6³×¶fWF6ƒ§v–æF÷ræfWF6‚ÇÆ“¤…DÔÄÖVF–VÆVÖVçBç&÷F÷G—RçÆ’ÇW6S¤…DÔÄÖVF–VÆVÖVçBç&÷F÷G—RçW6RÇ&WVW7G3£ÇÆ—3£Æ7F—fS¦æWr6WB‚—Ó°¢6öç7B6†V6³×v–æF÷råõ÷7GVF–ô6†V6³°¢v–æF÷ræfWF6ƒÒ‡W&ÂÆ÷G2“Óç¶–b…7G&–ær‡W&Â’ç7F'G5v—F‚‚&‡GG3¢òö†öFÆW&†—ææWBò"’—¶6†V6²ç&WVW7G2²³·&WGW&â&öÖ—6Rç&W6öÇfR†æWr&W7öç6R„¥4ôâç7G&–æv–g’‡¶6öçFVçC§·&VæFW&VC¥³Ã"Ã5ÒæÖ†“ÓâsÆF—bFFÖÖVF–f–ÆSÒ&‡GG3¢òö†öFÆW&†—ææWB÷wÖ6öçFVçB÷WÆöG2ó##böf—‡GW&RÒr¶’²ræ×2#ãÇ7â6Æ73Ò'Æ–W%÷6öæuöæÖR"FFÖÆ'VÖæÖSÒ###bÓÓr¶’²r#å76Rr¶’²sÂ÷7ããÂöF—câr’æ¦ö–â‚""—×Ò’’“·×&WGW&â6†V6²æfWF6‚‡W&ÂÆ÷G2“·Ó°¢…DÔÄÖVF–VÆVÖVçBç&÷F÷G—RçÆ“ÖgVæ7F–öâ‚—´ö&¦V7BæFVf–æU&÷W'G’‡F†—2Â'W6VB"Ç¶6öæf–wW&&ÆS§G'VRÇfÇVS¦fÇ6WÒ“¶6†V6²çÆ—2²³¶6†V6²æ7F—fRæFB‡F†—2“·F†—2æF—7F6„WfVçB†æWrWfVçB‚'Æ’"’“·&WGW&â&öÖ—6Rç&W6öÇfR‚“·Ó°¢…DÔÄÖVF–VÆVÖVçBç&÷F÷G—RçW6SÖgVæ7F–öâ‚—´ö&¦V7BæFVf–æU&÷W'G’‡F†—2Â'W6VB"Ç¶6öæf–wW&&ÆS§G'VRÇfÇVS§G'VWÒ“¶6†V6²æ7F—fRæFVÆWFR‡F†—2“·F†—2æF—7F6„WfVçB†æWrWfVçB‚'W6R"’“·Ó°¢Ò’‚–“°¢6öç7BÆ—7FVæW'3Ö7–æ2‚“Óç¶6öç7BÖv—B"ç6VæB‚%'VçF–ÖRæWfÇVFR"Ç¶W‡&W76–öã¢&Fö7VÖVçB'Ò’Ç#Öv—B"ç6VæB‚$DôÔFV'VvvW"ævWDWfVçDÆ—7FVæW'2"Ç¶ö&¦V7D–C¦ç&W7VÇBç&W7VÇBæö&¦V7D–GÒ“¶v—B"ç6VæB‚%'VçF–ÖRç&VÆV6Tö&¦V7B"Ç¶ö&¦V7D–C¦ç&W7VÇBç&W7VÇBæö&¦V7D–GÒ“·&WGW&â"ç&W7VÇBæÆ—7FVæW'2æÆVæwFƒ·Ó°¢6öç7B7F'DÆ—7FVæW'3Öv—BÆ—7FVæW'2‚“¶ÆWB&6VÆ–æSÖçVÆÃ°¢f÷"†ÆWB7–6ÆSÓ¶7–6ÆSÃ3¶7–6ÆR²²—°¢–b†7–6ÆR—¶v—BF‚"6G6"Ö6öçFW‡B"“¶v—B7FW‚“·Ð¢v—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÇ3Ô"æG6"æ–çFW&–÷'2æ7F—fRç&ööÒç7FvU6VG5²G¶7–6ÆWÕÓ´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ§2çvÆ´Bç‚Ç“§2æfÆö÷"Ç£§2çvÆ´Bç§ÒÇ–s£Ç—F6ƒ¢ã"ÆF—7C£7Ò“·Ò’‚–“¶v—B7FW‚“¶v—BF‚"6G6"Ö6öçFW‡B"“°¢6öç7B6VFVCÖv—B"æWfÇVFR‚r‡·6VC¢õööövæG6"æfF"æ6×ç6VBÆÆVs¥õööövæG6"æfF"ç'G2æÆVtÂç&÷FF–öâç‚Ç§²ââåõööövæG6"æfF"ç&ö÷Bç÷6—F–öçÒÆ6Æ÷6S¥õööövç–Æ÷Bæ6Æ÷6UvçFVBÇ–s¥õööövæG6"æfF"ç&ö÷Bç&÷FF–öâç—Ò’r“°¢v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W”F÷vâ"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“¶v—B7FW‚“¶v—B"ç6VæB‚$–çWBæF—7F6„¶W”WfVçB"Ç·G—S¢&¶W•W"Æ¶W“¢'r"Æ6öFS¢$¶W•r'Ò“°¢v—BF‚"7vVöâÖ‡VB"“¶v—BF‚"7vVöâÖ‡VB"“¶v—BF‚"æG6"×7GVF–ò×FööÇ2'WGFöâ"“°¢v—B"æWfÇVFR‚v–b‚õööövæG6"æfF"çvVöâæ–Ö–ær•õööövç–Æ÷BæÖöFT7F–öâ‚&ÖöFR×FövvÆR"“µõööövæ7&WræÆöö²ƒ"ãrÂãÃ’r“¶v—B7FW‚“°¢6öç7Bf—&VCÖv—B"æWfÇVFR‚r‡·6VC¢õööövæG6"æfF"æ6×ç6VBÇ§²ââåõööövæG6"æfF"ç&ö÷Bç÷6—F–öçÒÇ–s¥õööövæG6"æfF"ç&ö÷Bç&÷FF–öâç’Ç6†÷G3¥õööövæG6"æfF"çvVöâç6†÷G4f—&VBÇF‡&÷w3¥õööövæ7&Wrç7FG2‚’çFöÖFöW5F‡&÷vâÆ–Ó¥õööövæG6"æfF"çvVöâæ–Ö–ærÆVF–ó¥õööövæG6"æ–çFW&–÷'2æVF–òç7FG7Ò’r“°¢&V6÷&B‚%7GVF–ó¢6VB"¶7–6ÆR²"Æö6·2vÆ¶–ærv—F‚6VFVB÷6RæBÆÆ÷w2wVâ÷F‡&÷r6öçG&öÇ2"Ç6VFVBç6VBbg6VFVBæ6Æ÷6Rbg6VFVBæÆVsÂÓãRbdÖF‚æ6÷2‡6VFVBç–r“âã’bff—&VBç6VBbdÖF‚æ‡—÷B†f—&VBçç‚×6VFVBçç‚Æf—&VBçç¢×6VFVBçç¢“Âãbff—&VBç6†÷G3æ7–6ÆRbff—&VBçF‡&÷w3ÓÓÖ7–6ÆR³bff—&VBæ–Òbff—&VBæVF–òç6÷W&6W3ÓÓÓ2bbf—&VBæVF–òæ7VW2Ä¥4ôâç7G&–æv–g’‡·6VFVBÆf—&VGÒ’“°¢6öç7B7FæD6öçG&öÇ3Öv—B"æWfÇVFR‚t'&’æg&öÒ†Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚&'WGFöâ"’’æf–ÇFW"†SÓâ÷7FæBWö’çFW7B†RçFW‡D6öçFVçB’bfRævWD6Æ–VçE&V7G2‚’æÆVæwF‚bfvWD6ö×WFVE7G–ÆR†R’çf—6–&–Æ—G’ÓÒ&†–FFVâ"’æÆVæwF‚r“°¢&V6÷&B‚%7GVF–ó¢6VFVB6öçG&öÂ"¶7–6ÆR²"†2öæR7FæB7F–öâæBæòÆ–v‡F–ær'WGFöâ"Ç7FæD6öçG&öÇ3ÓÓÓbbv—B"æWfÇVFR‚t'&’æg&öÒ†Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚&'WGFöâ"’’ç6öÖR†SÓâ÷7FvRÆ–v‡G7Ç7GVF–òÆ–v‡G2ö’çFW7B†RçFW‡D6öçFVçB’’r’“°¢v—BF‚"67B"“°¢6öç7B7FööCÖv—B"æWfÇVFR‚r‡·6VC¢õööövæG6"æfF"æ6×ç6VBÆ6Æ÷6S¥õööövç–Æ÷Bæ6Æ÷6UvçFVBÆ6ÆV#¥õööövæG6"æ–çFW&–÷'2çvÆ¶&ÆR…õööövæG6"æfF"ç&ö÷Bç÷6—F–öâç‚ÅõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢ÅõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç‚ÅõööövæG6"æfF"ç&ö÷Bç÷6—F–öâç¢ÃÃ"ÅõööövæG6"æfF"—Ò’r“°¢&V6÷&B‚%7GVF–ó¢F÷V6‚7FæB"¶7–6ÆR²"&W7F÷&W26ÆV"w&÷VæBæBföÆÆ÷r6ÖW&"Â7FööBç6VBbb7FööBæ6Æ÷6Rbg7FööBæ6ÆV"Ä¥4ôâç7G&–æv–g’‡7FööB’“°¢v—B"æWfÇVFR‚uõööövç–Æ÷Bææf–vFR‡·÷6—F–öã¥õööövæG6"æ–çFW&–÷'2æ7F—fRç&ööÒæ§V¶V&÷„BÇ–s¢ÔÖF‚å’ó"Ç—F6ƒ¢ã"ÆF—7C£7Ò’r“¶v—B7FW‚“¶v—BF‚"6G6"Ö6öçFW‡B"“¶v—B"ç6ÆVWƒƒ“°¢v—BF‚"ç76W2Ö—FVÒ"“¶v—BF‚"æG6"×76W2¶FFÖæW‡EÒ"“¶v—BF‚"æG6"×76W2¶FF×&WeÒ"“¶v—BF‚"æG6"×76W2¶FF×Æ•Ò"“°¢6öç7BW6VCÖv—B"æWfÇVFR‚rõööövæG6"ç76W2ç7FG2çÆ––ærr“¶v—BF‚"æG6"×76W2¶FF×Æ•Ò"“¶v—BF‚"æG6"×76W2¶FFÖ6Æ÷6UÒ"“°¢v—BF‚"6G6"Ö6öçFW‡B"“¶v—BF‚"æG6"×76W2¶FFÖ6Æ÷6UÒ"“°¢6öç7BVF–óÖv—B"æWfÇVFR‚r‡·7FG3¥õööövæG6"ç76W2ç7FG2Æ7F—fS¥õ÷7GVF–ô6†V6²æ7F—fRç6—¦RÇ&WVW7G3¥õ÷7GVF–ô6†V6²ç&WVW7G7Ò’r“°¢&V6÷&B‚%7GVF–ó¢&6†—fR"¶7–6ÆR²"'&÷w6W2ÂW6W2Â&W7VÖW2æB&WW6W2öæRÆ–W"ö66†R"ÇW6VBbfVF–òç7FG2æ—FV×3ÓÓÓ2bfVF–òç7FG2çÆ––ærbfVF–òæ7F—fSÓÓÓbfVF–òç&WVW7G3ÓÓÖ7–6ÆR³Ä¥4ôâç7G&–æv–g’†VF–ò’“°¢6öç7BÆö6Æ—¦VCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6"Å#ÔBæ–çFW&–÷'2æ7F—fRç&ööÒÇÆ—3Õõ÷7GVF–ô6†V6²çÆ—2ÆæV#ÔBç76W2ç7FG2æv–ã´"ç–Æ÷Bææf–vFR‡·÷6—F–öã§·ƒ£Ç“£2Ç££‚ãWÒÇ–s£Ç—F6ƒ¢ã"ÆF—7C£7Ò“´$Âç66VæW2æG6"çWFFRƒócÃ“¶6öç7Bf#ÔBç76W2ç7FG3´"ç–Æ÷Bææf–vFR‡·÷6—F–öã¥"æ§V¶V&÷„BÇ–s¤ÖF‚å’ó"Ç—F6ƒ¢ã"ÆF—7C£7Ò“´$Âç66VæW2æG6"çWFFRƒócÃ“·&WGW&â¶æV"Æf"Æ&6³¤Bç76W2ç7FG2ÇÆ—3¥õ÷7GVF–ô6†V6²çÆ—2×Æ—7Ó·Ò’‚–“°¢&V6÷&B‚%7GVF–ó¢&6†—fR"¶7–6ÆR²"fFW2Fò6–ÆVæ6R–âF†VFW"æB&WGW&ç2v—F†÷WB&WÆ’"ÆÆö6Æ—¦VBææV#âã’bfÆö6Æ—¦VBæf"æv–ãÓÓÓbfÆö6Æ—¦VBæf"æ×WFVBbfÆö6Æ—¦VBæf"çÆ––ærbfÆö6Æ—¦VBæ&6²æv–ãâã’bbÆö6Æ—¦VBæ&6²æ×WFVBbfÆö6Æ—¦VBçÆ—3ÓÓÓÄ¥4ôâç7G&–æv–g’†Æö6Æ—¦VB’“°¢v—B"æWfÇVFR‚uõööövç–Æ÷Bææf–vFR‡·÷6—F–öã¥õööövæG6"æ–çFW&–÷'2æ7F—fRç&ööÒç7vâÇ–s£Ç—F6ƒ¢ã#"ÆF—7C£7Ò’r“¶v—B7FW‚“¶v—BF‚"6G6"Ö6öçFW‡B"“°¢6öç7BVæCÖv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÄCÔ"æG6#·&WGW&â¶–æFö÷#¢Bæ–çFW&–÷'2æ7F—fRÇ6VC¢BæfF"æ6×ç6VBÇ76W3¤Bç76W2ç7FG2Æ7F—fS¥õ÷7GVF–ô6†V6²æ7F—fRç6—¦RÇvVF†W#¤BçvVF†W"ç7FFRæW‡FW&–÷"ÇG&–vvW#¤BæfF"çvVöâçG&–vvW$†VÆBÇ&ö¦V7F–ÆW3¤"æ7&Wrç7FG2‚’ç&ö¦V7F–ÆW2Ç&öö×3¤Bæ–çFW&–÷'2ç&öö×2ç6—¦RÆFöÓ¦Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"æG6"×76W2"’æÆVæwF‚Ç&V6÷&G3¤"ç&VæFW&W"ç7FG2ç&V6÷&G7Ó·Ò’‚–“°¢&V6÷&B‚%7GVF–ó¢W†—B"¶7–6ÆR²"F—7÷6W2Æ–&6²Â6VBÂ&ö¦V7F–ÆW2æB&W7F÷&W2W‡FW&–÷""ÂVæBæ–æFö÷"bbVæBç6VBbfVæBç76W2æÖVF–ÓÓÓbfVæBç76W2æ66†VCÓÓÓbfVæBæ7F—fSÓÓÓbfVæBçvVF†W"bbVæBçG&–vvW"bfVæBç&ö¦V7F–ÆW3ÓÓÓbfVæBæFöÓÓÓÓÄ¥4ôâç7G&–æv–g’†VæB’“°¢–b†7–6ÆSÓÓÓ–&6VÆ–æSÖVæC¶VÇ6R–b†7–6ÆSÓÓÓ"—&V6÷&B‚%7GVF–ó¢v&ÖVB&ööÒ&V6÷&G2&VÖ–â&÷VæFVB"ÆVæBç&V6÷&G3ÃÖ&6VÆ–æRç&V6÷&G2Ä¥4ôâç7G&–æv–g’‡¶&6VÆ–æRÆVæGÒ’“°¢Ð¢&V6÷&B‚%7GVF–ó¢&WVFVB7–6ÆW2&WF–âöæRÆ—7FVæW"6WB"Æv—BÆ—7FVæW'2‚“ÓÓ×7F'DÆ—7FVæW'2“°¢6öç7B6VG3Öv—B"æWfÇVFR†‚‚“Óç¶6öç7B#ÕõööövÅ#Ô"æG6"æ–çFW&–÷'2ç&öö×2ævWB‚&G6"×7GVF–ò"“·&WGW&â"ç6VG2æWfW'’‡3Óâ2ç6—GFW"“·Ò’‚–“·&V6÷&B‚%7GVF–ó¢WfW'’6VB&VÆV6W2ö67Wæ7’"Ç6VG2“°¢v—B"æWfÇVFR‚wv–æF÷ræfWF6ƒÕõ÷7GVF–ô6†V6²æfWF6ƒ´…DÔÄÖVF–VÆVÖVçBç&÷F÷G—RçÆ“Õõ÷7GVF–ô6†V6²çÆ“´…DÔÄÖVF–VÆVÖVçBç&÷F÷G—RçW6SÕõ÷7GVF–ô6†V6²çW6Sµõ÷7GVF–ô6†V6²æöÆCÕõööövæG6"ç76W3µõööövævò‚&&–g&÷7B"ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR“µõööövævò‚&G6""ÆçVÆÂÇG'VR“µõööövæGfæ6R‚ãR’r“°¢6öç7Bg&W6ƒÖv—B"æWfÇVFR‚r‡¶öÆC¥õ÷7GVF–ô6†V6²æöÆBç7FG2ÆF–Æöw3¦Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"æG6"×76W2"’æÆVæwF‚Ç&öö×3¥õööövæG6"æ–çFW&–÷'2ç&öö×2ç6—¦RÇ6VC¢õööövæG6"æfF"æ6×ç6VGÒ’r“°¢&V6÷&B‚%7GVF–ó¢ÆVf–ærE4"æB&VVçFW&–ær7&VFW2öæR6ÆVâ&6†—fR6öçG&öÆÆW""Âg&W6‚æöÆBæ7F—fRbfg&W6‚æöÆBæÖVF–ÓÓÓbfg&W6‚æF–Æöw3ÓÓÓbfg&W6‚ç&öö×3ÓÓÓbbg&W6‚ç6VBÄ¥4ôâç7G&–æv–g’†g&W6‚’“°¢v—B"æWfÇVFR‚vFVÆWFRv–æF÷råõ÷7GVF–ô6†V6²r“°§×Ó°§66VæR‚&G6""Ç¶Æ&VÃ¢'7GVF–ò6†V6·ö–çB"ÇVW'“¢"gf–Ws×7GVF–òÖFö÷"gvVF†W#×7F÷&ÒgF–ÖSÓ#"Ç7FW3¥¶G6%7GVF–ô6†V6·ö–çE×Ò“°§66VæR‚&G6""Ç¶Æ&VÃ¢'7GVF–ò6†V6·ö–çB†öæR"ÇVW'“¢"gf–Ws×7GVF–òÖFö÷"gvVF†W#×7F÷&ÒgF–ÖSÓ#"Æ÷G3§·s£3“Æƒ£ƒCBÆÖö&–ÆS§G'VWÒÇ7FW3¥¶G6%7GVF–ô6†V6·ö–çE×Ò“° ¦6öç7B'VåF6·2Ò7–æ2‚’Óâ°¢6öç7B–6¶VBÒF6·2æf–ÇFW"‚‡B’Óâ‡BçW&bòU$b¢”4´TBæ–æ6ÇVFW2‡Bç66VæR’’“°¢–b„ôäÅ’bb…”4´TBæÆVæwF‚ÇÂU$b’bb–6¶VBæÆVæwF‚’F‡&÷ræWrW'&÷"†æò&WVW7FVB66VæR6†V6·2ÖF6‚ôäÅ“ÒG´ôäÅ—Ö“°¢òòF†RW&bfÆö÷"'Vç2f—'7BæBÆöæRÂ6òæò÷F†W"6‡&öÖR6¶Ww2—G2g&ÖRF–Ö–ærà¢&VÅF–ÖUF6²ÒG'VS°¢f÷"†6öç7BBöb–6¶VBæf–ÇFW"‚‡B’ÓâBçW&b’’v—BBç'Vâ‚“°¢&VÅF–ÖUF6²ÒfÇ6S°¢6öç7BVWVRÒ–6¶VBæf–ÇFW"‚‡B’ÓâBçW&b“°¢6öç7BÆæRÒ7–æ2‚’Óâ°¢v†–ÆR‡VWVRæÆVæwF‚’v—BVWVRç6†–gB‚’ç'Vâ‚“°¢Ó°¢v—B&öÖ—6RæÆÂ„'&’æg&öÒ‡²ÆVæwFƒ¢ÄäU2ÒÂÆæR’“°¢v—BF—7÷6R‚“°§Ó°¦–b‚”4´TBæÆVæwF‚bbU$b’6öç6öÆRæÆör†vÆö&ÂF–W"öæÇ’âæÖR66VæW2FòFW7BF†VÒFöó¢çÒFW7BÒÒGµ44TäU2æ¦ö–â‚""—ÒÂgVÆÆ“°¦v—B'VåF6·2‚“°¢òòF†R6†–Ò–ç7FÆÇ2'&÷w6W"vÆö&Ç2–âF†—2&ö6W72Â6ò—B'Vç2gFW"F†R'&÷w6W"ÆæW2f–æ—6‚v—F‚6‡&öÖRà¦–b…Tä•B’v—BVæ—D6†V6·2‚“°¦–b…$õDô4ôÂ’v—Bö¶W%&÷Fö6öÄ6†V6·2‚“° ¢òòF†RÆVFvW"—2F†RÖVÖ÷'’6W76–öâFöW2æ÷B†fS¢WfW'’f–Æ–ær6†V6²Â†÷rÖç’'Vç2–â&÷r—B†0¢òòf–ÆVBÂ6–æ6Rv†VâÂæB—G2Æ7BFWF–Ã²726ÆV'2—BâGvòf–ÆVB'Vç2–â&÷r—25Dõà¦6öç7BÄTDtU"Ò¦ö–â‡&ö÷BÂ'VçG&6¶VB"Â'FW7BÖÆVFvW"æ§6öâ"“°¦ÆWBÆVFvW"Ò·Ó°§G'’°¢ÆVFvW"Ò¥4ôâç'6R‡&VDf–ÆU7–æ2„ÄTDtU"Â'WFc‚"’“°§Ò6F6‚°¢òòæòÆVFvW"–WBà§Ð¦6öç7Bæ÷rÒæWrFFR‚’çFô•4õ7G&–ær‚“°¦f÷"†6öç7B"öb&W7VÇG2’°¢–b‡"æö²ÇÂ"æ÷Vâ’FVÆWFRÆVFvW%·"ææÖUÓ°¢VÇ6RÆVFvW%·"ææÖUÒÒ²7G&V³¢†ÆVFvW%·"ææÖUÓòç7G&V²ÇÂ’²Âf—'7C¢ÆVFvW%·"ææÖUÓòæf—'7BÇÂæ÷rÂÆ7C¢æ÷rÂFWF–Ã¢"æFWF–Âç6Æ–6RƒÂc’Ó°§Ð¦Ö¶F—%7–æ2†F—&æÖR„ÄTDtU"’Â²&V7W'6—fS¢G'VRÒ“°§w&—FTf–ÆU7–æ2„ÄTDtU"Â¥4ôâç7G&–æv–g’†ÆVFvW"ÂçVÆÂÂ’²%Æâ"“° ¦6öç7Bf–ÆVBÒ&W7VÇG2æf–ÇFW"‚‡"’Óâ"æö²bb"æ÷Vâ’Â÷VâÒ&W7VÇG2æf–ÇFW"‚‡"’Óâ"æ÷Vâ“°¦–b‡&WG&–VBæÆVæwF‚’6öç6öÆRæÆör†ÆâG·&WG&–VBæÆVæwF‡Ò6W76–öâG·&WG&–VBæÆVæwF‚ÓÓÒò""¢'2'Ò&WG&–VBgFW"â–æg&7G'V7GW&RW'&÷#¥ÆâG·&WG&–VBæÖ‚‡"’ÓâG·'Ö’æ¦ö–â‚%Æâ"—Ö“°¦6öç6öÆRæÆör†ÆâG·&W7VÇG2æÆVæwF‚Òf–ÆVBæÆVæwF‚Ò÷VâæÆVæwF‡ÒòG·&W7VÇG2æÆVæwF‡Ò6†V6·276VBG¶÷VâæÆVæwF‚òÂG¶÷VâæÆVæwF‡Ò¶æ÷vâ÷Væ¢"'Ò–âG²‡W&f÷&Öæ6Rææ÷r‚’òc’çFôf—†VBƒ—ÒÖ–æ“°¦6öç7B7GV6²Òf–ÆVBæf–ÇFW"‚‡"’ÓâÆVFvW%·"ææÖUÒç7G&V²ãÒ"“°¦–b‡7GV6²æÆVæwF‚’6öç6öÆRæÆör†Æå5Dõ+rF†W6Rf–ÆVBG·7GV6²æÆVæwF‚ÓÓÒò'F†—2'VâæBF†RÆ7B"¢&–â6öç6V7WF—fR'Vç2'Ó²Fòæ÷BG'’æ÷F†W"f—‚Â†æBF†VÒFòF†RÖ–çF–æW"v—F‚VçG&6¶VB÷FW7BÖÆVFvW"æ§6öã¥ÆâG·7GV6²æÖ‚‡"’ÓâG·"ææÖWÒ‚G¶ÆVFvW%·"ææÖUÒç7G&V·Ò'Vç26–æ6RG¶ÆVFvW%·"ææÖUÒæf—'7GÒ–’æ¦ö–â‚%Æâ"—Ö“°§&ö6W72æW†—B†f–ÆVBæÆVæwF‚ò¢“° 