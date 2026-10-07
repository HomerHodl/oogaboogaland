// Other signed-in visitors on the island, as the Oogas they drive. Each one in `BL.net.remotes` with a
// body gets a caveman built from that Ooga's traits (`models.caveman`, geometry shared with the crew's),
// eased toward the room's 15 Hz poses with a walk cycle while it moves, and a nameplate. The crew's own
// copy of that Ooga is sent `away` while someone else drives it, so no Ooga stands twice, and comes back
// when they let go; meanwhile its roster row shows the driver online (`remoteControlled`, the green dot).
// The crew walks round remote bodies through `actors`, its `outsideActors`.
// Who is shown is the scene's `visible(rec)`: the island shows players in its own zone (`onIsland` names the
// island's places), every other scene those in its zone (`sameZone`). The crew is optional, for a scene that
// has none until the visitor drives, and `hide(name, on)` lets a scene hide its own decor copy of an Ooga
// someone drives. A nameplate carries the name, a health bar from the room's `hp` (red while knocked out) and,
// for a player in voice, the speaker: green while speaking, red with a cross when they muted their microphone.
// One pool per scene visit: `create` in enter, `dispose` in leave, before the crew's.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { addChild, removeChild } = BL.scene;
  const MAX = 32;
  const EASE = 10;
  const SNAP = 8;
  const WALK_SPEED = 0.35;
  const NAME_FONT = "bold 11px ui-monospace, monospace";
  // The crew keeps remote bodies at this height for walking round them.
  const BODY_HEIGHT = 2.2;
  // Nameplate parts, in CSS pixels: the health bar under the name, the 9-pixel speaker right of it.
  const BAR_W = 32, BAR_H = 4, BAR_GAP = 3, ICON_GAP = 4;
  const NAME_STROKE = "rgba(20, 14, 8, 0.85)", NAME_FILL = "#f3efe4", BAR_TRACK = "rgba(0, 0, 0, 0.55)";
  const BAR_FILL = "#d8892b", BAR_KO = "#e5533d", ICON_IDLE = "#a6a6a2", ICON_SPEAKING = "#22c55e", ICON_MUTED = "#e5533d";
  // x, y, w, h runs on the speaker's 9x9 grid, as the roster's voice mark draws it.
  const SPEAKER = [0, 3, 2, 3, 2, 2, 1, 5, 3, 1, 1, 7];
  const WAVES = [5, 3, 1, 3, 7, 2, 1, 5];
  const CROSS = [5, 3, 1, 1, 7, 3, 1, 1, 6, 4, 1, 1, 5, 5, 1, 1, 7, 5, 1, 1];
  const runs = (ctx, cells, x, y) => {
    for (let i = 0; i < cells.length; i += 4) ctx.fillRect(x + cells[i], y + cells[i + 1], cells[i + 2], cells[i + 3]);
  };

  // The island's own places share its coordinates: every zone without a `.place`, apart from nowhere, the games
  // (`scene-*`) and DSB Land.
  const onIsland = (zone) => typeof zone === "string" && zone !== "none" && zone.indexOf(".") < 0 && !zone.startsWith("scene-") && !zone.startsWith("dsb-");
  const sameZone = (rec) => rec.zone === BL.net.state.zone;

  // `posed(cave, feetY)` lets the scene finish a body's pose once it stands where the room says: the hub sets a
  // swimmer's arms by it, from the position the pose transport already carries, with no simulation of its own.
  const create = ({ root, crew = null, posed = null, visible = sameZone, hide = null }) => {
    const net = BL.net;
    const bodies = new Map();
    const actorPool = Array.from({ length: MAX }, () => ({ x: 0, y: 0, z: 0 }));
    const actorList = [];

    // The crew's Ooga of this name goes away while a remote drives it; its own override comes back after.
    const hideLocal = (entry) => {
      if (hide) hide(entry.name, true);
      if (!crew) return;
      const cave = crew.cavemen.get(entry.name);
      if (!cave || cave === crew.player) return;
      entry.hidden = cave;
      entry.hiddenOverride = cave.override;
      cave.override = "away";
      cave.remoteControlled = true;
      crew.refreshStates();
    };
    const restoreLocal = (entry) => {
      if (hide) hide(entry.name, false);
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
        entry.cave.root.visible = visible(rec) && !(crew && crew.player && crew.player.traits.name === entry.name);
        if (!entry.cave.root.visible) continue;
        const actor = actorPool[n++];
        actor.x = entry.x; actor.y = entry.y; actor.z = entry.z;
      }
      actorList.length = 0;
      for (let i = 0; i < n; i++) actorList.push(actorPool[i]);
    };

    const actors = () => actorList;

    // Nameplates on the overlay, above each head, in the order the room sent them: the name, the health bar
    // under it and the speaker right of the bar.
    const drawNames = (ctx, project) => {
      if (!bodies.size) return;
      ctx.save();
      ctx.font = NAME_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      for (const entry of bodies.values()) {
        const rec = net.remotes.get(entry.id);
        if (!rec || !entry.cave.root.visible) continue;
        const pos = project(entry.x, entry.y + entry.cave.traits.height * 2 + 0.35, entry.z);
        if (!pos) continue;
        const x = Math.round(pos.x), y = Math.round(pos.y);
        ctx.strokeStyle = NAME_STROKE;
        ctx.fillStyle = NAME_FILL;
        ctx.strokeText(rec.display, x, y);
        ctx.fillText(rec.display, x, y);
        const left = x - BAR_W / 2, top = y + BAR_GAP;
        ctx.fillStyle = NAME_STROKE;
        ctx.fillRect(left - 1, top - 1, BAR_W + 2, BAR_H + 2);
        ctx.fillStyle = BAR_TRACK;
        ctx.fillRect(left, top, BAR_W, BAR_H);
        ctx.fillStyle = rec.ko ? BAR_KO : BAR_FILL;
        ctx.fillRect(left, top, Math.round(BAR_W * Math.max(0, Math.min(100, rec.hp)) / 100), BAR_H);
        if (!rec.voice) continue;
        const ix = left + BAR_W + ICON_GAP, iy = top + BAR_H / 2 - 4.5;
        ctx.fillStyle = rec.muted ? ICON_MUTED : BL.voice.speaking(rec.id) ? ICON_SPEAKING : ICON_IDLE;
        runs(ctx, SPEAKER, ix, iy);
        runs(ctx, rec.muted ? CROSS : WAVES, ix, iy);
      }
      ctx.restore();
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

  BL.remotePlayers = { create, onIsland, sameZone, MAX, BODY_HEIGHT };
})();
