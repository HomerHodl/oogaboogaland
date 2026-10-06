// Other signed-in visitors on the island, as the Oogas they drive. Each one in `BL.net.remotes` with a
// body gets a caveman built from that Ooga's traits (`models.caveman`, geometry shared with the crew's),
// eased toward the room's 15 Hz poses with a walk cycle while it moves, and a nameplate. The crew's own
// copy of that Ooga is sent `away` while someone else drives it, so no Ooga stands twice, and comes back
// when they let go; meanwhile its roster row shows the driver online (`remoteControlled`, the green dot).
// The crew walks round remote bodies through `actors`, its `outsideActors`.
// One pool per hub visit: `create` in enter, `dispose` in leave, before the crew's.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { addChild, removeChild } = BL.scene;
  const MAX = 32;
  const EASE = 10;
  const SNAP = 8;
  const WALK_SPEED = 0.35;
  const NAME_FONT = "bold 11px ui-monospace, monospace";

  // `posed(cave, feetY)` lets the scene finish a body's pose once it stands where the room says: the hub sets a
  // swimmer's arms by it, from the position the pose transport already carries, with no simulation of its own.
  const hubZone = rec => rec.zone === "outside" || rec.zone === "hq" || rec.zone?.startsWith("cave-");
  const create = ({ root, crew, posed = null, visible = hubZone }) => {
    const net = BL.net;
    const bodies = new Map();
    const actorPool = Array.from({ length: MAX }, () => ({ x: 0, y: 0, z: 0 }));
    const actorList = [];

    // The crew's Ooga of this name goes away while a remote drives it; its own override comes back after.
    const hideLocal = (entry) => {
      const cave = crew.cavemen.get(entry.name);
      if (!cave || cave === crew.player) return;
      entry.hidden = cave;
      entry.hiddenOverride = cave.override;
      cave.override = "away";
      cave.remoteControlled = true;
      crew.refreshStates();
    };
    const restoreLocal = (entry) => {
      const cave = entry.hidden;
      if (!cave) return;
      entry.hidden = null;
      cave.override = entry.hiddenOverride;
      cave.remoteControlled = false;
      // Settled in place: a walk back in from away assumes a work slot, and a chilling Ooga has none.
      crew.refreshStates(true);
    };

    const build = (rec) => {
      const cave = BL.models.caveman(BL.contributors.traitsFor(rec.body));
      const parts = cave.parts;
      for (const key of ["snack", "gun", "jetpack", "jetFlame"]) if (parts[key]) parts[key].visible = false;
      addChild(root, cave.root);
      const entry = { id: rec.id, name: rec.body, cave, baseY: cave.root.position.y, x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, phase: 0, hidden: null, hiddenOverride: null };
      bodies.set(rec.id, entry);
      hideLocal(entry);
      return entry;
    };

    const drop = (entry) => {
      removeChild(root, entry.cave.root);
      restoreLocal(entry);
      bodies.delete(entry.id);
    };

    const pose = (entry, dt) => {
      const { cave } = entry;
      const parts = cave.parts;
      const moved = Math.hypot(entry.dx, entry.dz) / Math.max(dt, 1e-3);
      if (moved > WALK_SPEED) {
        entry.phase += dt * 10;
        const swing = Math.sin(entry.phase);
        parts.legL.rotation.x = swing * 0.55;
        parts.legR.rotation.x = -swing * 0.55;
        parts.armL.rotation.x = -0.2 - swing * 0.3;
        parts.armR.rotation.x = -0.2 + swing * 0.3;
      } else {
        entry.phase = 0;
        parts.legL.rotation.x = parts.legR.rotation.x = 0;
        parts.armL.rotation.x = parts.armR.rotation.x = -0.2;
      }
      cave.root.position.x = entry.x;
      cave.root.position.y = entry.y + entry.baseY + Math.abs(Math.sin(entry.phase)) * 0.04;
      cave.root.position.z = entry.z;
      cave.root.rotation.y = entry.yaw;
    };

    const update = (dt) => {
      for (const entry of bodies.values()) {
        const rec = net.remotes.get(entry.id);
        if (!rec || rec.body !== entry.name) drop(entry);
      }
      const k = 1 - Math.exp(-EASE * dt);
      let n = 0;
      for (const rec of net.remotes.values()) {
        if (!rec.body) continue;
        let entry = bodies.get(rec.id);
        if (!entry) {
          if (bodies.size >= MAX) continue;
          entry = build(rec);
        }
        const far = Math.hypot(rec.x - entry.x, rec.y - entry.y, rec.z - entry.z) > SNAP;
        const t = far ? 1 : k;
        entry.dx = (rec.x - entry.x) * t;
        entry.dz = (rec.z - entry.z) * t;
        entry.x += entry.dx;
        entry.y += (rec.y - entry.y) * t;
        entry.z += entry.dz;
        entry.yaw += Math.atan2(Math.sin(rec.yaw - entry.yaw), Math.cos(rec.yaw - entry.yaw)) * t;
        if (far) entry.dx = entry.dz = 0;
        pose(entry, dt);
        if (posed) posed(entry.cave, entry.cave.root.position.y - entry.baseY);
        entry.cave.root.visible = visible(rec) && crew.player?.traits.name !== entry.name;
        if (!entry.cave.root.visible) continue;
        const actor = actorPool[n++];
        actor.x = entry.x; actor.y = entry.y; actor.z = entry.z;
      }
      actorList.length = 0;
      for (let i = 0; i < n; i++) actorList.push(actorPool[i]);
    };

    const actors = () => actorList;

    // Nameplates on the overlay, above each head, in the order the room sent them.
    const drawNames = (ctx, project) => {
      if (!bodies.size) return;
      ctx.font = NAME_FONT;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(20, 14, 8, 0.85)";
      ctx.fillStyle = "#f3efe4";
      for (const entry of bodies.values()) {
        const rec = net.remotes.get(entry.id);
        if (!rec || !entry.cave.root.visible) continue;
        const pos = project(entry.x, entry.y + entry.cave.traits.height * 2 + 0.35, entry.z);
        if (!pos) continue;
        ctx.strokeText(rec.display, pos.x, pos.y);
        ctx.fillText(rec.display, pos.x, pos.y);
      }
    };

    const liveGeometry = (set) => {
      for (const entry of bodies.values()) set.add(entry.cave.headOpen).add(entry.cave.headClosed);
    };

    const stats = () => ({ remotePlayers: actorList.length, reservedPlayers: bodies.size });

    const dispose = () => {
      for (const entry of [...bodies.values()]) drop(entry);
      actorList.length = 0;
    };

    return { update, actors, drawNames, liveGeometry, stats, dispose };
  };

  BL.remotePlayers = { create, MAX };
})();
