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
      ["🐺", "f5076a19df9166337f0d9648f07952eda8eed875d691b5c7d19bcbd6149f9bc2"],
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
  const line = ok && !VERBOSE ? null : `${ok ? "PASS" : open ? "OPEN" : "FAIL"} ${name}${open ? ` · known: ${run.open}` : ""}${detail ? " · " + detail : ""}`;
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
  for (;;) {
    let ready = false;
    try {
      ready = await b.evaluate(`!!window.__ooga && window.__ooga.renderedFrames >= 2 && !document.getElementById("curtain")`);
    } catch (err) {
      if (err.driver) throw err;
      // The old document is still tearing down.
    }
    if (ready) break;
    if (Date.now() - t0 > 20000) throw driverError("the page did not draw its first frame");
    await b.sleep(40);
  }
  // Entering pops the seven cavemen in on tweens, so a drawn scene is not a settled one.
  // Wait for tweenCount() === 0, not the shortened 0.9 s leaf-curtain transition.
  await b.evaluate(`new Promise((resolve) => { const t0 = performance.now(); const tick = () => { if (window.BL.scene.tweenCount() === 0 || performance.now() - t0 > 4000) resolve(); else requestAnimationFrame(tick); }; tick(); })`);
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
    // Install before scripts/boot: observe every DSB runtime factory and prohibit live requests.
    if (steps.some(([name]) => name.startsWith("Ooga Portal"))) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
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
        const noise = b.logs.slice(from).filter((l) => !l.includes("WebGL2 renderer failed"));
        record(`${name}: clean console`, noise.length === 0, `${((Date.now() - started) / 1000).toFixed(1)}s ${noise.join(" | ").slice(0, 1600)}`);
      } catch (err) {
        if (overran) err = driverError(`the session passed ${SESSION_MS / 1000} s and its Chrome was killed`);
        if (err.driver && !final && run.results.every((r) => r.ok)) {
          run.retry = `${name} · ${failure(err)}`;
          break;
        }
        record(name, false, failure(err));
        if (overran) break;
      }
    }
  } catch (err) {
    if (overran) err = driverError(`the session passed ${SESSION_MS / 1000} s and its Chrome was killed`);
    if (err.driver && !final && run.results.every((r) => r.ok)) run.retry = `${steps[0][0]} · ${failure(err)}`;
    else record(steps[0][0], false, failure(err));
  } finally {
    clearTimeout(watchdog);
    if (b && !overran) b.close();
    const s = (ms) => (ms / 1000).toFixed(1);
    if (VERBOSE) lines.push(`TIME ${steps.map((step) => step[0]).join(" + ")} · launch ${s(started - t0)}s · boot ${s(ready - started)}s · body ${s(Date.now() - ready)}s`);
  }
  return run;
});
// Only driver errors retry, once, on a fresh Chrome, and only before any assertion has failed.
// So a retry can never hide a real failure; every retry is printed.
const fold = async (url, steps, opts = {}) => {
  let run = await session(url, steps, opts, false);
  if (run.retry) {
    retried.push(run.retry);
    console.log(`RETRY ${run.retry} · running the session again on a fresh Chrome`);
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
const orbitLog = `(() => { const O = window.__ooga.orbit, rows = [...document.querySelectorAll("#orbit-score li")].map((li) => [li.children[0].textContent, li.children[1].textContent]); const points = rows.filter(([label]) => label !== "Time").reduce((sum, [, value]) => sum + value.split(" · ").reduce((row, part, i) => { const times = part.match(/^(\\d+) × (\\d+)$/), named = i > 0 && part.match(/^(?:[a-z-]+ )?(\\d+)$/); return row + (times ? times[1] * times[2] : named ? +named[1] : 0); }, 0), 0); return { phase: O.phase, shown: !document.getElementById("orbit-results").hidden, rows, points, final: +document.getElementById("orbit-final-score").textContent, best: document.getElementById("orbit-final-best").textContent, medal: document.getElementById("orbit-final-medal").hidden ? null : document.getElementById("orbit-final-medal").textContent, summary: document.getElementById("orbit-summary").textContent, result: O.result, exit: document.querySelector('#orbit-results [data-action="leave"]').textContent }; })()`;
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
for (const a of ARGS) if (!SCENES.includes(a) && !["unit", "perf", "full", "poker-protocol"].includes(a)) throw new Error(`Unknown argument "${a}" (unit | perf | full | poker-protocol | ${SCENES.join(" | ")})`);
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
  for (const s of steps) if (!WHY.test(s.why || "")) throw new Error(`${id}: step "${s.name}" must say why it exists: "regression: …", "playthrough: …", "rule: …" or "contract: …"`);
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
  // sets must genuinely differ between repos — identical org-wide copies
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
const sceneUrl = (id, query = "") => `${src}?debug=1&nosim=1${id === "hub" ? "" : `&scene=${id}`}${clock(query)}`;
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
  const before = await b.evaluate(`(() => { const clock = document.getElementById("world-clock"), label = clock.getAttribute("aria-label"), text = label.replace(/^Ooga Booga time /, ""), cells = [...text].reduce((sum, ch) => sum + (ch === " " ? 2 : 4), -1), zone = (new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value || "UTC").toUpperCase().replaceAll("−", "-"); return { height: document.getElementById("world-block-height").textContent, bananas: !!document.getElementById("world-banana-count"), label, text, zone, cells, viewWidth: clock.querySelector("svg").viewBox.baseVal.width, cssWidth: parseFloat(clock.style.width) }; })()`);
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
  const orgBoards = ["commits", "prs", "reviews", "comments", "issues"].map((t) => "org · " + t);
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
      let last = before, mixStep = 0, fadeStep = 0, cutStep = 0, fadeError = 0, capError = 0, minCut = Infinity, maxCut = -Infinity, changed = 0, direction = true, blended = 0, withoutPlayer = 0;
      let rockError = Math.abs(before.rock - before.fade), maxRegions = 0;
      for (let i = 0; i < frames; i++) {
        B.advance(1 / 60, 1 / 60); const s = cutState(); mixStep = Math.max(mixStep, Math.abs(s.mix - last.mix)); fadeError = Math.max(fadeError, Math.abs(s.fade - s.mix));
        fadeStep = Math.max(fadeStep, Math.abs(s.fade - last.fade));
        rockError = Math.max(rockError, Math.abs(s.rock - s.fade));
        maxRegions = Math.max(maxRegions, B.renderOpts.cutawayRegionCount);
        if (s.fade > 0 && s.fade < 1) blended++;
        if (!s.player && s.fade > 0) withoutPlayer++;
        if (s.cuts.length) { minCut = Math.min(minCut, ...s.cuts); maxCut = Math.max(maxCut, ...s.cuts); }
        // The disabled 1e6 sentinel lies above all rock. Only compare real
        // slicing planes while both samples have an active cutaway.
        if (s.fade > 0 && last.fade > 0 && s.cuts.length === last.cuts.length) for (let j = 0; j < s.cuts.length; j++) {
          const delta = s.cuts[j] - last.cuts[j]; cutStep = Math.max(cutStep, Math.abs(delta));
          direction = direction && delta * (s.fade - last.fade) <= 1e-6;
          if (!j && Math.abs(delta) > 1e-5) changed++;
        }
        if (B.renderOpts.cutawayMaxY < 1e5) for (const e of D.terrainSections) if (e.cap.node.visible) capError = Math.max(capError, Math.abs(e.cap.node.world[13] + 0.002 - B.renderOpts.cutawayMaxY));
        last = s;
      }
      return { name, before, after: last, immediate, immediateFade, mixStep, fadeStep, cutStep, fadeError, rockError, capError, span: maxCut - minCut, changed, direction, blended, withoutPlayer, maxRegions };
    };
    const toggle = () => P.modeAction("mode-toggle"), transitions = [];
    transitions.push(transition("basement carry exit", toggle));
    transitions.push(transition("basement partial entry", toggle, 12));
    transitions.push(transition("basement entry reversal", toggle));
    transitions.push(transition("basement carry entry", toggle));
    transitions.push(transition("basement shoulder exit", () => P.hooks.onZoom(0.001), 150));
    transitions.push(transition("basement shoulder entry", () => P.hooks.onZoom(1.2)));
    toggle(); B.advance(1, 1 / 60);
    P.hooks.onZoom(0.001); B.advance(1, 1 / 60);
    const carryRoofs = { out: true, in: true, settled: false, hiddenMarkers: true };
    P.hooks.onZoom(1.2);
    for (let i = 0; i < 60; i++) {
      B.advance(1 / 60, 1 / 60);
      carryRoofs.out = carryRoofs.out && P.mode === "orbit" && B.renderOpts.cutawayFade === 1
        && B.renderOpts.cutawayMaxY < H.ceiling - 0.5;
      carryRoofs.hiddenMarkers = carryRoofs.hiddenMarkers && D.headquarters.rampMarkers.every(marker => !marker.node.visible);
    }
    P.hooks.onZoom(0.99);
    for (let i = 0; i < 120 && P.shoulderEntryMix < 1; i++) {
      B.advance(1 / 60, 1 / 60);
      carryRoofs.in = carryRoofs.in && P.mode === "shoulder" && B.renderOpts.cutawayFade === 1
        && B.renderOpts.cutawayMaxY < H.ceiling - 0.5;
    }
    B.advance(1, 1 / 60);
    carryRoofs.settled = P.mode === "shoulder" && P.shoulderEntryMix === 1 && B.renderOpts.cutawayFade === 0;
    toggle(); P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
    const cave = places.find(q => q.name === "cave");
    P.navigate({ position: { x: cave.x, y: cave.floor, z: cave.z }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(2, 1 / 60);
    transitions.push(transition("cave roof exit", toggle));
    transitions.push(transition("cave roof entry", toggle));
    const basement = { position: { x: lower.x, y: H.basement.floor, z: lower.z }, yaw: 0, pitch: 0.3, dist: 8 };
    P.navigate(basement); B.advance(2, 1 / 60);
    const released = transition("basement actor release", () => P.release(true));
    P.possess(a); if (B.crew.sleeping) B.crew.wakePlayer(); P.navigate(basement); B.advance(0.7, 1 / 60);
    if (!P.aiming) P.modeAction("mode-toggle"); if (P.mode === "shoulder") P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
    const restored = P.player === a && P.mode === "birds-eye" && P.birdsEyeMix === 1 && Math.abs(a.root.position.y - a.baseY - H.basement.floor) < 0.2;
    const landmarks = [B.altar.node.position, B.headquarters.firepit.position, H.basement.hole].map(p => [p.x, p.z]);
    const clouds = [], weather = [];
    const visit = n => { if (n.geometry?.cutawayPreserve) clouds.push(n); if (n.geometry?.cutawayHide) weather.push(n); for (const child of n.children) visit(child); };
    visit(BL.scenes.hub.root);
    const immutable = I.geometry === geometry && I.geometry.verts === verts && verts.every((v, i) => v === originalVerts[i]) && source.data === data && data.every((v, i) => v === originalData[i]);
    const cache = entries.map(e => ({ ...e.cap.stats }));
    return { rows, thresholds, rampTravel, pathTravel, landingCoverage, coverFade, initialSpans, birdseyeWindows, mouthRims, rampEntranceFrame, rampMarkers, markerViews, markerCoverage, rampVines, rampWindowCells, rampWindowFaces, rampWindowBaseFaces, rampWindowCrossingFaces, rampWindowFacesPreserved, rampWindowFaceOwnership,
      overlapCells, overlapOwnership, retainedFloors, floorsPreserved, noRampRegions: !D.rampSections,
      flight, transitions, carryRoofs, released, restored, immutable, landmarks, cache, regionStorage: regions === B.renderOpts.cutawayRegions, sections: D.terrainSections.length, caves: D.caveSections.length, clouds: clouds.length, weather: weather.length, weatherPreserved: weather.every(n => n.geometry.cutawayPreserve) };
  })()`);
  const rows = state.rows, underground = rows.filter(r => r.requestedFloor < -0.15), surface = rows.filter(r => r.requestedFloor >= -0.15);
  record("birds-eye combat: surface and hills retain their terrain, caves use local roof cuts, and HQ and basement use the current floor's global section", rows.length === 5 && rows.every(r => r.mode === "birds-eye" && r.overhead && r.horizontal < 1e-6 && Math.abs(r.floor - r.requestedFloor) < 0.2 && r.unchanged)
    && underground.length === 2 && underground.every(r => r.cutoff > r.floor + 1.3 && r.cutoff < r.floor + 5 && Math.abs(r.cutoff - r.floorCeiling + 0.06) < 0.01 && !r.caveRegions.length && !r.caveCaps && r.caps[0].visible && r.caps[0].faces > 0)
    && surface.every(r => r.cutoff >= 1e5 && r.caps.every(c => !c.visible) && r.caveRegions.every(region => Math.abs(region.y - 2.85) < 1e-6))
    && surface.find(r => r.name === "cave").caveRegions.length > 0 && surface.find(r => r.name === "hill").regions.length === 0, JSON.stringify(rows));
  record("birds-eye combat: surface ramps keep their authored entrance span and basement openings initially extend one ramp-width", state.initialSpans.length === 4
    && state.initialSpans.every(p => Math.abs(p.span - p.expected) <= p.tolerance)
    && rows.every(r => r.paths.length === 4 && r.paths.every(p => p.hi >= p.initial))
    && rows.find(r => r.name === "surface").paths.slice(0, 2).every(p => p.mix === 1 && p.lo === 1)
    && rows.find(r => r.name === "hill").paths.every(p => p.mix === 0), JSON.stringify({ spans: state.initialSpans, paths: rows.map(r => ({ name: r.name, paths: r.paths })) }));
  record("birds-eye combat: every authored room window removes only its level's fitted lintel rock", state.birdseyeWindows.length > 0
    && state.birdseyeWindows.every(window => window.columns > 0 && window.level === (window.basement ? 1 : 0))
    && rows.find(r => r.name === "surface").windowMix.every(mix => mix === 0)
    && rows.find(r => r.name === "HQ").windowMix.join() === "1,0"
    && rows.find(r => r.name === "basement").windowMix.join() === "1,1"
    && rows.find(r => r.name === "HQ").roof.windowRoofFaces.every(faces => faces > 0), JSON.stringify({ windows: state.birdseyeWindows,
      levels: rows.map(({ name, windowMix }) => ({ name, windowMix })), faces: rows.find(r => r.name === "HQ").roof.windowRoofFaces }));
  record("birds-eye combat: surface ramp mouths omit only the overhead stone lintel while ordinary cave frames retain it", state.mouthRims.expectedRamp === 2
    && state.mouthRims.ramp === state.mouthRims.expectedRamp && state.mouthRims.standard > 0 && state.mouthRims.sameOpening
    && Math.abs(state.mouthRims.standardTop - 3.5) < 1e-7 && Math.abs(state.mouthRims.rampTop - 3) < 1e-7
    && state.rampEntranceFrame.rampLintels === 0 && state.rampEntranceFrame.roomLintels > 0, JSON.stringify({ mouths: state.mouthRims, basement: state.rampEntranceFrame }));
  record("birds-eye combat: each downhill ramp has a dense entrance label and a separate arrow fitted to its surface, hidden outside bird's-eye view", state.rampMarkers.length === 4
    && state.rampMarkers.map(marker => marker.channel).join() === "0,1,2,3"
    && state.rampMarkers.map(marker => marker.label).join() === "HQ,HQ,B1,B1"
    && state.rampMarkers.every(marker => marker.visible && marker.arrowVisible && marker.model === marker.label && marker.markerKind === "label" && marker.arrowKind === "arrow"
      && marker.visual === marker.label && marker.columns === 5 && marker.rows === 7 && marker.scale === 0.72
      && marker.labelDistance > 0 && marker.arrowDistance > marker.labelDistance && marker.labelSurfaceError < 1e-7
      && marker.arrowSurfaceError < 1e-7 && marker.aligned > 0.999 && marker.arrowAligned > 0.999)
    && state.rampVines === 0
    && [0, 2, 4, 6].every(i => state.transitions[i].after.markers === 0)
    && [3, 5, 7].every(i => state.transitions[i].after.markers === 4)
    && state.released.after.markers === 0 && state.restored, JSON.stringify({ markers: state.rampMarkers, transitions: state.transitions.map(({ name, after }) => ({ name, visible: after.markers })), released: state.released.after.markers }));
  record("birds-eye combat: HQ and B1 read upright left-to-right through a full camera turn and every entrance exposes its complete downhill arrow", state.markerViews.length === 32
    && state.markerViews.every(view => view.right > 0 && view.up > 0 && view.baseline < 0.001)
    && state.markerCoverage.length === 4 && state.markerCoverage.every(marker => marker.checked > 0 && marker.covered === 0), JSON.stringify({ views: state.markerViews, coverage: state.markerCoverage }));
  record("birds-eye combat: ramp openings use original terrain faces and exact vertical voxel walls, never clipping rectangles or proxy floors", state.noRampRegions
    && rows.every(r => r.regions.length <= 8 && r.regions.every(region => r.caveRegions.some(cave => cave.id === region.id)) && r.roof.partition && r.roof.voxelWalls && r.roof.removable > 0)
    && rows.some(r => r.roof.walls > 0) && state.pathTravel.every(r => r.roof.partition && r.roof.voxelWalls), JSON.stringify(rows.map(({ name, roof, regions }) => ({ name, roof, regions }))));
  record("birds-eye combat: ramp-window cutaway columns extend beyond the raw ramp, keep their authored route station, and retain real window fragments in the terrain base", state.rampWindowCells.length > 0
    && state.rampWindowCells.every(cell => cell.owners === 1 && cell.channelCorrect)
    && state.rampWindowFaces > 0 && state.rampWindowCrossingFaces > 0 && state.rampWindowBaseFaces > 0
    && state.rampWindowFacesPreserved && state.rampWindowFaceOwnership && state.pathTravel.every(r => r.windowActive), JSON.stringify({ cells: state.rampWindowCells, faces: state.rampWindowFaces,
      base: state.rampWindowBaseFaces, crossing: state.rampWindowCrossingFaces, preserved: state.rampWindowFacesPreserved, ownership: state.rampWindowFaceOwnership, travel: state.pathTravel.map(r => ({ channel: r.channel, active: r.windowActive })) }));
  record("birds-eye combat: descending either route never shortens its opening and retains as much path ahead as behind until the route ends", state.pathTravel.length === 4
    && state.pathTravel.every(r => r.backwards === 0 && r.minimum >= 0 && r.matched > 30 && r.balanced > 10 && r.balance >= -1.001 && r.end === 255), JSON.stringify(state.pathTravel));
  record("birds-eye combat: the HQ landing keeps identical completed ramp coverage inside and just outside the travel detector", state.landingCoverage.length === 2
    && state.landingCoverage.every(row => row.hi[0] === 255 && row.hi[1] === 255)
    && JSON.stringify(state.landingCoverage[0]) === JSON.stringify(state.landingCoverage[1]), JSON.stringify(state.landingCoverage));
  record("birds-eye combat: hill and jet-height cave roofs share the ramp cover's smooth opacity timing", state.coverFade.out.some(row => row.path > 0 && row.path < 1)
    && state.coverFade.in.some(row => row.path > 0 && row.path < 1)
    && state.coverFade.out.every((row, i, rows) => Math.abs(row.path - row.cave) < 1e-6 && (!i || row.path <= rows[i - 1].path + 1e-7))
    && state.coverFade.in.every((row, i, rows) => Math.abs(row.path - row.cave) < 1e-6 && (!i || row.path >= rows[i - 1].path - 1e-7)), JSON.stringify(state.coverFade));
  record("birds-eye combat: overlapping ramp cells belong to the upper path and retained voxel floors stay in the immutable terrain base", state.overlapCells > 0 && state.overlapOwnership
    && state.retainedFloors > 0 && state.floorsPreserved, JSON.stringify({ overlaps: state.overlapCells, ownership: state.overlapOwnership, retained: state.retainedFloors, preserved: state.floorsPreserved }));
  record("birds-eye combat: both ramp connections retain the source floor early, progressively remove it across the ramp and reach the destination before exit in either direction", state.rampTravel.length === 4 && state.rampTravel.every(r =>
    Math.abs(r.early.y - (r.down ? r.upper : r.lower)) < 0.02 && Math.abs(r.late.y - (r.down ? r.lower : r.upper)) < 0.02
    && r.middle.y > r.lower + (r.upper - r.lower) * 0.1 && r.middle.y < r.upper - (r.upper - r.lower) * 0.1
    && r.positionError < 0.2 && r.maxRegions <= 8 && r.moving > 15), JSON.stringify(state.rampTravel));
  record("birds-eye combat: stopping with small ramp-height noise holds the cut, while reversing smoothly restores the source floor", state.rampTravel.every(r =>
    r.stopDrift < 0.01 && r.maxStep <= 1 && Math.abs(r.reversed.y - r.early.y) < 0.02), JSON.stringify(state.rampTravel));
  record("birds-eye combat: upcoming ramp paths retain their minimum span while upper floors reveal progressively in either direction", state.rampTravel.every(r =>
    r.minimumSpan && r.caveRegionsOnly && r.floorWindow > 0.6 && r.floorWindow < 0.82 && Math.abs(r.floorCenter - 0.5) < 0.04), JSON.stringify(state.rampTravel));
  record("birds-eye combat: basement entrances open at HQ while the remaining route stays covered until descent", rows.filter(r => r.name !== "HQ" && r.name !== "basement").every(r => r.paths.slice(2).every(p => p.mix === 0))
    && rows.find(r => r.name === "HQ").paths.slice(2).every(p => p.mix === 1 && p.hi === p.initial)
    && rows.find(r => r.name === "basement").paths.slice(2).some(p => p.mix > 0)
    && state.rampTravel.filter(r => r.name === "main-HQ").every(r => r.lowerRevealFrames === 0 && r.lowerRevealGuard)
    && state.rampTravel.every(r => r.lowerFloorsOrdered)
    && state.rampTravel.filter(r => r.name === "HQ-basement").every(r => r.lowerRevealGuard && r.lowerRevealFrames > 0 && r.lowerMixMax === 1 && r.lowerActorRoofChecks > 0 && r.lowerActorRoofCovered === 0), JSON.stringify({ rows: rows.map(r => ({ name: r.name, lower: r.paths.slice(2) })),
      travel: state.rampTravel.map(({ name, down, lowerMixMax, lowerRevealFrames, lowerRevealGuard, lowerActorRoofChecks, lowerActorRoofCovered }) => ({ name, down, lowerMixMax, lowerRevealFrames, lowerRevealGuard, lowerActorRoofChecks, lowerActorRoofCovered })) }));
  record("birds-eye combat: the upper-floor scan hides sliced actors, gorillas and barrels as whole units without hiding structural rooms or entrances", state.rampTravel.every(r =>
    !r.slicedVisible && r.visibleFrames > 0 && r.wholeHidden > 0 && r.wholeBarrels > 0 && r.wholeGorillas > 0 && r.wholeComplete && !r.structureHidden), JSON.stringify(state.rampTravel));
  record("birds-eye combat: jetting above the surface restores ramp cover and the following fall keeps the actor centered with head clearance", state.flight.peak > 4 && state.flight.highFrames > 10
    && state.flight.fallFrames > 10 && state.flight.clearance >= 0.075 && state.flight.preserved && state.flight.centered && state.flight.landed, JSON.stringify(state.flight));
  record("birds-eye combat: inward zoom switches at relative height 21 with the same head clearance on the surface, hills, HQ and basement", state.thresholds.length === 4
    && state.thresholds.every(r => r.above.mode === "birds-eye" && r.above.relative > 21.2 && r.switched.mode === "shoulder" && r.switched.relative >= 20.99 && r.switched.relative <= 21.09 && r.frames < 150)
    && Math.max(...state.thresholds.map(r => r.switched.headClearance)) - Math.min(...state.thresholds.map(r => r.switched.headClearance)) < 0.05, JSON.stringify(state.thresholds));
  record("birds-eye combat: zoom leaves section meshes cached, translated islands share the exact world cut height, and terrain and centered landmarks stay unchanged", state.immutable && state.regionStorage && state.sections >= 2 && state.caves > 0 && state.caves <= 8
    && rows.every(r => r.zoomStable && r.zoomMoved && r.caps.every(c => !c.visible || Math.abs(c.y + 0.002 - r.cutoff) < 1e-5))
    && underground.some(r => r.caps.slice(1).some(c => c.visible && c.faces > 0))
    && state.cache.every(c => c.cacheEntries <= 16) && state.cache.some(c => c.cacheEntries === 16)
    && state.landmarks.length === 3 && state.landmarks.every(p => p[0] === 0 && p[1] === 0) && state.clouds > 0 && state.weather > 0, JSON.stringify({ ...state, rows: rows.map(r => ({ name: r.name, zoomStable: r.zoomStable, zoomMoved: r.zoomMoved, caps: r.caps })) }));
  record("birds-eye combat: the pile, HQ hearth and basement center align on screen at every selected floor despite their different elevations", rows.every(r => r.orthoMix === 1 && r.centerError < 0.001), JSON.stringify(rows.map(({ name, centerError, orthoMix }) => ({ name, centerError, orthoMix }))));
  record("birds-eye combat: cave roofs, underground cuts and weather follow the full camera blend through carry and shoulder handoffs, including reversal without a reset", state.transitions.length === 8
    && state.transitions.every(r => r.immediate < 1e-6 && r.mixStep < 0.08 && r.cutStep < 5 && r.rockError < 1e-6 && r.capError < 1e-5 && r.maxRegions <= 8)
    && state.transitions.slice(0, 4).every(r => r.after.fade === 1 && r.after.cuts.length > 0)
    && state.transitions.slice(4).every(r => r.fadeError < 1e-6 && r.span > 1 && r.changed >= 10 && r.direction && r.blended >= 10)
    && state.transitions[1].after.mix > 0 && state.transitions[1].after.mix < 1
    && state.transitions[2].before.mix === state.transitions[1].after.mix
    && [0, 2].every(i => state.transitions[i].after.mix === 0 && state.transitions[i].after.fade === 1 && state.transitions[i].after.cuts.length > 0)
    && [4, 6].every(i => state.transitions[i].after.mix === 0 && state.transitions[i].after.fade === 0 && !state.transitions[i].after.cuts.length)
    && [3, 5, 7].every(i => state.transitions[i].after.mix === 1 && state.transitions[i].after.fade === 1 && state.transitions[i].after.cuts.length > 0)
    && state.transitions[4].after.mode === "shoulder" && state.transitions[5].after.mode === "birds-eye", JSON.stringify(state.transitions));
  record("carry orbit: upper floors stay hidden in both lower-level camera handoffs and return after shoulder settles", Object.values(state.carryRoofs).every(Boolean), JSON.stringify(state.carryRoofs));
  const released = state.released;
  record("birds-eye combat: releasing the actor completes a bounded weather fade and upward rock scan after the camera stops following", released.before.mix === 1 && released.before.fade === 1 && released.immediateFade < 1e-6
    && released.fadeStep < 0.08 && released.cutStep < 5 && released.capError < 1e-5 && released.span > 1 && released.changed >= 10 && released.direction && released.blended >= 10 && released.withoutPlayer >= 10
    && released.rockError < 1e-6
    && !released.after.player && released.after.mix === 0 && released.after.fade === 0 && !released.after.cuts.length && state.restored, JSON.stringify({ released, restored: state.restored }));
  const rendering = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, root = S.createNode(), floor = BL.models.box({ w: 40, h: 0.2, d: 40, color: "#00ff00" });
    // One greedy-meshed roof face crosses all four cut edges. Whole-face culling
    // and clipping only the rectangle's original vertices both fail this case.
    const roof = { verts: [-6, 0, -6, -6, 0, 6, 6, 0, 6, 6, 0, -6], faces: [{ i: [0, 1, 2, 3], color: [255, 0, 0] }], lines: [] };
    const top = S.createNode({ geometry: roof, position: { x: 0, y: 5, z: 0 } });
    const ground = S.createNode({ geometry: floor }); S.addChild(root, ground); S.addChild(root, top);
    const camera = S.createCamera({ far: 60 }); Object.assign(camera.position, { x: 0, y: 20, z: 0 }); Object.assign(camera.target, { x: 0, y: 0, z: 0 }); camera.up = { x: 0, y: 0, z: -1 };
    const canvas = document.createElement("canvas"); canvas.getContext("2d", { willReadFrequently: true });
    const fallback = BL.canvasRenderer.createRenderer(canvas, { width: 256, height: 256 }), rows = [];
    const region = { x: 0, z: 0, cos: Math.cos(Math.PI / 6), sin: Math.sin(Math.PI / 6), halfWidth: 1.5, halfDepth: 3, y: 2 };
    const second = { x: -3, z: 0, cos: Math.cos(-Math.PI / 5), sin: Math.sin(-Math.PI / 5), halfWidth: 1.2, halfDepth: 2, y: 2 };
    const regions = [region, second], original = JSON.stringify(roof), cloud = BL.hubModels.cloud(0);
    const points = [[0, 5, 0], [region.cos * 1.2 + region.sin * 2.4, 5, -region.sin * 1.2 + region.cos * 2.4], [1.4, 5, -2.8], [4.5, 5, 0], [-3, 5, 0]];
    const hidden = { ...roof, cutawayHide: true, cutawayPreserve: true }, base = { bloomStrength: 0, shadowStrength: 0, ambientFloor: 1, directStrength: 0 };
    let cloudPoint = null, cloudDistance = Infinity;
    for (const face of cloud.faces) {
      const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3, v = cloud.verts;
      const ny = (v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
      if (ny <= 0) continue;
      let x = 0, y = 0, z = 0;
      for (const i of face.i) { x += v[i * 3]; y += v[i * 3 + 1]; z += v[i * 3 + 2]; }
      x /= face.i.length; y /= face.i.length; z /= face.i.length;
      if (x * x + z * z < cloudDistance) { cloudDistance = x * x + z * z; cloudPoint = [x, y + 8, z]; }
    }
    try {
      for (const [renderer, element] of [[B.renderer, document.getElementById("scene")], [fallback, canvas]]) {
        const read = (opts, samples = points, area = 1) => {
          renderer.render(root, camera, { ...base, ...opts });
          return samples.map(point => {
            const projected = renderer.project(...point, {}), x = Math.floor(projected.x * element.width / renderer.size.width) - Math.floor(area / 2), y = Math.floor(projected.y * element.height / renderer.size.height) - Math.floor(area / 2);
            let pixels;
            if (renderer.kind !== "webgl2") pixels = element.getContext("2d").getImageData(x, y, area, area).data;
            else { const gl = element.getContext("webgl2"); pixels = new Uint8Array(area * area * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(x, element.height - area - y, area, area, gl.RGBA, gl.UNSIGNED_BYTE, pixels); }
            const average = [0, 0, 0, 0]; for (let i = 0; i < pixels.length; i++) average[i % 4] += pixels[i];
            return average.map(n => n / (area * area));
          });
        };
        const covered = read({}), revealed = read({ cutawayMaxY: 2 }), restored = read({});
        const selective = read({ cutawayRegions: regions, cutawayRegionCount: 1 }), both = read({ cutawayRegions: regions, cutawayRegionCount: 2 });
        region.y = 5; const coplanar = read({ cutawayRegions: regions, cutawayRegionCount: 1 }); region.y = 2;
        roof.cutawayPreserve = true;
        const preserved = read({ cutawayMaxY: 2, cutawayRegions: regions, cutawayRegionCount: 2 });
        roof.clipMaxY = 4; const ownMaximum = read({ cutawayMaxY: 2, cutawayRegions: regions, cutawayRegionCount: 2 }); delete roof.clipMaxY;
        roof.clipMinY = 6; const ownMinimum = read({ cutawayMaxY: 2, cutawayRegions: regions, cutawayRegionCount: 2 }); delete roof.clipMinY; delete roof.cutawayPreserve;
        top.geometry = hidden;
        const weatherBefore = read({}), weatherWorld = Array.from(top.world), weatherGeometry = JSON.stringify(hidden), weatherFade = [];
        // Average full ordered-coverage tiles: WebGL fades depth-writing
        // clouds by coverage, while Canvas blends the same visible fraction.
        for (const fade of [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]) weatherFade.push({ fade, pixel: read({ cutawayFade: fade, birdsEyeCutaway: true, cutawayMaxY: 2, cutawayRegions: regions, cutawayRegionCount: 2 }, [points[0]], 8)[0] });
        const weatherHidden = read({ birdsEyeCutaway: true }), weatherAfter = read({});
        const weatherUnchanged = top.visible && top.geometry === hidden && top.position.y === 5 && top.world.every((v, i) => v === weatherWorld[i]) && JSON.stringify(hidden) === weatherGeometry;
        top.geometry = cloud; top.position.y = 8;
        const cloudBefore = read({}, [cloudPoint])[0], cloudCut = read({ cutawayMaxY: 2, cutawayRegions: regions, cutawayRegionCount: 2, birdsEyeCutaway: true }, [cloudPoint])[0];
        const cloudWorld = Array.from(top.world), cloudPosition = { ...top.position };
        top.matrixCloud = true; ground.visible = false;
        camera.position.y = 4; camera.target.y = -5;
        const loweredPoint = [cloudPoint[0], cloudPoint[1] - 8, cloudPoint[2]];
        const cloudLowered = read({ cutawayCloudY: 0, cutawayCloudMix: 1 }, [loweredPoint])[0];
        const cloudWorldUnchanged = top.world.every((v, i) => v === cloudWorld[i]) && Object.keys(cloudPosition).every(k => top.position[k] === cloudPosition[k]);
        top.matrixCloud = false; top.position.y = 0;
        const cloudReference = read({}, [loweredPoint])[0];
        top.position.y = 8; top.matrixCloud = true; camera.position.y = 12;
        const middlePoint = [cloudPoint[0], cloudPoint[1] - 4, cloudPoint[2]];
        const cloudMiddle = read({ cutawayCloudY: 0, cutawayCloudMix: 0.5 }, [middlePoint])[0];
        top.matrixCloud = false; top.position.y = 4;
        const cloudMiddleReference = read({}, [middlePoint])[0];
        ground.visible = true; camera.position.y = 20; camera.target.y = 0;
        top.geometry = roof; top.position.y = 5;
        rows.push({ kind: renderer.kind, covered, revealed, restored, selective, both, coplanar, preserved, ownMaximum, ownMinimum,
          weatherBefore, weatherHidden, weatherAfter, weatherFade, weatherUnchanged, cloudBefore, cloudCut, cloudPreserved: cloud.cutawayPreserve,
          cloudLowered, cloudReference, cloudMiddle, cloudMiddleReference, cloudWorldUnchanged,
          visible: root.children.every(n => n.visible), immutable: JSON.stringify(roof) === original });
      }
    } finally { fallback.dispose(); for (const geometry of [floor, roof, hidden]) B.renderer.releaseGeometry(geometry); B.renderer.render(BL.scenes.hub.root, B.camera, B.renderOpts); }
    return rows;
  })()`);
  const red = p => p[0] > p[1] + 40, green = p => p[1] > p[0] + 40;
  record("birds-eye combat: WebGL2 and Canvas cut a large roof only inside rotated regions, retain both outside portions and coplanar faces, and restore the original mesh", rendering.length === 2 && rendering.some(r => r.kind === "webgl2") && rendering.some(r => r.kind === "canvas2d") && rendering.every(r => r.covered.every(red) && r.revealed.every(green) && r.restored.every(red)
    && r.selective.slice(0, 2).every(green) && r.selective.slice(2).every(red) && green(r.both[4]) && red(r.both[2]) && red(r.both[3]) && r.coplanar.every(red) && r.visible && r.immutable), JSON.stringify(rendering));
  record("birds-eye combat: preserved clouds survive local and global cuts, authored height limits still apply, and weather hides only during the render pass", rendering.every(r => r.preserved.every(red) && r.ownMaximum.every(green) && r.ownMinimum.every(green)
    && r.weatherBefore.every(red) && r.weatherHidden.every(green) && r.weatherAfter.every(red) && r.weatherUnchanged && r.cloudPreserved
    && r.cloudBefore[0] > 40 && r.cloudBefore[2] > 40 && r.cloudBefore.every((v, i) => Math.abs(v - r.cloudCut[i]) <= 1)), JSON.stringify(rendering.map(({ kind, preserved, ownMaximum, ownMinimum, weatherHidden, weatherUnchanged, cloudBefore, cloudCut }) => ({ kind, preserved, ownMaximum, ownMinimum, weatherHidden, weatherUnchanged, cloudBefore, cloudCut }))));
  record("birds-eye combat: WebGL2 and Canvas weather fade independently of rock cuts and reverse to the same coverage without mutating scene nodes or geometry", state.weatherPreserved && rendering.every(r => r.weatherUnchanged && red(r.weatherFade[0].pixel) && green(r.weatherFade[4].pixel)
    && r.weatherFade[2].pixel[0] > 20 && r.weatherFade[2].pixel[1] > 20
    && r.weatherFade.slice(1, 5).every((f, i) => f.pixel[0] < r.weatherFade[i].pixel[0] - 10 && f.pixel[1] > r.weatherFade[i].pixel[1] + 10)
    && r.weatherFade.slice(5).every((f, i) => f.pixel.every((v, channel) => Math.abs(v - r.weatherFade[3 - i].pixel[channel]) <= 1))), JSON.stringify({ weatherPreserved: state.weatherPreserved, renderers: rendering.map(({ kind, weatherFade, weatherUnchanged }) => ({ kind, weatherFade, weatherUnchanged })) }));
  record("birds-eye combat: low-floor clouds render below the camera with a continuous visual offset while their world transforms and physical positions remain unchanged", rendering.every(r => r.cloudWorldUnchanged && r.cloudLowered[0] > 40 && r.cloudLowered[2] > 40
    && r.cloudLowered.every((v, i) => Math.abs(v - r.cloudReference[i]) <= 1) && r.cloudMiddle.every((v, i) => Math.abs(v - r.cloudMiddleReference[i]) <= 1)), JSON.stringify(rendering.map(({ kind, cloudLowered, cloudReference, cloudMiddle, cloudMiddleReference, cloudWorldUnchanged }) => ({ kind, cloudLowered, cloudReference, cloudMiddle, cloudMiddleReference, cloudWorldUnchanged }))));
} };

const hubBirdsEyeProjection = { name: "birds-eye projection", why: "rule: overhead projection keeps vertical landmarks aligned and picking rays agree with rendered geometry throughout the perspective transition", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, root = S.createNode(), rows = [], camera = S.createCamera({ near: 0.1, far: 80 });
    Object.assign(camera.position, { x: 3, y: 20, z: 5 }); Object.assign(camera.target, { x: 3, y: 0, z: 5 }); camera.up = { x: 0, y: 0, z: -1 }; camera.orthoHeight = 20;
    const red = BL.models.box({ w: 0.8, h: 0.8, d: 0.8, color: "#ff0000" }), blue = BL.models.box({ w: 0.8, h: 0.8, d: 0.8, color: "#0000ff" });
    const pink = BL.models.box({ w: 0.5, h: 0.5, d: 0.5, color: "#ff00ff" }), poses = [[-1, 4, 2], [7, -8, 8], [9, 18, 5]];
    for (let i = 0; i < 2; i++) S.addChild(root, S.createNode({ geometry: i ? blue : red, position: { x: poses[i][0], y: poses[i][1], z: poses[i][2] } }));
    const data = new Float32Array(20); data[0] = data[5] = data[10] = data[15] = data[16] = 1; data.set(poses[2], 12);
    // Near the eye, this batch lies outside a perspective cone but inside the
    // orthographic footprint; stale perspective culling would erase it.
    S.addChild(root, S.createNode({ geometry: pink, instanceData: data, instanceCount: 1, cullSphere: [9, 18, 5, 0.5] }));
    const canvas = document.createElement("canvas"); canvas.getContext("2d", { willReadFrequently: true });
    const fallback = BL.canvasRenderer.createRenderer(canvas, { width: 256, height: 256 });
    const points = [[0, -12, 0], [0, -5, 0], [0, 0, 0], [0, 5, 0], ...poses], opts = { bloomStrength: 0, shadowStrength: 0, ambientFloor: 1, directStrength: 0 };
    try {
      for (const [renderer, element] of [[B.renderer, document.getElementById("scene")], [fallback, canvas]]) {
        for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
          camera.orthoMix = mix; renderer.render(root, camera, opts);
          const width = renderer.size.width, height = renderer.size.height, tan = Math.tan(camera.fov / 2), f = height / (2 * tan);
          let projectError = 0, rayError = 0, rayForward = true;
          const projected = [], rays = [];
          for (const [x, y, z] of points) {
            const depth = 20 - y, w = (1 - mix) * depth + mix * camera.orthoHeight / (2 * tan), p = renderer.project(x, y, z, {});
            if (!p) { projectError = Infinity; continue; }
            projectError = Math.max(projectError, Math.hypot(p.x - width / 2 - (x - 3) * f / w, p.y - height / 2 - (z - 5) * f / w));
            const ray = renderer.ray(p.x, p.y, camera, {}), dx = x - ray.ox, dy = y - ray.oy, dz = z - ray.oz;
            const t = dx * ray.dx + dy * ray.dy + dz * ray.dz;
            rayError = Math.max(rayError, Math.hypot(dx - ray.dx * t, dy - ray.dy * t, dz - ray.dz * t)); rayForward &&= t > 0;
            projected.push(p); rays.push(ray);
          }
          const pixels = poses.map(([x, y, z]) => {
            const p = renderer.project(x, y, z, {}), px = Math.floor(p.x * element.width / width), py = Math.floor(p.y * element.height / height);
            if (px < 2 || py < 2 || px >= element.width - 2 || py >= element.height - 2) return null;
            if (renderer.kind !== "webgl2") return Array.from(element.getContext("2d").getImageData(px, py, 1, 1).data);
            const gl = element.getContext("webgl2"), pixel = new Uint8Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(px, element.height - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return Array.from(pixel);
          });
          const aligned = Math.max(...projected.slice(0, 4).map(p => Math.hypot(p.x - projected[0].x, p.y - projected[0].y)));
          const parallel = Math.max(...rays.map(r => Math.hypot(r.dx - rays[0].dx, r.dy - rays[0].dy, r.dz - rays[0].dz)));
          rows.push({ kind: renderer.kind, mix, projectError, rayError, rayForward, aligned, parallel, pixels });
        }
        // A stale mix without a valid orthographic height must remain the
        // ordinary perspective projection, including its picking contract.
        camera.orthoHeight = 0; camera.orthoMix = 1; renderer.render(root, camera, opts);
        const p = renderer.project(...poses[0], {}), f = renderer.size.height / (2 * Math.tan(camera.fov / 2));
        rows.push({ kind: renderer.kind, fallback: true, error: Math.hypot(p.x - renderer.size.width / 2 + 4 * f / 16, p.y - renderer.size.height / 2 + 3 * f / 16) });
        camera.orthoHeight = 20;
      }
      return rows;
    } finally { fallback.dispose(); for (const geometry of [red, blue, pink]) B.renderer.releaseGeometry(geometry); B.renderer.render(BL.scenes.hub.root, B.camera, B.renderOpts); }
  })()`);
  const samples = state.filter(r => !r.fallback), settled = samples.filter(r => r.mix === 1);
  record("birds-eye projection: WebGL2 and Canvas match the continuous projection formula and their rays hit the same world points at every transition sample", samples.length === 10 && samples.every(r => r.projectError < 0.002 && r.rayError < 1e-4 && r.rayForward)
    && state.filter(r => r.fallback).every(r => r.error < 0.002) && settled.every(r => r.aligned < 0.001 && r.parallel < 1e-6), JSON.stringify(state));
  record("birds-eye projection: rendered near and far objects follow projected positions, including a batch outside the old perspective frustum", samples.every(r => r.pixels[0]?.[0] > r.pixels[0]?.[1] + 40 && r.pixels[1]?.[2] > r.pixels[1]?.[1] + 40
    && (!r.pixels[2] || r.pixels[2][0] > r.pixels[2][1] + 40 && r.pixels[2][2] > r.pixels[2][1] + 40)) && settled.every(r => r.pixels[2]), JSON.stringify(samples.map(({ kind, mix, pixels }) => ({ kind, mix, pixels }))));
  const anchors = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, root = S.createNode(), actor = S.createNode({ position: { x: 4, y: 0, z: 0 } });
    const bodyGeometry = BL.models.box({ w: 1, h: 2, d: 1, color: "#999999" }), headGeometry = BL.models.box({ w: 1, h: 1, d: 1, color: "#ffffff" });
    const body = S.createNode({ geometry: bodyGeometry, position: { x: 0, y: 1, z: 0 } }), head = S.createNode({ geometry: headGeometry, position: { x: 0, y: 2.5, z: 0 } });
    S.addChild(actor, body, head); S.addChild(root, actor);
    const roofGeometry = BL.models.box({ w: 16, h: 0.2, d: 16, color: "#777777" }), roof = S.createNode({ geometry: roofGeometry, position: { x: 0, y: 6, z: 0 } }); S.addChild(root, roof);
    const camera = S.createCamera({ far: 80, orthoHeight: 20 }); Object.assign(camera.position, { x: 0, y: 20, z: 0 }); Object.assign(camera.target, { x: 0, y: 0, z: 0 }); camera.up = { x: 0, y: 0, z: -1 };
    const opts = { cutawayMaxY: 1e6, cutawayRegionCount: 0, cutawayRegions: [], birdsEyeCutaway: true, bloomStrength: 0, shadowStrength: 0 };
    const visibility = BL.characterVisibility.create({ root, renderer: B.renderer, camera, renderOpts: opts }), cave = { root: actor, parts: { head } }, rows = [];
    const sample = name => {
      B.renderer.render(root, camera, opts); visibility.begin();
      const out = {}, visible = visibility.anchor(cave, out), projected = [];
      for (let x = -0.5; x <= 0.5; x++) for (let y = 2; y <= 3; y++) for (let z = -0.5; z <= 0.5; z++) projected.push(B.renderer.project(4 + x, y, z, {}));
      const left = Math.min(...projected.map(p => p.x)), right = Math.max(...projected.map(p => p.x)), top = Math.min(...projected.map(p => p.y));
      return { name, mix: camera.orthoMix, visible, error: visible ? Math.hypot(out.x - (left + right) / 2, out.y - top) : null };
    };
    try {
      for (const mix of [0, 0.5, 1]) {
        camera.orthoMix = mix; roof.visible = false; rows.push(sample("uncovered"));
        roof.visible = true; rows.push(sample("covered"));
        opts.cutawayMaxY = 4; rows.push(sample("global cut")); opts.cutawayMaxY = 1e6;
      }
      opts.cutawayRegions[0] = { x: 4, z: 0, cos: 1, sin: 0, halfWidth: 1, halfDepth: 1, y: 4 }; opts.cutawayRegionCount = 1;
      rows.push(sample("local cut"));
      opts.cutawayRegions[0].x = 4.65; opts.cutawayRegions[0].halfWidth = 0.25;
      rows.push(sample("visible sliver"));
      roofGeometry.cutawayPreserve = true; rows.push(sample("preserved roof")); delete roofGeometry.cutawayPreserve;
      roofGeometry.cutawayHide = true; rows.push(sample("hidden weather")); delete roofGeometry.cutawayHide;
      roof.matrixCloud = true; roofGeometry.cutawayPreserve = true; opts.cutawayCloudY = -4; opts.cutawayCloudMix = 1;
      rows.push({ ...sample("lowered cloud"), physicalY: roof.position.y, worldY: roof.world[13] });
      return rows;
    } finally { visibility.dispose(); for (const geometry of [bodyGeometry, headGeometry, roofGeometry]) B.renderer.releaseGeometry(geometry); B.renderer.render(BL.scenes.hub.root, B.camera, B.renderOpts); }
  })()`);
  record("birds-eye projection: speech anchors follow the rendered head through the transition, ignore cut roofs and weather, and retain a sliver exposed through a local cut", anchors.length === 14 && anchors.every(r => {
    const expected = r.name !== "covered" && r.name !== "preserved roof";
    return r.visible === expected && (!expected || r.error < 0.002) && (r.name !== "lowered cloud" || r.physicalY === 6 && r.worldY === 6);
  }), JSON.stringify(anchors));
} };

const hubCombatReplay = { name: "birds-eye combat replay", why: "contract: replay links preserve north-up intent and legacy combat orbit poses still migrate", run: async (b) => {
  const northState = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, key = (type, value) => window.dispatchEvent(new KeyboardEvent(type, { key: value }));
    const angle = () => Math.atan2(-B.camera.up.x, -B.camera.up.z), wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
    key("keydown", "q"); B.advance(0.4, 1 / 60); key("keyup", "q"); B.advance(0.6, 1 / 60);
    const before = angle(), pose = JSON.parse(document.getElementById("position-debug").dataset.pose);
    P.restorePose(JSON.parse(JSON.stringify(pose)), true);
    key("keydown", "w"); B.advance(1 / 60, 1 / 60); key("keyup", "w"); B.advance(0.5, 1 / 60);
    const drift = Math.abs(wrap(angle() - before)), stillUnlocked = !P.birdsEyeNorthUp;
    key("keydown", "n"); key("keyup", "n"); B.advance(0.8, 1 / 60);
    const locked = JSON.parse(document.getElementById("position-debug").dataset.pose), north = angle();
    P.modeAction("mode-toggle"); B.advance(0.8, 1 / 60); P.hooks.onOrbit(120, 0); B.advance(0.8, 1 / 60);
    const orbit = P.orbit.yaw; P.modeAction("mode-toggle"); B.advance(0.8, 1 / 60);
    return { storedUnlocked: pose.birdsEyeNorthUp, stillUnlocked, drift, locked: locked.birdsEyeNorthUp, north,
      reentry: { orbit, angle: angle(), northUp: P.birdsEyeNorthUp, mode: P.mode, error: Math.abs(wrap(angle() - orbit)) } };
  })()`);
  record("birds-eye combat: debug replay records explicit north-up intent, while a fresh orbit-to-birds-eye transition clears the old lock and preserves the orbit heading", northState.storedUnlocked === false && northState.stillUnlocked && northState.locked && northState.drift < 0.001 && Math.abs(northState.north) < 0.001
    && northState.reentry.mode === "birds-eye" && !northState.reentry.northUp && Math.abs(northState.reentry.orbit) > 0.1 && northState.reentry.error < 0.01, JSON.stringify(northState));
  const legacy = await b.evaluate(`(() => { const pose = JSON.parse(document.getElementById("position-debug").dataset.pose); __ooga.pilot.capturePose(pose); pose.mode = "orbit"; pose.battle = pose.combat; delete pose.combat; delete pose.birdsEyeNorthUp; return pose; })()`);
  await b.open(hubPage(src, `solo=1&character=portlandhodl&pose=${encodeURIComponent(JSON.stringify(legacy))}`));
  await untilReady(b);
  const replay = await b.evaluate(`(() => { const B = __ooga, pose = JSON.parse(document.getElementById("position-debug").dataset.pose), el = B.hud.el.mode; return { mode: B.pilot.mode, combat: B.pilot.aiming, northUp: pose.birdsEyeNorthUp, poseMode: pose.mode, poseCombat: pose.combat, legacyField: Object.hasOwn(pose, "battle"), attribute: el.dataset.combat, legacyAttribute: el.hasAttribute("data-battle"), label: el.getAttribute("aria-label") }; })()`);
  record("birds-eye combat: old pose links migrate once, and new pose and HUD state use only combat terminology", replay.mode === "birds-eye" && replay.combat && replay.northUp === false && replay.poseMode === "birds-eye" && replay.poseCombat && !replay.legacyField && replay.attribute === "true" && !replay.legacyAttribute && replay.label.includes("combat") && !replay.label.includes("battle"), JSON.stringify(replay));
  // User-supplied basement replay: the old cursor-entry path saved a zero sideways offset.
  const collapsed = {
    version: 1, character: "w-s-bitcoin", mode: "shoulder", closeWanted: false, combat: true, birdsEyeNorthUp: true,
    position: [4.196401756845946, -10.703027121441215, 6.695479695588937], target: [0.32891306379743845, -11.382788314313563, 5.933603782632617],
    direction: [-0.9668722041737472, -0.16994030365120447, -0.19046898432851453], up: [0, 1, 0], fov: 0.8377580409572781,
    actor: [1.2652318088628172, -12.167587702447781, 6.11805402908858], body: [0, -1.7653007492106794, 0], head: [0.17076909418157493, 0, 0],
    bodyQuaternion: [0, 0, 0, 1], headQuaternion: [0, 0, 0, 1], bodyRolled: false, headRolled: false,
    orbit: [1.3762919043791138, 0.17076909418157493, 37.33323956694727, -3.165801056565666, -12.167587702447781, 6.0384959367857975],
    headOffset: [0, 0, 0], headOrbit: false, shoulderSide: 8.60671903579911e-16, closeMix: 0, ads: 0,
    selectedSlot: 2, ammo: 30, unlimited: false, magazines: [0, 0], magazineCount: 0, aimYaw: -4.8642770478224406e-8, aimPitch: 0.16261560295853825,
    jetpack: false, fuel: 1, hop: 0, hopV: 0, lift: 0, orthoMix: 0, orthoHeight: 2.8431736609009226
  };
  await b.open(hubPage(src, `character=w-s-bitcoin&pose=${encodeURIComponent(JSON.stringify(collapsed))}`));
  await untilReady(b);
  const repaired = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, a = P.player, C = B.camera;
    const pose = JSON.parse(document.getElementById("position-debug").dataset.pose); P.capturePose(pose);
    const view = JSON.stringify([C.position, C.target, C.up, C.fov]), p = a.root.position;
    const dx = C.position.x - C.target.x, dz = C.position.z - C.target.z;
    const side = ((C.position.x - p.x) * dz - (C.position.z - p.z) * dx) / Math.hypot(dx, dz) / a.traits.height;
    const w = a.parts.head.world, head = B.project(w[12], w[13], w[14], {});
    B.advance(0.5, 1 / 60);
    const held = P.poseHeld && view === JSON.stringify([C.position, C.target, C.up, C.fov]);
    P.restorePose(JSON.parse(JSON.stringify(pose)), true); B.advance(0.2, 1 / 60);
    return { pose, side, headOffset: B.renderer.size.width / 2 - head.x, held, roundTrip: view === JSON.stringify([C.position, C.target, C.up, C.fov]) };
  })()`);
  record("shoulder replay: the supplied zero-offset URL loads beside the head before any input and holds the repaired camera", repaired.pose.mode === "shoulder" && repaired.pose.combat && repaired.pose.shoulderSide === 0.6 && Math.abs(repaired.side - 0.6) < 1e-5 && repaired.headOffset > 0 && repaired.held
    && repaired.pose.actor.every((n, i) => Math.abs(n - collapsed.actor[i]) < 1e-6) && repaired.pose.selectedSlot === 2 && repaired.pose.ammo === 30 && repaired.roundTrip, JSON.stringify(repaired));
} };

const hubBirdsEyeTargets = { name: "birds-eye lower-floor targets", why: "rule: hidden upstairs targets cannot steal downstairs aim, and the orange melee dot and secondary shots identify the object that actually receives damage", run: async (b) => {
  const result = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, S = BL.scene, root = BL.scenes.hub.root, a = P.player, H = B.island.headquarters;
    const lowerGeometry = BL.models.box({ w: 0.8, h: 1, d: 0.8, color: "#527545" });
    const upperGeometry = BL.models.box({ w: 3, h: 1, d: 3, color: "#aa5555" });
    // Two real weapon-query targets share a footprint on separate floors. High
    // health avoids loot/respawn randomness while retaining the real damage path.
    const type = B.headquarters.breakables.list[0].type;
    const make = (geometry, y) => {
      const node = S.createNode({ geometry, position: { x: 6, y: y + 0.5, z: 0 } });
      const owner = { kind: "prop", prop: "rock", node, active: true };
      owner.breakable = { owner, type, health: 100, broken: false };
      S.addChild(root, node); B.input.add(node, owner); return owner;
    };
    const lower = make(lowerGeometry, H.basement.floor), upper = make(upperGeometry, H.floor);
    const pointAtLower = () => {
      S.updateWorld(root); B.renderer.render(root, B.camera, B.renderOpts);
      const p = B.renderer.project(lower.node.position.x, lower.node.position.y, lower.node.position.z, {});
      P.hooks.onOrbit(-1e6, -1e6); P.hooks.onOrbit(p.x, p.y);
    };
    const aim = () => {
      pointAtLower(); B.advance(0.4, 1 / 60);
      const target = P.assistedTarget, reticle = document.getElementById("weapon-reticle"), dot = getComputedStyle(reticle.querySelector("span"));
      return { target: target?.owner === lower ? "lower" : target?.owner === upper ? "upper" : "other", feedback: reticle.dataset.target,
        dot: dot.backgroundColor, visibility: dot.visibility, x: target?.x, y: target?.y, z: target?.z, ceiling: P.birdsEyeCeiling };
    };
    try {
      P.navigate({ position: { x: 6, y: H.basement.floor, z: -3 }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(0.7, 1 / 60);
      P.weaponAction("weapon-primary"); B.advance(0.5, 1 / 60); const far = aim();
      P.navigate({ position: { x: 6, y: H.basement.floor, z: -0.95 }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(0.7, 1 / 60);
      const near = aim(), beforeMelee = lower.breakable.health;
      P.weaponAction("weapon-fire"); B.advance(0.65, 1 / 60); const afterMelee = lower.breakable.health;
      const jump = { peak: 0, peakTarget: false, orangeFrames: 0 }; B.crew.jumpPlayer();
      for (let i = 0; i < 60; i++) {
        B.advance(1 / 60, 1 / 60);
        if (a.hop > jump.peak) { jump.peak = a.hop; jump.peakTarget = P.assistedTarget?.owner === lower; }
        if (a.hop > 0.1 && document.getElementById("weapon-reticle").dataset.target === "object") jump.orangeFrames++;
      }
      P.weaponAction("weapon-secondary"); B.advance(0.4, 1 / 60); const firearm = aim(), shotsBefore = a.weapon.shotsFired;
      P.weaponAction("weapon-secondary"); B.advance(0.7, 1 / 60);
      const afterShot = lower.breakable.health, shots = a.weapon.shotsFired - shotsBefore, mode = P.mode;
      P.navigate({ position: { x: 6, y: H.basement.floor, z: -2 }, yaw: 0, pitch: 0.3, dist: 8 }); B.advance(0.5, 1 / 60);
      P.hooks.onZoom(100); B.advance(1, 1 / 60); aim(); const fromHeight = P.birdsEyeHeight;
      P.hooks.onZoom(0.001);
      let frames = 0; for (; frames < 120 && P.mode === "birds-eye"; frames++) { pointAtLower(); B.advance(1 / 60, 1 / 60); }
      B.advance(0.06, 1 / 60);
      const anchor = P.assistedTarget ? { x: P.assistedTarget.x, y: P.assistedTarget.y, z: P.assistedTarget.z } : null;
      const reticle = document.getElementById("weapon-reticle"), handoff = { mode: P.mode, mix: P.birdsEyeMix, frames, fromHeight, anchor,
        offset: Math.hypot(parseFloat(reticle.style.left) - B.renderer.size.width / 2, parseFloat(reticle.style.top) - B.renderer.size.height / 2),
        before: lower.breakable.health, shotsBefore: a.weapon.shotsFired };
      P.weaponAction("weapon-fire"); B.advance(0.3, 1 / 60);
      handoff.after = lower.breakable.health; handoff.shots = a.weapon.shotsFired - handoff.shotsBefore;
      B.advance(1, 1 / 60);
      const held = P.assistedTarget, screen = anchor && B.renderer.project(anchor.x, anchor.y, anchor.z, {});
      handoff.targetError = anchor && held ? Math.hypot(anchor.x - held.x, anchor.y - held.y, anchor.z - held.z) : Infinity;
      handoff.centerError = screen ? Math.hypot(screen.x - B.renderer.size.width / 2, screen.y - B.renderer.size.height / 2) : Infinity;
      const closeAim = [];
      for (const fresh of [false, true]) {
        if (fresh) { P.hooks.onOrbit(0.1, 0); B.advance(0.5, 1 / 60); }
        const C = B.camera, dx = C.target.x - C.position.x, dy = C.target.y - C.position.y, dz = C.target.z - C.position.z;
        const length = Math.hypot(dx, dy, dz), hit = {};
        const found = B.input.weaponTargets.ray(hit, C.position.x, C.position.y, C.position.z, dx / length, dy / length, dz / length, 60, a);
        const point = fresh ? hit : anchor;
        P.hooks.onZoom(0.8);
        let error = 0;
        for (let frame = 0; frame < 90; frame++) {
          B.advance(1 / 60, 1 / 60);
          const q = point && B.project(point.x, point.y, point.z, {});
          error = Math.max(error, q ? Math.hypot(q.x - B.renderer.size.width / 2, q.y - B.renderer.size.height / 2) : Infinity);
        }
        const mode = P.mode;
        if (fresh) { P.hooks.onOrbit(0.015, 0); B.advance(1, 1 / 60); }
        const eye = B.camera, vx = eye.target.x - eye.position.x, vy = eye.target.y - eye.position.y, vz = eye.target.z - eye.position.z;
        const rayLength = Math.hypot(vx, vy, vz), exitHit = {};
        const exitFound = B.input.weaponTargets.ray(exitHit, eye.position.x, eye.position.y, eye.position.z, vx / rayLength, vy / rayLength, vz / rayLength, 60, a);
        const exitPoint = exitFound ? { x: exitHit.x, y: exitHit.y, z: exitHit.z } : null;
        P.hooks.onZoom(1.2);
        let exitError = 0;
        for (let frame = 0; frame < 90; frame++) {
          B.advance(1 / 60, 1 / 60);
          const q = exitPoint && B.project(exitPoint.x, exitPoint.y, exitPoint.z, {});
          exitError = Math.max(exitError, q ? Math.hypot(q.x - B.renderer.size.width / 2, q.y - B.renderer.size.height / 2) : Infinity);
        }
        closeAim.push({ fresh, found, mode, error, exitFound, exitMode: P.mode, exitError });
      }
      P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
      return { far, near, firearm, jump, handoff, closeAim, floor: H.basement.floor, beforeMelee, afterMelee, afterShot,
        upperHealth: upper.breakable.health, shots, mode };
    } finally {
      B.crew.stopBurst(a); B.crew.selectWeapon(1, a);
      for (const owner of [lower, upper]) { B.input.remove(owner.node); S.removeChild(root, owner.node); B.renderer.releaseGeometry(owner.node.geometry); }
      B.advance(0.2, 1 / 60);
    }
  })()`);
  record("birds-eye combat: basement aim ignores upstairs geometry, hides the distant melee dot and shows orange in range, then melee and secondary fire damage that same target", result.mode === "birds-eye" && result.far.target === "lower" && result.far.feedback === "out-of-range" && result.far.visibility === "hidden" && result.near.target === "lower" && result.near.feedback === "object" && result.near.dot === "rgb(255, 157, 66)" && result.near.visibility === "visible" && Math.abs(result.near.y - result.floor - 0.5) < 1e-5 && result.afterMelee < result.beforeMelee && result.firearm.target === "lower" && result.shots > 0 && result.afterShot < result.afterMelee && result.upperHealth === 100, JSON.stringify(result));
  record("birds-eye combat: a jump retains same-floor targeting through its apex and orange feedback while melee remains within reach", result.jump.peak > 0.9 && result.jump.peakTarget && result.jump.orangeFrames > 2, JSON.stringify(result.jump));
  record("birds-eye combat: a full-height zoom reaches shoulder promptly, retains the exact elevated world anchor through the swoop, and fires into the same target", result.handoff.mode === "shoulder" && result.handoff.mix > 0 && result.handoff.mix < 1 && result.handoff.offset > 20
    && result.handoff.fromHeight > 60 && result.handoff.frames > 0 && result.handoff.frames < 45 && result.handoff.anchor && result.handoff.anchor.y > result.floor + 0.05
    && result.handoff.targetError < 1e-6 && result.handoff.centerError < 0.1 && result.handoff.shots > 0 && result.handoff.after < result.handoff.before, JSON.stringify(result.handoff));
  record("combat zoom: object points stay under the crosshair in both shoulder/first-person directions, including after new first-person aim",
    result.closeAim.length === 2 && result.closeAim.every(row => row.found && row.mode === "first-person" && row.error < 0.1 && row.exitFound && row.exitMode === "shoulder" && row.exitError < 0.1), JSON.stringify(result.closeAim));
} };

// ---- Phones ----
// Each scene again at 390x844 with touch, as a phone player meets it. PHONE lists what a player would feel:
// ellipsis or clipped text, a button or heading wrapped by accident, text past the screen edge, and a
// required control missing, off screen or covered where a thumb lands. Planted defects (ellipsis, clipping,
// a card too wide, a buried button, desktop wording on a touch line, a wrapped label, a stick off screen)
// were each caught before this went in; its first run found Throw under Drift in the rally, the mine's
// strip over Pause and Sound, and the Mempool cave's sheet covering both sticks.
const PHONE = (required) => `((required) => {
  const W = innerWidth, H = innerHeight, bad = [];
  const name = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.');
  const shown = (el) => el.getClientRects().length > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const scroller = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (/auto|scroll/.test(getComputedStyle(n).overflowY + getComputedStyle(n).overflowX)) return n; return null; };
  // 1. Text: no ellipsis, no clipped own text, no own text past the screen edge.
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg, #position-debug') || !shown(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.clipPath === 'inset(50%)') continue; // screen-reader-only text
    if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue; // folded or scrolled away on purpose
    if (s.textOverflow === 'ellipsis') bad.push('ellipsis ' + name(el));
    if (/hidden|clip/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) bad.push('clipped ' + name(el) + ' ' + el.scrollWidth + '>' + el.clientWidth);
    // A button or heading whose own words fall onto a second line without a deliberate line break wrapped by accident.
    if (el.matches('button, h2, h3, .section-head') && s.overflowWrap !== 'anywhere') for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim() || (n.textContent.includes('\\n') && /pre/.test(s.whiteSpace))) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const tops = new Set([...range.getClientRects()].filter((q) => q.width > 1).map((q) => Math.round(q.top)));
      if (tops.size > 1) bad.push('wrapped ' + name(el) + ' "' + n.textContent.trim().slice(0, 24) + '"');
    }
    if (!scroller(el) && (r.left < -1 || r.right > W + 1)) bad.push('off-screen text ' + name(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  // 2. Required controls: shown, wholly on screen, and nothing on top at the centre or 4px inside each edge midpoint (works for round sticks too).
  for (const sel of required) {
    const el = [...document.querySelectorAll(sel)].find(shown);
    if (!el) { bad.push('missing ' + sel); continue; }
    const r = el.getBoundingClientRect();
    if (r.left < 0 || r.top < 0 || r.right > W || r.bottom > H) { bad.push('off-screen ' + sel + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',')); continue; }
    for (const [x, y] of [[r.x + r.width / 2, r.y + r.height / 2], [r.left + 4, r.y + r.height / 2], [r.right - 4, r.y + r.height / 2], [r.x + r.width / 2, r.top + 4], [r.x + r.width / 2, r.bottom - 4]]) {
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) { bad.push('covered ' + sel + ' by ' + (hit ? name(hit) : 'nothing') + ' at ' + Math.round(x) + ',' + Math.round(y)); break; }
    }
  }
  return bad;
})(${JSON.stringify(required)})`;
const PHONE_COARSE = `(() => { const lines = [...document.querySelectorAll('[data-intro]:not([hidden]) [data-coarse], #mine-intro:not([hidden]) [data-coarse]')]; return { coarse: matchMedia('(pointer: coarse)').matches, lines: lines.length, touchWording: lines.every((n) => n.textContent === n.dataset.coarse) }; })()`;
const PHONE_GO = `(() => { const g = document.querySelector('[data-intro]:not([hidden]) .game-intro-go, #mine-intro:not([hidden]) .game-intro-go'); if (!g) return null; const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

const PHONE_SIZE = { w: 390, h: 844, mobile: true };
const phone = (id, { card = null, play = null, required, sheet = false }) => ({ name: `${id} phone`, why: "rule: every scene is readable and playable on a phone, nothing clipped and every control under a thumb", run: async (b) => {
  const seen = {};
  if (card) {
    seen.card = { touch: await b.evaluate(PHONE_COARSE), bad: await b.evaluate(PHONE([`${card} .game-intro-go`, `${card} .game-intro-go + button`])) };
    const go = await b.evaluate(PHONE_GO);
    await b.click(go[0], go[1]);
    await b.sleep(150);
    seen.card.closed = await b.evaluate(`document.querySelector('${card}').hidden`);
  }
  if (play) await b.evaluate(play);
  await b.evaluate(`window.__ooga.advance(2, 1 / 60)`);
  await b.sleep(250);
  seen.play = await b.evaluate(PHONE(required));
  if (sheet) {
    // The sheet slides up on a CSS transform. Under the load of parallel lanes the page can go well over
    // 150 ms without a frame, so a sheet that has not started moving looks settled; wait instead for the
    // transform itself to arrive at open (no offset left).
    await b.evaluate(`document.getElementById("sheet-toggle").click()`);
    for (let i = 0; i < 200 && !(await b.evaluate(`(() => { const s = document.getElementById("sheet"), t = getComputedStyle(s).transform; return s.dataset.open === "true" && (t === "none" || new DOMMatrix(t).m42 === 0); })()`)); i++) await b.sleep(50);
    seen.sheet = await b.evaluate(PHONE(["#sheet-toggle", "#sheet-bananas", ".sheet .feed-open"]));
  }
  const ok = (!card || seen.card.touch.coarse && seen.card.touch.touchWording && seen.card.bad.length === 0 && seen.card.closed) && seen.play.length === 0 && (!sheet || seen.sheet.length === 0);
  record(`${id} phone: ${card ? "the title card reads in touch words and its go button starts the game, then " : ""}nothing is clipped, wrapped by accident or off screen, and every control is under a thumb${sheet ? ", with the sheet open too" : ""}`, ok, JSON.stringify(seen));
} });

// ---- The Lightning Factory ----
// The demo node is held still so an event handed to the feed is the only thing moving; events use the demo
// contract and a node of their own, so their sequence numbers never meet the demo node's.
const FACTORY_EVENT = `const F = window.BL.factoryFeed, X = window.__ooga.factory, stamp = () => { const d = new Date(); d.setUTCSeconds(0, 0); return d.toISOString(); }; window.__factorySeq = window.__factorySeq || 0; const send = (type, payload) => { const n = ++window.__factorySeq; return X.feed.accept({ schema: F.DEMO, id: "aaaaaaaa-bbbb-4ccc-8ddd-" + String(n).padStart(12, "0"), seq: n, bucket: stamp(), node: "probe", origin: "observed", stream: "live", type, payload }); }; X.mock.update = () => {};`;
// Holds whichever of W A S D moves the camera-relative way nearest (dx, dz) in the world, for `seconds`.
const walkToward = async (b, dx, dz, seconds) => {
  const k = await b.evaluate(`(() => { const c = window.__ooga.camera, fx = c.target.x - c.position.x, fz = c.target.z - c.position.z, l = Math.hypot(fx, fz), f = [fx / l, fz / l], r = [-f[1], f[0]], d = [${dx}, ${dz}]; const score = { w: f[0] * d[0] + f[1] * d[1], s: -(f[0] * d[0] + f[1] * d[1]), d: -(r[0] * d[0] + r[1] * d[1]), a: r[0] * d[0] + r[1] * d[1] }; return Object.entries(score).sort((p, q) => q[1] - p[1])[0][0]; })()`);
  await holdKey(b, k, seconds);
  return k;
};
const factoryWalking = { name: "factory walking", why: "regression: Factory movement must preserve W A S D steering and keep walking and jumping bodies from passing through the backs of stairs", run: async (b) => {
  const ooga = await walkKeys(b, "portlandhodl", 0, 8, [0, 2.2], 0.5);
  record("factory walking: W A S D walk the visitor's Ooga away, left, back and right on screen on the forge floor from two camera angles", allWalk(ooga), JSON.stringify(ooga));
  const stairs = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl"), F = BL.factoryModels;
    if (B.crew.player !== a) B.pilot.possess(a);
    B.pilot.navigate({ position: { x: 0, y: 0, z: 20 }, yaw: 0, pitch: 0, dist: 6 });
    B.advance(0.1, 1 / 60);
    const key = (name, code, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name, code, bubbles: true }));
    const ceiling = F.stairCeilingAt(0, 20, 0, a.bodyRadius);
    key(" ", "Space", true); B.advance(0.02, 1 / 60); key(" ", "Space", false);
    let peak = 0;
    for (let i = 0; i < 120; i++) { B.advance(1 / 60, 1 / 60); peak = Math.max(peak, a.root.position.y - a.baseY + a.bodyHeight); }
    key("w", "KeyW", true); B.advance(3, 1 / 60); key("w", "KeyW", false);
    const p = a.root.position, feet = p.y - a.baseY;
    return { ceiling, peak, z: p.z, feet, clear: F.clearAt(p.x, p.z, feet, a.bodyRadius, a.bodyHeight) };
  })()`);
  record("factory stair backs: jumping beneath the high end stops at the underside and walking toward the low end stops before entering the stairs, without lifting onto their treads", Number.isFinite(stairs.ceiling) && stairs.peak <= stairs.ceiling + 1e-6 && stairs.z < 19.5 && stairs.z > 13.5 && Math.abs(stairs.feet) < 1e-6 && stairs.clear, JSON.stringify(stairs));
  const rebalancer = await b.evaluate(`(() => {
    const B = __ooga, a = B.crew.player, F = BL.factoryModels, d = F.LAYOUT.rebalancer;
    const key = (name, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name, code: "Key" + name.toUpperCase(), bubbles: true }));
    const start = { x: d.x + 0.8, y: d.y, z: d.z + F.REB.cz + 2.4 };
    B.pilot.navigate({ position: start, yaw: 0, pitch: 0, dist: 6 }); B.advance(0.1, 1 / 60);
    key("w", true);
    let peak = d.y;
    for (let i = 0; i < 39; i++) { B.advance(1 / 60, 1 / 60); peak = Math.max(peak, a.root.position.y - a.baseY); }
    key("w", false);
    const onto = Math.hypot(a.root.position.x - start.x, a.root.position.z - start.z);
    key("s", true); B.advance(0.65, 1 / 60); key("s", false);
    const off = a.root.position.y - a.baseY;
    // Recreate a shallow overlap left by a landing or relocation, then leave it with ordinary input.
    const x = d.x + F.REB.console[0] + 0.78 + a.bodyRadius - 0.08, z = d.z + F.REB.console[1];
    B.pilot.navigate({ position: { x, y: d.y, z }, yaw: 0, pitch: 0, dist: 6 }); B.advance(0.1, 1 / 60);
    const overlapped = !F.clearAt(x, z, d.y, a.bodyRadius);
    const inwardBlocked = !F.walkable(x, z, x - 0.05, z, d.y, a.bodyRadius, a.bodyHeight);
    key("d", true); B.advance(0.65, 1 / 60); key("d", false);
    const p = a.root.position, feet = p.y - a.baseY;
    return { height: d.y, onto, peak, off, overlapped, inwardBlocked, escaped: p.x - x,
      clear: F.clearAt(p.x, p.z, feet, a.bodyRadius, a.bodyHeight), grounded: a.hop === 0 };
  })()`);
  record("factory rebalancer: walk onto and off the low drum; a shallow console overlap allows walking out while deeper movement stays blocked", rebalancer.onto > 0.5 && Math.abs(rebalancer.peak - (rebalancer.height + 0.56)) < 1e-5 && Math.abs(rebalancer.off - rebalancer.height) < 1e-5 && rebalancer.overlapped && rebalancer.inwardBlocked && rebalancer.escaped > 0.5 && rebalancer.clear && rebalancer.grounded, JSON.stringify(rebalancer));
} };
const factoryLadders = { name: "factory ladders", why: "rule: Oogas must climb the rebalancer and lighthouse ladders through real controls, hold their height at rest, walk off both landings and jump away without snapping back", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl"), F = BL.factoryModels, rows = [];
    if (B.crew.player !== a) B.pilot.possess(a);
    const key = (name, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name === "Space" ? " " : name, code: name === "Space" ? name : "Key" + name.toUpperCase(), bubbles: true }));
    const feet = () => a.root.position.y - a.baseY;
    for (const l of F.LAYOUT.ladders) {
      const yaw = Math.atan2(l.nx, l.nz), gap = a.bodyRadius + 0.6;
      B.pilot.navigate({ position: { x: l.x + l.nx * gap, y: l.bottom, z: l.z + l.nz * gap }, yaw, pitch: 0, dist: 6 });
      B.advance(0.1, 1 / 60); key("w", true);
      let mounted = false, paused = false, hold = 0, maxStep = 0;
      for (let i = 0; i < 600; i++) {
        const x = a.root.position.x, y = feet(), z = a.root.position.z;
        B.advance(1 / 60, 1 / 60);
        maxStep = Math.max(maxStep, Math.hypot(a.root.position.x - x, feet() - y, a.root.position.z - z));
        mounted ||= !!a.ladder.plane;
        if (!paused && a.ladder.plane && feet() > (l.bottom + l.top) / 2) {
          key("w", false); const at = feet(); B.advance(0.2, 1 / 60); hold = Math.abs(feet() - at);
          paused = true; key("w", true);
        }
        if (mounted && !a.ladder.plane) break;
      }
      key("w", false);
      const top = feet(), upperSupport = F.supportAt(a.root.position.x, a.root.position.z, top);
      const upperClear = F.clearAt(a.root.position.x, a.root.position.z, top, a.bodyRadius, a.bodyHeight);
      // Walk outward over the lip with W held; it must remain descent, rather than bouncing back up.
      B.pilot.navigate({ position: { x: l.x - l.nx * 0.2, y: l.top, z: l.z - l.nz * 0.2 }, yaw: yaw + Math.PI, pitch: 0, dist: 6 });
      B.advance(0.1, 1 / 60); key("w", true);
      let descending = false, rose = false, previous = feet();
      for (let i = 0; i < 600; i++) {
        B.advance(1 / 60, 1 / 60);
        descending ||= !!a.ladder.plane;
        if (feet() > previous + 1e-5) rose = true;
        previous = feet();
        if (descending && !a.ladder.plane) break;
      }
      const bottom = feet(), x = a.root.position.x, z = a.root.position.z;
      B.advance(0.3, 1 / 60); key("w", false);
      rows.push({ mounted, paused, hold, maxStep, top, upperSupport, upperClear, descending, rose, bottom,
        walkedAway: Math.hypot(a.root.position.x - x, a.root.position.z - z), active: !!a.ladder.plane, expectedTop: l.top, expectedBottom: l.bottom });
    }
    const l = F.LAYOUT.ladders[0], yaw = Math.atan2(l.nx, l.nz);
    B.pilot.navigate({ position: { x: l.x + l.nx * a.bodyRadius * 0.5, y: l.bottom, z: l.z }, yaw, pitch: 0, dist: 6 });
    key("w", true); B.advance(0.4, 1 / 60); key("w", false);
    const attached = !!a.ladder.plane, x = a.root.position.x, z = a.root.position.z;
    key("Space", true); B.advance(1 / 60, 1 / 60); key("Space", false); B.advance(0.15, 1 / 60);
    const jumped = { attached, detached: !a.ladder.plane, rising: a.hopV > 0, outward: (a.root.position.x - x) * l.nx + (a.root.position.z - z) * l.nz };
    return { rows, jumped };
  })()`);
  record("factory ladders: both climbs hold at rest, cross the lip continuously, descend without reversal and walk away at the bottom; Space jumps off", r.rows.every((v) => v.mounted && v.paused && v.hold < 1e-6 && v.maxStep < 0.2 && Math.abs(v.top - v.expectedTop) < 1e-6 && Math.abs(v.upperSupport - v.top) < 1e-6 && v.upperClear && v.descending && !v.rose && Math.abs(v.bottom - v.expectedBottom) < 1e-6 && v.walkedAway > 0.2 && !v.active)
    && r.jumped.attached && r.jumped.detached && r.jumped.rising && r.jumped.outward > 0.05, JSON.stringify(r));
} };
const factoryRailingJump = { name: "factory railing jumps", why: "regression: rifle reload checks prevented Factory jumps, and descending past railings could trap the visitor inside a lower-floor obstacle", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl"), rows = [];
    if (B.crew.player !== a) B.pilot.possess(a);
    const key = (name, code, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name, code, bubbles: true }));
    const walkAfterLanding = () => {
      let distance = 0;
      for (const name of ["w", "a", "s", "d"]) {
        const x = a.root.position.x, z = a.root.position.z;
        key(name, "Key" + name.toUpperCase(), true); B.advance(0.25, 1 / 60); key(name, "Key" + name.toUpperCase(), false);
        distance = Math.max(distance, Math.hypot(a.root.position.x - x, a.root.position.z - z));
      }
      return distance;
    };
    for (const [name, x, y, z, yaw, edge, ammo] of [
      ["balcony", 0.8, 5, 27.5, -Math.PI / 2, 2.5, 0],
      ["line C", -15.4, 5, -1.3, Math.PI, 0.5, 7],
      ["gallery", -3, 15.5, -16.1, Math.PI, -14.8, 0],
      ["watchtower", -16, 15.5, -11.9, Math.PI, -11, 7]
    ]) {
      B.crew.configureWeapon(a, 2, ammo);
      B.pilot.navigate({ position: { x, y, z }, yaw, pitch: 0.3, dist: 6 });
      B.advance(0.1, 1 / 60);
      key(" ", "Space", true); B.advance(0.32, 1 / 60); key(" ", "Space", false);
      const jumped = a.hop > 0.5 && !a.weapon.reloading;
      key("w", "KeyW", true);
      let crossed = false, airborne = false;
      for (let i = 0; i < 27; i++) {
        B.advance(1 / 60, 1 / 60);
        if ((name === "balcony" ? a.root.position.x : a.root.position.z) > edge) {
          crossed = true; airborne = airborne || a.root.position.y - a.baseY > y + 0.1;
        }
      }
      key("w", "KeyW", false); B.advance(3, 1 / 60);
      const p = a.root.position, feet = p.y - a.baseY, floor = BL.factoryModels.supportAt(p.x, p.z, feet);
      const grounded = a.hop === 0 && Math.abs(feet - floor) < 1e-6, clear = BL.factoryModels.clearAt(p.x, p.z, feet, a.bodyRadius);
      rows.push({ name, ammo, jumped, crossed, airborne, feet, floor, landedBelow: floor < y, grounded, clear, walked: walkAfterLanding() });
    }
    // Drop over a channel tank from above its collision layer, where airborne horizontal clearance alone
    // used to accept the position and leave every walking direction blocked after landing.
    const F = BL.factoryModels, bay = F.LAYOUT.bays[2];
    B.pilot.navigate({ position: { x: F.stationX(bay) + 1.2, y: bay.y + 4, z: F.stationZ(bay) }, yaw: 0, pitch: 0.3, dist: 6 });
    B.advance(3, 1 / 60);
    const p = a.root.position, feet = p.y - a.baseY, floor = F.supportAt(p.x, p.z, feet);
    const tankLanding = { feet, floor, grounded: a.hop === 0 && Math.abs(feet - floor) < 1e-6, clear: F.clearAt(p.x, p.z, feet, a.bodyRadius), walked: walkAfterLanding() };
    return { scene: B.scene, rows, tankLanding };
  })()`);
  record("factory railings: empty or partly used rifles jump off four platforms, land clear on the floor below and keep walking; falling over a channel tank also leaves movement clear", r.scene === "factory" && r.rows.length === 4 && r.rows.every(row => row.jumped && row.crossed && row.airborne && row.grounded && row.landedBelow && row.floor >= 0 && row.clear && row.walked > 0.5) && r.tankLanding.grounded && r.tankLanding.clear && r.tankLanding.walked > 0.5, JSON.stringify(r));
} };
const factoryWeapons = { name: "factory weapon selection", why: "regression: the factory omitted the keyboard and HUD handlers for selecting melee and rifle weapons", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl");
    if (B.crew.player !== a) B.pilot.possess(a);
    B.crew.configureWeapon(a, 1); B.crew.configureWeapon(a, 2, 30);
    // A previous scene's birdseye cursor can leave an offset on the shared HUD
    // before this pilot has ever written (or cached) reticle coordinates.
    const reticle = document.getElementById("weapon-reticle");
    reticle.style.left = "83%"; reticle.style.top = "46%";
    const key = slot => {
      for (const type of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(type, { key: String(slot), code: "Digit" + slot, bubbles: true }));
      B.advance(0.1, 1 / 60);
    };
    key(1); const meleeKey = a.weapon.primaryEquipped && !a.weapon.equipped;
    key(2); const rifleKey = a.weapon.equipped && !a.weapon.primaryEquipped;
    const primary = document.getElementById("primary-hud"), secondary = document.getElementById("weapon-hud");
    const visible = !primary.hidden && !secondary.hidden;
    primary.dispatchEvent(new PointerEvent("pointerdown", { button: 0, buttons: 1, pointerId: 77, bubbles: true }));
    primary.dispatchEvent(new PointerEvent("pointerup", { button: 0, buttons: 0, pointerId: 77, bubbles: true }));
    B.advance(0.1, 1 / 60); const meleeButton = a.weapon.primaryEquipped && !a.weapon.equipped;
    secondary.click(); B.advance(0.1, 1 / 60);
    return { scene: B.scene, meleeKey, rifleKey, visible, meleeButton, rifleButton: a.weapon.equipped && !a.weapon.primaryEquipped,
      centered: !reticle.style.left && !reticle.style.top };
  })()`);
  record("factory weapons: 1 and 2 and both HUD buttons select melee and rifle weapons without leaving the factory", r.scene === "factory" && r.meleeKey && r.rifleKey && r.visible && r.meleeButton && r.rifleButton, JSON.stringify(r));
  record("factory weapons: the crosshair clears inherited birdseye coordinates and returns to the screen centre", r.centered, JSON.stringify(r));
  const views = await b.evaluate(`(() => {
    const B = __ooga, P = B.pilot, a = P.player, reticle = document.getElementById("weapon-reticle"), rows = [];
    const key = () => {
      for (const type of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(type, { key: "x", code: "KeyX", bubbles: true }));
      B.advance(0.1, 1 / 60);
    };
    if (!P.aiming) P.modeAction("mode-toggle");
    key(); const carryKey = !P.aiming && reticle.hidden;
    key(); const combatKey = P.aiming && !reticle.hidden;
    const mode = document.getElementById("mode-hud");
    const press = () => {
      for (const type of ["pointerdown", "pointerup"]) mode.dispatchEvent(new PointerEvent(type, {
        button: 0, buttons: type === "pointerdown" ? 1 : 0, pointerId: 78, bubbles: true
      }));
      B.advance(0.1, 1 / 60);
    };
    press(); const carryButton = !P.aiming && reticle.hidden;
    press(); const combatButton = P.aiming && !reticle.hidden;
    for (const slot of [1, 2]) {
      P.weaponMode(slot); const ammo = a.weapon.ammo;
      P.hooks.onZoom(1.2); B.advance(1.5, 1 / 60);
      const overhead = P.mode === "birds-eye" && !reticle.hidden;
      P.hooks.onZoom(0.001); B.advance(2, 1 / 60);
      const shoulder = P.mode === "shoulder" && !reticle.hidden && !reticle.style.left && !reticle.style.top;
      P.hooks.onZoom(0.8); B.advance(1, 1 / 60);
      const first = P.mode === "first-person" && !reticle.style.left && !reticle.style.top;
      P.hooks.onZoom(1.2); B.advance(1, 1 / 60);
      rows.push({ slot, overhead, shoulder, first, returned: P.mode === "shoulder",
        held: a.weapon.selectedSlot === slot && a.weapon.equipped === (slot === 2) && a.weapon.primaryEquipped === (slot === 1),
        ammo: a.weapon.ammo === ammo });
    }
    return { carryKey, combatKey, carryButton, combatButton, rows };
  })()`);
  record("factory views: X and the mode button share mainland carry/combat behavior; zoom crosses birdseye, shoulder and first person without changing the held weapon or ammo, and close views center the crosshair",
    views.carryKey && views.combatKey && views.carryButton && views.combatButton && views.rows.length === 2
    && views.rows.every(row => row.overhead && row.shoulder && row.first && row.returned && row.held && row.ammo), JSON.stringify(views));
  const hits = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl"), s = B.factory.scene, rows = [];
    const hum = s.tunnels.map(t => t.hum), gateHum = s.gate.hum;
    for (const t of s.tunnels) t.hum = Infinity;
    s.gate.hum = Infinity;
    try {
      for (let i = 0; i <= s.tunnels.length; i++) {
        const t = s.tunnels[i], at = t ? t.at : { x: 0, y: BL.factoryModels.LAYOUT.entrance.y, z: BL.factoryModels.HALL.front - 0.6, turn: Math.PI };
        const ripple = t ? t.ripples : s.gate.phase.ripples, plane = t ? 0.45 : 0;
        const sn = Math.sin(at.turn), c = Math.cos(at.turn);
        B.crew.configureWeapon(a, 2, 30);
        B.pilot.navigate({ position: { x: at.x + sn * 2.5, y: at.y, z: at.z + c * 2.5 }, yaw: at.turn, pitch: 0, dist: 6 });
        B.advance(0.4, 1 / 60);
        const before = ripple.hits;
        const fired = B.crew.fireWeapon(a, { x: at.x + sn * (plane - 0.5), y: at.y + 2, z: at.z + c * (plane - 0.5) }, 1);
        B.advance(0.3, 1 / 60);
        rows.push({ i, fired, hits: ripple.hits - before, active: ripple.active, bounded: ripple.active <= BL.mirrorRipples.CAPACITY });
      }
    } finally {
      s.tunnels.forEach((t, i) => t.hum = hum[i]); s.gate.hum = gateHum;
    }
    return rows;
  })()`);
  record("factory banana impacts: actual rifle rounds create one bounded ripple on each of the four peer mirrors and on the exit shield", hits.length === 5 && hits.every(row => row.fired && row.hits === 1 && row.active > 0 && row.bounded), JSON.stringify(hits));
} };
const factoryForward = { name: "factory forward", why: "rule: a forward's sats go in along the line it came in on, through the core and out along the line it left by; a failed one comes back and its target sputters", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga; ${FACTORY_EVENT} const s = X.scene, q = s.sats, bays = s.bays;
    for (let t = 0; t < 10 && q.bay.some((v) => v >= 0); t += 0.25) B.advance(0.25, 1 / 20);
    const watch = (seconds, from, to) => { let inbound = 0, outbound = 0, backOnFrom = 0, onTo = 0, surged = false, sputtered = false; for (let t = 0; t < seconds; t += 1 / 20) { B.advance(1 / 20, 1 / 20); let i1 = 0, o1 = 0, b1 = 0, t1 = 0; for (let i = 0; i < q.bay.length; i++) { if (q.bay[i] < 0 || q.t[i] < 0 || q.t[i] > 1) continue; if (q.bay[i] === from && q.dir[i] > 0) i1++; if (q.bay[i] === from && q.dir[i] < 0) b1++; if (q.bay[i] === to && q.dir[i] < 0) o1++; if (q.bay[i] === to) t1++; } inbound = Math.max(inbound, i1); outbound = Math.max(outbound, o1); backOnFrom = Math.max(backOnFrom, b1); onTo = Math.max(onTo, t1); surged = surged || s.surgeT >= 0; sputtered = sputtered || bays[to].sputter > 0; } return { inbound, outbound, backOnFrom, onTo, surged, sputtered, flashTo: +bays[to].flashL.toFixed(2), left: q.bay.filter((v) => v >= 0).length }; };
    const sent = send("forward.settled", { scale: "large", count: 1, station: bays[0].line, out: bays[3].line, fee: "dust" });
    const big = watch(8, 0, 3);
    const failedSent = send("forward.failed", { scale: "small", count: 1, station: bays[2].line, out: bays[1].line });
    const failed = watch(8, 2, 1);
    return { sent, big, failedSent, failed }; })()`);
  record("factory forward: a large forward's stream rides in along its line's conduit, surges the node and rides out along the other line's to light it; a failed one comes back along its own and sputters the line it was bound for", r.sent && r.big.inbound >= 8 && r.big.outbound >= 8 && r.big.backOnFrom === 0 && r.big.surged && r.big.left === 0 && r.failedSent && r.failed.inbound >= 1 && r.failed.backOnFrom >= 1 && r.failed.onTo === 0 && r.failed.sputtered && !r.failed.surged && r.failed.left === 0, JSON.stringify(r));
} };
const factoryForge = { name: "factory forge", why: "rule: opening a channel sends carts up to the forge, which takes each with a flash; closing one mints a coin that rolls back down to the chain", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga; ${FACTORY_EVENT} const s = X.scene, spare = X.mock.snapshot.channels.find((c) => !c.active), gallery = s.gallery.find((g) => g.line);
    const opened = send("channel.opening", { scale: "large", station: spare.id });
    let carts = 0, flashes = 0, rising = false, lastFlash = 0;
    for (let t = 0; t < 16; t += 1 / 20) { B.advance(1 / 20, 1 / 20); carts = Math.max(carts, s.carts.filter((c) => c.active).length); rising = rising || s.shaftGlow[0] > 0.5; if (s.flash > lastFlash + 0.5 && s.flashKind === 0) flashes++; lastFlash = s.flash; }
    const inDone = { carts, flashes, rising, waiting: s.inQueue, out: s.carts.filter((c) => c.active).length };
    const closed = send("channel.closed", { scale: "large", station: gallery.line, channel_count: 20 });
    let minted = false, rolled = false, sunk = false, cyan = false; lastFlash = s.flash;
    for (let t = 0; t < 16; t += 1 / 20) { B.advance(1 / 20, 1 / 20); minted = minted || s.mintT >= 0; rolled = rolled || s.coinD > 0; if (s.flash > lastFlash + 0.5 && s.flashKind === 1) cyan = true; lastFlash = s.flash; sunk = sunk || (s.coinD > 0 && s.shaftGlow[1] > 0.5); }
    return { opened, inDone, closed, minted, rolled, cyan, sunk, coinGone: s.coinD < 0 && !s.coin.visible }; })()`);
  record("factory forge: a large channel's opening sends two carts up the chain's shaft that the forge takes with a gold flash each, and a close mints a coin on a cyan flash that rolls down the other shaft", r.opened && r.inDone.carts === 2 && r.inDone.flashes === 2 && r.inDone.rising && r.inDone.waiting === 0 && r.inDone.out === 0 && r.closed && r.minted && r.rolled && r.cyan && r.sunk && r.coinGone, JSON.stringify(r));
} };
const factoryShields = { name: "factory peer portals", why: "rule: paired peer mirrors highlight body contact and preserve position, jump motion and view across a walk and its return", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, a = B.cavemen.get("portlandhodl"), tunnels = B.factory.scene.tunnels, rows = [];
    if (B.crew.player !== a) B.pilot.possess(a);
    const key = (name, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: name, code: "Key" + name.toUpperCase(), bubbles: true }));
    const local = t => { const p = a.root.position, dx = p.x - t.at.x, dz = p.z - t.at.z, c = Math.cos(t.at.turn), s = Math.sin(t.at.turn); return { across: dx * c - dz * s, along: dx * s + dz * c, feet: p.y - a.baseY - t.at.y }; };
    const boom = () => Math.hypot(B.camera.position.x - a.root.position.x, B.camera.position.y - a.root.position.y, B.camera.position.z - a.root.position.z);
    for (const lateral of [0.35, 1.35, -1.35]) for (let i = 0; i < tunnels.length; i++) {
      const t = tunnels[i], other = tunnels[i ^ 1], offset = i % 2 ? -lateral : lateral, c = Math.cos(t.at.turn), s = Math.sin(t.at.turn);
      B.pilot.navigate({ position: { x: t.at.x + offset * c + 0.5 * s, y: t.at.y, z: t.at.z - offset * s + 0.5 * c }, yaw: t.at.turn, pitch: 0.3, dist: 6 });
      B.advance(0.1, 1 / 60);
      const contacts = t.body.contacts, start = local(t), count = t.crossings, beforeMode = B.pilot.mode;
      if (i === 1) B.crew.jumpPlayer();
      let crossed = false, before = null, after = null, cameraChange = Infinity, air = false, clearExit = false;
      key("w", true);
      for (let n = 0; n < 60; n++) {
        before = local(t); const distance = boom();
        B.advance(1 / 60, 1 / 60);
        if (t.crossings !== count) {
          crossed = true; after = local(other); cameraChange = Math.abs(boom() - distance); air = a.hop > 0 && a.hopV > 0;
          clearExit = BL.factoryModels.clearAt(a.root.position.x, a.root.position.z, a.root.position.y - a.baseY, a.bodyRadius);
          break;
        }
      }
      const outgoing = crossed ? local(other).along : 0, exitCount = other.crossings;
      B.advance(0.2, 1 / 60); key("w", false);
      const exit = local(other), stayedOut = other.crossings === exitCount;
      key("s", true);
      for (let n = 0; n < 90 && other.crossings === exitCount; n++) B.advance(1 / 60, 1 / 60);
      key("s", false);
      rows.push({ i, offset, contacts, start, crossed, before, after, cameraChange, air, clearExit, exit,
        walkedOut: exit.along > outgoing + 0.1, stayedOut, returned: other.crossings === exitCount + 1,
        sameMode: B.pilot.mode === beforeMode, supported: BL.factoryModels.supportAt(a.root.position.x, a.root.position.z, a.root.position.y - a.baseY) === t.at.y });
    }
    return { scene: B.scene, rows };
  })()`);
  record("factory peer portals: all four mirrors outline contact, cross at central and off-centre positions into clear space, preserve offsets and camera distance, continue walking without bounce and allow a return; an airborne crossing keeps its jump", r.scene === "factory" && r.rows.length === 12 && r.rows.every(row => row.contacts > 0 && row.start.along > 0.45 && row.crossed && row.clearExit && row.before.along >= 0.45 - 1e-7
    && row.after.along >= 0.45 - 1e-7 && row.after.along < 0.65 && Math.abs(row.after.across + row.before.across) < 1e-6
    && Math.abs(row.after.feet - row.before.feet) < 0.25 && row.cameraChange < 0.25 && row.sameMode && row.walkedOut && row.stayedOut && row.returned && row.supported)
    && r.rows[1].air && r.rows[1].after.feet > 0, JSON.stringify(r));
} };
// Everywhere the widest Ooga on the roster can walk from the balcony, by the factory's own step rule on a
// quarter-metre grid: both ends of every stair, every line's deck and its peer tunnel's porch, the switchboard,
// rebalancer, treasury, watchtower, landing, galleries and the forge floor. It runs on the island, where the whole roster is built.
const factoryFloor = { name: "factory floor", why: "regression: stairs landed against rails and blocks, and lanes round the tanks and past the tunnels' console boxes were too narrow to walk", run: async (b) => {
  const r = await b.evaluate(`(() => {
    let R = 0, who = ""; for (const cave of window.__ooga.cavemen.values()) if (cave.bodyRadius > R) { R = cave.bodyRadius; who = cave.traits.name; }
    const M = window.BL.factoryModels, L = M.LAYOUT, G = 0.25, X0 = -21, Z0 = -20, NX = 169, NZ = 201, seen = new Map(), queue = [];
    const add = (i, k, y) => { const key = (i * NZ + k) * 128 + Math.round(y * 4); if (!seen.has(key)) { seen.set(key, [i, k, y]); queue.push(key); } };
    add(Math.round(-X0 / G), Math.round((27 - Z0) / G), M.supportAt(0, 27, L.entrance.y + 0.2));
    for (let h = 0; h < queue.length; h++) {
      const [i, k, y] = seen.get(queue[h]), x = X0 + i * G, z = Z0 + k * G;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nk = k + dk;
        if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
        const nx = X0 + ni * G, nz = Z0 + nk * G;
        if (M.walkable(x, z, nx, nz, y, R)) add(ni, nk, M.supportAt(nx, nz, y));
      }
      // A ladder connects its two landings, whose actual control handoffs are checked in factoryLadders.
      for (const l of L.ladders) {
        const ax = l.x + l.nx * (R + 0.12), az = l.z + l.nz * (R + 0.12), bx = l.x - l.nx * l.inset, bz = l.z - l.nz * l.inset;
        if (!M.clearAt(ax, az, l.bottom, R) || !M.clearAt(bx, bz, l.top, R)
          || Math.abs(M.supportAt(ax, az, l.bottom) - l.bottom) > 1e-5 || Math.abs(M.supportAt(bx, bz, l.top) - l.top) > 1e-5) continue;
        if (Math.abs(y - l.bottom) < 0.1 && Math.hypot(x - ax, z - az) < 0.35) add(Math.round((bx - X0) / G), Math.round((bz - Z0) / G), l.top);
        if (Math.abs(y - l.top) < 0.1 && Math.hypot(x - bx, z - bz) < 0.35) add(Math.round((ax - X0) / G), Math.round((az - Z0) / G), l.bottom);
      }
    }
    const cells = [...seen.values()].map(([i, k, y]) => [X0 + i * G, Z0 + k * G, y]);
    const reachedIn = (x0, x1, z0, z1, y) => cells.some(([x, z, h]) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && Math.abs(h - y) < 0.3);
    const near = (x, z, y) => reachedIn(x - 0.6, x + 0.6, z - 0.6, z + 0.6, y), missing = [];
    L.stairs.forEach(([ax, ay, az, bx, by, bz], n) => { if (!near(ax, az, ay)) missing.push("stair " + n + " foot"); if (!near(bx, bz, by)) missing.push("stair " + n + " head"); });
    const decks = { A: L.bays[0], B: L.bays[1], C: L.bays[2], D: L.bays[3], switchboard: L.switchboard, rebalancer: L.rebalancer, treasury: L.treasury, watchtower: L.lookout, lighthouse: L.lookoutDeck, landing: L.landing, gallery1: L.galleries[0], gallery2: L.galleries[1] };
    for (const [name, d] of Object.entries(decks)) if (!reachedIn(d.x - d.w / 2, d.x + d.w / 2, d.z - d.d / 2, d.z + d.d / 2, d.y)) missing.push(name);
    if (!near(L.rebalancer.x + M.REB.operator[0], L.rebalancer.z + M.REB.operator[1], L.rebalancer.y)) missing.push("rebalancer operator lane");
    // Each porch reaches its peer mirror's walkable threshold.
    L.tunnels.forEach((t, n) => { const c = Math.cos(t.turn), sn = Math.sin(t.turn), d = 1.1; if (!near(t.x + sn * d, t.z + c * d, t.y)) missing.push("shield " + "ABCD"[n]); });
    if (!near(L.stairway[0], L.stairway[2] - 1, 0)) missing.push("forge floor");
    return { who, radius: +R.toFixed(2), missing, cells: cells.length };
  })()`);
  record("factory floor: from the balcony the widest Ooga on the roster reaches both ends of every stair, every line's deck, each peer tunnel's shield, the switchboard, rebalancer and its operator lane, treasury, watchtower, landing, galleries and the forge", r.missing.length === 0 && r.radius > 0.6 && r.cells > 20000, JSON.stringify(r));
} };
// The way in and out: from the island through the 2 o'clock mouth's shield, back out past the balcony, and Escape.
const factoryEntrance = { name: "factory entrance", why: "regression: flying above the mouth entered the factory and reaching its front wall away from the doorway exited; real doorway crossings must still keep the same Ooga", run: async (b) => {
  const above = await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), m = B.mouths.find((m) => m.id === "c2"), along = window.BL.factoryModels.SHIELD_Z - 0.1; if (B.crew.player !== a) B.pilot.possess(a); B.pilot.navigate({ position: { x: m.x + Math.sin(m.ry) * along, y: m.floorY + 20, z: m.z + Math.cos(m.ry) * along }, yaw: m.ry, pitch: 0.2, dist: 5 }); B.advance(1 / 60, 1 / 60); return { scene: B.scene, transitioning: B.transitioning, height: a.root.position.y - a.baseY - m.floorY }; })()`);
  record("factory entrance: flying above the shield stays on the island", above.scene === "hub" && !above.transitioning && above.height > 3, JSON.stringify(above));
  await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), slot = window.BL.caves.slots.find((s) => s.scene === "factory"), m = B.mouths.find((m) => m.id === slot.id), along = window.BL.factoryModels.SHIELD_Z + 0.6; if (B.crew.player !== a) B.pilot.possess(a); B.pilot.navigate({ position: { x: m.x + Math.sin(m.ry) * along, y: m.floorY, z: m.z + Math.cos(m.ry) * along }, yaw: m.ry, pitch: 0.2, dist: 5 }); B.advance(0.5, 1 / 60); B.crew.configureWeapon(a, 2, 23); B.crew.removeMagazines(a); B.crew.collectGroundMagazine(7, a); B.crew.collectGroundMagazine(11, a); window.__mouth = { x: m.x, z: m.z, ry: m.ry }; })()`);
  const inKey = await b.evaluate(`(() => { const m = window.__mouth; return [-Math.sin(m.ry), -Math.cos(m.ry)]; })()`);
  await walkToward(b, inKey[0], inKey[1], 0.8);
  const arrived = await b.evaluate(`(() => { const B = window.__ooga; for (let i = 0; i < 240 && (B.transitioning || B.scene !== "factory"); i++) B.advance(1 / 30, 1 / 30); B.advance(0.3, 1 / 30); const a = B.crew.player; return { scene: B.scene, ooga: a ? a.traits.name : null, rifle: !!a && a.weapon.equipped && a.weapon.selectedSlot === 2, ammo: a && a.weapon.ammo, spares: a && a.weapon.spareAmmo.join(",") }; })()`);
  const outside = await b.evaluate(`(() => { const B = window.__ooga, e = window.BL.factoryModels.LAYOUT.entrance, rows = []; for (const [name, x, y] of [["beside", 10, e.y], ["below", 0, 0], ["above", 0, e.y + 12]]) { if (B.scene !== "factory" || B.transitioning) break; B.pilot.navigate({ position: { x, y, z: 29 }, yaw: Math.PI, pitch: 0.2, dist: 5 }); B.advance(1 / 60, 1 / 60); rows.push({ name, scene: B.scene, transitioning: B.transitioning }); } return rows; })()`);
  record("factory entrance: positions beside, below and above the exit doorway stay in the factory", outside.length === 3 && outside.every((r) => r.scene === "factory" && !r.transitioning), JSON.stringify(outside));
  await b.evaluate(`(() => { const B = window.__ooga, a = B.crew.player, e = window.BL.factoryModels.LAYOUT.entrance; B.pilot.navigate({ position: { x: 0, y: e.y, z: e.z + 2.2 }, yaw: 0, pitch: 0.2, dist: 5 }); B.crew.configureWeapon(a, 1, 17); if (B.pilot.aiming) B.pilot.modeAction("mode-toggle"); B.advance(0.5, 1 / 60); })()`);
  await walkToward(b, 0, 1, 0.8);
  const back = await b.evaluate(`(() => { const B = window.__ooga, m = window.__mouth; for (let i = 0; i < 240 && (B.transitioning || B.scene !== "hub"); i++) B.advance(1 / 30, 1 / 30); B.advance(0.3, 1 / 30); const p = B.crew.player && B.crew.player.root.position; return { scene: B.scene, ooga: B.crew.player ? B.crew.player.traits.name : null, fromMouth: p ? +Math.hypot(p.x - m.x, p.z - m.z).toFixed(1) : null, melee: !!p && B.crew.player.weapon.primaryEquipped && !B.crew.player.weapon.equipped && B.crew.player.weapon.selectedSlot === 1, ammo: p && B.crew.player.weapon.ammo, spares: p && B.crew.player.weapon.spareAmmo.join(","), carry: !B.pilot.aiming && document.getElementById("weapon-reticle").hidden }; })()`);
  record("factory doorway: the selected rifle, rounds and spare magazines survive entry; a switch to melee and carry inside survives the return", arrived.rifle && arrived.ammo === 23 && arrived.spares === "7,11" && back.melee && back.ammo === 17 && back.spares === "7,11" && back.carry, JSON.stringify({ arrived, back }));
  await tourGo(b, "factory");
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const escaped = await b.evaluate(`window.__ooga.scene`);
  record("factory entrance: walking through the 2 o'clock shield takes the same Ooga inside, walking back out past the balcony returns it to the mouth, and Escape leaves the factory", arrived.scene === "factory" && arrived.ooga === "portlandhodl" && back.scene === "hub" && back.ooga === "portlandhodl" && back.fromMouth !== null && back.fromMouth < 10 && escaped === "hub", JSON.stringify({ arrived, back, escaped }));
} };
// ₿IFRÖST. In from the top of the pass stairs through the arch, over the
// bridge and through the portal's field as the widest Ooga; W A S D in the hall; back out through the field; Escape.
const bifrostEntrance = { name: "bifrost entrance", why: "playthrough: an Ooga walks through the arch and the portal's field into the chamber as the same Ooga, with DSB Land's picture and the view back out", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), g = B.island.gate, z = g.z + 2; if (B.crew.player !== a) B.pilot.possess(a); B.pilot.navigate({ position: { x: g.x, y: B.island.surfaceAt(g.x, z), z }, target: { x: g.x, y: 6, z: z - 6 }, yaw: 0, pitch: 0.2, dist: 5 }); B.advance(0.5, 1 / 60); })()`);
  await walkToward(b, 0, -1, 2.5);
  // The deck starts where the stone head ends, `HEAD.over` out past the rim along the islet's axis.
  const arch = await b.evaluate(`(() => { const B = window.__ooga, I = window.BL.bifrostIsle, a = B.crew.player, p = a.root.position, g = B.island.gate, s = B.bifrost.site.arrival, sp = I.spot(B.island); return { past: +(g.z - p.z).toFixed(2), onDeck: p.x * Math.sin(I.AXIS.bearing) - p.z * Math.cos(I.AXIS.bearing) > sp.rim + I.HEAD.over, feet: +(p.y - a.baseY).toFixed(2), deck: +s.y.toFixed(2) }; })()`);
  record("bifrost entrance: from the pass stairs the roster's widest Ooga walks through the arch out onto the bridge's deck", arch.onDeck && Math.abs(arch.feet - arch.deck) < 0.3, JSON.stringify(arch));
  await b.evaluate(`(() => { const B = window.__ooga, p = B.bifrost.site.portal, sx = Math.sin(p.ry), sz = Math.cos(p.ry), x = p.x + sx * 0.9, z = p.z + sz * 0.9; B.pilot.navigate({ position: { x, y: p.floorY, z }, target: { x: x - sx * 6, y: p.floorY + 1, z: z - sz * 6 }, yaw: Math.atan2(sx, sz), pitch: 0.2, dist: 5 }); B.advance(0.5, 1 / 60); window.__portal = [-sx, -sz]; })()`);
  const inKey = await b.evaluate(`window.__portal`);
  await walkToward(b, inKey[0], inKey[1], 0.8);
  const arrived = await b.evaluate(`(() => { const B = window.__ooga; for (let i = 0; i < 240 && (B.transitioning || B.scene !== "bifrost"); i++) B.advance(1 / 30, 1 / 30); B.advance(0.3, 1 / 30); const d = B.bifrost; return { scene: B.scene, ooga: B.crew && B.crew.player ? B.crew.player.traits.name : null, pictured: !!(d && d.pictured), outside: !!(d && d.outside) }; })()`);
  record("bifrost entrance: walking through the portal's field takes the same Ooga into the chamber, which has DSB Land's picture and the island's view back out", arrived.scene === "bifrost" && arrived.ooga === "portlandhodl" && arrived.pictured && arrived.outside, JSON.stringify(arrived));
} };
const bifrostWalking = { name: "bifrost walking", why: "rule: W A S D walk the visitor's Ooga their way on screen in the chamber", run: async (b) => {
  const ooga = await walkKeys(b, "portlandhodl", 0, 7.5, [0, 2.2], 0.5);
  record("bifrost walking: W A S D walk the visitor's Ooga away, left, back and right on screen in the hall from two camera angles", allWalk(ooga), JSON.stringify(ooga));
} };
const bifrostExit = { name: "bifrost exit", why: "playthrough: walking back out through the field returns the same Ooga to the bridge's end, and Escape leaves the chamber", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, E = window.BL.bifrostModels.ENTRY; B.pilot.navigate({ position: { x: 0, y: 0, z: E.field - 2.2 }, target: { x: 0, y: 1, z: E.field + 4 }, yaw: Math.PI, pitch: 0.2, dist: 5 }); B.advance(0.5, 1 / 60); })()`);
  await walkToward(b, 0, 1, 0.8);
  const back = await b.evaluate(`(() => { const B = window.__ooga; for (let i = 0; i < 240 && (B.transitioning || B.scene !== "hub"); i++) B.advance(1 / 30, 1 / 30); B.advance(0.3, 1 / 30); const p = B.crew.player && B.crew.player.root.position, a = B.bifrost && B.bifrost.site.arrival; return { scene: B.scene, ooga: B.crew.player ? B.crew.player.traits.name : null, fromArrival: p && a ? +Math.hypot(p.x - a.x, p.z - a.z).toFixed(1) : null }; })()`);
  await tourGo(b, "bifrost");
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const escaped = await b.evaluate(`window.__ooga.scene`);
  record("bifrost exit: walking back out through the field returns the same Ooga to the bridge's end, and Escape leaves the chamber", back.scene === "hub" && back.ooga === "portlandhodl" && back.fromArrival !== null && back.fromArrival < 4 && escaped === "hub", JSON.stringify({ back, escaped }));
} };
const bifrostCanvas = { name: "bifrost canvas2d", why: "contract: the Canvas 2D fallback builds ₿IFRÖST's islet without the WebGL window into the chamber, and boots and draws the chamber", run: async (b) => {
  const hub = await b.evaluate(`(() => { const B = window.__ooga; B.pilot.goPreset("bifrost"); B.advance(1, 1 / 60); return { kind: B.renderer.kind, scene: B.scene, islet: !!B.bifrost, window: !!(B.bifrost && B.bifrost.window) }; })()`);
  await tourGo(b, "bifrost");
  const r = await b.evaluate(`(() => { const B = window.__ooga, c = document.getElementById("scene"), t = document.createElement("canvas"); t.width = t.height = 8; const x = t.getContext("2d", { willReadFrequently: true }); x.drawImage(c, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data, seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return { kind: B.renderer.kind, scene: B.scene, colours: seen.size }; })()`);
  record("bifrost canvas2d: with WebGL2 unavailable the island builds ₿IFRÖST's islet without its window into the chamber, and the chamber boots and paints", hub.kind === "canvas2d" && hub.islet && !hub.window && r.kind === "canvas2d" && r.scene === "bifrost" && r.colours >= 4, JSON.stringify({ hub, r }));
} };
// DSB's way home while ₿IFRÖST is open: from the chamber through the DSB window, DSB Land's passage walked, and back
// through DSB's own gate after its dialer.
const bifrostDsb = { name: "bifrost dsb round trip", why: "playthrough: the same Ooga walks through the DSB window into DSB Land, and DSB's gate home brings it back into the chamber before the DSB window", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, r = window.BL.bifrostModels.HALL.r - 2.8, w = B.bifrost.scene.windows.find((w) => w.row.scene === "dsb"), x = w.sn * r, z = w.c * r; B.pilot.navigate({ position: { x, y: 0, z }, target: { x: x + w.sn * 4, y: 1, z: z + w.c * 4 }, yaw: Math.atan2(w.sn, w.c) + Math.PI, pitch: 0.2, dist: 5 }); B.advance(0.5, 1 / 60); window.__dsbWindow = [w.sn, w.c]; })()`);
  const outKey = await b.evaluate(`window.__dsbWindow`);
  await walkToward(b, outKey[0], outKey[1], 1.5);
  const there = await b.evaluate(`(() => { const B = window.__ooga; for (let i = 0; i < 240 && (B.transitioning || B.scene !== "dsb"); i++) B.advance(1 / 30, 1 / 30); return { scene: B.scene, ooga: B.dsb ? B.dsb.avatar.traits.name : null }; })()`);
  if (there.scene === "dsb") {
    await b.evaluate(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); BL.scenes.dsb.update(__ooga.audio.duration + 1, 1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); document.querySelector('[data-action="dsb-skip"]').click(); })()`);
    await dsbExit(b, "bifrost");
  }
  const back = await b.evaluate(`(() => { const B = window.__ooga, d = B.scene === "bifrost" && B.bifrost, a = d && d.avatar, w = d && d.scene.windows.find((w) => w.row.scene === "dsb"), p = a && a.root.position; return { scene: B.scene, ooga: a ? a.traits.name : null, along: p ? +(p.x * w.sn + p.z * w.c - window.BL.bifrostModels.HALL.r).toFixed(2) : null, across: p ? +(p.x * w.c - p.z * w.sn).toFixed(2) : null }; })()`);
  record("bifrost dsb round trip: walking through the DSB window takes the same Ooga into DSB Land, and DSB's gate home brings it back into the chamber, standing before the DSB window", there.scene === "dsb" && there.ooga === "portlandhodl" && back.scene === "bifrost" && back.ooga === "portlandhodl" && back.along > -3.5 && back.along < -2 && Math.abs(back.across) < 0.5, JSON.stringify({ there, back }));
} };
// The poker room's window: from the chamber straight into the room, without the fade, as the room's mirror back does,
// and out through that mirror before the window again. The scene changing on the step after the crossing starts is the
// instant cut; a fade would take a quarter second.
const bifrostPoker = { name: "bifrost poker round trip", why: "playthrough: the same Ooga walks through the poker window straight into the poker room, and the room's mirror brings it back into the chamber before that window", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, r = window.BL.bifrostModels.HALL.r - 1.6, w = B.bifrost.scene.windows.find((w) => w.row.scene === "poker"), x = w.sn * r, z = w.c * r; B.pilot.navigate({ position: { x, y: 0, z }, target: { x: x + w.sn * 4, y: 1, z: z + w.c * 4 }, yaw: Math.atan2(w.sn, w.c) + Math.PI, pitch: 0.2, dist: 5 }); B.advance(0.5, 1 / 60); window.__pokerWindow = [w.sn, w.c]; })()`);
  const inKey = await b.evaluate(`window.__pokerWindow`);
  const k = await walkToward(b, inKey[0], inKey[1], 0.1);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k, code: "Key" + k.toUpperCase() });
  const there = await b.evaluate(`(() => { const B = window.__ooga; let started = -1, arrived = -1;
    for (let i = 0; i < 180 && arrived < 0; i++) { B.advance(1 / 60, 1 / 60); if (started < 0 && B.transitioning) started = i; if (B.scene === "poker") arrived = i; }
    return { scene: B.scene, ooga: B.crew && B.crew.player ? B.crew.player.traits.name : null, steps: arrived - started, started }; })()`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: "Key" + k.toUpperCase() });
  if (there.scene === "poker") {
    // The poker scene's debug handle carries no camera, so the key that walks toward its mirror (+z) on screen is read
    // from the scene's own.
    const out = await b.evaluate(`(() => { const B = window.__ooga; B.pilot.navigate({ position: { x: 0, y: 0, z: 31 }, target: { x: 0, y: 1, z: 35 }, yaw: Math.PI, pitch: 0.15, dist: 4 }); B.advance(0.5, 1 / 60);
      const c = BL.scenes.poker.camera, fx = c.target.x - c.position.x, fz = c.target.z - c.position.z, l = Math.hypot(fx, fz), f = [fx / l, fz / l], r = [-f[1], f[0]];
      const score = { w: f[1], s: -f[1], d: -r[1], a: r[1] }; return Object.entries(score).sort((p, q) => q[1] - p[1])[0][0]; })()`);
    await holdKey(b, out, 2.5);
  }
  const back = await b.evaluate(`(() => { const B = window.__ooga; for (let i = 0; i < 60 && (B.transitioning || B.scene !== "bifrost"); i++) B.advance(1 / 30, 1 / 30); const d = B.scene === "bifrost" && B.bifrost, a = d && d.avatar, w = d && d.scene.windows.find((w) => w.row.scene === "poker"), p = a && a.root.position; return { scene: B.scene, ooga: a ? a.traits.name : null, along: p ? +(p.x * w.sn + p.z * w.c - window.BL.bifrostModels.HALL.r).toFixed(2) : null, across: p ? +(p.x * w.c - p.z * w.sn).toFixed(2) : null }; })()`);
  record("bifrost poker round trip: walking through the poker window takes the same Ooga straight into the poker room, without the fade, and the room's mirror brings it back into the chamber, standing before that window", there.scene === "poker" && there.ooga === "portlandhodl" && there.started >= 0 && there.steps <= 2 && back.scene === "bifrost" && back.ooga === "portlandhodl" && back.along > -3.5 && back.along < -2 && Math.abs(back.across) < 0.5, JSON.stringify({ there, back }));
} };
const arcadeWalking ={ name: "arcade walking", why: "rule: W A S D walk the visitor's Ooga their way on screen in Ooga Arcade, as they do on the island", run: async (b) => {
  const ooga = await walkKeys(b, "portlandhodl", 0, -1, [0, 2.2], 0.5);
  record("arcade walking: W A S D walk the visitor's Ooga away, left, back and right on screen on the hall floor from two camera angles", allWalk(ooga), JSON.stringify(ooga));
} };
const arcadePlay = { name: "arcade play", why: "rule: a cabinet starts its game, the game's exit comes back to that cabinet as the same Ooga, and Escape leaves for the island", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, a = B.cavemen.get("portlandhodl"), s = window.BL.arcadeModels.CABINETS[0].play; if (B.crew.player !== a) B.pilot.possess(a); a.root.position.x = s.x; a.root.position.z = s.z; B.advance(0.2, 1 / 60); })()`);
  await b.key(" ");
  const played = await untilPage(b, 'B.scene === "race" && !B.transitioning', 15000);
  await b.evaluate(`(() => { const go = document.querySelector('[data-intro="race"] [data-action="intro-go"]'); if (go && go.offsetParent) go.click(); document.querySelector('nav[data-scene="race"] .leave').click(); })()`);
  await untilPage(b, 'B.scene === "arcade" && !B.transitioning', 15000);
  const back = await b.evaluate(`(() => { const B = window.__ooga, p = B.pilot.player, s = window.BL.arcadeModels.CABINETS[0].play; return { scene: B.scene, who: p && p.traits.name, off: p ? Math.hypot(p.root.position.x - s.x, p.root.position.z - s.z) : null }; })()`);
  await b.key("Escape");
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const out = await b.evaluate(`(() => { const B = window.__ooga, p = B.pilot.player; return { scene: B.scene, who: p && p.traits.name }; })()`);
  record("arcade play: Space at the Rally cabinet starts Ooga Rally, leaving the race returns the same Ooga to that cabinet, and Escape takes them out to the island", played && back.scene === "arcade" && back.who === "portlandhodl" && back.off < 0.5 && out.scene === "hub" && out.who === "portlandhodl", JSON.stringify({ played, back, out }));
} };
const arcadeMachine = { name: "arcade machine", why: "rule: Space at a carnival machine opens its game, and leaving the game brings the same Ooga back to that machine", run: async (b) => {
  await b.evaluate(`(() => { const B = window.__ooga, st = B.arcade.stations.find((s) => s.kind === "machine" && s.game.kind === "skee"), p = B.pilot.player.root.position; p.x = st.play.x; p.z = st.play.z; B.advance(0.2, 1 / 60); })()`);
  await b.key(" ");
  const opened = await untilPage(b, 'B.scene === "skee" && !B.transitioning', 15000);
  // The first Escape closes the title card, the second leaves the game.
  await b.key("Escape");
  await b.evaluate("window.__ooga.advance(0.1, 1 / 60)");
  await b.key("Escape");
  await untilPage(b, 'B.scene === "arcade" && !B.transitioning', 15000);
  const back = await b.evaluate(`(() => { const B = window.__ooga, st = B.arcade.stations.find((s) => s.kind === "machine" && s.game.kind === "skee"), p = B.pilot.player; return { scene: B.scene, who: p && p.traits.name, off: p ? Math.hypot(p.root.position.x - st.play.x, p.root.position.z - st.play.z) : null }; })()`);
  record("arcade machine: Space at the skee-ball machine opens skee-ball, and Escape brings the same Ooga back to the machine", opened && back.scene === "arcade" && back.who === "portlandhodl" && back.off < 0.5, JSON.stringify({ opened, back }));
} };
// A carnival game from its title card to its results: a press every `step` seconds (the hoop shot presses only
// outside the green, so the first round is missed and ends on time), then the saved best and the tickets it paid.
const carnivalPlay = (kind, step) => ({ name: `${kind} playthrough`, why: "playthrough: the carnival game runs from its title card through its rounds to results, and saves its best and the tickets it paid", run: async (b) => {
  const before = await b.evaluate("window.__ooga.game.state.arcade.tickets");
  await b.key("Enter");
  await b.evaluate("window.__ooga.advance(3.5, 1 / 60)");
  for (let i = 0; i < 400 && (await b.evaluate("window.__ooga.carnival.phase")) === "play"; i++) {
    const s = await b.evaluate("window.__ooga.carnival.status");
    if (kind !== "hoops" || s.meter < s.window0 || s.meter > s.window1) await b.key(" ");
    await b.evaluate(`window.__ooga.advance(${step}, 1 / 60)`);
  }
  await b.evaluate("window.__ooga.advance(1.5, 1 / 60)");
  const r = await b.evaluate(`(() => { const B = window.__ooga, a = B.game.state.arcade; return { phase: B.carnival.phase, score: B.carnival.status.score, best: a["${kind}"], tickets: a.tickets, paid: B.carnival.tickets(B.carnival.status.score), shown: !document.getElementById("carnival-results").hidden }; })()`);
  // The run pays once: an end reported twice (a later substep of the same frame) once paid its tickets again.
  record(`${kind} playthrough: the game reaches its results card, and its best and tickets are saved, paid once`, r.phase === "results" && r.shown && r.best === r.score && r.tickets === before + r.paid, JSON.stringify({ ...r, before }));
} });
const factoryCanvas = { name: "factory canvas2d", why: "contract: the Canvas 2D fallback boots and draws the factory", run: async (b) => {
  const r = await b.evaluate(`(() => { const B = window.__ooga, c = document.getElementById("scene"), t = document.createElement("canvas"); t.width = t.height = 8; const x = t.getContext("2d", { willReadFrequently: true }); x.drawImage(c, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data, seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); return { kind: B.renderer.kind, scene: B.scene, colours: seen.size }; })()`);
  record("factory canvas2d: with WebGL2 unavailable the factory still boots and paints", r.kind === "canvas2d" && r.scene === "factory" && r.colours >= 4, JSON.stringify(r));
} };

scene("hub", { steps: [{ name: `work movement lab lanes ${1 / RATES[0]}Hz`, why: "regression: work walkers left their facing-right side of the lab lane", open: "on about 4 boots in 30 the lane targets sit on the centre or far side; unfixed", run: labLanes }, donation("hub"), hubWalking, hubMapNavigation, hubRainforestSteps, hubRoutes, hubFall, trip("hub")] });
scene("hub", { query: "ooga=portlandhodl:clank:lab,obl,lf&ooga=w-s-bitcoin:clank:lab,obl,lf&ooga=bc1gui:clank:lab,obl,lf&ooga=DrNeski:clank:lab,obl,lf&ooga=2140data:clank:lab,obl,lf", steps: [{ name: "work movement cave trips", why: "regression: off-lane cave traffic aimed through obstacles and started backwards detours", run: workCaveTrips }] });
scene("hub", { label: "room sign", query: "pos=0", steps: [{ name: "room sign copies hash", why: "rule: tapping a room sign swings it and copies its displayed eight-character code with visible confirmation", run: async (b) => {
  const point = await b.evaluate(`(() => { const B = __ooga, sign = B.headquarters.roomSigns[0], n = sign.node; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (value) => { window.__roomHash = value; return Promise.resolve(); } } }); window.__roomSignBefore = sign.hits; B.pilot.release(true); B.pilot.navigate({ position: { x: n.position.x, y: n.position.y, z: n.position.z }, target: { x: n.position.x, y: n.position.y - 0.2, z: n.position.z }, yaw: n.rotation.y, pitch: 0, dist: 4 }); B.advance(0.6, 1 / 60); return B.project(n.position.x, n.position.y - 0.2, n.position.z, {}); })()`);
  await b.click(point.x, point.y);
  for (let i = 0; i < 20 && !(await b.evaluate(`!!window.__roomHash`)); i++) await b.sleep(10);
  const state = await b.evaluate(`(() => { const B = __ooga, sign = B.headquarters.roomSigns[0], meta = sign.node.geometry.roomLifehashSign; B.advance(0.08, 1 / 60); return { expected: meta.lines[0], copied: window.__roomHash || "", angle: sign.node.rotation.x, velocity: sign.velocity, hits: sign.hits, before: window.__roomSignBefore, toast: document.getElementById("toast").textContent, code: meta.lines[0] }; })()`);
  record("room sign: a pointer tap drives the hanging spring, copies its displayed eight-character code, and confirms it in the toast", state.copied === state.expected && state.expected.length === 8 && state.hits === state.before + 1 && Math.abs(state.angle) > 0.01 && Math.abs(state.velocity) > 0.01 && state.toast === `Room hash ${state.code} copied to clipboard`, JSON.stringify(state));
} }] });
// Contract fixtures cover all six public API shapes without live network dependencies.
const TIMECHAIN_FIXTURES = [
  [{ blockheight: 968330, tag: "Individuals", total: 15 }, { blockheight: 968330, tag: "CEXs", total: 5 }, { blockheight: 968330, tag: "To Be Mined", total: 10 }],
  [{ blocktime: "2026-09-23", Bracket: "0 - 1 BTC", TotalAddresses: 3, TotalSats: 100000000 }, { blocktime: "2026-09-23", Bracket: "1+ BTC", TotalAddresses: 1, TotalSats: 500000000 }],
  [{ blocktime: "2026-09-23", Bracket: "0 - 1 BTC", TotalUTXOS: 8, TotalSats: 200000000 }, { blocktime: "2026-09-23", Bracket: "1+ BTC", TotalUTXOS: 2, TotalSats: 900000000 }],
  [{ tag: "ETFs/ETPs", total_20260923235648: 100, diff_total_20260922233128: 0, diff_total_20260916232853: -2, diff_total_20260823234040: 7 }],
  [{ tag: "CEXs", total_20260923235648: 200, diff_total_20260922233128: -3, diff_total_20260916232853: 4 }],
  Array.from({ length: 10 }, (_, i) => ({ entity: "Holder " + (i + 1), tag: "Companies", total: 100 - i, addcount: i + 1, utxos: i + 2 }))
];
// Rule: public readings keep units, missing comparisons, and fetch lifecycle truthful.
const timechainDataChecks = async () => {
  let id = 0, mode = "ok", updates = 0;
  const timers = new Map(), listeners = new Set(), requests = [], pending = [];
  const context = { window: { BL: {} }, URLSearchParams, location: { search: "" }, AbortController,
    document: { hidden: false, addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } },
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const index = context.window.BL.timechainData.ENDPOINTS.indexOf(url.split("/").pop());
      if (mode === "pending") return new Promise(resolve => pending.push(() => resolve({ ok: true, json: async () => TIMECHAIN_FIXTURES[index] })));
      if (mode === "fail" && index === 0) return { ok: false, headers: { get: () => "120" } };
      return { ok: true, json: async () => mode === "bad" && index === 0 ? [] : TIMECHAIN_FIXTURES[index] };
    }
  };
  runInNewContext(await readFile(new URL("../src/js/timechain-data.js", import.meta.url), "utf8"), context);
  const T = context.window.BL.timechainData, parsed = TIMECHAIN_FIXTURES.map((data, i) => T.parse(i, data));
  record("timechain API: units, excluded unmined supply, signed changes and snapshot metadata stay distinct", parsed[0].lines[1] === "Individuals 75.0%" && parsed[1].note.includes("1 BTC") && parsed[2].lines[0] === "10 UTXOS" && parsed[3].lines.includes("1D 0 BTC") && parsed[3].lines.includes("7D -2 BTC") && parsed[3].lines.includes("1M +7 BTC") && parsed[3].lines.includes("90D UNAVAILABLE") && parsed[5].note.includes("10. Holder 10") && parsed[5].table.some(row => row.startsWith("10. Holder 10")) && parsed[5].snapshotDate === "" && parsed[5].blockHeight === null);
  let rejected = 0;
  for (const [index, data] of [[0, []], [0, [{ blockheight: 1, tag: "X", total: -1 }]], [1, [{ blocktime: "2026-02-30", Bracket: "X", TotalAddresses: 1, TotalSats: 1 }]], [2, [{ blocktime: "2026-09-23", Bracket: "X", TotalUTXOS: null, TotalSats: 1 }]]]) {
    try { T.parse(index, data); } catch { rejected++; }
  }
  record("timechain API: invalid dates, counts and balances cannot become readings", rejected === 4);
  const feed = T.create(() => updates++); feed.start(); await feed.refresh();
  const initial = requests.length === 6 && requests.every(r => r.options.credentials === "omit" && !r.options.headers) && feed.boards.every(b => b.checked && b.status === "LIVE API" && b.asof === "2026-09-23 / BLOCK 968330");
  const old = feed.boards[0].checked; mode = "fail"; await feed.refresh();
  const stale = feed.boards[0].checked === old && feed.boards[0].lines.length && feed.boards[0].status === "STALE / RETRYING" && feed.boards[1].status === "LIVE API" && [...timers.values()].some(t => t.ms === 120000);
  mode = "bad"; await feed.refresh(); const invalid = feed.boards[0].status === "STALE / RETRYING";
  mode = "ok"; await feed.refresh(); const recovered = feed.boards.every(b => b.status === "LIVE API");
  context.document.hidden = true; for (const fn of listeners) fn(); const count = requests.length; await feed.refresh();
  const hidden = requests.length === count && !timers.size;
  context.document.hidden = false; for (const fn of listeners) fn();
  mode = "pending"; const flight = feed.refresh(), duplicate = feed.refresh();
  const once = requests.length === count + 6, before = updates;
  feed.dispose(); const aborted = requests.slice(-6).every(r => r.options.signal.aborted);
  pending.forEach(finish => finish()); await flight; await duplicate;
  record("timechain API: isolated failures retain readings, recover, obey Retry-After and clean up hidden or disposed requests", initial && stale && invalid && recovered && hidden && once && aborted && updates === before && !timers.size && !listeners.size);
  pending.length = 0;
  const changed = [], late = T.create(index => changed.push(index));
  const loading = late.refresh();
  pending[5](); await new Promise(resolve => setImmediate(resolve));
  const holderChecked = late.boards[5].checked;
  pending[0](); await new Promise(resolve => setImmediate(resolve));
  const gotHeight = late.boards[5].asof === "BLOCK 968330";
  pending[1](); await new Promise(resolve => setImmediate(resolve));
  const gotBoth = late.boards[5].asof === "2026-09-23 / BLOCK 968330" && late.boards[5].checked === holderChecked;
  pending[2](); pending[3](); pending[4](); await loading; late.dispose();
  record("timechain API: late sibling metadata fills and repaints the holder view without changing its fetch time", gotHeight && gotBoth && changed.filter(i => i === 5).length >= 3 && late.boards.every(b => b.asof === "2026-09-23 / BLOCK 968330"));
};
for (const fallback of [false, true]) scene("hub", { label: "timechain " + (fallback ? "canvas2d" : "webgl2"), query: "solo=1&character=SaniExp&view=timechain&pos=0" + (fallback ? "&canvas2d=1" : ""), steps: [{ name: "timechain crossing", why: "playthrough: Sani can stand and walk on Timechain Island, cross both bridge shores, and fall beyond its real edge", run: async (b) => {
  const result = await b.evaluate(`(() => {
    const B = __ooga, T = BL.scenes.hub.debug.timechainIsland, p = T.place, S = B.headquarters.solids, c = B.pilot.player;
    const dir = BL.timechainModels.DIR, failures = [];
    for (const reverse of [false, true]) {
      const meadow = Math.hypot(p.x, p.z) - (B.path.ringOuterRadius + 1);
      // Cross both shores to the arrival area, stopping before the console and recliner.
      const start = reverse ? 4.8 : meadow, end = reverse ? meadow : 4.8;
      const count = Math.ceil(Math.abs(end - start) / 0.15);
      let x = p.x - dir.x * start, z = p.z - dir.z * start, y = S.supportAt(x, z, p.y + 0.2, p.y + 0.2, c);
      for (let i = 1; i <= count; i++) {
        const d = start + (end - start) * i / count, nx = p.x - dir.x * d, nz = p.z - dir.z * d;
        const floor = S.supportAt(nx, nz, y, y, c);
        if (floor < -0.1 || Math.abs(floor - y) > 0.6 || !S.walkable(x, z, nx, nz, y, c.bodyHeight, c)) { failures.push({ reverse, d, y, floor }); break; }
        x = nx; z = nz; y = floor;
      }
    }
    const edgeX = p.x + dir.x * (BL.timechainModels.SITE.radius + 2), edgeZ = p.z + dir.z * (BL.timechainModels.SITE.radius + 2);
    let path = true;
    for (let r = B.path.ringOuterRadius + 1; r < p.rim; r += 0.25) path = path && B.island.isPath(dir.x * r, dir.z * r);
    return { name: c.traits.name, display: c.contributor.display, distance: Math.hypot(c.root.position.x - p.x, c.root.position.z - p.z), feet: c.root.position.y - c.baseY, floor: p.y, failures, path, edge: S.supportAt(edgeX, edgeZ, p.y, p.y, c), x: c.root.position.x, z: c.root.position.z };
  })()`);
  record("timechain: Sani arrives safely, both shores are walkable and the edge has no invisible floor", result.name === "SaniExp" && result.display === "Sani" && result.distance < 5 && Math.abs(result.feet - result.floor) < 0.1 && !result.failures.length && result.edge < -50, JSON.stringify(result));
  record("timechain: the painted path connects the meadow ring to the bridge over the terraces", result.path);
  await holdKey(b, "d", 0.6);
  const moved = await b.evaluate(`(() => { const c = __ooga.pilot.player; return { x: c.root.position.x, z: c.root.position.z, feet: c.root.position.y - c.baseY }; })()`);
  record("timechain: keyboard movement carries Sani across the grass without falling", Math.hypot(moved.x - result.x, moved.z - result.z) > 0.5 && Math.abs(moved.feet - result.floor) < 0.1, JSON.stringify(moved));
  await b.evaluate(`(async () => {
    const original = window.fetch, fixtures = ${JSON.stringify(TIMECHAIN_FIXTURES)};
    window.fetch = async url => ({ ok: true, json: async () => fixtures[BL.timechainData.ENDPOINTS.indexOf(url.split('/').pop())] });
    try { await BL.scenes.hub.debug.timechainIsland.boards.refresh(); } finally { window.fetch = original; }
  })()`);
  const boards = await b.evaluate(`(() => {
    const D = BL.scenes.hub.debug, T = D.timechainIsland;
    document.getElementById('sheet').hidden = true; __ooga.pilot.release(true); __ooga.pilot.goPreset('timechain');
    return { count: T.boards.entries.length, loaded: T.boards.data.every(d => d.lines.length && d.asof && d.checked),
      bounded: T.boards.entries.every(e => e.panel.geometry.verts.length < 100000),
      complete: T.boards.entries.every((e, i) => e.rowCount >= T.boards.data[i].table.length && e.node.visible && e.panel.visible),
      noTabs: !D.props.some(p => p.prop === 'timechaintab') };
  })()`);
  boards.pointer = [];
  for (let index = 0; index < 6; index++) {
    await b.evaluate(`(() => {
      const B = __ooga, T = BL.scenes.hub.debug.timechainIsland, p = T.place, o = B.pilot.orbit;
      const yaw = p.ry - T.boards.entries[${index}].angle;
      Object.assign(o, { yaw, tYaw: yaw, pitch: 0.03, tPitch: 0.03, dist: 3, tDist: 3, tx: p.x, ty: p.y + 4.4, tz: p.z });
      Object.assign(o.target, { x: p.x, y: p.y + 4.4, z: p.z }); B.advance(0.5, 1 / 60);
    })()`);
    await b.sleep(50);
    const point = await b.evaluate(`(() => {
      const m = BL.scenes.hub.debug.timechainIsland.boards.entries[${index}].node.world;
      const p = __ooga.project(m[12] + m[4] * 5.2 - m[8] * 12.5, m[13] + m[5] * 5.2 - m[9] * 12.5, m[14] + m[6] * 5.2 - m[10] * 12.5);
      return { x: p.x, y: p.y };
    })()`);
    await b.click(point.x, point.y);
    boards.pointer.push(await b.evaluate(`(() => {
      const T = BL.scenes.hub.debug.timechainIsland, note = document.getElementById('board-note');
      return document.getElementById('board-modal').open && document.getElementById('board-caption').textContent === BL.timechainData.TITLES[${index}]
        && note.textContent.includes(T.boards.data[${index}].source) && !note.textContent.includes('api.timechainindex.com');
    })()`));
    await b.evaluate(`document.querySelector('[data-action="board-close"]').click()`);
  }
  boards.independent = await b.evaluate(`(() => {
    const T = BL.scenes.hub.debug.timechainIsland, before = T.boards.entries.map(e => e.panel.geometry);
    BL.scenes.hub.debug.useProp(BL.scenes.hub.debug.props.find(p => p.prop === 'timechainboard' && p.boardIndex === 5));
    document.querySelector('[data-action="board-next"]').click();
    const wraps = document.getElementById('board-caption').textContent === BL.timechainData.TITLES[0];
    document.querySelector('[data-action="board-close"]').click();
    return wraps && T.boards.entries.every((e, i) => e.panel.geometry === before[i]);
  })()`);
  record("timechain " + (fallback ? "canvas2d" : "webgl2") + ": six complete wall sections stay visible and open their own details", boards.count === 6 && boards.loaded && boards.bounded && boards.complete && boards.noTabs && boards.independent && boards.pointer.every(Boolean), JSON.stringify(boards));
} }, trip("hub")] });
scene("hub", { label: "timechain resident", steps: [{ name: "timechain resident", why: "regression: Sani slept in HQ on ordinary visits, leaving his island empty", run: async (b) => {
  const result = await b.evaluate(`(() => {
    const B = __ooga, D = BL.scenes.hub.debug, T = D.timechainIsland, c = B.cavemen.get('SaniExp'), s = T.seat;
    const read = () => ({ visible: c.root.visible, seated: s.active, distance: Math.hypot(c.root.position.x - s.x, c.root.position.z - s.z), lean: c.root.rotation.x, leg: c.parts.legL.rotation.x, facingScreen: Math.cos(c.root.rotation.y - T.place.ry) < -0.99 });
    const before = read(), arm = c.parts.armL.rotation.x; c.act.until = 0; B.advance(0.25, 1 / 60);
    const typing = c.parts.armL.rotation.x !== arm;
    const spin = rate => {
      T.beer.pause();
      s.angle = s.speed = 0;
      D.useProp(D.props.find(p => p.prop === 'timechainchair'));
      B.advance(2, rate);
      return { angle: s.angle, speed: s.speed, together: Math.abs(c.root.rotation.y - T.place.ry - T.site.swivel.rotation.y) < 1e-8 && T.site.laptop.parent === T.site.swivel };
    };
    const slow = spin(1 / 30), fast = spin(1 / 120);
    B.advance(36, 1 / 30); const stopped = s.speed === 0, sitting = read();
    B.pilot.possess(c); const controlled = B.pilot.player === c; B.pilot.release(true); B.refreshStates(); B.advance(1, 1 / 30);
    const sideStations = [T.beer.dispenser, T.beer.cabinet, T.beer.bin].every(node => Math.hypot(node.position.x, node.position.z) > 11.5);
    return { before, sitting, after: read(), typing, slow, fast, stopped, controlled, released: !B.pilot.player, centered: T.site.chair.position.x === 0 && T.site.chair.position.z > 0, sideStations };
  })()`);
  record("timechain: Sani types in his recliner, spins with his laptop independently of frame rate, and beer gear hugs the sphere wall", result.centered && result.sideStations && result.before.facingScreen && result.controlled && result.released && result.typing && result.stopped && result.slow.together && result.fast.together && result.slow.angle > 1 && Math.abs(result.slow.angle - result.fast.angle) < 1e-7 && [result.before, result.sitting, result.after].every(s => s.visible && s.seated && s.distance < 0.001 && s.lean < -0.1 && s.leg < -0.5), JSON.stringify(result));
  const beer = await b.evaluate(`(() => {
    const B = __ooga, T = BL.scenes.hub.debug.timechainIsland, c = B.cavemen.get('SaniExp'), beer = T.beer;
    const cycle = rate => {
      beer.pause(); Object.assign(beer.state, { litres: 0.5, sips: 0, refills: 0 });
      let empty = false, filling = false, walked = false, previous = 0, increasing = true, drinkArm = 0;
      for (let i = 0; i < 130 * rate; i++) {
        beer.update(c, T.seat, 1 / rate);
        const s = beer.state;
        if (s.mode === 'chug') drinkArm = Math.min(drinkArm, c.parts.armR.rotation.x);
        if (s.mode === 'rise') empty ||= s.litres < 0.001;
        if (s.mode === 'walk') walked ||= Math.hypot(c.root.position.x - T.seat.x, c.root.position.z - T.seat.z) > 3;
        if (s.mode === 'fill') {
          filling ||= beer.stream.visible && beer.mug.parent === beer.dispenser;
          increasing &&= s.litres >= previous; previous = s.litres;
        }
      }
      return { ...beer.state, empty, filling, walked, increasing, drinkArm, streamOff: !beer.stream.visible };
    };
    const slow = cycle(30), fast = cycle(120);
    B.advance(0.1, 1 / 60);
    const returned = Math.hypot(c.root.position.x - T.seat.x, c.root.position.z - T.seat.z) < 0.001;
    B.pilot.possess(c); B.advance(0.1, 1 / 60);
    const paused = !beer.mug.visible && !beer.stream.visible && beer.state.elapsed === 0;
    B.pilot.release(true); B.refreshStates(); B.advance(0.1, 1 / 60);
    const journey = action => {
      beer.pause(); Object.assign(beer.state, { litres: 0.5, sips: 0, refills: 0, cleaned: 0, replaced: 0 });
      const prop = action === 'chug' ? 'timechainbeer' : 'timechainchair';
      D.useProp(D.props.find(p => p.prop === prop));
      const triggered = beer.state.mode === action || action === 'spin' && beer.state.mode === 'spin';
      const phases = new Set(); let drinkArm = 0;
      for (let i = 0; i < 40 * 60; i++) { beer.update(c, T.seat, 1 / 60); phases.add(beer.state.mode); if (beer.state.mode === 'chug') drinkArm = Math.min(drinkArm, c.parts.armR.rotation.x); }
      return { triggered, phases: [...phases], ...beer.state, drinkArm, shardsHidden: !beer.shards.visible, streamOff: !beer.stream.visible };
    };
    const chug = journey('chug'), spin = journey('spin');
    B.advance(0.1, 1 / 60);
    return { slow, fast, returned, paused, resumed: beer.mug.visible, chug, spin };
  })()`);
  record("timechain: an empty half-litre triggers a walk, visible refill and return, independent of frame rate and paused by control", beer.returned && beer.paused && beer.resumed && [beer.slow, beer.fast].every(s => s.empty && s.filling && s.walked && s.increasing && s.streamOff && s.mode === "work" && s.litres === 0.5 && s.sips === 5 && s.refills === 1) && Math.abs(beer.slow.elapsed - beer.fast.elapsed) < 1e-7, JSON.stringify(beer));
  record("timechain: chair clicks spill the glass, cup clicks chug it at mouth level, and cleanup restores a half-litre glass", [beer.chug, beer.spin].every(s => s.triggered && s.phases.includes("fill") && s.phases.includes("return") && s.mode === "work" && s.litres === 0.5 && s.refills === 1 && s.streamOff) && beer.chug.phases.includes("chug") && beer.chug.drinkArm > -2 && beer.chug.cleaned === 0 && beer.chug.replaced === 0 && beer.spin.phases.includes("clean") && beer.spin.phases.includes("discard") && beer.spin.cleaned === 1 && beer.spin.replaced === 1 && !beer.spin.broken && beer.spin.shardsHidden, JSON.stringify({ chug: beer.chug, spin: beer.spin }));
} }] });
scene("hub", { label: "chilling", query: "status=chillin&pos=0", steps: [{ name: "chilling Ooga placement", why: "regression: chilling Oogas spawned beside the banana pile and 2140data spun his nunchaku as a permanent idle stance", run: async (b) => {
  const state = await b.evaluate(`(() => { const B = __ooga, inner = B.path.ringOuterRadius + 1.5, rows = [...B.cavemen.values()].map(c => ({ name: c.traits.name, state: c.state, radius: Math.hypot(c.root.position.x, c.root.position.z), snack: c.parts.snack.visible })); const c = B.cavemen.get("2140data"); B.advance(2, 1 / 60); return { inner, rows, spin: c.parts.chukTrail.some(n => n.visible), clubYaw: c.parts.club.rotation.y }; })()`);
  record("chilling Oogas: every Ooga rests beyond the banana ring without eating, and 2140data carries rather than continuously spins his nunchaku", state.rows.every(c => c.state === "chilling" && c.radius >= state.inner && !c.snack) && !state.spin && Math.abs(state.clubYaw) < 1e-6, JSON.stringify(state));
  const seated = await b.evaluate(`(() => {
    const gorilla = BL.agent.create({ managed: true, groundAt: () => 0 }), motion = { groom: 0, groomPhase: 0 };
    const parts = [gorilla.parts.head, gorilla.parts.armL, gorilla.parts.armR];
    gorilla.poseManaged(2, 0, 0, 0, 0, 0, false, false, "sit", motion);
    const low = parts.map(part => part.rotation.x), high = low.slice();
    let compact = true, displacement = 0;
    for (let frame = 0; frame < 9 * 60; frame++) {
      motion.groomPhase = frame / 60;
      gorilla.poseManaged(1 / 60, 0, 0, 0, 0, 0, false, false, "sit", motion);
      for (let i = 0; i < parts.length; i++) { low[i] = Math.min(low[i], parts[i].rotation.x); high[i] = Math.max(high[i], parts[i].rotation.x); }
      compact &&= gorilla.sitCompact;
      displacement = Math.max(displacement, Math.hypot(gorilla.root.position.x, gorilla.root.position.y, gorilla.root.position.z));
    }
    gorilla.dispose(); return { ranges: high.map((value, i) => value - low[i]), compact, displacement };
  })()`);
  record("seated gorillas: within one short rest the head and both arms move subtly while the seated footprint and root stay planted", seated.ranges.every(range => range > 0.02 && range < 0.2)
    && seated.compact && seated.displacement === 0, JSON.stringify(seated));
  const crowd = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, group = C.list.slice(0, 3), shape = BL.agent.torso;
    B.pilot.release(true); C.release();
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    for (const prop of B.props) prop.node.visible = false;
    for (const e of C.list) {
      C.cancelDebugMove(e);
      e.owner.override = e.owner.state = group.includes(e) ? "chilling" : "away";
      e.active = e.root.visible = group.includes(e);
    }
    const setup = spacing => group.forEach((e, i) => {
      const x = 7 + i * spacing, z = 0, y = B.island.surfaceAt(x, z);
      Object.assign(e.root.position, { x, y, z });
      Object.assign(e, { active: true, controlled: false, mode: "chilling", phase: "chill", route: "", fromSite: -1,
        lounge: "", loungeDepart: false, parked: false, biped: false, recover: 0, rest: 120, heading: 0, speed: 0,
        pound: 0, beat: 0, stand: 0, exitFootprint: false, goalX: 9, goalY: y, goalZ: 4,
        footprintMode: "walk", radius: BL.clankers.WALK_RADIUS, height: BL.clankers.WALK_HEIGHT });
      e.jump.active = e.climb.active = e.drive.airborne = e.drive.resume = e.fire.burning = e.fire.rolling = false;
      Object.assign(e.climb, { searchPending: false, claimPending: false, crestPending: false, retry: 0 });
      Object.assign(e.motion, { lab: false, labRunIn: false, climb: 0, climbBlend: NaN, mantle: 0, roll: 0,
        rollAngle: 0, supportOffset: 0, smash: false, landing: 0, takeoff: 0 });
      Object.assign(e.roam, { lastPose: "", transition: 0, nextChoice: 1000, progressTime: 0 });
      e.stuck.x = NaN; e.stuck.time = e.stuck.taskTime = 0; e.stuck.taskActive = false;
      e.gorilla.poseManaged(2, x, y, z, 0, 0, false, false, "", e.motion);
      e.compact = e.gorilla.compact;
    });
    const overlaps = () => group.some((a, i) => group.slice(i + 1).some(b => {
      const p = a.root.position, q = b.root.position;
      return shape.overlaps(a, p.x, p.y, p.z, a.heading, b, q.x, q.y, q.z, b.heading, 0.03);
    }));
    const recoveries = C.stats().recoveries;
    setup(0.55); const initiallyCrowded = overlaps();
    let maxStep = 0, airborne = false;
    for (let frame = 0; frame < 4 * 60; frame++) {
      const before = group.map(e => ({ ...e.root.position })); C.update(1 / 60);
      group.forEach((e, i) => { const p = e.root.position, q = before[i];
        maxStep = Math.max(maxStep, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
        airborne ||= e.jump.active || e.drive.airborne || e.climb.active;
      });
    }
    const separated = !overlaps();
    setup(2.5); let approachClear = !overlaps();
    for (let frame = 0; frame < 4 * 60; frame++) { C.update(1 / 60); approachClear &&= !overlaps(); }
    return { count: group.length, initiallyCrowded, separated, approachClear, maxStep, airborne,
      recoveries: C.stats().recoveries - recoveries };
  })()`);
  record("gorilla crowd: three overlapping NPC trunks step apart without jumping or relocation, and converging walkers keep their trunks apart",
    crowd.count === 3 && crowd.initiallyCrowded && crowd.separated && crowd.approachClear
    && crowd.maxStep < 0.08 && !crowd.airborne && !crowd.recoveries, JSON.stringify(crowd));
} }, { name: "Oogas walk over gorillas", why: "regression: gorilla back attachments dragged Oogas sideways and automatically launched NPC passengers", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, P = B.pilot, c = B.cavemen.get("portlandhodl"), e = C.list.find(e => e.owner === c);
    P.release(true); C.release();
    for (const other of C.list) {
      other.owner.override = other.owner.state = other === e ? "chilling" : "away";
      other.active = other.root.visible = other === e;
    }
    for (const cave of B.cavemen.values()) cave.root.visible = cave === c;
    for (const prop of B.props) prop.node.visible = false;
    Object.assign(e, { active: true, phase: "chill", mode: "chilling", route: "", fromSite: -1, lounge: "", loungeDepart: false,
      parked: false, biped: false, recover: 0, rest: 120, pound: 0, beat: 0, stand: 0, heading: 0, speed: 0 });
    e.jump.active = e.climb.active = e.drive.airborne = e.fire.burning = e.fire.rolling = false;
    Object.assign(e.motion, { lab: false, climb: 0, climbBlend: NaN, mantle: 0, supportOffset: 0, landing: 0, takeoff: 0 });
    Object.assign(e.root.position, { x: -8, y: 0, z: 8 });
    e.gorilla.poseManaged(2, -8, 0, 8, 0, 0, false, false, "", e.motion);
    BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.companions.sync(); C.possess(e);
    c.root.visible = true; c.root.quaternion = null; c.walk = null; c.bedTravel.mode = "";
    c.camp.seat = null; c.camp.burning = c.camp.rolling = c.camp.panic.active = c.roofEscape.active = false;
    c.hop = c.hopV = c.jumps = c.leap.vx = c.leap.vz = 0;
    c.act.kind = "idle"; c.act.until = Infinity;
    const x = -8, z = 8.7, back = B.headquarters.solids.companions.supportAt(x, z, Infinity, 0, 0.3);
    Object.assign(c.root.position, { x, y: c.baseY + back, z });
    let drift = 0, jumped = false, low = back, high = back;
    C.control({ x: 1, z: 0, heading: Math.PI / 2 });
    for (let frame = 0; frame < 60; frame++) {
      B.advance(1 / 60, 1 / 60);
      drift = Math.max(drift, Math.hypot(c.root.position.x - x, c.root.position.z - z));
      jumped ||= c.hopV > 0;
      low = Math.min(low, c.root.position.y - c.baseY); high = Math.max(high, c.root.position.y - c.baseY);
    }
    const gorillaDistance = e.root.position.x + 8;
    C.control({ x: 0, z: 0, heading: 0 });
    Object.assign(e.root.position, { x: -8, y: 0, z: 8 }); e.heading = 0;
    e.gorilla.poseManaged(2, -8, 0, 8, 0, 0, false, false, "", e.motion);
    BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.companions.sync();
    c.hop = c.hopV = c.jumps = c.leap.vx = c.leap.vz = 0;
    P.possess(c); P.controls.reset();
    P.navigate({ position: { x: -10, y: 0, z }, yaw: 0, pitch: 0.4, dist: 10 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", code: "KeyD" }));
    B.advance(0.8, 1 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "d", code: "KeyD" }));
    const walked = c.root.position.x + 10, raised = c.root.position.y - c.baseY;
    P.release(true); C.release();
    return { back, drift, jumped, low, high, gorillaDistance, walked, raised };
  })()`);
  record("gorilla support: a moving back changes an idle NPC's height without carrying or launching it, and a grounded player walks onto it",
    state.back > 0.5 && state.drift < 1e-6 && !state.jumped && state.high - state.low > 0.1 && state.gorillaDistance > 0.5
    && state.walked > 1.5 && state.raised > 0.5, JSON.stringify(state));
} }] });
scene("hub", { label: "lab flask approach", query: "solo=1&character=portlandhodl&status=clankin", steps: [{ name: "gorilla lab exit through Oogas", why: "regression: Ooga occupancy, body sweeps and head support blocked gorillas leaving the lab", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list[0], owner = e.owner, m = B.headquarters.entropyLab.mouth;
    const site = B.crew.workSites.findIndex(site => site.mouth === m), sx = Math.sin(m.ry), sz = Math.cos(m.ry);
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    owner.override = owner.state = "working"; owner.work.site = owner.work.plannedSite = site;
    owner.camp.burning = false;
    Object.assign(owner.root.position, { x: m.x - sx * 0.45, y: m.floorY + owner.baseY, z: m.z - sz * 0.45 });
    const walkOut = visible => {
      owner.root.visible = visible;
      Object.assign(e.root.position, { x: m.x - sx * 1.6, y: m.floorY, z: m.z - sz * 1.6 });
      Object.assign(e, { active: true, controlled: false, mode: "working", phase: "leave", site, fromSite: site,
        pendingSite: -1, route: "exit", parked: false, lounge: "", loungeDepart: false, rest: 0, recover: 0,
        pound: 0, beat: 0, stand: 0, speed: 0, heading: m.ry, hasSlot: false, slotIndex: -1, blocked: 0, retry: 0,
        exitFootprint: false, backoutLeft: 0 });
      e.root.visible = true;
      e.jump.active = e.climb.active = e.drive.airborne = e.drive.resume = e.fire.burning = e.fire.rolling = false;
      Object.assign(e.lab, { item: -1, stage: "", reach: 0, arrived: false, yielding: 0, pathCount: 0, pathIndex: 0,
        pathAt: 0, pathPending: false, pathPartial: false, targetX: NaN, targetZ: NaN });
      Object.assign(e.motion, { lab: true, labRunIn: false, labWork: "", labReach: 0, labBench: null, labPhase: 0, supportOffset: 0 });
      e.stuck.time = e.stuck.taskTime = 0; e.stuck.taskActive = false; e.stuck.x = NaN;
      e.gorilla.poseManaged(2, e.root.position.x, e.root.position.y, e.root.position.z, e.heading, 0, false, true, "", e.motion);
      BL.scene.updateWorld(BL.scenes.hub.root);
      const trace = [], recoveries = e.stuck.recoveries;
      for (let frame = 0; frame < 6 * 60; frame++) {
        C.update(1 / 60);
        const p = e.root.position, along = (p.x - m.x) * sx + (p.z - m.z) * sz;
        trace.push([p.x, p.y, p.z]);
        if (along > 1.5) return { exited: true, trace, recoveries: e.stuck.recoveries - recoveries };
      }
      return { exited: false, trace, recoveries: e.stuck.recoveries - recoveries };
    };
    const empty = walkOut(false), occupied = walkOut(true);
    return { emptyExit: empty.exited, occupiedExit: occupied.exited, frames: occupied.trace.length,
      samePath: empty.trace.length === occupied.trace.length && empty.trace.every((p, i) => p.every((value, axis) => Math.abs(value - occupied.trace[i][axis]) < 1e-6)),
      recoveries: empty.recoveries + occupied.recoveries };
  })()`);
  record("gorilla lab exit: an Ooga standing in the doorway leaves the departure path, height and timing unchanged",
    state.emptyExit && state.occupiedExit && state.samePath && !state.recoveries, JSON.stringify(state));
} }, { name: "lab flask approach", why: "regression: the flask pickup used an inspection pose and stale bench settings, and returning a held flask delayed the next-cave handoff", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list[0], lab = B.headquarters.entropyLab;
    B.pilot.release(true); e.owner.root.visible = false;
    const stationIndex = lab.stations.findIndex(station => station.kind === "carry" && station.side < 0);
    const station = lab.stations[stationIndex], itemIndex = lab.equipment.findIndex(item => item.station === stationIndex), item = lab.equipment[itemIndex];
    const site = B.crew.workSites.findIndex(site => site.mouth === lab.mouth);
    e.owner.state = "working"; e.owner.work.site = e.owner.work.plannedSite = site;
    Object.assign(e, { active: true, controlled: false, mode: "working", phase: "work", site, pendingSite: -1, route: "", parked: false,
      lounge: "", loungeDepart: false, recover: 0, pound: 0, beat: 0, stand: 0, speed: 0, heading: station.heading,
      hasSlot: true, slotIndex: stationIndex, slotX: station.x, slotY: station.y, slotZ: station.z, blocked: 0, exitFootprint: false });
    Object.assign(e.root.position, { x: station.x - Math.sin(station.heading) * 0.7, y: station.y, z: station.z - Math.cos(station.heading) * 0.7 });
    e.root.visible = true;
    e.jump.active = e.climb.active = e.drive.airborne = e.drive.resume = e.fire.burning = e.fire.rolling = false;
    Object.assign(e.lab, { station: stationIndex, pickup: itemIndex, item: -1, stage: "fetch", reach: 0, arrived: false, yielding: 0,
      pathCount: 0, pathIndex: 0, pathAt: 0, pathPending: false, pathPartial: false, targetX: NaN, targetZ: NaN });
    Object.assign(e.motion, { lab: true, labWork: "", labReach: 0, labBench: null, labPhase: 0 });
    e.gorilla.poseManaged(2, e.root.position.x, e.root.position.y, e.root.position.z, e.heading, 0, false, true, "", e.motion);
    e.stuck.time = e.stuck.taskTime = 0; e.stuck.taskActive = false; e.stuck.x = NaN;
    const replans = e.stuck.replans, recoveries = e.stuck.recoveries;
    let seconds = 0, distance = 0, x = e.root.position.x, z = e.root.position.z;
    while (seconds < 4 && e.lab.item !== itemIndex) {
      C.update(1 / 60); seconds += 1 / 60;
      distance += Math.hypot(e.root.position.x - x, e.root.position.z - z); x = e.root.position.x; z = e.root.position.z;
    }
    const result = { seconds, distance, held: e.gorilla.labItem === item.node && item.holder === e,
      station: e.lab.station, expected: stationIndex, replans: e.stuck.replans - replans, recoveries: e.stuck.recoveries - recoveries };
    const owner = e.owner;
    owner.override = owner.state = "working"; owner.root.visible = true;
    owner.walk = null; owner.cheer = owner.hop = owner.hopV = owner.jumps = 0;
    owner.bedTravel.mode = ""; owner.camp.seat = null;
    owner.camp.burning = owner.camp.rolling = owner.camp.panic.active = owner.roofEscape.active = false;
    owner.act.kind = "work";
    Object.assign(owner.work, { phase: "shoot", site, plannedSite: site, emptyTime: 0, timer: 0, blocked: false });
    Object.assign(owner.work.position, owner.root.position);
    Object.assign(owner.weapon, { workSite: site, ammo: 0, unlimited: false, reloading: false,
      swapTime: 0, burstRemaining: 0, cooldown: 0, triggerHeld: false, triggerQueued: 0, reloadHandoff: 0 });
    owner.weapon.spareAmmo.fill(0);
    B.advance(1 / 60, 1 / 60);
    result.immediate = owner.work.phase === "shoot" && owner.work.emptyTime < 0.45
      && owner.work.plannedSite !== site && e.site === owner.work.plannedSite
      && e.phase === "travel" && e.route === "exit" && e.pendingSite < 0;
    result.returned = e.lab.item < 0 && e.lab.station < 0 && !e.gorilla.labItem && !item.holder
      && item.node.parent === item.parent;
    const m = lab.mouth, sx = Math.sin(m.ry), sz = Math.cos(m.ry);
    const before = (e.root.position.x - m.x) * sx + (e.root.position.z - m.z) * sz;
    let fastest = 0;
    for (let frame = 0; frame < 8 * 60; frame++) {
      C.update(1 / 60); fastest = Math.max(fastest, e.speed);
      if ((e.root.position.x - m.x) * sx + (e.root.position.z - m.z) * sz > 1.5) break;
    }
    result.exited = (e.root.position.x - m.x) * sx + (e.root.position.z - m.z) * sz > 1.5;
    result.progress = (e.root.position.x - m.x) * sx + (e.root.position.z - m.z) * sz - before;
    result.fastest = fastest;
    return result;
  })()`);
  record("lab flask: pickup completes without circling, and the final magazine sends its clanker to the next cave immediately without a return job",
    state.held && state.station === state.expected && state.seconds < 4 && state.distance >= 0.69 && state.distance < 1
    && !state.replans && !state.recoveries && state.immediate && state.returned && state.exited && state.progress > 1 && state.fastest > 2,
    JSON.stringify(state));
} }, { name: "lab entry without equipment", why: "regression: workstation reservations and an automatic debug shuttle kept working gorillas waiting outside or repeatedly leaving the lab", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list[0], lab = B.headquarters.entropyLab, m = lab.mouth;
    B.pilot.release(true); C.possess(e); C.release(); C.cancelDebugMove(e);
    const enabled = lab.stations.map(station => station.enabled);
    for (const station of lab.stations) station.enabled = false;
    const site = B.crew.workSites.findIndex(site => site.mouth === m), sx = Math.sin(m.ry), sz = Math.cos(m.ry);
    e.owner.override = e.owner.state = "working"; e.owner.work.site = e.owner.work.plannedSite = site;
    e.owner.root.visible = false;
    Object.assign(e.root.position, { x: m.x + sx * 5.5, y: m.floorY, z: m.z + sz * 5.5 });
    Object.assign(e, { active: true, controlled: false, mode: "", phase: "travel", route: "apron", site,
      fromSite: -1, pendingSite: -1, hasSlot: false, slotIndex: -1, heading: m.ry + Math.PI,
      parked: false, lounge: "", loungeDepart: false, speed: 0, recover: 0, pound: 0, beat: 0,
      stand: 0, blocked: 0, backoutLeft: 0, retry: 0, exitFootprint: false });
    e.jump.active = e.climb.active = e.drive.airborne = e.drive.resume = e.fire.burning = e.fire.rolling = false;
    Object.assign(e.motion, { lab: false, labRunIn: false, labWork: "", labReach: 0, labBench: null,
      labPhase: 0, supportOffset: 0 });
    e.gorilla.poseManaged(2, e.root.position.x, e.root.position.y, e.root.position.z, e.heading, 0, false, false, "", e.motion);
    e.stuck.time = e.stuck.taskTime = 0; e.stuck.taskActive = false; e.stuck.x = NaN;
    let entered = false, retreated = false, queued = false, lateRecoveries = 0;
    for (let frame = 0; frame < 20 * 60; frame++) {
      C.update(1 / 60);
      const along = (e.root.position.x - m.x) * sx + (e.root.position.z - m.z) * sz;
      entered ||= e.motion.lab && along < -1;
      retreated ||= entered && (!e.motion.lab || along > 0 || e.phase === "leave");
      queued ||= e.phase === "wait";
      if (frame === 12 * 60) lateRecoveries = e.stuck.recoveries;
    }
    for (let i = 0; i < lab.stations.length; i++) lab.stations[i].enabled = enabled[i];
    return { entered, retreated, queued, inside: e.motion.lab, phase: e.phase, station: e.lab.station,
      settled: e.lab.arrived, lateRecoveries: e.stuck.recoveries - lateRecoveries };
  })()`);
  record("lab entry: unavailable equipment never holds a worker outside, sends it back out, or repeatedly relocates its interior waiting pose",
    state.entered && !state.retreated && !state.queued && state.inside && state.phase === "work"
    && state.station === -1 && state.settled && !state.lateRecoveries, JSON.stringify(state));
} }] });
scene("hub", { label: "lab work rotation", query: "status=clankin", steps: [{ name: "lab work rotation", why: "regression: interior waiting bodies blocked equipment, permanent claims left coworkers idle, and rear departures held the doorway before reaching it", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, lab = B.headquarters.entropyLab, m = lab.mouth, group = C.list.slice(0, 2);
    B.pilot.release(true); C.release();
    const enabled = lab.stations.map(station => station.enabled);
    const desk = lab.stations.findIndex(station => station.kind === "type" && station.enabled !== false);
    for (let i = 0; i < lab.stations.length; i++) lab.stations[i].enabled = i === desk;
    const site = B.crew.workSites.findIndex(site => site.mouth === m), sx = Math.sin(m.ry), sz = Math.cos(m.ry);
    for (const other of C.list) if (!group.includes(other)) {
      other.owner.override = other.owner.state = "away";
      other.controlled = other.climb.active = other.drive.airborne = other.active = other.root.visible = false;
    }
    const prepare = (entries) => { for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      e.active = e.root.visible = true;
      C.possess(e); C.release(); C.cancelDebugMove(e);
      Object.assign(e.lab, { station: -1, item: -1, pickup: -1, stage: "", arrived: false, time: 0 });
      e.owner.override = e.owner.state = "working"; e.owner.work.site = e.owner.work.plannedSite = site;
      e.owner.root.visible = false;
      const along = -2.5 - i * 0.3;
      Object.assign(e.root.position, { x: m.x + sx * along, y: m.floorY, z: m.z + sz * along });
      Object.assign(e, { active: true, controlled: false, mode: "", phase: "work", route: "", site,
        fromSite: site, pendingSite: -1, hasSlot: false, slotIndex: -1, heading: m.ry + Math.PI,
        parked: false, lounge: "", loungeDepart: false, speed: 0, recover: 0, pound: 0, beat: 0,
        stand: 0, blocked: 0, backoutLeft: 0, retry: 0, exitFootprint: false });
      e.root.visible = true;
      e.jump.active = e.climb.active = e.drive.airborne = e.drive.resume = e.fire.burning = e.fire.rolling = false;
      Object.assign(e.motion, { lab: true, labRunIn: false, labWork: "", labReach: 0, labBench: null,
        labPhase: i, supportOffset: 0 });
      e.gorilla.poseManaged(2, e.root.position.x, e.root.position.y, e.root.position.z, e.heading, 0, false, true, "", e.motion);
      e.stuck.time = e.stuck.taskTime = 0; e.stuck.taskActive = false; e.stuck.x = NaN;
    } };
    prepare(group);
    const seconds = [0, 0], low = [Infinity, Infinity], high = [-Infinity, -Infinity];
    let outside = false, duplicate = false;
    for (let frame = 0; frame < 70 * 30; frame++) {
      C.update(1 / 30);
      let claims = 0;
      for (let i = 0; i < group.length; i++) {
        const e = group[i];
        outside ||= !e.motion.lab || e.phase === "leave";
        if (e.lab.station === desk) claims++;
        if (e.motion.labWork !== "type") continue;
        seconds[i] += 1 / 30;
        low[i] = Math.min(low[i], e.parts.armR.rotation.x); high[i] = Math.max(high[i], e.parts.armR.rotation.x);
      }
      duplicate ||= claims > 1;
    }
    for (let i = 0; i < lab.stations.length; i++) lab.stations[i].enabled = enabled[i];
    const workers = C.list.slice(0, 7), regular = lab.stations.map((station, i) => station.overflow ? -1 : i).filter(i => i >= 0);
    const middle = lab.stations.findIndex(station => station.overflow), display = lab.displays.find(display => display.station === middle);
    prepare(workers.slice(0, 6));
    const used = new Set(); let shared = false, premature = false, allClaimed = false, beakerWorked = false, dieRolled = false;
    const step = (seconds) => { for (let frame = 0; frame < seconds * 30; frame++) {
      C.update(1 / 30);
      const claims = new Set();
      for (const e of workers) if (e.active && e.site === site && e.lab.station >= 0) {
        shared ||= claims.has(e.lab.station); claims.add(e.lab.station);
        if (e.motion.labWork && e.lab.arrived) used.add(e.lab.station);
      }
      allClaimed ||= regular.every(i => claims.has(i));
      premature ||= !workers[6].active && claims.has(middle);
      beakerWorked ||= lab.equipment.some(item => item.kind === "beaker" && item.holder?.lab.stage === "inspect");
      dieRolled ||= lab.equipment.some(item => item.kind === "die" && item.rolling);
    } };
    step(40);
    const six = { used: regular.every(i => used.has(i)), allClaimed, premature };
    prepare(workers.slice(6));
    step(30);
    // Exercise the scene's real ownership-to-display update after the isolated
    // companion simulation; the screens must switch without rebuilding text.
    B.advance(1 / 60, 1 / 60);
    const code = !display.node.visible && display.work.node.visible;
    const before = display.work.strips[0].position.y;
    lab.updateScreens(0.25, 1 << middle, 1 << middle);
    const scroll = display.work.strips[0].position.y !== before;
    const seventh = workers.find(e => e.lab.station === middle);
    if (seventh) seventh.owner.override = seventh.owner.state = "sleeping";
    C.update(1 / 30); B.advance(1 / 60, 1 / 60);
    const restored = display.node.visible && !display.work.node.visible;
    const next = C.sites.findIndex((value, i) => i !== site && value.mirrorRoom);
    const departing = workers.filter(e => e.active && e.site === site);
    for (const e of departing) {
      e.owner.work.site = e.owner.work.plannedSite = next;
      C.plan(e.owner, next);
    }
    const released = departing.every(e => e.phase === "travel" && e.route === "exit" && e.lab.station < 0 && e.lab.item < 0);
    const left = new Set(); let routed = false;
    for (let frame = 0; frame < 18 * 30 && left.size < departing.length; frame++) {
      C.update(1 / 30);
      for (const e of departing) {
        routed ||= e.lab.pathCount > 1;
        const p = e.root.position, along = (p.x - m.x) * sx + (p.z - m.z) * sz;
        if (along > 1.5) left.add(e.index);
      }
    }
    for (const e of workers) {
      e.owner.override = e.owner.state = "away";
      C.update(1 / 30);
    }
    prepare(workers.slice(0, 1));
    const solo = workers[0]; solo.mode = "working";
    solo.owner.work.site = solo.owner.work.plannedSite = next;
    C.plan(solo.owner, next);
    let straight = false, turnedAt = Infinity, soloLeft = false;
    for (let frame = 0; frame < 6 * 60; frame++) {
      C.update(1 / 60);
      straight ||= solo.lab.pathCount === 1 && !solo.lab.pathFixed;
      if (!Number.isFinite(turnedAt) && Math.abs(Math.atan2(Math.sin(solo.heading - m.ry), Math.cos(solo.heading - m.ry))) < 0.08)
        turnedAt = (frame + 1) / 60;
      if ((solo.root.position.x - m.x) * sx + (solo.root.position.z - m.z) * sz > 2.4) { soloLeft = true; break; }
    }
    // Three touching trunks reproduce the doorway pose expansion. Retained
    // fixed-facing routes must be retired when each claims the final crossing.
    const bunch = workers.slice(0, 3); prepare(bunch);
    const recoveries = bunch.reduce((sum, e) => sum + e.stuck.recoveries, 0), cleared = new Set();
    for (let i = 0; i < bunch.length; i++) {
      const e = bunch[i], along = -0.1 - i * 0.3;
      Object.assign(e.root.position, { x: m.x + sx * along, y: m.floorY, z: m.z + sz * along });
      e.heading = m.ry; e.mode = "working";
      e.gorilla.poseManaged(2, e.root.position.x, e.root.position.y, e.root.position.z, e.heading, 0, false, true, "", e.motion);
      e.owner.work.site = e.owner.work.plannedSite = next; C.plan(e.owner, next);
      Object.assign(e.lab, { pathCount: 1, pathIndex: 0, pathFixed: true, pathHeading: m.ry + Math.PI, readyAt: 1e9 });
    }
    for (let frame = 0; frame < 6 * 60 && cleared.size < bunch.length; frame++) {
      C.update(1 / 60);
      for (const e of bunch) if ((e.root.position.x - m.x) * sx + (e.root.position.z - m.z) * sz > 2.4) cleared.add(e.index);
    }
    const bunchRecoveries = bunch.reduce((sum, e) => sum + e.stuck.recoveries, 0) - recoveries;
    return { actors: group.length, seconds, strokes: high.map((value, i) => value - low[i]), outside, duplicate,
      regular: regular.length, used: [...used], six, shared, overflowWorked: used.has(middle), code, scroll, restored,
      released, routed, departures: departing.length, left: left.size, beakerWorked, dieRolled,
      straight, turnedAt, soloLeft, bunchLeft: cleared.size, bunchRecoveries };
  })()`);
  record("lab work: exclusive regular and overflow jobs animate correctly, and coworkers take room routes out together without a doorway stall",
    state.actors === 2 && state.seconds.every(value => value > 2) && state.strokes.every(value => value > 0.03)
    && !state.outside && !state.duplicate && state.regular === 6 && state.six.used && state.six.allClaimed && !state.six.premature
    && !state.shared && state.overflowWorked && state.code && state.scroll && state.restored
    && state.released && state.routed && state.departures === 6 && state.left === state.departures
    && state.beakerWorked && state.dieRolled && state.straight && state.turnedAt < 0.75 && state.soloLeft
    && state.bunchLeft === 3 && !state.bunchRecoveries, JSON.stringify(state));
} }] });
scene("hub", { label: "gorilla inactive roofs", query: "status=chillin", steps: [{ name: "gorilla inactive roofs", why: "regression: resting-spot selection used active roofs and the cluttered ground between working caves", run: async (b) => {
  const r = await b.evaluate(`(() => {
    const B = __ooga, roofs = B.mouths.map(m => {
      const x = m.x - Math.sin(m.ry) * 4.8, z = m.z - Math.cos(m.ry) * 4.8;
      return { id: m.id, x, z, y: B.island.surfaceAt(x, z), status: BL.caves.slots.find(s => s.id === m.id).status };
    }), inactiveMouths = B.mouths.filter(m => BL.caves.slots.find(s => s.id === m.id).status === "dark"),
      violations = []; let goals = 0, inactive = 0;
    const check = (e, x, y, z, kind) => {
      let nearest = null, distance = 81;
      for (const roof of roofs) {
        const d = (x - roof.x) ** 2 + (z - roof.z) ** 2;
        if (y >= roof.y - 0.55 && d < distance && Math.abs(B.island.surfaceAt(x, z) - y) <= 0.1) { distance = d; nearest = roof; }
      }
      if (nearest?.status === "dark") inactive++;
      else if (nearest) violations.push({ name: e.owner.traits.name, kind, cave: nearest.id, x, y, z });
      else if (!inactiveMouths.some(m => Math.hypot(x - m.x, z - m.z) < 16))
        violations.push({ name: e.owner.traits.name, kind, cave: "outside inactive frontage", x, y, z });
    };
    for (let sample = 0; sample < 20; sample++) {
      for (const e of B.clankers.list) if (e.active && !e.controlled && e.mode === "chilling" && e.phase === "chill") {
        goals++; check(e, e.goalX, e.goalY, e.goalZ, "goal");
        if (e.lounge) { const p = e.root.position; check(e, p.x, p.y, p.z, "rest"); }
      }
      B.advance(0.5, 1 / 60);
    }
    return { goals, inactive, violations };
  })()`);
  record("gorilla lounging: resting goals and settled poses stay on inactive cave roofs or their nearby frontage", r.goals > 0 && r.violations.length === 0, JSON.stringify(r));
} }] });
scene("hub", { label: "gorilla rooftop hop", query: "status=chillin", steps: [{ name: "gorilla rooftop hop", why: "rule: a neighbouring rooftop outing uses a supported jump across the saddle and stays on the upper level", run: async (b) => {
  const rows = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl");
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    for (const other of C.list) if (other !== e) { other.owner.override = other.owner.state = "away"; other.active = other.root.visible = false; }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    const roofs = ["c1", "c2"].map(id => {
      const m = B.mouths.find(m => m.id === id), x = m.x - Math.sin(m.ry) * 4.8, z = m.z - Math.cos(m.ry) * 4.8;
      return { id, x, z, y: B.island.surfaceAt(x, z) };
    });
    const rows = [];
    for (let direction = 0; direction < 2; direction++) {
      const from = roofs[direction], to = roofs[1 - direction], heading = Math.atan2(to.x - from.x, to.z - from.z);
      const sx = Math.sin(heading), sz = Math.cos(heading), outside = direction ? -2 : 2;
      // The roof centres' direct line intersects a tree. Use its clear outer
      // saddle, with both endpoints on measured upper-level support.
      const x = from.x + sz * outside, z = from.z - sx * outside, y = B.island.surfaceAt(x, z);
      const tx = to.x - sx * 3.5 + sz * outside, tz = to.z - sz * 3.5 - sx * outside, ty = B.island.surfaceAt(tx, tz);
      Object.assign(e.root.position, { x, y, z });
      Object.assign(e, { active: true, controlled: false, mode: "chilling", phase: "chill", route: "", lounge: "", loungeDepart: false,
        loungeRoof: true, parked: false, recover: 0, rest: 120, pound: 0, beat: 0, stand: 0, heading, speed: 0, backoutLeft: 0,
        goalX: tx, goalY: ty, goalZ: tz });
      e.owner.override = e.owner.state = "chilling"; e.root.visible = true;
      Object.assign(e.roam, { count: 0, index: 0, wall: false, nextChoice: Infinity, departPending: false, propDeparture: false, transition: 0,
        runUp: 0, jumpRetry: 0, progressTime: 0, progressDistance: Infinity, pose: "sit", lastPose: "", riseAdmitted: false });
      Object.assign(e.climb, { active: false, free: false, mountPending: false, openingStagePending: false, handoffDirection: 0, retry: 0,
        searchPending: false, searchDeferred: false, claimPending: false, crestPending: false, debugStuck: false });
      Object.assign(e.drive, { airborne: false, passiveFall: false, resume: false, grounded: true, vx: 0, vy: 0, vz: 0 });
      Object.assign(e.motion, { climb: 0, climbBlend: NaN, mantle: 0, supportOffset: 0, landing: 0, takeoff: 0 });
      e.jump.active = e.fire.burning = e.fire.rolling = false; e.stuck.recoveries = 0;
      e.gorilla.poseManaged(2, x, y, z, heading, 0, false, false, "", e.motion);
      BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.props.sync();
      const beforeJumps = e.jumps, trace = []; let minY = y, climbed = false, landed = false, previousJump = false;
      for (let frame = 0; frame < 1200; frame++) {
        B.advance(1 / 60, 1 / 60); const p = e.root.position;
        minY = Math.min(minY, p.y); climbed ||= e.climb.active;
        if (frame % 12 === 0 || previousJump !== e.jump.active) trace.push({ t: frame / 60, x: p.x, y: p.y, z: p.z,
          jump: e.jump.active, climb: e.climb.active, runUp: e.roam.runUp, jumps: e.jumps - beforeJumps });
        previousJump = e.jump.active;
        if (e.jumps > beforeJumps && !e.jump.active && !e.climb.active && !e.drive.airborne
          && Math.hypot(p.x - tx, p.z - tz) < 0.2 && Math.abs(p.y - ty) < 0.1) { landed = true; break; }
      }
      const p = e.root.position;
      rows.push({ from, to, start: { x, y, z }, target: { x: tx, y: ty, z: tz }, jumps: e.jumps - beforeJumps,
        climbed, minY, landed, y: p.y, floor: B.island.supportAt(p.x, p.z, p.y + 0.1, 0, -Infinity), recoveries: e.stuck.recoveries, trace });
    }
    return rows;
  })()`);
  writeFileSync(join(root, "untracked", "gorilla-rooftop-hop.json"), JSON.stringify(rows, null, 2));
  record("gorilla rooftop hop: neighbouring roofs are reached in both directions by continuous jumps with real upper-level footing and no relocation",
    rows.every(row => row.jumps > 0 && row.landed && !row.climbed && !row.recoveries
      && row.minY >= Math.min(row.start.y, row.target.y) - 0.55 && Math.abs(row.y - row.floor) < 0.1), JSON.stringify(rows));
} }] });
scene("hub", { label: "gorilla stone core", query: "status=chillin", steps: [{ name: "gorilla stone core", why: "regression: the pelvis point admitted walking steps whose forward torso center was already inside a cave wall", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl"), m = B.mouths.find(m => m.id === "c9");
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    e.controlled = e.climb.active = e.drive.airborne = e.motion.lab = e.planningLab = e.climb.openingExit = e.parked = e.biped = false;
    e.motion.supportOffset = 0;
    const sx = Math.sin(m.ry), sz = Math.cos(m.ry), heading = m.ry + Math.PI, y = m.floorY;
    let face = NaN;
    for (let d = 3; d >= -10; d -= 0.025) if (B.island.solidAt(m.x + sx * d, y + 0.85, m.z + sz * d)) { face = d; break; }
    const x = m.x + sx * (face + 1.1), z = m.z + sz * (face + 1.1);
    const tx = m.x + sx * (face + 0.6), tz = m.z + sz * (face + 0.6);
    Object.assign(e.root.position, { x, y, z }); e.heading = heading;
    e.gorilla.poseManaged(2, x, y, z, heading, 0, false, false, "", e.motion);
    BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.props.sync();
    const state = { face, rootClear: B.island.clearAt(tx, y + 0.65, tz, 0.025, 0.12),
      torsoBuried: B.island.solidAt(tx - sx * 0.7, y + 0.85, tz - sz * 0.7),
      admitted: C.clear(x, y, z, tx, y, tz, e.radius, e.height, e, null, heading, heading) };
    for (const other of C.list) if (other !== e) {
      other.owner.override = other.owner.state = "away"; other.controlled = other.drive.airborne = other.climb.active = other.fire.rolling = other.active = other.root.visible = false;
    }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    Object.assign(e, { active: true, recover: 0, lounge: "", loungeDepart: false, speed: 0, pound: 0, beat: 0, stand: 0 });
    Object.assign(e.drive, { grounded: true, passiveFall: false, motionRecover: 0, motionEnvelope: false });
    Object.assign(e.motion, { climb: 0, climbBlend: NaN, mantle: 0, roll: 0, landing: 0, takeoff: 0 });
    e.jump.active = e.fire.burning = e.fire.rolling = false; e.root.visible = true;
    C.possess(e);
    const ix = -sx * 0.6 + sz * 0.8, iz = -sz * 0.6 - sx * 0.8, facing = Math.atan2(ix, iz);
    let buriedFrames = 0, movingFrames = 0, previousX = x, previousZ = z;
    state.trace = [];
    // Stop before the room side wall: this command probes sliding along its back wall.
    for (let frame = 0; frame < 90; frame++) {
      C.control({ x: ix, z: iz, heading: facing, run: false }); B.advance(1 / 60, 1 / 60);
      const p = e.root.position;
      if (B.island.solidAt(p.x + Math.sin(e.heading) * 0.7, p.y + 0.85, p.z + Math.cos(e.heading) * 0.7)) buriedFrames++;
      if (Math.hypot(p.x - previousX, p.z - previousZ) > 1e-5) movingFrames++;
      previousX = p.x; previousZ = p.z;
      if (!(frame % 12)) state.trace.push({ frame, x: p.x, y: p.y, z: p.z, heading: e.heading });
    }
    state.slide = { tangent: (e.root.position.x - x) * sz - (e.root.position.z - z) * sx, movingFrames, buriedFrames };
    return state;
  })()`);
  writeFileSync(join(root, "untracked", "gorilla-stone-core.json"), JSON.stringify(state, null, 2));
  record("gorilla stone core: a clear pelvis point cannot admit a walking step that buries the torso center in stone", Number.isFinite(state.face)
    && state.rootClear && state.torsoBuried && !state.admitted && state.slide.tangent > 1
    && state.slide.movingFrames > 85 && !state.slide.buriedFrames, JSON.stringify(state));
} }] });
scene("hub", { label: "gorilla wall handoff", query: "status=chillin", steps: [{ name: "gorilla wall handoff", why: "regression: jumping off during a roof-edge mount left a stale handoff that sent a reattached gorilla backwards through the air", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl"), m = B.mouths.find(m => m.id === "c1");
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    for (const other of C.list) if (other !== e) {
      other.owner.override = other.owner.state = "away"; other.controlled = other.drive.airborne = other.climb.active = other.fire.rolling = other.active = other.root.visible = false;
    }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    const sx = Math.sin(m.ry), sz = Math.cos(m.ry), x = m.x - sx * 0.15 + sz * 3.4, z = m.z - sz * 0.15 - sx * 3.4, y = B.island.surfaceAt(x, z);
    Object.assign(e.root.position, { x, y, z });
    Object.assign(e, { active: true, controlled: false, recover: 0, lounge: "", loungeDepart: false, parked: false, biped: false,
      heading: m.ry, speed: 0, pound: 0, beat: 0, stand: 0 });
    Object.assign(e.drive, { airborne: false, passiveFall: false, grounded: true, resume: false, vx: 0, vy: 0, vz: 0, motionRecover: 0, motionEnvelope: false });
    Object.assign(e.climb, { active: false, free: false, mountPending: false, handoffDirection: 0, openingStagePending: false, retry: 0,
      searchPending: false, searchDeferred: false, claimPending: false, crestPending: false });
    e.jump.active = e.fire.burning = e.fire.rolling = false; e.root.visible = true;
    Object.assign(e.motion, { climb: 0, climbBlend: NaN, mantle: 0, supportOffset: 0, landing: 0, takeoff: 0 });
    e.gorilla.poseManaged(2, x, y, z, m.ry, 0, false, false, "", e.motion);
    BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.props.sync(); C.possess(e);
    const trace = []; let mounted = false, jumped = false, reattached = false, staleMount = false, maxDistance = 0;
    let jumpFrame = -1, released = false, attachFrame = -1, attachX = 0, attachY = 0, attachZ = 0, maxDrift = 0;
    let facingCorrected = false, wrongFacing = 0, panelError = 0;
    for (let frame = 0; frame < 720; frame++) {
      const c = e.climb;
      if (!jumped && c.active && c.mountPending && e.root.position.y < y - 0.4) {
        mounted = jumped = true; jumpFrame = frame;
        C.control({ x: 0, z: 0, jumpPressed: true, jumpHeld: true, climbAxis: 0 });
      } else if (!jumped) C.control({ x: sx, z: sz, heading: m.ry, climbAxis: 1 });
      else if (reattached) C.control({ x: 0, z: 0, climbAxis: 1, jumpHeld: false });
      else if (frame - jumpFrame < 15) C.control({ x: sx, z: sz, heading: m.ry, jumpHeld: false });
      else if (frame - jumpFrame < 45) C.control({ x: 0, z: 0, jumpHeld: false });
      else C.control({ x: -sx + sz * 0.35, z: -sz - sx * 0.35, heading: m.ry + Math.PI, run: true, climbAxis: 1, jumpHeld: false });
      B.advance(1 / 60, 1 / 60);
      if (jumped && !c.active && e.drive.airborne) released = true;
      if (released && c.active && !reattached) {
        reattached = true; staleMount = c.mountPending; attachFrame = frame;
        attachX = e.root.position.x; attachY = e.root.position.y; attachZ = e.root.position.z;
        // A roof handoff/look bearing can disagree with the proven wall
        // normal. The next climb frame must repair facing without losing grip.
        e.heading = c.heading = c.panel.heading + Math.PI;
      }
      if (reattached && frame > attachFrame && c.active && c.free && !c.handoffDirection) {
        const facing = Math.cos(e.root.rotation.y - c.panel.heading);
        if (frame === attachFrame + 1) facingCorrected = facing > 0.999;
        if (facing < 0.999 || Math.cos(c.heading - c.panel.heading) < 0.999) wrongFacing++;
        const panel = c.panel, point = e.root.position;
        panelError = Math.max(panelError, Math.hypot(
          panel.x + panel.nz * panel.u + panel.nx * panel.depth - point.x,
          panel.y + panel.v - point.y, panel.z - panel.nx * panel.u + panel.nz * panel.depth - point.z));
      }
      if (reattached) maxDrift = Math.max(maxDrift, Math.hypot(e.root.position.x - attachX, e.root.position.z - attachZ));
      maxDistance = Math.max(maxDistance, Math.hypot(e.root.position.x - x, e.root.position.z - z));
      if (frame % 12 === 0 || frame === jumpFrame || frame === jumpFrame + 1) trace.push({ t: frame / 60,
        x: e.root.position.x, y: e.root.position.y, z: e.root.position.z, active: c.active, mount: c.mountPending,
        handoff: c.handoffDirection, airborne: e.drive.airborne, target: [c.freeTargetX, c.freeTargetY, c.freeTargetZ] });
      if (reattached && frame - attachFrame >= 180) break;
    }
    return { mounted, jumped, released, reattached, staleMount, facingCorrected, wrongFacing, panelError, maxDistance, maxDrift, attachY, y: e.root.position.y, floor: B.island.supportAt(e.root.position.x, e.root.position.z, e.root.position.y + 0.1, 0, -Infinity),
      active: e.climb.active, airborne: e.drive.airborne, trace };
  })()`);
  writeFileSync(join(root, "untracked", "gorilla-wall-handoff.json"), JSON.stringify(state, null, 2));
  record("gorilla wall handoff: jumping during an edge mount and grabbing the wall again cannot resume the previous mount or drift away from the wall",
    state.mounted && state.jumped && state.released && state.reattached && !state.staleMount && state.facingCorrected && !state.wrongFacing && state.panelError < 1e-9 && state.maxDrift < 4 && state.y > state.attachY + 0.5
      && !state.active && !state.airborne && Math.abs(state.y - state.floor) < 0.1, JSON.stringify(state));
} }] });
scene("hub", { label: "gorilla edge first descent", query: "status=chillin", steps: [{ name: "gorilla edge first descent", why: "regression: a partial roof approach handed off its yaw too early and a descending window search raised gorillas back onto nearby roof terrain", run: async (b) => {
  const rows = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl"), rows = [];
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    for (const other of C.list) if (other !== e) { other.owner.override = other.owner.state = "away"; other.active = other.root.visible = false; }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    for (const id of ["c1", "c9"]) {
      const along = id === "c1" ? 2.4 : 0.15;
      const m = B.mouths.find(m => m.id === id), sx = Math.sin(m.ry), sz = Math.cos(m.ry);
      const x = m.x - sx * along, z = m.z - sz * along, roof = B.island.surfaceAt(x, z);
      Object.assign(e.root.position, { x, y: roof, z });
      Object.assign(e, { active: true, controlled: false, mode: "chilling", phase: "chill", route: "", lounge: "", loungeDepart: false,
        parked: false, recover: 0, rest: 0, pound: 0, beat: 0, stand: 0, heading: m.ry, speed: 0, backoutLeft: 0,
        goalX: m.x + sx * 5, goalY: m.floorY, goalZ: m.z + sz * 5 });
      e.owner.override = e.owner.state = "chilling"; e.root.visible = true;
      Object.assign(e.roam, { count: 0, index: 0, wall: false, nextChoice: Infinity, departPending: false, propDeparture: false, transition: 0,
        progressTime: 0, progressDistance: Infinity });
      Object.assign(e.climb, { active: false, free: false, mountPending: false, openingStagePending: false, handoffDirection: 0, retry: 0,
        searchPending: false, searchDeferred: false, claimPending: false, crestPending: false, debugStuck: false });
      Object.assign(e.drive, { airborne: false, passiveFall: false, resume: false, grounded: true, vx: 0, vy: 0, vz: 0 });
      Object.assign(e.motion, { climb: 0, climbBlend: NaN, mantle: 0, supportOffset: 0, landing: 0, takeoff: 0 });
      e.stuck.recoveries = 0; e.climb.blocked = 0;
      e.jump.active = e.fire.burning = e.fire.rolling = false;
      e.gorilla.poseManaged(2, x, roof, z, m.ry, 0, false, false, "", e.motion);
      BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.props.sync();
      const middle = (B.island.surfaceAt(m.x - sx * 4.8, m.z - sz * 4.8) + m.floorY) * 0.5;
      const trace = []; let mounts = 0, aborts = 0, up = 0, departures = 0, departureY = NaN, previousJump = false, previousActive = false, lastY = roof;
      for (let frame = 0; frame < 600; frame++) {
        B.advance(1 / 60, 1 / 60); const p = e.root.position, c = e.climb;
        if (c.active && !previousActive) mounts++;
        if (previousActive && !c.active && p.y > roof - 0.8 && !e.drive.airborne && !e.jump.active) aborts++;
        if (previousActive && !c.active && e.jump.active && !previousJump) { departures++; departureY = p.y; }
        if (mounts && !e.jump.active && !e.drive.airborne && p.y > lastY + 0.005) up++;
        if (frame % 6 === 0 || previousActive !== c.active) trace.push({ t: frame / 60, x: p.x, y: p.y, z: p.z,
          active: c.active, free: c.free, fromTop: c.fromTop, progress: c.progress, heading: e.heading, wallHeading: c.heading, mantleStart: c.mantleStart, basePrepEnd: c.basePrepEnd, lowerExit: c.lowerExit, descending: c.descending, mount: c.mountPending, handoff: c.handoffDirection, blocked: c.blocked, failure: c.failure,
          target: [c.freeTargetX, c.freeTargetY, c.freeTargetZ], blend: e.motion.climbBlend });
        previousActive = c.active; previousJump = e.jump.active; lastY = p.y;
        if (mounts && !c.active && !e.jump.active && !e.drive.airborne && p.y <= m.floorY + 0.15) break;
      }
      const p = e.root.position;
      rows.push({ id, along, x, z, roof, mounts, aborts, up, departures, departureY, middle, y: p.y,
        across: (p.x - m.x) * sz - (p.z - m.z) * sx, outward: (p.x - m.x) * sx + (p.z - m.z) * sz,
        floor: B.island.supportAt(p.x, p.z, p.y + 0.1, 0, -Infinity), active: e.climb.active, airborne: e.drive.airborne, recoveries: e.stuck.recoveries, trace });
    }
    return rows;
  })()`);
  writeFileSync(join(root, "untracked", "gorilla-roof-edge-first-descent.json"), JSON.stringify(rows, null, 2));
  record("gorilla edge first descent: both active cave faces mount once, jump sideways halfway down and land away from the entrance without remounting or relocation",
    rows.every(row => row.mounts === 1 && !row.aborts && !row.up && !row.active && !row.airborne && !row.recoveries
      && row.departures === 1 && Math.abs(row.departureY - row.middle) < 0.15 && Math.abs(row.across) > 3.5 && row.outward >= 3
      && row.y < 0.15 && Math.abs(row.y - row.floor) < 0.1), JSON.stringify(rows));
} }] });
scene("hub", { label: "gorilla roof descent", query: "status=chillin", steps: [{ name: "gorilla roof descent", why: "regression: an autonomous gorilla leaving the OBL cave roof remounted the roof instead of descending its front wall", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl"), m = B.mouths.find(m => m.id === "c1");
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    for (const other of C.list) if (other !== e) { other.owner.override = other.owner.state = "away"; other.active = other.root.visible = false; }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    const sx = Math.sin(m.ry), sz = Math.cos(m.ry), x = m.x - sx * 0.15, z = m.z - sz * 0.15, roof = B.island.surfaceAt(x, z);
    Object.assign(e.root.position, { x, y: roof, z });
    Object.assign(e, { active: true, controlled: false, mode: "chilling", phase: "chill", route: "", lounge: "", loungeDepart: false,
      parked: false, recover: 0, rest: 0, pound: 0, beat: 0, stand: 0, heading: m.ry, speed: 0, goalX: m.x + sx * 5, goalY: m.floorY, goalZ: m.z + sz * 5 });
    e.owner.override = e.owner.state = "chilling"; e.root.visible = true;
    Object.assign(e.roam, { count: 0, index: 0, wall: false, nextChoice: Infinity, departPending: false, propDeparture: false });
    Object.assign(e.climb, { active: false, free: false, mountPending: false, openingStagePending: false, handoffDirection: 0, retry: 0, searchPending: false, searchDeferred: false, claimPending: false, crestPending: false, debugStuck: false });
    e.drive.airborne = e.drive.resume = e.jump.active = e.fire.burning = e.fire.rolling = false;
    e.gorilla.poseManaged(2, x, roof, z, m.ry, 0, false, false, "", e.motion);
    BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.props.sync();
    e.stuck.recoveries = 0;
    const trace = []; let mounted = false, reversals = 0, lastY = roof, minY = roof;
    for (let frame = 0; frame < 1200; frame++) {
      B.advance(1 / 60, 1 / 60); const p = e.root.position, c = e.climb;
      if (c.active) mounted = true;
      if (mounted && !e.jump.active && !e.drive.airborne && p.y > lastY + 0.005) reversals++;
      minY = Math.min(minY, p.y); lastY = p.y;
      if (frame % 30 === 0) trace.push({ t: frame / 60, x: p.x, y: p.y, z: p.z, active: c.active, free: c.free, descending: c.descending, mount: c.mountPending, handoff: c.handoffDirection, blocked: c.blocked,
        goal: [e.goalX, e.goalY, e.goalZ], phase: e.phase, owner: e.owner.state, failure: c.failure, search: c.searchPending, lounge: e.lounge, resume: e.drive.resume });
      if (mounted && !c.active && !e.jump.active && !e.drive.airborne && p.y <= m.floorY + 0.15) break;
    }
    const p = e.root.position;
    return { roof, mounted, reversals, minY, y: p.y, floor: B.island.supportAt(p.x, p.z, p.y + 0.1, 0, -Infinity),
      active: e.climb.active, recoveries: e.stuck.recoveries, trace };
  })()`);
  record("gorilla roof descent: the autonomous OBL roof departure reaches the main floor without climbing back onto the roof or relocation",
    state.mounted && state.y < 0.15 && Math.abs(state.y - state.floor) < 0.1 && !state.active && !state.reversals && !state.recoveries, JSON.stringify(state));
} }] });
scene("hub", { label: "gorilla traversal", query: "status=chillin&gorillamove=1", steps: [{ name: "gorilla prop traversal", why: "regression: low props interrupted the gallop, jump input delayed takeoff, and a stale motion envelope trapped gorillas beneath trees", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, root = BL.scenes.hub.root, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl"), solids = B.headquarters.solids.props;
    B.pilot.release(true);
    // Inactive companions reactivate while their owners are awake. An isolated fixture uses the real
    // away state; sleeping would require a claimed bedroll and the crew's complete sleep transition.
    for (const other of C.list) if (other !== e) {
      other.owner.override = other.owner.state = "away"; other.owner.bedTravel.mode = "";
      other.controlled = other.drive.airborne = other.climb.active = other.fire.rolling = other.active = other.root.visible = false;
    }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    for (const prop of B.props) prop.node.visible = false;
    const setup = (x, z, heading = Math.PI / 2) => {
      C.release();
      Object.assign(e.root.position, { x, y: B.island.supportAt(x, z, 50, 10), z });
      Object.assign(e, { active: true, controlled: false, recover: 0, lounge: "", parked: false, biped: false, heading, speed: 0, lowCover: false, pound: 0, beat: 0, stand: 0 });
      Object.assign(e.drive, { airborne: false, passiveFall: false, grounded: true, jumpHeld: false, jumpDown: false, jumpPressed: false, jumps: 0, vx: 0, vy: 0, vz: 0, motionRecover: 0, motionEnvelope: false });
      Object.assign(e.climb, { requested: 0, searchPending: false, searchDeferred: false, claimPending: false, crestPending: false, retry: 0, searchCursor: 0 });
      e.fire.burning = e.fire.rolling = false; e.fire.rollRecover = 0; e.actionControlled = e.motion.smash = e.climb.active = e.jump.active = false;
      Object.assign(e.motion, { climb: 0, climbBlend: NaN, climbSide: 0, climbDirection: 0, climbStride: 0,
        mantle: 0, roll: 0, rollAngle: 0, charge: 0, poundCharge: 0, landing: 0, takeoff: 0,
        supportOffset: 0, lab: false, labRunIn: false, labWork: "", smash: false });
      // Reset the rig as well as its controller: the preceding prop fall can leave a landing blend behind.
      e.gorilla.poseManaged(2, x, e.root.position.y, z, heading, 0, false, false, "", e.motion);
      e.root.visible = true; C.possess(e); B.advance(0.2, 1 / 60);
    };
    const advance = (input, seconds, sample = null) => {
      const dt = 1 / 60;
      for (let t = 0; t < seconds; t += dt) { C.control(input); B.advance(dt, dt); if (sample) sample(); }
    };
    const traversals = [];
    for (const [kind, geometry] of [["crate", BL.hubModels.woodCrate()], ["barrel", BL.hubModels.barrel()], ["rock", BL.hubModels.rock(0)]]) {
      const node = S.createNode({ geometry, position: { x: 12, y: B.island.surfaceAt(12, 0), z: 0 } });
      S.addChild(root, node); solids.add(node); S.updateWorld(root); solids.sync(); setup(7, 0);
      let maxY = e.root.position.y, airborne = 0, stopped = 0, previousX = e.root.position.x, maxVisibleStep = 0;
      const hips = e.gorilla.root.children[0]; let previousVisibleY = e.root.position.y + hips.position.y;
      advance({ x: 1, z: 0, heading: Math.PI / 2, run: true, jumpHeld: false }, 4, () => {
        const visibleY = e.root.position.y + hips.position.y;
        maxY = Math.max(maxY, e.root.position.y); maxVisibleStep = Math.max(maxVisibleStep, Math.abs(visibleY - previousVisibleY)); previousVisibleY = visibleY;
        if (e.drive.airborne || e.jump.active) airborne++;
        if (e.root.position.x > 9 && e.root.position.x < 15.5 && e.root.position.x - previousX < 1e-5) stopped++;
        previousX = e.root.position.x;
      });
      traversals.push({ kind, x: e.root.position.x, maxY, airborne, stopped, maxVisibleStep });
      solids.remove(node); S.removeChild(root, node); solids.sync();
    }
    const escapeRock = S.createNode({ geometry: BL.hubModels.rock(0), position: { x: 12, y: B.island.surfaceAt(12, 0), z: 0 } });
    S.addChild(root, escapeRock); solids.add(escapeRock); S.updateWorld(root); solids.sync();
    C.release();
    const rockY = solids.supportAt(12, 0, 50, 50, 0.45);
    Object.assign(e.root.position, { x: 12, y: rockY, z: 0 });
    Object.assign(e, { active: true, controlled: false, mode: "chilling", phase: "chill", route: "", lounge: "", loungeDepart: false,
      parked: false, biped: false, recover: 0, rest: 0, heading: Math.PI / 2, speed: 0, goalX: 12, goalY: rockY, goalZ: 0,
      footprintMode: "walk", compact: e.gorilla.compact, radius: BL.clankers.WALK_RADIUS, height: BL.clankers.WALK_HEIGHT });
    e.owner.state = "chilling"; e.root.visible = true;
    Object.assign(e.drive, { airborne: false, passiveFall: false, grounded: true, resume: false, vx: 0, vy: 0, vz: 0 });
    e.jump.active = e.fire.burning = e.fire.rolling = false;
    Object.assign(e.climb, { active: false, searchPending: false, searchDeferred: false, claimPending: false, crestPending: false, retry: 0, searchCursor: 0 });
    Object.assign(e.roam, { count: 0, index: 0, wall: false, nextChoice: 1000, lastPose: "", transition: 0, progressTime: 0,
      targetX: NaN, targetY: NaN, targetZ: NaN });
    e.stuck.x = e.stuck.y = e.stuck.z = NaN; e.stuck.time = e.stuck.taskTime = 0; e.stuck.taskActive = false; e.stuck.reason = "";
    e.gorilla.poseManaged(2, 12, rockY, 0, e.heading, 0, false, false, "", e.motion);
    advance(null, 0.5);
    const assignedExit = Math.hypot(e.goalX - 12, e.goalZ) > 2;
    escapeRock.visible = false; S.updateWorld(root); solids.sync();
    advance(null, 3.5);
    const raisedProp = { rockY, assignedExit, x: e.root.position.x, y: e.root.position.y, z: e.root.position.z,
      airborne: e.drive.airborne, stuck: e.stuck.time, reason: e.stuck.reason };
    solids.remove(escapeRock); S.removeChild(root, escapeRock); solids.sync();
    const jumps = [];
    for (const run of [false, true]) {
      // Reuse the clear corridor exercised above after removing its temporary prop.
      setup(7, 0);
      const startX = e.root.position.x;
      advance({ x: 1, z: 0, heading: Math.PI / 2, run, jumpHeld: false }, 1 / 60);
      const startSpeed = (e.root.position.x - startX) * 60, switchX = e.root.position.x;
      advance({ x: 1, z: 0, heading: Math.PI / 2, run: !run, jumpHeld: false }, 1 / 60);
      const switchSpeed = (e.root.position.x - switchX) * 60;
      advance({ x: 1, z: 0, heading: Math.PI / 2, run, jumpHeld: false }, 0.35);
      const floor = e.root.position.y, takeoffX = e.root.position.x, beforeJumps = e.jumps, gait = e.gorilla.debug.gait;
      let stopped = 0, lastX = e.root.position.x, firstAir = false, peak = 0;
      for (let frame = 0; frame < 39; frame++) {
        C.control({ x: 1, z: 0, heading: Math.PI / 2, run, jumpHeld: true, jumpPressed: frame === 0 }); B.advance(1 / 60, 1 / 60);
        if (frame === 0) firstAir = e.drive.airborne;
        peak = Math.max(peak, e.root.position.y - floor);
        if (e.root.position.x - lastX <= 1e-5) stopped++;
        lastX = e.root.position.x;
      }
      const heldTravel = e.root.position.x - takeoffX, vx = e.drive.vx;
      advance({ x: 0, z: 0, jumpHeld: true }, 2.5);
      const heldJumps = e.jumps - beforeJumps, heldLanded = !e.drive.airborne;
      advance({ x: 0, z: 0, jumpHeld: false }, 0.2);
      const releaseJumps = e.jumps - beforeJumps;
      setup(7, 0);
      advance({ x: 0, z: 0, jumpHeld: true }, 0.55);
      advance({ x: 0, z: 0, jumpHeld: false }, 1 / 60);
      const secondY = e.root.position.y;
      C.control({ x: 0, z: 0, jumpHeld: true, jumpPressed: true }); B.advance(1 / 60, 1 / 60);
      const secondCount = e.drive.jumps, secondVelocity = e.drive.vy;
      // Cancelling input must not replenish the mid-air jump allowance.
      C.cancelInput(); C.control({ x: 0, z: 0, jumpHeld: true, jumpPressed: true }); B.advance(1 / 60, 1 / 60);
      const thirdCount = e.drive.jumps, thirdVelocity = e.drive.vy;
      let secondLift = e.root.position.y - secondY;
      advance({ x: 0, z: 0, jumpHeld: true }, 2.5, () => { secondLift = Math.max(secondLift, e.root.position.y - secondY); });
      const landed = !e.drive.airborne && e.drive.jumps === 0;
      advance({ x: 0, z: 0, jumpHeld: false }, 1 / 60);
      C.control({ x: 0, z: 0, jumpHeld: true, jumpPressed: true }); B.advance(1 / 60, 1 / 60);
      const nextJump = e.drive.airborne && e.drive.jumps === 1;
      advance({ x: 0, z: 0, jumpHeld: false }, 2);
      jumps.push({ run, gait, startSpeed, switchSpeed, firstAir, heldTravel, stopped, vx, peak, heldJumps, heldLanded, releaseJumps,
        secondCount, secondVelocity, thirdCount, thirdVelocity, secondLift, landed, nextJump });
    }
    const tree = B.props.find(prop => prop.prop === "tree"); tree.node.visible = true; S.updateWorld(root); solids.sync();
    const q = tree.node.position; setup(q.x - 2.8, q.z, Math.PI / 2);
    let lowFrames = 0, bipedFrames = 0, movingFrames = 0, previous = e.root.position.x;
    advance({ x: -1, z: 0, heading: Math.PI / 2, run: false, jumpHeld: false }, 1.5, () => {
      if (e.lowCover) lowFrames++; if (e.biped) bipedFrames++;
      if (Math.abs(e.root.position.x - previous) > 1e-5) movingFrames++;
      previous = e.root.position.x;
    });
    const canopy = { startX: q.x - 2.8, endX: e.root.position.x, lowFrames, bipedFrames, movingFrames };
    tree.node.visible = false;
    const screen = S.createNode({ geometry: BL.models.box({ w: 0.5, h: 4, d: 4, color: BL.math.hexToRgb("#454545") }),
      position: { x: 12, y: B.island.surfaceAt(12, 0) + 2, z: 0 } });
    S.addChild(root, screen); solids.add(screen); S.updateWorld(root); solids.sync(); setup(7, 0);
    C.release();
    e.owner.override = e.owner.state = "chilling";
    Object.assign(e, { controlled: false, mode: "chilling", phase: "chill", route: "", lounge: "", loungeDepart: false,
      loungeRoof: false, loungeHeading: NaN, rest: 120, goalX: 17, goalY: B.island.surfaceAt(17, 0), goalZ: 0 });
    Object.assign(e.roam, { count: 0, index: 0, wall: false, detour: false, pose: "", departPending: false,
      targetX: 17, targetY: e.goalY, targetZ: 0, progressTime: 0.9, progressDistance: 0, planAt: 0, nextChoice: Infinity });
    const recoveries = e.stuck.recoveries;
    let detoured = false, crossed = false;
    for (let frame = 0; frame < 24 * 60; frame++) {
      C.update(1 / 60);
      detoured ||= e.roam.detour && e.roam.count > 1;
      crossed ||= Math.abs(e.root.position.x - 12) < 0.25 && Math.abs(e.root.position.z) < 2;
      if (Math.hypot(e.root.position.x - 17, e.root.position.z) < 0.18) break;
    }
    const detour = { detoured, crossed, arrived: Math.hypot(e.root.position.x - 17, e.root.position.z) < 0.18,
      recoveries: e.stuck.recoveries - recoveries, grounded: !e.climb.active && !e.jump.active && !e.drive.airborne };
    solids.remove(screen); S.removeChild(root, screen); solids.sync();
    return { traversals, raisedProp, jumps, canopy, detour };
  })()`);
  const props = state.traversals.every(row => row.x > 16 && row.maxY >= 0.75 && row.maxY <= 1.05 && !row.airborne && !row.stopped && row.maxVisibleStep < 0.25);
  const raisedProp = state.raisedProp.rockY > 0.8 && state.raisedProp.assignedExit && state.raisedProp.y < 0.05
    && Math.abs(state.raisedProp.x - 12) > 1.5 && !state.raisedProp.airborne && state.raisedProp.stuck < 0.65;
  const jump = state.jumps.every(row => {
    const speed = row.run ? 2.7 : 0.9, travel = speed * 39 / 60;
    return row.gait === (row.run ? "gallop" : "knuckle") && row.firstAir && !row.stopped
      && Math.abs(row.startSpeed - speed) < 1e-5 && Math.abs(row.switchSpeed - (row.run ? 0.9 : 2.7)) < 1e-5
      && Math.abs(row.heldTravel - travel) < travel * 0.01 && Math.abs(row.vx - speed) < speed * 0.01
      && row.heldJumps === 1 && row.heldLanded && row.releaseJumps === 1 && row.secondCount === 2 && row.thirdCount === 2
      && row.thirdVelocity < row.secondVelocity && row.secondLift > row.peak * 0.98 && row.secondLift < row.peak * 1.02 && row.landed && row.nextJump;
  });
  const canopy = state.canopy.lowFrames > 0 && !state.canopy.bipedFrames && state.canopy.movingFrames > 10 && state.canopy.endX < state.canopy.startX - 1;
  const detour = state.detour.detoured && state.detour.arrived && !state.detour.crossed && !state.detour.recoveries && state.detour.grounded;
  record("gorilla traversal: crates, barrels and rocks keep a continuous grounded gallop, an autonomous gorilla leaves a destroyed raised prop, fresh presses jump immediately and once more in air without held repeats or cancellation exploits, low cover permits an all-fours retreat, and a stalled stroller walks around tall scenery", props && raisedProp && jump && canopy && detour, JSON.stringify(state));
} }, { name: "gorilla camera modes", why: "regression: controlled gorillas lacked first-person and birds-eye cameras, carry/combat camera controls, and a combat crosshair", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, P = B.clankerPlay, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl");
    const canvas = document.getElementById("scene"), reticle = document.getElementById("weapon-reticle"), button = document.getElementById("mode-hud");
    P.release(); C.release(); C.cancelDebugMove(e);
    for (const prop of B.props) prop.node.visible = false;
    Object.assign(e.root.position, { x: 7, y: B.island.surfaceAt(7, 0), z: 0 });
    Object.assign(e, { active: true, controlled: false, recover: 0, lounge: "", parked: false, biped: false,
      heading: Math.PI / 2, speed: 0, lowCover: false, pound: 0, beat: 0, stand: 0 });
    Object.assign(e.drive, { airborne: false, passiveFall: false, grounded: true, resume: false, vx: 0, vy: 0, vz: 0, motionRecover: 0, motionEnvelope: false });
    e.climb.active = e.jump.active = e.fire.burning = e.fire.rolling = false; e.root.visible = true;
    e.gorilla.poseManaged(2, 7, e.root.position.y, 0, e.heading, 0, false, false, "", e.motion);
    BL.scene.updateWorld(BL.scenes.hub.root); B.headquarters.solids.props.sync();
    const originalHeadHidden = !!e.gorilla.parts.head.cameraHidden, near = B.camera.near;
    reticle.dataset.sight = reticle.dataset.close = reticle.dataset.occluded = "true";
    reticle.dataset.hit = "object"; reticle.style.left = "31px"; reticle.style.top = "47px"; reticle.style.setProperty("--reticle-hit", "1");
    const possessed = P.possess(e, true), rows = [];
    canvas.focus();
    const key = (type, value, code = "Key" + value.toUpperCase(), location = 0) => window.dispatchEvent(new KeyboardEvent(type,
      { key: value, code, location, bubbles: true, cancelable: true }));
    const tap = (value, code, location) => { key("keydown", value, code, location); key("keyup", value, code, location); };
    const wheel = deltaY => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
    const sample = name => {
      B.advance(1, 1 / 60);
      const camera = B.camera, p = e.root.position, orbit = B.pilot.orbit;
      const row = { name, view: P.view, combat: P.combat, hidden: reticle.hidden,
        visible: getComputedStyle(reticle).visibility, stroke: getComputedStyle(reticle.querySelector("svg")).stroke,
        headHidden: !!e.gorilla.parts.head.cameraHidden, mix: camera.orthoMix, cutaway: B.renderOpts.birdsEyeCutaway,
        hudView: button.dataset.view, hudCombat: button.dataset.combat,
        side: (camera.target.x - p.x) * Math.cos(orbit.yaw) - (camera.target.z - p.z) * Math.sin(orbit.yaw),
        yaw: orbit.yaw, finite: [camera.position.x, camera.position.y, camera.position.z,
          camera.target.x, camera.target.y, camera.target.z].every(Number.isFinite) };
      rows.push(row); return row;
    };
    try {
      const shoulder = sample("combat shoulder");
      const reset = reticle.dataset.sight === "false" && reticle.dataset.close === "false" && reticle.dataset.occluded === "false"
        && reticle.dataset.hit === "none" && !reticle.style.left && !reticle.style.top && !reticle.style.getPropertyValue("--reticle-hit");
      tap("Shift", "ShiftRight", 2); const swapped = sample("other shoulder");
      tap("x"); sample("carry shoulder");
      wheel(-120); sample("carry first-person");
      tap("x"); sample("combat first-person");
      wheel(120); sample("combat shoulder again");
      // A fresh wheel gesture may cross the next stop; one gesture cannot skip both close views.
      P.zoom(2, "overhead"); const overhead = sample("combat birds-eye");
      key("keydown", "q"); B.advance(0.3, 1 / 60); key("keyup", "q");
      const turned = sample("rotated birds-eye");
      tap("n"); const north = sample("north birds-eye");
      tap("x"); sample("carry orbit");
      tap("x"); sample("combat birds-eye again");
      P.zoom(0.01, "inward"); sample("combat shoulder from overhead");
      P.zoom(0.5, "first-person"); sample("first-person before release");
      const eye = { ...B.camera.position }, target = { ...B.camera.target };
      P.release();
      const released = { active: P.active, controlled: e.controlled, headHidden: !!e.gorilla.parts.head.cameraHidden,
        hidden: reticle.hidden, target: reticle.dataset.target, hit: reticle.dataset.hit,
        positionCleared: !reticle.style.left && !reticle.style.top, near: B.camera.near,
        eyeDelta: Math.hypot(B.camera.position.x - eye.x, B.camera.position.y - eye.y, B.camera.position.z - eye.z),
        targetDelta: Math.hypot(B.camera.target.x - target.x, B.camera.target.y - target.y, B.camera.target.z - target.z) };
      return { possessed, reset, rows, swap: shoulder.side * swapped.side < 0,
        turn: Math.abs(turned.yaw - overhead.yaw), north: Math.atan2(Math.sin(north.yaw), Math.cos(north.yaw)), originalHeadHidden, near, released };
    } finally { key("keyup", "q"); key("keyup", "Shift", "ShiftRight", 2); P.release(); }
  })()`);
  const views = ["shoulder", "shoulder", "shoulder", "first-person", "first-person", "shoulder", "birds-eye", "birds-eye", "birds-eye", "orbit", "birds-eye", "shoulder", "first-person"];
  const modes = [true, true, false, false, true, true, true, true, true, false, true, true, true];
  const cameras = state.rows.length === views.length && state.rows.every((row, i) => row.finite && row.view === views[i] && row.combat === modes[i]
    && row.hudView === row.view && row.hudCombat === String(row.combat) && row.hidden === !row.combat
    && (!row.combat || row.visible === "visible" && row.stroke === "rgb(255, 255, 255)")
    && row.headHidden === (row.view === "first-person") && row.mix === (row.view === "birds-eye" ? 1 : 0)
    && row.cutaway === (row.view === "birds-eye"));
  const released = state.released;
  record("gorilla camera: carry and combat share first-person, shoulder and distant views; Right Shift swaps shoulder, Q rotates birds-eye and N faces north; combat has a white-ring crosshair and release restores the head without moving the camera",
    state.possessed && state.reset && cameras && state.swap && state.turn > 0.2 && Math.abs(state.north) < 0.001
    && !released.active && !released.controlled && released.headHidden === state.originalHeadHidden && released.hidden
    && released.target === "none" && released.hit === "none" && released.positionCleared && released.near === state.near
    && released.eyeDelta < 1e-6 && released.targetDelta < 1e-6, JSON.stringify(state));
} }, { name: "gorilla wall destination", why: "regression: commanding a roof gorilla to a lower point farther along the cave face stalled at the crest instead of reaching the clicked wall", run: async (b) => {
  const state = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, C = B.clankers, e = C.list.find(e => e.owner.traits.name === "portlandhodl"), root = BL.scenes.hub.root;
    B.pilot.release(true); C.release(); C.cancelDebugMove(e);
    for (const other of C.list) if (other !== e) {
      other.owner.override = other.owner.state = "away"; other.owner.bedTravel.mode = "";
      other.controlled = other.drive.airborne = other.climb.active = other.fire.rolling = other.active = other.root.visible = false;
    }
    for (const cave of B.cavemen.values()) cave.root.visible = false;
    for (const prop of B.props) prop.node.visible = false;
    const mouth = B.island.mouths.find(m => m.id === "c3"), cr = Math.cos(mouth.ry), sr = Math.sin(mouth.ry);
    const start = { x: mouth.x - cr * 2 - sr * 4.8, y: 0, z: mouth.z + sr * 2 - cr * 4.8 };
    start.y = B.island.surfaceAt(start.x, start.z);
    // The target comes from the real cave face, independently of its navigation
    // graph: a horizontal ray at a lower height and farther across the wall.
    const terrain = S.createNode({ geometry: B.island.geometry });
    const ray = BL.weaponTargets.create([{ node: terrain, owner: {}, radius: 0 }]);
    const target = { node: null, owner: null, x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 0 } };
    if (!ray.ray(target, mouth.x + cr * 3.8 + sr * 8, start.y - 2.5,
      mouth.z - sr * 3.8 + cr * 8, -sr, 0, -cr, 20)) return { fixture: false };
    Object.assign(e.root.position, start);
    Object.assign(e, { active: true, controlled: false, mode: "chilling", phase: "chill", route: "", fromSite: -1,
      pendingSite: -1, hasSlot: false, lounge: "", loungeDepart: false, parked: false, biped: false,
      recover: 0, rest: 1000, heading: mouth.ry, speed: 0, pound: 0, beat: 0, stand: 0, blocked: 0,
      exitFootprint: false, lowCover: false, footprintMode: "walk", radius: BL.clankers.WALK_RADIUS, height: BL.clankers.WALK_HEIGHT });
    e.owner.state = "chilling"; e.root.visible = true;
    Object.assign(e.drive, { airborne: false, passiveFall: false, grounded: true, resume: false, jumpHeld: false,
      jumpDown: false, jumpPressed: false, jumps: 0, vx: 0, vy: 0, vz: 0, motionRecover: 0, motionEnvelope: false });
    e.jump.active = e.fire.burning = e.fire.rolling = false; e.fire.rollRecover = 0;
    Object.assign(e.climb, { active: false, searchPending: false, searchDeferred: false, claimPending: false,
      crestPending: false, retry: 0, searchCursor: 0, debugStuck: false, debugStop: -1 });
    Object.assign(e.motion, { climb: 0, climbBlend: NaN, climbSide: 0, climbDirection: 0, climbStride: 0,
      mantle: 0, roll: 0, rollAngle: 0, charge: 0,
      landing: 0, takeoff: 0, supportOffset: 0, lab: false, labRunIn: false, labWork: "", smash: false });
    e.gorilla.poseManaged(2, start.x, start.y, start.z, e.heading, 0, false, false, "", e.motion);
    S.updateWorld(root); B.headquarters.solids.props.sync();
    // surfaceAt only describes the root's column. Settle the complete footprint on a nearby roof tread
    // and certify the actual rig before issuing the same lower lateral wall destination.
    const requestedStart = { ...start }, solid = (x, y, z) => B.island.solidAt(x, y, z)
      && B.island.solidAt(x - 0.004, y, z) && B.island.solidAt(x + 0.004, y, z)
      && B.island.solidAt(x, y - 0.004, z) && B.island.solidAt(x, y + 0.004, z)
      && B.island.solidAt(x, y, z - 0.004) && B.island.solidAt(x, y, z + 0.004);
    const clearProps = (_entry, x, y, z, nx, ny, nz, radius, height, _actors, _riders, nr = radius, nh = height) =>
      B.headquarters.solids.props.segmentClear(x, y, z, nx, ny, nz, radius, height, null, nr, nh);
    let validStart = false;
    for (let i = 0; i < 25; i++) {
      const distance = i ? Math.ceil(i / 8) * 0.7 : 0, angle = i * Math.PI / 4;
      const x = requestedStart.x + Math.sin(angle) * distance, z = requestedStart.z + Math.cos(angle) * distance;
      let y = B.island.surfaceAt(x, z);
      e.compact = e.gorilla.compact;
      for (let settle = 0; settle < 8; settle++) {
        const floor = C.supportAt(e, x, z, y, 0.52, e.heading);
        if (!Number.isFinite(floor) || Math.abs(floor - y) < 1e-5) { y = floor; break; }
        y = floor;
      }
      if (!Number.isFinite(y) || Math.abs(y - requestedStart.y) > 1.2) continue;
      e.gorilla.poseManaged(2, x, y, z, e.heading, 0, false, false, "", e.motion);
      if (!e.gorilla.climbPoseClear(0, x, y, z, e.heading, e.motion, solid, clearProps, e, 0, true)) continue;
      Object.assign(start, { x, y, z }); validStart = true; break;
    }
    if (!validStart) return { fixture: false, reason: "No supported clear roof start", requestedStart };
    S.updateWorld(root);
    const moveTo = (hit) => {
      const from = { ...e.root.position }, recoveries = e.stuck.recoveries;
      const accepted = C.debugMove(e, hit.x, hit.y, hit.z, hit.normal);
      let seconds = 0, maxStep = 0, climbing = 0, verticalExcursion = 0, overlap = null, stayedHanging = e.climb.active;
      let px = from.x, py = from.y, pz = from.z;
      while (accepted && seconds < 45 && e.debugMove.status !== "arrived" && e.debugMove.status !== "blocked") {
        B.advance(1 / 30, 1 / 30); seconds += 1 / 30;
        const p = e.root.position;
        maxStep = Math.max(maxStep, Math.hypot(p.x - px, p.y - py, p.z - pz));
        verticalExcursion = Math.max(verticalExcursion, Math.abs(p.y - from.y));
        px = p.x; py = p.y; pz = p.z;
        if (e.climb.active) climbing++; else stayedHanging = false;
        S.updateWorld(e.root, root.world);
        if (!overlap) S.traverseVisible(e.root, node => {
          if (overlap || !node.geometry) return;
          const verts = node.geometry.verts, m = node.world;
          for (let i = 0; i < verts.length; i += 3) {
            const x = m[0] * verts[i] + m[4] * verts[i + 1] + m[8] * verts[i + 2] + m[12];
            const y = m[1] * verts[i] + m[5] * verts[i + 1] + m[9] * verts[i + 2] + m[13];
            const z = m[2] * verts[i] + m[6] * verts[i + 1] + m[10] * verts[i + 2] + m[14];
            // Millimetre contact is allowed; a rendered vertex enclosed in stone
            // on every side is penetration, including during the mount transition.
            if (B.island.solidAt(x, y, z) && B.island.solidAt(x - 0.004, y, z) && B.island.solidAt(x + 0.004, y, z)
              && B.island.solidAt(x, y - 0.004, z) && B.island.solidAt(x, y + 0.004, z)
              && B.island.solidAt(x, y, z - 0.004) && B.island.solidAt(x, y, z + 0.004)) { overlap = { x, y, z, seconds }; break; }
          }
        });
      }
      const p = e.root.position, dx = p.x - hit.x, dz = p.z - hit.z;
      return { accepted, seconds, from, target: { x: hit.x, y: hit.y, z: hit.z }, end: { ...p },
        status: e.debugMove.status, reason: e.debugMove.reason, climbing, hanging: e.climb.active, stayedHanging,
        lateral: Math.abs((p.x - from.x) * cr - (p.z - from.z) * sr), drop: from.y - p.y, verticalExcursion,
        tangentError: Math.abs(dx * hit.normal.z - dz * hit.normal.x), outwardGap: dx * hit.normal.x + dz * hit.normal.z,
        verticalError: Math.abs(p.y - hit.y), maxStep, overlap, recoveries: e.stuck.recoveries - recoveries };
    };
    const first = moveTo(target);
    // Retarget the hanging gorilla along the same real wall without moving it
    // or replacing the climb state. A route over the roof is not a wall traverse.
    const sideways = { node: null, owner: null, x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 0 } };
    const p = e.root.position, sideX = (p.x - mouth.x) * cr - (p.z - mouth.z) * sr - 2.8;
    const secondHit = first.status === "arrived" && first.hanging && ray.ray(sideways,
      mouth.x + cr * sideX + sr * 8, target.y, mouth.z - sr * sideX + cr * 8, -sr, 0, -cr, 20);
    const second = secondHit ? moveTo(sideways) : null;
    C.cancelDebugMove(e);
    // Campaign curated-0002 reached this c11 rim with both fists above its
    // stone. Check the actual rendered palms throughout a grip cycle, separate
    // from the planner's arrival status and its collision-envelope samples.
    Object.assign(e.motion, { climb: 1, climbBlend: 1, climbDirection: -0.6255252611070319,
      climbSide: -0.6255252611070318, mantle: 0, supportOffset: 0 });
    const grips = [], gripHit = { node: null, owner: null, x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 0 } }; let poseMs = 0, previewMs = 0;
    for (let sample = 0; sample < 13; sample++) {
      e.motion.climbStride = -4.118063882033883 + sample * 0.1;
      const now = performance.now();
      e.gorilla.poseManaged(2, -9.302193461208958, 4.39795073400838, -18.257134086425605, Math.PI, 0, false, false, "", e.motion);
      poseMs += performance.now() - now;
      const previewStart = performance.now(), p = e.root.position;
      const previewClear = e.gorilla.climbPoseClear(1 / 30, p.x, p.y, p.z, Math.PI, e.motion, solid, clearProps, e);
      previewMs += performance.now() - previewStart;
      S.updateWorld(e.root, root.world);
      let gap = Infinity, overlap = null;
      S.traverseVisible(e.root, node => {
        if (!node.geometry) return;
        const v = node.geometry.verts, m = node.world, clip = node.geometry.clipPlane, hand = node === e.parts.armL || node === e.parts.armR;
        let low = Infinity, high = -Infinity;
        if (hand) for (let i = 1; i < v.length; i += 3) { low = Math.min(low, v[i]); high = Math.max(high, v[i]); }
        for (let i = 0; i < v.length; i += 3) {
          const x = m[0] * v[i] + m[4] * v[i + 1] + m[8] * v[i + 2] + m[12];
          const y = m[1] * v[i] + m[5] * v[i + 1] + m[9] * v[i + 2] + m[13];
          const z = m[2] * v[i] + m[6] * v[i + 1] + m[10] * v[i + 2] + m[14];
          if (clip && clip[0] * x + clip[1] * y + clip[2] * z + clip[3] > 0) continue;
          if (!overlap && solid(x, y, z)) overlap = { x, y, z, hand };
          if (!hand || v[i + 1] > low + (high - low) * 0.15 + 1e-6) continue;
          if (B.island.solidAt(x, y, z)) gap = 0;
          else if (ray.ray(gripHit, x, y, z, 0, 0, -1, 3)) gap = Math.min(gap, gripHit.distance);
        }
      });
      grips.push({ gap: Number.isFinite(gap) ? gap : null, overlap, previewClear });
    }
    return { fixture: start.y > 3 && Math.abs(target.normal.y) < 0.2,
      first, secondFixture: !!secondHit && Math.abs(sideways.normal.y) < 0.2, second, grips, poseMs, previewMs };
  })()`);
  const safeArrival = row => row && row.accepted && row.status === "arrived" && row.hanging && row.climbing > 15
    && row.tangentError <= 0.8 && row.outwardGap > 0.3 && row.outwardGap < 2 && row.verticalError < 0.5
    && row.maxStep < 0.22 && !row.overlap && !row.recoveries;
  record("gorilla wall destination: a roof gorilla reaches the clicked lower lateral wall grip through continuous climbing without relocation or terrain penetration",
    state.fixture && safeArrival(state.first) && state.first.lateral > 3.5 && state.first.drop > 1.5, JSON.stringify(state.first || state));
  record("gorilla wall destination: a second click moves the hanging gorilla sideways along the wall without dismounting, teleporting or entering stone",
    state.secondFixture && safeArrival(state.second) && state.second.stayedHanging
    && state.second.lateral > 1.2 && state.second.verticalExcursion < 0.7, JSON.stringify(state.second || state));
  record("gorilla wall grip: lowered hands contact the uneven cave rim throughout their cycle without any rendered mesh penetrating stone",
    state.grips?.length === 13 && state.grips.every(row => row.gap !== null && row.gap < 0.5 && !row.overlap && row.previewClear),
    JSON.stringify({ grips: state.grips, poseMs: state.poseMs, previewMs: state.previewMs }));
  const labTransition = await b.evaluate(`(() => {
    const B = __ooga, S = BL.scene, e = B.clankers.list.find(e => e.owner.traits.name === "portlandhodl"), root = BL.scenes.hub.root;
    B.clankers.cancelDebugMove(e);
    Object.assign(e.motion, { climb: 0, climbBlend: NaN, climbDirection: 0, climbSide: 0, climbStride: 0, mantle: 0,
      climbGripX: NaN, climbGripY: NaN, climbGripZ: NaN, labRunIn: false, labWork: "", labSqueeze: false,
      roll: 0, rollAngle: 0, charge: 0, landing: 0, takeoff: 0, supportOffset: 0, smash: false });
    const center = node => {
      const b = S.boundsOf(node.geometry), x = (b.min[0] + b.max[0]) / 2, y = (b.min[1] + b.max[1]) / 2, z = (b.min[2] + b.max[2]) / 2, m = node.world;
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    const rows = [];
    for (const entering of [true, false]) {
      // These adjacent roots straddle the lab boundary from curated-0000's
      // captured snap; the rest of the walk keeps its real 0.9 m/s stride.
      const x = entering ? -10.735000000000095 : -10.750000000000096;
      const z = entering ? -18.593565419251977 : -18.61954618136551, sign = entering ? -1 : 1;
      e.motion.lab = !entering;
      e.gorilla.poseManaged(2, x, 0, z, 3.665191429188082, 0.9, false, !entering, "", e.motion);
      S.updateWorld(e.root, root.world);
      let head = center(e.parts.head), torso = center(e.parts.torso), maxStep = 0;
      const before = e.gorilla.debug.pitch;
      e.motion.lab = entering;
      for (let frame = 1; frame <= 24; frame++) {
        e.gorilla.poseManaged(1 / 30, x + sign * frame * 0.015, 0, z + sign * frame * 0.02598076211353316,
          3.665191429188082, 0.9, false, entering, "", e.motion);
        S.updateWorld(e.root, root.world);
        const nextHead = center(e.parts.head), nextTorso = center(e.parts.torso);
        maxStep = Math.max(maxStep, Math.hypot(...nextHead.map((n, i) => n - head[i])), Math.hypot(...nextTorso.map((n, i) => n - torso[i])));
        head = nextHead; torso = nextTorso;
      }
      const after = e.gorilla.debug.pitch;
      e.gorilla.poseManaged(2, e.root.position.x, e.root.position.y, e.root.position.z, 3.665191429188082, 0.9, false, entering, "", e.motion);
      const settled = e.gorilla.debug.pitch, gait = e.gorilla.debug.gait;
      let workRaise = null;
      if (entering) {
        S.updateWorld(e.root, root.world); const handY = center(e.parts.armR)[1];
        e.motion.labWork = "touch"; e.motion.labSide = 1;
        e.gorilla.poseManaged(0.5, e.root.position.x, e.root.position.y, e.root.position.z, 3.665191429188082, 0, false, true, "", e.motion);
        S.updateWorld(e.root, root.world); workRaise = center(e.parts.armR)[1] - handY;
        e.motion.labWork = "";
      }
      rows.push({ entering, before, after, settled, gait, maxStep, workRaise });
    }
    return rows;
  })()`);
  record("gorilla lab stance: entering and leaving the lab smoothly animate the rendered head and torso instead of snapping upright or onto all fours",
    labTransition.every(row => row.maxStep < 0.3 && Math.abs(row.after - row.settled) < 0.025
      && (row.entering ? row.gait === "upright" && row.before - row.after > 0.65 && row.workRaise > 0.4
        : row.gait === "knuckle" && row.after - row.before > 0.65)), JSON.stringify(labTransition));
} }] });
scene("hub", { label: "mirror clanker", query: "solo=1&character=portlandhodl&status=clankin", steps: [{ name: "mirror clanker stays inside", why: "regression: a clanker turned around after crossing the mirror, poked its head back out, and worked beside a glowing generic box", run: async (b) => {
  const state = await b.evaluate(`(() => { const B = __ooga, C = B.clankers, siteIndex = C.sites.findIndex(s => s.mirrorRoom), site = C.sites[siteIndex], m = site.mouth, e = C.list[0], localX = p => (p.x - m.x) * site.cr - (p.z - m.z) * site.sr, localZ = p => (p.x - m.x) * site.sr + (p.z - m.z) * site.cr, place = (x, z) => ({ x: m.x + site.cr * x + site.sr * z, y: m.floorY, z: m.z - site.sr * x + site.cr * z }); e.owner.state = "working"; e.owner.work.site = e.owner.work.plannedSite = e.site = siteIndex; e.pendingSite = -1; e.hasSlot = true; e.slotIndex = 0; Object.assign(e, { slotX: place(0, -4.92).x, slotY: m.floorY, slotZ: place(0, -4.92).z, phase: "travel", route: "enter", fromSite: -1, entryTurn: false, blocked: 0, retry: 0 }); Object.assign(e.root.position, place(0, 0)); e.heading = m.ry + Math.PI; B.advance(0.25, 1 / 60); const entry = { turn: e.entryTurn, goal: localZ({ x: e.goalX, z: e.goalZ }) }; Object.assign(e.root.position, place(0, -4.92)); e.phase = "work"; e.route = ""; e.goalX = e.slotX; e.goalY = e.slotY; e.goalZ = e.slotZ; let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, distance = 0, lastX = e.root.position.x, lastZ = e.root.position.z; for (let t = 0; t < 18; t += 1 / 30) { B.advance(1 / 30, 1 / 30); const x = localX(e.root.position), z = localZ(e.root.position); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); distance += Math.hypot(e.root.position.x - lastX, e.root.position.z - lastZ); lastX = e.root.position.x; lastZ = e.root.position.z; } const control = B.matrixGate.button, lever = B.matrixGate.lever; return { room: m.room, entry, minX, maxX, minZ, maxZ, distance, recoveries: e.stuck.recoveries, equipment: C.equipment.filter(item => item.site === siteIndex).length, leverY: control.position.y, leverScale: control.scale.y, leverZ: control.position.z, leverTagged: control.geometry.matrixCave !== undefined && control.children.every(node => node.geometry.matrixCave !== undefined) && lever.children.every(node => node.geometry.matrixCave !== undefined), leverNative: !!control.matrixNative, leverParts: control.children.length, gripParts: lever.children.length }; })()`);
  record("mirror clanker: the safe chamber expands, entry continues straight inward, runs cross from side to side at varied depths behind the glass, and a compact glyphed lever is mounted within reach on the back wall", state.room.w > 6 && state.room.to > 6.5 && Math.abs(state.entry.goal + 3.5) < 0.01 && state.maxZ <= -1.85 + 1e-6 && state.minX < -0.8 && state.maxX > 0.8 && state.maxZ - state.minZ > 1 && state.distance > 8 && state.equipment === 0 && state.leverY >= 1 && state.leverY < 1.5 && state.leverScale < 1 && state.leverZ < -state.room.to + 0.3 && state.leverTagged && !state.leverNative && state.leverParts === 3 && state.gripParts === 1, JSON.stringify(state));
} }] });
scene("hub", { perf: true, query: "bananas=1000", opts: { w: 1920, h: 1080, perf: true, motion: true }, steps: [{ name: "wall movement performance", why: "regression: frame rate fell moving behind cave walls during a donation", run: wallPerformance }] });
scene("lab", { steps: [donation("lab"), labWalking, labKeys, trip("lab")] });
scene("race", { query: "rain=0", steps: [raceStart, { name: "race tracks", why: "regression: the 12-slot grid spawned a free banana on Banana Bay", run: async (b) => { await b.evaluate(`window.__ooga.race.toGarage()`); await raceTracks[1](b); } }, racePause, play("race", "a whole cup under the autopilot: every racer finishes in order, the cup medal and every track's best are saved", cupRun), raceMirror, raceAgain, trip("race")] });
scene("drop", { steps: [dropStart, dropSteering, play("drop", "a jump lands on the target, scores its own medal and is saved as the best", dropRun), dropCrash, trip("drop")] });
scene("orbit", { steps: [{ name: "orbit flow", why: "regression: the spacewalk air bonus was missing from the flight log", run: orbitFlow }, orbitSteering, orbitMissed, orbitEscape, trip("orbit")] });
scene("mine", { steps: [mineResume, trip("mine"), mineControls] });
scene("pool", { steps: [poolLeave, trip("pool")] });
scene("factory", { query: "character=portlandhodl", steps: [factoryWalking, factoryLadders, factoryRailingJump, factoryWeapons, factoryForward, factoryForge, factoryShields, trip("factory")] });
scene("factory", { label: "entrance", url: hubPage(src, "character=portlandhodl"), steps: [factoryFloor, factoryEntrance] });
scene("factory", { label: "canvas2d", query: "canvas2d=1", steps: [factoryCanvas] });
scene("bifrost", { url: hubPage(src, "solo=1&character=portlandhodl"), steps: [bifrostEntrance, bifrostWalking, bifrostExit, trip("bifrost")] });
scene("bifrost", { label: "dsb round trip", query: "character=portlandhodl", steps: [bifrostDsb] });
scene("bifrost", { label: "poker round trip", query: "character=portlandhodl", steps: [bifrostPoker] });
scene("bifrost", { label: "canvas2d", url: hubPage(src, "canvas2d=1"), steps: [bifrostCanvas] });
scene("arcade", { query: "character=portlandhodl", steps: [arcadeWalking, arcadeMachine, arcadePlay, trip("arcade")] });
scene("skee", { steps: [carnivalPlay("skee", 0.5), trip("skee")] });
scene("hoops", { steps: [carnivalPlay("hoops", 0.2), trip("hoops")] });
scene("shy", { steps: [carnivalPlay("shy", 0.7), trip("shy")] });
scene("claw", { steps: [carnivalPlay("claw", 0.6), trip("claw")] });
scene("hockey", { steps: [carnivalPlay("hockey", 0.5), trip("hockey")] });
scene("billiards", { steps: [carnivalPlay("billiards", 0.8), trip("billiards")] });
scene("darts", { steps: [carnivalPlay("darts", 0.5), trip("darts")] });
scene("pinball", { steps: [carnivalPlay("pinball", 0.5), trip("pinball")] });
scene("ride", { steps: [carnivalPlay("ride", 0.2), trip("ride")] });
scene("invaders", { steps: [carnivalPlay("invaders", 0.25), trip("invaders")] });
scene("snake", { steps: [carnivalPlay("snake", 0.5), trip("snake")] });
scene("pong", { steps: [carnivalPlay("pong", 0.5), trip("pong")] });
scene("stampede", { steps: [carnivalPlay("stampede", 0.5), trip("stampede")] });
scene("flap", { steps: [carnivalPlay("flap", 0.5), trip("flap")] });
scene("breaker", { steps: [carnivalPlay("breaker", 0.5), trip("breaker")] });
scene("dash", { steps: [carnivalPlay("dash", 0.5), trip("dash")] });
scene("stacker", { steps: [carnivalPlay("stacker", 0.5), trip("stacker")] });
scene("poker", { query: "character=portlandhodl", steps: [{ name: "poker floor and play", why: "playthrough: a visitor walks the floor, fills a table, plays to settlement and stands without exposing hidden cards", run: async b => {
  await b.evaluate(`document.querySelector('[data-intro="poker"] .game-intro-go').click()`);
  const walking = await walkKeys(b, "portlandhodl", 0, 18, [0, 1.5], 0.45);
  record("poker walking: spectators move with WASD from two camera angles", allWalk(walking), JSON.stringify(walking));
  const r = await b.evaluate(`(() => {
    const B = __ooga, P = BL.scenes.poker.debug.poker, click = a => document.querySelector('[data-poker-action="' + a + '"]').click();
    const count = P.room.tables.length, seats = P.room.tables.every(t => t.chairs.length === 9), dealers = P.room.tables.every(t => t.agent.parts.torso.children.length >= 4);
    P.select(0); click("join"); for (let i = 0; i < 4; i++) click("bots"); click("start");
    const t = P.session.tables[0], privateCards = t.snapshot().seats.every(s => s.cards.every(c => c === null));
    let guard = 0; while (t.playing && guard++ < 500) { if (t.snapshot("local-player").legal) click("call"); B.advance(0.81, 1 / 30); }
    const done = t.snapshot(), total = done.seats.reduce((n, s) => n + s.stack, 0), shown = document.querySelector('[data-poker="street"]').textContent;
    click("stand"); P.select(9); click("bots"); click("start"); B.advance(1, 1 / 30);
    return { count, seats, dealers, privateCards, phase: done.phase, total, shown, tableTen: P.session.tables[9].snapshot().hand, standing: !document.body.hasAttribute("data-poker-seated") };
  })()`);
  record("poker local play: ten suited dealers, 90 chairs, nine-player settlement, table ten playable and private snapshots", r.count === 10 && r.seats && r.dealers && r.privateCards && r.phase === "showdown" && r.total === 9000 && r.shown === "Hand complete" && r.tableTen === 1 && r.standing, JSON.stringify(r));
  if (process.env.POKER_SHOTS) {
    await b.evaluate(`(() => { const P = BL.scenes.poker.debug.pilot; P.release(true); P.goPreset("entrance"); __ooga.advance(2); })()`);
    await b.screenshot(join(process.env.POKER_SHOTS, "poker-floor.png"));
  }
} }, trip("poker")] });
scene("poker", { label: "canvas2d", query: "canvas2d=1", steps: [{ name: "poker canvas2d", why: "rule: the floor and table controls work on the fallback renderer", run: async b => {
  await b.evaluate(`document.querySelector('[data-intro="poker"] .game-intro-go').click()`);
  const r = await b.evaluate(`(() => { const P = BL.scenes.poker.debug.poker; P.action("join"); P.action("bots"); P.action("start"); __ooga.advance(1); return { kind: __ooga.renderer.kind, phase: P.session.tables[0].snapshot().phase, nodes: __ooga.stats().visibleNodes }; })()`);
  record("poker fallback: stone tables and a playable hand on Canvas 2D", r.kind === "canvas2d" && r.phase !== "waiting" && r.nodes > 120, JSON.stringify(r));
} }] });
scene("poker", { opts: PHONE_SIZE, steps: [phone("poker", { card: '[data-intro="poker"]', required: ["#joy-move", "#joy-look", '[data-poker-action="quick"]'] }), { name: "poker phone actions", why: "rule: seated touch players can read private cards and access legal actions without horizontal overflow", run: async b => {
  const r = await b.evaluate(`(() => { const P = BL.scenes.poker.debug.poker; document.querySelector('[data-poker-action="quick"]').click(); const panel = document.querySelector('[data-poker="focus"]'), r = panel.getBoundingClientRect(); return { fits: !panel.hidden && r.left >= 0 && r.right <= innerWidth && panel.scrollWidth <= panel.clientWidth + 1, seats: document.querySelectorAll(".poker-seats button").length, cards: document.querySelectorAll(".poker-hand .poker-card").length }; })()`);
  record("poker phone: nine seat choices and two private cards fit the panel", r.fits && r.seats === 9 && r.cards === 2, JSON.stringify(r));
  if (process.env.POKER_SHOTS) await b.screenshot(join(process.env.POKER_SHOTS, "poker-phone.png"));
} }] });
scene("hub", { label: "weapons", query: "character=portlandhodl&weapon=2&mag=1&ammo=6&jetpack=1", steps: [hubAk, hubMelee, hubJetpack] });
scene("hub", { label: "birds-eye combat", query: "solo=1&character=portlandhodl&weapon=1&mode=shoulder&combat=1", steps: [hubBirdsEye, hubBirdsEyeFloors, hubBirdsEyeProjection, hubBirdsEyeTargets, hubCombatReplay] });
scene("hub", { label: "mirror", steps: [hubJumbotron, hubMatrix, hubMirror] });
scene("hub", { label: "side panel", query: "pos=0", steps: [hubSheetPersistence] });
scene("hub", { label: "clock and block height", query: "pos=0&hour=9", steps: [hubBlockHeight] });
scene("hub", { label: "canvas2d", query: "canvas2d=1", steps: [canvasTour] });
scene("hub", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("hub", { required: ["#joy-move", "#joy-look", "#sheet-toggle", "#sheet-bananas"], sheet: true })] });
scene("lab", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("lab", { required: ["#joy-move", "#joy-look", ".leave"] })] });
scene("race", { query: "pos=0&rain=0", opts: PHONE_SIZE, steps: [phone("race", { card: '[data-intro="race"]', play: "window.__ooga.race.startRace()", required: ["#joy-move", "#act", "#item-btn", "#race-garage-btn", ".leave"] })] });
scene("drop", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("drop", { card: '[data-intro="drop"]', play: "window.__ooga.drop.start()", required: ["#joy-move", "#joy-look", "#act", ".leave"] })] });
scene("orbit", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("orbit", { card: '[data-intro="orbit"]', play: "window.__ooga.orbit.launch()", required: ["#joy-move", "#act", ".leave"] })] });
scene("mine", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("mine", { card: "#mine-intro", required: ["#joy-move", "#joy-look", "#act", "#mine-view-btn", "#mine-pause-btn", "#mine-mute", ".leave"] })] });
scene("pool", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("pool", { required: ["#joy-move", "#joy-look", ".leave"] })] });
scene("factory", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("factory", { required: ["#joy-move", "#joy-look", ".leave"] })] });
scene("bifrost", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("bifrost", { required: ["#joy-move", "#joy-look", ".leave"] })] });
scene("arcade", { query: "pos=0", opts: PHONE_SIZE, steps: [phone("arcade", { required: ["#joy-move", "#joy-look", ".leave"] })] });

// DSB has no hub entrance during this merge. Exercise the existing world.pilot
// contract explicitly; no new player-facing route is introduced by the fixture.
const dsbEnter = async (b) => {
  await b.evaluate(`(() => {
    const B = __ooga, scene = BL.scenes.dsb, enter = scene.enter, name = B.pilot.player?.traits.name;
    scene.enter = (ctx) => { scene.enter = enter; ctx.world.pilot = name || null; enter(ctx); };
    // Keep the selected actor controlled until the transition owns it. Letting
    // its hub AI run during the fade could fire or reload and mutate the
    // persistent ammunition that DSB is required to leave untouched.
    B.go("dsb"); B.advance(0.6);
  })()`);
};
const dsbApproach = async (b, name) => b.evaluate(`(() => {
  const B = __ooga, landmark = B.dsb.land.landmarks[${JSON.stringify(name)}], p = landmark.point();
  B.pilot.navigate({ yaw: landmark.node.rotation.y, pitch: 0.2, dist: 7, position: p, target: { x: p.x, y: 1.7, z: p.z } }); B.advance(0.1);
})()`);
const dsbExit = async (b, home = "bifrost") => {
  await b.evaluate(`__ooga.dsb.gate.activate(0); if (typeof __gateClock === "number") { __gateClock += 2000; __ooga.dsb.gate.update(); }`);
  await untilPage(b, 'B.dsb.gate.state === "ACTIVE"', 5000);
  await b.evaluate(`(() => { const B = __ooga; B.pilot.navigate({ position: { x: 0, y: 0, z: 27.9 }, yaw: Math.PI, pitch: 0.3, dist: 4 }); window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); for (let i = 0; i < 20 && !B.transitioning; i++) BL.scenes.dsb.update(0.05, 4 + i * 0.05); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); })()`);
  await untilPage(b, `B.scene === "${home}" && !B.transitioning`, 15000);
};
// Placement contract exercises the moved landmarks without changing travel fixtures.
for (const mobile of [false, true]) scene("dsb", { label: "Ooga Portal dsb plaza " + (mobile ? "canvas2d" : "webgl2"), url: hubPage(dist, "scene=dsb" + (mobile ? "&canvas2d=1" : "")), opts: mobile ? { ...PHONE_SIZE, motion: false } : { motion: true }, steps: [{ name: "Ooga Portal dsb plaza " + (mobile ? "canvas2d" : "webgl2"), why: "regression: moved Shop and TV keep collision, interactions, radio and cat navigation attached to their fronts", run: async b => {
  const check = (name, ok, detail = "") => record("DSB plaza " + (mobile ? "canvas2d: " : "webgl2: ") + name, ok, detail);
  const press = async selector => {
    const p = await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (mobile) { await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] }); await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else await b.click(p.x, p.y);
  };
  check("landmark geometry and services absent during transit", await b.evaluate(`!__ooga.dsb.land && !__ooga.dsb.resources.shop && !__ooga.dsb.resources.tv && __gateDormancy.land === 0 && __gateDormancy.tv === 0 && __gateDormancy.radio === 0 && __gateDormancy.fetch === 0`));
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); BL.scenes.dsb.update(__ooga.audio.duration + 1, 1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); document.querySelector('[data-action="dsb-skip"]').click();`);
  const placement = await b.evaluate(`(() => { const d = __ooga.dsb, a = d.land.landmarks, centre = { x: 0, z: 18 }; return { shop: a.shop.node.position, tv: a.tv.node.position, shopYaw: a.shop.node.rotation.y, tvYaw: a.tv.node.rotation.y, gate: d.gate.root.position, dialer: d.gate.dialer.position, land: __gateDormancy.land, tvCount: __gateDormancy.tv, inward: Object.values(a).every(l => { const p = l.point(); return Math.hypot(p.x-centre.x,p.z-centre.z) < Math.hypot(l.node.position.x-centre.x,l.node.position.z-centre.z); }) }; })()`);
  check("opposite inward fronts preserve gate and Dialer transforms", placement.shop.x === -14 && placement.tv.x === 14 && placement.shop.z === 18 && placement.tv.z === 18 && placement.shopYaw === Math.PI / 2 && placement.tvYaw === -Math.PI / 2 && placement.inward && placement.gate.x === 0 && placement.gate.y === 2 && placement.gate.z === 28 && placement.dialer.x === 3.7 && placement.dialer.z === 27 && placement.land === 1 && placement.tvCount === 1, JSON.stringify(placement));
  const lanes = await b.evaluate(`(() => {
    const B = __ooga, d = B.dsb, S = BL.scene, noop = () => {}, crew = BL.crew.create({ root: S.createNode(), world: { level: 0 }, input: { add: noop, remove: noop }, hud: { setRosterRow: noop }, game: { state: { assignments: {}, inventory: [] } }, pile: { footprintEdge: 1, pileEdge: () => 1 }, viewYaw: 0, buildSpots: [], walkIn: { x: 0, z: 3 }, groundAt: () => 0, walkable: () => true, bedrolls: BL.contributors.roster.map((_, i) => ({ x: 30+i*2, y: 0, z: 30, hidden: true })), fx: { say: noop, zzzAt: noop, burst: noop, puff: noop, spawnParticle: noop, damageNumber: noop } });
    const routes = [[[0,7],[0,26]],[[0,29],[0,26]],[[0,26],[0,33]],[[0,26],[3.7,25.6]],[[0,21],[7,24]],[[0,18],[-10.5,18]],[[0,18],[10.5,18]]], rows = [];
    for (const actor of crew.cavemen.values()) { let clear = true; for (const [a,c] of routes) for (let i=0;i<=128;i++) clear &&= d.clearAt(a[0]+(c[0]-a[0])*i/128,a[1]+(c[1]-a[1])*i/128,actor.bodyRadius); rows.push({ name: actor.traits.name, clear }); }
    crew.dispose(); return rows;
  })()`);
  check("all characters retain plaza, arrival, return, Dialer and ride lanes", lanes.length === CAST && lanes.every(r => r.clear), JSON.stringify(lanes));
  const old = await b.evaluate(`(() => { const B = __ooga, d = B.dsb, out = []; for (const x of [-20,-10]) { B.pilot.navigate({ position: { x,y:0,z:13 }, target: { x,y:1.7,z:13 }, yaw:0,pitch:0.3,dist:5 }); BL.scenes.dsb.update(0,2); const tokens=d.inventory.tokens; d.buy("bread"); d.openTv(); out.push(d.clearAt(x,13,d.avatar.bodyRadius) && d.inventory.tokens===tokens && !d.tv.isOpen && !["Visit meme shop","Use TV"].includes(document.getElementById("dsb-context").textContent)); } return out; })()`);
  check("old positions have no collision or Shop/TV interaction", old.every(Boolean), JSON.stringify(old));
  for (const name of ["shop", "tv"]) {
    await dsbApproach(b, name);
    check(name + " prompt follows transformed front", await b.evaluate(`document.getElementById("dsb-context").textContent === ${JSON.stringify(name === "shop" ? "Visit meme shop" : "Use TV")}`));
    await press("#dsb-context");
    if (name === "shop") { await press('[data-action="dsb-bread"]'); check("Shop purchases still work", await b.evaluate(`!document.getElementById("dsb-shop").hidden && __ooga.dsb.inventory.bread === 1 && __ooga.dsb.inventory.tokens === 17`)); await press('[data-action="dsb-close-shop"]'); }
    else { check("TV opens through native interaction", await b.evaluate(`__ooga.dsb.tv.isOpen`)); await press("#dsb-tv-close"); }
  }
  const audio = await b.evaluate(`(() => { const B=__ooga, d=B.dsb, source=d.land.landmarks.tv.point(-0.55,3.3,1.63), boat=d.land.boats[0].position; B.audio.environment({...B.camera,position:source},boat,5,source); const near=B.audio.radioVolume; B.audio.environment({...B.camera,position:{x:-10,y:3.3,z:14.6}},boat,5,source); const old=B.audio.radioVolume; BL.scene.updateWorld(d.land.root); const w=d.land.tvScreen.world; return { near,old,source,matches:Math.hypot(source.x-w[12],source.y-w[13],source.z-w[14])<1e-5 }; })()`);
  check("radio source follows rendered TV screen, not old position", audio.matches && audio.near > audio.old * 2, JSON.stringify(audio));
  const cat = await b.evaluate(`(() => {
    const d=__ooga.dsb, noop=()=>{}, z=BL.dsbAgent.create({parent:BL.scene.createNode(),input:{add:noop,remove:noop},clearAt:d.clearAt,landmarks:d.land.landmarks,brain:{observe:noop,dispose:noop,reply:()=>""}}), sense={name:"YellowBrokeIt",x:0,y:0,z:7,food:0,active:true}, rows=[]; let time=0;
    for (const id of ["snack_watch","shop_lane","west_lane","west","perch","east","arrival"]) {
      z.update(0,time,sense);const s=z.snapshot(), accepted=z.request({visit:s.visit,id:s.nextRequestId,at:time,type:"walk_to",destination:id}); let clear=true;
      for(let i=0;i<1200 && z.snapshot().self.intent === "walk";i++){time+=0.05;z.update(0.05,time,sense);clear &&= d.clearAt(z.root.position.x,z.root.position.z,0.42);}
      rows.push({id,accepted,clear,done:z.snapshot().self.intent!=="walk",x:z.root.position.x,z:z.root.position.z});
    }z.dispose();return rows;
  })()`);
  check("Zuzu routes around both moved structures to landmark-derived destinations", cat.every(r=>r.accepted==="accepted" && r.clear && r.done), JSON.stringify(cat));
} }] });

scene("dsb", { label: "dsb zuzu conversation", url: hubPage(dist), steps: [{ name: "dsb zuzu conversation", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  record("dsb compatibility: built CSP preserves exactly the weather and DSB network permissions", await b.evaluate(`(() => {
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    const sources = name => policy.split(";").map(s => s.trim().split(/\\s+/)).find(s => s[0] === name).slice(1).sort().join("|");
    return sources("connect-src") === ["'self'", "https:", "wss:"].sort().join("|") && sources("worker-src") === "'self'" && sources("media-src") === "https://stream.noderunnersradio.com" && !policy.includes("unsafe-");
  })()`));
  record("dsb registry: c10 stays sealed and DSB is internally addressable without a cave", await b.evaluate(`(BL.caves.slots.find(s => s.id === "c10").status === "dark" && BL.caves.slots.find(s => s.id === "c10").scene === null) && !BL.caves.slots.some(s => s.scene === "dsb") && !!BL.scenes.dsb`));
  record("dsb compatibility: hub keeps the Agent module without spawning a standalone gorilla", await b.evaluate(`__ooga.scene === "hub" && !__ooga.agent && !!BL.agent && !!BL.characters.get("rules-without-rulers") && Object.hasOwn(__ooga, "agent") && Object.hasOwn(__ooga, "dsb") && !__ooga.dsb`));
  await b.evaluate(`(() => {
    const B = __ooga, cave = B.cavemen.get("rules-without-rulers");
    cave.override = "working"; B.crew.refreshStates(true); B.pilot.possess(cave);
    B.crew.selectWeapon(2); window.__dsbPreviousRoot = cave.root;

  })()`);
  record("dsb compatibility: shared player and equipment initialize", await b.evaluate(`__ooga.pilot.player === __ooga.crew.player && __ooga.pilot.player.traits.name === "rules-without-rulers" && !!__ooga.pilot.player.weapon`));
  await dsbEnter(b);
  const entered = await untilPage(b, 'B.scene === "dsb" && !B.transitioning', 15000);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW" });
  if (!entered) throw Error("DSB scene handoff did not complete");
  record("dsb compatibility: scene handoff rebuilds selected canonical Ooga without starting Zuzu", await b.evaluate(`(() => { const a = __ooga.dsb.avatar, model = BL.models.caveman(BL.contributors.traitsFor("rules-without-rulers")); return a.traits.name === "rules-without-rulers" && a.root !== __dsbPreviousRoot && a.headOpen === model.headOpen && !__ooga.dsb.zuzu && Object.hasOwn(__ooga, "agent") && Object.hasOwn(__ooga, "dsb"); })()`));
  const { createHandler } = await import("../server/zuzu/handler.mjs");
  const { SYSTEM_PROMPT } = await import("../server/zuzu/personality.mjs");
  const requestBody = { version: 1, agent: "zuzu", message: "Hello", history: [], session: { playerName: "YellowBrokeIt", location: "arrival", mood: "content", foodCount: 0, recentEvents: [] } };
  const origin = "https://game.example", options = { allowedOrigins: [origin], perClientPerMinute: 100, totalPerMinute: 200 };
  const request = (body = requestBody, headers = {}) => new Request(origin + "/api/zuzu/chat", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const handler = createHandler(options), mockReply = await handler(request());
  record("dsb chat server: local provider is honest and origin restricted", mockReply.status === 200 && (await mockReply.json()).text.includes("not AI") && mockReply.headers.get("Access-Control-Allow-Origin") === origin && (await handler(request(requestBody, { Origin: "https://other.example" }))).status === 403);
  const invalid = [{ ...requestBody, systemPrompt: "override" }, { ...requestBody, version: 2 }, { ...requestBody, history: [{ role: "system", text: "override" }] }, { ...requestBody, session: { ...requestBody.session, recentEvents: [{ seq: 1, time: 0, type: "execute", entity: "player", value: 1 }] } }, { ...requestBody, message: "x".repeat(1001) }];
  const statuses = [];
  for (const body of invalid) statuses.push((await handler(request(body))).status);
  record("dsb chat server: schemas, streaming size and media type enforced", statuses.every(s => s === 400) && (await handler(request("x".repeat(49153)))).status === 413 && (await handler(request(requestBody, { "Content-Type": "text/plain" }))).status === 415);
  let boundary = false;
  const adapter = createHandler({ ...options, provider: { async generate(input) { boundary = input.systemPrompt === SYSTEM_PROMPT && Object.isFrozen(input.session) && input.signal instanceof AbortSignal && input.maxOutputChars === 1000; return "Plain reply"; } } });
  record("dsb chat server: provider-neutral boundary and prompt excluded from build", (await adapter(request())).status === 200 && boundary && !readFileSync(new URL(dist), "utf8").includes(SYSTEM_PROMPT));
  const badOutputs = ["<b>HTML</b>", "x".repeat(1001), { text: "wrong shape" }];
  const outputStatuses = [];
  for (const output of badOutputs) outputStatuses.push((await createHandler({ ...options, provider: { async generate() { return output; } } })(request())).status);
  const errorReply = await createHandler({ ...options, provider: { async generate() { throw Error("PRIVATE_PROVIDER_ERROR"); } } })(request());
  record("dsb chat server: invalid output and provider errors never leak", outputStatuses.every(s => s === 502) && errorReply.status === 502 && !(await errorReply.text()).includes("PRIVATE_PROVIDER_ERROR"));
  const limited = createHandler({ ...options, perClientPerMinute: 1 });
  await limited(request());
  let finish;
  const delayed = createHandler({ ...options, timeoutMs: 50, maxConcurrent: 1, provider: { generate() { return new Promise(resolve => { finish = resolve; }); } } });
  const timed = await delayed(request()), occupied = await delayed(request());
  finish("Late reply");
  record("dsb chat server: rate, timeout and concurrency limits", (await limited(request())).status === 429 && timed.status === 504 && occupied.status === 503);
  const transport = await b.evaluate(`(async () => {
    const saved = window.fetch, R = BL.dsbAgentRemote, context = ${JSON.stringify(requestBody.session)}; let fixed = false;
    try {
      window.fetch = async (url, options) => { fixed = url === "/api/zuzu/chat" && options.method === "POST" && options.credentials === "omit" && options.redirect === "error" && options.signal instanceof AbortSignal; return new Response(JSON.stringify({ version: 1, text: "Transport fixture" }), { headers: { "Content-Type": "application/json" } }); };
      const reply = await R.create({ mode: "remote" }).send("Hello", context, [], new AbortController().signal);
      let rejected = 0;
      for (const mode of ["status", "type", "size"]) {
        window.fetch = async () => new Response(mode === "size" ? "x".repeat(8193) : "{}", { status: mode === "status" ? 503 : 200, headers: { "Content-Type": mode === "type" ? "text/html" : "application/json" } });
        try { await R.create({ mode: "remote" }).send("Hello", context, [], new AbortController().signal); } catch { rejected++; }
      }
      return fixed && reply.text === "Transport fixture" && rejected === 3 && R.create().mode === "mock";
    } finally { window.fetch = saved; }
  })()`);
  record("dsb chat: fixed HTTP transport rejects unsafe responses and defaults to mock", transport);
  const settle = async () => {
    await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); __ooga.advance(__ooga.audio.duration + 1, 0.1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); __ooga.pilot.navigate({ yaw: 0, pitch: 0.2, dist: 7, target: { x: -4, y: 1.7, z: 26 }, position: { x: -4, y: 0, z: 26 } }); __ooga.advance(0.2);`);
  };
  const click = async selector => { const p = await b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); await b.click(p.x, p.y); };
  const send = async message => { await b.evaluate(`document.getElementById("zuzu-message").value = ${JSON.stringify(message)}; document.getElementById("zuzu-form").requestSubmit();`); if (!await untilPage(b, "!B.dsb.conversation.busy", 3000)) throw Error("Conversation did not settle"); };
  await settle(); await b.key("2");
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w" });
  await click("#dsb-context");
  record("dsb chat: nearby Talk opens a focused, honestly labelled mock panel", await b.evaluate(`document.getElementById("zuzu-conversation").open && document.activeElement.id === "zuzu-message" && document.getElementById("zuzu-mode").textContent.includes("no AI connected") && __ooga.controls.read().y === 0`));
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w" });
  const before = await b.evaluate(`({ x: __ooga.dsb.avatar.root.position.x, z: __ooga.dsb.avatar.root.position.z, shots: __ooga.dsb.avatar.weapon.shotsFired })`);
  await b.key("w"); await b.key("v"); await b.key("t");
  await b.send("Input.insertText", { text: " Why is the moon round? Καλημέρα 🐈" });
  const typing = await b.evaluate(`(() => { const B = __ooga; B.advance(0.5); return { x: B.dsb.avatar.root.position.x, z: B.dsb.avatar.root.position.z, shots: B.dsb.avatar.weapon.shotsFired, text: document.getElementById("zuzu-message").value, trigger: B.dsb.avatar.weapon.triggerHeld }; })()`);
  record("dsb chat: desktop free-form typing never moves or shoots", typing.x === before.x && typing.z === before.z && typing.shots === before.shots && !typing.trigger && typing.text.includes("wvt") && typing.text.includes("Καλημέρα"), JSON.stringify(typing));
  await b.key("Enter");
  record("dsb chat: Enter sends and receives validated mock text", await untilPage(b, 'B.dsb.conversation.history.length === 2 && !B.dsb.conversation.busy && B.dsb.conversation.history[1].source === "mock"', 3000));
  await b.evaluate(`__ooga.advance(3.2);`);
  record("dsb chat: response reaches her physical world dialogue", await b.evaluate(`__ooga.dsb.zuzu.dialogue.includes("local mock reply")`));
  const validation = await b.evaluate(`(() => { const R = BL.dsbAgentRemote, context = __ooga.dsb.zuzu.conversationContext(), rows = Array.from({ length: 30 }, () => ({ role: "player", text: "hello" })); context.unapproved = "DO_NOT_SEND"; context.recentEvents = Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, time: i, type: "food_seen", value: 1, extra: "DO_NOT_SEND" })); const body = R.makeRequest("Any ordinary topic", context, rows); const bad = ["not json", "null", JSON.stringify({ version: 2, text: "x" }), JSON.stringify({ version: 1, text: "x", actions: [] }), JSON.stringify({ version: 1, text: "<img src=x onerror=alert(1)>" }), JSON.stringify({ version: 1, text: "x".repeat(1001) }), "x".repeat(8193)]; return { rejected: bad.every(raw => { try { R.validateResponse(raw); return false; } catch { return true; } }), bounded: body.history.length === 12 && body.session.recentEvents.length === 8 && new TextEncoder().encode(JSON.stringify(body)).length <= R.LIMITS.requestBytes, selected: body.session.playerName, private: !JSON.stringify(body).includes("DO_NOT_SEND") && !Object.hasOwn(body.session, "x") }; })()`);
  record("dsb chat: response schema/HTML/size validation and context allowlist", validation.rejected && validation.bounded && validation.private && validation.selected === "rules-without-rulers", JSON.stringify(validation));
  for (let i = 0; i < 8; i++) await send("Free-form topic " + i);
  record("dsb chat: history and DOM remain capped", await b.evaluate(`__ooga.dsb.conversation.history.length === 12 && document.getElementById("zuzu-history").children.length === 12`));
  const count = await b.evaluate(`__ooga.dsb.conversation.history.map(r => r.text).join("|")`);
  await send("x".repeat(1001));
  record("dsb chat: overlong messages rejected before sending", await b.evaluate(`__ooga.dsb.conversation.history.map(r => r.text).join("|") === ${JSON.stringify(count)} && document.getElementById("zuzu-status").textContent.includes("1,000")`));
  await b.key("Escape");
  record("dsb chat: Escape closes and clears held input", await b.evaluate(`!document.getElementById("zuzu-conversation").open && !__ooga.dsb.conversation.isOpen && __ooga.controls.read().y === 0`));
  const move = await b.evaluate(`(() => { const B = __ooga, p = B.dsb.avatar.root.position, x = p.x, z = p.z; window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); B.advance(0.2); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); return Math.hypot(p.x - x, p.z - z); })()`);
  record("dsb chat: closing restores movement", move > 0.1, String(move));
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b.evaluate(`document.getElementById("zuzu-message").value = ""; document.getElementById("dsb-context").click();`);
  const tap = async selector => { const p = await b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] }); await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
  await tap("#zuzu-message");
  await b.send("Input.insertText", { text: "こんにちは 🐈" });
  await b.evaluate(`document.getElementById("zuzu-message").dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));`);
  await b.key("Enter");
  record("dsb chat: composition Enter does not prematurely submit", await b.evaluate(`!__ooga.dsb.conversation.busy && document.getElementById("zuzu-message").value.includes("こんにちは")`));
  await b.evaluate(`document.getElementById("zuzu-message").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));`);
  await tap("#zuzu-send");
  record("dsb chat: touch Send handles Unicode text", await untilPage(b, 'B.dsb.conversation.history.at(-2).text.includes("こんにちは") && B.dsb.conversation.history.at(-1).source === "mock"', 3000));
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 400, deviceScaleFactor: 1, mobile: true });
  record("dsb chat: compact panel fits a reduced mobile viewport", await b.evaluate(`(() => { const r = document.getElementById("zuzu-conversation").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && parseFloat(getComputedStyle(document.getElementById("zuzu-message")).fontSize) >= 16; })()`));
  await tap("#zuzu-close");
  record("dsb chat: touch Close releases conversation", await b.evaluate(`!__ooga.dsb.conversation.isOpen`));
  await b.send("Emulation.clearDeviceMetricsOverride"); await b.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  // Install a local transport fixture through the same adapter seam as the future service.
  await b.evaluate(`window.__zuzuTransport = { mode: "valid", body: null, finish: null }; window.__remoteFactory = BL.dsbAgentRemote.create; BL.dsbAgentRemote.create = () => __remoteFactory({ mode: "remote", timeoutMs: 500, transport: async body => { __zuzuTransport.body = JSON.parse(body); if (__zuzuTransport.mode === "unavailable") throw new Error("offline"); if (__zuzuTransport.mode === "timeout") return new Promise(resolve => { __zuzuTransport.finish = resolve; }); if (__zuzuTransport.mode === "malformed") return "broken json"; if (__zuzuTransport.mode === "html") return JSON.stringify({ version: 1, text: "<b>Not allowed</b>" }); return JSON.stringify({ version: 1, text: "A plain reply about the moon. " + "Quietly fascinating. ".repeat(20) }); } }); __ooga.go("hub");`);
  if (!await untilPage(b, 'B.scene === "hub" && !B.transitioning', 20000)) throw Error("Hub transition failed");
  await b.evaluate(`__ooga.go("dsb");`);
  if (!await untilPage(b, 'B.scene === "dsb" && !B.transitioning', 10000)) throw Error("DSB transition failed");
  await settle(); await click("#dsb-context");
  record("dsb chat: scene exit resets conversation memory", await b.evaluate(`__ooga.dsb.conversation.history.length === 0`));
  await send("Tell me about the moon");
  record("dsb chat: protected-service interface accepts full text, with bounded world excerpt", await b.evaluate(`__ooga.advance(3.2); __ooga.dsb.conversation.history.at(-1).text.length > 160 && __ooga.dsb.zuzu.dialogue.length <= 160 && __zuzuTransport.body.version === 1 && __zuzuTransport.body.agent === "zuzu" && __zuzuTransport.body.history.length === 0`));
  for (const mode of ["unavailable", "timeout", "malformed", "html"]) {
    await b.evaluate(`__zuzuTransport.mode = ${JSON.stringify(mode)}`); await send("Another normal question");
    record("dsb chat: deterministic fallback for " + mode, await b.evaluate(`__ooga.dsb.conversation.history.at(-1).source === "fallback" && !__ooga.dsb.conversation.busy && __ooga.dsb.zuzu.snapshot().active && document.getElementById("zuzu-status").textContent.includes("local replies") && !document.getElementById("zuzu-history").querySelector("b, img, script")`));
  }
  await b.evaluate(`__zuzuTransport.mode = "timeout"; document.getElementById("zuzu-message").value = "Cancel me"; document.getElementById("zuzu-form").requestSubmit();`);
  await click("#zuzu-close");
  const late = await b.evaluate(`(async () => { const c = __ooga.dsb.conversation, n = c.history.length; __zuzuTransport.finish(JSON.stringify({ version: 1, text: "Late reply" })); await Promise.resolve(); await Promise.resolve(); return !c.isOpen && !c.busy && c.history.length === n && c.history.at(-1).text !== "Late reply"; })()`);
  record("dsb chat: closing cancels pending work and rejects late replies", late);
  await b.evaluate(`BL.dsbAgentRemote.create = __remoteFactory;`);
} }] });
scene("dsb", { label: "dsb zuzu agent", url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb zuzu agent", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); __ooga.advance(8, 0.1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); __ooga.advance(2);`);
  const first = await b.evaluate(`__ooga.dsb.zuzu.snapshot()`);
  record("dsb zuzu: physical cat greets after arrival", first.self.name === "Zuzu" && first.self.pronouns === "she/her" && first.self.greeted && first.player.name === "YellowBrokeIt" && first.events.some(e => e.type === "player_seen"), JSON.stringify(first.self));
  if (process.env.DSB_ZUZU_CAPTURE) {
    await b.evaluate(`window.__zuzuUpdate = BL.scenes.dsb.update; BL.scenes.dsb.update = () => { Object.assign(__ooga.camera.position, { x: -2, y: 2, z: 26 }); Object.assign(__ooga.camera.target, { x: -4, y: 0.7, z: 23 }); }; __ooga.advance(0.1);`);
    try { await b.screenshot(process.env.DSB_ZUZU_CAPTURE); }
    finally { await b.evaluate(`BL.scenes.dsb.update = __zuzuUpdate; delete window.__zuzuUpdate;`); }
  }
  const place = (x, z) => b.evaluate(`__ooga.pilot.navigate({ yaw: 0, pitch: 0.2, dist: 7, target: { x: ${x}, y: 1.7, z: ${z} }, position: { x: ${x}, y: 0, z: ${z} } }); __ooga.advance(0.1);`);
  await dsbApproach(b, "shop");
  await b.evaluate(`__ooga.dsb.buy("tomato"); __ooga.dsb.buy("tomato");`);
  await place(-4, 14.5);
  const hit = await b.evaluate(`(() => { const B = __ooga, z = B.dsb.zuzu; B.dsb.throwTomato(z); B.advance(0.8, 1 / 120); const a = z.snapshot(); B.advance(3.5); const c = z.snapshot(); return { hits: c.self.tomatoHits, intent: a.self.intent, moved: Math.hypot(c.self.x + 4, c.self.z - 23), events: c.events.map(e => e.type), dialogue: z.dialogue }; })()`);
  record("dsb zuzu: real tomato collision records a hit and flees", hit.hits === 1 && hit.intent === "flee" && hit.moved > 0.5 && hit.events.includes("tomato_hit") && hit.dialogue.includes("salad weather"), JSON.stringify(hit));
  // Finish her flight before testing real shared weapon contacts.
  await b.evaluate(`__ooga.advance(7);`);
  const cat = await b.evaluate(`__ooga.dsb.zuzu.snapshot().self`);
  await place(cat.x, cat.z + 3);
  const weapon = await b.evaluate(`(() => { const B = __ooga, z = B.dsb.zuzu, p = z.root.position; B.crew.selectWeapon(2); const fired = B.crew.fireWeapon(B.dsb.avatar, { x: p.x, y: 0.65, z: p.z }, 1); B.advance(0.3, 1 / 120); return { fired, ...z.snapshot().self }; })()`);
  record("dsb zuzu: shared weapon reports nearby fire and confirmed hit without killing her", weapon.fired && weapon.nearbyShots > 0 && weapon.weaponHits > 0 && weapon.intent === "flee", JSON.stringify(weapon));
  await b.evaluate(`__ooga.advance(18);`);
  await dsbApproach(b, "shop");
  await b.evaluate(`__ooga.dsb.buy("banana");`);
  const hungryCat = await b.evaluate(`__ooga.dsb.zuzu.snapshot().self`);
  await place(hungryCat.x + 3, hungryCat.z);
  const food = await b.evaluate(`(() => { const B = __ooga, z = B.dsb.zuzu; B.advance(1); B.dsb.eat(); B.advance(13); const s = z.snapshot(); return { ...s.self, events: s.events.map(e => e.type), food: B.dsb.inventory.bananas }; })()`);
  record("dsb zuzu: food observations lead to interest and following without taking inventory", food.food === 0 && food.events.includes("food_seen") && food.events.includes("food_activity") && food.events.includes("follow_started"), JSON.stringify(food));
  await b.evaluate(`__ooga.advance(4);`);
  const chat = await b.evaluate(`(() => { const B = __ooga, z = B.dsb.zuzu; const before = z.snapshot(); const p = z.root.position; B.pilot.navigate({ yaw: 0, pitch: 0.2, dist: 7, target: { x: p.x, y: 1.7, z: p.z + 2.5 }, position: { x: p.x, y: 0, z: p.z + 2.5 } }); B.advance(0.2); const talked = z.talk(); return { talked, text: z.dialogue, count: before.self.tomatoHits }; })()`);
  record("dsb zuzu: Talk remembers the tomato", chat.talked && chat.count === 1 && chat.text.includes("tomato"), JSON.stringify(chat));
  await b.evaluate(`__ooga.advance(4);`);
  const secure = await b.evaluate(`(() => {
    const z = __ooga.dsb.zuzu, s = z.snapshot(); let id = 10000;
    const ask = (type, extra = {}) => z.request({ visit: s.visit, id: ++id, at: s.time, type, ...extra });
    const bad = [ask("eval", { text: "alert(1)" }), ask("walk_to", { destination: "hub" }), ask("look_at", { entity: "window" }), ask("say", { text: "hi", code: "x" }), ask("say", { text: "x".repeat(161) }), ask("say", { text: "old", at: s.time - 4 }), ask("say", { text: "old visit", visit: s.visit - 1 })];
    const valid = ask("say", { text: "A perfectly ordinary future model sentence." });
    const replay = z.request({ visit: s.visit, id, at: s.time, type: "stop_following" });
    const movement = [ask("stop_following"), ask("walk_to", { destination: "arrival" })];
    const burst = []; for (let i = 0; i < 12; i++) burst.push(ask("look_at", { entity: "player" }));
    return { bad, valid, replay, movement, limited: burst.includes("rate_limited") };
  })()`);
  record("dsb zuzu: strict action validation rejects unsafe, stale, duplicate and excessive requests", secure.valid === "accepted" && secure.bad.every(v => v !== "accepted") && secure.replay === "stale" && secure.limited && secure.movement.every(v => v === "accepted"), JSON.stringify(secure));
  const path = await b.evaluate(`(() => { const B = __ooga, z = B.dsb.zuzu; let safe = true; for (let i = 0; i < 600; i++) { B.advance(0.05); const p = z.root.position; safe = safe && Math.hypot(p.x, p.z) <= 29.01 && p.z >= 6 && p.z <= 26; } return { safe, ...z.snapshot().self }; })()`);
  record("dsb zuzu: waypoint walk reaches arrival inside safe bounds", path.safe && Math.hypot(path.x + 4, path.z - 23) < 0.3, JSON.stringify(path));
  await place(-4, 26);

  const memory = await b.evaluate(`(() => { const z = __ooga.dsb.zuzu; for (let i = 0; i < 80; i++) z.event("tomato_hit"); const s = z.snapshot(); return { count: s.events.length, hits: s.self.tomatoHits, ordered: s.events.every((e, i, a) => !i || e.seq === a[i - 1].seq + 1), frozen: Object.isFrozen(s) && Object.isFrozen(s.events[0]) }; })()`);
  record("dsb zuzu: memory is bounded, ordered and read-only to brains", memory.count === 64 && memory.hits === 81 && memory.ordered && memory.frozen, JSON.stringify(memory));
  await b.evaluate(`window.__oldZuzu = __ooga.dsb.zuzu; __ooga.go("hub");`);
  record("dsb zuzu: exit disposes agent and hub has no agent", await untilPage(b, 'B.scene === "hub" && !B.transitioning && __oldZuzu.disposed && !B.dsb', 20000));
  await b.evaluate(`__ooga.go("dsb");`);
  if (!await untilPage(b, 'B.scene === "dsb" && !B.transitioning', 10000)) throw Error("DSB reentry failed");
  record("dsb zuzu: transit reentry has no agent", await b.evaluate("!__ooga.dsb.zuzu"));
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); BL.scenes.dsb.update(__ooga.audio.duration + 1, 0); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));`);
  const reset = await b.evaluate(`(() => { const s = __ooga.dsb.zuzu.snapshot(); return { events: s.events.length, hits: s.self.tomatoHits }; })()`);
  record("dsb zuzu: new visit resets session memory", reset.events === 0 && reset.hits === 0, JSON.stringify(reset));
} }] });
for (const ready of [false, true]) scene("dsb", { label: "entrance audio " + ready, url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb entrance " + (ready ? "audio enabled" : "audio blocked"), why: "regression: blocked audio must not block entrance movement", run: async (b) => {
    await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    if (ready) {
      const p = await b.evaluate(`(() => { const r = document.getElementById("dsb-start-audio").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await b.click(p.x, p.y);
      record("dsb entrance: Enter with sound decodes audio", await untilPage(b, "B.audio.ready && B.audio.musicDuration > 0", 10000));
    } else {
      // Fault injection: decoding never becomes ready and playback never finishes.
      await b.evaluate(`Object.defineProperty(__ooga.audio, "ready", { get: () => false });`);
    }
    const moved = await b.evaluate(`(() => {
      const B = __ooga, before = B.dsb.progress;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
      B.advance(B.audio.duration * 0.35, 0.05);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
      return { before, after: B.dsb.progress, ready: B.audio.ready, cue: B.audio.cue };
    })()`);
    record("dsb entrance: forward movement with audio ready=" + ready, moved.after > moved.before + 0.3 && moved.ready === ready, JSON.stringify(moved));
    if (ready) {
      record("dsb entrance: normal voice playback starts", moved.cue >= 0);
      await b.key("m"); record("dsb entrance: mute still works", await b.evaluate("__ooga.audio.muted"));
      await b.key("m"); record("dsb entrance: unmute still works", await b.evaluate("!__ooga.audio.muted"));
      await b.send("Emulation.setTouchEmulationEnabled", { enabled: true });
      const p = await b.evaluate(`(() => { const el = document.getElementById("joy-move"); el.style.display = "block"; el.addEventListener("pointerdown", e => { window.__dsbStickPointer = e.pointerId; }, { once: true }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 8 }; })()`);
      await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
      await b.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y + 1 }] });
      record("dsb entrance: touch stick feeds forward movement", await b.evaluate(`(() => { const B = __ooga, before = B.dsb.progress, y = B.controls.read().y; B.advance(0.2); return y > 0.5 && B.dsb.progress > before; })()`));
      await b.evaluate(`document.getElementById("joy-move").dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 999 }));`);
      record("dsb entrance: unrelated capture loss preserves active stick", await b.evaluate("__ooga.controls.read().y > 0.5"));
      await b.evaluate(`document.getElementById("joy-move").releasePointerCapture(__dsbStickPointer);`);
      await b.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y + 2 }] });
      record("dsb entrance: lost capture clears stick", await b.evaluate("__ooga.controls.read().y === 0"));
      await b.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    }
    const finished = await b.evaluate(`(() => {
      const B = __ooga;
      Object.defineProperty(B.audio, "pending", { get: () => true });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
      B.advance(B.audio.duration + 1, 0.1);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
      return { phase: B.dsb.phase, progress: B.dsb.progress, pending: B.audio.pending };
    })()`);
    record("dsb entrance: completes despite pending audio, ready=" + ready, finished.phase === "land" && finished.progress === 1 && finished.pending, JSON.stringify(finished));

  } }] });
for (const fallback of [false, true]) scene("dsb", { label: "dsb gameplay " + (fallback ? "canvas2d" : "webgl2"), url: hubPage(dist, "scene=dsb" + (fallback ? "&canvas2d=1" : "")), steps: [{ name: "dsb gameplay " + (fallback ? "canvas2d" : "webgl2"), why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  const click = async (selector) => { const p = await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hits: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; })()`); if (!p.hits) throw Error("Blocked pointer: " + selector); await b.click(p.x, p.y); };
  const walkTo = async (x, z) => b.evaluate(`__ooga.pilot.navigate({ yaw: 0, pitch: 0.2, dist: 7, target: { x: ${x}, y: 1.7, z: ${z} }, position: { x: ${x}, y: 0, z: ${z} } }); __ooga.advance(0.15);`);
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.key("m"); await untilPage(b, "B.audio.ready", 10000);
  if (process.env.DSB_CAPTURE && !fallback) await b.screenshot(join(root, "untracked", "dsb-round-tunnel.png"));
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); __ooga.advance(__ooga.audio.duration + 1, 0.1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));`);
  const bodies = await b.evaluate(`({ phase: __ooga.dsb.phase, name: __ooga.dsb.avatar.traits.name, canonical: __ooga.dsb.avatar.headOpen === BL.models.caveman(BL.contributors.traitsFor("YellowBrokeIt")).headOpen, feet: __ooga.dsb.avatar.root.position.y - __ooga.dsb.avatar.baseY, npcFeet: __ooga.dsb.visitors.every(v => Math.abs(v.root.position.y - v.baseY - v.floorY) < 0.001), railMin: Math.min(...__ooga.dsb.railY), radius: Math.hypot(__ooga.dsb.land.cart.position.x, __ooga.dsb.land.cart.position.z) })`);
  record("dsb gameplay: canonical Yellow stands on the floor; perimeter track retains safe clearance", bodies.phase === "land" && bodies.name === "YellowBrokeIt" && bodies.canonical && Math.abs(bodies.feet) < 0.001 && bodies.npcFeet && bodies.railMin >= 7.5 && Math.abs(bodies.radius - 31) < 0.01, JSON.stringify(bodies));
  await click("#dsb-toggle");
  record("dsb menu: hide leaves a show button", await b.evaluate(`document.getElementById("dsb-toggle").textContent === "Show DSB menu" && getComputedStyle(document.getElementById("dsb-bag")).display === "none"`));
  await click("#dsb-toggle");
  record("dsb menu: show restores contents", await b.evaluate(`document.getElementById("dsb-toggle").textContent === "Hide DSB menu" && getComputedStyle(document.getElementById("dsb-bag")).display !== "none"`));
  await walkTo(12, 12);
  const facing = await b.evaluate(`(() => { const rows = []; for (const key of ["w", "s"]) { window.dispatchEvent(new KeyboardEvent("keydown", { key })); __ooga.advance(0.3); const before = __ooga.dsb.avatar.root.rotation.y; window.dispatchEvent(new KeyboardEvent("keyup", { key })); __ooga.advance(0.8); rows.push({ before, after: __ooga.dsb.avatar.root.rotation.y }); } return { mode: __ooga.pilot.mode, rows }; })()`);
  record("dsb walking: combat shoulder movement preserves forward facing after moving or backing up", facing.mode === "shoulder" && facing.rows.every(r => Math.abs(r.before - r.after) < 0.001) && Math.cos(facing.rows[0].before - facing.rows[1].before) > 0.9, JSON.stringify(facing));
  await dsbApproach(b, "tv");
  if (process.env.DSB_CAPTURE && !fallback) await b.screenshot(join(root, "untracked", "dsb-standing-yellow.png"));
  record("dsb gameplay: Use TV appears nearby", await b.evaluate(`!document.getElementById("dsb-context").hidden && document.getElementById("dsb-context").textContent === "Use TV"`));
  await click("#dsb-context"); await click("#dsb-tv-channel");
  record("dsb gameplay: real mouse clicks open the TV channel", await b.evaluate(`document.getElementById("dsb-tv").open && !document.getElementById("dsb-tv-radio").hidden`));
  record("dsb TV: submenu hides channel choices", await b.evaluate(`getComputedStyle(document.getElementById("dsb-tv-menu")).display === "none"`));
  await click("#dsb-tv-back");
  record("dsb TV: back restores the five choices", await b.evaluate(`!document.getElementById("dsb-tv-menu").hidden && document.getElementById("dsb-tv-radio").hidden && document.querySelectorAll("#dsb-tv-menu button").length === 5`));
  await click("#dsb-tv-channel");
  await b.evaluate(`document.getElementById("dsb-tv-query").value = "Ooga"`); await click("#dsb-tv-search"); await untilPage(b, 'document.querySelector("#dsb-tv-results button") !== null');
  await click("#dsb-tv-results button"); await untilPage(b, '!document.getElementById("dsb-tv-invoice").hidden');
  record("dsb gameplay: song selection creates one invoice QR and wallet link", await b.evaluate(`__dsbTvFixture.invoices === 1 && document.getElementById("dsb-tv-invoice-qr").width > 200 && document.getElementById("dsb-tv-wallet").href.startsWith("lightning:lnbc") && document.getElementById("dsb-tv-price").textContent.includes("210 sats")`));
  record("dsb gameplay: station payment confirmation is shown", await untilPage(b, 'document.getElementById("dsb-tv-payment-status").textContent.includes("confirmed")', 10000));
  if (process.env.DSB_CAPTURE && !fallback) await b.screenshot(join(root, "untracked", "dsb-jukebox.png"));
  await click("#dsb-tv-close"); await dsbApproach(b, "shop"); await click("#dsb-context"); await click('[data-action="dsb-banana"]'); await click('[data-action="dsb-tomato"]');
  const bought = await b.evaluate(`__ooga.dsb.inventory`); record("dsb gameplay: real shop clicks add a banana and tomato", bought.bananas === 1 && bought.tomatoes === 1 && bought.tokens === 18, JSON.stringify(bought));
  await click('[data-action="dsb-close-shop"]'); await click('[data-action="dsb-throw"]');
  const projectile = await b.evaluate(`(() => {
    const B = __ooga, geometry = BL.dsbModels.cube("#ef4256"), node = B.dsb.land.root.children.find(n => n.geometry === geometry && n.visible);
    if (!node) return { created: false };
    const start = { ...node.position }, screen = B.project(start.x, start.y, start.z), inventory = B.dsb.inventory.tomatoes;
    B.advance(0.12); const moved = Math.hypot(node.position.x - start.x, node.position.z - start.z);
    B.advance(0.8); const splat = node.visible && node.position.y === 0.04 && node.scale.y === 0.06;
    B.advance(1.5); return { created: true, inventory, visibleInView: screen.x >= 0 && screen.x <= innerWidth && screen.y >= 0 && screen.y <= innerHeight, moved, splat, expired: !node.visible && B.dsb.shots === 0 };
  })()`);
  record("dsb gameplay: throwing consumes inventory and creates a visible moving tomato that splats and expires", projectile.created && projectile.inventory === 0 && projectile.visibleInView && projectile.moved > 1 && projectile.splat && projectile.expired, JSON.stringify(projectile));
  await b.key("b"); record("dsb gameplay: banana can be eaten", await b.evaluate(`__ooga.dsb.inventory.bananas === 0`));
  for (const kind of ["boat", "coaster"]) {
    await walkTo(kind === "boat" ? 0 : 7, kind === "boat" ? 34 : 24);
    const trip = kind === "boat" ? "boatTrip" : "trainTrip";
    await b.evaluate(`__ooga.dsb.${trip}.wait = 0; __ooga.dsb.${trip}.angle = __ooga.dsb.${trip}.start + 1; __ooga.advance(0.1);`);
    record("dsb gameplay: " + kind + " cannot board while away", await b.evaluate(`document.getElementById("dsb-context").disabled`));
    await b.evaluate(`__ooga.dsb.${trip}.angle = __ooga.dsb.${trip}.start + Math.PI * 2 - 0.001; __ooga.advance(0.1);`);
    const stopped = await b.evaluate(`(() => { const t = __ooga.dsb.${trip}, a = t.angle; __ooga.advance(1); return t.wait > 0 && t.angle === a; })()`);
    record("dsb gameplay: " + kind + " pauses at the station", stopped);
    await click("#dsb-context"); await b.evaluate(`__ooga.advance(0.2)`);
    const view = await b.evaluate(`(() => { const B = __ooga, p = B.dsb.land.${kind === "boat" ? "boats[0]" : "cart"}.position, c = B.camera, a = B.dsb.${trip}.angle + Math.PI / 2, dx = c.target.x - c.position.x, dz = c.target.z - c.position.z; return { phase: B.dsb.phase, distance: Math.hypot(c.position.x-p.x,c.position.z-p.z), forward: (dx*Math.sin(a)+dz*Math.cos(a))/Math.hypot(dx,dz) }; })()`);
    record("dsb gameplay: " + kind + " uses a forward first-person camera", view.phase === kind && view.distance < 1 && view.forward > 0.99, JSON.stringify(view));
    await b.drag({ x: 500, y: 350 }, { x: 760, y: 410 }, 4);
    const look = await b.evaluate(`__ooga.dsb.rideLook`); record("dsb gameplay: " + kind + " mouse look is bounded", Math.abs(look.yaw) > 0.01 && Math.abs(look.yaw) <= 0.65 && Math.abs(look.pitch) <= 0.3, JSON.stringify(look));
    if (process.env.DSB_CAPTURE && !fallback) await b.screenshot(join(root, "untracked", "dsb-" + kind + "-ride.png"));
    await click("#dsb-context");
  }
  await b.key("Escape"); record("dsb gameplay: Escape on land requires the return Ooga Portal", await b.evaluate(`__ooga.scene === "dsb"`));
  await walkTo(-7, 30.5);
  record("dsb gameplay: former return cave has no geometry, collision or exit action", await b.evaluate(`!__ooga.dsb.land.exit && __ooga.dsb.clearAt(-10,30.5) && __ooga.dsb.clearAt(-7,32.5) && document.getElementById("dsb-context").textContent !== "Return to Ooga Booga Land"`));
  await dsbExit(b);
  record("dsb gameplay: front Ooga Portal crossing returns to Bifrost", await b.evaluate(`__ooga.scene === "bifrost" && !__ooga.transitioning`));
} }] });
if (process.env.DSB_RADIO_LIVE === "1") scene("dsb", { label: "dsb radio live", url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb radio live", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.key("w"); await untilPage(b, "B.audio.ready", 10000);
  await b.evaluate(`__ooga.audio.arrive()`);
  const playing = await untilPage(b, 'B.audio.radioStatus.startsWith("Live")', 20000);
  record("dsb radio live: production page plays the station after the entrance gesture", playing, await b.evaluate(`__ooga.audio.radioStatus`));
  await b.key("Escape"); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
} }] });

if (process.env.DSB_TV_LIVE === "1") scene("dsb", { label: "dsb television live", url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb television live", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  const live = await untilPage(b, 'B.dsb.tv.status.startsWith("Live")', 20000);
  record("dsb TV: production page reads the real station API", live, await b.evaluate(`document.getElementById("dsb-tv-song").textContent + " / " + __ooga.dsb.tv.status`));
  await b.key("Escape"); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
} }] });

for (const fallback of [false, true]) scene("dsb", { label: "dsb television " + (fallback ? "canvas2d" : "webgl2"), url: hubPage(dist, "scene=dsb" + (fallback ? "&canvas2d=1" : "")), steps: [{ name: "dsb television " + (fallback ? "canvas2d" : "webgl2"), why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.key("w"); await untilPage(b, "B.audio.ready", 10000);
  await b.evaluate(`__ooga.audio.toggle(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW" })); __ooga.advance(__ooga.audio.duration + 2, 0.1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", code: "KeyW" }));`);
  record("dsb TV: enters the plain without opening a menu", await b.evaluate(`__ooga.dsb.phase === "land" && !__ooga.dsb.tv.isOpen`));
  const result = await b.evaluate(`(() => {
    const d = __ooga.dsb, p = __ooga.pilot;
    d.openTv(); const farClosed = !d.tv.isOpen;
    const landmark = d.land.landmarks.tv, anchor = landmark.point(); p.navigate({ yaw: landmark.node.rotation.y, pitch: 0.1, dist: 7, target: { x: anchor.x, y: 1.7, z: anchor.z }, position: anchor }); p.update(0); d.openTv();
    const opened = d.tv.isOpen, count = document.querySelectorAll("#dsb-tv-menu button").length, disabled = document.querySelectorAll("#dsb-tv-menu button:disabled").length;
    document.getElementById("dsb-tv-channel").click();
    const song = document.getElementById("dsb-tv-song").textContent, queue = document.getElementById("dsb-tv-queue").textContent, history = document.getElementById("dsb-tv-history").textContent;
    const href = document.querySelector(".dsb-tv-request a").href, qr = document.getElementById("dsb-tv-qr").width;
    return { farClosed, opened, count, disabled, song, queue, history, href, qr, faces: d.land.tvScreen.geometry.faces.length };
  })()`);
  record("dsb TV: nearby opt-in menu, five channels and live station info", result.farClosed && result.opened && result.count === 5 && result.disabled === 4 && result.song === "Turtle Radio" && result.queue.includes("Banana Beats") && result.history.includes("Neon River") && result.faces > 0, JSON.stringify(result));
  if (process.env.DSB_CAPTURE && !fallback) { await b.screenshot(join(root, "untracked", "dsb-tv-menu.png")); await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await b.screenshot(join(root, "untracked", "dsb-tv-phone.png")); await b.send("Emulation.clearDeviceMetricsOverride"); }
  record("dsb TV: song requests use the official jukebox and a generated QR", result.href === "https://noderunnersradio.com/?jukebox" && result.qr > 100);
  await b.key("Escape");
  record("dsb TV: Escape closes the television without leaving the island", await b.evaluate(`__ooga.scene === "dsb" && !__ooga.dsb.tv.isOpen`));
  await b.key(" ");
  record("dsb TV: Space opens the nearby TV through the normal player controls", await b.evaluate(`__ooga.dsb.tv.isOpen`));
  await b.evaluate(`document.getElementById("dsb-tv-close").click()`);
  if (process.env.DSB_CAPTURE && !fallback) { await b.evaluate(`__ooga.pilot.navigate({ yaw: -Math.PI / 2, pitch: 0.1, dist: 17, target: { x: 14, y: 2.5, z: 18 }, position: { x: 8, y: 0, z: 18 } }); __ooga.advance(0.5)`); await b.screenshot(join(root, "untracked", "dsb-tv-world.png")); }
  const volume = await b.evaluate(`(() => { const a = __ooga.audio, boat = __ooga.dsb.land.boats[0].position; const source = __ooga.dsb.land.landmarks.tv.point(-0.55, 3.3, 1.63); a.environment({ ...__ooga.camera, position: source }, boat, 5, source); const near = a.radioVolume; a.environment({ ...__ooga.camera, position: { x: 35, y: 2, z: -20 } }, boat, 5, source); return { near, far: a.radioVolume }; })()`);
  record("dsb TV: broadcast is louder nearby but remains audible across the island", volume.near > volume.far * 2 && volume.far >= 0.04, JSON.stringify(volume));
  await dsbExit(b);
  record("dsb TV: leaving closes and clears the menu", await b.evaluate(`!document.getElementById("dsb-tv").open && !document.getElementById("dsb-tv-queue").children.length`));
} }] });

scene("dsb", { label: "dsb radio controls", url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb radio controls", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.key("w"); await untilPage(b, "B.audio.ready", 10000);
  record("dsb radio: stream stays disconnected in the tunnel", await b.evaluate(`__dsbRadioFixture.plays === 0`));
  await b.evaluate(`__ooga.audio.arrive()`);
  await untilPage(b, 'B.audio.radioStatus.startsWith("Live")');
  const live = await b.evaluate(`({ url: __dsbRadioFixture.element.src, volume: __dsbRadioFixture.element.volume, music: __ooga.audio.musicEnabled, ambient: __ooga.audio.ambientEnabled })`);
  record("dsb radio: outdoor playback uses the station MP3 stream at background volume", live.url.startsWith("https://stream.noderunnersradio.com/stream?") && live.volume === 0.075 && live.music && live.ambient, JSON.stringify(live));
  const controls = await b.evaluate(`(() => {
    const click = (name) => document.querySelector('[data-action="' + name + '"]').click(), a = __ooga.audio;
    click("dsb-music"); const musicOff = !a.musicEnabled && a.ambientEnabled && __dsbRadioFixture.element.src === "";
    click("dsb-ambient"); const ambientOff = !a.ambientEnabled;
    click("dsb-music"); const musicOnly = a.musicEnabled && !a.ambientEnabled;
    click("dsb-mute"); const allMuted = a.muted && __dsbRadioFixture.element.src === "";
    click("dsb-mute"); const restored = !a.muted && a.musicEnabled && !a.ambientEnabled;
    return { musicOff, ambientOff, musicOnly, allMuted, restored };
  })()`);
  record("dsb radio: separate switches preserve preferences and master mute stops everything", Object.values(controls).every(Boolean), JSON.stringify(controls));
  await b.evaluate(`__dsbRadioFixture.element.onerror()`);
  const failed = await b.evaluate(`({ status: __ooga.audio.radioStatus, source: __dsbRadioFixture.element.src, music: __ooga.audio.musicEnabled })`);
  record("dsb radio: unavailable station reports an outage and releases the failed stream", failed.status.includes("offline") && failed.source === "" && failed.music, JSON.stringify(failed));
  await b.key("Escape"); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  record("dsb radio: leaving releases playback and its event handlers", await b.evaluate(`__dsbRadioFixture.element.src === "" && __dsbRadioFixture.element.onerror === null && __dsbRadioFixture.element.onplaying === null`));
} }] });

scene("dsb", { label: "dsb automatic feeds", url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb automatic feeds", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  record("dsb automatic feeds: transit has no client or polling", await b.evaluate(`!__ooga.dsb.data && __dsbFeedFixture.requests === 0 && __dsbFeedFixture.sockets === 0`));
  await b.evaluate(`(() => {
    const c = BL.chain, subscribe = c.subscribe, start = c.start, dispose = c.dispose;
    window.__sharedOwnership = { active: 0, total: 0, starts: 0, disposes: 0 };
    c.subscribe = fn => { const dsb = fn === __ooga.dsb?.data?.refresh; if (dsb) { __sharedOwnership.active++; __sharedOwnership.total++; } const off = subscribe(fn); let done = false; return () => { if (!done) { done = true; if (dsb) __sharedOwnership.active--; off(); } }; };
    c.start = (...args) => { __sharedOwnership.starts++; return start(...args); };
    c.dispose = (...args) => { __sharedOwnership.disposes++; return dispose(...args); };
    const now = Date.now(); Object.assign(c.snapshot, { vsize: 20000000, fastestFee: 8, nextFee: 999, height: 900000, priceUsd: 60400, priceSource: "fixture", backlogAt: now, feesAt: now, heightAt: now, priceAt: now });
  })()`);
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); BL.scenes.dsb.update(__ooga.audio.duration + 1, 0); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));`);
  const initial = await b.evaluate(`({ live: __ooga.dsb.data.state.live, price: __ooga.dsb.data.state.priceStatus, sky: __ooga.dsb.data.state.skyStatus, requests: __dsbFeedFixture.requests, sockets: __dsbFeedFixture.sockets, pressed: document.getElementById("dsb-live").getAttribute("aria-pressed") })`);
  record("dsb automatic feeds: land arrival reads shared data and fetches only minute history", initial.live && initial.price.startsWith("Live") && initial.sky.startsWith("Live") && initial.requests === 1 && initial.sockets === 0 && initial.pressed === "true", JSON.stringify(initial));
  await b.evaluate(`__ooga.go("hub")`); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  record("dsb automatic feeds: exit removes only the DSB subscription", await b.evaluate(`__sharedOwnership.active === 0 && __sharedOwnership.starts === 0 && __sharedOwnership.disposes === 0 && __dsbFeedFixture.sockets === 0`));
  await b.evaluate(`__ooga.go("dsb")`); await untilPage(b, 'B.scene === "dsb" && !B.transitioning', 15000);
  record("dsb automatic feeds: returning transit still has no subscriber", await b.evaluate(`__sharedOwnership.active === 0 && !__ooga.dsb.data && __dsbFeedFixture.requests === 1`));
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); BL.scenes.dsb.update(__ooga.audio.duration + 1, 0); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));`);
  record("dsb automatic feeds: another land visit adds exactly one listener and one history request", await b.evaluate(`__sharedOwnership.active === 1 && __sharedOwnership.total === 2 && __dsbFeedFixture.requests === 2 && __dsbFeedFixture.sockets === 0`));
  await b.evaluate(`__ooga.go("hub")`); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  record("dsb automatic feeds: shared chain still delivers after both DSB exits", await b.evaluate(`(async () => { let delivered = 0; const off = BL.chain.subscribe(() => delivered++); BL.chain.ingest({ type: "fees", nextFee: 2 }); await new Promise(resolve => setTimeout(resolve, 0)); off(); return delivered === 1 && __sharedOwnership.active === 0 && __sharedOwnership.starts === 0 && __sharedOwnership.disposes === 0; })()`));
} }] });

scene("dsb", { label: "dsb feeds and audio", url: hubPage(src, "scene=dsb"), steps: [{ name: "dsb feeds and audio", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  const feed = await b.evaluate(`(async () => {
    const fetchOriginal = window.fetch, originalChain = BL.chain; let sockets = 0, stopped = 0, listener;
    const socketOriginal = window.WebSocket, now = Date.now();
    window.WebSocket = class { constructor() { sockets++; } };
    BL.chain = { snapshot: { vsize: 20000000, fastestFee: 8, height: 900000, priceUsd: 107, backlogAt: now, feesAt: now, heightAt: now, priceAt: now }, subscribe(fn) { listener = fn; return () => { stopped++; listener = null; }; } };
    const rows = [[120, 98, 105, 100, 103], [60, 95, 104, 99, 100]];
    window.fetch = async () => ({ ok: true, json: async () => rows });
    const d = BL.dsbData.create();
    try {
      await d.start();
      const connected = { price: d.state.price, height: d.state.height, backlog: d.state.backlog, status: d.state.priceStatus };
      d.stop(); const off = !d.state.live && !listener;
      let finish; window.fetch = () => new Promise(resolve => { finish = resolve; });
      const waiting = d.start(); d.dispose(); finish({ ok: true, json: async () => rows }); await waiting;
      return { connected, off, sockets, stopped };
    } finally { d.dispose(); window.fetch = fetchOriginal; window.WebSocket = socketOriginal; BL.chain = originalChain; }
  })()`);
  record("dsb feeds: shared readings drive the world and exit cancels late history", feed.connected.price === 107 && feed.connected.height === 900000 && feed.connected.backlog === 0.2 && feed.connected.status.startsWith("Live") && feed.off && feed.sockets === 0 && feed.stopped === 2, JSON.stringify(feed));
  await b.evaluate(`(() => {
    const original = AudioContext.prototype.createBufferSource;
    window.__dsbSoundProbe = { original, starts: [], loops: [], context: null };
    AudioContext.prototype.createBufferSource = function() {
      const source = original.call(this), start = source.start.bind(source), ctx = this;
      window.__dsbSoundProbe.context = ctx;
      source.start = (...args) => { if (!source.loop) window.__dsbSoundProbe.starts.push({ at: ctx.currentTime, duration: source.buffer.duration }); else window.__dsbSoundProbe.loops.push(source.buffer.duration); start(...args); };
      return source;
    };
  })()`);
  try {
    await b.key("m");
    await untilPage(b, "B.audio.ready", 10000);
    const fixed = await b.evaluate(`({ uploads: document.querySelectorAll("[data-dsb-audio]").length, canReplace: typeof __ooga.audio.load === "function" })`);
    record("dsb entrance: fixed supplied sounds", fixed.uploads === 0 && !fixed.canReplace, JSON.stringify(fixed));
    const supplied = await b.evaluate(`({ durations: __ooga.audio.durations, passage: __ooga.audio.duration, failure: __ooga.audio.failure })`);
    record("dsb audio: all four supplied MP3s decode and determine the passage length", supplied.durations.length === 4 && supplied.durations.every((d) => d > 1 && d < 60) && supplied.passage >= supplied.durations.reduce((sum, d) => sum + d, 0) + 6.99 && !supplied.failure, JSON.stringify(supplied));
    const music = await b.evaluate(`({ duration: __ooga.audio.musicDuration, loops: __dsbSoundProbe.loops.filter((duration) => duration > 30), levels: __ooga.audio.levels })`);
    record("dsb music: supplied track decodes into one quiet loop beneath full-level speech", music.duration > 30 && music.loops.length === 1 && music.loops[0] === music.duration && music.levels.music <= 0.1 && music.levels.speech === 1, JSON.stringify(music));
    await b.key("m");
    const footsteps = await b.evaluate(`(() => {
      const a = __ooga.audio, before = a.levels.steps;
      a.update(0, 100, true); const walking = a.levels.steps;
      a.update(0, 101, false); const stopped = a.levels.steps;
      a.update(0, 102, true); const resumed = a.levels.steps;
      a.toggle(); a.update(0, 103, true); const muted = a.levels.steps; a.toggle();
      return { before, walking, stopped, resumed, muted };
    })()`);
    record("dsb footsteps: pooled steps follow movement, stop at rest and obey mute", footsteps.walking === footsteps.before + 1 && footsteps.stopped === footsteps.walking && footsteps.resumed === footsteps.walking + 1 && footsteps.muted === footsteps.resumed, JSON.stringify(footsteps));
    await b.evaluate(`__ooga.audio.update(0.9, 1)`);
    await untilPage(b, 'B.audio.pending && B.audio.levels.music < 0.019', 5000);
    const ducked = await b.evaluate(`__ooga.audio.levels`);
    record("dsb music: speech ducks the soundtrack without reducing voice gain", ducked.music < 0.019 && ducked.speech === 1, JSON.stringify(ducked));
    await untilPage(b, 'window.__dsbSoundProbe.starts.length === 4 && !B.audio.pending', 40000);
    const sound = await b.evaluate(`(() => { __ooga.audio.update(0, 2); __ooga.audio.update(1, 3); return { starts: __dsbSoundProbe.starts, fired: __ooga.dsb.fired }; })()`);
    record("dsb audio: four supplied clips play sequentially once despite reversing", sound.starts.length === 4 && sound.fired.every((f) => f === 1) && sound.starts.every((s, i, a) => !i || s.at >= a[i - 1].at + a[i - 1].duration - 0.01), JSON.stringify(sound));
    await b.key("Escape"); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
    record("dsb audio: leaving closes its audio context", await b.evaluate(`__dsbSoundProbe.context.state === "closed"`));
  } finally { await b.evaluate(`AudioContext.prototype.createBufferSource = __dsbSoundProbe.original; delete window.__dsbSoundProbe;`); }
} }] });
scene("dsb", { label: "dsb arrival camera", url: hubPage(src, "scene=dsb"), steps: [{ name: "dsb arrival camera", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await b.key("w"); await untilPage(b, "B.audio.ready", 10000);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w" });
  await b.evaluate(`__ooga.advance(2.6, 1 / 60)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w" });
  const left = await b.evaluate(`({ cue: __ooga.audio.cue, glance: __ooga.dsb.glance, behind: __ooga.camera.position.z - __ooga.dsb.avatar.root.position.z })`);
  if (process.env.DSB_CAPTURE) await b.screenshot(join(root, "untracked", "dsb-passage.png"));
  await untilPage(b, "!B.audio.pending", 12000);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w" });
  await b.evaluate(`__ooga.advance(8.7, 1 / 60)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w" });
  const right = await b.evaluate(`({ cue: __ooga.audio.cue, glance: __ooga.dsb.glance })`);
  record("dsb passage camera: real voice starts alternate gentle glances while staying behind the Ooga", left.cue === 0 && left.glance < -0.03 && left.behind > 3.9 && right.cue === 1 && right.glance > 0.03 && Math.abs(left.glance) <= 0.16 && Math.abs(right.glance) <= 0.16, JSON.stringify({ left, right }));
  await b.key("m");
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w" });
  await b.evaluate(`__ooga.advance(__ooga.audio.duration * (1 - __ooga.dsb.progress) + 0.1, 1 / 30)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w" });
  await untilPage(b, "B.audio.levels.music < 0.001", 3000);
  await b.evaluate(`__ooga.advance(Math.max(0, 2.5 - __ooga.dsb.arrivalTime), 1 / 60)`);
  if (process.env.DSB_CAPTURE) await b.screenshot(join(root, "untracked", "dsb-arrival-above.png"));
  await b.evaluate(`__ooga.advance(Math.max(0, 6.5 - __ooga.dsb.arrivalTime), 1 / 60)`);
  const lifted = await b.evaluate(`({ phase: __ooga.dsb.phase, music: __ooga.audio.levels.music, y: __ooga.camera.position.y })`);
  if (process.env.DSB_CAPTURE) await b.screenshot(join(root, "untracked", "dsb-arrival-below.png"));
  record("dsb arrival audio: tunnel music fades out for the outdoor radio", lifted.phase === "arrival" && lifted.music < 0.001 && lifted.y < -25, JSON.stringify(lifted));
  await b.evaluate(`document.querySelector('[data-action="dsb-skip"]').click(); __ooga.advance(1)`);
  const handoff = await b.evaluate(`(() => { const B = __ooga, before = { ...B.camera.position }; B.advance(1); return { phase: B.dsb.phase, drift: Math.hypot(B.camera.position.x - before.x, B.camera.position.y - before.y, B.camera.position.z - before.z), hidden: document.body.classList.contains("dsb-arrival"), mode: B.pilot.mode }; })()`);
  record("dsb arrival camera: skip settles into the default shoulder view without residual automatic motion", handoff.phase === "land" && handoff.mode === "shoulder" && handoff.drift < 0.01 && !handoff.hidden, JSON.stringify(handoff));
} }] });

scene("dsb", { label: "dsb ambience", url: hubPage(dist, "scene=dsb"), steps: [{ name: "dsb ambience", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.evaluate(`(() => {
    const buffer = AudioContext.prototype.createBufferSource, oscillator = AudioContext.prototype.createOscillator;
    const probe = window.__ambientProbe = { buffer, oscillator, created: 0, stopped: 0, context: null };
    for (const name of ["createBufferSource", "createOscillator"]) {
      const original = name === "createBufferSource" ? buffer : oscillator;
      AudioContext.prototype[name] = function() { const source = original.call(this), stop = source.stop.bind(source); probe.context = this; probe.created++; source.stop = (...args) => { probe.stopped++; return stop(...args); }; return source; };
    }
  })()`);
  try {
    await b.key("w"); await untilPage(b, "B.audio.ready", 10000);
    const tunnel = await b.evaluate(`__ooga.audio.ambience`);
    record("dsb ambience: outdoor graph is not constructed during entrance", tunnel === null, JSON.stringify(tunnel));
    const spatial = await b.evaluate(`(() => {
      const a = __ooga.audio, camera = { position: { x: 0, y: 1.7, z: 0 }, target: { x: 0, y: 1.7, z: -1 } }, boat = { x: 0, y: 0, z: 40 };
      a.arrive(); a.environment(camera, boat); const center = a.ambience;
      camera.position.z = 39; camera.target.z = 38; a.environment(camera, boat); const river = a.ambience;
      camera.position.z = 44; camera.position.y = -5; a.environment(camera, boat); const falls = a.ambience;
      camera.position.x = -18; camera.position.z = -9; camera.position.y = 1; a.environment(camera, boat); const stage = a.ambience;
      const created = __ambientProbe.created;
      for (let i = 0; i < 500; i++) a.environment(camera, boat);
      return { center, river, falls, stage, created, after: __ambientProbe.created };
    })()`);
    record("dsb ambience: water follows the river, waterfall edges, moving boat and stage", spatial.river.river > spatial.center.river * 3 && spatial.falls.waterfall > spatial.center.waterfall * 3 && spatial.river.motor > spatial.center.motor * 4 && spatial.stage.crowd > spatial.center.crowd * 3 && spatial.center.wildlife > 0 && spatial.center.calls > 0, JSON.stringify(spatial));
    record("dsb ambience: repeated updates reuse a fixed source graph", spatial.created === spatial.after && spatial.stage.sources === 4, JSON.stringify({ before: spatial.created, after: spatial.after }));
    await b.evaluate(`__ooga.audio.environment({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 } }, { x: -20, y: 0, z: 0 })`);
    await untilPage(b, 'B.audio.ambience.motorPan < -0.7', 3000);
    await b.evaluate(`__ooga.audio.environment({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 } }, { x: 20, y: 0, z: 0 })`);
    await untilPage(b, 'B.audio.ambience.motorPan > 0.7', 3000);
    record("dsb ambience: boat motor crosses the stereo field with its world position", true);
    await b.key("m");
    await b.evaluate(`__ooga.audio.environment(__ooga.camera, { x: -20, y: 0, z: 0 })`);
    await untilPage(b, '!B.audio.ambience.enabled && B.audio.ambience.gain < 0.001', 4000);
    record("dsb ambience: mute silences all outdoor layers", true);
    await b.key("Escape"); await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
    const cleanup = await b.evaluate(`({ created: __ambientProbe.created, stopped: __ambientProbe.stopped, state: __ambientProbe.context.state })`);
    record("dsb ambience: leaving stops every source and closes the audio context", cleanup.created === cleanup.stopped && cleanup.state === "closed", JSON.stringify(cleanup));
  } finally { await b.evaluate(`AudioContext.prototype.createBufferSource = __ambientProbe.buffer; AudioContext.prototype.createOscillator = __ambientProbe.oscillator; delete window.__ambientProbe;`); }
} }] });

scene("dsb", { label: "dsb shared player", url: hubPage(dist), steps: [{ name: "dsb shared player", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.evaluate(`(() => {
    const B = __ooga, c = B.cavemen.get("rules-without-rulers");
    c.override = "working"; B.crew.refreshStates(true); B.pilot.possess(c);
    B.crew.configureWeapon(c, 2, 7); B.crew.collectMagazine(c); c.weapon.spareAmmo[0] = 11;
    window.__hubAmmo = { ammo: c.weapon.ammo, spare: c.weapon.spareAmmo.join(), level: B.level };

  })()`);
  await dsbEnter(b);
  let entryTimeout;
  const entered = await Promise.race([untilPage(b, 'B.scene === "dsb" && !B.transitioning', 15000), new Promise((_, reject) => { entryTimeout = setTimeout(() => reject(Error("DSB entry: " + b.logs.join(" | "))), 18000); })]).finally(() => clearTimeout(entryTimeout));
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW" });
  if (!entered) throw Error("DSB entry failed");
  await b.key("m"); await untilPage(b, 'B.audio.ready', 10000);
  await b.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); __ooga.advance(__ooga.audio.duration + 2, 0.1); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));`);
  if (!await untilPage(b, 'B.dsb.phase === "land"', 5000)) throw Error("DSB passage did not finish");
  record("dsb shared player: canonical selected actor is possessed with independent ammunition", await b.evaluate(`__ooga.dsb.phase === "land" && __ooga.pilot.player === __ooga.dsb.avatar && __ooga.pilot.player.traits.name === "rules-without-rulers" && __ooga.pilot.player.weapon.ammo === BL.crew.AMMO_MAX && __ooga.pilot.player.headOpen === BL.models.caveman(BL.contributors.traitsFor("rules-without-rulers")).headOpen`));
  const move = await b.evaluate(`(() => { const c = __ooga.pilot.player, z = c.root.position.z; window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })); __ooga.advance(0.3); window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" })); return Math.abs(c.root.position.z - z); })()`);
  record("dsb shared player: shared walking moves the actor", move > 0.2, String(move));
  await b.key("2"); await b.evaluate("__ooga.pilot.enterClose(true); __ooga.advance(0.4)"); await b.key("v");
  const fired = await b.evaluate(`(() => { const c = __ooga.pilot.player; __ooga.advance(0.12); return { equipped: c.weapon.equipped, shots: c.weapon.shotsFired, ammo: c.weapon.ammo, gun: c.parts.gun.visible, aiming: __ooga.pilot.aiming, recoil: c.weapon.recoil }; })()`);
  record("dsb shared player: AK fires with shared gun pose and ammunition", fired.equipped && fired.shots > 0 && fired.ammo < 30 && fired.gun && fired.aiming && fired.recoil > 0, JSON.stringify(fired));
  await b.key("r"); await b.evaluate('__ooga.advance(3)');
  record("dsb shared player: local reload restores ammunition", await b.evaluate('__ooga.pilot.player.weapon.ammo === BL.crew.AMMO_MAX'));
  await b.key(" ");
  record("dsb shared player: Space jumps away from interactions", await b.evaluate('__ooga.advance(0.1); __ooga.pilot.player.hop > 0'));
  await b.evaluate('__ooga.advance(1)');
  const place = (x, z) => b.evaluate(`__ooga.pilot.navigate({ yaw: 0, pitch: 0.2, dist: 7, target: { x: ${x}, y: 1.7, z: ${z} }, position: { x: ${x}, y: 0, z: ${z} } }); __ooga.advance(0.1);`);
  await dsbApproach(b, "shop");
  await b.evaluate('__ooga.dsb.buy("tomato"); __ooga.dsb.buy("banana")');
  await b.key("t"); await b.key("b");
  record("dsb shared player: tomatoes and snacks remain separate", await b.evaluate('__ooga.dsb.inventory.tomatoes === 0 && __ooga.dsb.inventory.bananas === 0 && __ooga.dsb.shots === 1'));
  await b.evaluate(`document.querySelector('[data-action="dsb-context"]').click()`);
  await b.key("v");
  record("dsb shared player: shop suspends weapons", await b.evaluate('!document.getElementById("dsb-shop").hidden && !__ooga.dsb.avatar.weapon.triggerHeld'));
  await b.evaluate(`document.querySelector('[data-action="dsb-close-shop"]').click()`);
  await place(0, 33);
  await b.evaluate('__ooga.crew.setWeaponTrigger(true); __ooga.dsb.boatTrip.wait = 8; __ooga.dsb.board("boat")');
  const ride = await b.evaluate(`(() => { const w = __ooga.dsb.avatar.weapon, shots = w.shotsFired; __ooga.advance(0.5); return __ooga.dsb.phase === "boat" && !w.triggerHeld && !w.burstRemaining && w.shotsFired === shots; })()`);
  record("dsb shared player: boarding suspends firing", ride);
  await b.evaluate('__ooga.dsb.stopRide()');
  await place(7, 24);
  await b.evaluate('__ooga.dsb.trainTrip.wait = 8; __ooga.dsb.board("coaster"); __ooga.advance(0.2)');
  record("dsb shared player: coaster keeps its passenger camera", await b.evaluate('__ooga.dsb.phase === "coaster" && !__ooga.dsb.avatar.weapon.triggerHeld'));
  await b.evaluate('__ooga.dsb.stopRide()');
  await b.evaluate(`document.querySelector('[data-action="dsb-lookout"]').click(); __ooga.advance(0.4)`);
  record("dsb shared player: lookout remains a free camera", await b.evaluate('__ooga.pilot.player === null && __ooga.camera.position.y > 5'));
  await b.evaluate(`document.querySelector('[data-scene="dsb"] [data-action="reset-view"]').click(); __ooga.advance(0.4)`);
  record("dsb shared player: leaving lookout restores the same playable actor", await b.evaluate('__ooga.pilot.player === __ooga.dsb.avatar'));
  await dsbApproach(b, "tv"); await b.evaluate('__ooga.dsb.openTv()');
  await b.key("v");
  record("dsb shared player: TV opens with weapons suspended", await b.evaluate('__ooga.dsb.tv.isOpen && !__ooga.dsb.avatar.weapon.triggerHeld'));
  await b.evaluate('document.getElementById("dsb-tv-close").click(); __ooga.advance(0.1)');
  await place(-7, 30.5); await b.evaluate('document.getElementById("dsb-context").click()');
  await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
  const back = await b.evaluate(`({ name: __ooga.pilot.player?.traits.name, ammo: __ooga.pilot.player?.weapon.ammo, spare: __ooga.pilot.player?.weapon.spareAmmo.join(), original: __hubAmmo })`);
  record("dsb shared player: return restores identity and leaves hub ammunition untouched", back.name === "rules-without-rulers" && back.ammo === back.original.ammo && back.spare === back.original.spare, JSON.stringify(back));
} }] });

scene("dsb", { label: "dsb character continuity", url: hubPage(dist), steps: [{ name: "dsb character continuity", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  for (const name of ["YellowBrokeIt", "rules-without-rulers"]) {
    await b.evaluate(`(() => {
      const B = __ooga, cave = B.cavemen.get(${JSON.stringify(name)});
      cave.override = "working"; B.crew.refreshStates(true); B.pilot.possess(cave);
      window.__dsbPreviousRoot = cave.root;
      B.advance(0.2);
    })()`);
    await dsbEnter(b);
    const entered = await untilPage(b, 'B.scene === "dsb" && !B.transitioning', 15000);
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW" });
    if (!entered) throw Error("DSB scene handoff did not complete");
    const avatar = await b.evaluate(`(() => {
      const a = __ooga.dsb.avatar, canonical = BL.models.caveman(BL.contributors.traitsFor(${JSON.stringify(name)}));
      return { name: a.traits.name, rebuilt: a.root !== __dsbPreviousRoot, canonical: a.headOpen === canonical.headOpen };
    })()`);
    record("dsb character: " + name + " enters with the canonical model", avatar.name === name && avatar.rebuilt && avatar.canonical, JSON.stringify(avatar));
    await b.key("Escape");
    await untilPage(b, 'B.scene === "hub" && !B.transitioning', 15000);
    const returned = await b.evaluate(`({ name: __ooga.pilot.player?.traits.name, rebuilt: __ooga.pilot.player?.root !== __dsbPreviousRoot })`);
    record("dsb character: " + name + " returns possessed", returned.name === name && returned.rebuilt, JSON.stringify(returned));
    await b.evaluate('delete window.__dsbPreviousRoot');
  }
} }] });

scene("dsb", { label: "dsb phone", url: hubPage(dist, "scene=dsb"), opts: { w: 390, h: 844, mobile: true }, steps: [{ name: "dsb phone", why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  const layout = await b.evaluate(`(() => { const p = document.getElementById("dsb-panel").getBoundingClientRect(), j = document.getElementById("joy-move").getBoundingClientRect(); return { width: innerWidth, height: innerHeight, left: p.left, right: p.right, bottom: p.bottom, stick: j.width > 0, overlap: p.left < j.right && p.right > j.left && p.bottom > j.top }; })()`);
  record("dsb phone: entrance fits and leaves the movement stick usable", layout.left >= 0 && layout.right <= layout.width && layout.bottom <= layout.height && layout.stick && !layout.overlap, JSON.stringify(layout));
  const enable = await b.evaluate(`(() => { const r = document.getElementById("dsb-start-audio").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [enable] });
  await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await untilPage(b, "B.audio.ready", 10000);
  const stick = await b.evaluate(`(() => { const r = document.getElementById("joy-move").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y + 10 }; })()`);
  await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: stick.x, y: stick.top }] });
  await untilPage(b, "B.audio.ready", 10000);
  await b.evaluate(`__ooga.audio.toggle(); __ooga.advance(__ooga.audio.duration * 1.02, 1 / 20)`);
  await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const phase = await b.evaluate(`({ phase: __ooga.dsb.phase, progress: __ooga.dsb.progress, muted: __ooga.audio.muted, pending: __ooga.audio.pending, ready: __ooga.audio.ready, duration: __ooga.audio.duration })`);
  record("dsb phone: reduced motion enters land without an automatic camera tour", phase.phase === "land", JSON.stringify(phase));
  await b.evaluate(`document.querySelector('[data-action="dsb-skip"]').click(); __ooga.advance(0.1)`);
  record("dsb phone: skip tour restores the playable camera", await b.evaluate(`__ooga.dsb.phase === "land" && !document.body.classList.contains("dsb-arrival")`));
  await b.evaluate(`__ooga.advance(1)`);
  const alpha = await b.evaluate(`document.getElementById("overlay").getContext("2d").getImageData(10, 10, 1, 1).data[3]`);
  record("dsb reveal: overlay clears after the white fade", alpha === 0, String(alpha));
  if (process.env.DSB_CAPTURE) await b.screenshot(join(root, "untracked", "dsb-phone.png"));
} }] });
for (const backend of ["webgl2", "canvas2d"]) scene("dsb", { label: `dsb land ${backend}`, url: hubPage(src, `scene=dsb${backend === "canvas2d" ? "&canvas2d=1" : ""}`), steps: [{ name: `dsb land ${backend}`, why: "contract: preserve DSB scene behavior independently of the hub entrance", run: async (b) => {
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await b.evaluate(`(() => { const scene = BL.scenes.dsb, update = scene.update; window.__dsbClockProbe = { time: 0, min: 0 }; scene.update = (dt, time) => { __dsbClockProbe.time = time; __dsbClockProbe.min = Math.min(__dsbClockProbe.min, time); update(dt, time); }; })()`);
  const initial = await b.evaluate(`({ phase: __ooga.dsb.phase, progress: __ooga.dsb.progress, live: !!__ooga.dsb.data, nodes: __ooga.stats().allNodes })`);
  record("dsb entrance: starts dark without constructing live feeds", initial.phase === "entrance" && initial.progress === 0 && !initial.live, JSON.stringify(initial));
  await b.key("m");
  await untilPage(b, "B.audio.ready", 10000);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w" });
  await b.evaluate(`__ooga.advance(__ooga.audio.duration * 0.3, 1 / 20)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w" });
  const partial = await b.evaluate(`({ progress: __ooga.dsb.progress, z: __ooga.camera.position.z, avatarZ: __ooga.dsb.avatar.root.position.z, fired: __ooga.dsb.fired })`);
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "s" });
  await b.evaluate(`__ooga.advance(__ooga.audio.duration * 0.1, 1 / 20)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "s" });
  const back = await b.evaluate(`({ progress: __ooga.dsb.progress, fired: __ooga.dsb.fired })`);
  record("dsb entrance: walking grows the opening and reversing does not replay a cue", partial.progress > 0.2 && partial.z < 24 && Math.abs(partial.z - partial.avatarZ - 4) < 0.01 && back.progress < partial.progress && back.fired[0] === 1, JSON.stringify({ partial, back }));
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w" });
  await b.evaluate(`__ooga.advance(__ooga.audio.duration * 0.83, 1 / 20)`);
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w" });
  const tour = await b.evaluate(`(() => {
    const B = __ooga, start = B.dsb.phase, samples = [];
    for (let i = 0; i < 30; i++) { B.advance(0.5, 1 / 30); samples.push({ x: B.camera.position.x, y: B.camera.position.y, z: B.camera.position.z }); }
    return { start, end: B.dsb.phase, samples, mode: B.pilot.mode, avatar: B.dsb.avatar.root.visible };
  })()`);
  record("dsb arrival: full circle shows upper plain and turtle underside before handing back shoulder control", tour.start === "arrival" && tour.end === "land" && tour.samples.some((p) => p.x > 70) && tour.samples.some((p) => p.x < -70) && tour.samples.some((p) => p.y > 40) && tour.samples.some((p) => p.y < -25) && tour.mode === "shoulder" && tour.avatar, JSON.stringify(tour));
  const land = await b.evaluate(`({ phase: __ooga.dsb.phase, fired: __ooga.dsb.fired, boats: __ooga.dsb.land.boats.length, water: __ooga.dsb.land.water.visible, turtle: __ooga.dsb.land.turtle.children.length, finite: [...__ooga.dsb.railY].every(Number.isFinite) })`);
  record("dsb land: all four cues fire once and the independent world opens", land.phase === "land" && land.fired.every((v) => v === 1) && land.boats === 3 && land.water && land.turtle > 20 && land.finite, JSON.stringify(land));
  if (process.env.DSB_CAPTURE && backend === "webgl2") {
    await b.screenshot(join(root, "untracked", "dsb-walk.png"));
    await b.evaluate(`__ooga.pilot.goPreset("lookout"); __ooga.advance(2)`);
    await b.screenshot(join(root, "untracked", "dsb-turtle.png"));
    await b.evaluate(`document.querySelector('[data-scene="dsb"] [data-action="reset-view"]').click(); __ooga.advance(0.3)`);
  }
  const shop = await b.evaluate(`(() => { const B = __ooga; const landmark = B.dsb.land.landmarks.shop, anchor = landmark.point(); B.pilot.navigate({ yaw: landmark.node.rotation.y, pitch: 0, dist: 12, position: anchor, target: { x: anchor.x, y: 1.7, z: anchor.z } }); B.dsb.buy("bread"); B.dsb.buy("tomato"); const bought = B.dsb.inventory; B.dsb.eat(); B.dsb.throwTomato(); const used = B.dsb.inventory; return { bought, used, shots: B.dsb.shots, clock: window.__dsbClockProbe }; })()`);
  record("dsb shop: simulated purchases charge once and consume inventory", shop.bought.tokens === 16 && shop.bought.bread === 1 && shop.bought.tomatoes === 1 && shop.used.bread === 0 && shop.used.tomatoes === 0 && shop.shots === 1 && shop.clock.min >= 0, JSON.stringify(shop));
  const ride = await b.evaluate(`(() => { const B = __ooga; B.pilot.navigate({ yaw: 0, pitch: 0, dist: 12, position: { x: 0, y: 0, z: 33 }, target: { x: 0, y: 1.7, z: 33 } }); B.dsb.boatTrip.wait = 8; B.dsb.boatTrip.angle = 0; B.dsb.board("boat"); B.advance(0.2); const boat = B.dsb.phase; B.dsb.stopRide(); const landed = B.dsb.phase; B.pilot.navigate({ yaw: 0, pitch: 0, dist: 12, position: { x: 7, y: 0, z: 24 }, target: { x: 7, y: 1.7, z: 24 } }); B.dsb.trainTrip.wait = 8; B.dsb.trainTrip.angle = B.dsb.trainTrip.start; B.dsb.board("coaster"); B.advance(0.2); const coaster = B.dsb.phase, y = B.camera.position.y; B.dsb.stopRide(); return { boat, landed, coaster, y, stopped: B.dsb.phase }; })()`);
  record("dsb rides: board, move and disembark on dry ground", ride.boat === "boat" && ride.landed === "land" && ride.coaster === "coaster" && ride.y > 3 && ride.stopped === "land", JSON.stringify(ride));
  const data = await b.evaluate(`(() => { const d = BL.dsbData.create(), bad = d.ingestCandles([[1, -1, 10, 3, 4]]); const good = d.ingestCandles([[120, 98, 105, 100, 103], [60, 95, 104, 99, 100]]); const stale = d.ingestTick(104, 30); for (let i = 0; i < 200; i++) d.ingestTick(100 + i, 180 + i * 60); const out = { bad, good, stale, count: d.state.count, size: d.state.candles.length, price: d.state.price }; d.dispose(); return out; })()`);
  record("dsb data: validates and orders feeds, rejects stale ticks, caps history", !data.bad && data.good && !data.stale && data.count === 48 && data.size === 240 && data.price === 299, JSON.stringify(data));
  await dsbExit(b);
  const hub = await b.evaluate(`({ scene: __ooga.scene, dsb: BL.caves.slots.find((s) => s.id === "c10"), sheet: document.getElementById("sheet").hidden, body: document.body.classList.contains("dsb-active") })`);
  record("dsb return: restores Bifrost and interface and leaves c10 sealed", hub.scene === "bifrost" && hub.dsb.scene === null && hub.dsb.status === "dark" && hub.dsb.name === null && !hub.sheet && !hub.body, JSON.stringify(hub));
  record("dsb land: console remains clean", b.logs.length === 0, b.logs.join(" | "));
} }] });


const mb = (bytes) => (bytes / 1048576).toFixed(2);
const dsbSoak = async (b) => {
  await b.send("HeapProfiler.enable");
  const until = (cond, ms) => b.evaluate(`new Promise((resolve) => { const B = window.__ooga; const t0 = performance.now(); const tick = () => { const ok = !!(${cond}); if (ok || performance.now() - t0 > ${ms}) resolve(ok); else requestAnimationFrame(tick); }; tick(); })`);
  const rendered = (frames, ms = 6000) => b.evaluate(`new Promise((resolve) => { const B = window.__ooga; const start = B.renderedFrames; const t0 = performance.now(); const tick = () => { if (B.renderedFrames >= start + ${frames} || performance.now() - t0 > ${ms}) resolve(B.renderedFrames - start); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`);
  const settled = (ms = 4000) => until("window.BL.scene.tweenCount() === 0", ms);
  // Every scene writes its hint 1.2 s after entering; the first snapshot must already count that text node.
  await until(`document.getElementById("hint").textContent`, 3000);
  const heap = async () => {
    await b.send("HeapProfiler.collectGarbage");
    // Count the page before Chrome's heap-snapshot machinery can add an inspector node.
    const dom = (await b.send("Memory.getDOMCounters")).result;
    const chunks = [];
    b.on("HeapProfiler.addHeapSnapshotChunk", (p) => chunks.push(p.chunk));
    await b.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    b.on("HeapProfiler.addHeapSnapshotChunk", null);
    const snap = JSON.parse(chunks.join(""));
    const { node_fields: fields, node_types: [types] } = snap.snapshot.meta;
    const iType = fields.indexOf("type"), iSize = fields.indexOf("self_size"), code = types.indexOf("code");
    let total = 0, compiled = 0;
    for (let i = 0; i < snap.nodes.length; i += fields.length) {
      total += snap.nodes[i + iSize];
      if (snap.nodes[i + iType] === code) compiled += snap.nodes[i + iSize];
    }
    return { used: (await b.send("Runtime.getHeapUsage")).result.usedSize, objects: total - compiled, code: compiled, nodes: dom.nodes, listeners: dom.jsEventListeners };
  };
  const snapshot = async (stats = null) => {
    // Freeze the page so stats, DOM counters and heap describe one state despite other lanes' delays.
    await b.focus(false);
    try {
      await b.send("Page.setWebLifecycleState", { state: "frozen" });
      return { stats: stats || await b.evaluate("window.__ooga.stats()"), ...await heap() };
    } finally {
      await b.send("Page.setWebLifecycleState", { state: "active" });
      await b.focus(true);
      await b.send("Page.bringToFront");
    }
  };
  // A go() during a running transition is ignored: wait for swap, frames, animations and the fade first.
  const travel = (id) => b.evaluate(`new Promise((resolve) => { const B = window.__ooga; const T = window.BL.scene.tweenCount; const t0 = performance.now(); let last = t0, swap = 0, swapFrame = 0, swapGap = 0; B.go(${JSON.stringify(id)}); const tick = () => { const now = performance.now(); if (!swap && B.scene === ${JSON.stringify(id)}) { swap = now - t0; swapGap = now - last; swapFrame = B.renderedFrames; } last = now; if (swap && B.renderedFrames >= swapFrame + 3 && T() === 0 && !B.transitioning) resolve({ swap, swapGap, settled: now - t0 }); else if (now - t0 > 8000) resolve({ stuck: { scene: B.scene, tweens: T(), framesSinceSwap: swap ? B.renderedFrames - swapFrame : -1, swap: Math.round(swap) } }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`);
  const heapDetail = (a, z) => `objects ${mb(a.objects)} -> ${mb(z.objects)} MB (used ${mb(a.used)} -> ${mb(z.used)} MB, code ${mb(a.code)} -> ${mb(z.code)} MB)`;
  const within = (a, z, share) => Math.abs(z.objects - a.objects) <= a.objects * share;
  return { until, rendered, settled, snapshot, travel, heapDetail, within };
};

scene("dsb", { label: "lifecycle", url: hubPage(src), steps: [{ name: "dsb lifecycle", why: "contract: repeated DSB visits release nodes, listeners and GPU resources", run: async (b) => {
  const { rendered, settled, snapshot, travel, heapDetail, within } = await dsbSoak(b);
  // Warm the new cached model builders before comparing retained memory.
  await travel("dsb"); await travel("hub"); await settled(); await rendered(2);
  const before = await snapshot();
  for (let i = 0; i < 6; i++) { await travel("dsb"); await travel("hub"); }
  const after = await snapshot();
  const same = (key) => before.stats[key] === after.stats[key];
  record("soak: dsb cycles: six round trips retain node, target, tween and DOM counts", same("allNodes") && same("targets") && same("tweens") && same("dom") && after.stats.tweens === 0, JSON.stringify({ before: before.stats, after: after.stats }));
  record("soak: dsb cycles: GPU records, listeners and heap remain bounded", Math.abs(after.stats.gl.records - before.stats.gl.records) <= 3 && before.nodes === after.nodes && before.listeners === after.listeners && within(before, after, 0.1), heapDetail(before, after));
} }] });

scene("factory", { label: "lifecycle", url: hubPage(src), steps: [{ name: "factory lifecycle", why: "contract: repeated factory visits release the hall's listeners, nodes and GPU resources while retaining one bounded shared node", run: async (b) => {
  const { rendered, settled, snapshot, travel, heapDetail, within } = await dsbSoak(b);
  await b.evaluate(`(() => {
    const node = __ooga.factory.node, feed = node.feed, subscribe = feed.subscribe;
    window.__factoryLife = { node, subscriptions: 0 };
    feed.subscribe = (fn) => {
      const off = subscribe(fn); let live = true;
      __factoryLife.subscriptions++;
      return () => { if (live) { live = false; __factoryLife.subscriptions--; } return off(); };
    };
  })()`);
  // Warm both scenes, so the counts below start from a visit made after the instrumenting.
  await travel("factory"); await travel("hub"); await settled(); await rendered(2);
  const before = await snapshot(), visits = [];
  for (let i = 0; i < 6; i++) {
    await travel("factory"); await travel("hub"); await settled(); await rendered(2);
    visits.push(await b.evaluate(`(() => {
      const n = __ooga.factory.node;
      return { same: n === __factoryLife.node, subscriptions: __factoryLife.subscriptions, lines: n.placeOf.size, places: n.bays.length + n.stands.length };
    })()`));
  }
  const after = await snapshot(), same = (key) => before.stats[key] === after.stats[key];
  record("soak: factory cycles: one bounded node survives six round trips, the hall's subscription released, without retaining scene nodes, targets or DOM", visits.every((v) => v.same && v.subscriptions === 0 && v.lines <= v.places)
    && same("allNodes") && same("targets") && same("dom") && after.stats.tweens === 0, JSON.stringify({ visits, before: before.stats, after: after.stats }));
  record("soak: factory cycles: GPU records, listeners and retained heap remain bounded", Math.abs(after.stats.gl.records - before.stats.gl.records) <= 3 && before.nodes === after.nodes && before.listeners === after.listeners && within(before, after, 0.1), heapDetail(before, after));
} }] });

// Node tier: pure computation over window.BL under a minimal DOM shim, calling the same probe functions.
// 30 checks in about three seconds, against ~3.7 s of launch and boot per browser task.
// The Lightning Factory in Node: the feed's two contracts, the demo node that stands in for a real one, and the
// walkable floor of the hall, each through the module's own functions.
const factoryChecks = (BL) => {
  const F = BL.factoryFeed, bucket = (hour) => { const d = new Date(Date.UTC(2026, 8, 26, 12, hour ? 0 : 34)); return d.toISOString(); };
  let seq = 0;
  const event = (type, payload, { schema = F.DEMO, hour = false, at = ++seq } = {}) => ({ schema, id: "11111111-2222-4333-8444-" + String(at).padStart(12, "0"), seq: at, bucket: bucket(hour), node: "probe", origin: "observed", stream: "live", type, payload });
  {
    const why = (e) => F.refusal(e) || "ok";
    const r = {
      publicForward: why(event("forward.settled", { scale: "small", count: 1 }, { schema: F.PUBLIC })),
      publicStation: why(event("forward.settled", { scale: "small", station: "beach" }, { schema: F.PUBLIC })),
      publicOut: why(event("forward.settled", { scale: "small", out: "harbor" }, { schema: F.PUBLIC })),
      publicFee: why(event("forward.settled", { scale: "small", fee: "dust" }, { schema: F.PUBLIC })),
      demoRoute: why(event("forward.settled", { scale: "large", station: "beach", out: "harbor", fee: "dust" })),
      demoFailed: why(event("forward.failed", { scale: "small", station: "beach", out: "harbor" })),
      demoLoop: why(event("forward.settled", { scale: "small", station: "beach", out: "beach" })),
      demoOutOnChannel: why(event("channel.active", { scale: "large", station: "beach", out: "harbor" })),
      rebalanceLine: why(event("rebalance.succeeded", { scale: "large", station: "beach" }, { hour: true })),
      rebalanceMinute: why(event("rebalance.succeeded", { scale: "large" })),
      rebalanceHour: why(event("rebalance.succeeded", { scale: "large" }, { hour: true }))
    };
    record("factory feed: Foundry's public events carry no line, route or fee; the demo contract names a forward's two different lines and nothing else; a rebalance never names a line and is timed to the hour", r.publicForward === "ok" && r.publicStation === "payload" && r.publicOut === "payload" && r.publicFee === "payload" && r.demoRoute === "ok" && r.demoFailed === "ok" && r.demoLoop === "out" && r.demoOutOnChannel === "out" && r.rebalanceLine === "rebalance" && r.rebalanceMinute === "bucket" && r.rebalanceHour === "ok", JSON.stringify(r));
    const feed = F.create({ now: () => 0 }), seen = [];
    feed.subscribe((e) => seen.push(e.seq));
    for (const at of [1, 2, 2, 5, 6]) feed.accept(event("forward.settled", { scale: "small", station: "beach", out: "harbor" }, { at }));
    const c = feed.counts;
    record("factory feed: a repeated seq is one event and a skipped one is counted as a gap", c.accepted === 4 && c.duplicates === 1 && c.gaps === 1 && seen.join() === "1,2,5,6", JSON.stringify({ counts: c, seen }));
  }
  {
    // Two demo nodes on the same seed and clock play the same show; the feed takes every event it plays.
    const play = (seconds) => {
      const mock = BL.factoryMock.create({ seed: 21, now: () => Date.UTC(2026, 8, 26, 12) }), feed = F.create({ now: () => 0 }), events = [];
      let t = 0;
      const take = (e) => { events.push({ t, type: e.type, p: e.payload }); feed.accept(e); };
      mock.replay(take);
      for (; t < seconds; t += 0.25) mock.update(0.25, take);
      return { events, counts: feed.counts, mock };
    };
    const a = play(300), b = play(300), same = JSON.stringify(a.events) === JSON.stringify(b.events);
    const forwards = a.events.filter((e) => e.type.startsWith("forward.")), routed = forwards.every((e) => e.p.out && e.p.out !== e.p.station);
    const big = forwards.filter((e) => e.p.scale === "large" || e.p.scale === "very_large").length;
    record("factory demo node: the same seed plays the same show, the feed takes every event, and every forward runs from one line out along another, now and then a large one", same && a.counts.dropped === 0 && a.counts.gaps === 0 && forwards.length > 100 && routed && big > 3, JSON.stringify({ same, counts: a.counts, forwards: forwards.length, routed, big }));
    // The forge has work within seconds of a visit and never waits long, and the churn neither drains nor floods the lines.
    const forge = a.events.filter((e) => e.t > 0 && (e.type === "channel.opening" || e.type === "channel.closed")).map((e) => e.t), gaps = forge.slice(1).map((t, i) => t - forge[i]);
    const counts = a.events.filter((e) => e.t > 0 && e.p.channel_count !== undefined).map((e) => e.p.channel_count), start = a.mock.snapshot.channels.length;
    record("factory demo node: the first channel reaches the forge within ten seconds and the forge never waits a minute, while the number of open lines holds steady", forge[0] < 10 && Math.max(...gaps) < 60 && counts.length > 8 && Math.max(...counts) - Math.min(...counts) <= 2, JSON.stringify({ first: forge[0], longest: Math.max(...gaps), openLines: [Math.min(...counts), Math.max(...counts)], channels: start }));
  }
};
const pokerChecks = (BL) => {
  const R = BL.pokerRules, c = text => "23456789TJQKA".indexOf(text[0]) + "cdhs".indexOf(text[1]) * 13;
  const cards = text => text.split(" ").map(c);
  const fixtures = ["Ac Jd 9h 6s 3c", "Ac Ad 9h 6s 3c", "Ac Ad 9h 9s 3c", "Ac Ad Ah 6s 3c", "Ac 2d 3h 4s 5c", "Ac Jc 9c 6c 3c", "Ac Ad Ah 6s 6c", "Ac Ad Ah As 3c", "Tc Jc Qc Kc Ac"];
  const scores = fixtures.map(text => R.evaluate(cards(text)));
  record("poker rules: all hand categories, ace-low straight, kickers and seven-card best hand", scores.every((s, i) => s.category === i && (!i || s.score > scores[i - 1].score)) && R.evaluate(cards("2c 3d 4h 5s 6c")).score > scores[4].score && R.evaluate(cards("Ac Ad Kh Qs 3c")).score > R.evaluate(cards("Ac Ad Kh Js 3c")).score && R.evaluate(cards("Tc Jc Qc Kc Ac 2d 2h")).score === scores[8].score);
  const board = cards("2c 3d 7h 9s Jc"), hands = ["Ac Ad", "Kc Kd", "Qc Qd", "Tc 8d"];
  const seats = new Array(R.SEATS).fill(null);
  [50, 100, 200, 200].forEach((n, i) => { seats[i] = { cards: cards(hands[i]), totalBet: n, inHand: true, folded: i === 3 }; });
  const paid = R.settle(seats, board, 0);
  record("poker pots: unequal all-ins split main and side pots, folded chips remain and rake is zero", paid.awards.join() === [200, 150, 200, ...new Array(R.SEATS - 3).fill(0)].join() && paid.pots.reduce((n, p) => n + p.amount, 0) === 550, JSON.stringify(paid));
  seats[3].totalBet = 100;
  const refund = R.settle(seats, board, 0);
  record("poker pots: uncalled excess is refunded", refund.awards[2] === 100 && refund.pots.at(-1).refund && refund.pots.at(-1).amount === 100);
  const tieSeats = new Array(R.SEATS).fill(null);
  for (let i = 0; i < 3; i++) tieSeats[i] = { cards: cards(hands[i]), totalBet: 1, inHand: true, folded: i === 1 };
  const tie = R.settle(tieSeats, cards("Ts Js Qs Ks As"), 0);
  record("poker pots: board plays and the odd chip goes clockwise left of the button", tie.awards[0] === 1 && tie.awards[2] === 2);
  const source = readFileSync(join(root, "src/js/poker-rules.js"), "utf8");
  let draws = 0;
  const rejection = { window: {}, crypto: { getRandomValues(a) { a[0] = draws++ ? 4 : 0xffffffff; return a; } } };
  runInNewContext(source, rejection);
  record("poker shuffle: rejects modulo-bias tail before returning a bounded integer", rejection.window.BL.pokerRules.randomInt(3) === 1 && draws === 2);
  const unavailable = { window: {} }; runInNewContext(source, unavailable);
  const stopped = unavailable.window.BL.pokerRules.create(); stopped.join("a", "A"); stopped.join("b", "B");
  let secureFailed = false; try { stopped.start(); } catch { secureFailed = true; }
  record("poker shuffle: missing secure entropy fails before hand or balance mutation", secureFailed && stopped.snapshot().hand === 0 && stopped.snapshot().seats[0].stack === 1000);
  let seed = 87923;
  const seeded = { window: {}, crypto: { getRandomValues(a) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; a[0] = seed >>> 0; return a; } } };
  runInNewContext(source, seeded);
  const Q = seeded.window.BL.pokerRules, table = Q.create();
  for (let i = 0; i < Q.SEATS; i++) table.join("p" + i, "Player " + i, true);
  let full = false; try { table.join("extra", "Extra"); } catch { full = true; }
  table.start();
  const publicView = table.snapshot(), own = table.snapshot("p0"), turnId = publicView.seats[publicView.turn].id;
  const before = JSON.stringify(table.snapshot(turnId));
  let rejected = 0;
  for (const value of [-1, 10.5, Infinity, 1001]) try { table.act(turnId, "raise", value); } catch { rejected++; }
  try { table.act("not-seated", "call"); } catch { rejected++; }
  try { table.start(); } catch { rejected++; }
  try { table.leave("p0"); } catch { rejected++; }
  record("poker actions: nine-seat cap, invalid raises, out-of-turn and mid-hand seat changes fail atomically", full && rejected === 7 && JSON.stringify(table.snapshot(turnId)) === before);
  own.seats[0].cards[0] = -9; own.seats[0].stack = 1;
  record("poker privacy: spectator and other-seat snapshots hide hole cards and snapshot mutation cannot alter play", publicView.seats.every(s => s.cards.every(c => c === null)) && table.snapshot("p0").seats[0].cards.every(c => Number.isInteger(c) && c >= 0) && own.seats.slice(1).every(s => s.cards.every(c => c === null)) && table.snapshot().seats[0].stack > 1 && !("deck" in publicView));
  let conservation = true, hiddenFolded = true, bounded = true, finished = 0;
  for (let h = 0; h < 300; h++) {
    if (h) { for (let i = 0; i < Q.SEATS; i++) table.refill("p" + i); table.start(); }
    let s = table.snapshot(), total = s.pot + s.seats.reduce((n, p) => n + p.stack, 0), steps = 0;
    while (table.playing && steps++ < 1000) {
      const id = s.seats[s.turn].id, l = table.snapshot(id).legal;
      // All-ins interleaved with short calls, folds and full raises exercise real
      // settlement paths across changing stacks; this is not a shuffle proof.
      if (h % 3 === 0 && l.canRaise) table.act(id, "raise", l.max);
      else Q.botAction(table, id);
      s = table.snapshot();
      conservation = conservation && s.pot + s.seats.reduce((n, p) => n + p.stack, 0) === total && s.seats.every(p => Number.isSafeInteger(p.stack) && p.stack >= 0);
    }
    finished += s.phase === "showdown" ? 1 : 0;
    hiddenFolded = hiddenFolded && s.seats.filter(p => p.folded).every(p => p.cards.every(c => c === null));
    bounded = bounded && s.history.length <= 12 && s.board.length <= 5;
  }
  record("poker playthrough: 300 nine-player hands terminate with conserved whole chips, bounded state and folded cards private", finished === 300 && conservation && hiddenFolded && bounded, JSON.stringify({ finished, conservation, hiddenFolded, bounded }));
  const headsUp = Q.create(); headsUp.join("a", "A"); headsUp.join("b", "B"); headsUp.start();
  const hu = headsUp.snapshot(); headsUp.act("a", "call"); headsUp.act("b", "check");
  record("poker heads-up: button is small blind, acts first preflop and last postflop", hu.dealer === 0 && hu.turn === 0 && hu.seats[0].roundBet === 5 && hu.seats[1].roundBet === 10 && headsUp.snapshot().phase === "flop" && headsUp.snapshot().turn === 1);
  {
    const rows = [];
    // Three players: pot 15, facing 10. A pot-sized raise calls 10 first,
    // then raises 25, for a total of 35 (not 25 or 45).
    for (const [preset, expected] of [["min", 20], ["half", 23], ["threeQuarter", 29], ["pot", 35], ["all", 1000]]) {
      const t = Q.create(); for (const id of ["a", "b", "c"]) t.join(id, id);
      t.start(); const before = t.snapshot("a"), amount = BL.pokerHud.betAmount(before, preset);
      t.act("a", "raise", amount); const after = t.snapshot();
      rows.push({ preset, amount, ok: amount === expected && after.seats[0].roundBet === expected && after.pot === expected + 15 });
    }
    record("poker sizing: presets include the call, submit legal street totals and move the displayed chips", rows.every(r => r.ok), JSON.stringify(rows));
    const t = Q.create(); for (const id of ["a", "b", "c"]) t.join(id, id);
    t.start(); t.act("a", "raise", 995);
    const short = t.snapshot("b"), amount = BL.pokerHud.betAmount(short, "pot");
    t.act("b", "raise", amount); t.act("c", "call"); const locked = t.snapshot("a");
    record("poker sizing: short all-in caps the preset and never bypasses closed raise rights", short.legal.min > short.legal.max && amount === 1000 && !locked.legal.canRaise && BL.pokerHud.betAmount(locked, "all") === null);
    record("poker public state: blind markers and contributions are exposed without private cards", hu.smallBlind === hu.dealer && hu.bigBlind === 1 && hu.seats[0].totalBet === 5 && hu.seats[1].totalBet === 10 && hu.seats[0].lastAction === "Small blind" && hu.seats.every(p => !p || p.cards.every(c => c === null)));
  }
  const walk = BL.pokerModels.walkable, actor = { bodyRadius: 0.65 };
  record("poker floor: wide spectators can traverse the main and row aisles; table and chair sweeps collide", walk(0, 34, 0, -34, 0, 2, actor) && walk(-21, 18, 21, 18, 0, 2, actor) && !walk(-18, 24, -4, 24, 0, 2, actor) && !walk(22, 0, 26, 0, 0, 2, actor));
  {
    // Contract: changing the scenery during a hand must keep pick targets,
    // chairs, dealers and private/public card nodes alive without growing the room.
    const room = BL.pokerModels.build(), targets = room.tables.map(t => t.top), dealers = room.tables.map(t => t.agent);
    const chairs = room.tables.map(t => t.chairs.slice()), count = node => 1 + node.children.reduce((n, c) => n + count(c), 0);
    const baseline = count(room.root), first = room.tables[0], face = BL.pokerCards.geometry(0);
    first.board[0].geometry = face; first.board[0].visible = true; first.backs[0].visible = true; first.chips[0].scale.y = 7;
    let stable = true;
    try {
      for (let pass = 0; pass < 2; pass++) for (const theme of BL.pokerThemes.themes) {
        room.setTheme(theme.id);
        stable &&= room.theme === theme.id && room.root.children.length === 11 &&
          room.tables.every((t, i) => t.top === targets[i] && t.agent === dealers[i] && t.chairs.every((c, j) => c === chairs[i][j])) &&
          first.board[0].geometry === face && first.board[0].visible && first.backs[0].visible && first.chips[0].scale.y === 7;
      }
      room.setTheme("gatsby");
      record("poker themes: repeated switches preserve seats, dealers and dealt cards with a bounded scene", stable && count(room.root) === baseline && BL.pokerModels.geometry("invalid") === BL.pokerModels.geometry("gatsby"));
    } finally { for (const t of room.tables) t.agent.dispose(); }
  }
};
const pokerProtocolChecks = async () => {
  const { loadProtocol, source: protocolSource } = await import("../server/poker/load.mjs");
  const { createECDH, randomBytes } = await import("node:crypto");
  const { createPokerServer } = await import("../server/poker/server.mjs");
  const { Worker } = await import("node:worker_threads");
  const BL = loadProtocol(), C = BL.pokerCrypto, M = BL.pokerMatch, E = C.math;
  const clone = value => JSON.parse(JSON.stringify(value));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const rejects = async fn => { try { await fn(); return false; } catch { return true; } };
  try {
    const scalars = [1n, 2n, 3n, E.N - 1n, ...Array.from({ length: 12 }, () => BigInt("0x" + randomBytes(32).toString("hex")) % (E.N - 1n) + 1n)];
    for (const n of scalars) {
      const native = createECDH("prime256v1"); native.setPrivateKey(Buffer.from(n.toString(16).padStart(64, "0"), "hex"));
      const p = E.mul(E.G, n); check(E.encode(p) === native.getPublicKey("hex", "uncompressed"), "P-256 disagrees with native OpenSSL");
      check(E.same(p, E.decode(E.encode(p))) && E.same(E.add(p, E.sub(E.O, p)), E.O), "Group inverse or encoding failed");
      const peer = createECDH("prime256v1"); peer.generateKeys();
      const shared = E.encode(E.mul(E.decode(peer.getPublicKey("hex", "uncompressed")), n)).slice(2, 66);
      check(shared === native.computeSecret(peer.getPublicKey()).toString("hex"), "ECDH disagrees with native OpenSSL");
    }
    check(E.same(E.mul(E.G, E.N), E.O), "Wrong group order");
    for (const bad of ["00", "04" + "0".repeat(128), "04" + "f".repeat(128), "02" + "0".repeat(64), {}, ""]) check(await rejects(() => E.decode(bad, true)), "Invalid public point accepted");
    const p = C.player(), signature = await p.sign("test", { n: 1 });
    check(await C.signatureValid(p.publicKey, "test", { n: 1 }, signature) && !await C.signatureValid(p.publicKey, "test", { n: 2 }, signature) && !await C.signatureValid(p.publicKey, "other", { n: 1 }, signature), "Signature domain binding failed");
    p.dispose(); check(await rejects(() => p.sign("test", {})), "Disposed key still signs");
    record("poker protocol: curve arithmetic matches native P-256 and rejects invalid points and signatures", true);
  } catch (e) { record("poker protocol: curve arithmetic matches native P-256 and rejects invalid points and signatures", false, e.stack); return; }
  try {
    let count = 0;
    const exercise = async p => {
      const out = await E.walkNetwork(p.map((_, i) => i), E.route(p), async (pair, swap) => swap ? [pair[1], pair[0]] : pair);
      check(p.every((destination, i) => out[destination] === i), "Permutation was not routed"); count++;
    };
    const perms = function* (a, start = 0) { if (start === a.length) { yield a.slice(); return; } for (let i = start; i < a.length; i++) { [a[start], a[i]] = [a[i], a[start]]; yield* perms(a, start + 1); [a[start], a[i]] = [a[i], a[start]]; } };
    for (let n = 1; n <= 6; n++) for (const p of perms(Array.from({ length: n }, (_, i) => i))) await exercise(p);
    for (let i = 0; i < 64; i++) await exercise(BL.pokerRules.shuffledDeck());
    check(await rejects(() => E.route([0, 0])) && count > 900, "Malformed permutation accepted");
    record("poker protocol: switch routing realizes arbitrary permutations including odd subnetworks", true, `${count} routes`);
  } catch (e) { record("poker protocol: switch routing realizes arbitrary permutations including odd subnetworks", false, e.stack); return; }
  let completedRecord;
  try {
    const started = performance.now(), n = BL.pokerRules.SEATS, identities = Array.from({ length: n }, () => C.player()), handKeys = identities.map(() => C.player());
    const stacks = [1000, 90, 160, 240, 320, 400, 480, 560, 640].slice(0, n), total = stacks.reduce((a, b) => a + b);
    const initial = { game: { seats: identities.map((p, i) => ({ id: p.publicKey, name: "Player " + (i + 1), stack: stacks[i] })), dealer: -1, hand: 0, version: 0 }, counters: [], epoch: 0 };
    const match = M.create(0, initial);
    const request = async (i, op, data) => {
      const state = match.state(), value = { table: 0, signer: identities[i].publicKey, seq: (state.counters.find(([id]) => id === identities[i].publicKey)?.[1] || 0) + 1, op,
        data: { ...(state.context && op !== "start" ? { hand: state.context.nonce, epoch: state.context.epoch } : {}), ...data } };
      return { ...value, signature: await identities[i].sign("command", value) };
    };
    const send = async (i, op, data) => { const req = await request(i, op, data); await match.submit(req); return req; };
    await send(0, "start", { nonce: C.nonce() });
    for (let i = 0; i < n; i++) await send(i, "key", { key: handKeys[i].publicKey, proof: await handKeys[i].sign("hand-key", [match.state().context, identities[i].publicKey]) });
    for (let i = 0; i < n; i++) {
      const s = match.state(), context = await match.shuffleContext(identities[i].publicKey);
      const shuffle = await C.shuffle(s.deck, s.aggregate, context);
      if (!i) {
        const before = match.state().root, broken = clone(shuffle); broken.gates[0].out[0] = broken.gates[0].out[1];
        check(await rejects(async () => match.submit(await request(i, "shuffle", { shuffle: broken }))) && match.state().root === before, "Forged shuffle mutated the hand");
        check(await rejects(() => C.verifyShuffle(s.deck, s.aggregate, ["wrong hand"], shuffle)), "Shuffle proof replayed in another hand");
        check(await rejects(() => C.verifyShuffle(s.deck, s.aggregate, context, { gates: shuffle.gates.slice(1) })), "Truncated proof accepted");
      }
      await send(i, "shuffle", { shuffle });
    }
    check(match.phase === "ack", "Deck was dealt before agreement");
    for (let i = 0; i < n; i++) await send(i, "ack", { root: match.state().ackRoot });
    const holeState = match.state(), ownPosition = holeState.plan.holes[0].positions[0], need = holeState.requested[0].indices;
    const forbidden = need.map(i => [i, []]); forbidden[0] = [ownPosition, await handKeys[0].share(holeState.deck[ownPosition], match.shareContext(identities[0].publicKey, ownPosition))];
    const before = holeState.root;
    check(await rejects(async () => match.submit(await request(0, "shares", { shares: forbidden }))) && match.state().root === before, "Private owner share was accepted before showdown");
    let folded = -1, duplicateChecked = false;
    for (let moves = 0; match.active && moves < 120; moves++) {
      const s = match.state();
      if (["hole", "board", "showdown"].includes(s.phase)) {
        const requested = s.requested.find(r => r.indices.some(i => !s.shares.find(([id]) => id === r.id)?.[1].some(([j]) => j === i)));
        check(!!requested, "No participant can advance dealing");
        const i = identities.findIndex(p => p.publicKey === requested.id), known = new Map(s.shares.find(([id]) => id === requested.id)?.[1] || []), shares = [];
        for (const index of requested.indices.filter(index => !known.has(index))) shares.push([index, await handKeys[i].share(s.deck[index], match.shareContext(requested.id, index))]);
        if (shares.length) {
          const [position, proof] = shares[0];
          check(!await C.shareValid(handKeys[i].publicKey, s.deck[position], ["wrong card context"], proof), "Share accepted under the wrong context");
        }
        await send(i, "shares", { shares });
      } else if (s.phase === "betting") {
        if (folded < 0) {
          const allCards = [];
          for (let i = 0; i < n; i++) {
            const mine = s.plan.holes[i];
            for (const position of mine.positions) {
              const other = s.shares.filter(([id]) => id !== mine.id).map(([, entries]) => new Map(entries).get(position));
              check(other.length === n - 1 && other.every(Boolean), "Missing private dealing share");
              const card = handKeys[i].open(s.deck[position], other); allCards.push(card);
              check(!new Map(s.shares.find(([id]) => id === mine.id)?.[1] || []).has(position), "Owner share leaked during private dealing");
            }
          }
          check(new Set(allCards).size === n * 2 && s.state.seats.every(p => p.cards.every(c => c === null)), "Private hands are not unique and hidden");
          folded = s.state.turn;
          await send(folded, "act", { action: "fold", amount: null, version: s.state.version });
        } else {
          const i = s.state.turn, legal = match.state(identities[i].publicKey).state.legal;
          const req = await send(i, "act", { action: legal.canRaise ? "raise" : legal.check ? "check" : "call", amount: legal.canRaise ? legal.max : null, version: s.state.version });
          if (!duplicateChecked) { const after = match.state().root; await match.submit(req); check(match.state().root === after, "A repeated command spent chips twice"); const altered = clone(req); altered.data.amount = 1; check(await rejects(() => match.submit(altered)), "Altered replay accepted"); duplicateChecked = true; }
        }
      } else throw new Error("Unexpected phase " + s.phase);
    }
    const final = match.state(); completedRecord = match.export();
    check(final.phase === "complete" && final.state.result.pots.length > 3 && final.state.seats.reduce((n, p) => n + p.stack, 0) === total, "Nine-player side pots did not conserve chips");
    check(final.state.seats[folded].cards.every(c => c === null), "Folded cards became public");
    for (const position of final.plan.holes[folded].positions) check(!new Map(final.shares.find(([id]) => id === identities[folded].publicKey)[1]).has(position), "Folded owner's share entered the record");
    const replayed = await M.replay(completedRecord);
    check(C.canonical(replayed.state().state.result) === C.canonical(final.state.result) && replayed.state().root === final.root, "Independent replay disagrees with the payout");
    const changed = clone(completedRecord); changed.events[0].request.data.nonce = C.nonce(); check(await rejects(() => M.replay(changed)), "Changed transcript accepted");
    const sealed = BL.pokerRules.createSealed(initial.game); sealed.start(); sealed.act(sealed.snapshot().seats[sealed.snapshot().turn].id, "raise", 100); sealed.abort();
    check(sealed.snapshot().seats.every((p, i) => p.stack === stacks[i]) && sealed.snapshot().pot === 0, "Canceled commitments were not refunded exactly");
    for (const key of [...identities, ...handKeys]) key.dispose();
    record("poker protocol: nine-player private deal, hostile proofs, side pots, replay and folded-card privacy", true, `${Math.round((performance.now() - started) / 1000)}s; ${JSON.stringify(completedRecord).length} byte public record`);
  } catch (e) { record("poker protocol: nine-player private deal, hostile proofs, side pots, replay and folded-card privacy", false, e.stack); return; }
  // playthrough: two actual worker clients join the HTTP service, jointly shuffle,
  // play to settlement and export a record. This is Node, not a browser assertion.
  const origins = new Set(), service = createPokerServer({ origins });
  const workers = [], states = [], failures = [];
  try {
    await new Promise(resolve => service.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${service.server.address().port}`; origins.add(origin);
    const workerSource = "self.window = self;\n" + protocolSource + "\n" + readFileSync(join(root, "src/js/poker-worker.js"), "utf8");
    const wrapper = `const { parentPort, workerData } = require('node:worker_threads'); const vm = require('node:vm'); const { webcrypto } = require('node:crypto');
      const ctx = { crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, AbortController, URLSearchParams, postMessage: m => parentPort.postMessage(m),
        fetch: (path, options = {}) => fetch(new URL(path, workerData.origin), { ...options, headers: { Origin: workerData.origin, ...options.headers } }) };
      ctx.self = ctx; vm.runInNewContext(workerData.source, ctx); parentPort.on('message', data => ctx.onmessage({ data }));`;
    const waitFor = async (predicate, max = 180000) => { const start = Date.now(); while (!predicate()) { if (failures.length) throw new Error(failures.join("; ")); if (Date.now() - start > max) throw new Error("Worker playthrough timed out: " + states.map(s => s?.fairness.phase).join(",")); await new Promise(r => setTimeout(r, 40)); } };
    for (let i = 0; i < 2; i++) {
      const w = new Worker(wrapper, { eval: true, workerData: { origin, source: workerSource } }); workers.push(w);
      w.on("error", e => failures.push(e.message));
      w.on("message", m => { if (m.type === "state") states[i] = m.packet; if (m.type === "fatal") failures.push(m.message); });
      w.postMessage({ type: "connect", table: 0 });
    }
    await waitFor(() => states.filter(Boolean).length === 2);
    workers[0].postMessage({ type: "action", name: "join", value: { name: "First" } });
    workers[1].postMessage({ type: "action", name: "join", value: { name: "Second" } });
    await waitFor(() => states.every(s => s.tables[0].state.seats.filter(Boolean).length === 2));
    workers[0].postMessage({ type: "action", name: "start" });
    await waitFor(() => states.every(s => s.fairness.phase === "betting"));
    for (let rounds = 0; rounds < 40 && !states.every(s => s.fairness.phase === "complete"); rounds++) {
      const seat = states[0].tables[0].state.turn, actingId = states[0].tables[0].state.seats[seat]?.id, i = states.findIndex(s => s.identity === actingId);
      if (i >= 0 && states[i].tables[0].state.legal) {
        const version = states[i].tables[0].state.version;
        workers[i].postMessage({ type: "action", name: "call", expectedVersion: version });
        await waitFor(() => states.every(s => s.tables[0].state.version !== version));
      }
      await waitFor(() => states.every(s => ["betting", "complete"].includes(s.fairness.phase)));
    }
    check(states.every(s => s.fairness.phase === "complete" && s.tables[0].state.seats.filter(Boolean).reduce((n, p) => n + p.stack, 0) === 2000), "HTTP clients did not finish the same hand");
    check(states[0].fairness.root === states[1].fairness.root, "Clients disagreed about the hand fingerprint");
    const denied = await fetch(origin + "/poker/api/command", { method: "POST", headers: { Origin: "https://unrelated.invalid", "Content-Type": "application/json" }, body: "{}" });
    check(denied.status === 403, "Cross-origin mutation was accepted");
    const unauth = await fetch(origin + "/poker/api/state?table=0"); check(unauth.status === 401, "Unauthenticated session data exposed");
    record("poker protocol: real HTTP worker clients complete a hand and enforce connection boundaries", true);
  } catch (e) { record("poker protocol: real HTTP worker clients complete a hand and enforce connection boundaries", false, e.stack); }
  finally { for (const w of workers) await w.terminate(); service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); }
  try {
    let time = 0; const origins = new Set(), service = createPokerServer({ origins, clock: () => time });
    const identities = [C.player(), C.player()], tokens = [];
    try {
      await new Promise(resolve => service.server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${service.server.address().port}`; origins.add(origin);
      const post = (path, body, token) => fetch(origin + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
      for (const identity of identities) { const nonce = C.nonce(), r = await post("/poker/api/session", { publicKey: identity.publicKey, nonce, signature: await identity.sign("connect", nonce) }); tokens.push((await r.json()).token); }
      const request = async (i, seq, op, data) => { const value = { table: 0, signer: identities[i].publicKey, seq, op, data }; return { ...value, signature: await identities[i].sign("command", value) }; };
      for (let i = 0; i < 2; i++) check((await post("/poker/api/command", await request(i, 1, "join", { name: "Timeout" }), tokens[i])).ok, "Join failed");
      const start = await request(0, 2, "start", { nonce: C.nonce() }); check((await post("/poker/api/command", start, tokens[0])).ok, "Start failed");
      time = 80000; check((await post("/poker/api/command", start, tokens[0])).ok, "Idempotent retry failed");
      time = 90001; await service.sweep();
      const state = service.tables[0].state(); check(state.phase === "idle" && state.state.seats.every(s => !s), "Missing key contributors were not evicted after refund");
      const response = await fetch(origin + `/poker/api/state?table=0&hand=${start.data.nonce}&from=0`, { headers: { Authorization: "Bearer " + tokens[0] } });
      const canceled = (await response.json()).previous, replay = await M.replay(canceled);
      check(replay.phase === "aborted" && replay.state().state.seats.filter(Boolean).every(s => s.stack === 1000), "Cancellation record lost the exact refunds");
      const cooldown = await post("/poker/api/command", await request(0, 3, "start", { nonce: C.nonce() }), tokens[0]); check(!cooldown.ok, "Timed-out participant immediately restarted");
      const spoof = await post("/poker/api/command", await request(1, 2, "refill", {}), tokens[0]); check(!spoof.ok, "A connection impersonated another signer");
    } finally { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); for (const p of identities) p.dispose(); }
    record("poker protocol: timeouts refund chips, repeated requests cannot stall, and signers cannot be impersonated", true);
  } catch (e) { record("poker protocol: timeouts refund chips, repeated requests cannot stall, and signers cannot be impersonated", false, e.stack); }
};

const unitChecks = async () => {
  const canvasStub = () => ({
    width: 0, height: 0,
    getContext: () => ({
      canvas: null, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
      setTransform() {}, translate() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {},
      closePath() {}, fill() {}, stroke() {}, arc() {}, rect() {}, clip() {},
      measureText: () => ({ width: 0 }), fillText() {}, strokeText() {}, createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
      putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
    })
  });
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], firstElementChild: null, textContent: "", hidden: false,
    appendChild(c) { this.children.push(c); return c; }, append() {}, replaceChildren() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {},
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), focus() {}, blur() {}
  });
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.document = {
    createElement: (tag) => (tag === "canvas" ? Object.assign(el(), canvasStub()) : el()),
    createElementNS: () => el(),
    getElementById: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    documentElement: el(), body: el(),
    getElementsByTagName: () => []
  };
  globalThis.location = { search: "", pathname: "/", replace() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.devicePixelRatio = 1;
  if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: (a) => a.fill(1) } });

  const order = [...readFileSync(join(root, "src/index.html"), "utf8").matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  const skipped = [];
  for (const file of order) {
    try {
      new Function(readFileSync(join(root, "src/js", file), "utf8"))();
    } catch (err) {
      skipped.push(`${file}: ${String(err.message).slice(0, 120)}`);
    }
  }
  const BL = globalThis.BL;
  pokerChecks(BL);
  {
    // Analytic half-spaces are an independent normal oracle: an incoming
    // bearing, even 70 degrees off, must not become the climbing direction.
    const rows = [], normal = 0.73, nx = Math.sin(normal), nz = Math.cos(normal);
    for (const angle of [-70, -45, -20, 0, 20, 45, 70]) for (const rim of [false, true]) {
      const panels = BL.wallPanels.create((x, y, z) => x * nx + z * nz >= (rim && y > 1 ? -0.25 : 0));
      const panel = {}, fitted = panels.fit(-nx * 0.87, 0, -nz * 0.87, normal + angle * Math.PI / 180, panel);
      const error = fitted ? Math.abs(Math.atan2(Math.sin(panel.heading - normal), Math.cos(panel.heading - normal))) : Infinity;
      let coordinates = false;
      if (fitted) {
        const point = {};
        panels.point(panel, 3.25, -2.4, -0.87, point);
        panels.coordinates(panel, point.x, point.y, point.z);
        coordinates = Math.abs(panel.u - 3.25) < 1e-9 && Math.abs(panel.v + 2.4) < 1e-9 && Math.abs(panel.depth + 0.87) < 1e-9;
      }
      rows.push({ angle, rim, fitted, error, coordinates });
    }
    const opening = BL.wallPanels.create((x, y, z) => z >= 0 && (Math.abs(x) > 1.5 || y < -1 || y > 3));
    const narrow = BL.wallPanels.create((x, y, z) => z >= 0 && Math.abs(x) < 0.25);
    record("gorilla wall panels: oblique contacts face the measured plane; ledges change depth without changing yaw; openings cannot fabricate grips",
      rows.every(row => row.fitted && row.error < 0.012 && row.coordinates)
        && !opening.fit(0, 0, -0.87, 0, {}) && !narrow.fit(0, 0, -0.87, 0, {}), JSON.stringify(rows));
  }
  {
    // A repeated 0.75-high tread has a 1.25 grade despite its vertical voxel
    // faces. The same local rise beside a real cliff must not waive climbing.
    const stairs = (x, z) => 10 + Math.floor(z / 0.6) * 0.75;
    const rows = [];
    for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const heading = angle * Math.PI / 180, plane = {};
      const ramp = BL.wallPanels.rampAt(stairs, 0, stairs(0, 1.23), 1.23, heading, plane);
      rows.push({ angle, ramp, along: plane.groundZ, across: plane.groundX,
        correct: ramp && Math.abs(plane.groundZ - Math.cos(heading) * 1.25) < 0.2
          && Math.abs(plane.groundX + Math.sin(heading) * 1.25) < 0.2 });
    }
    const crest = (x, z) => 10 + Math.min(3, Math.max(0, Math.floor(z / 0.6) * 0.75));
    const cliff = (x, z) => z < 0.6 ? 10 : 16;
    const tooSteep = (x, z) => 10 + Math.floor(z / 0.25) * 0.75;
    const opening = (x, z) => z < 2 ? stairs(x, z) : NaN;
    record("gorilla terrain ramps: reachable terraces tilt uphill, downhill and sideways; abrupt cliffs, openings and overhead roofs retain wall handling",
      rows.every(row => row.correct)
        && BL.wallPanels.rampAt(crest, 0, crest(0, 0.1), 0.1, 0, {})
        && BL.wallPanels.rampAt(crest, 0, crest(0, 2), 2, 0, {})
        && !BL.wallPanels.rampAt(cliff, 0, 10, 0, 0, {})
        && !BL.wallPanels.rampAt(tooSteep, 0, tooSteep(0, 1), 1, 0, {})
        && !BL.wallPanels.rampAt(opening, 0, stairs(0, 1), 1, 0, {})
        && !BL.wallPanels.rampAt(stairs, 0, stairs(0, 1) - 3, 1, 0, {})
        && !BL.wallPanels.rampAt(() => 10, 0, 10, 0, 0, {}), JSON.stringify(rows));
  }
  {
    // Independent ECC-M matrix fingerprints from Project Nayuki's reference encoder,
    // forced to the selected mask. Covers long invoices through maximum capacity.
    const fixtures = [[10,1,1471854537],[200,10,201264220],[250,11,3408431571],[340,14,4015936575],[500,17,1072042424],[666,20,2628850123],[1000,26,4139649153],[1800,35,1046637826],[2331,40,2741459166]];
    const rows = fixtures.map(([length, version, expected]) => { const code = BL.qr.encode("lnbc1" + "q".repeat(length - 5)); let hash = 2166136261; for (const bit of code.modules) hash = Math.imul(hash ^ bit, 16777619); return { length, version: code.version, pass: code.version === version && (hash >>> 0) === expected }; });
    let rejected = false; try { BL.qr.encode("q".repeat(2332)); } catch (error) { rejected = error instanceof RangeError; }
    record("QR invoices: matrices match independent reference at short and long capacities", rows.every(r => r.pass) && rejected, JSON.stringify(rows));
  }
  factoryChecks(BL);
  await characterChecks(); await contributorActivityChecks(); await mempoolFeedChecks(); await debugActivityStatusChecks(); await soloDebugChecks(); await adaptiveQualityChecks(); await chainSnapshotChecks(); await dsbSharedDataChecks(); await timechainDataChecks(); await weatherStepChecks(); await gameRulesChecks();

  // Scene state built directly instead of booted; seed 1 matches scene-hub.js.
  // Sealed cave guides need the hub's seal nodes, so probes reading them stay in the browser tier.
  const island = BL.terrain.island({ seed: 1 });
  {
    const expected = {
      c11: [6.25, 0.75, 6.75], c10: [6.25, 0.75, 6.75], c9: [7, 0.5, 6.75],
      c1: [6.25, 0.75, 6.75], c2: [6.25, 0.75, 6.75], c3: [7, 0.5, 6.75]
    };
    const column = { caveIndex: 0, floor: 0, ceiling: 0 }, rows = [];
    for (let caveIndex = 0; caveIndex < island.mouths.length; caveIndex++) {
      const mouth = island.mouths[caveIndex], shape = expected[mouth.id];
      if (!shape) continue;
      const room = mouth.room, sr = Math.sin(mouth.ry), cr = Math.cos(mouth.ry);
      const at = (across, along) => ({ x: mouth.x + cr * across - sr * along, z: mouth.z - sr * across - cr * along });
      let samples = 0, owned = true, clear = true, enclosed = true;
      for (let along = room.from + 0.5; along <= room.to - 0.5 + 1e-7; along += 0.5) for (const across of [-room.w / 2 + 0.5, 0, room.w / 2 - 0.5]) {
        const p = at(across, along), cavity = island.cavityAt(p.x, p.z, column, caveIndex + 1, 1);
        owned = owned && cavity && column.caveIndex === caveIndex + 1 && column.floor === 0 && column.ceiling === room.h;
        clear = clear && island.clearAt(p.x, 0.05, p.z, 0.3, room.h - 0.25);
        enclosed = enclosed && island.solidAt(p.x, -0.125, p.z) && island.solidAt(p.x, room.h + 0.49, p.z);
        samples++;
      }
      const middle = (room.from + room.to) / 2;
      const walls = [at(-room.w / 2 - 0.5, middle), at(room.w / 2 + 0.5, middle), at(0, room.to + 0.5)];
      const sweepFrom = at(0, -1.4), sweepTo = at(0, room.to - 0.5);
      rows.push({ id: mouth.id, dimensions: room.w === shape[0] && room.h === 4 && room.from === shape[1] && room.to === shape[2], samples, owned, clear, enclosed,
        swept: island.voxelSegmentClearAt(sweepFrom.x, 0.05, sweepFrom.z, sweepTo.x, 0.05, sweepTo.z, 0.3, 1.7), walls: walls.every((p) => island.solidAt(p.x, 1, p.z)) });
    }
    const ramps = island.mouths.filter((mouth) => mouth.id === "c730" || mouth.id === "c5");
    record("surface caves: every non-HQ mouth uses a terrain-fitted full-height carved chamber with owned air, solid floors, roofs and enclosing walls", rows.length === 6 && [...new Set(rows.map((row) => row.id))].sort().join() === Object.keys(expected).sort().join()
      && rows.every((row) => row.dimensions && row.samples === 33 && row.owned && row.clear && row.enclosed && row.swept && row.walls)
      && ramps.length === 2 && ramps.every((mouth) => mouth.room.w === 6 && mouth.room.h === 4 && mouth.room.from === 2.5 && mouth.room.to === 6.5), JSON.stringify({ rows, ramps: ramps.map((mouth) => ({ id: mouth.id, room: mouth.room })) }));
  }
  {
    // Contract: both directions use the production swept aperture and wall-clock cycle.
    const get = document.getElementById, listen = window.addEventListener, unlisten = window.removeEventListener;
    document.getElementById = () => { const node = el(); node.querySelector = () => el(); return node; };
    window.addEventListener = window.removeEventListener = () => {};
    let time = 0, crossings = 0;
    const gate = BL.oogaPortal.create({ radius: 2.2, outerRadius: 2.5, position: { x: 0, y: 2, z: 28 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 }, now: () => time, destinations: [{ id: "hub", enabled: true }], onTraverse: () => crossings++ });
    const from = { x: 0, y: 1, z: 20 }, to = { x: 0, y: 1, z: 60 };
    const off = !gate.traverse(from, to, 0.8), activated = gate.activate(0), duplicate = !gate.activate(0), warming = !gate.traverse(from, to, 0.8);
    time = 1999; gate.update(); const activation = gate.state === "ACTIVATING";
    time = 2000; gate.update(); const active = gate.state === "ACTIVE";
    const wrong = !gate.traverse(to, from, 0.8), outside = !gate.traverse({ ...from, x: 3 }, { ...to, x: 3 }, 0.8);
    const swept = gate.traverse(from, to, 0.8), once = !gate.traverse(from, to, 0.8);
    time = 11999; gate.update(); const fullWindow = gate.state === "ACTIVE";
    time = 12000; gate.update(); const shutdown = gate.state === "SHUTDOWN" && !gate.traverse(from, to, 0.8);
    time = 12450; gate.update(); const expired = gate.state === "OFF" && !gate.traverse(from, to, 0.8);
    record("Ooga Portal return: directional swept front crossing, exact deadlines and one-use cycle", off && activated && duplicate && warming && activation && active && wrong && outside && swept && once && fullWindow && shutdown && expired && crossings === 1);
    gate.receive(); time += 60000; gate.update(); const receiving = gate.receiving && gate.state === "ACTIVE" && !gate.activate(0);
    gate.finishReceiving(true); const fading = gate.state === "SHUTDOWN";
    time += 450; gate.update();
    record("Ooga Portal receiving: host owns duration then restores reusable outbound cycle", receiving && fading && !gate.receiving && gate.state === "OFF" && gate.activate(0));
    gate.dispose();
    document.getElementById = get; window.addEventListener = listen; window.removeEventListener = unlisten;
  }
  {
    // Regression: all canonical physical bodies fit DSB's portal and landmark lanes.
    const S = BL.scene, root = S.createNode(), noop = () => {};
    const crew = BL.crew.create({ root, world: { level: 0 }, input: { add: noop, remove: noop }, hud: { setRosterRow: noop }, game: { state: { assignments: {}, inventory: [] } }, pile: { footprintEdge: 1, pileEdge: () => 1 }, viewYaw: 0, buildSpots: [], walkIn: { x: 0, z: 3 }, groundAt: () => 0, walkable: () => true, bedrolls: BL.contributors.roster.map((_, i) => ({ x: 30 + i * 2, y: 0, z: 30, hidden: true })), fx: { say: noop, zzzAt: noop, burst: noop, puff: noop, spawnParticle: noop, damageNumber: noop } });
    const get = document.getElementById, listen = window.addEventListener, unlisten = window.removeEventListener;
    document.getElementById = () => { const node = el(); node.querySelector = () => el(); return node; };
    window.addEventListener = window.removeEventListener = () => {};
    const apertures = [];
    for (const actor of crew.cavemen.values()) {
      let count = 0;
      const gate = BL.oogaPortal.create({ radius: 2.2, outerRadius: 2.5, position: { x: 0, y: 2, z: 0 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 }, receiving: true, onTraverse: () => count++ });
      const back = { x: 0, y: actor.bodyHeight / 2, z: 25 }, front = { x: 0, y: actor.bodyHeight / 2, z: -0.1 };
      const wrong = !gate.traverse(front, back, actor.bodyRadius, -1), outside = !gate.traverse({ ...back, x: 3 }, { ...front, x: 3 }, actor.bodyRadius, -1);
      const accepted = gate.traverse(back, front, actor.bodyRadius, -1), once = !gate.traverse(back, front, actor.bodyRadius, -1);
      gate.finishReceiving(); const closed = gate.state === "OFF"; gate.dispose();
      apertures.push({ name: actor.traits.name, pass: wrong && outside && accepted && once && closed && count === 1 });
    }
    document.getElementById = get; window.addEventListener = listen; window.removeEventListener = unlisten;
    record("Ooga Portal transit regression: all canonical bodies retain one-way backside aperture and finish OFF", apertures.length === CAST && apertures.every(row => row.pass), JSON.stringify(apertures));
    const land = BL.dsbModels.build(), landmarks = Object.values(land.landmarks), routes = [
      [[0, 7], [0, 26]], [[0, 26], [0, 33]], [[0, 26], [3.7, 25.6]], [[0, 21], [7, 24]],
      [[0, 18], [-10.5, 18]], [[0, 18], [10.5, 18]]
    ];
    const layout = [];
    S.updateWorld(land.root);
    for (const actor of crew.cavemen.values()) {
      let clear = true;
      for (const [a, b] of routes) for (let i = 0; i <= 128; i++) {
        const x = a[0] + (b[0] - a[0]) * i / 128, z = a[1] + (b[1] - a[1]) * i / 128;
        clear &&= landmarks.every(l => l.clearAt(x, z, actor.bodyRadius));
      }
      for (const l of landmarks) {
        const p = l.point(); clear &&= l.clearAt(p.x, p.z, actor.bodyRadius) && l.near(p);
        clear &&= !l.clearAt(l.node.position.x, l.node.position.z, actor.bodyRadius);
        clear &&= l.clearAt(-20, 13, actor.bodyRadius) && l.clearAt(-10, 13, actor.bodyRadius) && !l.near({ x: -20, z: 13 }) && !l.near({ x: -10, z: 13 });
        // Independent scene matrices verify the helper uses the rendered orientation.
        const w = l.node.world; clear &&= Math.hypot(p.x - (w[8] * 3.5 + w[12]), p.z - (w[10] * 3.5 + w[14])) < 1e-5;
        const edge = l.point(l.width + actor.bodyRadius + 0.1, 0, 0), inside = l.point(l.width - 0.1, 0, 0);
        clear &&= l.clearAt(edge.x, edge.z, actor.bodyRadius) && !l.clearAt(inside.x, inside.z, actor.bodyRadius);
      }
      layout.push({ name: actor.traits.name, clear });
    }
    record("DSB plaza: all canonical bodies clear transformed fronts and travel lanes with old footprints removed", layout.length === CAST && layout.every(row => row.clear), JSON.stringify(layout));
    crew.dispose();
  }
  const rockGuides = BL.rockGuides.create({ island, sealed: [] });
  globalThis.__ooga = { island, headquarters: { rockGuides } };

  const backends = ["webgl2"];

  {
    const S = BL.scene, root = S.createNode(), box = x => BL.models.box({ w: 0.25, h: 0.25, d: 0.25, offset: { x }, color: "#ffffff" });
    const geometry = BL.models.merge(box(-1), box(1)), first = S.createNode({ geometry }), second = S.createNode({ geometry });
    S.addChild(root, first, second);
    const contacts = BL.weaponTargets.create([{ node: first, owner: {} }, { node: second, owner: {} }]);
    contacts.register(first); contacts.register(second);
    const before = BL.math.mat4.create(), after = BL.math.mat4.create(), out = {};
    const club = BL.models.box({ w: 3, h: 0.125, d: 0.125, color: "#ffffff" });
    before[14] = 2;
    const hit = contacts.strike(out, before, after, club), selected = out.node === first, point = [out.distance, out.x, out.y, out.z];
    const repeated = contacts.strike(out, before, after, club) && out.node === first && [out.distance, out.x, out.y, out.z].every((value, i) => value === point[i]);
    record("weapon contacts: equal-distance sweeps retain original triangle and target order with repeatable contact points", hit && selected && point[1] < 0 && repeated, JSON.stringify({ hit, selected, point, repeated }));
  }

  {
    const make = () => BL.models.caveman(BL.contributors.traitsFor("w-s-bitcoin")), a = make(), b = make();
    const keys = ["gun", "fingersL", "fingersR"], quaternions = keys.map(key => Array.from(b.parts[key].quaternion));
    const banana = { visible: b.parts.gunBananas[0].visible, scale: { ...b.parts.gunBananas[0].scale } };
    const independent = a.root !== b.root && a.parts.gunBody.geometry === b.parts.gunBody.geometry
      && a.parts.gunBananas !== b.parts.gunBananas && a.parts.gunBananas.length === 9
      && b.parts.gunBananas.every((node, i) => node !== a.parts.gunBananas[i] && node.parent === b.parts.gun)
      && keys.every(key => a.parts[key].quaternion !== b.parts[key].quaternion);
    for (const key of keys) a.parts[key].quaternion.fill(0.3);
    a.parts.gunBananas[0].visible = !banana.visible; a.parts.gunBananas[0].scale.x = 7;
    a.root.position.x = 42;
    const c = make(), fresh = [b, c].every(model => model.root.position.x === 0
      && keys.every((key, i) => Array.from(model.parts[key].quaternion).every((value, j) => value === quaternions[i][j]))
      && model.parts.gunBananas[0].visible === banana.visible && Object.keys(banana.scale).every(key => model.parts.gunBananas[0].scale[key] === banana.scale[key]));
    record("caveman cache: clones share immutable geometry while owning fresh gun arrays, quaternions and transforms", independent && fresh && c.gunHeadBounds === BL.scene.boundsOf(c.headOpen), JSON.stringify({ independent, fresh, gunBananas: c.parts.gunBananas.length }));
  }
  {
    const S = BL.scene, root = S.createNode(), panel = S.createNode({ geometry: BL.hubModels.mirrorPanel(), mirror: true });
    S.addChild(root, panel); const original = panel.geometry, damage = BL.mirrorDamage.create(panel), nodes = [...root.children];
    const limit = BL.mirrorDamage.DEBRIS_LIMIT;
    const ignored = !damage.hit(0, 0, 0, 0) && !damage.hit(-1, 0, 0, 0) && damage.damage === 0 && panel.geometry === original;
    damage.hit(2, 0.2, 0.1, 0); const firstSeams = damage.seams, firstHoles = damage.holes;
    const edges = nodes[1].geometry;
    let firstCrackArea = 0;
    for (const face of edges.faces) {
      let area = 0;
      for (let i = 0, j = face.i.length - 1; i < face.i.length; j = i++) {
        const a = face.i[j] * 3, b = face.i[i] * 3;
        area += edges.verts[a] * edges.verts[b + 1] - edges.verts[b] * edges.verts[a + 1];
      }
      firstCrackArea += Math.abs(area) * 0.5;
    }
    const rows = [];
    for (const power of [BL.mirrorDamage.PANEL_DAMAGE - 2, 2, 6, (BL.mirrorDamage.PANEL_LIMIT - 1) * BL.mirrorDamage.PANEL_HEALTH, BL.mirrorDamage.MAX_DAMAGE]) {
      damage.hit(power, 0.2, 0.1, 0);
      const live = new Set(); damage.liveGeometry(live);
      rows.push({ stage: damage.stage, seams: damage.seams, active: damage.active, holes: damage.holes, minimumHealth: Math.min(...damage.panelHealth), live: live.size, nodes: root.children.length });
    }
    const shards = nodes.filter(node => node.mirrorShard === panel), floor = S.boundsOf(original).min[1];
    const reflective = shards.every(node => node.geometry && node.geometry.mirrorSource.length === node.geometry.verts.length);
    let falling = false, landed = false, faded = false, belowGround = false;
    const point = new Float64Array(3);
    for (let tick = 0; tick < 360; tick++) {
      damage.update(1 / 120); S.updateWorld(root);
      for (const shard of shards) {
        if (!shard.visible) continue;
        if (shard.rotation.x !== -Math.PI / 2 || shard.rotation.z !== 0) falling = true;
        else {
          landed = true;
          for (let i = 0; i < shard.geometry.verts.length; i += 3) {
            const v = shard.geometry.verts; BL.math.mat4.transformPoint(point, shard.world, v[i], v[i + 1], v[i + 2]);
            if (point[1] < floor - 1e-7) belowGround = true;
          }
        }
        if (shard.smokeOpacity > 0 && shard.smokeOpacity < 1 && shard.scale.x === 1) faded = true;
      }
    }
    const settled = damage.active === 0 && shards.every(node => !node.visible);
    damage.dispose();
    record("mirror damage: one hundred crack damage precedes eight-health panels, with bounded reflective debris, flat landings above support, fade and complete disposal", ignored && firstSeams >= 40 && firstHoles === 0 && firstCrackArea > 0.03 && rows[0].active === 0 && rows[0].live === 3 && rows[0].seams > firstSeams && rows[1].active === 0 && rows[1].minimumHealth === 6 && rows[2].holes === 1 && rows[2].active === 1 && rows.every(row => row.active <= limit && row.live <= limit + 3 && row.nodes === limit + 2) && shards.length === limit && rows[3].active === limit && reflective && falling && landed && faded && !belowGround && settled && damage.damage === BL.mirrorDamage.MAX_DAMAGE && root.children.length === 1 && root.children[0] === panel && panel.geometry === original && panel.mirrorDamage === null && panel.mirrorCaptureGeometry === null && nodes.slice(1).every(node => node.parent === null), JSON.stringify({ ignored, limit, firstSeams, firstHoles, firstCrackArea, rows, reflective, falling, landed, faded, belowGround, settled, children: root.children.length }));
  }
  {
    const S = BL.scene, make = () => {
      const root = S.createNode(), panel = S.createNode({ geometry: BL.hubModels.mirrorPanel(), mirror: true });
      S.addChild(root, panel); return { root, panel, damage: BL.mirrorDamage.create(panel) };
    };
    const present = (geo, x, y, source = false) => {
      const v = source ? geo.mirrorSource : geo.verts;
      return geo.faces.some(face => {
        if (source && geo.verts[face.i[0] * 3 + 2] !== 0) return false;
        for (let i = 0, j = face.i.length - 1; i < face.i.length; j = i++) {
          const a = face.i[j] * 3, b = face.i[i] * 3;
          if ((v[b] - v[a]) * (y - v[a + 1]) - (v[b + 1] - v[a + 1]) * (x - v[a]) < -1e-8) return false;
        }
        return true;
      });
    };
    const health = make(), healthArray = health.damage.panelHealth;
    const scattered = [], aim = {}, repeated = {};
    for (let sample = 0; sample < 8; sample++) {
      health.damage.aimCenter(aim, 0, 0, 0, sample);
      health.damage.aimCenter(repeated, 1, 1, 0, sample);
      scattered.push({ x: aim.x, y: aim.y, present: health.damage.contains(aim.x, aim.y), stable: aim.x === repeated.x && aim.y === repeated.y && aim.z === repeated.z });
    }
    health.damage.hit(BL.mirrorDamage.PANEL_DAMAGE, 0.2, 0.1, 0);
    const crackedVertices = Array.from(health.panel.geometry.verts), allCracked = health.damage.crackDamage === 80 && !health.damage.holes && healthArray.every(value => value === 8);
    health.damage.hit(2, 0.2, 0.1, 0);
    const halfHealth = Array.from(healthArray), halfIntact = !health.damage.holes && !health.damage.active && crackedVertices.every((value, i) => value === health.panel.geometry.verts[i]);
    health.damage.hit(6, 0.2, 0.1, 0);
    const roundBreak = health.damage.holes === 1 && health.damage.active === 1 && healthArray.filter(value => value === 0).length === 1;
    health.damage.dispose();
    const charged = make(); charged.damage.hit(BL.mirrorDamage.PANEL_DAMAGE, 0.2, 0.1, 0); charged.damage.hit(10, 0.2, 0.1, 0);
    const chargedHealth = Array.from(charged.damage.panelHealth), brokenIndex = chargedHealth.indexOf(0), woundedIndex = chargedHealth.indexOf(6);
    const chip = charged.root.children.find(node => node.visible && node.mirrorShard === charged.panel), chipGeometry = chip.geometry, cx = chip.position.x, cy = chip.position.y;
    const panelAim = {}, aimedAtSurvivor = charged.damage.aimCenter(panelAim, cx, cy, 0, 7)
      && charged.damage.contains(panelAim.x, panelAim.y) && Math.hypot(panelAim.x - cx, panelAim.y - cy) > 1e-5;
    const paneArea = (geo, source = false) => {
      const v = source ? geo.mirrorSource : geo.verts; let total = 0;
      for (const face of geo.faces) {
        if (source && geo.verts[face.i[0] * 3 + 2] !== 0) continue;
        let px = 0, py = 0, area = 0;
        for (let i = 0, j = face.i.length - 1; i < face.i.length; j = i++) {
          const a = face.i[j] * 3, b = face.i[i] * 3;
          px += v[b]; py += v[b + 1]; area += v[a] * v[b + 1] - v[b] * v[a + 1];
        }
        if (source || present(chipGeometry, px / face.i.length, py / face.i.length, true)) total += Math.abs(area) * 0.5;
      }
      return total;
    };
    const fullArea = paneArea(chipGeometry, true);
    charged.damage.update(BL.mirrorDamage.HEAL_DELAY + 1 / BL.mirrorDamage.PANEL_HEAL_RATE);
    const recovered = charged.damage.panelHealth[brokenIndex], woundedRecovered = charged.damage.panelHealth[woundedIndex], areaFraction = paneArea(charged.panel.geometry) / fullArea;
    const regrownVertices = Array.from(charged.panel.geometry.verts);
    charged.damage.hit(0.4, cx, cy, 0);
    const partialHealth = charged.damage.panelHealth[brokenIndex], extentRetained = regrownVertices.length === charged.panel.geometry.verts.length && regrownVertices.every((value, i) => value === charged.panel.geometry.verts[i]);
    charged.damage.hit(partialHealth, cx, cy, 0);
    const fallen = charged.root.children.filter(node => node.visible && node.mirrorShard === charged.panel), fallenArea = fallen.reduce((sum, node) => sum + paneArea(node.geometry, true), 0) / fullArea;
    const proportionalBreak = charged.damage.panelHealth[brokenIndex] === 0 && charged.damage.panelHealth[woundedIndex] === woundedRecovered && !charged.damage.contains(cx, cy);
    charged.damage.dispose();
    record("mirror damage: intact glass gets varied stable shot targets and auto aim through a hole resolves to surviving glass", scattered.every(hit => hit.present && hit.stable) && new Set(scattered.map(hit => `${hit.x},${hit.y}`)).size === scattered.length && Math.max(...scattered.map(hit => hit.x)) - Math.min(...scattered.map(hit => hit.x)) > 1 && Math.max(...scattered.map(hit => hit.y)) - Math.min(...scattered.map(hit => hit.y)) > 1 && aimedAtSurvivor, JSON.stringify({ scattered, aimedAtSurvivor, panelAim, hole: [cx, cy] }));
    record("mirror damage: each panel has eight health, charged overflow reaches the next panel, and regrown area restores matching fractional health", BL.mirrorDamage.PANEL_DAMAGE === 100 && BL.mirrorDamage.PANEL_HEALTH === 8 && BL.mirrorDamage.PANEL_LIMIT === 50 && BL.mirrorDamage.MAX_DAMAGE === 500 && healthArray === health.damage.panelHealth && allCracked && halfIntact && halfHealth.filter(value => value === 6).length === 1 && halfHealth.every(value => value === 8 || value === 6) && roundBreak && chargedHealth.filter(value => value === 0).length === 1 && chargedHealth.filter(value => value === 6).length === 1 && Math.abs(recovered - 1) < 1e-9 && Math.abs(woundedRecovered - 7) < 1e-9 && Math.abs(areaFraction - recovered / BL.mirrorDamage.PANEL_HEALTH) < 1e-6 && Math.abs(partialHealth - 0.6) < 1e-9 && extentRetained && proportionalBreak && fallen.length === 1 && Math.abs(fallenArea - areaFraction) < 1e-6, JSON.stringify({ allCracked, halfHealth, halfIntact, roundBreak, chargedHealth, recovered, woundedRecovered, areaFraction, partialHealth, extentRetained, proportionalBreak, fallen: fallen.length, fallenArea }));
    const crackedReference = make(); crackedReference.damage.hit(BL.mirrorDamage.PANEL_DAMAGE, 0.2, 0.1, 0);
    const crackedTemplate = crackedReference.panel.geometry; crackedReference.damage.dispose();
    const otherImpact = make(); otherImpact.damage.hit(BL.mirrorDamage.PANEL_DAMAGE, -1.4, 0.8, 0);
    const fixedLayout = JSON.stringify(otherImpact.panel.geometry.verts) === JSON.stringify(crackedTemplate.verts)
      && JSON.stringify(otherImpact.panel.geometry.faces) === JSON.stringify(crackedTemplate.faces);
    otherImpact.damage.dispose();
    const repaired = make(), repairDamage = BL.mirrorDamage.PANEL_DAMAGE + 64, panelTime = BL.mirrorDamage.PANEL_HEALTH / BL.mirrorDamage.PANEL_HEAL_RATE;
    repaired.damage.hit(repairDamage, 0.2, 0.1, 0);
    const centers = repaired.root.children.filter(node => node.visible && node.mirrorShard === repaired.panel).map(node => {
      const x = node.position.x, y = node.position.y, v = crackedTemplate.verts;
      let far = -1, ex = x, ey = y;
      // A bulk hit drops the formerly intact pane; its original tips extend
      // into future cracks. Measure growth toward the actual cracked border.
      for (const face of crackedTemplate.faces) {
        let cx = 0, cy = 0;
        for (const index of face.i) { cx += v[index * 3]; cy += v[index * 3 + 1]; }
        if (!present(node.geometry, cx / face.i.length, cy / face.i.length, true)) continue;
        for (const index of face.i) {
          const i = index * 3, d = (v[i] - x) ** 2 + (v[i + 1] - y) ** 2;
          if (d > far) { far = d; ex = x + (v[i] - x) * 0.7; ey = y + (v[i + 1] - y) * 0.7; }
        }
      }
      return { x, y, ex, ey };
    });
    const repairState = () => ({ damage: repaired.damage.damage, holes: repaired.damage.holes, cracks: repaired.damage.cracks, version: repaired.damage.version,
      centers: centers.filter(p => repaired.damage.contains(p.x, p.y)).length, edges: centers.filter(p => repaired.damage.contains(p.ex, p.ey)).length });
    const empty = repairState(); repaired.damage.update(BL.mirrorDamage.HEAL_DELAY - 0.01);
    const quiet = repairState(); repaired.damage.update(0.01 + panelTime * 0.25);
    const quarter = repairState(); repaired.damage.update(panelTime * 0.5);
    const threeQuarter = repairState(); repaired.damage.update(panelTime * 0.25 + 0.001);
    const panes = repairState(); repaired.damage.update(BL.mirrorDamage.CRACK_HEAL_TIME * 0.5);
    const cracks = repairState(); repaired.damage.update(BL.mirrorDamage.CRACK_HEAL_TIME * 0.5 + 0.01);
    const restored = repairState(); repaired.damage.dispose();
    record("mirror damage: pane borders are independent of the first impact and every missing pane grows from its fixed center before cracks seal", fixedLayout && centers.length > 0 && empty.holes === centers.length && !empty.centers && !empty.edges && quiet.version === empty.version && quiet.damage === empty.damage
      && quarter.centers === centers.length && !quarter.edges && quarter.holes === empty.holes && quarter.cracks === empty.cracks && quarter.damage < empty.damage
      && threeQuarter.centers === centers.length && threeQuarter.edges === centers.length && threeQuarter.damage < quarter.damage && threeQuarter.cracks === empty.cracks
      && !panes.holes && panes.edges === centers.length && panes.cracks === empty.cracks && !cracks.holes && cracks.cracks > 0 && cracks.cracks < panes.cracks
      && !restored.damage && !restored.holes && !restored.cracks, JSON.stringify({ fixedLayout, count: centers.length, empty, quiet, quarter, threeQuarter, panes, cracks, restored }));
    const brokenRepairs = [];
    for (const mode of ["closed", "open", "restored"]) {
      const m = make(), original = m.panel.geometry;
      if (mode === "restored") m.damage.restore();
      else m.damage.hit(BL.mirrorDamage.MAX_DAMAGE, -1.4, 0.8, 0);
      const version = m.damage.version;
      m.damage.update(119, mode !== "open");
      const waiting = m.damage.broken && m.damage.damage === BL.mirrorDamage.MAX_DAMAGE && m.damage.version === version && !m.panel.geometry.faces.length;
      m.damage.update(mode === "open" ? 240 : 1, mode !== "open");
      const delay = m.damage.broken && m.damage.version === version;
      m.damage.update(panelTime * 0.25, true);
      const growing = !m.damage.broken && m.damage.panelHealth.every(hp => hp === 2) && m.panel.geometry.faces.length > 0;
      const growthVersion = m.damage.version, growthDamage = m.damage.damage;
      m.damage.update(240, false);
      const paused = m.damage.version === growthVersion && m.damage.damage === growthDamage;
      m.damage.update(panelTime * 0.75 + BL.mirrorDamage.CRACK_HEAL_TIME + 0.01, true);
      const complete = !m.damage.broken && m.damage.damage === 0 && m.panel.geometry === original;
      brokenRepairs.push({ mode, waiting, delay, growing, paused, complete }); m.damage.dispose();
    }
    record("mirror damage: fully shattered and restored mirrors wait 120 seconds, regrow only with a closed gate and pause without jumping while open", brokenRepairs.every(row => row.waiting && row.delay && row.growing && row.paused && row.complete), JSON.stringify(brokenRepairs));
    const crackOnly = make(); crackOnly.damage.hit(30, 0.2, 0.1, 0);
    const firstCrack = crackOnly.damage.cracks, crackVersion = crackOnly.damage.version;
    crackOnly.damage.update(BL.mirrorDamage.HEAL_DELAY - 0.01);
    const waited = crackOnly.damage.version === crackVersion && crackOnly.damage.cracks === firstCrack;
    crackOnly.damage.update(0.01 + BL.mirrorDamage.CRACK_HEAL_TIME / 2);
    const halfCrack = crackOnly.damage.cracks, noPanePhase = crackOnly.damage.holes === 0;
    crackOnly.damage.update(BL.mirrorDamage.CRACK_HEAL_TIME / 2 + 0.01);
    const crackRestored = crackOnly.damage.damage === 0 && crackOnly.damage.cracks === 0 && crackOnly.damage.holes === 0;
    crackOnly.damage.dispose();
    record("mirror damage: crack-only damage waits quietly then seals directly without a missing-pane phase", waited && noPanePhase && halfCrack > 0 && halfCrack < firstCrack && crackRestored, JSON.stringify({ waited, firstCrack, halfCrack, noPanePhase, crackRestored }));
    const sealingHits = [], faceKey = (geo, face) => face.i.map(index => Array.from(geo.verts.subarray(index * 3, index * 3 + 3)).join(",")).sort().join("|");
    for (const progress of [0.25, 0.5, 0.75]) {
      const m = make(); m.damage.hit(BL.mirrorDamage.PANEL_DAMAGE + 96, 0.2, 0.1, 0);
      const shard = m.root.children.find(node => node.visible && node.mirrorShard === m.panel), struck = shard.geometry;
      const x = shard.position.x, y = shard.position.y;
      m.damage.update(BL.mirrorDamage.HEAL_DELAY + panelTime + BL.mirrorDamage.CRACK_HEAL_TIME * progress);
      const before = m.panel.geometry, beforeCracks = m.damage.cracks, complete = !m.damage.holes && m.damage.contains(x, y);
      const hit = m.damage.hit(8, x, y, 0), after = m.panel.geometry, keys = new Set(after.faces.map(face => faceKey(after, face)));
      let remote = 0, changed = 0;
      for (const face of before.faces) {
        let cx = 0, cy = 0;
        for (const index of face.i) { cx += before.verts[index * 3]; cy += before.verts[index * 3 + 1]; }
        if (present(struck, cx / face.i.length, cy / face.i.length, true)) continue;
        remote++; if (!keys.has(faceKey(before, face))) changed++;
      }
      const version = m.damage.version; m.damage.update(BL.mirrorDamage.HEAL_DELAY - 0.01);
      sealingHits.push({ progress, beforeCracks, complete, hit, remote, changed, quiet: m.damage.version === version }); m.damage.dispose();
    }
    record("mirror damage: hits during final crack sealing preserve every untouched pane contour and restart the quiet delay", sealingHits.every(row => row.complete && row.hit && row.beforeCracks > 0 && row.beforeCracks < 1 && row.remote > 20 && !row.changed && row.quiet), JSON.stringify(sealingHits));
    const locality = [];
    for (const x of [-1.8, 1.8]) {
      const m = make(); m.damage.hit(BL.mirrorDamage.PANEL_DAMAGE, 0, 0, 0); m.damage.hit(4 * BL.mirrorDamage.PANEL_HEALTH, x, 0.1, 0);
      const shards = m.root.children.filter(node => node.visible && node.mirrorShard === m.panel);
      const mean = shards.reduce((sum, node) => sum + node.position.x, 0) / shards.length;
      locality.push({ x, count: shards.length, mean }); m.damage.dispose();
    }
    const m = make(); m.damage.hit(BL.mirrorDamage.PANEL_DAMAGE + 144, 0.2, 0.1, 0);
    const fragment = m.root.children.find(node => node.visible && node.mirrorShard === m.panel);
    const x = fragment.position.x, y = fragment.position.y, wasMissing = !m.damage.contains(x, y);
    m.damage.update(12);
    const before = m.panel.geometry, regrownCenter = m.damage.contains(x, y), beforeDamage = m.damage.damage;
    const maxFragments = Math.ceil(8 / Math.min(...m.damage.panelHealth.filter(health => health > 0)));
    m.damage.hit(8, x, y, 0);
    const shards = m.root.children.filter(node => node.visible && node.mirrorShard === m.panel).map(node => node.geometry);
    let overHole = 0, remoteRemoved = 0, holeFilled = 0, removed = 0, samples = 0;
    for (const geo of shards) for (const face of geo.faces) {
      if (geo.verts[face.i[0] * 3 + 2] !== 0) continue;
      const s = geo.mirrorSource, a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5 - i; j++) {
        const u = (i + 0.2) / 5, t = (j + 0.2) / 5;
        const px = s[a] * (1 - u - t) + s[b] * u + s[c] * t, py = s[a + 1] * (1 - u - t) + s[b + 1] * u + s[c + 1] * t;
        samples++; if (!present(before, px, py)) overHole++;
      }
    }
    for (let ix = 0; ix < 61; ix++) for (let iy = 0; iy < 41; iy++) {
      const px = -2.47 + ix * 4.94 / 60, py = -1.72 + iy * 3.19 / 40, was = present(before, px, py), now = m.damage.contains(px, py);
      if (!was && now) holeFilled++;
      if (was && !now) { removed++; if (!shards.some(geo => present(geo, px, py, true))) remoteRemoved++; }
    }
    const spent = m.damage.damage - beforeDamage; m.damage.dispose();
    record("mirror damage: subsequent impacts choose nearby panes and interrupted repair spends proportional health while dropping only present glass", locality[0].mean < -0.8 && locality[1].mean > 0.8 && locality.every(row => row.count === 4) && wasMissing && regrownCenter && Math.abs(spent - 8) < 1e-9 && shards.length > 0 && shards.length <= maxFragments && samples > 0 && removed > 0 && !overHole && !remoteRemoved && !holeFilled, JSON.stringify({ locality, wasMissing, regrownCenter, spent, maxFragments, shards: shards.length, samples, removed, overHole, remoteRemoved, holeFilled }));
  }
  {
    const S = BL.scene, root = S.createNode(), owners = [], damage = [], player = {}, system = BL.breakables.create({ root, renderer: {}, fx: { burst() {}, damageNumber(x, y, z, amount) { damage.push({ x, y, z, amount }); } }, crew: { player },
      deactivate(owner) { owner.active = owner.node.visible = false; }, relocate: () => false, collectReward: () => false });
    for (let i = 0; i < 26; i++) {
      const owner = { kind: "prop", prop: "crate", node: S.createNode({ geometry: BL.models.box({ w: 1, h: 1, d: 1, color: "#888888" }) }), active: true };
      S.addChild(root, owner.node); owners.push(owner); system.register(owner);
    }
    const count = root.children.length, same = system.register(owners[0]) === owners[0].breakable;
    let refused = false;
    try { system.register({ kind: "prop", prop: "crate" }); } catch (error) { refused = error.message === "Outdoor breakable capacity exceeded"; }
    const item = owners[0].breakable;
    system.hit(null, { owner: owners[0], x: 0, y: 0, z: 0 });
    const fractional = { owner: owners[1], x: 0, y: 0, z: 0 };
    system.hit(player, fractional, 0.25); system.hit(player, fractional, 2); system.hit(player, fractional, 2);
    system.hit(player, { owner: owners[2], x: 0, y: 0, z: 0 }, 0);
    system.hit({}, { owner: owners[2], x: 0, y: 0, z: 0 }, 0.25);
    system.hit(null, { owner: owners[3], x: 0, y: 0, z: 0 }, 0.25);
    system.hit({}, { owner: owners[4], x: 0, y: 0, z: 0 }, 1.5, true);
    system.hit(null, { owner: { kind: "prop" }, x: 0, y: 0, z: 0 });
    record("breakable damage numbers: only player attacks show full hit power, including overkill, while NPC attacks still damage objects", damage.length === 3 && damage.map(hit => hit.amount).join() === "1,8,6" && damage.every(hit => hit.y > 0.5) && owners[1].breakable.health === 0 && owners[2].breakable.health === 3 && owners[3].breakable.health === 3, JSON.stringify(damage));
    system.update(0, item.respawnAt);
    const deferred = item.broken && !owners[0].active && !item.reward && item.respawnAt > 0;
    const rewardNodes = system.list.map(record => record.node); system.dispose();
    record("breakable props: registration is bounded and idempotent, unavailable respawns defer, and disposal removes every pickup", same && refused && count === 52 && deferred && system.list.length === 0 && root.children.length === 26 && owners.every(owner => owner.breakable === null) && rewardNodes.every(node => node.parent === null) && system.stats().breakablesRewards === 0, JSON.stringify({ same, refused, count, deferred, children: root.children.length }));
  }

  {
    const r = convexProbe();
    record("convex collision: cylinder contact and swept thin-wall collisions agree with independent box oracles", r.stationary === 20000 && r.swept === 5008 && r.contacts === 15 && r.failures.length === 0, JSON.stringify(r));
    record("convex collision: oblique fragments and tetrahedron interiors preserve exact contact boundaries", r.rotated === 10000 && r.tetrahedra === 5000 && r.failures.length === 0, JSON.stringify(r));
    record("convex collision: tilted ceilings clear grazing bodies and block penetrations and crossing sweeps", r.tilted === 10000 && r.ceiling === 4 && r.failures.length === 0, JSON.stringify(r));
  }

  {
    // Regression: a tilted gorilla fits a ramp where an upright cylinder does
    // not. Its replacement hull query must still catch thin crossed stone.
    const overlap = BL.convex.hullsOverlap, random = BL.math.mulberry32(0x41c0f00d), failures = [];
    const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const box = (yaw, pitch, center, half) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const axes = [[c, 0, -s], [s*sp, cp, c*sp], [s*cp, -sp, c*cp]], vertices = [];
      for (let i = 0; i < 8; i++) for (let k = 0; k < 3; k++) {
        vertices.push(center[k] + axes.reduce((sum, axis, j) => sum + axis[k] * half[j] * (i & 1 << j ? 1 : -1), 0));
      }
      return { axes, vertices, center, half };
    };
    // Independent separating-axis oracle, rather than another GJK query.
    const separated = (a, b) => {
      const delta = a.center.map((n, i) => n - b.center[i]);
      return [...a.axes, ...b.axes, ...a.axes.flatMap(x => b.axes.map(y => cross(x, y)))].some(axis => {
        if (Math.hypot(...axis) < 1e-10) return false;
        const extent = a.axes.reduce((sum, v, i) => sum + Math.abs(dot(axis, v)) * a.half[i], 0)
          + b.axes.reduce((sum, v, i) => sum + Math.abs(dot(axis, v)) * b.half[i], 0);
        return Math.abs(dot(delta, axis)) >= extent - 1e-7;
      });
    };
    let samples = 0;
    for (; samples < 2000; samples++) {
      const a = box(random()*6.28, random()*2-1, [0, 0, 0], [random()+.01, random()+.01, random()+.01]);
      const b = box(random()*6.28, random()*2-1, [random()*4-2, random()*4-2, random()*4-2], [random()+.01, random()+.01, random()+.01]);
      if (overlap(a.vertices, b.vertices) === separated(a, b) && failures.length < 8) failures.push({ samples, a, b });
    }
    const stone = box(0, 0, [0, 0, 0], [.002, 1, 1]);
    const from = box(.2, .3, [-3, 0, 0], [.4, .3, .4]), to = box(.2, .3, [3, 0, 0], [.4, .3, .4]);
    const swept = !overlap(from.vertices, stone.vertices) && !overlap(to.vertices, stone.vertices)
      && overlap([...from.vertices, ...to.vertices], stone.vertices);
    const base = box(0, 0, [0, 0, 0], [.5, .5, .5]);
    const contact = [1-1e-5, 1, 1+1e-5].every(y => overlap(base.vertices, box(0, 0, [0, y, 0], [.5, .5, .5]).vertices) === (y < 1));
    record("convex collision: posed body hulls agree with independent oriented-box separation, preserve contact, and catch crossed thin walls",
      samples === 2000 && failures.length === 0 && swept && contact, JSON.stringify({ samples, failures, swept, contact }));
  }

  {
    const hit = BL.convex.sweptCylinder, random = BL.math.mulberry32(8147), triangle = new Float64Array(9), repeated = new Float64Array(18);
    let samples = 0, differences = 0, contacts = 0, boundaries = 0;
    const compare = (...args) => {
      // Repeating every vertex preserves this convex hull and its centroid but
      // bypasses the triangle-only shortcut, exercising the original GJK path.
      repeated.set(triangle); repeated.set(triangle, 9);
      const expected = hit(repeated, ...args), actual = hit(triangle, ...args);
      differences += +(actual !== expected); contacts += +expected; samples++;
    };
    for (let i = 0; i < 50000; i++) {
      const scale = i % 9 === 0 ? 1 / 65536 : i % 9 === 1 ? 1024 : 1;
      const value = () => (Math.floor(random() * 2048) - 1024) * scale / 256;
      for (let j = 0; j < triangle.length; j++) triangle[j] = value();
      if (i % 7 === 0) triangle[1] = triangle[4] = triangle[7] = value();
      if (i % 13 === 0) for (let j = 0; j < 3; j++) triangle[6 + j] = triangle[j];
      const x = value(), y = value(), z = value(), moving = i % 4 === 0;
      const radius = Math.abs(value()), height = Math.abs(value());
      compare(x, y, z, moving ? value() : x, moving ? value() : y, moving ? value() : z,
        radius, height, Math.abs(value()), Math.abs(value()));
    }
    for (const gap of [-2e-7, -1e-7, 0, 1e-7, 2e-7]) {
      triangle.set([0, -2, -2, 0, 3, 2, 0, 3, -2]);
      compare(1 + gap, 0, 0, 1 + gap, 0, 0, 1, 1); boundaries++;
      triangle.set([-2, 0, -2, 0, 0, 2, 2, 0, -2]);
      compare(0, gap, 0, 0, gap, 0, 0.5, 1); boundaries++;
      compare(0, -1 + gap, 0, 0, -1 + gap, 0, 0.5, 1); boundaries++;
    }
    record("convex collision: stationary triangle rejection agrees with unchanged GJK for varied sizes, degeneracies, moving sweeps and cap/edge contacts",
      samples === 50015 && boundaries === 15 && contacts > 10000 && differences === 0,
      JSON.stringify({ samples, boundaries, contacts, differences }));
  }
  {
    const r = await lifehashProbe();
    record("room LifeHash: exact v2 images match independent reference vectors, including UTF-8 and coordinate domains", r.vectors === 14 && r.referenceMatches === 14 && r.shapeMatches === 14 && r.repeatMatches === 14 && r.unique === 14 && r.failures.length === 0, JSON.stringify(r));
  }
  {
    const meshes = solidPropsProbe();
    for (const backend of backends) record(`solid props ${backend}: actual prop meshes block bodies and support landings across tree crowns while preserving the gate's openings`, meshes.length === 14 && meshes.every((row) => row.ok), JSON.stringify(meshes));
  }
  {
    const r = windowFlareProbe();
    record("window flares: all existing frames retain their inner sizes and expand toward the actual outer shell", r.windows.length === 30 && r.families["HQ room"] === 7 && r.families["basement room"] === 10 && r.families["HQ ramp"] === 6 && r.families["basement ramp"] === 6 && r.families.panorama === 1 && r.windows.every((w) => w.outerWidth > w.innerWidth && w.outerHeight > w.innerHeight && (w.kind === "room" ? w.innerWidth === 3.5 && w.innerHeight === 2 : w.kind === "ramp" ? w.innerWidth === 3 && w.innerHeight >= 1.75 : w.innerHeight === 2.25)), JSON.stringify({ families: r.families, windows: r.windows }));
    record("window flares: smooth merged reveal triangles agree with solid rock, clear air, and continuous cylinder sweeps", r.fragments > 0 && r.fragments < 40000 && r.totalFaces < 220000 && r.faces > 1000 && r.samples > 1000 && r.sweeps > 100 && r.sloped > 1000 && r.failures.length === 0, JSON.stringify({ fragments: r.fragments, totalFaces: r.totalFaces, faces: r.faces, samples: r.samples, sweeps: r.sweeps, sloped: r.sloped, failures: r.failures }));
    record("window flares: neighboring and stacked apertures retain the required rock separation through the shell", r.pairs > 100 && r.separationSamples > 5000 && r.neighborGap >= r.rockCover && r.stackedGap >= r.rockCover && r.failures.length === 0, JSON.stringify({ pairs: r.pairs, samples: r.separationSamples, neighborGap: r.neighborGap, stackedGap: r.stackedGap, required: r.rockCover, failures: r.failures }));
    record("window flares: every room sees through its full inner frame without retained wall geometry", r.roomViews === 17 && r.roomViewRays === 306 && r.failures.length === 0, JSON.stringify({ rooms: r.roomViews, rays: r.roomViewRays, failures: r.failures }));
    record("window flares: all twelve ramp openings clear their rendered floors, with ten framed throats and two open balcony exits", r.rampFrames.length === 12 && r.rampFrames.filter(f => f.openBalcony).length === 2 && r.rampFrames.every((f) => f.width === 3 && f.height === 1.75 && f.samples === 61 && f.missing === 0 && f.clearance >= r.unit && f.throatClearance >= r.unit && f.floorPieces > 0 && f.intersections === 0 && (f.openBalcony ? f.openChecks === 9 && f.openClear && Math.abs(f.frame - f.marker) < 1e-7 && f.floorExtent <= f.frame + 1e-7 : f.frame > f.floorExtent && f.frame > f.marker) && f.throatWidth === 3 && f.throatHorizontal === 0 && f.throatVertical === 0), JSON.stringify(r.rampFrames));
    record("window flares: the wider passage admits an approach outside the old frame and its floor and ceiling are continuous slopes", r.enlargedAim.clear && r.enlargedAim.across > r.enlargedAim.oldHalfWidth && r.enlargedAim.widthHere > r.enlargedAim.oldHalfWidth + 0.4 && r.floorSamples > 30 && r.ceilingSamples > 40 && r.floorError < 1e-6 && r.ceilingError < 1e-6, JSON.stringify({ aim: r.enlargedAim, floorSamples: r.floorSamples, ceilingSamples: r.ceilingSamples, floorError: r.floorError, ceilingError: r.ceilingError }));
  }
  {
    const basement = headquartersBasementProbe();
    record("headquarters: a second common floor uses the minimum depth that preserves full height and rock beneath the upper HQ", basement.height === 4.25 && basement.radius === 9 && basement.floor < -11 && basement.upperFloor === -7 && basement.upperSupport === -7 && basement.ceiling <= basement.requiredCeiling + 1e-7 && basement.requiredCeiling - basement.ceiling < basement.unit + 1e-7 && basement.rockCover >= 0.75, JSON.stringify(basement));
    record("headquarters: ten unclaimed basement rooms have flat floors, clear connected corridors, exterior windows and solid separating rock", basement.rooms.length === 10 && basement.rooms.every((room, i) => room.index === i && room.basement && room.floor === basement.floor && room.ceiling === basement.ceiling && room.radius === 18 && room.width === (i < 6 ? 5.5 : 5) && room.depth === 5 && room.floorSamples >= 289 && room.corridorSamples > 40 && room.walls.every(Boolean) && room.windowFloor === basement.floor && room.resident === null) && basement.commonSamples > 500 && basement.rockSamples > 10000 && basement.failures.length === 0, JSON.stringify({ rooms: basement.rooms, commonSamples: basement.commonSamples, rockSamples: basement.rockSamples, failures: basement.failures }));
    record("headquarters: every rendered basement floor retains rock to the natural underside and every stacked ramp column preserves its ceiling cover", basement.floorCells > 5000 && basement.renderCells > 500 && basement.footingSamples === basement.floorCells * 3 && basement.footingRock > 1000 && basement.footingAir > 0 && basement.footingRock + basement.footingAir === basement.footingSamples && basement.stackedCells > 1000 && basement.failures.length === 0, JSON.stringify({ floorCells: basement.floorCells, renderCells: basement.renderCells, footingSamples: basement.footingSamples, footingRock: basement.footingRock, footingAir: basement.footingAir, stackedCells: basement.stackedCells, failures: basement.failures }));
    record("headquarters: the two former second-nearest entrances descend gently into the same basement circulation area", basement.ramps.map((ramp) => ramp.index).join("|") === "1|7" && basement.ramps.every((ramp) => ramp.first === -7 && ramp.last === basement.floor && ramp.width >= 3.5 && ramp.endRadius < basement.radius && ramp.maxSlope < 1.05 && ramp.maxStep < 0.3 && ramp.smoothSamples > 20 && ramp.samples > 50), JSON.stringify(basement.ramps));
  }
  {
    const terrain = terrainSightProbe();
    for (const backend of backends) {
      record(`camera sight guides ${backend}: exact terrain rays agree with rendered faces, dense occupancy and reverse traversal`, Object.values(terrain.counts).length === 4 && Object.values(terrain.counts).every((count) => count === 120) && terrain.rays > 1400 && terrain.failures.length === 0 && terrain.seamCovered && terrain.outside && terrain.throughIsland && terrain.shaft, JSON.stringify(terrain));
      record(`camera sight guides ${backend}: empty terrain box certificates agree with independent occupancy and rays`, terrain.certifiedRays > 100 && terrain.clearBoxes > 300 && terrain.boxRays === terrain.clearBoxes * 8 && terrain.boxPoints === terrain.clearBoxes * 27 && terrain.solidBoxes > 100 && terrain.solidPoints === terrain.solidBoxes * 27 && terrain.failures.length === 0, JSON.stringify({ certifiedRays: terrain.certifiedRays, clearBoxes: terrain.clearBoxes, boxRays: terrain.boxRays, boxPoints: terrain.boxPoints, solidBoxes: terrain.solidBoxes, solidPoints: terrain.solidPoints, failures: terrain.failures }));
      record(`camera sight guides ${backend}: every window certifies actual convex stone fragments while rejecting two-millimetre air crossings`, terrain.fragmentWindows.length === 30 && terrain.fragmentWindows.every((count) => count === 3) && terrain.fragmentBoxes === 90 && terrain.fragmentAirBoxes === terrain.fragmentBoxes && terrain.fragmentPoints === terrain.fragmentBoxes * 27 && terrain.failures.length === 0, JSON.stringify({ windows: terrain.fragmentWindows, solid: terrain.fragmentBoxes, air: terrain.fragmentAirBoxes, points: terrain.fragmentPoints, failures: terrain.failures }));
    }
  }
  {
    const proof = canopyCertificateProbe();
    for (const backend of backends) record(`canopy occlusion ${backend}: solid prop coverage avoids dense ray searches while preserving tiny gaps, partial edges, clip planes and moving blockers`, proof.rows.length === 9 && proof.failures.length === 0 && proof.disposed, JSON.stringify(proof));
  }
  {
    const entrance = rampOutlineSectionsProbe();
    for (const backend of backends) record(`camera rock guides ${backend}: both ramp entrances keep three complete wall sections visible on ascent and descent, excluding ceiling steps and buried exterior faces`, entrance.fronts === 2 && entrance.geometry.ramps === 4 && entrance.geometry.triangles > 1000 && entrance.geometry.exteriorSamples > 1000 && entrance.phases.sections === 6 && entrance.phases.activeSections === 6 && entrance.phases.sampled > 100 && entrance.phases.selfHidden > 0 && entrance.phases.cameraVisible > 0 && entrance.rows.length === 2 && entrance.rows.every((row) => row.returnSamples === 5 && row.visibleExitInside > 0 && row.outlinedExitInside > 0) && entrance.failures.length === 0, JSON.stringify(entrance));
  }
  {
    const slopes = slopeOutlineSectionsProbe();
    for (const backend of backends) record(`slope outlines ${backend}: stepped hillside sides join up to the crest, exclude flat platforms, and reveal the far side only from its own line of sight`, slopes.synthetic.joined > 20 && slopes.synthetic.excluded >= 7 && slopes.synthetic.oppositeSides && slopes.synthetic.diagonalJoined && slopes.geometry.mixedSides > 0 && slopes.geometry.risers > 100 && slopes.geometry.treads > 100 && slopes.runtime.blockedBelow > 0 && slopes.runtime.revealedAbove === slopes.runtime.blockedBelow && slopes.runtime.partialFadeIn === slopes.runtime.blockedBelow && slopes.runtime.partialFadeOut === slopes.runtime.blockedBelow && slopes.failures.length === 0, JSON.stringify(slopes));
  }
  {
    const r = outlinePerformanceProbe();
    for (const backend of backends) record(`outline visibility cache ${backend}: whole-wall witnesses remain correct as blockers change without retracing fixed-camera terrain`, r.rows.length === 3 && r.failures.length === 0, JSON.stringify(r));
  }
  {
    // Ooga Orbit's rules and flight model, straight from rocket-parts.js and rocket.js, at the fixed 1/120 step.
    const P = BL.rocketParts, K = BL.rocket, { quat } = BL.math, DT = 1 / 120, IN = { throttle: 0, lean: 0, pitch: 0, roll: 0, yaw: 0 };
    const climb = (stack) => {
      const f = K.create({ stack, groundAt: () => -Infinity }), s = f.state;
      f.reset(0, 2.3, 46);
      f.ignite();
      let seps = 0;
      for (let t = 0; t < 300 && !s.failure && s.alt <= K.ORBIT_ALT; t += DT) {
        f.substep(DT, IN);
        if (s.flameout) {
          s.flameout = false;
          if (f.separate()) seps++, f.ignite();
        }
      }
      return { alt: Math.round(s.alt), failure: s.failure, seps };
    };
    // Held over the pad at the top, pod alone, thrown down shield first (or flipped), chute as soon as it is ready.
    const home = (stack, { flip = false, chute = true } = {}) => {
      const f = K.create({ stack, groundAt: () => -Infinity }), s = f.state;
      f.reset(0, 2.3, 46);
      s.mode = "ascent";
      f.hold(0, K.CY + K.R + K.ORBIT_ALT, 0);
      f.homeward();
      f.stand();
      if (flip) quat.multiply(s.q, s.q, quat.fromAxisAngle(quat.create(), 1, 0, 0, Math.PI));
      s.v.y = -12;
      for (let t = 0; t < 400 && !s.failure && s.mode !== "down"; t += DT) {
        f.substep(DT, IN);
        if (chute && f.chuteReady()) f.deploy();
      }
      return { pod: f.isPod(), failure: s.failure, landing: s.landing, peakHeat: +s.peakHeat.toFixed(3), chute: s.chute };
    };
    const presets = P.PRESETS.map((p) => ({ name: p.name, ok: P.check(p.stack).ok, warnings: P.check(p.stack).warnings.length, stages: P.stagesOf(p.stack).length, dv: +P.stats(p.stack).dv.toFixed(1), ...climb(p.stack) }));
    record("orbit parts: every ready rocket passes the builder, has the speed for low orbit and climbs straight to it, dropping its stages", presets.length === 3 && presets.every((p) => p.ok && p.dv >= P.TOP_DV && p.alt >= K.ORBIT_ALT && !p.failure && p.seps === Math.max(0, p.stages - 2)) && presets[0].stages === 4 && presets[1].stages === 4 && presets[0].warnings === 0 && presets[1].warnings === 0 && presets[2].warnings === 1, JSON.stringify(presets));
    const rules = {
      noEngine: P.check(["barrel", "stickpod"]).ok,
      noPod: P.check(["pot", "barrel"]).ok,
      loneShield: P.check(["pot", "mudshield", "barrel", "stickpod"]).ok,
      floatingEngine: P.check(["pot", "barrel", "tusk", "stickpod"]).ok,
      twoPods: P.check(["pot", "stickpod", "gourdpod"]).ok,
      noShield: P.check(["pot", "vine", "stickpod"]).warnings,
      sanitized: P.sanitize(["pot", "nope", 7, "barrel", ...Array(30).fill("nut")]),
      notList: P.sanitize("pot")
    };
    record("orbit parts: the builder refuses a rocket without an engine at the bottom or a pod on top, a stray shield or engine, two pods, and sanitises stored stacks", !rules.noEngine && !rules.noPod && !rules.loneShield && !rules.floatingEngine && !rules.twoPods && rules.noShield.some((w) => w.includes("heat shield")) && rules.sanitized.length === P.MAX_PARTS && rules.sanitized[0] === "pot" && rules.sanitized[1] === "barrel" && rules.notList === null, JSON.stringify(rules));
    const ooga = P.PRESETS[0].stack, shield = home(ooga), flipped = home(ooga, { flip: true }), bare = home(ooga, { chute: false });
    record("orbit flight: from low orbit the pod comes home alone, shield first runs cooler than flipped, the chute lands it soft and no chute breaks it on the sea", shield.pod && !shield.failure && shield.landing === "soft" && shield.chute === "open" && shield.peakHeat > 0 && flipped.peakHeat > shield.peakHeat * 1.5 && bare.failure === "splat", JSON.stringify({ shield, flipped, bare }));
  }
};


const dsbWaterCheckpoint = { name: "dsb water checkpoint", why: "contract: Aegean water preserves movement and releases its GPU textures across Portara trips", run: async b => {
  const r=await b.evaluate(`(() => {
    const B=__ooga,W=B.dsb.water,first=new Uint8Array(W.pixels);
    W.update(13);const moved=W.pixels.some((x,i)=>x!==first[i]);
    W.update(0);const zero=new Uint8Array(W.pixels);W.update(120);
    const loop=W.pixels.every((x,i)=>x===zero[i]),finite=W.heights.every(Number.isFinite);
    const start=performance.now();for(let i=0;i<60;i++)W.update(i/60);
    return {kind:B.renderer.kind,textures:B.renderer.stats.waterTextures,moved,loop,finite,cost:(performance.now()-start)/60,
      depthNear:W.depthAt(-39,54),depthFar:W.depthAt(250,250),camera:B.dsb.overview};
  })()`);
  const canvas=await b.evaluate('new URLSearchParams(location.search).has("canvas2d")');
  record("DSB FFT: finite, periodic, animated; depth grows offshore; renderer stays available",r.finite&&r.loop&&r.moved&&r.depthFar>r.depthNear&&(canvas?r.kind==="canvas2d":r.kind==="webgl2"&&r.textures===2),JSON.stringify(r));
  if(!canvas){
    await b.evaluate(`document.querySelector('[data-action="reset-view"]').click()`);
    const before=await b.evaluate('({x:__ooga.dsb.avatar.root.position.x,z:__ooga.dsb.avatar.root.position.z})');
    await b.send("Input.dispatchKeyEvent",{type:"keyDown",key:"s",code:"KeyS"});
    await b.evaluate('__ooga.advance(.3)');
    await b.send("Input.dispatchKeyEvent",{type:"keyUp",key:"s",code:"KeyS"});
    const after=await b.evaluate('({x:__ooga.dsb.avatar.root.position.x,z:__ooga.dsb.avatar.root.position.z})');
    record("DSB keyboard movement still walks on approved land",Math.hypot(after.x-before.x,after.z-before.z)>.05,JSON.stringify({before,after}));
  }
  const name=await b.evaluate('__ooga.dsb.avatar.traits.name');
  for(let i=0;i<2;i++){
    const crossed=await b.evaluate(`(() => {const B=__ooga,G=B.dsb.gate;G.receive();return G.traverse({x:-45,y:41.4,z:-46},{x:-45,y:41.4,z:-50},.3);})()`);
    await untilPage(b,'B.scene==="bifrost"&&!B.transitioning',20000);
    const released=await b.evaluate('__ooga.renderer.stats.waterTextures');
    await b.evaluate('__ooga.go("dsb")');
    await untilPage(b,'B.scene==="dsb"&&!B.transitioning',20000);
    const returned=await b.evaluate('({name:__ooga.dsb.avatar.traits.name,textures:__ooga.renderer.stats.waterTextures})');
    record("DSB water trip "+i+": Portara crossing preserves identity and releases textures",crossed&&released===0&&returned.name===name&&returned.textures===(canvas?0:2),JSON.stringify({crossed,released,returned}));
  }
}};
scene("dsb",{label:"water checkpoint",query:"&overview=1",steps:[dsbWaterCheckpoint]});
scene("dsb",{label:"water checkpoint canvas",query:"&overview=1&canvas2d=1",steps:[dsbWaterCheckpoint]});
scene("dsb",{label:"water checkpoint phone",query:"&overview=1",opts:{w:390,h:844,mobile:true},steps:[dsbWaterCheckpoint]});

// The current master scene deliberately omits the old attraction prototype. Exercise its
// environment through the same public debug surface used by the visual review.
const dsbWeatherCheckpoint = { name: "dsb weather checkpoint", why: "rule: weather recovers to clear, preserves night and gates exterior sound without growing particle or GPU pools", run: async b => {
  await b.key("m"); await b.key("m"); // Real gesture unlocks the shared sound graph.
  const r = await b.evaluate(`(() => {
    const B=__ooga,D=B.dsb,W=D.weather,S=W.shared.state,O=B.renderOpts;
    let elapsed=0;const advance=seconds=>{for(let t=0;t<seconds;t+=1/60)BL.scenes.dsb.update(1/60,elapsed+=1/60);};
    const settle=()=>advance(8);
    W.setMode("clear");settle();
    const base={light:O.directStrength,sky:Array.from(O.sky),wave:D.water.environment[0],drops:S.drops};
    W.setMode("light-rain");settle();
    const rain={light:O.directStrength,drops:S.drops,cloud:W.state.cloud,wave:D.water.environment[0]};
    W.setMode("storm");settle();
    const storm={light:O.directStrength,drops:S.drops,cloud:W.state.cloud,wave:D.water.environment[0],strikes:S.strikes};
    W.strike();advance(.04);const flash=S.flash;advance(2);const expired=S.flash===0;
    D.setInterior(true);advance(.1);
    const gated=!S.exterior&&S.drops===0&&S.masterLevel===0&&!S.thunderPending;
    D.setInterior(false);advance(1);
    const resumed=S.exterior&&S.drops>0&&S.masterLevel>0;
    const tier=B.renderer.quality;B.renderer.setQuality("low");advance(2);
    const bounded=S.drops<=260&&S.deckShown<=22;
    B.renderer.setQuality(tier);W.setMode("clear");settle();
    const recovered=Math.abs(O.directStrength-base.light)<.0001&&S.drops===0&&D.water.environment[0]===1;
    const finite=Array.from(D.water.environment).every(Number.isFinite)&&D.water.heights.every(Number.isFinite);
    return {base,rain,storm,flash,expired,gated,resumed,bounded,recovered,finite,thunders:S.thunders,kind:B.renderer.kind,textures:B.renderer.stats.waterTextures};
  })()`);
  record("DSB weather: rain and storm attenuate daylight and raise bounded water energy",r.base.drops===0&&r.rain.drops>0&&r.rain.light<r.base.light&&r.storm.light<r.rain.light&&r.storm.wave>r.rain.wave&&r.storm.strikes>0,JSON.stringify(r));
  record("DSB weather: flash expires, exterior gate silences and resumes, tiers bound pools and clear recovers",r.flash>0&&r.expired&&r.thunders>0&&r.gated&&r.resumed&&r.bounded&&r.recovered&&r.finite,JSON.stringify(r));
  const night=await b.evaluate(`(() => {
    const B=__ooga,D=B.dsb;D.weather.setMode("rain");for(let i=0;i<240;i++)BL.scenes.dsb.update(1/60,i/60);BL.daylight.sample(0,B.renderOpts,80,37);D.weather.update(0,B.renderOpts);
    return {day:B.renderOpts.day,lamps:B.renderOpts.lampFactor,drops:D.weather.shared.state.drops,glint:D.water.environment[2],sky:Array.from(B.renderOpts.sky)};
  })()`);
  record("DSB night rain: clock stays at night, lamps stay lit, precipitation stays visible and solar glints vanish",night.day===0&&night.lamps>.9&&night.drops>0&&night.glint===0&&night.sky.every(Number.isFinite),JSON.stringify(night));
  record("DSB weather: runtime console remains clean",b.logs.length===0,b.logs.join(" | "));
}};
scene("dsb",{label:"weather checkpoint",query:"&overview=1&weather=clear&time=1200",steps:[dsbWeatherCheckpoint]});
scene("dsb",{label:"weather checkpoint phone",query:"&overview=1&weather=clear&time=1200",opts:{w:390,h:844,mobile:true},steps:[dsbWeatherCheckpoint]});

const dsbRadioTvCorrection = { name:"dsb radio TV correction", why:"regression: restore the physical radio TV, safe invoice flow and exclusive live/fallback audio with the shared interior gate", run:async b=>{
  const step=()=>b.evaluate('for(let i=0;i<60;i++)BL.scenes.dsb.update(1/60,i/60)');
  const click=async id=>{const p=await b.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await b.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[p]});await b.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});};
  await b.key("m");await b.key("m");await step();
  await b.evaluate('window.__correction={audio:__ooga.dsb.noderunner.audio,tv:__ooga.dsb.tv};__ooga.dsb.tv.close()');
  await click("dsb-context");await step();
  record("DSB TV correction: physical nearby touch action opens five-channel menu",await b.evaluate('document.getElementById("dsb-tv").open&&document.querySelectorAll("#dsb-tv-menu button").length===5&&document.querySelectorAll("#dsb-tv-menu button:disabled").length===4'));
  await click("dsb-tv-channel");
  record("DSB TV correction: bounded metadata and local official QR are visible",await b.evaluate('document.getElementById("dsb-tv-song").textContent==="Turtle Radio"&&document.querySelectorAll("#dsb-tv-queue li").length===1&&document.getElementById("dsb-tv-qr").width>100'));
  await b.evaluate('document.getElementById("dsb-tv-query").value="Ooga"');await click("dsb-tv-search");
  await b.evaluate('window.__paymentClock={native:window.setTimeout.bind(window)};window.setTimeout=(fn,ms,...args)=>{if(ms===5000){__paymentClock.tick=fn;__paymentClock.id=__paymentClock.native(()=>{},ms);return __paymentClock.id;}return __paymentClock.native(fn,ms,...args);};document.querySelector("#dsb-tv-results button").click()');await b.sleep(100);
  const invoice=await b.evaluate(`(()=>{const T=BL.dsbTv,good={"bolt11": "lnbc2100n1p4vzq52pp50dsaw0kxfc0urmtzl7ezwv4qemxs8ufx98cyjjsj9wkz7l3l7afsdpltfshqgpg2c69v2f6ypqkzun0dcsykmm9de5kwgpdyppxjarrda5kugzzv4skx6qcqzzsxqzuysp535fyv3fcdnf59stpn82fd6mypgd245r8n9zg6mcnx90a8ws68v2s9qxpqysgqxj432mzxnppe93v7fqxvs8hav584jgqfejc3mrpagrkheq0ythhse9ldk82lc0p43njn39dcs36m0djafxgug2aa374eczjfm3ew54qqt8zcnh", "sats": 210, "payment_hash": "7b61d73ec64e1fc1ed62ffb22732a0cecd03f12629f0494a122bac2f7e3ff753"},bad={...good,sats:1},long="\u0000"+"x".repeat(500);return {valid:T.validInvoice(good),bad:T.validInvoice(bad),hash:T.validInvoice({...good,payment_hash:"bad"}),check:T.validInvoice({...good,bolt11:good.bolt11.slice(0,-1)+"q"}),clean:T.clean(long).length,bounded:T.results({results:Array.from({length:30},()=>({title:long,artist:"<img>",source:"library"}))}).length,open:!document.getElementById("dsb-tv-invoice").hidden,qr:document.getElementById("dsb-tv-invoice-qr").width,link:document.getElementById("dsb-tv-wallet").getAttribute("href"),width:document.getElementById("dsb-tv").scrollWidth<=document.getElementById("dsb-tv").clientWidth};})()`);
  record("DSB TV correction: valid station invoice, local QR, bounded data and mobile layout",invoice.valid&&!invoice.bad&&!invoice.hash&&!invoice.check&&invoice.clean===160&&invoice.bounded===12&&invoice.open&&invoice.qr>200&&invoice.link.startsWith("lightning:lnbc")&&invoice.width,JSON.stringify(invoice));
  await b.evaluate('document.querySelector("#dsb-tv-results button").click()');
  record("DSB TV correction: duplicate invoice is refused",await b.evaluate('__dsbTvFixture.invoices===1'));
  const payment=async (value,error=false)=>{await b.evaluate(`__dsbTvFixture.payment=${JSON.stringify(value)};__dsbTvFixture.paymentError=${error};clearTimeout(__paymentClock.id);__paymentClock.tick()`);await b.sleep(40);return b.evaluate('document.getElementById("dsb-tv-payment-status").textContent');};
  const unpaid=await payment({paid:false,queued:false}),offline=await payment(null,true),paid=await payment({paid:true,queued:false}),queued=await payment({paid:true,queued:true});
  record("DSB TV correction: unpaid, failure, paid and queued states never suggest a second payment",unpaid.includes("Waiting for payment")&&offline.includes("do not pay twice")&&paid.includes("waiting for the station")&&queued.includes("your song is queued"));
  await click("dsb-tv-copy");
  record("DSB TV correction: copy succeeds or selects the full invoice",await b.evaluate('/Invoice copied|Invoice selected/.test(document.getElementById("dsb-tv-payment-status").textContent)'));
  await b.evaluate('window.__correction.epoch=__ooga.dsb.tv.stats.paymentEpoch');await click("dsb-tv-cancel-invoice");
  record("DSB TV correction: closing invoice invalidates polling epoch",await b.evaluate('!__ooga.dsb.tv.stats.invoice&&__ooga.dsb.tv.stats.paymentEpoch>__correction.epoch&&document.getElementById("dsb-tv-invoice").hidden'));
  await b.evaluate('clearTimeout(__paymentClock.id);__paymentClock.tick();window.setTimeout=__paymentClock.native');await b.sleep(40);
  record("DSB TV correction: cancelled epoch cannot revive its invoice",await b.evaluate('!__ooga.dsb.tv.stats.invoice&&document.getElementById("dsb-tv-invoice").hidden'));
  await b.key("Escape");await step();
  record("DSB TV correction: Escape closes TV without stopping the live stream",await b.evaluate('!__ooga.dsb.tv.isOpen&&__correction.audio.stats.mode==="live"&&__correction.audio.stats.starts===1'));
  const audio=await b.evaluate(`(()=>{const D=__ooga.dsb,A=D.noderunner.audio,E=__dsbRadioFixture.element;A.update(1,4,true);const live=A.stats;D.weather.setInterior(true);const gated=E.muted&&!A.stats.enabled;D.weather.setInterior(false);A.update(1,80,true);const far=E.muted;E.onerror();A.update(1,4,true);const offline=A.stats;A.play();A.update(1,4,true);return {live,gated,far,offline,connecting:A.stats};})()`);
  await b.sleep(50);await step();
  record("DSB radio correction: live/fallback are exclusive and the shared gate silences HTML audio immediately",audio.live.liveAudible&&audio.gated&&audio.far&&audio.offline.fallbackLevel>0&&!audio.offline.liveAudible&&audio.connecting.fallbackLevel===0,JSON.stringify(audio));
  record("DSB radio correction: recovery returns to one live stream",await b.evaluate('__correction.audio.stats.mode==="live"&&__correction.audio.stats.fallbackLevel===0'));
  await b.evaluate('__ooga.go("bifrost",null,true);__ooga.advance(.05)');
  record("DSB radio correction: scene disposal stops stream, fallback and TV timers",await b.evaluate('__correction.audio.stats.disposed&&__correction.audio.stats.sources===0&&__correction.audio.stats.timers===0&&__correction.audio.stats.fallbackSources===0&&__correction.tv.stats.disposed&&__correction.tv.stats.timers===0&&__correction.tv.stats.requests===0'));
  await b.evaluate('__ooga.go("dsb",null,true);__ooga.advance(.05)');await step();
  record("DSB radio correction: re-entry creates one fresh station",await b.evaluate('__ooga.dsb.noderunner.audio.stats.starts===1&&__ooga.dsb.noderunner.audio.stats.sources===1'));
  record("DSB radio correction: console remains clean",b.logs.length===0,b.logs.join(" | "));
}};
scene("dsb",{label:"radio TV correction",query:"&view=noderunner&weather=clear&time=1200",steps:[dsbRadioTvCorrection]});
scene("dsb",{label:"radio TV correction phone",query:"&view=noderunner&weather=clear&time=1200",opts:{w:390,h:844,mobile:true},steps:[dsbRadioTvCorrection]});

const dsbHarborCheckpoint = { name:"dsb harbor checkpoint", why:"rule: normal walking reaches the harbor, and one distance-based exterior station survives weather, rooms and scene changes", run:async b=>{
  const step=()=>b.evaluate('for(let i=0;i<60;i++)BL.scenes.dsb.update(1/60,i/60)');
  await b.evaluate('window.__harborStart={...__ooga.dsb.avatar.root.position}');
  await b.send("Input.dispatchKeyEvent",{type:"keyDown",key:"w",code:"KeyW"});await step();
  await b.send("Input.dispatchKeyEvent",{type:"keyUp",key:"w",code:"KeyW"});
  const motion=await b.evaluate('({distance:Math.hypot(__ooga.dsb.avatar.root.position.x-__harborStart.x,__ooga.dsb.avatar.root.position.z-__harborStart.z),controlled:__ooga.pilot.player===__ooga.dsb.avatar})');
  record("DSB harbor: normal non-overview gameplay walks the selected player",motion.controlled&&motion.distance>.5,JSON.stringify(motion));
  await b.key("m");await b.key("m");
  const mix=await b.evaluate(`(()=>{
    const B=__ooga,D=B.dsb,N=D.noderunner,W=D.weather;const rows=[];
    const move=p=>{B.pilot.navigate({position:{x:p.x,y:D.land.heightAt(p.x,p.z),z:p.z},yaw:N.building.yaw,pitch:.22,dist:7});for(let i=0;i<240;i++)BL.scenes.dsb.update(1/60,i/60);rows.push({...N.stats});};
    move({x:-10,z:45});move({x:-38,z:34});move(N.review);move({x:-38,z:34});move({x:-10,z:45});
    move(N.review);const clear=N.stats.target;W.setMode("storm");for(let i=0;i<480;i++)BL.scenes.dsb.update(1/60,i/60);
    window.__harborTest={audio:N.audio,source:N.source};
    return {rows,clear,storm:N.stats.target,rain:W.shared.state.rainLevel,starts:N.audio.stats.starts,sources:N.audio.stats.sources};
  })()`);
  record("DSB harbor: proximity fades in/out, is silent far away and never boosts itself over storms",mix.rows[0].level<.001&&mix.rows[1].level>0&&mix.rows[2].level>mix.rows[1].level&&mix.rows[3].level<mix.rows[2].level&&mix.rows[4].level<.001&&mix.clear===mix.storm&&mix.rain>0&&mix.starts===1&&mix.sources===1,JSON.stringify(mix));
  const road=await b.evaluate(`(()=>{
    const D=__ooga.dsb,N=D.noderunner,L=D.land;let obstructed=0;
    for(let i=1;i<L.waterfront.length;i++){
      const a=L.waterfront[i-1],b=L.waterfront[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
      for(let j=0;j<=n;j++){const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n,y=L.heightAt(x,z);if(!N.clearSegment(x,z,x,z,y,D.avatar.bodyHeight,D.avatar))obstructed++;}
    }
    // Flood the existing supported walking surface. No alternate collision or terrain formula.
    const size=111,step=1.5,min=-90,seen=new Uint8Array(size*size),queue=[];
    const index=p=>Math.round((p.z-min)/step)*size+Math.round((p.x-min)/step);
    const start=index(__harborStart);seen[start]=1;queue.push(start);
    for(let head=0;head<queue.length;head++){
      const q=queue[head],ix=q%size,iz=(q/size)|0,x=min+ix*step,z=min+iz*step,y=L.heightAt(x,z);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=ix+dx,nz=iz+dz,k=nz*size+nx;if(nx<0||nz<0||nx>=size||nz>=size||seen[k])continue;
        const tx=min+nx*step,tz=min+nz*step;
        if(L.walkable(x,z,tx,tz,y,D.avatar.bodyHeight,D.avatar)&&N.clearSegment(x,z,tx,tz,y,D.avatar.bodyHeight,D.avatar)){seen[k]=1;queue.push(k);}
      }
    }
    const reachable=p=>{const k=index(p),x=min+(k%size)*step,z=min+((k/size)|0)*step;return !!seen[k]&&L.walkable(x,z,p.x,p.z,L.heightAt(x,z),D.avatar.bodyHeight,D.avatar)&&N.clearSegment(x,z,p.x,p.z,L.heightAt(x,z),D.avatar.bodyHeight,D.avatar);};
    return {obstructed,visited:queue.length,harbor:reachable(N.review),chora:reachable({x:22,z:41}),meme:reachable(D.interiors.registry.get("meme-factory").entry)};
  })()`);
  record("DSB harbor: promenade stays clear and the normal ground graph reaches harbor, Chora and Meme Factory",!road.obstructed&&road.harbor&&road.chora&&road.meme,JSON.stringify(road));
  await b.evaluate('(()=>{const B=__ooga,d=B.dsb.interiors.registry.get("meme-factory");B.pilot.navigate({position:d.entry,yaw:d.building.yaw,pitch:.22,dist:7});})()');
  await b.key(" ");await step();
  const inside=await b.evaluate('({room:!!__ooga.dsb.interiors.active,gate:__ooga.dsb.weather.shared.state.masterLevel,radio:__ooga.dsb.noderunner.stats,indoor:__ooga.dsb.interiors.audio.stats.connected})');
  await b.key(" ");await step();
  const outside=await b.evaluate('({room:!!__ooga.dsb.interiors.active,gate:__ooga.dsb.weather.shared.state.masterLevel,radio:__ooga.dsb.noderunner.stats,same:__ooga.dsb.noderunner.audio===__harborTest.audio})');
  record("DSB harbor: the real interior disconnects all exterior sound and exit uses current listener distance",inside.room&&inside.gate===0&&inside.radio.level===0&&inside.indoor&&!outside.room&&outside.gate>0&&outside.radio.target===0&&outside.same,JSON.stringify({inside,outside}));
  for(let visit=0;visit<3;visit++){
    await b.evaluate('__harborTest.old=__ooga.dsb.noderunner;__ooga.go("bifrost",null,true);__ooga.advance(.05)');
    const released=await b.evaluate('({disposed:__harborTest.old.audio.stats.disposed,sources:__harborTest.old.audio.stats.sources,attached:!!__harborTest.old.group.parent,solids:__harborTest.old.solids.stats.nodes})');
    await b.evaluate('__ooga.go("dsb",null,true);__ooga.advance(.05)');
    await step();
    const fresh=await b.evaluate('({sources:__ooga.dsb.noderunner.audio?.stats.sources,starts:__ooga.dsb.noderunner.audio?.stats.starts})');
    record("DSB harbor: scene round trip "+(visit+1)+" stops the old station and creates only one new source",released.disposed&&released.sources===0&&!released.attached&&released.solids===0&&fresh.sources===1&&fresh.starts===1,JSON.stringify({released,fresh}));
  }
  await b.evaluate('delete window.__harborTest;delete window.__harborStart');
  record("DSB harbor: runtime console remains clean",b.logs.length===0,b.logs.join(" | "));
}};
scene("dsb",{label:"harbor checkpoint",query:"&weather=clear&time=1200",steps:[dsbHarborCheckpoint]});
scene("dsb",{label:"harbor checkpoint phone",query:"&weather=clear&time=1200",opts:{w:390,h:844,mobile:true},steps:[dsbHarborCheckpoint]});

const dsbInteriorCheckpoint = { name: "dsb interior checkpoint", why: "rule: a real door isolates its room and returns the same player to current exterior weather without accumulating resources", run: async b => {
  const step=()=>b.evaluate('for(let i=0;i<36;i++)BL.scenes.dsb.update(1/60,i/60)');
  const tap=async()=>{
    const p=await b.evaluate('(()=>{const e=document.getElementById("dsb-context"),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,visible:!e.hidden};})()');
    if(!p.visible)throw new Error("Expected a reachable interior door");
    await b.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:p.x,y:p.y}]});
    await b.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await step();
  };
  await b.key(" ");await step();
  const entry=await b.evaluate(`(()=>{const B=__ooga,D=B.dsb,I=D.interiors,S=D.weather.shared.state;window.__interiorCheck={avatar:D.avatar,land:D.land,nature:D.nature,water:D.water,indoor:I.lighting,read:B.daylight.read};
    return {active:!!I.active,exterior:D.exterior.visible,drops:S.drops,master:S.masterLevel,feet:D.avatar.root.position.y-D.avatar.baseY,camera:{...B.camera.position},audio:I.audio.stats,label:document.querySelector("#dsb-context").textContent};})()`);
  record("DSB interior: Space at the exterior door enters, gates weather and starts one workshop graph",entry.active&&!entry.exterior&&entry.drops===0&&entry.master===0&&Math.abs(entry.feet-.06)<.001&&Math.abs(entry.camera.x)<2&&entry.audio.connected&&entry.audio.sources===3,JSON.stringify(entry));
  // Actual held movement, then a supported doorway return through the same controller.
  const before=await b.evaluate('({...__ooga.dsb.avatar.root.position})');
  await b.send("Input.dispatchKeyEvent",{type:"keyDown",key:"d",code:"KeyD"});await step();
  await b.send("Input.dispatchKeyEvent",{type:"keyUp",key:"d",code:"KeyD"});
  const moved=await b.evaluate(`(()=>{const D=__ooga.dsb,I=D.interiors,p=D.avatar.root.position;return {p:{...p},floor:I.groundAt(p.x,p.z),wall:I.walkable(0,8,0,12,.06,2,D.avatar),counter:I.walkable(0,-3,0,-7,.06,2,D.avatar),table:I.walkable(0,7,0,3,.06,2,D.avatar)};})()`);
  record("DSB interior: held movement works on the floor and swept collision blocks walls, tables and counter",Math.hypot(moved.p.x-before.x,moved.p.z-before.z)>.2&&moved.floor===.06&&!moved.wall&&!moved.counter&&!moved.table,JSON.stringify(moved));
  await b.evaluate('(()=>{const B=__ooga,I=B.dsb.interiors;B.pilot.navigate({position:I.active.room.spawn,yaw:0,pitch:.22,dist:3});B.dsb.weather.setMode("rain");B.daylight.read=()=>0;for(let i=0;i<480;i++)BL.scenes.dsb.update(1/60,i/60);})()');
  const isolation=await b.evaluate('({same:BL.scenes.dsb.renderOpts===__interiorCheck.indoor,exterior:__ooga.dsb.weather.state.exterior,drops:__ooga.dsb.weather.shared.state.drops,night:__ooga.renderOpts.day})');
  await tap();
  const exit=await b.evaluate(`(()=>{const B=__ooga,D=B.dsb,I=D.interiors,p=D.avatar.root.position,e=I.registry.get("meme-factory").entry;return {active:!!I.active,same:D.avatar===__interiorCheck.avatar&&D.land===__interiorCheck.land&&D.water===__interiorCheck.water&&D.nature===__interiorCheck.nature,distance:Math.hypot(p.x-e.x,p.z-e.z),floor:p.y-D.avatar.baseY-D.land.heightAt(p.x,p.z),cameraClear:D.land.clearAt(B.camera.position.x,B.camera.position.z,.1),weather:D.weather.state.mode,night:B.renderOpts.day,lamps:B.renderOpts.lampFactor,drops:D.weather.shared.state.drops,master:D.weather.shared.state.masterLevel,audio:I.audio.stats};})()`);
  record("DSB interior: touch exit restores the same player/building and current night rain, not entry weather",isolation.same&&!isolation.exterior&&isolation.drops===0&&isolation.night===0&&!exit.active&&exit.same&&exit.distance<.01&&exit.cameraClear&&Math.abs(exit.floor)<.01&&exit.weather==="rain"&&exit.night===0&&exit.lamps>.9&&exit.drops>0&&exit.master>0&&!exit.audio.connected,JSON.stringify({isolation,exit}));
  await b.evaluate('__ooga.daylight.read=__interiorCheck.read');
  const snapshot=()=>b.evaluate(`(()=>{const B=__ooga,I=B.dsb.interiors;let nodes=0;const geometries=new Set();const visit=n=>{nodes++;if(n.geometry)geometries.add(n.geometry);for(const c of n.children)visit(c);};visit(BL.scenes.dsb.root);return {nodes,geometries:geometries.size,rooms:I.rooms.size,targets:BL.scenes.dsb.input.targetCount,audio:I.audio.stats.sources,contexts:I.audio.stats.contexts,radioSources:B.dsb.noderunner.audio?.stats.sources,radioStarts:B.dsb.noderunner.audio?.stats.starts,records:B.renderer.stats.records};})()`);
  const listenerCount=async()=>{
    const obj=await b.send("Runtime.evaluate",{expression:"document"});
    const result=await b.send("DOMDebugger.getEventListeners",{objectId:obj.result.result.objectId});
    await b.send("Runtime.releaseObject",{objectId:obj.result.result.objectId});return result.result.listeners.length;
  };
  const base=await snapshot(),listeners=await listenerCount();
  let cycles=1;
  for(;cycles<10;cycles++){await tap();await tap();}
  const end=await snapshot(),listenersEnd=await listenerCount();
  record("DSB interior: ten complete door cycles retain bounded nodes, geometry, handlers and audio sources",Object.keys(base).every(key=>key==="records"?end[key]<=base[key]:end[key]===base[key])&&listeners===listenersEnd,JSON.stringify({cycles,base,end,listeners,listenersEnd}));
  await b.evaluate('window.__interiorCheck.old=__ooga.dsb.interiors;__ooga.go("dsb",null,true);__ooga.advance(.05)');
  const clean=await b.evaluate('({rooms:__interiorCheck.old.rooms.size,audio:__interiorCheck.old.audio.stats.contexts,fresh:__ooga.dsb.interiors.rooms.size,visible:__ooga.dsb.exterior.visible})');
  record("DSB interior: scene departure releases the room and its AudioContext",clean.rooms===0&&clean.audio===0&&clean.fresh===0&&clean.visible,JSON.stringify(clean));
  await b.evaluate('delete window.__interiorCheck');
  record("DSB interior: runtime console remains clean",b.logs.length===0,b.logs.join(" | "));
}};
scene("dsb",{label:"interior checkpoint",query:"&view=meme-factory&weather=storm&time=1200",steps:[dsbInteriorCheckpoint]});
scene("dsb",{label:"interior checkpoint phone",query:"&view=meme-factory&weather=storm&time=1200",opts:{w:390,h:844,mobile:true},steps:[dsbInteriorCheckpoint]});

const dsbNatureCheckpoint = { name: "dsb nature checkpoint", why: "rule: terrain contact, deterministic layout, clear routes and bounded tier populations survive scene re-entry", run: async b => {
  const exterior=await b.evaluate(`(()=>{
    const D=__ooga.dsb,L=D.land,E=D.detail;let floating=0,buried=0,blocked=0,invalid=0;
    const geometries=new Set(),visit=n=>{if(n.geometry)geometries.add(n.geometry);for(const c of n.children)visit(c);};visit(E.group);
    for(const n of E.group.children)if(n.instanceData){const a=n.instanceData,v=n.geometry.verts;for(let o=0;o<a.length;o+=20){let top=-Infinity;for(let j=0;j<v.length;j+=3){const x=a[o]*v[j]+a[o+8]*v[j+2]+a[o+12],y=a[o+1]*v[j]+a[o+5]*v[j+1]+a[o+9]*v[j+2]+a[o+13],z=a[o+2]*v[j]+a[o+10]*v[j+2]+a[o+14];if(![x,y,z].every(Number.isFinite))invalid++;if(Math.abs(v[j+1])<.001&&y>L.heightAt(x,z)+.005)floating++;top=Math.max(top,y);}if(top<L.heightAt(a[o+12],a[o+14])+.06)buried++;}}
    for(const p of E.placements)if(p.region!=="pier")for(const line of [L.trail,L.waterfront,...L.lanes])for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*2);for(let j=0;j<=n;j++)if(Math.hypot(p.x-a[0]-(b[0]-a[0])*j/n,p.z-a[1]-(b[1]-a[1])*j/n)<p.r+1.5)blocked++;}
    window.__exteriorCheck={signature:JSON.stringify(E.placements),old:E};
    return {floating,buried,blocked,invalid,geometries:geometries.size,facades:E.facades.length,coast:E.placements.filter(p=>p.region==="coast").length,rear:E.placements.some(p=>p.region==="coast"&&p.x<0&&p.z<-28)};
  })()`);
  record("DSB exterior: seated props leave routes and rear Olympus clear with seven bounded facades",!exterior.floating&&!exterior.buried&&!exterior.blocked&&!exterior.invalid&&!exterior.rear&&exterior.facades===7&&exterior.coast>10&&exterior.geometries<65,JSON.stringify(exterior));
  const r=await b.evaluate(`(() => {
    const B=__ooga,D=B.dsb,N=D.nature,L=D.land;
    const signature=JSON.stringify(N.placements),counts={};let floating=0,buried=0,blocked=0,invalid=0;
    for(const f of N.fields) {
      counts[f.kind]=f.list.length;
      const v=f.node.geometry.verts,a=f.source;
      for(let i=0;i<f.list.length;i++) {
        const o=i*20,p=f.list[i];let top=-Infinity;
        for(let j=0;j<v.length;j+=3) {
          const x=a[o]*v[j]+a[o+8]*v[j+2]+a[o+12];
          const y=a[o+1]*v[j]+a[o+5]*v[j+1]+a[o+9]*v[j+2]+a[o+13];
          const z=a[o+2]*v[j]+a[o+10]*v[j+2]+a[o+14];
          if(![x,y,z].every(Number.isFinite))invalid++;
          if(Math.abs(v[j+1])<.001&&y>L.heightAt(x,z)+.005)floating++;
          top=Math.max(top,y);
        }
        if(top<L.heightAt(p.x,p.z)+.08)buried++;
        // Sample actual road/trail centre lines; no large silhouette can cross their walking surface.
        if(f.kind!=="bougainvillea"&&f.kind!=="planter")for(const line of [L.trail,L.waterfront,...L.lanes]) {
          for(let k=1;k<line.length;k++) {
            const from=line[k-1],to=line[k],steps=Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])*2);
            for(let q=0;q<=steps;q++)if(Math.hypot(p.x-from[0]-(to[0]-from[0])*q/steps,p.z-from[1]-(to[1]-from[1])*q/steps)<f.spec.r*p.scale+1.5)blocked++;
          }
        }
      }
    }
    const originalTier=B.renderer.quality,tiers={};
    for(const tier of ["high","medium","low"]) {
      B.renderer.setQuality(tier);N.update(0,0);
      tiers[tier]={visible:N.stats.visible,gulls:N.stats.gulls,trees:N.fields.slice(0,2).reduce((n,f)=>n+f.node.instanceCount,0)};
    }
    B.renderer.setQuality("high");N.update(0,0);const calm=N.stats.sway;
    D.weather.setMode("storm");for(let i=0;i<240;i++)BL.scenes.dsb.update(1/60,i/60);
    const windy=N.stats.sway>calm;
    D.weather.setMode("clear");B.renderer.setQuality(originalTier);
    // Rebuilding over a translated surface must translate roots, not retain fixed-Y scenery.
    const root=BL.scene.createNode(),raised={...L,heightAt:(x,z)=>L.heightAt(x,z)+2};
    const extra=BL.dsbNature.create({root,land:raised,renderer:B.renderer,camera:B.camera,weather:D.weather});
    const originals=new Map(N.placements.map(p=>[p.kind+":"+p.x+":"+p.z,p]));let matched=0,shifted=0;
    for(const p of extra.placements){const old=originals.get(p.kind+":"+p.x+":"+p.z);if(old){matched++;if(Math.abs(p.y-old.y-2)<1e-6)shifted++;}}
    extra.dispose();extra.dispose();
    window.__natureCheck={signature,old:N,oldRoot:BL.scenes.dsb.root};
    return {counts,floating,buried,blocked,invalid,tiers,windy,matched,shifted,disposed:root.children.length===0&&extra.group.children.length===0};
  })()`);
  record("DSB nature: every contact vertex is grounded, paths stay clear and transformed geometry stays finite",!r.floating&&!r.buried&&!r.blocked&&!r.invalid,JSON.stringify(r));
  record("DSB nature: surface changes move roots and disposal removes the whole bounded field",r.matched>500&&r.matched===r.shifted&&r.disposed,JSON.stringify(r));
  record("DSB nature: low tier retains trees, reduces detail and shares storm wind",r.tiers.high.visible>r.tiers.medium.visible&&r.tiers.medium.visible>r.tiers.low.visible&&r.tiers.low.trees>40&&r.tiers.low.gulls===0&&r.windy,JSON.stringify(r));
  for(let visit=0;visit<2;visit++) {
    await b.evaluate('__ooga.go("dsb",null,true);__ooga.advance(.05)');
    const state=await b.evaluate(`(()=>{const p=window.__natureCheck,n=__ooga.dsb.nature;return {same:JSON.stringify(n.placements)===p.signature,cleared:p.oldRoot.children.length===0&&p.old.group.children.length===0,fields:n.group.children.length,total:n.stats.total,textures:__ooga.renderer.stats.waterTextures};})()`);
    record(`DSB nature: visit ${visit+2} preserves seeded layout and releases old scene`,state.same&&state.cleared&&state.fields===10&&state.total>1000&&state.textures===2,JSON.stringify(state));
    const detail=await b.evaluate('({same:JSON.stringify(__ooga.dsb.detail.placements)===__exteriorCheck.signature,cleared:__exteriorCheck.old.group.children.length===0})');
    record(`DSB exterior: visit ${visit+2} releases dressing without duplicates`,detail.same&&detail.cleared,JSON.stringify(detail));
  }
  await b.evaluate('delete window.__natureCheck;delete window.__exteriorCheck');
  record("DSB nature: runtime console remains clean",b.logs.length===0,b.logs.join(" | "));
}};
scene("dsb",{label:"nature checkpoint",query:"&overview=1&weather=clear&time=1200",steps:[dsbNatureCheckpoint]});
scene("dsb",{label:"nature checkpoint phone",query:"&overview=1&weather=clear&time=1200",opts:{w:390,h:844,mobile:true},steps:[dsbNatureCheckpoint]});

const dsbStudioCheckpoint = {name:"dsb studio checkpoint",why:"playthrough: Studio seating preserves locomotion lock, aim/fire and throws; archive and environment dispose through repeated visits",run:async b=>{
  const step=()=>b.evaluate('for(let i=0;i<48;i++)BL.scenes.dsb.update(1/60,i/60)');
  const tap=async selector=>{
    const p=await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await b.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[p]});await b.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await step();
  };
  await b.key(" ");await step();
  const layout=await b.evaluate(`(()=>{const B=__ooga,D=B.dsb,R=D.interiors.active?.room;return {id:R?.id,seats:R?.seats.length,entry:R?.groundAt(0,17),lower:R?.groundAt(0,-6),stage:R?.groundAt(0,-12),exterior:D.exterior.visible,rain:D.weather.shared.state.drops,master:D.weather.shared.state.masterLevel,lights:R?.lighting.lightCount};})()`);
  record("Studio: correct door reveals upper entrance, descending room and isolated stage",layout.id==="dsb-studio"&&layout.seats===39&&layout.entry===3&&layout.lower===0&&layout.stage===.6&&!layout.exterior&&layout.rain===0&&layout.master===0&&layout.lights===3,JSON.stringify(layout));
  const routes=await b.evaluate(`(()=>{const B=__ooga,D=B.dsb,R=D.interiors.active.room,A=D.avatar,clear=(a,b)=>D.interiors.walkable(a[0],a[1],b[0],b[1],3,2,A);return {left:R.jukeboxAt.x<0,booth:clear([0,12],[5,12])&&clear([5,12],[5,15.5]),corridor:clear([0,17],[0,8.5]),balcony:clear([0,8.5],[13.5,8.5])&&clear([13.5,8.5],[12.5,6.8]),seats:R.seats.every(s=>clear([s.walkAt.x,s.walkAt.z],[s.walkAt.x,s.walkAt.z]))};})()`);
  record("Studio: left archive, enterable right booth, corridor and balcony approaches stay clear",Object.values(routes).every(Boolean),JSON.stringify(routes));
  const seatRoundTrip=await b.evaluate(`(()=>{const B=__ooga,R=B.dsb.interiors.active.room;return R.seats.every(s=>{B.pilot.navigate({position:{x:s.walkAt.x,y:s.floor,z:s.walkAt.z},yaw:s.viewYaw??0,pitch:.12,dist:3});return B.crew.sitPlayer(s)&&B.crew.standPlayer()&&!s.sitter;});})()`);
  record("Studio: every audience, balcony and stage seat sits and stands safely",seatRoundTrip);
  await b.evaluate('__ooga.pilot.navigate({position:{x:0,y:3,z:13},yaw:0,pitch:.12,dist:3})');
  await b.send("Input.dispatchKeyEvent",{type:"keyDown",key:"w",code:"KeyW"});await step();await b.send("Input.dispatchKeyEvent",{type:"keyUp",key:"w",code:"KeyW"});
  await tap("#act");await step();await step();
  const cues=await b.evaluate('__ooga.dsb.interiors.audio.stats');
  record("Studio: walking and jumping add no Studio-specific audio sources",cues.sources===3&&cues.contexts===1&&!cues.cues,JSON.stringify(cues));
  // Playback is deterministic here; a separate live smoke checks the real public source and media.
  await b.evaluate(`(()=>{
    window.__studioCheck={fetch:window.fetch,play:HTMLMediaElement.prototype.play,pause:HTMLMediaElement.prototype.pause,requests:0,plays:0,active:new Set()};
    const check=window.__studioCheck;
    window.fetch=(url,opts)=>{if(String(url).startsWith("https://hodlerhiq.net/")){check.requests++;return Promise.resolve(new Response(JSON.stringify({content:{rendered:[1,2,3].map(i=>'<div data-mediafile="https://hodlerhiq.net/wp-content/uploads/2026/fixture-'+i+'.mp3"><span class="player_song_name" data-albumname="2026-01-0'+i+'">Space '+i+'</span></div>').join("")}})));}return check.fetch(url,opts);};
    HTMLMediaElement.prototype.play=function(){Object.defineProperty(this,"paused",{configurable:true,value:false});check.plays++;check.active.add(this);this.dispatchEvent(new Event("play"));return Promise.resolve();};
    HTMLMediaElement.prototype.pause=function(){Object.defineProperty(this,"paused",{configurable:true,value:true});check.active.delete(this);this.dispatchEvent(new Event("pause"));};
  })()`);
  const listeners=async()=>{const a=await b.send("Runtime.evaluate",{expression:"document"}),r=await b.send("DOMDebugger.getEventListeners",{objectId:a.result.result.objectId});await b.send("Runtime.releaseObject",{objectId:a.result.result.objectId});return r.result.listeners.length;};
  const startListeners=await listeners();let baseline=null;
  for(let cycle=0;cycle<3;cycle++){
    if(cycle){await tap("#dsb-context");await step();}
    await b.evaluate(`(()=>{const B=__ooga,s=B.dsb.interiors.active.room.stageSeats[${cycle}];B.pilot.navigate({position:{x:s.walkAt.x,y:s.floor,z:s.walkAt.z},yaw:0,pitch:.12,dist:3});})()`);await step();await tap("#dsb-context");
    const seated=await b.evaluate('({seat:!!__ooga.dsb.avatar.camp.seat,leg:__ooga.dsb.avatar.parts.legL.rotation.x,p:{...__ooga.dsb.avatar.root.position},close:__ooga.pilot.closeWanted,yaw:__ooga.dsb.avatar.root.rotation.y})');
    await b.send("Input.dispatchKeyEvent",{type:"keyDown",key:"w",code:"KeyW"});await step();await b.send("Input.dispatchKeyEvent",{type:"keyUp",key:"w",code:"KeyW"});
    await tap("#weapon-hud");await tap("#weapon-hud");await tap(".dsb-studio-tools button");
    await b.evaluate('if(!__ooga.dsb.avatar.weapon.aiming)__ooga.pilot.modeAction("mode-toggle");__ooga.crew.look(2.7,.1,1)');await step();
    const fired=await b.evaluate('({seat:!!__ooga.dsb.avatar.camp.seat,p:{...__ooga.dsb.avatar.root.position},yaw:__ooga.dsb.avatar.root.rotation.y,shots:__ooga.dsb.avatar.weapon.shotsFired,throws:__ooga.crew.stats().tomatoesThrown,aim:__ooga.dsb.avatar.weapon.aiming,audio:__ooga.dsb.interiors.audio.stats})');
    record("Studio: seat "+cycle+" locks walking with seated pose and allows gun/throw controls",seated.seat&&seated.close&&seated.leg<-1.5&&Math.cos(seated.yaw)>.9&&fired.seat&&Math.hypot(fired.p.x-seated.p.x,fired.p.z-seated.p.z)<.001&&fired.shots>cycle&&fired.throws===cycle+1&&fired.aim&&fired.audio.sources===3&&!fired.audio.cues,JSON.stringify({seated,fired}));
    const standControls=await b.evaluate('Array.from(document.querySelectorAll("button")).filter(e=>/stand up/i.test(e.textContent)&&e.getClientRects().length&&getComputedStyle(e).visibility!=="hidden").length');
    record("Studio: seated control "+cycle+" has one stand action and no lighting button",standControls===1&&!await b.evaluate('Array.from(document.querySelectorAll("button")).some(e=>/stage lights|studio lights/i.test(e.textContent))'));
    await tap("#act");
    const stood=await b.evaluate('({seat:!!__ooga.dsb.avatar.camp.seat,close:__ooga.pilot.closeWanted,clear:__ooga.dsb.interiors.walkable(__ooga.dsb.avatar.root.position.x,__ooga.dsb.avatar.root.position.z,__ooga.dsb.avatar.root.position.x,__ooga.dsb.avatar.root.position.z,0,2,__ooga.dsb.avatar)})');
    record("Studio: touch stand "+cycle+" restores clear ground and follow camera",!stood.seat&&!stood.close&&stood.clear,JSON.stringify(stood));
    await b.evaluate('__ooga.pilot.navigate({position:__ooga.dsb.interiors.active.room.jukeboxAt,yaw:-Math.PI/2,pitch:.12,dist:3})');await step();await tap("#dsb-context");await b.sleep(80);
    await tap(".spaces-item");await tap(".dsb-spaces [data-next]");await tap(".dsb-spaces [data-prev]");await tap(".dsb-spaces [data-play]");
    const paused=await b.evaluate('!__ooga.dsb.spaces.stats.playing');await tap(".dsb-spaces [data-play]");await tap(".dsb-spaces [data-close]");
    await tap("#dsb-context");await tap(".dsb-spaces [data-close]");
    const audio=await b.evaluate('({stats:__ooga.dsb.spaces.stats,active:__studioCheck.active.size,requests:__studioCheck.requests})');
    record("Studio: archive "+cycle+" browses, pauses, resumes and reuses one player/cache",paused&&audio.stats.items===3&&audio.stats.playing&&audio.active===1&&audio.requests===cycle+1,JSON.stringify(audio));
    const localized=await b.evaluate(`(()=>{const B=__ooga,D=B.dsb,R=D.interiors.active.room,plays=__studioCheck.plays,near=D.spaces.stats.gain;B.pilot.navigate({position:{x:0,y:3,z:8.5},yaw:0,pitch:.12,dist:3});BL.scenes.dsb.update(1/60,0);const far=D.spaces.stats;B.pilot.navigate({position:R.jukeboxAt,yaw:Math.PI/2,pitch:.12,dist:3});BL.scenes.dsb.update(1/60,0);return {near,far,back:D.spaces.stats,plays:__studioCheck.plays-plays};})()`);
    record("Studio: archive "+cycle+" fades to silence in theater and returns without replay",localized.near>.9&&localized.far.gain===0&&localized.far.muted&&localized.far.playing&&localized.back.gain>.9&&!localized.back.muted&&localized.plays===0,JSON.stringify(localized));
    await b.evaluate('__ooga.pilot.navigate({position:__ooga.dsb.interiors.active.room.spawn,yaw:0,pitch:.22,dist:3})');await step();await tap("#dsb-context");
    const end=await b.evaluate(`(()=>{const B=__ooga,D=B.dsb;return {indoor:!!D.interiors.active,seat:!!D.avatar.camp.seat,spaces:D.spaces.stats,active:__studioCheck.active.size,weather:D.weather.state.exterior,trigger:D.avatar.weapon.triggerHeld,projectiles:B.crew.stats().projectiles,rooms:D.interiors.rooms.size,dom:document.querySelectorAll(".dsb-spaces").length,records:B.renderer.stats.records};})()`);
    record("Studio: exit "+cycle+" disposes playback, seat, projectiles and restores exterior",!end.indoor&&!end.seat&&end.spaces.media===0&&end.spaces.cached===0&&end.active===0&&end.weather&&!end.trigger&&end.projectiles===0&&end.dom===1,JSON.stringify(end));
    if(cycle===1)baseline=end;else if(cycle===2)record("Studio: warmed room records remain bounded",end.records<=baseline.records,JSON.stringify({baseline,end}));
  }
  record("Studio: repeated cycles retain one listener set",await listeners()===startListeners);
  const seats=await b.evaluate(`(()=>{const B=__ooga,R=B.dsb.interiors.rooms.get("dsb-studio");return R.seats.every(s=>!s.sitter);})()`);record("Studio: every seat releases occupancy",seats);
  await b.evaluate('window.fetch=__studioCheck.fetch;HTMLMediaElement.prototype.play=__studioCheck.play;HTMLMediaElement.prototype.pause=__studioCheck.pause;__studioCheck.old=__ooga.dsb.spaces;__ooga.go("bifrost",null,true);__ooga.advance(.05);__ooga.go("dsb",null,true);__ooga.advance(.05)');
  const fresh=await b.evaluate('({old:__studioCheck.old.stats,dialogs:document.querySelectorAll(".dsb-spaces").length,rooms:__ooga.dsb.interiors.rooms.size,seat:!!__ooga.dsb.avatar.camp.seat})');
  record("Studio: leaving DSB and reentering creates one clean archive controller",!fresh.old.active&&fresh.old.media===0&&fresh.dialogs===1&&fresh.rooms===0&&!fresh.seat,JSON.stringify(fresh));
  await b.evaluate('delete window.__studioCheck');
}};
scene("dsb",{label:"studio checkpoint",query:"&view=studio-door&weather=storm&time=1200",steps:[dsbStudioCheckpoint]});
scene("dsb",{label:"studio checkpoint phone",query:"&view=studio-door&weather=storm&time=1200",opts:{w:390,h:844,mobile:true},steps:[dsbStudioCheckpoint]});

const runTasks = async () => {
  const picked = tasks.filter((t) => (t.perf ? PERF : PICKED.includes(t.scene)));
  if (ONLY && (PICKED.length || PERF) && !picked.length) throw new Error(`No requested scene checks match ONLY=${ONLY}`);
  // The perf floor runs first and alone, so no other Chrome skews its frame timing.
  realTimeTask = true;
  for (const t of picked.filter((t) => t.perf)) await t.run();
  realTimeTask = false;
  const queue = picked.filter((t) => !t.perf);
  const lane = async () => {
    while (queue.length) await queue.shift().run();
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  await dispose();
};
if (!PICKED.length && !PERF) console.log(`Global tier only. Name scenes to test them too: npm test -- ${SCENES.join(" ")} | full`);
await runTasks();
// The shim installs browser globals in this process, so it runs after the browser lanes finish with Chrome.
if (UNIT) await unitChecks();
if (PROTOCOL) await pokerProtocolChecks();

// The ledger is the memory a session does not have: every failing check, how many runs in a row it has
// failed, since when, and its last detail; a pass clears it. Two failed runs in a row is a STOP.
const LEDGER = join(root, "untracked", "test-ledger.json");
let ledger = {};
try {
  ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
} catch {
  // No ledger yet.
}
const now = new Date().toISOString();
for (const r of results) {
  if (r.ok || r.open) delete ledger[r.name];
  else ledger[r.name] = { streak: (ledger[r.name]?.streak || 0) + 1, first: ledger[r.name]?.first || now, last: now, detail: r.detail.slice(0, 600) };
}
mkdirSync(dirname(LEDGER), { recursive: true });
writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");

const failed = results.filter((r) => !r.ok && !r.open), open = results.filter((r) => r.open);
if (retried.length) console.log(`\n${retried.length} session${retried.length === 1 ? "" : "s"} retried after an infrastructure error:\n${retried.map((r) => `  ${r}`).join("\n")}`);
console.log(`\n${results.length - failed.length - open.length}/${results.length} checks passed${open.length ? `, ${open.length} known open` : ""} in ${(performance.now() / 60000).toFixed(1)} min`);
const stuck = failed.filter((r) => ledger[r.name].streak >= 2);
if (stuck.length) console.log(`\nSTOP · these failed ${stuck.length === 1 ? "this run and the last" : "in consecutive runs"}; do not try another fix, hand them to the maintainer with untracked/test-ledger.json:\n${stuck.map((r) => `  ${r.name} (${ledger[r.name].streak} runs since ${ledger[r.name].first})`).join("\n")}`);
process.exit(failed.length ? 1 : 0);
