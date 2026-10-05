// The Ooga crew kept in step for signed-in players. The room elects one page showing the island as host
// (`net.state.hostId`): it runs the crew as always and, SEND_S apart, sends one binary frame with every
// Ooga nobody drives. Every other signed-in page on the island follows: those Oogas become puppets
// (`cave.puppet`, which makes crew.update skip their AI) and are eased toward the latest frame here, after
// the crew's update. An Ooga someone drives is never in a frame and never a puppet: the driver's page
// runs it and the others show it through remote-players.js. With no room, no host or when hosting, every
// Ooga runs its own AI as before.
//
// A frame: a Uint32 header [FORMAT, signature of the crew's names, record count, event bytes], one RECORD
// of floats per Ooga, then the events since the last frame as UTF-8 JSON. A record carries what shows:
// the body (root transform and visibility, legs, arms, head and eyes, torso), the gear (where the club and
// rifle hang and how, the rifle's bananas, the flash, the snack, the bed's weapons), status (stun birds,
// fire embers and scorch, colourway, a built-in jetpack's flame) and the work the gorillas follow (state,
// phase, cave, planned cave). Events are what happens once: speech, sleep marks, dust and sparks, every
// shot's flight, and the gorillas' plan and hit, so each page's gorillas react to the host's crew.
// Pages built from a different cast (signature) or format ignore each other's frames.
// Cost: the host sends only while the room reports followers (`net.state.followers`), and a frame whose
// records match the last one sent, with no events, waits up to KEEP_S before it goes again.
// One sync per hub visit: `create` after the crew, `update` after crew.update each frame, `dispose` in leave.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { quat, fnv1a } = BL.math;
  const { addChild, removeChild } = BL.scene;
  const FORMAT = 2, HEADER = 4, RECORD = 112, SEND_S = 0.25, KEEP_S = 2;
  const EASE = 8, SNAP = 4, EVENTS_MAX = 96, SAY_MAX = 120;
  const F_VISIBLE = 1, F_CLOSED = 2, F_ROOT_Q = 4, F_ARM_L_Q = 8, F_ARM_R_Q = 16, F_HEAD_Q = 32;
  const F_CLUB = 64, F_CLUB_Q = 128, F_GUN = 256, F_GUN_Q = 512, F_FLASH = 1024, F_SNACK = 2048;
  const F_STUNNED = 4096, F_FLAME = 8192, F_BED_GEAR = 16384, F_OUTDOOR_SLEEP = 32768;
  const BODY = ["torso", "head", "legL", "legR", "armL", "armR"];
  const STATES = ["working", "chilling", "sleeping", "away"];
  const PHASES = ["", "outbound", "station", "shoot", "return", "reload"];
  const encoder = new TextEncoder(), decoder = new TextDecoder();

  const wrap = (d) => Math.atan2(Math.sin(d), Math.cos(d));

  const create = ({ crew, fx, onPlan, onHit, onModelChange }) => {
    const net = BL.net;
    const list = crew.list.filter((cave) => !cave.contributor.temporary), n = list.length;
    const index = new Map(list.map((cave, i) => [cave, i]));
    const signature = fnv1a(list.map((cave) => cave.traits.name).join(",")) >>> 0;
    const out = new Float32Array(HEADER + n * RECORD), outHeader = new Uint32Array(out.buffer, 0, HEADER);
    const target = new Float32Array(n * RECORD), sent = new Float32Array(HEADER + n * RECORD);
    const have = new Uint8Array(n), fresh = new Uint8Array(n);
    // Each puppet's own quaternions: the crew's are never written from here.
    const quats = list.map(() => ({ root: quat.create(), armL: quat.create(), armR: quat.create(), head: quat.create(), club: quat.create(), gun: quat.create() }));
    const TQ = quat.create();
    let role = "solo", sendIn = 0, sinceSent = 0, sentFloats = -1, seen = -1, frames = 0, events = [];

    const driven = (cave) => cave === crew.player || !!cave.remoteControlled;
    const holders = (cave) => [cave.parts.armL, cave.parts.armR, cave.root, cave.sleepWeapons];
    const holderCode = (cave, node) => {
      const h = holders(cave);
      for (let c = 0; c < h.length; c++) if (node.parent === h[c]) return c;
      return 4;
    };

    // Host: what happens once, recorded for the next frame. Only Oogas the frame carries count.
    const record = (event) => {
      if (role === "host" && events.length < EVENTS_MAX) events.push(event);
    };
    const npcIndex = (cave) => {
      const i = cave ? index.get(cave) : undefined;
      return i === undefined || driven(cave) ? -1 : i;
    };
    // The crew's effects go through this: the page sees them as always, and the host notes them.
    const recordingFx = Object.create(fx);
    recordingFx.say = (cave, text, dur) => {
      const i = npcIndex(cave);
      if (i >= 0) record({ k: "say", i, text: String(text).slice(0, SAY_MAX), dur });
      return fx.say(cave, text, dur);
    };
    recordingFx.zzzAt = (x, y, z, cave) => {
      const i = npcIndex(cave);
      if (i >= 0) record({ k: "z", i, x, y, z });
      return fx.zzzAt(x, y, z, cave);
    };
    recordingFx.burst = (x, y, z, count, geos, speed) => {
      const kind = geos === BL.crew.LAND_DUST ? "dust" : geos === BL.crew.JET_SPARKS ? "sparks" : "";
      if (kind) record({ k: "b", kind, x, y, z, count, speed });
      return fx.burst(x, y, z, count, geos, speed);
    };
    const recordShot = (cave, from, to) => {
      const i = npcIndex(cave);
      if (i >= 0) record({ k: "shot", i, a: [from.x, from.y, from.z, to.x, to.y, to.z] });
    };
    const recordPlan = (cave, site) => {
      const i = npcIndex(cave);
      if (i >= 0) record({ k: "plan", i, site });
    };
    const recordHit = (cave) => {
      const i = npcIndex(cave);
      if (i >= 0) record({ k: "hit", i });
    };

    const writeQuat = (o, q) => {
      if (!q) return false;
      out[o] = q[0]; out[o + 1] = q[1]; out[o + 2] = q[2]; out[o + 3] = q[3];
      return true;
    };
    const writeXYZ = (o, v) => {
      out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z;
    };
    const encodeCave = (o, i, cave) => {
      const r = cave.root, p = cave.parts;
      let flags = 0;
      if (r.visible) flags |= F_VISIBLE;
      if (p.head.geometry === cave.headClosed) flags |= F_CLOSED;
      out[o] = i;
      writeXYZ(o + 2, r.position); writeXYZ(o + 5, r.rotation);
      if (writeQuat(o + 8, r.quaternion)) flags |= F_ROOT_Q;
      writeXYZ(o + 12, r.scale);
      out[o + 15] = p.legL.rotation.x; out[o + 16] = p.legL.rotation.z;
      out[o + 17] = p.legR.rotation.x; out[o + 18] = p.legR.rotation.z;
      writeXYZ(o + 19, p.armL.rotation);
      if (writeQuat(o + 22, p.armL.quaternion)) flags |= F_ARM_L_Q;
      writeXYZ(o + 26, p.armR.rotation);
      if (writeQuat(o + 29, p.armR.quaternion)) flags |= F_ARM_R_Q;
      writeXYZ(o + 33, p.head.rotation); writeXYZ(o + 36, p.head.position);
      if (writeQuat(o + 39, p.head.quaternion)) flags |= F_HEAD_Q;
      out[o + 43] = p.torso.scale.y; out[o + 44] = p.torso.rotation.x; out[o + 45] = p.torso.rotation.z;
      writeXYZ(o + 46, p.armL.position); writeXYZ(o + 49, p.armR.position);
      out[o + 52] = holderCode(cave, p.club); writeXYZ(o + 53, p.club.position); writeXYZ(o + 56, p.club.rotation);
      if (p.club.visible) flags |= F_CLUB;
      if (writeQuat(o + 59, p.club.quaternion)) flags |= F_CLUB_Q;
      out[o + 63] = holderCode(cave, p.gun); writeXYZ(o + 64, p.gun.position); writeXYZ(o + 67, p.gun.rotation);
      if (p.gun.visible) flags |= F_GUN;
      if (writeQuat(o + 70, p.gun.quaternion)) flags |= F_GUN_Q;
      let mask = 0;
      for (let b = 0; b < p.gunBananas.length; b++) if (p.gunBananas[b].visible) mask |= 1 << b;
      out[o + 74] = mask;
      if (p.gunFlash.visible) flags |= F_FLASH;
      if (p.snack.visible) flags |= F_SNACK;
      out[o + 75] = p.snack.scale.x;
      writeXYZ(o + 76, cave.sleepWeapons.position); writeXYZ(o + 79, cave.sleepWeapons.rotation);
      if (cave.sleepWeapons.visible) flags |= F_BED_GEAR;
      if (cave.state === "sleeping" && cave.bedroll?.outdoor) flags |= F_OUTDOOR_SLEEP;
      for (let b = 0; b < BODY.length; b++) {
        const node = p[BODY[b]];
        out[o + 82 + b] = node.ember || 0;
        out[o + 88 + b] = node.scorch || 0;
      }
      out[o + 94] = p.chuk ? p.chuk.rotation.x : 0;
      out[o + 95] = p.jetFlame ? p.jetFlame.scale.y : 0;
      if (p.jetFlame && p.jetFlame.visible) flags |= F_FLAME;
      if (cave.stunBirds.visible) flags |= F_STUNNED;
      out[o + 96] = STATES.indexOf(cave.state);
      out[o + 97] = PHASES.indexOf(cave.work.phase);
      out[o + 98] = cave.work.site;
      out[o + 99] = cave.work.plannedSite;
      out[o + 100] = cave.tintState || 0;
      out[o + 1] = flags;
    };
    const encode = () => {
      let k = 0;
      for (let i = 0; i < n; i++) {
        const cave = list[i];
        if (driven(cave)) continue;
        encodeCave(HEADER + k * RECORD, i, cave);
        k++;
      }
      const floats = HEADER + k * RECORD, bytes = floats * 4;
      // Nothing moved and nothing happened: skip, but not for longer than KEEP_S.
      if (!events.length && floats === sentFloats && sinceSent < KEEP_S) {
        let same = true;
        for (let i = HEADER; i < floats; i++) if (out[i] !== sent[i]) { same = false; break; }
        if (same) return;
      }
      for (let i = HEADER; i < floats; i++) sent[i] = out[i];
      sentFloats = floats;
      sinceSent = 0;
      const tail = events.length ? encoder.encode(JSON.stringify(events)) : null;
      events = [];
      outHeader[0] = FORMAT; outHeader[1] = signature; outHeader[2] = k; outHeader[3] = tail ? tail.length : 0;
      if (!tail) {
        net.sendNpc(new Uint8Array(out.buffer, 0, bytes));
        return;
      }
      const frame = new Uint8Array(bytes + tail.length);
      frame.set(new Uint8Array(out.buffer, 0, bytes));
      frame.set(tail, bytes);
      net.sendNpc(frame);
    };

    const replay = (event) => {
      const cave = event.i >= 0 && event.i < n ? list[event.i] : null;
      if (event.k === "b") {
        const geos = event.kind === "dust" ? BL.crew.LAND_DUST : event.kind === "sparks" ? BL.crew.JET_SPARKS : null;
        if (geos) fx.burst(+event.x, +event.y, +event.z, Math.min(24, +event.count || 0), geos, +event.speed || 1);
        return;
      }
      if (!cave || !cave.puppet) return;
      if (event.k === "say" && typeof event.text === "string") fx.say(cave, event.text.slice(0, SAY_MAX), Math.min(8, +event.dur || 2));
      else if (event.k === "z") fx.zzzAt(+event.x, +event.y, +event.z, cave);
      else if (event.k === "shot" && Array.isArray(event.a) && event.a.length === 6) crew.showShot(cave, +event.a[0], +event.a[1], +event.a[2], +event.a[3], +event.a[4], +event.a[5]);
      else if (event.k === "plan" && Number.isInteger(event.site)) onPlan(cave, event.site);
      else if (event.k === "hit") onHit(cave);
    };

    const decode = (buffer) => {
      if (!buffer || buffer.byteLength < HEADER * 4) return;
      const header = new Uint32Array(buffer, 0, HEADER);
      const count = header[2], eventBytes = header[3], recordBytes = (HEADER + count * RECORD) * 4;
      if (header[0] !== FORMAT || header[1] !== signature || count > n || buffer.byteLength !== recordBytes + eventBytes) return;
      const f = new Float32Array(buffer, 0, recordBytes / 4);
      for (let k = 0; k < count; k++) {
        const o = HEADER + k * RECORD, i = f[o];
        if (!(i >= 0 && i < n)) continue;
        target.set(f.subarray(o, o + RECORD), i * RECORD);
        if (!have[i]) fresh[i] = 1;
        have[i] = 1;
      }
      frames++;
      if (!eventBytes) return;
      let list_;
      try {
        list_ = JSON.parse(decoder.decode(new Uint8Array(buffer, recordBytes, eventBytes)));
      } catch {
        return;
      }
      if (!Array.isArray(list_)) return;
      // Poses first, then the events, so a shot leaves from where the rifle now is.
      pendingEvents = list_.slice(0, EVENTS_MAX);
    };
    let pendingEvents = null;

    // A quaternion eased toward the frame's, or dropped (back to the Euler rotation) when the frame has none.
    const poseQuat = (node, own, t, o, on, k) => {
      if (!on) {
        if (node.quaternion === own) node.quaternion = null;
        return;
      }
      if (node.quaternion !== own) {
        node.quaternion = own;
        own[0] = t[o]; own[1] = t[o + 1]; own[2] = t[o + 2]; own[3] = t[o + 3];
        return;
      }
      TQ[0] = t[o]; TQ[1] = t[o + 1]; TQ[2] = t[o + 2]; TQ[3] = t[o + 3];
      quat.slerpTo(own, TQ, k);
    };
    const easeAngles = (rot, t, o, k) => {
      rot.x += wrap(t[o] - rot.x) * k; rot.y += wrap(t[o + 1] - rot.y) * k; rot.z += wrap(t[o + 2] - rot.z) * k;
    };
    const easeXYZ = (v, t, o, k) => {
      v.x += (t[o] - v.x) * k; v.y += (t[o + 1] - v.y) * k; v.z += (t[o + 2] - v.z) * k;
    };
    // Gear hangs where the host has it: a hand, the back sling (the root) or the bed's weapons.
    const holdIn = (cave, node, code) => {
      if (!(code >= 0 && code <= 3)) return false;
      const want = holders(cave)[code];
      if (node.parent === want) return false;
      if (node.parent) removeChild(node.parent, node);
      addChild(want, node);
      return true;
    };

    const apply = (i, cave, dt) => {
      const t = target, o = i * RECORD, r = cave.root, p = cave.parts, q = quats[i];
      const flags = t[o + 1];
      const far = fresh[i] || Math.hypot(t[o + 2] - r.position.x, t[o + 3] - r.position.y, t[o + 4] - r.position.z) > SNAP;
      const k = far ? 1 : 1 - Math.exp(-EASE * dt);
      fresh[i] = 0;
      r.visible = (flags & F_VISIBLE) !== 0;
      easeXYZ(r.position, t, o + 2, k);
      easeAngles(r.rotation, t, o + 5, k);
      poseQuat(r, q.root, t, o + 8, (flags & F_ROOT_Q) !== 0, k);
      r.scale.x = t[o + 12]; r.scale.y = t[o + 13]; r.scale.z = t[o + 14];
      p.legL.rotation.x += wrap(t[o + 15] - p.legL.rotation.x) * k; p.legL.rotation.z += wrap(t[o + 16] - p.legL.rotation.z) * k;
      p.legR.rotation.x += wrap(t[o + 17] - p.legR.rotation.x) * k; p.legR.rotation.z += wrap(t[o + 18] - p.legR.rotation.z) * k;
      easeAngles(p.armL.rotation, t, o + 19, k);
      poseQuat(p.armL, q.armL, t, o + 22, (flags & F_ARM_L_Q) !== 0, k);
      easeAngles(p.armR.rotation, t, o + 26, k);
      poseQuat(p.armR, q.armR, t, o + 29, (flags & F_ARM_R_Q) !== 0, k);
      easeAngles(p.head.rotation, t, o + 33, k);
      easeXYZ(p.head.position, t, o + 36, k);
      poseQuat(p.head, q.head, t, o + 39, (flags & F_HEAD_Q) !== 0, k);
      const head = (flags & F_CLOSED) !== 0 ? cave.headClosed : cave.headOpen;
      if (p.head.geometry !== head) p.head.geometry = head;
      p.torso.scale.y = t[o + 43];
      p.torso.rotation.x += wrap(t[o + 44] - p.torso.rotation.x) * k; p.torso.rotation.z += wrap(t[o + 45] - p.torso.rotation.z) * k;
      easeXYZ(p.armL.position, t, o + 46, k);
      easeXYZ(p.armR.position, t, o + 49, k);
      // Gear: a change of holder moves the node, and the mirror and outlines learn the new shape.
      let moved = holdIn(cave, p.club, t[o + 52]);
      moved = holdIn(cave, p.gun, t[o + 63]) || moved;
      const gearK = moved ? 1 : k;
      p.club.visible = (flags & F_CLUB) !== 0;
      easeXYZ(p.club.position, t, o + 53, gearK); easeAngles(p.club.rotation, t, o + 56, gearK);
      poseQuat(p.club, q.club, t, o + 59, (flags & F_CLUB_Q) !== 0, gearK);
      p.gun.visible = (flags & F_GUN) !== 0;
      easeXYZ(p.gun.position, t, o + 64, gearK); easeAngles(p.gun.rotation, t, o + 67, gearK);
      poseQuat(p.gun, q.gun, t, o + 70, (flags & F_GUN_Q) !== 0, gearK);
      const mask = t[o + 74];
      for (let b = 0; b < p.gunBananas.length; b++) p.gunBananas[b].visible = (mask & (1 << b)) !== 0;
      p.gunFlash.visible = (flags & F_FLASH) !== 0;
      p.snack.visible = (flags & F_SNACK) !== 0;
      p.snack.scale.x = p.snack.scale.y = p.snack.scale.z = t[o + 75];
      const bed = cave.sleepWeapons;
      bed.visible = (flags & F_BED_GEAR) !== 0;
      const outdoor = (flags & F_OUTDOOR_SLEEP) !== 0;
      if (outdoor || cave.remoteOutdoorSleep) {
        for (const node of cave.sleepParts.equipment) node.visible = STATES[t[o + 96]] !== "sleeping";
        for (const node of cave.swagNodes) node.visible = !outdoor;
        for (const model of cave.magazineModels) if (model) model.node.visible = !outdoor;
        if (cave.jet) cave.jet.node.visible = !outdoor;
      }
      cave.remoteOutdoorSleep = outdoor;
      easeXYZ(bed.position, t, o + 76, gearK); easeAngles(bed.rotation, t, o + 79, gearK);
      for (let b = 0; b < BODY.length; b++) {
        const node = p[BODY[b]];
        node.ember = t[o + 82 + b];
        node.scorch = t[o + 88 + b];
      }
      if (p.chuk) p.chuk.rotation.x = t[o + 94];
      if (p.jetFlame) {
        p.jetFlame.visible = (flags & F_FLAME) !== 0;
        p.jetFlame.scale.y = t[o + 95];
      }
      cave.stunBirds.visible = (flags & F_STUNNED) !== 0;
      if (cave.stunBirds.visible) cave.stunBirds.rotation.y += dt * 4;
      crew.setTint(cave, t[o + 100]);
      // The work the gorillas read: state, phase, the cave worked and the one planned.
      const state = STATES[t[o + 96]], phase = PHASES[t[o + 97]];
      if (state !== undefined) cave.state = state;
      if (phase !== undefined) cave.work.phase = phase;
      cave.work.site = t[o + 98];
      cave.work.plannedSite = t[o + 99];
      if (moved) onModelChange(cave);
    };

    const release = () => {
      for (let i = 0; i < n; i++) list[i].puppet = false;
      have.fill(0);
      fresh.fill(0);
      pendingEvents = null;
    };

    /** Once a frame, after crew.update: host sends, follower poses its puppets, solo does nothing. */
    const update = (dt) => {
      const st = net.state;
      const next = st.room !== "live" || !st.hostId ? "solo" : st.hostId === st.selfId ? "host" : "follow";
      if (next !== role) {
        // Leaving follow hands the Oogas back to their own AI where they stand; a new host sends at once.
        if (role === "follow") release();
        role = next;
        sendIn = 0;
        sentFloats = -1;
        seen = -1;
        events = [];
      }
      if (role === "host") {
        // Nobody follows: nothing to send, and nothing saved up for later.
        if (!st.followers) {
          sendIn = 0;
          sentFloats = -1;
          events.length = 0;
          return;
        }
        sinceSent += dt;
        sendIn -= dt;
        if (sendIn <= 0) {
          sendIn = SEND_S;
          encode();
        }
        return;
      }
      if (role !== "follow") return;
      if (st.npcVersion !== seen) {
        seen = st.npcVersion;
        decode(net.npcFrame);
      }
      for (let i = 0; i < n; i++) {
        const cave = list[i];
        if (driven(cave)) {
          cave.puppet = false;
          continue;
        }
        cave.puppet = true;
        if (have[i]) apply(i, cave, dt);
      }
      if (pendingEvents) {
        const replaying = pendingEvents;
        pendingEvents = null;
        for (let e = 0; e < replaying.length; e++) if (replaying[e] && typeof replaying[e] === "object") replay(replaying[e]);
      }
    };

    const dispose = () => {
      release();
      role = "solo";
      events = [];
    };

    return { update, dispose, fx: recordingFx, recordShot, recordPlan, recordHit, get role() { return role; }, get frames() { return frames; } };
  };

  BL.npcSync = { create, FORMAT, RECORD };
})();
