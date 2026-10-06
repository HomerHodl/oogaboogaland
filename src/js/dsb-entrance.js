// DSB Land's way in from ₿IFRÖST: the wormhole between the two gates, then the arrival. The visitor walks the
// passage (forward on the keys or the stick) while the four entrance recordings play, light dragging behind every
// step, comes out of the Portara on Olympus in a flash, and is flown once round the island before the walk begins.
// Skip leaves either part. The passage hangs far above the island and draws alone under its own render options, so
// the island's layers know nothing of it; the camera is taken through the pilot's external control. Visual and
// audio only, and allocation-free once built.
(() => {
  "use strict";
  const BL = window.BL, S = BL.scene, M = BL.models, rgb = BL.math.hexToRgb;
  const TAU = Math.PI * 2, LENGTH = 64, Y0 = 200, QUIET_SECONDS = 24, STEP_OUT = 1.6;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const node = (parent, geometry, x, y, z) => {
    const n = S.createNode({ geometry, position: { x, y, z }, sightHidden: true });
    S.addChild(parent, n);
    return n;
  };
  const noShadow = (g) => { g.castShadow = false; return g; };
  // A ribbon of light along +x that swells from nothing, then thins and fades to nothing at its far end: two crossed
  // blades drawn in the glass pass as a light beam, so it glows, blooms and never hides what is behind it.
  const ribbon = (len, width, color, wave, phase, alpha) => {
    const g = M.geometry(), ink = rgb(color), n = 12, lit = { emissive: 1 }, a = [], b = [], c = [], d = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = t * len, w = width * Math.min(1, t * 6) * (1 - t * 0.8) / 2, off = Math.sin(t * 6 + phase) * wave * t;
      a.push(M.pushVert(g, x, off + w, 0)); b.push(M.pushVert(g, x, off - w, 0));
      c.push(M.pushVert(g, x, off, w)); d.push(M.pushVert(g, x, off, -w));
    }
    for (let i = 0; i < n; i++) {
      M.face(g, [a[i], a[i + 1], b[i + 1], b[i]], ink, lit);
      M.face(g, [c[i], c[i + 1], d[i + 1], d[i]], ink, lit);
    }
    g.glass = alpha; g.lightBeam = len;
    return noShadow(g);
  };
  // The light that drags behind the walker: x across, y as a share of its height, length, width, colour, the hand it
  // swings with, and how solid it is. Head, hands, heels, and a soft blue wake.
  const TRAILS = [[0, 0.72, 8, 0.24, "#e6fbff", 0, 0.85], [-0.42, 0.3, 6.5, 0.17, "#e6fbff", -1, 0.85], [0.42, 0.3, 6.5, 0.17, "#e6fbff", 1, 0.85],
    [-0.17, 0.05, 5, 0.12, "#e6fbff", 0, 0.85], [0.17, 0.05, 5, 0.12, "#e6fbff", 0, 0.85], [0, 0.5, 10, 0.26, "#5fb2ff", 0, 0.3]];
  // Rings from the Portara's gold at the far end to ₿IFRÖST's blue at the near one.
  const TINTS = ["#ffd98a", "#ffb86b", "#c98bff", "#8f7dff", "#56b8ff", "#3fe0ff"];
  const kit = M.cached(() => {
    const deck = [M.box({ w: 2.4, h: 0.12, d: LENGTH + 6, color: "#0b1830", emissive: 0.12, offset: { y: -0.06, z: LENGTH / 2 } })];
    for (const side of [-1, 1]) deck.push(M.box({ w: 0.07, h: 0.05, d: LENGTH + 6, color: "#6fe3ff", emissive: 1, offset: { x: side * 1.2, y: 0.02, z: LENGTH / 2 } }));
    for (let z = 1; z < LENGTH + 2; z += 2) for (const side of [-1, 1]) deck.push(M.beam(side * 0.75, 0.012, z + 0.45, 0, 0.012, z, 0.07, "#3d8dff", 0.9));
    return {
      deck: noShadow(M.merge(...deck)),
      hoops: TINTS.map((c) => noShadow(M.turnedX(M.torus(4.3, 0.085, c, 1, 12, 5), Math.PI / 2))),
      streaks: [ribbon(9, 0.09, "#bfe9ff", 0, 0, 0.75), ribbon(15, 0.13, "#8fa0ff", 0, 0, 0.6), ribbon(6, 0.07, "#fff1c9", 0, 0, 0.8)],
      trails: TRAILS.map(([, , len, width, color, , alpha], i) => ribbon(len, width, color, 0.05, i, alpha)),
      motes: [noShadow(M.particleGeometry("#dff6ff", 0.03, 1)), noShadow(M.particleGeometry("#a8c2ff", 0.042, 1))],
      veil: noShadow(M.box({ w: 4.5, h: 6, d: 0.06, color: "#ffe2a0", emissive: 1 })),
      rays: [0, 1, 2].map((i) => ribbon(16 + i * 5, 0.5, "#ffe2a0", 0, 0, 0.16)),
      ring: noShadow(M.turnedX(M.merge(M.torus(3.3, 0.22, "#4aa8ff", 1, 24, 6), M.lathe({ profile: [[0, 0], [3.2, 0]], segments: 24, color: "#4aa8ff", emissive: 0.5 })), Math.PI / 2))
    };
  });
  const OPTS = { clear: [0, 0.004, 0.018], sky: [0.36, 0.38, 0.5], ground: [0.2, 0.2, 0.3], sun: [0.5, 0.55, 0.8], light: { x: 0.2, y: 0.8, z: -0.5 }, fog: [0, 0.012, 0.05], fogNear: 16, fogFar: 78, bloomStrength: 1.15, shadowExtent: 16 };
  // The flight round the island, as time, eye and look-at, in metres from the Portara's foot: out of the gate's
  // mouth, up over Olympus, round the Chora and the harbor, and back in through the Portara to the walker's shoulder.
  const FLIGHT = [
    0, 0.8, 2.7, 12.5, 0, 1.2, 2.5,
    2.4, 1.8, 4.4, 15, 0, 1.3, 2.5,
    5.5, 23, 35, 74, 1, -2, 4,
    8.8, 113, 29, 144, 53, -33, 62,
    11.6, 3, 11, 152, 23, -30, 66,
    14.2, -43, 19, 62, 5, -17, 28,
    16.2, -0.65, 11, -20, -0.65, 2, 8,
    17.2, -0.65, 5.5, -7, -0.65, 1.6, 6,
    18.2, -0.65, 1.98, 1.98, -0.65, 1.11, 5.89];
  const FLIGHT_KEYS = FLIGHT.length / 7, FLIGHT_SECONDS = FLIGHT[FLIGHT.length - 7];
  // Hermite through the keys on their own times, so the eye never stops at one.
  const along = (t, c) => {
    let i = 0;
    while (i < FLIGHT_KEYS - 2 && t > FLIGHT[(i + 1) * 7]) i++;
    const a = i * 7, b = a + 7, t0 = FLIGHT[a], t1 = FLIGHT[b], h = t1 - t0, u = clamp((t - t0) / h, 0, 1);
    const p0 = FLIGHT[a + c], p1 = FLIGHT[b + c];
    const m0 = i > 0 ? (p1 - FLIGHT[a - 7 + c]) / (t1 - FLIGHT[a - 7]) : (p1 - p0) / h;
    const m1 = i < FLIGHT_KEYS - 2 ? (FLIGHT[b + 7 + c] - p0) / (FLIGHT[b + 7] - t0) : (p1 - p0) / h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1;
  };

  // `hold(on)` keeps the scene's walker still while the flight runs; `muted()` is the scene's mute; `onArrive` hands
  // the camera back to the walk; `onLeave` goes back to ₿IFRÖST from inside the passage.
  const create = ({ root, camera, avatar, pilot, fx, exterior, scene, renderOpts, land, gate, hold, muted, onArrive, onLeave }) => {
    const K = kit(), rand = BL.math.mulberry32(51037), a = avatar.root.position, height = avatar.bodyHeight;
    const home = { x: a.x, y: a.y, z: a.z, yaw: avatar.root.rotation.y }, foot = { x: gate.root.position.x, y: land.heightAt(gate.root.position.x, gate.root.position.z), z: gate.root.position.z };
    const group = S.createNode({ sightHidden: true, visible: false }); S.addChild(root, group);
    const opts = { ...OPTS, shadowCenter: { x: 0, y: Y0, z: 0 }, lights: new Float32Array(16), lightCount: 2, time: 0 };
    node(group, K.deck, 0, Y0, 0);
    node(group, BL.dsbAtmosphere.portara(), 0, Y0, -1.2);
    const veil = node(group, K.veil, 0, Y0 + 3.5, -1.2);
    for (let i = 0; i < 7; i++) { const ray = node(group, K.rays[i % 3], (i - 3) * 0.6, Y0 + 1.2 + (i * 37 % 5), -0.6); ray.rotation.y = -Math.PI / 2; ray.rotation.z = (i - 3) * 0.05; }
    node(group, K.ring, 0, Y0 + 2.6, LENGTH + 2.5);
    const rings = [], streaks = [], motes = [], sparks = [];
    for (let z = 1.5, i = 0; z < LENGTH + 2; z += 3.2, i++) { const r = node(group, K.hoops[Math.min(5, Math.floor(z / (LENGTH + 2) * 6))], 0, Y0 + 1.7, z); r.rotation.z = i * 0.26; rings.push(r); }
    for (let i = 0; i < 84; i++) {
      const angle = 0.62 + rand() * (TAU - 1.24) + Math.PI / 2, r = 3.2 + rand() * 0.9;
      const s = node(group, K.streaks[i % 3], Math.cos(angle) * r, Y0 + 1.7 + Math.sin(angle) * r, rand() * (LENGTH + 20) - 10);
      s.rotation.y = Math.PI / 2; s.speed = 16 + rand() * 22; streaks.push(s);
    }
    const trails = K.trails.map((g) => { const n = node(group, g, 0, 0, 0); n.rotation.y = -Math.PI / 2; n.scale.x = 0.001; return n; });
    for (let i = 0; i < 90; i++) { const n = node(group, K.motes[i % 2], (rand() - 0.5) * 6.8, Y0 + 0.3 + rand() * 3.2, rand() * 40); n.speed = 2 + rand() * 7; n.seed = rand() * TAU; motes.push(n); }
    for (let i = 0; i < 28; i++) { const n = node(group, K.motes[i % 2], 0, 0, 0); n.visible = false; n.life = 0; sparks.push(n); }
    const audio = BL.dsbAudio.create(), panel = document.getElementById("dsb-panel"), sound = document.getElementById("dsb-start-audio");
    // The visit's first frame is the island's, drawn once under black, so its meshes are on the GPU before the
    // passage hides it and the arrival does not stall on them.
    let phase = "tunnel", warmed = false, progress = 0, gait = 0, pace = 0, spark = 0, glance = 0, glanceTime = 3, lastCue = -1, flash = 0, flashHold = 0, flight = 0, fade = -1, disposed = false;
    const pose = (swing) => { const p = avatar.parts; p.legL.rotation.x = swing; p.legR.rotation.x = -swing; p.armL.rotation.x = -swing * 0.7; p.armR.rotation.x = swing * 0.7; };
    const onVisibility = () => audio.visibility(document.hidden);
    const hud = (next) => {
      document.body.classList.toggle("dsb-entry", next === "entrance"); document.body.classList.toggle("dsb-arrival", next === "arrival");
      panel.hidden = next === "land"; panel.dataset.phase = next;
    };
    const show = (on) => { group.visible = on; exterior.visible = !on; scene.renderOpts = on ? opts : renderOpts; };
    const dress = (time, dt) => {
      const base = a.y - avatar.baseY, swing = Math.sin(gait), l = opts.lights;
      for (let i = 0; i < trails.length; i++) {
        const n = trails[i], t = TRAILS[i];
        n.position.x = a.x + t[0]; n.position.y = base + t[1] * height + (t[5] ? 0.1 * swing * t[5] : 0.025 * Math.sin(gait * 2 + i)); n.position.z = a.z + 0.38;
        n.scale.x = Math.max(0.001, pace * (0.92 + 0.08 * Math.sin(time * 5 + i * 1.7))); n.glow = 0.75 + 0.25 * Math.sin(time * 9 + i * 2.3);
      }
      for (let i = 0; i < motes.length; i++) {
        const n = motes[i];
        n.position.z += (n.speed + pace * 9) * dt; n.position.y += Math.sin(time * 1.3 + n.seed) * 0.25 * dt;
        if (n.position.z > a.z + 9) n.position.z -= 40 + (i % 5) * 2;
      }
      spark += pace * dt * 26;
      for (let i = 0; i < sparks.length; i++) {
        const n = sparks[i];
        if (n.life <= 0 && spark >= 1) { spark -= 1; n.life = 1; n.visible = true; n.position.x = a.x + Math.sin(i * 2.4) * 0.34; n.position.y = base + (0.15 + (i * 0.37 % 1) * 0.7) * height; n.position.z = a.z + 0.3; }
        if (n.life > 0) { n.life = Math.max(0, n.life - dt * 0.9); n.position.z += dt * 2.6; n.position.y += dt * 0.25; n.scale.x = n.scale.y = n.scale.z = n.life * 1.6; if (!n.life) n.visible = false; }
      }
      for (let i = 0; i < rings.length; i++) { const r = rings[i]; r.rotation.z += (i % 2 ? 0.22 : -0.16) * dt; r.glow = 0.5 + 0.5 * Math.sin(time * 3 + r.position.z * 0.55) ** 2; }
      for (let i = 0; i < streaks.length; i++) { const s = streaks[i]; s.position.z += s.speed * dt; if (s.position.z > a.z + 16) s.position.z -= 56 + (i % 7) * 3; }
      // The walker's own light, and the Portara's.
      l[0] = a.x; l[1] = base + 1.1; l[2] = a.z + 1.1; l[3] = 10; l[4] = 0.45; l[5] = 0.475; l[6] = 0.5;
      l[8] = 0; l[9] = Y0 + 3.4; l[10] = 1.2; l[11] = 22; l[12] = 1; l[13] = 0.86; l[14] = 0.6;
      opts.time = time; opts.shadowCenter.z = a.z; veil.glow = 0.82 + 0.18 * Math.sin(time * 2.2);
    };
    const walk = (dt, time) => {
      const forward = clamp(pilot.controls.read().y, -1, 1), before = progress;
      progress = clamp(progress + forward * dt / (audio.ready ? audio.duration : QUIET_SECONDS), 0, 1);
      const moving = progress !== before;
      if (moving) gait += dt * 7.5;
      pace += ((moving && forward > 0 ? 1 : 0) - pace) * (1 - Math.exp(-dt * 3.5));
      audio.update(progress, time, moving);
      if (audio.cue !== lastCue) { lastCue = audio.cue; glanceTime = 0; }
      glanceTime += dt; glance = (lastCue % 2 ? 1 : -1) * Math.sin(Math.PI * clamp(glanceTime / 2.2, 0, 1)) * 0.16;
      a.x = 0; a.y = Y0 + avatar.baseY; a.z = LENGTH * (1 - progress); avatar.root.rotation.y = Math.PI;
      pose(moving ? Math.sin(gait) * 0.5 : 0);
      // A tall screen stands further back and nearer the middle, so the walker and its light stay in view.
      const tall = innerHeight > innerWidth;
      camera.position.x = (tall ? 0.8 : 1.7) + Math.sin(glance) * 3; camera.position.y = Y0 + (tall ? 2.5 : 2.1); camera.position.z = a.z + (tall ? 5.4 : 3.7);
      camera.target.x = (tall ? -0.2 : -0.5) - Math.sin(glance) * 2; camera.target.y = Y0 + 0.9; camera.target.z = a.z - 6;
      dress(time, dt);
      if (sound.hidden !== (audio.ready || !window.AudioContext)) sound.hidden = !sound.hidden;
    };
    const fly = (dt) => {
      flight += dt;
      const out = smooth(flight / STEP_OUT);
      a.x = home.x; a.y = home.y; a.z = home.z - 3.4 * (1 - out); avatar.root.rotation.y = home.yaw;
      if (out < 1) gait += dt * 7.5;
      pose(out < 1 ? Math.sin(gait) * 0.5 : 0);
      const p = camera.position, t = camera.target;
      p.x = foot.x + along(flight, 1); p.y = foot.y + along(flight, 2); p.z = foot.z + along(flight, 3);
      t.x = foot.x + along(flight, 4); t.y = foot.y + along(flight, 5); t.z = foot.z + along(flight, 6);
      p.y = Math.max(p.y, land.heightAt(p.x, p.z) + 1.5);
    };
    // The walker stands before the Portara with the camera at its shoulder; the entrance music fades behind it.
    const finish = () => {
      if (phase === "done") return;
      if (phase === "tunnel") show(false);
      if (phase === "arrival") gate.finishReceiving(true);
      phase = "done"; hud("land"); hold(false); pilot.setExternalControl(false);
      a.x = home.x; a.y = home.y; a.z = home.z; avatar.root.rotation.y = home.yaw; pose(0);
      audio.fade(2.4); fade = 3;
      onArrive();
    };
    const arrive = () => {
      show(false); flash = 1; flashHold = 2;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
      phase = "arrival"; flight = 0; hud("arrival"); hold(true); gate.receive(); fly(0);
    };
    const skip = () => { if (phase === "tunnel") { flash = 1; flashHold = 2; } finish(); };
    // True while the passage owns the frame; in the flight the island's own update runs on under this camera.
    const update = (dt, time) => {
      if (disposed) return false;
      if (audio.muted !== muted()) audio.toggle();
      if (phase === "tunnel") {
        if (!warmed) { warmed = true; return false; }
        if (!group.visible) { show(true); pilot.setExternalControl(true); }
        walk(dt, time); fx.update(dt);
        if (progress >= 1) arrive();
        return phase === "tunnel";
      }
      if (flashHold > 0) flashHold--; else flash = Math.max(0, flash - Math.min(dt, 0.05) * 1.3);
      if (phase === "arrival") { audio.update(1, time, false); fly(dt); if (flight >= FLIGHT_SECONDS) finish(); }
      else if (fade > 0 && (fade -= dt) <= 0) { document.removeEventListener("visibilitychange", onVisibility); audio.dispose(); }
      return false;
    };
    const overlay = (c, w, h) => {
      const warming = phase === "tunnel" && !group.visible, alpha = warming ? 1 : flash;
      if (alpha <= 0) return;
      c.save(); c.globalAlpha = alpha; c.fillStyle = warming ? "#000" : "#fff"; c.fillRect(0, 0, w, h); c.restore();
    };
    // Every HUD action is the passage's until the walk begins: sound, Skip, and the way back from inside it.
    const action = (name) => {
      if (phase === "done" || name === "dsb-mute") return false;
      if (name === "dsb-start-audio") audio.gesture();
      else if (name === "dsb-skip-entry" || name === "dsb-skip") skip();
      else if (name === "leave" && phase !== "arrival") onLeave();
      return true;
    };
    const onKey = (e) => {
      if (phase === "done" || e.key.toLowerCase() === "m") return false;
      if (phase === "arrival") { if (e.key === "Escape" || e.key === " " || e.key === "Enter") finish(); }
      else if (e.key === "Escape") onLeave();
      return true;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true; document.removeEventListener("visibilitychange", onVisibility); audio.dispose();
      if (phase !== "done") { show(false); hud("land"); pilot.setExternalControl(false); }
      S.removeChild(root, group); while (group.children.length) S.removeChild(group, group.children[group.children.length - 1]);
    };
    document.addEventListener("visibilitychange", onVisibility); hud("entrance");
    return { group, opts, audio, update, overlay, action, onKey, skip, dispose, get phase() { return phase; }, get progress() { return progress; }, get flight() { return flight; } };
  };
  BL.dsbEntrance = { create, LENGTH, FLIGHT_SECONDS };
})();
