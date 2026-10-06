// DSB Land: one scene with a walk-in passage, explorable plain, and two passenger rides.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { createNode, addChild, removeChild, createCamera, traverseVisible, tweenCount } = BL.scene;
  const { clamp } = BL.math;
  const M = BL.dsbModels, N = 192, TAU = Math.PI * 2;
  let RAIL_GEOMETRY, SUPPORT_GEOMETRY;
  const VIEW = { yaw: 0, pitch: 0.28, dist: 6, target: { x: 0, y: 1.7, z: 26 }, position: { x: 0, y: 0, z: 26 } };
  const DOCK = { yaw: 0, pitch: 0, dist: 12, target: { x: 0, y: 1.7, z: 33 }, position: { x: 0, y: 0, z: 33 } };
  const STATION = { yaw: 0, pitch: 0, dist: 12, target: { x: 7, y: 1.7, z: 24 }, position: { x: 7, y: 0, z: 24 } };
  const START = Math.asin(7 / 31), WAIT = 8;
  const boatTrip = { angle: 0, wait: WAIT, start: 0, speed: 0.13 }, trainTrip = { angle: START, wait: WAIT, start: START, speed: 0.2 };
  let rideYaw = 0, ridePitch = 0, proximity, lastContext = "", bananas = 0;
  const RENDER = { clear: [0.025, 0.014, 0.06], horizon: [0.11, 0.04, 0.19], zenith: [0.008, 0.006, 0.025], sky: [0.52, 0.43, 0.7], ground: [0.26, 0.17, 0.32], sun: [0.8, 0.7, 0.9], light: { x: -0.4, y: 0.8, z: 0.4 }, stars: 1, shadowCenter: { x: 0, y: 0, z: 0 }, shadowExtent: 48, bloomStrength: 0.5, lights: new Float32Array(80), lightCount: 2 };
  const DARK = { clear: [0, 0, 0], sky: [0.12, 0.1, 0.16], ground: [0.04, 0.03, 0.06], sun: [0.18, 0.16, 0.22], bloomStrength: 0.15 };
  let root, camera, input, pilot, hud, renderer, world, game, go, land, transitGate, audio, data, tv, panel, readout, bag, prompt, overlayCanvas, overlayCtx, avatar, crew, fx, playerWorld, zuzu, conversation;
  let exiting = false;
  // DSB Land returns through its gate to ₿IFRÖST's chamber.
  const home = "bifrost", HOME_NAME = "₿IFRÖST";
  let phase = "entrance", progress = 0, elapsed = 0, flash = 0, boatAngle = 0, rideAngle = 0, priceTimer = 0, tokens = 20, bread = 0, tomatoes = 0, throwAt = -1, fedUntil = 0, disposed = false, oldSheetHidden = false, oldSheetOpen = "true";
  let arrivalTime = 0, glanceTime = 3, lastCue = -1, glance = 0, gait = 0, avatarView = true;
  let lastPrice = "", lastBag = "", lastPrompt = "", savedRevision = -1, lastHeight = 0, skyPulse = 0;
  const targets = [], visitors = [], shots = [], rails = [], ties = [], candles = [], railY = new Float64Array(N), railColor = new Uint8Array(N);
  const railPoint = { x: 0, y: 0, z: 0 }, railAhead = { x: 0, y: 0, z: 0 }, previous = { x: 0, z: 26 };
  const transitPrevious = { x: 0, y: 0, z: 25 }, transitCurrent = { x: 0, y: 0, z: 25 };
  const radioSource = { x: 0, y: 0, z: 0 };
  const agentPerception = { name: "", x: 0, y: 0, z: 0, food: 0, active: false };
  const feedback = ["Ooga! Tough crowd!", "That one was ripe!", "Save some for the sandwich!", "Encore! But fewer tomatoes!"];
  const jokes = ["I bought the dip. Nobody brought chips.", "My wallet is cold. My banana bread is warm.", "A turtle walks into a bar. Eventually.", "Proof of work? I carried this microphone."];
  const dsbScene = { id: "dsb", root: null, camera: null, input: null, debug: null, renderOpts: DARK, get inMotion() { return true; } };
  const point = (a, out) => {
    const f = ((a % TAU + TAU) % TAU) / TAU * N, i = Math.floor(f), t = f - i;
    out.x = Math.sin(a) * 31; out.z = Math.cos(a) * 31;
    out.y = railY[i] * (1 - t) + railY[(i + 1) % N] * t;
  };
  const buildRide = () => {
    const state = data.state, source = state.candles, count = state.count - 1, base = source[4];
    // Completed candles only. A lap owns this snapshot, so the rails under a rider never move.
    for (let i = 0; i < N; i++) {
      const f = i / N * count, k = Math.floor(f), t = f - k;
      const p = source[k * 5 + 4], q = source[((k + 1) % count) * 5 + 4];
      const angle = i / N * TAU, distance = Math.abs(Math.atan2(Math.sin(angle - START), Math.cos(angle - START)));
      railY[i] = 10 + clamp(Math.log((p * (1 - t) + q * t) / base) * 140, -2.5, 5) * clamp((distance - 0.16) / 0.3, 0, 1);
      railColor[i] = source[k * 5 + 4] >= source[k * 5 + 3] ? 1 : 0;
    }
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, b = (i + 1) / N * TAU;
      point(a, railPoint); point(b, railAhead);
      const dx = railAhead.x - railPoint.x, dy = railAhead.y - railPoint.y, dz = railAhead.z - railPoint.z;
      const length = Math.hypot(dx, dz);
      for (let side = 0; side < 2; side++) {
        const rail = rails[i * 2 + side], offset = side ? 0.65 : -0.65;
        rail.position.x = (railPoint.x + railAhead.x) / 2 + Math.sin(a) * offset; rail.position.z = (railPoint.z + railAhead.z) / 2 + Math.cos(a) * offset; rail.position.y = (railPoint.y + railAhead.y) / 2;
        rail.rotation.y = Math.atan2(dx, dz); rail.rotation.x = -Math.atan2(dy, length); rail.scale.z = Math.hypot(length, dy) + 0.03;
        rail.geometry = RAIL_GEOMETRY[railColor[i]];
      }
      const tie = ties[i]; tie.position.x = railPoint.x; tie.position.y = railPoint.y - 0.15; tie.position.z = railPoint.z; tie.rotation.y = a;
      if (i % 4 === 0) {
        const candle = candles[i / 4]; candle.position.x = railPoint.x; candle.position.z = railPoint.z; candle.position.y = railPoint.y / 2; candle.scale.y = railPoint.y;
        candle.geometry = SUPPORT_GEOMETRY[railColor[i]];
        candle.visible = !(railPoint.z > 27 && railPoint.x > -11 && railPoint.x < 11);
      }
    }
    savedRevision = state.revision;
  };
  const location = () => phase === "land" && avatarView ? avatar.root.position : pilot.orbit.target;
  const cameraEnabled = () => phase === "land" && !exiting && !transitGate.isOpen && !tv.isOpen && !conversation?.isOpen && document.getElementById("dsb-shop").hidden;
  const playerEnabled = () => avatarView && cameraEnabled();
  const syncPlayer = () => pilot.setActive(cameraEnabled());
  const clearAt = (x, z, radius = 0.35) => Math.hypot(x, z) < 35 - radius
    && !(land && Math.hypot(x - transitGate.dialer.position.x, z - transitGate.dialer.position.z) < 0.55 + radius)
    && (!land || land.landmarks.shop.clearAt(x, z, radius) && land.landmarks.tv.clearAt(x, z, radius))
    && !(Math.abs(x) < 8.6 + radius && Math.abs(z) < 2.6 + radius
      || Math.abs(x + 18) < 7.5 + radius && z > -20.5 - radius && z < -11.5 + radius);
  const walkable = (ax, az, bx, bz, y, height, actor) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
    for (let i = 1; i <= steps; i++) if (!clearAt(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, actor.bodyRadius)) return false;
    return true;
  };
  const weaponImpact = (source, hit) => {
    if (hit.owner && hit.owner.kind === "dsb-agent") zuzu.event("weapon_hit");
    if (hit.owner && hit.owner.kind === "visitor") { hit.owner.cave.hit = 1; toast("Ooga! Watch the banana shots!"); }
  };
  const projectileMove = (ax, ay, az, bx, by, bz) => zuzu.projectile(ax, ay, az, bx, by, bz);
  const nearZuzu = () => playerEnabled() && Math.hypot(avatar.root.position.x - zuzu.root.position.x, avatar.root.position.z - zuzu.root.position.z) < 3.5;
  const reloadPolicy = { near: () => playerEnabled(), available: () => true, consume: () => {} };
  const near = (x, z, radius = 5) => { const p = location(); return Math.hypot(p.x - x, p.z - z) < radius; };
  const nearLandmark = name => !!land && land.landmarks[name].near(location());
  const clampTarget = (p) => {
    const radius = Math.hypot(p.x, p.z);
    if (avatarView && !pilot?.player) p.y = 1.7;
    if (radius > 35) { p.x *= 35 / radius; p.z *= 35 / radius; }
    // Solid landmark footprints; each attempted step keeps its last clear position.
    if (Math.abs(p.x) < 8.6 && Math.abs(p.z) < 2.6 || land && (!land.landmarks.shop.clearAt(p.x, p.z) || !land.landmarks.tv.clearAt(p.x, p.z)) || Math.abs(p.x + 18) < 7.5 && p.z > -20.5 && p.z < -11.5) { p.x = previous.x; p.z = previous.z; }
    previous.x = p.x; previous.z = p.z;
  };
  const clampCamera = (p) => { p.y = clamp(p.y, 0.5, 75); };
  const register = (node, kind, label) => { input.add(node, { kind, label }, { radius: 1.5 }); targets.push(node); };
  const toast = (text) => hud.toast(text);
  const soundUi = () => {
    for (const button of document.querySelectorAll('[data-action="dsb-mute"]')) { button.setAttribute("aria-pressed", String(audio.muted)); button.textContent = audio.muted ? "Unmute" : "Mute"; }
    const music = document.getElementById("dsb-music"), ambient = document.getElementById("dsb-ambient");
    music.setAttribute("aria-pressed", String(audio.musicEnabled)); music.textContent = audio.musicEnabled ? "Music: on" : "Music: off";
    ambient.setAttribute("aria-pressed", String(audio.ambientEnabled)); ambient.textContent = audio.ambientEnabled ? "Ambient: on" : "Ambient: off";
  };
  const bagText = () => {
    const value = `${bananas} bananas | ${tokens} demo tokens · ${bread} bread · ${tomatoes} tomatoes`;
    if (lastBag !== value) { bag.textContent = value; lastBag = value; }
  };
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const poseAvatar = (moving, dt) => {
    if (moving) gait += dt * 7;
    const swing = moving ? Math.sin(gait) * 0.48 : 0;
    avatar.parts.legR.rotation.x = swing; avatar.parts.legL.rotation.x = -swing;
    avatar.parts.armR.rotation.x = -swing * 0.6; avatar.parts.armL.rotation.x = swing * 0.6;
  };
  const finishArrival = () => {
    if (phase !== "arrival") return;
    transitGate.finishReceiving();
    phase = "land"; panel.dataset.phase = phase; document.body.classList.remove("dsb-arrival");
    previous.x = 0; previous.z = 26; pilot.possess(avatar); pilot.navigate(VIEW); syncPlayer(); pilot.update(0);
    avatarView = true; hud.setAct("USE"); hud.el.act.hidden = false;
  };
  const arrivalCamera = () => {
    const t = arrivalTime;
    let x = 0, y, z, ty, tz;
    if (t < 2.5) {
      const f = smooth(t / 2.5); y = 3.36 + (46 - 3.36) * f; z = 31.77 + (85 - 31.77) * f; ty = 1.7 - 5.7 * f; tz = 26 * (1 - f);
    } else if (t < 10.5) {
      const a = smooth((t - 2.5) / 8) * TAU;
      x = Math.sin(a) * 85; z = Math.cos(a) * 85; y = 8 + Math.cos(a) * 38; ty = -4; tz = 0;
    } else {
      const f = smooth((t - 10.5) / 2.5); y = 46 + (3.36 - 46) * f; z = 85 + (31.77 - 85) * f; ty = -4 + 5.7 * f; tz = 26 * f;
    }
    camera.position.x = x; camera.position.y = y; camera.position.z = z;
    camera.target.x = 0; camera.target.y = ty; camera.target.z = tz;
  };
  const reveal = () => {
    if (phase !== "entrance") return;
    // Only the consumed backside crossing may construct the land.
    progress = 1; buildLand();
    phase = "arrival"; arrivalTime = 0; flash = 1; dsbScene.renderOpts = RENDER;
    transitGate.root.position.z = 28;
    avatar.root.position.x = 0; avatar.root.position.y = avatar.baseY; avatar.root.position.z = 28; poseAvatar(false, 0);
    document.body.classList.remove("dsb-entry"); document.body.classList.add("dsb-arrival"); panel.dataset.phase = phase;
    audio.arrive(); arrivalCamera();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finishArrival();
  };
  const stopRide = () => {
    const arrival = phase === "boat" ? DOCK : STATION;
    phase = "land"; rideYaw = ridePitch = 0; panel.dataset.phase = phase; previous.x = arrival.position.x; previous.z = arrival.position.z; pilot.navigate(arrival); syncPlayer();
  };
  const advanceTrip = (trip, dt) => {
    if (trip.wait > 0) { const used = Math.min(dt, trip.wait); trip.wait -= used; dt -= used; }
    if (!dt) return false;
    trip.angle += dt * trip.speed;
    if (trip.angle >= trip.start + TAU) { trip.angle = trip.start; trip.wait = WAIT; return true; }
    return false;
  };
  const atDock = () => near(0, 34, 4.5);
  const atStation = () => near(7, 24, 4.5);
  const board = (kind) => {
    if (phase !== "land") return;
    const trip = kind === "boat" ? boatTrip : trainTrip;
    if (!(kind === "boat" ? atDock() : atStation())) { toast("Walk to the marked " + (kind === "boat" ? "boat" : "coaster") + " station."); return; }
    if (trip.wait <= 0) { toast("The next ride is on its way. Wait at the station."); return; }
    trip.wait = Math.max(2, trip.wait); phase = kind; rideYaw = ridePitch = 0; panel.dataset.phase = phase;
    document.getElementById("dsb-shop").hidden = true; syncPlayer();
    toast("Drag to look around. Leave ride returns you to the station.");
  };
  const nearDialer = () => phase === "land" && avatarView && Math.hypot(avatar.root.position.x - transitGate.dialer.position.x, avatar.root.position.z - transitGate.dialer.position.z) < 2;
  const departGate = () => {
    if (phase !== "land" || exiting) return;
    world.pilot = avatar.traits.name;
    exiting = true; syncPlayer(); pilot.controls.reset(); input.reset(); go(home);
  };
  const returnHub = () => { if (phase === "entrance") { exiting = true; syncPlayer(); go(home); } else toast(`Use the Ooga Portal Dialer, then cross the active gate to return to ${HOME_NAME}.`); };
  const contextAction = () => {
    if (phase === "boat" || phase === "coaster") return "ride";
    if (phase !== "land" || exiting || transitGate.isOpen || tv.isOpen || conversation.isOpen || !document.getElementById("dsb-shop").hidden) return "";
    if (nearDialer()) return "dialer";
    if (atDock()) return boatTrip.wait > 0 ? "boat" : "boat-wait";
    if (atStation()) return trainTrip.wait > 0 ? "coaster" : "coaster-wait";
    if (nearLandmark("tv")) return "tv";
    if (nearLandmark("shop")) return "shop";
    if (nearZuzu()) return "zuzu";
    return "";
  };
  const CONTEXT_LABELS = { dialer: "DIAL", zuzu: "Talk to Zuzu", ride: "Leave ride", boat: "Take a ride - boat", coaster: "Take a ride - coaster", "boat-wait": "Boat arriving soon", "coaster-wait": "Coaster arriving soon", tv: "Use TV", shop: "Visit meme shop" };
  const syncContext = () => {
    const kind = contextAction();
    if (kind === lastContext) return;
    lastContext = kind; proximity.hidden = !kind; proximity.textContent = CONTEXT_LABELS[kind] || ""; proximity.disabled = kind.endsWith("-wait");
    // Context changes can resize this paragraph. Settle the panel now, before
    // the next press, rather than moving its buttons on a later price refresh.
    const hint = kind ? CONTEXT_LABELS[kind] : "WASD: move | 1/2: weapon | right-click: aim | V: fire | R: reload | T: tomato | B: snack";
    if (lastPrompt !== hint) { prompt.textContent = hint; lastPrompt = hint; }
    hud.setAct(kind ? CONTEXT_LABELS[kind] : tomatoes ? "Throw tomato" : "USE");
  };
  const rideCamera = (position, heading, slope) => {
    const yaw = heading + rideYaw, pitch = slope + ridePitch, cp = Math.cos(pitch);
    camera.position.x = position.x + Math.sin(heading) * 0.85; camera.position.y = position.y + 1.45; camera.position.z = position.z + Math.cos(heading) * 0.85;
    camera.target.x = camera.position.x + Math.sin(yaw) * cp * 10; camera.target.y = camera.position.y + Math.sin(pitch) * 10; camera.target.z = camera.position.z + Math.cos(yaw) * cp * 10;
  };
  const openTv = () => {
    if (phase !== "land" || !nearLandmark("tv") || location().y > 6) { toast("Walk up to the screen facing the Ooga Portal plaza to open it."); return; }
    tv.open(); syncPlayer();
  };
  const openShop = () => {
    if (phase !== "land" || !nearLandmark("shop")) { toast("Visit the meme stand facing the Ooga Portal plaza."); return; }
    panel.dataset.folded = "false"; document.getElementById("dsb-toggle").textContent = "Hide DSB menu"; document.getElementById("dsb-toggle").setAttribute("aria-expanded", "true"); document.getElementById("dsb-shop").hidden = false; syncPlayer(); syncContext();
  };
  const buy = (kind) => {
    if (phase !== "land" || !nearLandmark("shop")) { toast("Purchases happen at the meme stand."); return; }
    const price = kind === "bread" ? 3 : 1;
    if (tokens < price) { toast("No demo tokens left this visit."); return; }
    if ((kind === "bread" ? bread : kind === "banana" ? bananas : tomatoes) >= 9) { toast("Your bag holds nine of each item."); return; }
    tokens -= price; if (kind === "bread") bread++; else if (kind === "banana") bananas++; else tomatoes++; bagText(); toast(kind === "tomato" ? "Tomato added. Press T or Throw tomato to throw." : "Snack added to your bag.");
  };
  const eat = () => {
    if (phase === "entrance" || phase === "arrival" || !bread && !bananas) { toast("Pick up bananas or banana bread at the meme stand first."); return; }
    if (bread) bread--; else bananas--; fedUntil = elapsed + 1.5; bagText(); toast("Warm banana bread. Ooga approved."); zuzu.event("food_activity");
  };
  const throwTomato = (target = null) => {
    if (!playerEnabled() || elapsed - throwAt < 0.3) return;
    if (!tomatoes) { toast("Pick up tomatoes at the meme shop first."); return; }
    const shot = shots.find((s) => s.life <= 0); if (!shot) return;
    const p = location(), yaw = pilot.orbit.yaw;
    shot.node.position.x = p.x; shot.node.position.y = avatar.root.position.y - avatar.baseY + 1.45; shot.node.position.z = p.z;
    let dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    if (target) { dx = target.root.position.x - p.x; dz = target.root.position.z - p.z; const d = Math.hypot(dx, dz); dx /= Math.max(d, 0.001); dz /= Math.max(d, 0.001); }
    shot.vx = dx * 14; shot.vz = dz * 14; shot.vy = 2; shot.life = 2; shot.node.visible = true; shot.splat = false;
    shot.node.scale.x = shot.node.scale.y = shot.node.scale.z = 0.28;
    tomatoes--; throwAt = elapsed; bagText();
  };
  const perform = () => { if (phase === "land") toast(jokes[Math.floor(elapsed / 4) % jokes.length]); };
  const act = () => {
    if (phase === "boat" || phase === "coaster") { stopRide(); return true; }
    if (phase !== "land") return true;
    if (nearDialer()) transitGate.open();
    else if (atDock()) board("boat");
    else if (atStation()) board("coaster");
    else if (nearLandmark("tv")) openTv();
    else if (nearLandmark("shop")) openShop();
    else if (nearZuzu()) conversation.open();
    else if (near(-18, -10, 7)) perform();
    else throwTomato();
    return true;
  };
  const onTap = (hit) => {
    if (!playerEnabled() || pilot.aiming || !hit) return;
    const owner = hit.owner;
    if (owner.kind === "ooga-portal-dialer") { if (nearDialer()) transitGate.open(); else toast("Move closer to the Ooga Portal dialer."); }
    else if (owner.kind === "dsb-agent") { if (nearZuzu()) conversation.open(); else toast("Walk closer to talk to Zuzu."); }
    else if (owner.kind === "visitor") { if (tomatoes) throwTomato(owner.cave); else toast("Grab tomatoes at the meme stand, then tap an Ooga."); }
    else if (owner.kind === "tv") openTv();
    else if (owner.kind === "shop") openShop();
    else if (owner.kind === "boat" || owner.kind === "coaster") board(owner.kind);
    else if (owner.kind === "stage") perform();
  };
  const action = (name) => {
    if (exiting || transitGate.isOpen) return;
    if (name === "leave") returnHub();
    else if (name === "dsb-context") act();
    else if (name === "dsb-banana") buy("banana");
    else if (name === "dsb-skip") finishArrival();
    else if (name === "dsb-start-audio") audio.gesture();
    else if (name === "dsb-panel") { panel.dataset.folded = String(panel.dataset.folded !== "true"); document.getElementById("dsb-toggle").setAttribute("aria-expanded", String(panel.dataset.folded !== "true")); document.getElementById("dsb-toggle").textContent = panel.dataset.folded === "true" ? "Show DSB menu" : "Hide DSB menu"; }
    else if (name === "dsb-mute") { audio.toggle(); soundUi(); }
    else if (name === "dsb-music") { audio.toggleMusic(); soundUi(); }
    else if (name === "dsb-ambient") { audio.toggleAmbient(); soundUi(); }
    else if (name === "dsb-radio-play") { audio.playRadio(); soundUi(); }
    else if (name === "dsb-live" && data) { if (data.state.live) data.stop(); else data.start(); document.getElementById("dsb-live").setAttribute("aria-pressed", String(data.state.live)); }
    else if (name === "dsb-bread") buy("bread");
    else if (name === "dsb-tomato") buy("tomato");
    else if (name === "dsb-eat") eat();
    else if (name === "dsb-throw") throwTomato();
    else if (name === "dsb-close-shop") { document.getElementById("dsb-shop").hidden = true; syncPlayer(); syncContext(); }
    else if (name === "dsb-stop" && (phase === "boat" || phase === "coaster")) stopRide();
    else if (name === "act") pilot.action();
    else if (name === "mode-retake" && cameraEnabled()) {
      pilot.modeAction(name);
      if (pilot.player === avatar) { avatarView = true; syncPlayer(); }
    }
    else if (playerEnabled() && (name.startsWith("weapon-") || name === "magazine-swap")) pilot.weaponAction(name);
    else if (name === "reset-view" && phase === "land") { avatarView = true; previous.x = 0; previous.z = 26; if (!pilot.player) pilot.possess(avatar); syncPlayer(); pilot.enterClose(); pilot.navigate(VIEW); }
    else if (name === "dsb-lookout" && phase === "land") { avatarView = false; syncPlayer(); pilot.goPreset("lookout"); }
  };
  const playerAction = () => {
    if (!playerEnabled()) { if (phase === "boat" || phase === "coaster") act(); return true; }
    if (contextAction() || near(-18, -10, 7)) { act(); return true; }
    return false;
  };
  const onKey = (event) => {
    if (exiting || transitGate.isOpen || conversation?.isOpen) return;
    if (playerEnabled()) {
      if (event.key === "1" || event.key === "2") { pilot.weaponMode(Number(event.key)); return; }
      if (event.key.toLowerCase() === "g") { pilot.weaponAction("weapon-toggle"); return; }
      if (event.key.toLowerCase() === "v") { pilot.weaponAction("weapon-fire"); return; }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); event.stopPropagation(); pilot.weaponAction("weapon-reload"); return; }
    }
    if (phase === "arrival" && (event.key === "Escape" || event.key === " " || event.key === "Enter")) { finishArrival(); return; }
    if (event.key === "Escape") {
      if (!document.getElementById("dsb-shop").hidden) document.getElementById("dsb-shop").hidden = true;
      else if (phase === "boat" || phase === "coaster") stopRide(); else returnHub();
    } else if (event.key === "0") action("reset-view");
    else if (event.key.toLowerCase() === "t") throwTomato();
    else if (event.key.toLowerCase() === "b") eat();
    else if (event.key.toLowerCase() === "m") action("dsb-mute");
  };
  const onVisibility = () => audio.visibility(document.hidden);
  const update = (dt, time) => {
    // A queued RAF can predate a debug advance; never rewind a camera sequence.
    if (exiting) return;
    dt = Math.max(0, dt);
    elapsed = time;
    syncPlayer();
    transitGate.update();
    if (phase === "entrance") {
      const axes = pilot.controls.read(), previousProgress = progress;
      document.getElementById("dsb-start-audio").hidden = audio.ready || !window.AudioContext;
      // Audio supplies the pacing, never permission to walk or finish the passage.
      progress = clamp(progress + axes.y * dt / audio.duration, 0, 1);
      audio.update(progress, elapsed, progress !== previousProgress);
      if (audio.cue !== lastCue) { lastCue = audio.cue; glanceTime = 0; }
      glanceTime += dt; glance = (lastCue % 2 ? 1 : -1) * Math.sin(Math.PI * clamp(glanceTime / 2.2, 0, 1)) * 0.16;
      Object.assign(transitPrevious, avatar.root.position);
      transitPrevious.y += avatar.bodyHeight / 2 - avatar.baseY;
      avatar.root.position.z = 25 - 25.1 * progress; poseAvatar(progress !== previousProgress, dt);
      camera.position.x = Math.sin(glance) * 4; camera.position.y = 2.8; camera.position.z = avatar.root.position.z + Math.cos(glance) * 4;
      camera.target.x = -Math.sin(glance) * 2; camera.target.y = 1.4; camera.target.z = avatar.root.position.z - 4;
      Object.assign(transitCurrent, avatar.root.position);
      transitCurrent.y += avatar.bodyHeight / 2 - avatar.baseY;
      transitGate.traverse(transitPrevious, transitCurrent, avatar.bodyRadius, -1);
      return;
    }
    audio.update(1, elapsed); flash = Math.max(0, flash - dt * 1.5);
    if (phase === "arrival") { arrivalTime += dt; avatar.root.position.z = 28 - 2 * smooth(arrivalTime / 0.6); poseAvatar(arrivalTime < 0.6, dt); arrivalCamera(); if (arrivalTime >= 13) finishArrival(); }
    if (phase === "land") {
      avatar.root.visible = true;
      if (cameraEnabled()) {
        pilot.readInput(dt);
        if (avatarView) {
          Object.assign(transitPrevious, avatar.root.position); transitPrevious.y += avatar.bodyHeight / 2 - avatar.baseY;
          crew.update(dt, time);
          Object.assign(transitCurrent, avatar.root.position); transitCurrent.y += avatar.bodyHeight / 2 - avatar.baseY;
          if (transitGate.traverse(transitPrevious, transitCurrent, avatar.bodyRadius, 1)) return;
        }
        pilot.update(dt);
      }
    } else avatar.root.visible = phase === "arrival";
    agentPerception.name = avatar.traits.name; agentPerception.x = avatar.root.position.x; agentPerception.y = avatar.root.position.y - avatar.baseY; agentPerception.z = avatar.root.position.z; agentPerception.food = bananas + bread; agentPerception.active = playerEnabled() || conversation.isOpen && phase === "land" && !exiting;
    zuzu.update(dt, time, agentPerception);
    advanceTrip(boatTrip, dt); boatAngle = boatTrip.angle;
    for (let i = 0; i < land.boats.length; i++) {
      const a = boatAngle - i * 0.13, b = land.boats[i];
      b.position.x = Math.sin(a) * 40; b.position.z = Math.cos(a) * 40; b.position.y = -0.1 + Math.sin(time * 1.8 + i) * 0.09; b.rotation.y = a + Math.PI / 2;
    }
    if (phase === "boat") rideCamera(land.boats[0].position, boatAngle + Math.PI / 2, 0);
    const arrived = advanceTrip(trainTrip, dt); rideAngle = trainTrip.angle;
    if (arrived || trainTrip.wait > 0 && data.state.revision !== savedRevision) buildRide();
    point(rideAngle, railPoint); point(rideAngle + 0.04, railAhead);
    land.cart.position.x = railPoint.x; land.cart.position.y = railPoint.y + 0.4; land.cart.position.z = railPoint.z;
    land.cart.rotation.y = rideAngle + Math.PI / 2;
    land.cart.rotation.x = -Math.atan2(railAhead.y - railPoint.y, Math.hypot(railAhead.x - railPoint.x, railAhead.z - railPoint.z));
    if (phase === "coaster") rideCamera(land.cart.position, rideAngle + Math.PI / 2, Math.atan2(railAhead.y - railPoint.y, Math.hypot(railAhead.x - railPoint.x, railAhead.z - railPoint.z)));
    for (let i = 1; i < land.carts.length; i++) {
      const a = rideAngle - i * 0.135, car = land.carts[i]; point(a, railPoint); point(a + 0.04, railAhead);
      car.position.x = railPoint.x; car.position.y = railPoint.y + 0.4; car.position.z = railPoint.z;
      car.rotation.y = a + Math.PI / 2; car.rotation.x = -Math.atan2(railAhead.y - railPoint.y, Math.hypot(railAhead.x - railPoint.x, railAhead.z - railPoint.z));
    }
    syncContext();
    fx.update(dt);
    land.landmarks.tv.point(-0.55, 3.3, 1.63, radioSource);
    audio.environment(camera, land.boats[0].position, dt, radioSource);
    for (let i = 0; i < land.falls.length; i++) { const f = land.falls[i]; f.glow = 0.55 + 0.2 * Math.sin(time * 3 + i * 0.4); f.scale.y = 7.5 + 0.5 * Math.sin(time * 1.7 + i); land.spray[i].position.y = -0.5 - (time * 4 + i * 0.71) % 11; }
    if (data.state.height !== lastHeight) { if (lastHeight) skyPulse = 1; lastHeight = data.state.height; }
    skyPulse = Math.max(0, skyPulse - dt * 0.25);
    for (let i = 0; i < land.stars.length; i++) { const star = land.stars[i]; star.glow = 0.25 + data.state.backlog * 0.8 + skyPulse + Math.sin(time + i) * 0.12; star.rotation.y = time * 0.12; }
    for (let i = 0; i < visitors.length; i++) {
      const visitor = visitors[i]; visitor.root.position.y = visitor.baseY + visitor.floorY + Math.max(0, visitor.hit) * 0.2;
      visitor.root.rotation.y = visitor.heading + Math.sin(time * 0.45 + i) * 0.15;
      visitor.hit = Math.max(0, visitor.hit - dt * 2); visitor.root.highlight = visitor.hit * 0.4;
    }
    for (const shot of shots) {
      if (shot.life <= 0) continue;
      shot.life -= dt;
      if (shot.life <= 0) { shot.node.visible = false; continue; }
      if (shot.splat) continue;
      const p = shot.node.position, ax = p.x, ay = p.y, az = p.z; p.x += shot.vx * dt; p.z += shot.vz * dt; shot.vy -= dt * 9.8; p.y += shot.vy * dt;
      if (zuzu.tomato(ax, ay, az, p.x, p.y, p.z)) { shot.life = 0; shot.node.visible = false; continue; }
      for (let i = 0; i < visitors.length; i++) {
        const visitor = visitors[i], v = visitor.root.position;
        if (Math.hypot(p.x - v.x, p.z - v.z) < 0.85 && p.y < visitor.floorY + 2.6 && p.y > visitor.floorY) { visitor.hit = 1; shot.life = 0; shot.node.visible = false; toast(feedback[i % feedback.length]); break; }
      }
      if (p.y < 0.12) { p.y = 0.04; shot.splat = true; shot.life = 1.4; shot.node.scale.x = shot.node.scale.z = 0.65; shot.node.scale.y = 0.06; }
    }
    priceTimer -= dt;
    if (priceTimer <= 0) {
      priceTimer = 0.4; data.refresh(); const s = data.state;
      const radioLabel = document.getElementById("dsb-radio-status"); if (radioLabel.textContent !== audio.radioStatus) radioLabel.textContent = audio.radioStatus;
      const text = `${s.priceStatus}: $${s.price.toFixed(2)}\n${s.skyStatus}${s.height ? ` · block ${s.height} · ${s.fee} sat/vB` : ""}\n${s.historyStatus}`;
      if (lastPrice !== text) { readout.textContent = text; lastPrice = text; }
    }
  };
  const drawExtra = (ctx, project, drawSpeech) => zuzu?.draw(ctx, project, drawSpeech);
  const overlay = (dt) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), width = overlayCanvas.clientWidth, height = overlayCanvas.clientHeight;
    const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    if (overlayCanvas.width !== w || overlayCanvas.height !== h) { overlayCanvas.width = w; overlayCanvas.height = h; }
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0); fx.drawOverlay(dt, drawExtra);
    if (flash > 0) { overlayCtx.globalAlpha = flash; overlayCtx.fillStyle = "#fff"; overlayCtx.fillRect(0, 0, overlayCanvas.clientWidth, overlayCanvas.clientHeight); overlayCtx.globalAlpha = 1; }
    if (fedUntil > elapsed) {
      const w = overlayCanvas.clientWidth, h = overlayCanvas.clientHeight, t = (fedUntil - elapsed) / 1.5;
      overlayCtx.fillStyle = "#b57a3e"; overlayCtx.fillRect(w * 0.5 - 35 + (1 - t) * 20, h - 100 + Math.sin(t * Math.PI) * 20, 70 * t, 40);
      overlayCtx.fillStyle = "#ffde77"; overlayCtx.fillRect(w * 0.5 - 30 + (1 - t) * 20, h - 96 + Math.sin(t * Math.PI) * 20, 60 * t, 10);
    }
  };
  const buildLand = () => {
    if (land) return;
    land = M.build(); addChild(root, land.root);
    // Reuse the arrival gate and its existing pedestal, outside the central crossing lane.
    Object.assign(transitGate.dialer.position, { x: transitGate.root.position.x + transitGate.outerRadius + 1.2, y: 0, z: VIEW.position.z + 1 });
    transitGate.dialer.rotation.y = Math.PI;
    addChild(land.root, transitGate.dialer); register(transitGate.dialer, "ooga-portal-dialer", "Ooga Portal dialer · " + HOME_NAME);
    transitGate.enableDialer([{ id: home, label: HOME_NAME, enabled: true }, ...Array.from({ length: 4 }, (_, i) => ({ id: "quarantine-" + i, label: "Quarantined - Replicator Infestation - Clean Up In Progress", enabled: false }))]);
    zuzu = BL.dsbAgent.create({ parent: land.root, input, clearAt, landmarks: land.landmarks });
    if (!RAIL_GEOMETRY) {
      RAIL_GEOMETRY = [M.cube("#f05278", 0.5), M.cube("#55e49b", 0.5)];
      SUPPORT_GEOMETRY = [M.cube("#80314d"), M.cube("#287958")];
    }
    data = BL.dsbData.create(); data.start();
    tv = BL.dsbTv.create(land.tvScreen, renderer);
    conversation = BL.dsbConversation.create({ agent: zuzu, onChange: () => { syncPlayer(); syncContext(); } });
    for (let i = 0; i < N; i++) {
      for (let side = 0; side < 2; side++) rails.push(M.block(land.root, "#55e49b", 0, 0, 0, 0.13, 0.14, 1, 0.5));
      ties.push(M.block(land.root, M.C.stone, 0, 0, 0, 1.65, 0.12, 0.2));
      if (i % 4 === 0) candles.push(M.block(land.root, "#287958", 0, 0, 0, 0.3, 1, 0.3));
    }
    buildRide();
    for (let i = 0; i < 6; i++) {
      const contributor = BL.contributors.roster[i % BL.contributors.roster.length], cave = BL.models.caveman(BL.contributors.traitsFor(contributor.name));
      cave.baseY = cave.root.position.y; cave.floorY = i === 5 ? 1.1 : 0; cave.root.position.x = i === 5 ? -18 : -24 + i * 2.2; cave.root.position.z = i === 5 ? -15.6 : -6; cave.heading = i === 5 ? 0 : Math.PI; cave.root.rotation.y = cave.heading; cave.hit = 0;
      addChild(land.root, cave.root); visitors.push(cave); input.add(cave.root, { kind: "visitor", cave, label: `${contributor.name} · tomato target` }, { radius: 1 }); targets.push(cave.root);
      for (const key of ["head", "torso", "armR", "armL", "legR", "legL"]) { const node = cave.parts[key]; input.add(node, { kind: "visitor", cave, label: `${contributor.name} · tomato target` }); targets.push(node); }
    }
    for (let i = 0; i < 12; i++) { const node = M.block(land.root, "#ef4256", 0, 0, 0, 0.28, 0.28, 0.28); node.visible = false; shots.push({ node, life: 0, vx: 0, vy: 0, vz: 0, splat: false }); }
    register(land.tv, "tv", "DSB TV - walk closer to open");
    register(land.shop, "shop", "DSB meme stand · bread and tomatoes"); register(land.dock, "boat", "River train · board at the dock"); register(land.station, "coaster", "Bitcoin ride · board by its sign"); register(land.mic, "stage", "Open mic · Ooga comedy");
    RENDER.lights.set([-24, 5, -15, 14, 0.8, 0.25, 1, 0, -12, 5, -15, 14, 1, 0.8, 0.2, 0]);
  };
  const enter = (ctx) => {
    ({ renderer, game, world, go } = ctx); disposed = false; exiting = false; arrivalTime = gait = glance = 0; glanceTime = 3; lastCue = -1; avatarView = true; phase = "entrance"; progress = elapsed = flash = boatAngle = rideAngle = 0;
    tokens = 20; bread = tomatoes = bananas = 0; boatTrip.angle = 0; trainTrip.angle = START; boatTrip.wait = trainTrip.wait = WAIT; rideYaw = ridePitch = 0; lastContext = "init"; throwAt = -1; fedUntil = 0; priceTimer = 0; savedRevision = -1; lastHeight = skyPulse = 0; lastPrice = lastBag = lastPrompt = "";
    root = createNode(); camera = createCamera({ fov: 55, near: 0.1, far: 220 });
    land = data = tv = zuzu = conversation = null;
    // Local +Y faces inward (-Z); the passage approaches the back from +Z.
    // Seat the lower ring in the floor so standing body centres clear the aperture.
    transitGate = BL.oogaPortal.create({ radius: 2.2, outerRadius: 2.5, position: { x: 0, y: 2.0, z: 0 }, rotation: { x: -Math.PI / 2, y: 0, z: 0 }, receiving: true,
      menuHint: `Cross the active Ooga Portal from DSB Land to return to ${HOME_NAME}.`,
      onMenu: () => { syncPlayer(); pilot.controls.reset(); input.reset(); hud.tooltip.hide(); },
      onTraverse: id => { if (phase === "entrance") reveal(); else if (id === home) departGate(); } });
    addChild(root, transitGate.root);
    const playerName = world.pilot || "YellowBrokeIt";
    world.pilot = playerName;
    playerWorld = { level: 0, weapons: new Map(), magazine: { owned: false, count: 0, ammo: 0, carrier: null } };
    overlayCanvas = ctx.overlay; overlayCtx = overlayCanvas.getContext("2d");
    hud = BL.hud.create({ roster: BL.contributors.roster, catalog: BL.models.SWAG, tierColors: BL.models.TIER_COLORS, renderIcon: BL.hud.renderIcon, lootEnabled: false });
    hud.setAreaLabel("DSB LAND");
    oldSheetHidden = hud.el.sheet.hidden; oldSheetOpen = hud.el.sheet.dataset.open; hud.el.sheet.hidden = true; hud.el.sheet.dataset.open = "false"; hud.setJetpack(false, false, 1); hud.el.act.hidden = true;
    const hooks = {}; input = BL.interact.create({ canvas: ctx.canvas, renderer, camera, hooks });
    pilot = BL.pilot.create({ renderer, canvas: ctx.canvas, camera, hud, presets: { home: VIEW, lookout: { yaw: 0.38, pitch: 0.18, dist: 95, target: { x: 0, y: -4, z: 0 } } }, landing: "home", pitch: [-0.5, 1.2], dist: [3, 95], follow: { y: 1, min: 3, max: 8, pitch: [0.1, 0.8] }, fly: { speed: 5, perDist: 0.1, climb: 4, yMax: 50 }, clampTarget, clampCamera, coarse: matchMedia("(pointer: coarse)").matches, onFreeAction: act, onPlayerAction: playerAction, reloadAnywhere: true, close: { eyeHeight: 1.7, eyeRatio: 0.8, eyeForward: 0, maxStep: 0.6, pitch: [-1.2, 1.2], orbitDist: 12, trailingDist: 5, groundAt: () => 0 } });
    fx = BL.fx.create({ root, renderer, camera, overlay: ctx.overlay, hud, tickerAt: { x: 0, y: 2, z: 26 } });
    const shared = { root, input, hud, game, world: playerWorld, playerName, fx, viewYaw: 0, groundAt: () => 0, walkable, reloadPolicy, onWeaponImpact: weaponImpact, onProjectileMove: projectileMove };
    crew = BL.crew.create(shared); shared.crew = crew; pilot.bind(shared);
    avatar = crew.cavemen.get(playerName); crew.collectMagazine(avatar); avatar.root.rotation.y = Math.PI;
    for (const key of Object.keys(pilot.hooks)) { const hook = pilot.hooks[key]; hooks[key] = (...args) => { if (cameraEnabled() && key !== "onDoubleTap") return hook(...args);
      if ((phase === "boat" || phase === "coaster") && key === "onOrbit") { rideYaw = clamp(rideYaw - args[0] * 0.004, -0.65, 0.65); ridePitch = clamp(ridePitch - args[1] * 0.0035, -0.3, 0.3); } }; }
    Object.assign(hooks, { onTap, onHover: (hit, p) => { if (phase === "land" && hit) hud.tooltip.show(hit.owner.label, p.x, p.y); else hud.tooltip.hide(); } });
    hud.onAction(action); hud.onPreset((name) => { if (phase === "land") pilot.goPreset(name); });
    audio = BL.dsbAudio.create();
    proximity = document.getElementById("dsb-context");
    panel = document.getElementById("dsb-panel"); panel.dataset.phase = phase; panel.dataset.folded = String(matchMedia("(max-width: 720px)").matches); document.getElementById("dsb-toggle").setAttribute("aria-expanded", String(panel.dataset.folded !== "true")); document.getElementById("dsb-toggle").textContent = panel.dataset.folded === "true" ? "Show DSB menu" : "Hide DSB menu"; readout = document.getElementById("dsb-feed"); bag = document.getElementById("dsb-bag"); prompt = document.getElementById("dsb-prompt");
    document.getElementById("dsb-shop").hidden = true; document.getElementById("dsb-live").setAttribute("aria-pressed", "true"); soundUi();
    panel.querySelector('.dsb-intro [data-action="leave"]').textContent = "Back to ₿IFRÖST";
    document.body.classList.add("dsb-active", "dsb-entry"); document.addEventListener("visibilitychange", onVisibility); bagText();
    dsbScene.renderOpts = DARK;
    Object.assign(dsbScene, { root, camera, input, debug: { camera, pilot, crew, controls: pilot.controls, hud, audio, dsb: { clearAt, get zuzu() { return zuzu; }, get conversation() { return conversation; }, get gate() { return transitGate; }, get resources() { return { land: !!land, rides: rails.length, tomatoes: shots.length, shop: !!land, tv: !!tv, zuzu: !!zuzu, conversation: !!conversation, data: !!data, visitors: visitors.length, ambience: !!audio.ambience }; }, get phase() { return phase; }, get arrivalTime() { return arrivalTime; }, get glance() { return glance; }, avatar, get progress() { return progress; }, get inventory() { return { tokens, bread, bananas, tomatoes }; }, get shots() { return shots.filter((s) => s.life > 0).length; }, get land() { return land; }, visitors, get data() { return data; }, get tv() { return tv; }, openTv, boatTrip, trainTrip, get rideLook() { return { yaw: rideYaw, pitch: ridePitch }; }, railY, board, buy, eat, throwTomato, stopRide, get fired() { return Array.from(audio.fired); } } } });
    syncContext(); update(0, 0);
  };
  const leave = () => {
    disposed = true; document.removeEventListener("visibilitychange", onVisibility);
    exiting = true; conversation?.dispose();
    proximity.hidden = true; tv?.dispose(); audio.dispose(); data?.dispose(); pilot.dispose(); crew.dispose(); zuzu?.dispose(); fx.dispose(); transitGate.dispose();
    for (const node of targets) input.remove(node); targets.length = 0;
    const count = input.targetCount; input.dispose(); hud.el.sheet.hidden = oldSheetHidden; hud.el.sheet.dataset.open = oldSheetOpen; hud.dispose();
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    visitors.length = shots.length = rails.length = ties.length = candles.length = 0;
    document.body.classList.remove("dsb-active", "dsb-entry", "dsb-arrival");
    crew = fx = playerWorld = zuzu = conversation = null;
    avatar = land = transitGate = camera = input = pilot = hud = renderer = world = game = go = audio = data = tv = panel = readout = bag = prompt = overlayCanvas = overlayCtx = proximity = null;
    dsbScene.input = dsbScene.debug = null; return { targets: count };
  };
  const stats = () => { let visibleNodes = 0, allNodes = 0; traverseVisible(root, () => visibleNodes++); const visit = (node) => { allNodes++; for (const child of node.children) visit(child); }; visit(root); return { visibleNodes, allNodes, targets: input.targetCount, tweens: tweenCount(), dsbShots: shots.length, phase }; };
  Object.assign(dsbScene, { enter, leave, update, overlay, onKey, stats, onLootCleared: () => {}, onDonation: (donation) => { game.recordDonation(donation); world.level = Math.min(BL.pile.MAX_BANANAS, world.level + BL.game.bananasFor(donation.sats)); }, liveGeometry: (set) => { set.add(avatar.headOpen).add(avatar.headClosed); for (const visitor of visitors) set.add(visitor.headOpen).add(visitor.headClosed); } });
  BL.scenes.dsb = dsbScene;
})();
