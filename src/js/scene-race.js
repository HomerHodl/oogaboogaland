// Ooga Rally: the racing scene, opened from its Ooga Arcade cabinet or its route.
//
// Phases: garage, countdown, racing, paused, finished. A chase camera; lighting from the ten nearest
// torches; donations; `leave`. The rocket start reads the throttle through the count. Every lap
// and the results show the delta against the record lap. The first release of each drift tier is
// taught once a visit. The crowd swells on laps and finishes, and second and third place get podium
// confetti. Prompts switch to touch wording on a coarse pointer. The Mirror toggle (`race-mirror`,
// shown once the Cup is gold) rebuilds the track flipped.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, donations, qr, pile: pileMod, game: gameMod, hud: hudMod, interact: interactMod, controls: controlsMod, fx: fxMod, raceModels, raceTrack, racers: racersMod, raceItems, raceHud, raceAudio } = BL;
  const { clamp, lerp, damp } = math;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { CONFETTI } = fxMod;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const METER_CAPACITY = 60;
  const FIXED = 1 / 120, MAX_SUBSTEPS = 4;
  const COUNTDOWN = 3.4, RESULTS_AFTER = 1.4;
  const CHASE = { dist: 6.4, up: 2.1, ahead: 2.2, lookUp: 1.1, distMin: 3.5, distMax: 11, yawRate: 7, eyeRate: 14, targetRate: 18 };
  const FOV_BASE = 50 * Math.PI / 180, FOV_FAST = 64 * Math.PI / 180;
  const LIGHT_CAPACITY = 10;
  // CUP_POINTS: every track in order, points by finishing place.
  const CUP_POINTS = [10, 8, 6, 5, 4, 3, 2];
  // RAIN_CHANCE 18 is about one race in six wet; drops live in a box that follows the camera.
  const RAIN_CHANCE = 18, RAIN_CAP = 420, SNOW_CAP = 320, WEATHER_RANGE = 17, WEATHER_HEIGHT = 15;
  const DEBUG = new URLSearchParams(location.search).has("debug");
  const rainParam = DEBUG ? new URLSearchParams(location.search).get("rain") : null;
  const hourParam = DEBUG ? parseFloat(new URLSearchParams(location.search).get("hour")) : NaN;
  // Crowd swells for CROWD_SWELL seconds on a lap or a finish; the drift tiers are first taught with a notice.
  const CROWD_SWELL = 3;
  const SPARK = models.particleGeometry("#ffb13b", 0.08, 1);
  const SPARK_BLUE = models.particleGeometry("#79d8ff", 0.09, 1);
  const SPARK_PURPLE = models.particleGeometry("#c99bff", 0.1, 1);
  const DUST = models.particleGeometry("#a3874f", 0.1, 0);
  const SPLASH = models.particleGeometry("#9be0f0", 0.1, 0.4);
  const EMBER = models.particleGeometry("#ff6a1e", 0.09, 1);
  const SNOW = models.particleGeometry("#eef3f7", 0.08, 0.2);
  const BANANA_BIT = models.particleGeometry("#f5c542", 0.08, 0.5);
  const SMOKE = [models.particleGeometry("#9a9a9a", 0.05, 0), models.particleGeometry("#c8c8c8", 0.045, 0), models.particleGeometry("#7a7a7a", 0.055, 0)];
  const SMOKE_RANGE = 40 * 40, CREW_SCREECH_RANGE = 22 * 22;
  const DRIFT_SPARKS = [null, [SPARK], [SPARK, SPARK_BLUE], [SPARK_PURPLE, SPARK_BLUE]];
  const TICKER_AT = { x: 0, y: 8, z: 0 };
  const setVec = (v, x, y, z) => {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const mark = (name) => {
    performance.clearMarks(`ooga:${name}`);
    performance.mark(`ooga:${name}`);
  };
  // selection persists for the page's life: the garage remembers the last pick across visits.
  const selection = { racer: contributors.activeRoster[0]?.name || null, mount: "kart", track: "bay", mirror: false };
  // Bests are kept per track, the mirrored ones under their own key.
  const bestKey = () => selection.mirror ? `${selection.track}-m` : selection.track;

  // These are one visit's state: created in enter, dropped in leave.
  // Where the game exits to: back to Ooga Arcade when a cabinet started it, otherwise the island.
  let home = "hub";
  let renderer, game, world, go, lootEnabled, testBananas, root, camera, hud, rhud, hooks, input, fx, controls, track, racers, items, audio, weather, agent;
  let phase = "garage", countdown = 0, accumulator = 0, sceneTime = 0, finishedAt = 0;
  let meterTimer = 0, stateTimer = 0, hintTimer = 0;
  // revAt is the countdown time the throttle was first held through; -1 while it is off.
  let revAt = -1, crowdSwell = 0, driftTaught = 0;
  const cam = { yaw: 0, offset: 0, dist: CHASE.dist, shake: 0, lookBack: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, warm: false, garageYaw: 0, garageLift: 0 };
  const targets = [];
  const cup = { active: false, round: 0, done: false, points: new Float32Array(contributors.activeRoster.length) };
  const nearestTorches = new Float32Array(LIGHT_CAPACITY * 2);
  const raceScene = {
    id: "race", renderOpts: null, root: null, camera: null, input: null, debug: null, agent: null, agentControls: null,
    get inMotion() {
      return phase === "countdown" || phase === "racing" || fx.inMotion;
    }
  };

  const buildTrack = (id) => {
    if (track) {
      fx.clearParticles();
      removeChild(root, track.root);
      track.dispose();
    }
    const detail = renderer.kind === "canvas2d" ? 0.35 : renderer.quality === "low" ? 0.6 : renderer.quality === "medium" ? 0.8 : 1;
    const rain = rainParam !== null ? rainParam === "1" : math.randomInt(100) < RAIN_CHANCE;
    const def = raceTrack.trackById(id), hours = raceTrack.THEMES[def.theme].hours;
    const hour = Number.isFinite(hourParam) ? hourParam : hours ? hours[math.randomInt(hours.length)] : null;
    track = raceTrack.build(def, { renderer, detail, rain, spectators: !contributors.solo, slots: contributors.activeRoster.length, hour, mirror: selection.mirror });
    addChild(root, track.root);
    buildWeather();
    track.renderOpts.meshRigs = true;
    raceScene.renderOpts = track.renderOpts;
    // Fog that ends in the clear colour with no sky pass hides everything past fogFar, so the far plane stops there.
    const o = track.renderOpts, fogIsClear = !o.horizon && !o.zenith && o.fog && o.clear && o.fog[0] === o.clear[0] && o.fog[1] === o.clear[1] && o.fog[2] === o.clear[2];
    camera.far = fogIsClear ? Math.min(280, o.fogFar + 10) : 280;
    const g = track.grid[0];
    setVec(TICKER_AT, g.x, g.y + 8.5, g.z);
    if (items) items.setTrack(track);
    if (agent) placeAgent();
    mark("track");
  };
  // The Agent watches from beside the grid, pacing on whichever side is dry land.
  const AGENT_SAMPLE = 4, AGENT_SIDE = 5;
  // Heights follow the nearest sample from the last one, so a driven Agent can walk the whole course.
  let agentHint = AGENT_SAMPLE;
  const agentGround = (x, z) => track.heightAt(x, z, agentHint = track.nearest(x, z, agentHint));
  const placeAgent = () => {
    const S = track.samples, i = agentHint = AGENT_SAMPLE, off = track.halfAt(i) + AGENT_SIDE;
    let side = 1;
    if (track.waterAt(S.x[i] + track.rightX(i) * off, S.z[i] + track.rightZ(i) * off)) side = -1;
    const x = S.x[i] + track.rightX(i) * off * side, z = S.z[i] + track.rightZ(i) * off * side;
    agent.place(x, z, Math.atan2(-track.rightX(i) * side, -track.rightZ(i) * side));
    agent.pace(x, z, 1.5);
  };
  const buildWeather = () => {
    if (weather) {
      removeChild(root, weather.node);
      weather = null;
    }
    if (!track.precipitation) return;
    const snow = track.precipitation === "snow", cap = renderer.kind === "canvas2d" ? 120 : snow ? SNOW_CAP : RAIN_CAP;
    const node = createNode({ geometry: snow ? raceModels.snowFlake() : raceModels.rainDrop(), instanceData: new Float32Array(cap * 20), instanceCount: cap, instanceVersion: 0, fixedInstanceCapacity: true });
    weather = { node, snow, cap, x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap), phase: new Float32Array(cap) };
    for (let i = 0; i < cap; i++) {
      weather.x[i] = (Math.random() - 0.5) * WEATHER_RANGE * 2;
      weather.z[i] = (Math.random() - 0.5) * WEATHER_RANGE * 2;
      weather.y[i] = Math.random() * WEATHER_HEIGHT;
      weather.phase[i] = Math.random() * Math.PI * 2;
    }
    addChild(root, node);
  };
  // Drops fall through a box ahead of the camera and wrap to the top with a fresh offset.
  const updateWeather = (dt) => {
    if (!weather) return;
    const w = weather, data = w.node.instanceData;
    const fx0 = Math.sin(cam.yaw), fz0 = Math.cos(cam.yaw);
    const cx = camera.position.x + fx0 * 7, cz = camera.position.z + fz0 * 7, cy = camera.position.y - 5;
    const fall = (w.snow ? 2.6 : 26) * dt;
    for (let i = 0; i < w.cap; i++) {
      w.y[i] -= fall * (0.8 + (i % 5) * 0.08);
      if (w.y[i] < 0) {
        w.y[i] += WEATHER_HEIGHT;
        w.x[i] = (Math.random() - 0.5) * WEATHER_RANGE * 2;
        w.z[i] = (Math.random() - 0.5) * WEATHER_RANGE * 2;
      }
      const sway = w.snow ? Math.sin(sceneTime * 1.3 + w.phase[i]) * 0.6 : 0;
      raceTrack.writeInstance(data, i * 20, w.snow ? sceneTime + w.phase[i] : 0, 1, cx + w.x[i] + sway, cy + w.y[i], cz + w.z[i], 1);
    }
    w.node.instanceVersion++;
  };
  const gridCenter = (out) => {
    let x = 0, z = 0, y = 0;
    for (const g of track.grid) {
      x += g.x;
      z += g.z;
      y += g.y;
    }
    return setVec(out, x / track.grid.length, y / track.grid.length, z / track.grid.length);
  };
  const GRID_CENTER = { x: 0, y: 0, z: 0 };
  const garageView = () => {
    gridCenter(GRID_CENTER);
    const g = track.grid[0], i = g.index;
    const rx = track.rightX(i), rz = track.rightZ(i), tx = track.samples.tx[i], tz = track.samples.tz[i];
    cam.tx = GRID_CENTER.x + tx * 5;
    cam.ty = GRID_CENTER.y + 1.2;
    cam.tz = GRID_CENTER.z + tz * 5;
    const ox = rx * 7 - tx * 16, oz = rz * 7 - tz * 16, c = Math.cos(cam.garageYaw), sn = Math.sin(cam.garageYaw);
    cam.x = cam.tx + ox * c - oz * sn;
    cam.z = cam.tz + ox * sn + oz * c;
    cam.y = GRID_CENTER.y + 5 + cam.garageLift;
    camera.fov = FOV_BASE;
    setVec(camera.position, cam.x, cam.y, cam.z);
    setVec(camera.target, cam.tx, cam.ty, cam.tz);
    cam.warm = false;
  };
  const placeRacers = () => {
    racers.setup({ track, playerName: selection.racer, playerMount: selection.mount, lapCount: track.laps });
    items.setTrack(track);
  };
  const toGarage = () => {
    phase = "garage";
    fx.clearParticles();
    cup.active = false;
    cup.done = false;
    rhud.setCup(game.state.race.cup);
    racers.running = false;
    placeRacers();
    rhud.show("garage");
    hud.el.act.hidden = true;
    garageView();
    hud.setSubtitle(`Ooga Rally · garage${track.precipitation ? ` · ${track.precipitation}` : ""}`);
  };
  const startRace = () => {
    if (!racers.racers.length) return;
    window.clearTimeout(hintTimer);
    hud.hideHint();
    placeRacers();
    phase = "countdown";
    countdown = COUNTDOWN;
    accumulator = 0;
    finishedAt = 0;
    rhud.show("race");
    rhud.center("3", 700);
    rhud.setLap(1, track.laps);
    rhud.setRank(racers.player.rank, racers.racers.length);
    rhud.setItem(null, false);
    rhud.setBoost(0, false, 0);
    rhud.setPips(0, false);
    rhud.setTime(0);
    revAt = -1;
    crowdSwell = 0;
    hud.el.act.hidden = !COARSE;
    hud.setAct("Drift");
    cam.offset = 0;
    cam.lookBack = false;
    cam.warm = false;
    for (const lamp of track.lamps) lamp.glow = 0.1;
    hud.setSubtitle(`Ooga Rally · ${track.name}${track.mirror ? " · mirror" : ""}${track.precipitation ? ` · ${track.precipitation}` : ""}`);
    if (track.precipitation) rhud.notice(track.precipitation === "snow" ? "snow · slippery" : "rain · slippery", 3000);
    else rhud.notice(COARSE ? "hold the throttle on the last count for a rocket start" : "hold W on the last count for a rocket start", 2600);
    if (racers.player.mount.id === "kart") fx.say(racers.player.cave, track.wet ? "Ooga wet." : "Ooga vroom.", 1.4);
  };
  const nextTrackId = () => {
    const list = raceTrack.TRACKS, i = list.findIndex((t) => t.id === track.id);
    return i >= 0 && i < list.length - 1 ? list[i + 1].id : null;
  };
  const startCup = () => {
    if (!racers.player) return;
    cup.active = true;
    cup.done = false;
    cup.round = 0;
    cup.points.fill(0);
    selection.track = raceTrack.TRACKS[0].id;
    rhud.selection.track = selection.track;
    buildTrack(selection.track);
    startRace();
  };
  const nextRace = () => {
    if (!racers.player) return;
    if (cup.active) {
      cup.round++;
      selection.track = raceTrack.TRACKS[cup.round].id;
    } else {
      const id = nextTrackId();
      if (!id) return;
      selection.track = id;
    }
    rhud.selection.track = selection.track;
    buildTrack(selection.track);
    startRace();
  };
  const standings = () => {
    const rows = racers.racers.map((r) => ({ name: r.name, you: r === racers.player, points: cup.points[r.index] }));
    rows.sort((a, b) => b.points - a.points);
    return rows;
  };
  const resultRows = () => racers.order.map((r) => {
    let time = r.finishTime * 1000, estimated = false;
    if (!r.finished) {
      const pace = r.bestLap || (r.lap > 1 ? racers.raceTime / (r.lap - 1) : track.length / (r.mount.top * 0.8));
      time = (racers.raceTime + Math.max(0, (track.laps - r.lap + 1) - r.progress / track.length) * pace) * 1000;
      estimated = true;
    }
    return { name: r.name, you: r === racers.player, finished: true, estimated, time };
  });
  // A medal is a place and a pace: gold is a win under the gold time, silver a podium under the silver
  // time, bronze a top-six finish under the bronze time. The pace medal is named when the place held it back.
  const MEDAL_ORDER = ["bronze", "silver", "gold"], PLACE_CAP = ["gold", "silver", "silver", "bronze", "bronze", "bronze"];
  const medalNow = (p) => {
    if (!p.finished) return { medal: null, pace: null };
    const pace = rhud.medalFor(track.targets, Math.round(p.finishTime * 1000)), cap = PLACE_CAP[p.rank - 1] || null;
    const medal = pace && cap ? MEDAL_ORDER[Math.min(MEDAL_ORDER.indexOf(pace), MEDAL_ORDER.indexOf(cap))] : null;
    return { medal, pace };
  };
  const placeFor = (medal) => medal === "gold" ? "1st" : medal === "silver" ? "top 3" : "top 6";
  const renderResults = () => {
    const p = racers.player;
    const { medal, pace } = medalNow(p);
    const lapGap = p.finished && lapBefore ? Math.round(p.bestLap * 1000) - lapBefore : 0;
    let summary = p.finished ? `${racers.rankLabel(p.rank)} · best lap ${rhud.formatTime(p.bestLap * 1000)}${lapGap ? ` (${lapGap > 0 ? "+" : "-"}${(Math.abs(lapGap) / 1000).toFixed(2)})` : ""}${medal ? ` · ${medal.toUpperCase()}` : ""}${pace && pace !== medal ? ` · ${pace} pace, ${placeFor(pace)} for it` : ""}${recordImproved ? " · new record" : ""}` : "Did not finish";
    const extra = {};
    if (cup.active || cup.done) {
      const table = standings(), place = table.findIndex((r) => r.you) + 1;
      extra.standings = table;
      if (cup.done) {
        const cupMedal = ["gold", "silver", "bronze"][place - 1];
        extra.note = "Cup final";
        summary = `Cup: ${racers.rankLabel(place)} with ${cup.points[p.index]} points${cupMedal ? ` · ${cupMedal.toUpperCase()} CUP` : ""}${cupRecord ? " · best cup yet" : ""}`;
      } else {
        extra.note = `Cup · race ${cup.round + 1} of ${raceTrack.TRACKS.length} · ${track.name}`;
        extra.next = "Next race";
      }
    } else if (p.finished && p.rank <= 3 && nextTrackId()) extra.next = "Next track";
    rhud.results(resultRows(), summary, extra);
  };
  let recordImproved = false, cupRecord = false;
  const finishRace = () => {
    if (!racers.player) return;
    phase = "finished";
    const p = racers.player;
    // The lap delta reads the record before it is written.
    lapBefore = game.state.race.best[bestKey()] ? game.state.race.best[bestKey()].lap : 0;
    recordImproved = p.finished && game.recordRace(bestKey(), Math.round(p.bestLap * 1000), Math.round(p.finishTime * 1000), medalNow(p).medal);
    if (cup.active) {
      for (const r of racers.racers) cup.points[r.index] += CUP_POINTS[Math.min(CUP_POINTS.length, r.rank) - 1];
      if (cup.round === raceTrack.TRACKS.length - 1) {
        cup.active = false;
        cup.done = true;
        const place = standings().findIndex((r) => r.you) + 1;
        cupRecord = game.recordCup(place, cup.points[p.index]);
      }
    }
    renderResults();
    hud.el.act.hidden = true;
    rhud.el.mirror.hidden = !mirrorOpen();
    if (p.rank === 1 || (cup.done && standings()[0].you)) {
      fx.burst(p.x, p.y + 1.5, p.z, 30, CONFETTI, 2.6);
      fx.say(p.cave, cup.done ? "OOGA CUP!" : "OOGA CHAMPION!", 3);
    } else if (p.rank <= 3) {
      fx.burst(p.x, p.y + 1.5, p.z, 12, CONFETTI, 2);
      fx.say(p.cave, "Good race.", 2.5);
    } else fx.say(p.cave, "Next time.", 2.5);
  };
  let lapBefore = 0;
  // The mirror is the Cup's gold prize.
  const mirrorOpen = () => !!(game.state.race.cup && game.state.race.cup.medal === "gold");
  const toggleMirror = () => {
    if (!mirrorOpen()) return;
    selection.mirror = !selection.mirror;
    rhud.el.mirror.setAttribute("aria-pressed", String(selection.mirror));
    buildTrack(selection.track);
    toGarage();
    rhud.refreshTracks();
  };
  const pause = (on) => {
    if (on && phase === "racing") {
      phase = "paused";
      rhud.show("pause");
      audio.quiet();
    } else if (!on && phase === "paused") {
      phase = "racing";
      rhud.show("race");
    }
  };

  const updateCamera = (dt) => {
    const p = racers.player;
    if (!p) return;
    const m = p.mount;
    const back = cam.lookBack ? Math.PI : 0;
    const wantYaw = p.heading + cam.offset + back;
    const rate = cam.warm ? CHASE.yawRate * (p.drift.active ? 0.7 : 1) : 1e6;
    cam.yaw = wrap(cam.yaw + damp(0, wrap(wantYaw - cam.yaw), rate, dt));
    const speedK = clamp(Math.abs(p.speed) / m.top, 0, 1.4);
    const dist = clamp(cam.dist + speedK * 1.4, CHASE.distMin, CHASE.distMax + 2);
    const fx0 = Math.sin(cam.yaw), fz0 = Math.cos(cam.yaw);
    let ex = p.x - fx0 * dist, ez = p.z - fz0 * dist, ey = p.y + CHASE.up + speedK * 0.3;
    const floor = track.heightAt(ex, ez, p.idx) + 0.6;
    if (ey < floor) ey = floor;
    const tx = p.x + Math.sin(p.heading) * CHASE.ahead * (cam.lookBack ? -1 : 1), tz = p.z + Math.cos(p.heading) * CHASE.ahead * (cam.lookBack ? -1 : 1), ty = p.y + CHASE.lookUp;
    if (!cam.warm) {
      cam.x = ex;
      cam.y = ey;
      cam.z = ez;
      cam.tx = tx;
      cam.ty = ty;
      cam.tz = tz;
      cam.warm = true;
    } else {
      cam.x = damp(cam.x, ex, CHASE.eyeRate, dt);
      cam.y = damp(cam.y, ey, CHASE.eyeRate * 0.7, dt);
      cam.z = damp(cam.z, ez, CHASE.eyeRate, dt);
      cam.tx = damp(cam.tx, tx, CHASE.targetRate, dt);
      cam.ty = damp(cam.ty, ty, CHASE.targetRate, dt);
      cam.tz = damp(cam.tz, tz, CHASE.targetRate, dt);
    }
    cam.shake = Math.max(0, cam.shake - dt * 3);
    const jolt = cam.shake * cam.shake * 0.35;
    setVec(camera.position, cam.x + Math.sin(sceneTime * 43) * jolt, cam.y + Math.sin(sceneTime * 37) * jolt, cam.z + Math.cos(sceneTime * 41) * jolt);
    setVec(camera.target, cam.tx, cam.ty, cam.tz);
    const fast = clamp((Math.abs(p.speed) - m.top * 0.55) / (m.top * 0.6), 0, 1) + (p.boost > 0 ? 0.35 : 0);
    camera.fov = damp(camera.fov, lerp(FOV_BASE, FOV_FAST, Math.min(1, fast)), 6, dt);
  };
  // Shadows follow the player; the ten nearest torches (LIGHT_CAPACITY) become point lights.
  const updateLighting = () => {
    const opts = track.renderOpts, p = racers.player;
    const cx = p ? p.x : camera.target.x, cz = p ? p.z : camera.target.z, cy = p ? p.y : camera.target.y;
    setVec(opts.shadowCenter, cx, cy, cz);
    opts.time = sceneTime;
    const torches = track.torches;
    let count = 0;
    for (let i = 0; i < torches.length; i++) {
      const t = torches[i], d = (t.x - cx) ** 2 + (t.z - cz) ** 2;
      if (d > 60 * 60) continue;
      if (count === LIGHT_CAPACITY && d >= nearestTorches[(count - 1) * 2]) continue;
      let k = count < LIGHT_CAPACITY ? count++ : count - 1;
      while (k > 0 && nearestTorches[(k - 1) * 2] > d) {
        nearestTorches[k * 2] = nearestTorches[(k - 1) * 2];
        nearestTorches[k * 2 + 1] = nearestTorches[(k - 1) * 2 + 1];
        k--;
      }
      nearestTorches[k * 2] = d;
      nearestTorches[k * 2 + 1] = i;
    }
    for (let k = 0; k < count; k++) {
      const t = torches[nearestTorches[k * 2 + 1]], o = k * 8;
      opts.lights[o] = t.x;
      opts.lights[o + 1] = t.y;
      opts.lights[o + 2] = t.z;
      opts.lights[o + 3] = 9;
      opts.lights[o + 4] = 1.0 * t.flame.glow;
      opts.lights[o + 5] = 0.55 * t.flame.glow;
      opts.lights[o + 6] = 0.22 * t.flame.glow;
    }
    opts.lightCount = count;
  };

  const readPlayerInput = () => {
    const p = racers.player;
    if (!p || phase !== "racing") return;
    const a = controls.read();
    let throttle = a.y;
    if (COARSE) throttle = a.y < -0.4 ? a.y : 1;
    cam.lookBack = a.yaw > 0.5;
    racers.setInput(p, a.x, throttle, a.up > 0, false);
  };
  const useItem = () => {
    const p = racers.player;
    if (!p || phase !== "racing") return;
    items.use(p);
  };

  const wireEvents = () => {
    racers.events.onDrift = (r, tier) => {
      if (tier === 0) peelOut(r, 0.08, 0.4, 3);
      if (tier === 0 && r === racers.player) audio.cues.driftStart();
      if (tier > 0) {
        fx.burst(r.x, r.y + 0.3, r.z, 6 + tier * 4, DRIFT_SPARKS[tier], 2 + tier);
        if (r === racers.player) {
          cam.shake = Math.max(cam.shake, 0.3 + tier * 0.15);
          audio.cues.boost();
          // The tiers are taught the first time each is released, once a visit.
          if (tier > driftTaught) {
            driftTaught = tier;
            rhud.notice(tier === 3 ? "purple drift · the big boost" : tier === 2 ? "blue drift · hold it longer for purple" : "drift boost · hold the drift longer for more", 2000);
          }
        }
      }
    };
    racers.events.onLand = (r, hard) => {
      fx.burst(r.x, r.y + 0.1, r.z, hard ? 10 : 5, [track.theme === "peak" ? SNOW : DUST], hard ? 2 : 1.2);
      if (r === racers.player) {
        if (hard) cam.shake = Math.max(cam.shake, 0.5);
        audio.cues.land();
      }
    };
    racers.events.onHop = (r) => {
      if (r === racers.player) audio.cues.hop();
    };
    racers.events.onWall = (r) => {
      peelOut(r, 0.1, 0.35);
      if (r === racers.player) {
        audio.cues.wall();
        cam.shake = Math.max(cam.shake, 0.3);
      }
    };
    racers.events.onBump = (a, b) => {
      peelOut(a, 0.07, 0.25, 3);
      if (a === racers.player || b === racers.player) audio.cues.bump();
    };
    racers.events.onRespawn = (r, why) => {
      const geo = why === "lava" ? EMBER : why === "water" ? SPLASH : DUST;
      fx.burst(r.x, r.y + 0.5, r.z, 12, [geo], 2.2);
      fx.say(r.cave, why === "lava" ? "HOT HOT HOT!" : why === "water" ? "Glub." : "Whoa!", 1.6);
      if (r === racers.player) {
        cam.warm = false;
        cam.shake = 0.6;
        if (why === "water") audio.cues.splash();
        else audio.cues.respawn();
      }
    };
    // Each lap reads against the record lap, so a chase has a number.
    racers.events.onLap = (r) => {
      if (r !== racers.player) return;
      rhud.center(r.lap === track.laps ? "FINAL LAP" : `LAP ${r.lap}`, 1200);
      const best = game.state.race.best[bestKey()], gap = best && best.lap ? Math.round(r.lapTime * 1000) - best.lap : 0;
      rhud.notice(`lap ${rhud.formatTime(r.lapTime * 1000)}${gap ? ` · ${gap > 0 ? "+" : "-"}${(Math.abs(gap) / 1000).toFixed(2)}` : ""}`, 2200);
      audio.cues.lap();
      crowdSwell = CROWD_SWELL;
    };
    racers.events.onFinish = (r) => {
      if (r === racers.player) {
        finishedAt = sceneTime;
        crowdSwell = CROWD_SWELL;
        rhud.center("FINISH", 1600);
        audio.cues.finish();
      } else if (phase === "racing") fx.say(r.cave, "Ooga done!", 1.5);
      else if (phase === "finished") renderResults();
    };
    racers.events.onWrongWay = (r, on) => {
      if (r === racers.player) rhud.notice(on ? "wrong way" : "", on ? 0 : 1);
    };
    items.events.onBanana = (r) => {
      fx.burst(r.x, r.y + 0.6, r.z, 3, [BANANA_BIT], 1.2);
      if (r === racers.player) {
        if (r.meterFull) {
          rhud.notice(COARSE ? "turbo ready · tap Boost" : "turbo ready · press E", 1800);
          audio.cues.meter();
        } else audio.cues.banana();
      }
    };
    items.events.onCrate = (r, item) => {
      fx.burst(r.x, r.y + 0.8, r.z, 6, CONFETTI, 1.6);
      if (r === racers.player) {
        rhud.notice(COARSE ? `${items.ITEMS[item]} · tap the button` : `${items.ITEMS[item]} · press E${item === "rock" ? " · brake to throw it back" : item === "peel" ? " · brake to lay it ahead" : ""}`, 2200);
        audio.cues.crate();
      }
    };
    items.events.onItem = (r, item) => {
      if (item === "turbo" || item === "meter") fx.burst(r.x, r.y + 0.3, r.z, 10, [SPARK_BLUE, SPARK], 2.4);
      if (r === racers.player) {
        cam.shake = Math.max(cam.shake, item === "shout" ? 0.5 : 0.25);
        if (item === "rock") audio.cues.throwRock();
        else if (item === "peel") audio.cues.peel();
        else if (item === "shout") audio.cues.shout();
        else audio.cues.turbo();
      } else if (item === "shout" && Math.hypot(r.x - racers.player.x, r.z - racers.player.z) < 20) audio.cues.shout();
    };
    items.events.onHit = (r, by, kind) => {
      fx.burst(r.x, r.y + 0.8, r.z, 8, [SPARK, DUST], 2);
      fx.say(r.cave, kind === "peel" ? "Slippy!" : kind === "boulder" ? "OOF." : "Ow! Rock!", 1.4);
      if (r === racers.player) cam.shake = Math.max(cam.shake, 0.7);
      if (by === racers.player && by) hud.toast(`${BL.characters.displayOf(r.name)} spun out`);
      if (r === racers.player || by === racers.player) audio.cues.hit();
      peelOut(r, 0.12, 0.4, 5);
    };
    items.events.onPad = (r) => {
      fx.burst(r.x, r.y + 0.2, r.z, 6, [SPARK], 2);
    };
  };

  // Engine audio follows the visitor's racer; everything goes quiet outside a race.
  const updateAudio = (dt) => {
    const p = racers.player, a = audio.state;
    if (phase !== "racing" && phase !== "countdown" && phase !== "finished") {
      // setTargetAtTime is idempotent at target, so schedule the quiet fade once (quieted guard).
      if (!quieted) {
        audio.quiet();
        quieted = true;
      }
      return;
    }
    quieted = false;
    a.speed = p.speed;
    a.top = p.mount.top;
    a.mount = p.mount.id;
    // During countdown a held throttle revs in place, and everyone winds up for the last count (<1.4 s).
    a.throttle = phase === "countdown" ? (countdown < 1.4 || controls.read().y > 0.5 ? 1 : 0) : p.throttle;
    a.drifting = p.drift.active && !p.airborne ? 1 : 0;
    a.boosting = p.boost > 0 ? 1 : 0;
    a.offroad = p.offroad && !p.airborne ? 1 : 0;
    const g = track.grid[0];
    a.crowd = contributors.solo ? 0 : Math.max(1 - clamp(Math.hypot(p.x - g.x, p.z - g.z) / 70, 0, 1), crowdSwell > 0 ? 1 : 0);
    a.rain = track.precipitation === "rain" ? 1 : 0;
    if (phase === "racing") {
      if (Math.abs(p.steer) > 0.6 && Math.abs(p.speed) > p.mount.top * 0.65 && !p.drift.active && !p.airborne && sceneTime - screechAt > 1.6) peelOut(p, 0.04 + Math.abs(p.steer) * 0.03, 0.3, 2);
      if (sceneTime - crewScreechAt > 2.2) {
        for (const r of racers.racers) {
          if (r === p || r.mount.id !== "kart" || r.airborne || Math.abs(r.speed) < r.mount.top * 0.6 || (!r.drift.active && Math.abs(r.steer) < 0.7)) continue;
          if ((r.x - camera.position.x) ** 2 + (r.z - camera.position.z) ** 2 > CREW_SCREECH_RANGE) continue;
          fx.burst(r.x - Math.sin(r.heading) * 0.7, r.y + 0.15, r.z - Math.cos(r.heading) * 0.7, 2, SMOKE, 0.9);
          audio.cues.screech(0.03, 0.3);
          crewScreechAt = sceneTime;
          break;
        }
      }
    }
    audio.update(dt);
  };
  let screechAt = -9, crewScreechAt = -9, quieted = false;
  const peelOut = (r, level, dur, puffs = 4) => {
    if ((r.x - camera.position.x) ** 2 + (r.z - camera.position.z) ** 2 < SMOKE_RANGE) fx.burst(r.x - Math.sin(r.heading) * 0.7, r.y + 0.15, r.z - Math.cos(r.heading) * 0.7, puffs, SMOKE, 0.9);
    if (r === racers.player) {
      audio.cues.screech(level, dur);
      screechAt = sceneTime;
    }
  };
  const toggleMute = () => {
    audio.setMuted(!audio.muted);
    rhud.el.mute.setAttribute("aria-pressed", String(audio.muted));
    hud.toast(audio.muted ? "Sound off" : "Sound on");
  };
  const onGesture = () => audio.unlock();

  const onDonation = (donation) => {
    game.recordDonation(donation);
    const bananas = gameMod.bananasFor(donation.sats);
    world.level = Math.min(pileMod.MAX_BANANAS, world.level + bananas);
    const who = donation.handle ? `@${donation.handle}` : "anon";
    const loot = lootEnabled ? game.lootFor(donation) : null;
    hud.toast(`+${gameMod.formatLarge(donation.sats)} sats · ${bananas} banana${bananas > 1 ? "s" : ""} · ${who}${loot ? ` · ${loot.tier} ${loot.item.name}` : ""}`);
    fx.showTicker(`THANKS ${donation.handle ? "@" + donation.handle.toUpperCase() : "ANON"} · ${bananas} BANANAS`, 4.5);
    const p = racers.player;
    if (p) fx.burst(p.x, p.y + 1.6, p.z, 20, CONFETTI, 2.2);
    // Set taken to 0.01, not 0: race-items' countdown branch must run once to make the banana visible again.
    for (const b of items.bananas) if (b.taken > 0) b.taken = 0.01;
    if (loot) {
      game.addItem({ item: loot.item, tier: loot.tier, donationId: donation.id });
      renderLocker();
    }
    hud.setStats(game.state);
    meterTimer = 0;
  };
  const renderLocker = () => hud.renderInventory(game.state.inventory, game.assignedTo, () => null);

  const updateMeter = () => {
    hud.setMeter(world.level, METER_CAPACITY, phase === "racing" ? `${racers.rankLabel(racers.player.rank)} of ${racers.racers.length}` : "stable");
  };
  const tooltipFor = (hit) => {
    const o = hit.owner;
    if (o.kind === "racer") return BL.characters.displayOf(o.racer.name);
    return "";
  };
  const simulate = (dt) => {
    accumulator = Math.min(accumulator + dt, FIXED * MAX_SUBSTEPS);
    let first = true;
    while (accumulator >= FIXED) {
      accumulator -= FIXED;
      racers.substep(FIXED);
      items.update(FIXED, sceneTime, first);
      first = false;
    }
  };
  const update = (dt, elapsed) => {
    sceneTime = elapsed;
    if (phase === "countdown") {
      const before = countdown;
      countdown -= dt;
      const step = (t) => Math.ceil(t - 0.4);
      if (step(before) !== step(countdown) && countdown > 0.4) {
        rhud.center(String(step(countdown)), 700);
        audio.cues.count();
      }
      // The throttle held through the count: from the last count it is a rocket start, from earlier wheelspin.
      const revving = controls.read().y > 0.5;
      if (revving && revAt < 0) revAt = countdown;
      else if (!revving) revAt = -1;
      for (let i = 0; i < track.lamps.length; i++) track.lamps[i].glow = countdown < COUNTDOWN - (i + 1) * 0.9 ? 1 : 0.1;
      if (countdown <= 0.4 && before > 0.4) {
        const start = revAt < 0 ? "" : revAt <= 1.4 ? "boost" : "spin";
        rhud.center(start === "boost" ? "ROCKET START!" : "GO!", 800);
        if (start === "spin") rhud.notice("too early · wheelspin", 1400);
        audio.cues.go();
        racers.start(start);
        peelOut(racers.player, start === "spin" ? 0.2 : 0.12, 0.6, start === "spin" ? 10 : 6);
        if (start === "boost") {
          fx.burst(racers.player.x, racers.player.y + 0.3, racers.player.z, 12, DRIFT_SPARKS[2], 3);
          audio.cues.boost();
        }
        phase = "racing";
        for (const lamp of track.lamps) lamp.glow = 1;
      }
    }
    if (crowdSwell > 0) crowdSwell -= dt;
    if (phase === "racing" || phase === "finished") {
      readPlayerInput();
      simulate(dt);
      if (phase === "racing" && finishedAt && sceneTime - finishedAt > RESULTS_AFTER) finishRace();
    }
    racers.pose(dt, camera.position.x, camera.position.z);
    track.update(elapsed, camera.position.x, camera.position.z);
    agent.update(dt);
    updateWeather(dt);
    if (phase === "garage") {
      camera.position.x = cam.x;
      camera.position.y = cam.y;
      camera.position.z = cam.z;
    } else updateCamera(dt);
    updateLighting();
    updateAudio(dt);
    fx.update(dt);
    stepTweens(dt);
    if (phase === "racing" || phase === "finished") {
      const p = racers.player;
      rhud.setRank(p.rank, racers.racers.length);
      rhud.setLap(p.lap, track.laps);
      rhud.setTime(racers.raceTime * 1000);
      rhud.setItem(p.item, p.meterFull);
      // The bar is the drift's charge, coloured by its tier; the bananas are the pips beside it.
      rhud.setBoost(p.drift.active ? Math.min(1, p.drift.charge / 2.2) : 0, p.drift.active && p.drift.tier >= 3, p.drift.active ? p.drift.tier : 0);
      rhud.setPips(p.bananas, p.meterFull);
      rhud.setSpeed(Math.abs(p.speed) * 2.6);
    }
    meterTimer -= dt;
    if (meterTimer <= 0) {
      meterTimer = 0.25;
      updateMeter();
    }
  };
  const drawExtra = (ctx2d) => {
    if (phase !== "racing" && phase !== "finished" && phase !== "paused") return;
    const { width, height } = renderer.size;
    const p = racers.player;
    rhud.minimap(ctx2d, track, racers.racers, p, width, height);
    if (p && phase === "racing") rhud.speedLines(ctx2d, p.boost > 0 ? 1 : clamp((Math.abs(p.speed) - p.mount.top * 0.92) / (p.mount.top * 0.4), 0, 1), width, height, sceneTime);
  };
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  const onLootCleared = () => {
    if (!lootEnabled) return;
    renderLocker();
    hud.toast("Loot locker cleared");
  };
  const demoTip = (sats) => onDonation({ id: `demo-${Date.now()}`, sats, handle: game.state.handle, message: game.state.message, at: Date.now() });
  const onKey = (e) => {
    if (e.key === "Escape") {
      if (phase === "racing") pause(true);
      else if (phase === "paused") pause(false);
      else if (phase === "finished") toGarage();
      else go(home);
    }
    if (e.key === "e" || e.key === "E" || e.key === "Shift") useItem();
    if (e.key === "0") cam.offset = 0;
    if (e.key === "m" || e.key === "M") toggleMute();
    if (e.key === "Enter" && phase === "garage") startRace();
    if (e.key === "Enter" && phase === "finished" && !rhud.el.next.hidden) nextRace();
    if (e.key === "b" || e.key === "B") {
      world.level = Math.min(pileMod.MAX_BANANAS, world.level + testBananas);
      hud.toast(`+${testBananas} test bananas`);
    }
    if (e.key === "l" || e.key === "L") demoTip(120000);
  };
  const onBlur = () => pause(true);

  const enter = (ctx) => {
    ({ renderer, game, world, go, lootEnabled, testBananas } = ctx);
    home = ctx.from === "arcade" ? "arcade" : "hub";
    camera = createCamera({ fov: 50, near: 0.3, far: 280 });
    root = createNode();
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    fx = fxMod.create({ root, renderer, camera, hud, overlay: ctx.overlay, tickerAt: TICKER_AT });
    rhud = raceHud.create({
      tracks: raceTrack.TRACKS, mounts: racersMod.MOUNTS, roster: contributors.activeRoster, best: () => game.state.race.best, mirror: () => selection.mirror,
      onPick: (kind, key) => {
        selection[kind] = key;
        if (kind === "track") {
          buildTrack(key);
          toGarage();
        } else placeRacers();
      }
    });
    Object.assign(rhud.selection, selection);
    hud.dismissOutside(rhud.el.pause, () => pause(false));
    driftTaught = 0;
    rhud.el.mirror.hidden = !mirrorOpen();
    rhud.el.mirror.setAttribute("aria-pressed", String(selection.mirror));
    rhud.buildGarage((name) => contributors.stateFor(contributors.activeRoster.find((c) => c.name === name)));
    buildTrack(selection.track);
    agent = raceScene.agent = BL.agent.create({ groundAt: agentGround, form: "code" });
    addChild(root, agent.root);
    placeAgent();
    racers = racersMod.create({ root, input, fx, game, track, renderer });
    mark("racers");
    items = raceItems.create({ root, racers, fx, track });
    items.setTrack(track);
    wireEvents();
    controls = controlsMod.create({ move: document.getElementById("joy-move"), look: null, boost: hud.el.act, chord: ctx.canvas });
    raceScene.agentControls = controls;
    audio = raceAudio.create();
    // sceneTime restarts at 0 on every enter, so reset these marks or stale future marks silence the cues.
    screechAt = crewScreechAt = -9;
    quieted = false;
    rhud.el.mute.setAttribute("aria-pressed", String(audio.muted));
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    const donationRequest = donations.createRequest(game.state);
    qr.drawTo(hud.el.qr, donationRequest.url, { quiet: 3, dark: "#000000", light: "#f3efe4" });
    hud.setDonationUrl(donationRequest.url);
    hud.setIdentity(game.state);
    hud.onIdentityChange(({ handle, message }) => {
      game.setIdentity({ handle: donations.sanitize(handle, donations.HANDLE_MAX), message: donations.sanitize(message, donations.MESSAGE_MAX) });
      hud.setIdentity(game.state);
    });
    hud.onAssign((entryId, name) => {
      if (game.assign(entryId, name)) renderLocker();
    });
    hud.onUnassign((name) => {
      game.unassign(name);
      renderLocker();
    });
    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit) hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.kind === "racer" ? hit.owner.racer.cave : null);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tooltipFor(hit), p.x, p.y, hit.owner.kind === "racer" ? hit.owner.racer.cave : null),
      onTap: (hit) => {
        if (hit && hit.owner.kind === "racer") {
          if (phase === "garage") rhud.el.racers.querySelector(`[data-racer="${hit.owner.racer.name}"]`).click();
          else fx.say(hit.owner.racer.cave, "Ooga busy!", 1.2);
        }
      },
      onOrbit: (dx, dy) => {
        if (phase !== "garage") cam.offset = clamp(cam.offset - dx * 4e-3, -2.6, 2.6);
        else {
          cam.garageYaw = wrap(cam.garageYaw - dx * 5e-3);
          cam.garageLift = clamp(cam.garageLift + dy * 0.02, -2.6, 5);
          garageView();
        }
      },
      onZoom: (factor) => {
        cam.dist = clamp(cam.dist * factor, CHASE.distMin, CHASE.distMax);
      }
    });
    hud.onAction((action) => {
      if (action === "race-start") startRace();
      else if (action === "cup-start") startCup();
      else if (action === "race-next") nextRace();
      else if (action === "race-again") startRace();
      else if (action === "garage") toGarage();
      else if (action === "race-mirror") toggleMirror();
      else if (action === "race-resume") pause(false);
      else if (action === "leave") go(home);
      else if (action === "item") useItem();
      else if (action === "mute") toggleMute();
      else if (action === "tip") demoTip(1200);
      else if (action === "tip-legendary") demoTip(120000);
      else if (action === "clear-loot") {
        game.clearLoot();
        onLootCleared();
      } else if (action === "reset") {
        game.resetAll();
        location.reload();
      }
    });
    for (const cave of contributors.activeRoster) hud.setRosterRow(cave.name, contributors.stateFor(cave), contributors.ageLabel(cave));
    if (lootEnabled) renderLocker();
    hud.setStats(game.state);
    hud.el.sheet.dataset.open = "false";
    rhud.el.joyLook.hidden = true;
    rhud.el.help.textContent = COARSE ? "Drag to look round the garage · left stick steers · hold Drift · tap Throw" : "Drag to look round the garage · W A S D or arrows drive · hold Space to drift, tap to hop · E throws · Q looks back · Escape pauses";
    meterTimer = 0;
    phase = "garage";
    cam.garageYaw = cam.garageLift = 0;
    toGarage();
    stateTimer = window.setInterval(() => {
      for (const cave of contributors.activeRoster) hud.setRosterRow(cave.name, contributors.stateFor(cave), contributors.ageLabel(cave));
      fx.trimPool();
    }, 6e4);
    hintTimer = window.setTimeout(() => hud.hint(COARSE ? "Tap an Ooga, a ride and a track, then Race!" : "Pick an Ooga, a ride and a track, then Race! (Enter)"), 1200);
    window.addEventListener("blur", onBlur);
    Object.assign(raceScene, {
      root, camera, input,
      debug: {
        hud, demoTip, trimPool: fx.trimPool, camera, controls, cavemen: null, crates: null, agent: agent.debug,
        get audio() {
          return audio;
        },
        get track() {
          return track;
        },
        get racers() {
          return racers;
        },
        get items() {
          return items;
        },
        get renderOpts() {
          return track.renderOpts;
        },
        get weather() {
          return weather ? { kind: track.precipitation, count: weather.cap } : null;
        },
        race: {
          get phase() {
            return phase;
          },
          selection, startRace, startCup, nextRace, toGarage, pause, finishRace, cup, simulate: (seconds) => {
            for (let t = 0; t < seconds; t += FIXED) {
              sceneTime += FIXED;
              racers.substep(FIXED);
              items.update(FIXED, sceneTime);
            }
          },
          get cam() {
            return cam;
          },
          get sceneTime() {
            return sceneTime;
          }
        }
      }
    });
  };
  const leave = () => {
    window.clearInterval(stateTimer);
    window.clearTimeout(hintTimer);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    audio.dispose();
    items.dispose();
    racers.dispose();
    fx.dispose();
    controls.dispose();
    hud.el.act.hidden = true;
    hud.setAct("Ooga!");
    rhud.el.joyLook.hidden = false;
    if (weather) removeChild(root, weather.node);
    weather = null;
    agent.dispose();
    removeChild(root, track.root);
    track.dispose();
    for (const node of targets) input.remove(node);
    targets.length = 0;
    const count = input.targetCount;
    input.dispose();
    rhud.dispose();
    hud.dispose();
    raceScene.renderOpts = null;
    track = racers = items = hud = rhud = hooks = input = fx = controls = audio = agent = null;
    raceScene.input = raceScene.debug = raceScene.agent = raceScene.agentControls = null;
    return { targets: count };
  };
  const liveGeometry = (set) => {
    agent.liveGeometry(set);
    for (const r of racers.racers) set.add(r.cave.headOpen).add(r.cave.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), ...racers.stats(), ...items.stats(), sectors: track.sectors.length, phase };
  };
  Object.assign(raceScene, { enter, update, overlay, onDonation, onKey, onLootCleared, leave, stats, liveGeometry });
  BL.scenes = BL.scenes || {};
  BL.scenes.race = raceScene;
})();
