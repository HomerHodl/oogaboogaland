(() => {
  "use strict";
  const { scene, models, donations, glRenderer, canvasRenderer, game: gameMod, pile: pileMod, router: routerMod, scenes } = window.BL;
  // The optional build-time Oogatron snapshot loads before the director.
  // Activity uses each contributor's timestamp, never the snapshot build time.
  if (window.BL.jumbotronData) window.BL.contributors.applySnapshot(window.BL.jumbotronData);
  const { clearTweens, tweenCount } = scene;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  // A game still being built sets `wip: true` on its scene and stays unregistered, so nothing can enter it
  // and its cave seals, unless the page opts in: ?wip=<scene id> opens that game and lands in it, wip=1 opens
  // every one. No debug needed, so anyone can play a shared link. Its saves are left alone for the day it opens.
  const WIP = params.get("wip");
  for (const id of Object.keys(scenes)) if (scenes[id].wip && WIP !== "1" && WIP !== id) delete scenes[id];
  for (const slot of window.BL.caves.slots) if (slot.scene && !scenes[slot.scene]) Object.assign(slot, { scene: null, status: "dark" });
  // Loot crates, locker tab and worn swag; the suite turns them on with ?debug=1&loot=1
  const LOOT_DEFAULT = false;
  const LOOT_ENABLED = DEBUG && params.has("loot") ? params.get("loot") === "1" : LOOT_DEFAULT;
  const requestedBananas = Number(params.get("bananas"));
  const START_BANANAS = DEBUG && params.has("bananas") && Number.isFinite(requestedBananas) && requestedBananas >= 0
    ? Math.min(pileMod.MAX_BANANAS, Math.floor(requestedBananas))
    : 1000;
  const requestedTestBananas = Number(params.get("b"));
  const TEST_BANANAS = DEBUG && params.has("b") && Number.isFinite(requestedTestBananas) && requestedTestBananas >= 0
    ? Math.min(pileMod.MAX_BANANAS, Math.floor(requestedTestBananas))
    : 100;
  const FADE = 0.25;
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  // Choose before renderer creation so a memory-limited device never allocates high-tier targets.
  // The signal is approximate and optional; absent or invalid values leave the boot-time probe in charge.
  const DEVICE_MEMORY = navigator.deviceMemory;
  const MEMORY_LIMITED = Number.isFinite(DEVICE_MEMORY) && DEVICE_MEMORY > 0 && DEVICE_MEMORY <= 8;
  const INITIAL_QUALITY = COARSE || MEMORY_LIMITED ? "medium" : "high";
  const $ = (id) => document.getElementById(id);
  const mark = (name) => performance.mark(`ooga:${name}`);
  mark("boot");
  let sceneCanvas = $("scene");
  const overlayCanvas = $("overlay");
  const overlayCtx = overlayCanvas.getContext("2d");
  const qualityLabel = $("quality");
  const curtain = $("curtain");
  const worldBlock = $("world-block"), worldBlockHeight = $("world-block-height");
  const SAYINGS = [
    "growing the island…", "counting the bananas…", "waking the Oogas…", "polishing the rocks…", "herding the clouds…",
    "lighting the torches…", "packing the leaf chutes…", "lashing sticks into a rocket…", "filling barrels with banana mash…",
    "warming up the Fire Pot…", "sweeping the rope bridge…", "feeding the fireflies…", "teaching cavemen to drive…",
    "hiding the jetpack…", "tightening the Vine Knots…", "fluffing the leaf beds…"
  ];
  $("curtain-saying").textContent = SAYINGS[Math.floor(Math.random() * SAYINGS.length)];
  const worldClock = $("world-clock");
  let renderer = null;
  if (!params.has("canvas2d")) {
    try {
      renderer = glRenderer.createRenderer(sceneCanvas, { quality: INITIAL_QUALITY });
    } catch (err) {
      console.warn("WebGL2 renderer failed, using Canvas 2D fallback", err);
      // A canvas that has held a WebGL context can never return a 2D one: replace the element.
      const fresh = sceneCanvas.cloneNode(false);
      sceneCanvas.replaceWith(fresh);
      sceneCanvas = fresh;
    }
  }
  if (!renderer) renderer = canvasRenderer.createRenderer(sceneCanvas);
  mark("renderer");
  const showQuality = () => {
    qualityLabel.textContent = `${renderer.kind} · ${renderer.quality}`;
  };
  showQuality();
  const game = gameMod.create({ catalog: models.SWAG });
  // world survives scene swaps: banana level, equipment ownership, and the Ooga handed from hub to scene.
  const world = { level: START_BANANAS, pilot: null, mirrorBroken: false };
  const debugMagazines = DEBUG ? (params.get("mag") === "2" ? 2 : params.get("mag") === "1" ? 1 : 0) : 0;
  world.magazine = { owned: debugMagazines > 0, count: debugMagazines, ammo: debugMagazines ? 30 : 0, carrier: null };

  let active = null;
  let sceneTime = 0;
  let transition = null;
  let fade = 0;
  const positionDebug = $("position-debug"), POSITION_DEBUG = DEBUG && params.get("pos") !== "0";
  let positionDebugNext = 0, positionDebugState = "";
  const positionText = p => `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
  const updatePositionDebug = force => {
    if (!POSITION_DEBUG || !active || active.id === "hub" || !active.camera) return;
    const debug = active.debug, actor = debug?.pilot?.player || debug?.crew?.player;
    const actorPosition = actor?.root?.position;
    const room = debug?.dsb?.interiors?.active?.room?.id;
    const camera = active.camera;
    const state = `${active.id}${room ? ` · ${room}` : ""}${actor?.traits?.name ? ` · ${actor.traits.name}` : ""}`
      + (actorPosition ? `\npos=${positionText(actorPosition)}` : "")
      + `\ncamera=${positionText(camera.position)}\nlook=${positionText(camera.target)}`;
    if (!force && state === positionDebugState) return;
    positionDebugState = state;
    positionDebug.dataset.copied = "false";
    positionDebug.textContent = `${state}\nclick to copy debug snapshot`;
  };
  const copyPositionDebug = () => {
    updatePositionDebug(true);
    const url = new URL(location.href);
    url.searchParams.set("debug", "1");
    const value = `${positionDebugState}\nurl=${url.href}`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).catch(() => {});
    else {
      const field = document.createElement("textarea");
      field.value = value;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    positionDebug.dataset.copied = "true";
    positionDebug.blur();
  };
  const CLOCK_NS = "http://www.w3.org/2000/svg";
  const clockSvg = document.createElementNS(CLOCK_NS, "svg");
  const clockPath = document.createElementNS(CLOCK_NS, "path");
  const clockTime = DEBUG ? window.BL.daylight.parseTime(params.get("time")) : NaN;
  const clockDaylen = DEBUG ? Number(params.get("daylen")) : NaN;
  const clockStartDate = new Date();
  const clockZoneFormat = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" });
  const requestedClockHour = DEBUG && params.has("hour") ? Number(params.get("hour")) : NaN;
  const clockBaseHour = Number.isFinite(requestedClockHour) ? requestedClockHour : clockStartDate.getHours() + clockStartDate.getMinutes() / 60 + clockStartDate.getSeconds() / 3600;
  let clockNextUpdate = 0, clockMinute = -1;
  const CLOCK_DATE = new Date();
  clockSvg.setAttribute("viewBox", "0 0 30 6");
  clockSvg.setAttribute("class", "sign");
  clockSvg.setAttribute("role", "img");
  clockPath.setAttribute("fill", "currentColor");
  clockSvg.append(clockPath);
  worldClock.replaceChildren(clockSvg);
  const updateWorldClock = (now) => {
    if (now < clockNextUpdate) return;
    clockNextUpdate = now + 100;
    let hours, minutes;
    if (Number.isFinite(clockTime)) {
      const total = Math.round(clockTime * 60);
      hours = Math.floor(total / 60);
      minutes = total % 60;
    } else if (clockDaylen > 0) {
      const sceneDaylight = active && active.debug && active.debug.daylight;
      const relative = sceneDaylight && Number.isFinite(sceneDaylight.hour) ? sceneDaylight.hour : clockBaseHour + elapsed * 24 / clockDaylen;
      const total = Math.floor(((relative % 24 + 24) % 24) * 60) % 1440;
      hours = Math.floor(total / 60);
      minutes = total % 60;
    } else {
      CLOCK_DATE.setTime(Date.now());
      hours = CLOCK_DATE.getHours();
      minutes = CLOCK_DATE.getMinutes();
    }
    const minute = hours * 60 + minutes;
    if (minute === clockMinute) return;
    clockMinute = minute;
    const twelve = hours % 12 || 12;
    const zone = (clockZoneFormat.formatToParts(CLOCK_DATE).find(part => part.type === "timeZoneName")?.value || "UTC").toUpperCase().replaceAll("−", "-");
    const text = `${twelve}:${Math.floor(minutes / 10)}${minutes % 10} ${hours < 12 ? "AM" : "PM"} ${zone}`;
    let d = "", cursor = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " ") {
        cursor += 2;
        continue;
      }
      const glyph = window.BL.hubModels.SIGN_GLYPHS[ch];
      if (!glyph) throw new Error(`No clock glyph for "${ch}"`);
      for (let row = 0; row < glyph.length; row++) for (let col = 0; col < glyph[row].length; col++) if (glyph[row][col] === "1") d += `M${cursor + col} ${row}h.82v.82h-.82z`;
      cursor += 4;
    }
    const cells = cursor - 1;
    clockSvg.setAttribute("viewBox", `0 0 ${cells} 6`);
    worldClock.style.width = `${cells / 6}em`;
    clockPath.setAttribute("d", d);
    worldClock.dateTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    clockSvg.setAttribute("aria-label", `${Number.isFinite(clockTime) || clockDaylen > 0 ? "Ooga Booga time" : "Local time"} ${text}`);
  };
  const go = (id, place = null, instant = false) => {
    const next = scenes[id];
    if (!next) throw new Error(`Unknown scene "${id}"`);
    if (transition) return false;
    transition = { next, place, out: true, t: 0, instant };
    return true;
  };
  const router = routerMod.create(scenes, window.BL.routes, go);
  // The logo is the site's home link: from any scene it goes back to the island, as a website's logo goes home.
  document.querySelector(".home-link").addEventListener("click", (e) => {
    e.preventDefault();
    e.currentTarget.blur();
    if (active && active.id !== "hub") go("hub");
  });
  const agentPlay = BL.agent.createPlay();
  const ctx = { renderer, canvas: sceneCanvas, overlay: overlayCanvas, game, world, go, lootEnabled: LOOT_ENABLED, testBananas: TEST_BANANAS, agentPlay, from: null, place: null };
  const sceneSections = [...document.querySelectorAll("[data-scene]")];
  // The title cards of the games that have no phase of their own for one: shown on every arrival,
  // closed by their button, Enter, Space or Escape, and nothing else reaches the scene while one shows.
  const intros = [...document.querySelectorAll("[data-intro]")];
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse) for (const n of document.querySelectorAll("[data-intro] [data-coarse]")) n.textContent = n.dataset.coarse;
  const openIntro = () => intros.find((el) => !el.hidden) || null;
  const enter = (next, place = null) => {
    ctx.from = active ? active.id : null;
    ctx.place = place;
    positionDebug.removeEventListener("click", copyPositionDebug);
    for (const el of sceneSections) el.hidden = el.classList.contains("hub-presets") || el.dataset.scene !== next.id;
    for (const el of intros) el.hidden = el.dataset.intro !== next.id;
    // The page styles by scene too: the games hide the island's sheet, see style.css.
    document.body.dataset.activeScene = next.id;
    window.BL.net.setBody(null);
    window.BL.net.setZone(next.id === "hub" ? "outside" : next.id === "dsb" ? "dsb-outside" : `scene-${next.id}`);
    next.enter(ctx);
    active = next;
    sceneTime = 0;
    router.arrive(next.id, place, ctx.from === null);
    if (POSITION_DEBUG && next.id !== "hub") {
      positionDebug.hidden = false;
      positionDebug.setAttribute("aria-label", "Debug scene, character and camera state. Click to copy a debug snapshot.");
      positionDebugState = "";
      positionDebugNext = 0;
      positionDebug.addEventListener("click", copyPositionDebug);
      updatePositionDebug(true);
    }
  };
  const live = new Set();
  const visit = (node) => {
    if (node.geometry) live.add(node.geometry);
    for (const child of node.children) visit(child);
  };
  const liveGeometry = () => {
    live.clear();
    visit(active.root);
    active.liveGeometry(live);
    return live;
  };
  // The page's first AudioContext wakes the browser's audio, about 60 ms on the main thread; every later one costs well
  // under a millisecond, closed or not. Paid once here, behind the fade, so a scene's first sound never stalls a frame;
  // only after a gesture, as the scenes' own sound waits for one.
  let audioAwake = false;
  const wakeAudio = () => {
    if (audioAwake || typeof AudioContext === "undefined" || navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    audioAwake = true;
    new AudioContext().close().catch(() => {});
  };
  const swap = (next, place) => {
    const leaving = active;
    wakeAudio();
    agentPlay.stop(true);
    const left = leaving.leave();
    if (DEBUG && leaving.root.children.length) throw new Error(`${leaving.id}.leave left ${leaving.root.children.length} nodes in its root`);
    if (DEBUG && left.targets) throw new Error(`${leaving.id}.leave left ${left.targets} input targets`);
    clearTweens();
    if (DEBUG && tweenCount()) throw new Error(`${tweenCount()} tweens survived clearTweens`);
    enter(next, place);
    renderer.releaseUnused(liveGeometry());
    if (DEBUG && renderer.stats.records > live.size) throw new Error(`${next.id}: ${renderer.stats.records} GPU records for ${live.size} live geometries`);
  };
  const stepTransition = (dt) => {
    if (transition.instant) {
      const { next, place } = transition;
      swap(next, place);
      transition = null;
      fade = 0;
      return;
    }
    transition.t += dt;
    if (transition.out) {
      fade = Math.min(1, transition.t / FADE);
      if (fade < 1) return;
      swap(transition.next, transition.place);
      transition.out = false;
      transition.t = 0;
      return;
    }
    fade = 1 - Math.min(1, transition.t / FADE);
    if (fade === 0) transition = null;
  };
  // Fills in CSS pixels (clientWidth/clientHeight), not backing-store pixels.
  const drawFade = () => {
    overlayCtx.globalAlpha = fade;
    overlayCtx.fillStyle = "#000000";
    overlayCtx.fillRect(0, 0, overlayCanvas.clientWidth, overlayCanvas.clientHeight);
    overlayCtx.globalAlpha = 1;
  };

  // Sampled from delivered frame intervals, never from the cost of issuing a frame.
  // GL calls return long before the GPU draws, so a GPU-bound machine reports cheap frames and never steps down.
  const perf = { frames: 0, total: 0, since: 0, bad: 0 };
  const QUALITY_ORDER = ["high", "medium", "low"];
  // Window ends on frames or ms, whichever comes first: at 8 fps that steps down in about a second.
  const TIER_FRAMES = 45, TIER_MS = 900, TIER_INTERVAL = 19, TIER_WARMUP = 12;
  const autoTier = (intervalMs, now) => {
    if (renderer.kind !== "webgl2" || renderedFrames <= TIER_WARMUP) return;
    const idx = QUALITY_ORDER.indexOf(renderer.quality);
    // Stepping is one-way and stops at the bottom tier, so quality cannot oscillate.
    if (idx < 0 || idx >= QUALITY_ORDER.length - 1) return;
    // An unfocused tab and a transition building the next scene are not evidence that the tier is too expensive.
    if (!document.hasFocus() || transition) { perf.frames = perf.total = 0; perf.since = 0; return; }
    if (!perf.since) perf.since = now;
    perf.frames++;
    perf.total += intervalMs;
    if (perf.frames < TIER_FRAMES && now - perf.since < TIER_MS) return;
    const avg = perf.total / perf.frames;
    perf.frames = 0;
    perf.total = 0;
    perf.since = now;
    // Two bad windows required: one slow window can be another program, and a step down lasts the session.
    // A genuinely slow machine still drops a tier inside two seconds.
    if (avg <= TIER_INTERVAL) { perf.bad = 0; return; }
    if (++perf.bad < 2) return;
    perf.bad = 0;
    renderer.setQuality(QUALITY_ORDER[idx + 1]);
    showQuality();
  };
  // Boot time is a device probe no browser can refuse: Safari masks GPU strings, where thresholds matter most.
  // BOOT_MEDIUM / BOOT_LOW measure building the first scene. Recalibrated 2026-09-24 against the hub as it now
  // is: an M4 Max builds it in about 2.35 s, so the old 2200 started every machine at medium. The same ratio to
  // that fast build is kept, and the frame-interval auto-tier still steps a slow device down while it plays.
  const BOOT_MEDIUM = 3600, BOOT_LOW = 5400;
  const tierFromBoot = (ms) => {
    if (renderer.kind !== "webgl2") return;
    const wanted = ms > BOOT_LOW ? "low" : ms > BOOT_MEDIUM || MEMORY_LIMITED ? "medium" : null;
    if (!wanted || QUALITY_ORDER.indexOf(wanted) <= QUALITY_ORDER.indexOf(renderer.quality)) return;
    renderer.setQuality(wanted);
    showQuality();
  };

  // Full rate while focused; 30 fps only when another window is in front.
  const WARMUP = 8;
  const UNFOCUSED_INTERVAL = 1000 / 30;
  let lastRender = 0;
  let renderedFrames = 0;
  let firstDraw = false;
  const openCurtain = () => {
    curtain.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform") curtain.remove();
    });
    curtain.dataset.open = "true";
  };
  const frameInterval = () => (elapsed > WARMUP && !document.hasFocus() && !active.inMotion ? UNFOCUSED_INTERVAL : 0);

  const housekeep = () => { if (active) renderer.releaseUnused(liveGeometry()); };

  let elapsed = 0;
  let lastTime = performance.now();
  let raf = 0;
  // Shared by the display loop and the debug `advance`, so a stepped frame is exactly a displayed one.
  const step = (dt, now) => {
    elapsed += dt;
    if (transition) stepTransition(dt);
    sceneTime += dt;
    active.update(dt, sceneTime);
    if (POSITION_DEBUG && active.id !== "hub" && elapsed >= positionDebugNext) {
      positionDebugNext = elapsed + 0.1;
      updatePositionDebug(false);
    }
    agentPlay.update(dt);
    updateWorldClock(now);
    const drawn = renderer.render(active.root, active.camera, active.renderOpts);
    if (drawn && !firstDraw) {
      firstDraw = true;
      mark("drawn");
      openCurtain();
    }
    if (!drawn && renderer.failure && !params.has("canvas2d")) {
      console.warn("WebGL2 programs failed, reloading with the Canvas 2D fallback", renderer.failure);
      params.set("canvas2d", "1");
      location.replace(`${location.pathname}?${params}`);
      return;
    }
    active.input.update();
    active.overlay(dt);
    if (fade > 0) drawFade();
  };
  const frame = (now) => {
    raf = window.requestAnimationFrame(frame);
    const interval = frameInterval();
    if (interval && now - lastRender < interval - 1) return;
    const delivered = now - lastRender;
    lastRender = now;
    renderedFrames++;
    if (renderedFrames <= 3) mark(`frame${renderedFrames}`);
    // A frame's timestamp is when it began, which can come before the `performance.now()` that the debug
    // `advance` just wrote into lastTime: a negative step would run the scene backwards.
    const dt = Math.max(0, Math.min(0.1, (now - lastTime) / 1e3));
    lastTime = now;
    // Only a displayed frame carries a real interval; `advance` must not tier. A step resizes the canvas, which
    // clears it, so it comes before this frame's draw: after it, the browser presented one black frame.
    if (!interval) autoTier(delivered, now);
    step(dt, now);
  };

  let rightShift = false;
  const clearRightShift = (e) => {
    if (e.type === "blur" || e.key === "Shift" && (e.code === "ShiftRight" || e.location === 2)) rightShift = false;
  };
  const onKeyDown = (e) => {
    if (!active) return;
    if (e.key === "Shift" && (e.code === "ShiftRight" || e.location === 2)) rightShift = true;
    if (e.repeat) return;
    const typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
    if (typing || (e.target && e.target.closest && e.target.closest("dialog, #sheet"))) return;
    const intro = openIntro();
    if (intro) {
      // Registered at boot, before any scene's controls, so this keeps the key from them too.
      e.stopImmediatePropagation();
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        intro.hidden = true;
      }
      return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiAt = key === KONAMI[konamiAt] ? konamiAt + 1 : key === KONAMI[0] ? 1 : 0;
    if (konamiAt === KONAMI.length) {
      konamiAt = 0;
      feedPanel.toggle();
    }
    if (LOOT_ENABLED && e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      game.clearLoot();
      active.onLootCleared();
      return;
    }
    // Game scenes can expose a dedicated Agent. Hub companions are selected
    // directly; Right Shift+A never creates another gorilla there. Left Shift+A runs left.
    if ((active.agent || active.summonAgent) && e.shiftKey && rightShift
      && !e.metaKey && !e.ctrlKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      if (transition) return;
      if (agentPlay.active) agentPlay.stop();
      else agentPlay.start(active);
      return;
    }
    if (e.shiftKey && rightShift
      && !e.metaKey && !e.ctrlKey && (e.key === "R" || e.key === "r")) {
      e.preventDefault();
      game.resetAll();
      location.reload();
      return;
    }
    active.onKey(e);
  };
  const onVisibility = () => {
    // A hidden tab holds no sockets; the chain's REST polls already skip themselves while hidden.
    mempool.setHidden(document.hidden);
    chain.setHidden(document.hidden);
    if (document.hidden) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && active) {
      lastTime = performance.now();
      raf = window.requestAnimationFrame(frame);
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", clearRightShift);
  window.addEventListener("blur", clearRightShift);
  document.addEventListener("visibilitychange", onVisibility);
  if (params.has("nosim")) donations.config.simulate = false;
  // The live feeds stay off under nosim (the suite) and mempool=0 / oogatron=0 / chain=0;
  // checks drive the hub's weather through emit and apply, and the jumbotron through refreshData.
  const mempool = window.BL.mempool;
  const chain = window.BL.chain;
  let shownBlockHeight = -1;
  const showBlockHeight = (snapshot) => {
    const height = Number.isInteger(snapshot.height) && snapshot.height > 0 ? snapshot.height : 0;
    if (height === shownBlockHeight) return;
    shownBlockHeight = height;
    worldBlockHeight.textContent = height ? height.toLocaleString("en-US") : "\u2014";
    worldBlock.setAttribute("aria-label", height ? `Bitcoin block height ${height}` : "Bitcoin block height unavailable");
  };
  const unsubscribeBlockHeight = chain.subscribe(showBlockHeight);
  const unsubscribeBlockFeed = mempool.subscribe((event) => {
    if (event.type === "block") showBlockHeight(event);
  });
  showBlockHeight(chain.snapshot);
  if (!params.has("nosim") && params.get("mempool") !== "0") mempool.start();
  if (!params.has("nosim") && params.get("oogatron") !== "0") window.BL.oogatronLive.start();
  // `?chain=esplora` or `?chain=https://host/api` pins the provider; otherwise mempool.space leads
  // and three consecutive failures hand the session to Esplora on its own.
  if (!params.has("nosim") && params.get("chain") !== "0") chain.start({ source: params.get("chain") });
  // The account needs the Worker: without one /api/me finds nothing and the sheet shows no sign-in.
  const net = window.BL.net;
  const unsubscribeAccount = net.subscribe(window.BL.hud.showAccount);
  const unsubscribeVoice = window.BL.voice.subscribe(() => window.BL.hud.showAccount(net.state));
  const accountReady = !params.has("nosim") && params.get("net") !== "0" ? net.start() : Promise.resolve();
  // A tab opened in the background waits for its first look before it holds any socket.
  if (document.hidden) {
    mempool.setHidden(true);
    chain.setHidden(true);
  }
  const unsubscribeDonations = donations.subscribe((donation) => { if (active) active.onDonation(donation); }, { identity: () => game.state });
  // The feed panel: the Konami code toggles a page-wide readout of the socket, its counters and its last events.
  // It subscribes and ticks only while open, and its text nodes change only with their value.
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  const FEED_LOG = 24, FEED_TICK = 250;
  let konamiAt = 0;
  const feedPanel = (() => {
    const el = document.getElementById("feed-debug"), stateEl = document.getElementById("feed-debug-state"), logEl = document.getElementById("feed-debug-log");
    const log = new Array(FEED_LOG).fill("");
    let logNext = 0, logCount = 0, timer = 0, unsubscribe = null, dirty = false;
    const stamp = () => new Date().toTimeString().slice(0, 8);
    const push = (line) => {
      log[logNext] = `${stamp()}  ${line}`;
      logNext = (logNext + 1) % FEED_LOG;
      if (logCount < FEED_LOG) logCount++;
      dirty = true;
    };
    const describe = (e) => e.type === "stats" ? `stats  ${e.count} tx · ${e.vsize} vB · inflow ${e.inflow} vB/s`
      : e.type === "block" ? `block  ${e.height} · ${e.txCount} tx`
      : e.type === "fees" ? `fees   next block ${e.nextFee.toFixed(2)} sat/vB · ${e.blocks} projected`
      : `${e.type}`;
    const render = () => {
      // The rally exposes a `weather` of its own with no `state`; only the hub's answers this panel.
      const d = active && active.debug && active.debug.weather, w = d && d.state ? d : null, s = mempool.state, c = chain.snapshot;
      const link = !s.enabled ? "off (nosim or mempool=0)" : s.connected ? `connected · attempt ${s.attempts}` : `reconnecting · attempt ${s.attempts}`;
      const age = s.lastAt ? `${((Date.now() - s.lastAt) / 1000).toFixed(1)} s ago` : "none yet";
      const text = `socket    ${link}\nlast msg  ${age}${s.lastKeys ? ` · ${s.lastKeys}` : ""}\nmessages  ${s.messages} · ${(s.bytes / 1024).toFixed(0)} KB\nchain     height ${s.height} · next block ${s.nextFee.toFixed(2)} sat/vB · ${s.projectedBlocks} projected\nevents    ${s.stats} stats · ${s.blocks} blocks · inflow ${s.inflow} vB/s\npool      ${c.count} tx · ${c.deep.toFixed(1)} blocks deep · paying ${c.paying.toFixed(2)} MvB (avg ${c.payEma.toFixed(2)}) · floor ${c.floor.toFixed(2)} sat/vB · via ${c.source}${c.degraded ? " (fallback)" : ""}\nprice     ${c.priceUsd ? c.priceUsd.toFixed(2) : "-"} · via ${c.priceSource || "-"}\naxes      arriving ${c.gale.toFixed(2)} (weather) · paying ${c.soak.toFixed(2)} (data) · pace ${(c.pace / 60).toFixed(1)} min\nweather   ${w ? `${w.state.name} · arrivals ${w.state.arrivals} · storm ${w.state.storm.toFixed(2)} · ${w.state.drops}/${w.state.capacity} drops · wind ${w.state.wind.toFixed(1)} · cloud ${w.state.cloud.toFixed(2)} · ${w.state.strikes} strikes` : "no weather in this scene"}`;
      if (stateEl.textContent !== text) stateEl.textContent = text;
      if (!dirty) return;
      dirty = false;
      let lines = "";
      for (let i = 0; i < logCount; i++) lines += `${log[(logNext - logCount + i + FEED_LOG) % FEED_LOG]}\n`;
      logEl.textContent = lines || "no events yet";
    };
    const open = () => {
      el.hidden = false;
      dirty = true;
      render();
      unsubscribe = mempool.subscribe((e) => push(describe(e)));
      timer = window.setInterval(render, FEED_TICK);
    };
    const close = () => {
      el.hidden = true;
      window.clearInterval(timer);
      timer = 0;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    };
    const toggle = () => (el.hidden ? open() : close());
    document.getElementById("feed-debug-close").addEventListener("click", close);
    return { toggle, close, get open() { return !el.hidden; }, get logged() { return logCount; } };
  })();
  const housekeepTimer = window.setInterval(housekeep, 6e4);
  // EntropyLab currently lives in its island cave; retain the isolated scene for debug checks only.
  const routed = router.current();
  const requestedScene = (routed && routed.scene) || params.get("scene") || (WIP !== "1" ? WIP : null);
  const sceneId = requestedScene === "lab" && !DEBUG ? null : requestedScene;
  // Building the first scene holds the main thread with nothing painted yet.
  // Run boot from a task after the first frame so the leaf curtain is on screen, not the previous page.
  let destroyed = false;
  const boot = async () => {
    // A signed-in newcomer must join before crew construction, including direct routes.
    // net.start is bounded; an unavailable backend leaves the static island usable.
    await accountReady;
    if (destroyed) return;
    const built = performance.now();
    enter(Object.hasOwn(scenes, sceneId) ? scenes[sceneId] : scenes[Object.keys(scenes)[0]], routed && routed.place);
    mark("ready");
    tierFromBoot(performance.now() - built);
    raf = window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(() => window.setTimeout(boot, 0));
  if (DEBUG) {
    const ooga = {
      game,
      renderer,
      startLevel: START_BANANAS,
      lootEnabled: LOOT_ENABLED,
      testBananas: TEST_BANANAS,
      project: renderer.project,
      housekeep,
      go,
      mempool,
      feedPanel,
      // Whole frames at a fixed step without waiting on the display: a check runs seconds of play in little wall time.
      advance: (seconds, dt = 1 / 60) => {
        for (let n = Math.round(seconds / dt); n > 0; n--) {
          renderedFrames++;
          step(dt, performance.now());
        }
        lastTime = performance.now();
      },
      get scene() {
        return active.id;
      },
      get transitioning() {
        return transition !== null;
      },
      get input() {
        return active.input;
      },
      get renderedFrames() {
        return renderedFrames;
      },
      get frameInterval() {
        return frameInterval();
      },
      get mirror() {
        return renderer.mirror;
      },
      get timing() {
        return Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("ooga:")).map((m) => [m.name.slice(5), Math.round(m.startTime)]));
      },
      stats: () => ({ ...active.stats(), gl: renderer.stats || null, dom: document.getElementsByTagName("*").length }),
      get level() {
        return world.level;
      }
    };
    for (const key of ["slots", "drops", "core", "shell", "delivery", "spillEffect", "cavemen", "crates", "lab", "headquarters", "hud", "applyAllSwag", "renderLocker", "demoTip", "setPileLevel", "refreshStates", "trimPool", "shown", "island", "mouths", "labels", "camera", "cameraCave", "crew", "fx", "controls", "props", "altar", "path", "scenery", "jetpack", "magazine", "mirrorCave", "matrixCave", "matrixGate", "pilot", "renderOpts", "lamps", "entranceLights", "lighting", "fireSeats", "critters", "storm", "daylight", "setHour", "track", "racers", "items", "race", "audio", "weather", "drop", "diver", "plane", "course", "jumbotron", "fireworks", "fireworksPending", "orbit", "flight", "site", "agent", "poolIsland", "mine", "dsb", "clankers", "clankerPlay", "factory", "bifrost", "arcade", "carnival", "npcSync", "cloudFloorAt"]) {
      Object.defineProperty(ooga, key, { get: () => active.debug && active.debug[key], enumerable: true });
    }
    window.__ooga = ooga;
  }
  const destroy = () => {
    destroyed = true;
    window.cancelAnimationFrame(raf);
    window.clearInterval(housekeepTimer);
    unsubscribeDonations();
    unsubscribeBlockFeed();
    unsubscribeBlockHeight();
    feedPanel.close();
    router.dispose();
    mempool.dispose();
    chain.dispose();
    window.BL.oogatronLive.dispose();
    unsubscribeAccount();
    unsubscribeVoice();
    window.BL.voice.dispose();
    net.dispose();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", clearRightShift);
    window.removeEventListener("blur", clearRightShift);
    document.removeEventListener("visibilitychange", onVisibility);
    positionDebug.removeEventListener("click", copyPositionDebug);
    if (active) active.leave();
    renderer.dispose();
  };
  window.addEventListener("pagehide", (e) => {
    if (!e.persisted) destroy();
  });
})();
