(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { canvasRenderer } = BL;
  const { formatLarge } = BL.game;
  const { createNode, addChild, createCamera, boundsOf } = BL.scene;
  const STATE_LABELS = { working: "clank", chilling: "chill", sleeping: "sleep", away: "away", online: "online" };
  const ROSTER_ORDER = { working: 0, chilling: 1, sleeping: 2, away: 3 };
  // Tooltip dots retain their human-presence color without changing NPC activity.
  const statusFor = (cave) => {
    const actor = cave.tooltipOwner || cave;
    return actor.humanControlled ? "online" : actor.state === "away" ? "chilling" : actor.state;
  };
  const $ = (id) => document.getElementById(id);
  const TIER_RANK = { legendary: 0, epic: 1, rare: 2, common: 3 };
  const BANANA_COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const MESSAGE_FADE_MS = 300;
  const SHEET_STATE_KEY = "oogaboogaland.sheet.v1";
  const BOARD_STATE_KEY = "oogaboogaland.oogatron.windows.v1";
  const MAX_FLOATING_BOARDS = 12;
  const readBoardState = () => {
    try {
      const state = JSON.parse(localStorage.getItem(BOARD_STATE_KEY));
      if (!state || state.version !== 1 || !Array.isArray(state.windows)) return null;
      const windows = [];
      for (const entry of state.windows.slice(0, MAX_FLOATING_BOARDS)) {
        if (!entry || !Number.isFinite(entry.x) || entry.x < 0 || !Number.isFinite(entry.y) || entry.y < 0
          || !Number.isFinite(entry.width) || entry.width <= 0 || typeof entry.paused !== "boolean") continue;
        const screen = entry.screen;
        if (!screen || !["recent", "totals", "repo", "leaderboard"].includes(screen.name)) continue;
        const params = {};
        let valid = true;
        for (const key of ["name", "repo", "type"]) {
          const value = screen.params?.[key];
          if (value === undefined) continue;
          if (typeof value !== "string" || value.length > 256) { valid = false; break; }
          params[key] = value;
        }
        if (!valid || screen.name === "repo" && !params.name
          || screen.name === "leaderboard" && !["commits", "prs", "reviews", "issues", "comments"].includes(params.type)) continue;
        const filters = {};
        for (const kind of ["repos", "users", "types"]) {
          const values = entry.filters?.[kind];
          filters[kind] = Array.isArray(values) ? [...new Set(values.slice(0, kind === "types" ? 6 : 512)
            .filter((value) => typeof value === "string" && value.length <= 256
              && (kind !== "types" || ["commit", "pr", "review", "merge", "issue", "comment"].includes(value))))] : null;
        }
        windows.push({ x: entry.x, y: entry.y, width: entry.width, paused: entry.paused, screen: { name: screen.name, params }, filters, rollup: entry.rollup === true });
      }
      return { windows, lastUsed: Number.isInteger(state.lastUsed) ? state.lastUsed : -1,
        lastWidth: Number.isFinite(state.lastWidth) && state.lastWidth > 0 ? state.lastWidth : 440 };
    } catch { return null; }
  };
  const readSheetState = () => {
    try {
      const state = JSON.parse(localStorage.getItem(SHEET_STATE_KEY));
      return state && typeof state.open === "boolean" && ["bananas", "roster", "loot"].includes(state.tab) ? state : null;
    } catch { return null; }
  };
  const writeSheetState = (open, tab) => {
    try { localStorage.setItem(SHEET_STATE_KEY, JSON.stringify({ open, tab })); } catch { /* Storage may be unavailable. */ }
  };
  // Sign headings: one pixel path per element, scaled by that element's CSS height.
  const SIGN_NS = "http://www.w3.org/2000/svg";
  // Collapse whitespace: markup may wrap a sign across lines but the lettering needs one run of words.
  const signText = (raw) => raw.replace(/\s+/g, " ").trim();
  const signLettering = (raw) => {
    const { SIGN_GLYPHS } = BL.hubModels;
    const text = signText(raw);
    let cells = -1;
    for (const ch of text) cells += ch === " " ? 2 : 4;
    const svg = document.createElementNS(SIGN_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${cells} 6`);
    svg.setAttribute("class", "sign");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SIGN_NS, "path");
    let d = "", cursor = 0;
    for (const ch of text) {
      if (ch === " ") {
        cursor += 2;
        continue;
      }
      const glyph = SIGN_GLYPHS[ch];
      if (!glyph) throw new Error(`No cave-sign glyph for "${ch}"`);
      for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] === "1") d += `M${cursor + col} ${row}h.82v.82h-.82z`;
        }
      }
      cursor += 4;
    }
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  };
  // Letters a sign; a scene calls it again when a sign's words change (a drop that was lost, not landed).
  const letterSign = (el, words = el.textContent) => {
    const text = signText(words);
    el.setAttribute("aria-label", text);
    el.replaceChildren(signLettering(text));
  };
  for (const el of document.querySelectorAll("[data-sign]")) letterSign(el);
  // Icons are rasterized once into an offscreen canvas.
  const ICON_PX = 48;
  const renderIcon = (item) => {
    const canvas = document.createElement("canvas");
    const iconRenderer = canvasRenderer.createRenderer(canvas, { width: ICON_PX, height: ICON_PX, transparent: true });
    const iconRoot = createNode();
    const node = item.buildNode();
    const bounds = boundsOf(node.geometry);
    const fit = 0.62 / Math.max(bounds.radius, 0.05);
    Object.assign(node.scale, { x: fit, y: fit, z: fit });
    Object.assign(node.position, { x: -bounds.center[0] * fit, y: -bounds.center[1] * fit, z: -bounds.center[2] * fit });
    if (item.rotation) Object.assign(node.rotation, item.rotation);
    addChild(iconRoot, node);
    const iconCamera = createCamera({ fov: 32, near: 0.1, far: 20 });
    Object.assign(iconCamera.position, { x: 1.6, y: 1.4, z: 2.4 });
    Object.assign(iconCamera.target, { x: 0, y: 0, z: 0 });
    iconRenderer.render(iconRoot, iconCamera);
    iconRenderer.dispose();
    return canvas;
  };
  // Draw the carried item's actual geometry, including likenesses and skins.
  // This owns only temporary icon nodes; the character's item is never reparented.
  const renderPrimaryIcon = (canvas, geometry, tall = false) => {
    const renderer = canvasRenderer.createRenderer(canvas, { width: ICON_PX, height: ICON_PX, transparent: true });
    const root = createNode(), pivot = createNode(), item = createNode({ geometry });
    const bounds = boundsOf(geometry), fit = (tall ? 0.52 : 0.67) / Math.max(bounds.radius, 0.05);
    item.scale.x = item.scale.y = item.scale.z = fit;
    item.position.x = -bounds.center[0] * fit;
    item.position.y = -bounds.center[1] * fit;
    item.position.z = -bounds.center[2] * fit;
    pivot.rotation.z = 0.55;
    addChild(root, pivot); addChild(pivot, item);
    const camera = createCamera({ fov: 32, near: 0.1, far: 20 });
    camera.position.x = 0.8; camera.position.y = 0.45; camera.position.z = 2.7;
    camera.target.x = camera.target.y = camera.target.z = 0;
    renderer.render(root, camera);
    renderer.dispose();
  };
  const copyPortraitNode = (source, portraitRoot, portraitGeometry) => {
    if (source.portraitHidden) return null;
    const copy = createNode({ geometry: source === portraitRoot ? portraitGeometry : source.geometry });
    Object.assign(copy.position, source.position);
    Object.assign(copy.rotation, source.rotation);
    Object.assign(copy.scale, source.scale);
    copy.visible = source.visible;
    for (const child of source.children) if (child.visible && !child.portraitHidden) addChild(copy, copyPortraitNode(child, portraitRoot, portraitGeometry));
    return copy;
  };
  const renderFaceIcon = (canvas, cave, gorilla = null) => {
    const renderer = canvasRenderer.createRenderer(canvas, { width: ICON_PX, height: ICON_PX, transparent: true });
    const source = gorilla ? gorilla.parts.head : cave.parts.head, geometry = gorilla ? source.geometry : cave.portraitHead;
    const root = createNode(), head = copyPortraitNode(source, source, geometry);
    const bounds = boundsOf(geometry), fit = (!gorilla && cave.traits.gasMask ? 0.68 : 0.78) / Math.max(bounds.radius, 0.05);
    head.position.x = head.position.y = head.position.z = 0;
    head.rotation.x = head.rotation.y = head.rotation.z = 0;
    head.scale.x = head.scale.y = head.scale.z = fit;
    head.position.x = -bounds.center[0] * fit;
    head.position.y = -bounds.center[1] * fit;
    head.position.z = -bounds.center[2] * fit;
    addChild(root, head);
    const camera = createCamera({ fov: 28, near: 0.1, far: 20 });
    // Caveman faces are built on +Z. Keep the portrait square to that plane so
    // the mode button reads as a face instead of another angled item icon.
    camera.position.x = camera.position.y = 0;
    camera.position.z = 2.7;
    camera.target.x = camera.target.y = camera.target.z = 0;
    renderer.render(root, camera);
    renderer.dispose();
  };
  const create = ({ roster, catalog, tierColors, renderIcon, lootEnabled = false }) => {
    const el = {
      meterFill: $("meter-fill"),
      meterCount: $("meter-count"),
      meterForecast: $("meter-forecast"),
      roster: $("roster"),
      statDonations: $("stat-donations"),
      statSats: $("stat-sats"),
      lootTab: $("loot-tab"),
      lootCount: $("loot-count"),
      crateHelp: $("crate-help"),
      worldLootHint: $("world-loot-hint"),
      subtitle: $("subtitle"),
      actions: [...document.querySelectorAll("[data-action]")],
      board: $("board-modal"), boardTitle: $("board-title"), boardScreen: $("board-screen"), boardCaption: $("board-caption"), boardNote: $("board-note"),
      boardDots: $("board-dots"), boardPrev: $("board-prev"), boardNext: $("board-next"), boardHelp: $("board-help"),
      boardHead: $("board-head"), boardPause: $("board-pause"), boardResize: $("board-resize"),
      act: $("act"),
      mode: $("mode-hud"),
      modeDestination: $("destination-hud"),
      modeFree: $("freeroam-icon"),
      modeFace: $("mode-face-icon"),
      modeHealth: $("mode-health"),
      modeHealthFill: $("mode-health-fill"),
      ownOoga: $("own-ooga-hud"),
      ownOogaFace: $("own-ooga-face-icon"),
      ownOogaHealth: $("own-ooga-health"),
      ownOogaHealthFill: $("own-ooga-health-fill"),
      modeDestinations: $("detached-destinations"),
      modeDestinationName: $("detached-destination-name"),
      modeDestinationDots: [...document.querySelectorAll("[data-detached-preset]")],
      primary: $("primary-hud"),
      primaryIcon: $("primary-icon"),
      primaryStrength: $("primary-strength"),
      primaryStrengthFill: $("primary-strength-fill"),
      gorillaSmash: $("gorilla-smash-hud"),
      gorillaStrength: $("gorilla-strength"),
      gorillaStrengthFill: $("gorilla-strength-fill"),
      weapon: $("weapon-hud"),
      weaponToggle: $("weapon-hud"),
      weaponReadout: $("weapon-readout"),
      weaponLabel: $("weapon-ammo-label"),
      weaponAmmo: $("weapon-ammo-count"),
      weaponCompact: $("weapon-ammo-compact"),
      weaponMagazine: $("weapon-magazine"),
      weaponBananas: [...$("weapon-magazine").querySelectorAll(".weapon-banana")],
      magazine: $("magazine-hud"),
      magazineIcon: $("magazine-hud").querySelector(".magazine-icon"),
      magazineFront: $("magazine-front"),
      magazineAmmo: $("magazine-ammo"),
      magazineBananas: [...$("magazine-front").querySelectorAll(".magazine-banana")],
      magazineLowAmmo: $("magazine-ammo-low"),
      magazineRearBananas: [...$("magazine-back").querySelectorAll(".magazine-banana")],
      jetpack: $("jetpack-hud"),
      jetpackFuel: $("jetpack-fuel"),
      jetpackFuelFill: $("jetpack-fuel-fill"),
      jetpackFuelValue: $("jetpack-fuel-value"),
      jetpackCompact: document.querySelector(".jetpack-compact"),
      jetpackCompactFuel: $("jetpack-fuel-compact"),
      jetpackCompactFill: $("jetpack-fuel-compact-fill"),
      messageStack: $("message-stack"),
      toast: $("toast"),
      tooltip: $("tooltip"),
      tooltipText: $("tooltip-text"),
      tooltipHealth: $("tooltip-health"),
      tooltipHealthFill: $("tooltip-health-fill"),
      hint: $("hint"),
      sheet: $("sheet"),
      sheetToggle: $("sheet-toggle"),
      sheetBananas: $("sheet-bananas"),
      tabs: [...document.querySelectorAll("[data-tab]")],
      panels: [...document.querySelectorAll("[data-panel]")],
      presets: [...document.querySelectorAll("[data-preset]")],
      inventory: $("inventory"),
      inventoryEmpty: $("inventory-empty"),
      handle: $("handle"),
      message: $("message"),
      qr: $("qr"),
      qrUrl: $("qr-url"),
      feed: $("feed"),
      recipe: $("recipe"),
      recipeText: $("recipe-text")
    };
    const favicon = new Image();
    favicon.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = favicon.width;
      canvas.height = favicon.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(favicon, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const brightness = Math.max(image.data[i], image.data[i + 1], image.data[i + 2]);
        const alpha = Math.max(0, Math.min(1, (brightness - 24) / 56));
        image.data[i + 3] = Math.round(alpha * 255);
        if (alpha > 0 && alpha < 1) for (let color = 0; color < 3; color++) image.data[i + color] = Math.min(255, image.data[i + color] / alpha);
      }
      ctx.putImageData(image, 0, 0);
      el.modeFree.src = canvas.toDataURL("image/png");
    };
    favicon.src = document.querySelector('link[rel="icon"][sizes="64x64"]').href;
    el.lootTab.hidden = !lootEnabled;
    el.crateHelp.hidden = !lootEnabled;
    el.worldLootHint.hidden = !lootEnabled;
    const savedSheet = readSheetState();
    const sheetTab = savedSheet && (savedSheet.tab !== "loot" || lootEnabled) ? savedSheet.tab : "roster";
    for (const tab of el.tabs) tab.setAttribute("aria-selected", String(tab.dataset.tab === sheetTab));
    for (const panel of el.panels) panel.hidden = panel.dataset.panel !== sheetTab;
    el.sheet.dataset.open = String(!!savedSheet?.open);
    el.primary.hidden = true;
    el.gorillaSmash.hidden = true;
    el.mode.hidden = true;
    el.ownOoga.hidden = true;
    el.weapon.hidden = true;
    el.magazine.hidden = true;
    el.jetpack.hidden = true;
    const listeners = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      listeners.push(() => target.removeEventListener(type, fn, opts));
    };
    let toastTimer = 0, toastHideTimer = 0, hintTimer = 0, hintHideTimer = 0, copyTimer = 0;
    const rosterRows = new Map();
    let showAway = false, awayCount = 0;
    const awayRow = document.createElement("li"), awayButton = document.createElement("button");
    awayRow.className = "roster-away";
    awayButton.type = "button";
    awayButton.setAttribute("aria-expanded", "false");
    awayRow.append(awayButton);
    const updateAwayButton = () => {
      awayRow.hidden = awayCount === 0;
      awayButton.textContent = `${showAway ? "Hide" : "Show"} away (${awayCount})`;
    };
    const orderedRoster = [...roster].sort((a, b) =>
      ROSTER_ORDER[BL.contributors.contributionStateFor(a)] - ROSTER_ORDER[BL.contributors.contributionStateFor(b)] ||
      (b.lastContributionAt || b.lastCommitAt) - (a.lastContributionAt || a.lastCommitAt));
    for (let rosterIndex = 0; rosterIndex < orderedRoster.length; rosterIndex++) {
      const contributor = orderedRoster[rosterIndex];
      const li = document.createElement("li");
      li.dataset.name = contributor.name;
      const presence = document.createElement("span");
      presence.className = "roster-presence";
      presence.dataset.online = "false";
      presence.setAttribute("role", "img");
      presence.setAttribute("aria-label", "Offline");
      presence.title = "Offline";
      const name = document.createElement("span");
      name.className = "roster-name";
      name.textContent = contributor.display;
      const age = document.createElement("span");
      age.className = "roster-age";
      age.append(BL.contributors.contributionAgeLabel(contributor));
      const state = document.createElement("span");
      state.className = "roster-state";
      const activity = BL.contributors.contributionStateFor(contributor);
      state.dataset.state = activity;
      state.append(STATE_LABELS[activity]);
      if (activity === "away") {
        if (!awayRow.parentElement) el.roster.append(awayRow);
        li.hidden = true; awayCount++;
      }
      li.append(presence, name, age, state);
      el.roster.append(li);
      rosterRows.set(contributor.name, { li, presence, state, age, contributor, rosterIndex, online: false });
    }
    if (!awayRow.parentElement) el.roster.append(awayRow);
    updateAwayButton();
    on(awayButton, "click", () => {
      showAway = !showAway;
      awayButton.setAttribute("aria-expanded", String(showAway));
      for (const row of rosterRows.values()) if (row.state.dataset.state === "away") row.li.hidden = !showAway;
      updateAwayButton();
    });
    const placeRosterRow = (row) => {
      const rank = ROSTER_ORDER[row.state.dataset.state], stamp = row.contributor.lastContributionAt || row.contributor.lastCommitAt;
      let before = rank === ROSTER_ORDER.away ? null : awayRow;
      for (const sibling of el.roster.children) {
        if (sibling === row.li || sibling === awayRow) continue;
        const other = rosterRows.get(sibling.dataset.name);
        const otherRank = ROSTER_ORDER[other.state.dataset.state], otherStamp = other.contributor.lastContributionAt || other.contributor.lastCommitAt;
        if (otherRank > rank) { before = otherRank === ROSTER_ORDER.away ? awayRow : sibling; break; }
        if (otherRank === rank && (otherStamp < stamp || otherStamp === stamp && other.rosterIndex > row.rosterIndex)) { before = sibling; break; }
      }
      if (before) {
        if (row.li.nextElementSibling !== before) el.roster.insertBefore(row.li, before);
      } else if (el.roster.lastElementChild !== row.li) el.roster.append(row.li);
    };
    const setRosterRow = (name, _stateKey, _ageText, online = false) => {
      const row = rosterRows.get(name);
      if (!row) return;
      // Gameplay can put an Ooga to work or sleep; this board follows the
      // contributor's latest recorded activity instead.
      const activity = BL.contributors.contributionStateFor(row.contributor);
      const ageText = BL.contributors.contributionAgeLabel(row.contributor);
      if (row.state.dataset.state !== activity) {
        if (row.state.dataset.state === "away") awayCount--;
        if (activity === "away") awayCount++;
        row.state.dataset.state = activity;
        row.state.firstChild.data = STATE_LABELS[activity] || activity;
        row.li.hidden = activity === "away" && !showAway;
        updateAwayButton();
      }
      if (row.age.firstChild.data !== ageText) row.age.firstChild.data = ageText;
      if (row.online !== online) {
        row.online = online;
        row.presence.dataset.online = online ? "true" : "false";
        row.presence.title = online ? "Online" : "Offline";
        row.presence.setAttribute("aria-label", row.presence.title);
      }
      placeRosterRow(row);
    };
    // Seed empty text nodes so later updates only mutate text, never the DOM.
    for (const node of [el.meterCount, el.meterForecast]) if (!node.firstChild) node.append("");
    let shownBananas = -1, shownWidth = "", shownBand = "", shownForecast = null;
    const setMeter = (level, capacity, forecastText) => {
      const percent = Math.min(100, Math.max(0, level / capacity * 100));
      const width = `${percent}%`;
      if (width !== shownWidth) {
        shownWidth = width;
        el.meterFill.style.width = width;
        el.meterFill.parentElement.setAttribute("aria-valuenow", String(Math.round(percent)));
      }
      const band = level < capacity * 0.15 ? "low" : level < capacity * 0.4 ? "mid" : "ok";
      if (band !== shownBand) el.meterFill.dataset.level = shownBand = band;
      const bananas = Math.floor(level);
      if (bananas !== shownBananas) {
        shownBananas = bananas;
        const count = BANANA_COUNT.format(bananas);
        el.meterCount.firstChild.data = count;
      }
      if (forecastText !== shownForecast) el.meterForecast.firstChild.data = shownForecast = forecastText;
    };
    const setStats = ({ totalSats, donations }) => {
      el.statDonations.textContent = String(donations);
      el.statSats.textContent = formatLarge(totalSats);
    };
    let actLabel = el.act.textContent;
    const setAct = (label) => {
      if (label === actLabel) return;
      actLabel = label;
      el.act.textContent = label;
    };
    let actionHandler = null;
    const DETACHED_PRESETS = ["pile", "lab", "mirror", "underground", "basement", "mempool"];
    const DETACHED_NAMES = { pile: "Pile", lab: "Lab", mirror: "Mirror", underground: "HQ", basement: "Basement", mempool: "Mempool" };
    let detachedPreset = "pile", detachedNameShown = false, detachedSelectionShown = false, areaLabel = "";
    let destinationAnchored = false, destinationX = 0, destinationY = 0, destinationZ = 0;
    const showAreaLabel = () => {
      if (el.modeDestinationName.textContent !== areaLabel) el.modeDestinationName.textContent = areaLabel;
      el.modeDestinationName.classList.toggle("show", !!areaLabel);
    };
    const fadeDetachedName = (force = false) => {
      // Looking or zooming at an arrival does not leave that place.
      // Scenes with an anchor expire it from actual travel instead.
      if (destinationAnchored && !force) return;
      if (!detachedNameShown && !detachedSelectionShown) return;
      destinationAnchored = false;
      detachedNameShown = false;
      detachedSelectionShown = false;
      showAreaLabel();
      for (const dot of el.modeDestinationDots) dot.dataset.current = "false";
    };
    const setAreaLabel = (name, position = null) => {
      areaLabel = name;
      if (destinationAnchored && position
        && (position.x - destinationX) ** 2 + (position.y - destinationY) ** 2 + (position.z - destinationZ) ** 2 > 2.25) fadeDetachedName(true);
      if (!detachedNameShown) showAreaLabel();
    };
    const setDetachedView = (name, announce = false, position = null) => {
      if (!DETACHED_NAMES[name]) return;
      detachedPreset = name;
      destinationAnchored = !!position;
      if (position) { destinationX = position.x; destinationY = position.y; destinationZ = position.z; }
      detachedSelectionShown = true;
      for (const dot of el.modeDestinationDots) dot.dataset.current = String(dot.dataset.detachedPreset === name);
      if (!announce) return;
      el.modeDestinationName.textContent = DETACHED_NAMES[name];
      detachedNameShown = true;
      el.modeDestinationName.classList.add("show");
    };
    const nextDetachedView = () => DETACHED_PRESETS[(DETACHED_PRESETS.indexOf(detachedPreset) + 1) % DETACHED_PRESETS.length];
    let gorillaEntry = null, gorillaView = "orbit", gorillaCombat = false;
    let modeName = "", modeGeometry = null, modeSelected = false, modeCombat = false, modeView = "detached", modeHealth = -1, modeHealthMax = 0, modeGorilla = false;
    let modeCave = null, modeVisible = true, ownOoga = null, ownPortraitCave = null, ownGeometry = null, ownPortraitGeometry = null, ownHealth = -1, ownHealthMax = 0;
    const syncOwnOoga = () => {
      const shown = modeVisible && !!ownOoga && ownOoga !== modeCave;
      if (el.ownOoga.hidden === shown) el.ownOoga.hidden = !shown;
      if (!shown) return;
      const geometry = ownOoga.parts.head.geometry, portraitGeometry = ownOoga.portraitHead;
      if (ownOoga !== ownPortraitCave || geometry !== ownGeometry || portraitGeometry !== ownPortraitGeometry) {
        renderFaceIcon(el.ownOogaFace, ownOoga);
        el.ownOoga.dataset.portrait = "face-crop";
        if (ownOoga !== ownPortraitCave) {
          const label = `Return to ${ownOoga.traits.display}, your Ooga`;
          el.ownOoga.setAttribute("aria-label", label);
          el.ownOoga.title = label;
        }
        ownPortraitCave = ownOoga;
        ownGeometry = geometry;
        ownPortraitGeometry = portraitGeometry;
      }
      const source = ownOoga.health, max = source ? source.max : BL.crew.HEALTH_MAX;
      const health = source ? Math.max(0, Math.min(max, source.value)) : max;
      if (health !== ownHealth || max !== ownHealthMax) {
        ownHealth = health; ownHealthMax = max;
        el.ownOogaHealthFill.style.transform = `scaleY(${health / max})`;
        el.ownOogaHealth.setAttribute("aria-valuemax", String(max));
        el.ownOogaHealth.setAttribute("aria-valuenow", String(Math.ceil(health)));
      }
    };
    const setOwnOoga = (cave) => {
      if (cave !== ownOoga) {
        ownOoga = cave;
        if (!cave) {
          ownPortraitCave = ownGeometry = ownPortraitGeometry = null;
          ownHealth = -1; ownHealthMax = 0;
          el.ownOogaFace.width = ICON_PX;
        }
      }
      syncOwnOoga();
    };
    const setMode = (cave, combat = false, view = cave ? "orbit" : "detached", visible = true) => {
      const gorilla = gorillaEntry ? gorillaEntry.gorilla : null;
      modeCave = gorilla ? null : cave;
      modeVisible = visible;
      syncOwnOoga();
      if (gorilla) { cave = gorillaEntry.owner; combat = gorillaCombat; view = gorillaView; visible = true; }
      const selected = !!cave, name = selected ? cave.traits.name : "", shown = selected ? cave.traits.display : "";
      if (!visible) fadeDetachedName(true);
      const identityChanged = selected !== modeSelected || selected && name !== modeName || !!gorilla !== modeGorilla;
      const stateChanged = combat !== modeCombat || view !== modeView;
      const showMode = visible && selected;
      if (el.mode.hidden === showMode) el.mode.hidden = !showMode;
      if (el.modeDestination.hidden === visible) el.modeDestination.hidden = !visible;
      const geometry = selected ? (gorilla ? gorilla.parts.head.geometry : cave.parts.head.geometry) : null;
      if (selected && (identityChanged || geometry !== modeGeometry)) {
        renderFaceIcon(el.modeFace, cave, gorilla);
        el.mode.dataset.portrait = "face-crop";
        modeName = name;
        modeGeometry = geometry;
      }
      if (!!gorilla !== modeGorilla) { modeGorilla = !!gorilla; el.mode.dataset.gorilla = String(modeGorilla); }
      if (selected !== modeSelected) {
        modeSelected = selected;
        el.mode.dataset.selected = String(selected);
      }
      if (el.modeFace.hidden === selected) el.modeFace.hidden = !selected;
      const showHealth = selected;
      if (el.modeHealth.hidden === showHealth) el.modeHealth.hidden = !showHealth;
      const sourceHealth = gorilla ? gorillaEntry.health : cave && cave.health;
      const healthMax = sourceHealth ? sourceHealth.max : BL.crew.HEALTH_MAX;
      const health = sourceHealth ? Math.max(0, Math.min(healthMax, sourceHealth.value)) : healthMax;
      if (health !== modeHealth || healthMax !== modeHealthMax) {
        modeHealth = health;
        modeHealthMax = healthMax;
        el.modeHealthFill.style.transform = `scaleY(${health / healthMax})`;
        el.modeHealth.setAttribute("aria-valuemax", String(healthMax));
        el.modeHealth.setAttribute("aria-valuenow", String(Math.ceil(health)));
      }
      if (stateChanged) { modeCombat = combat; modeView = view; }
      if (identityChanged || stateChanged) {
        el.mode.dataset.shooter = String(selected && combat);
        el.mode.dataset.combat = String(selected && combat);
        el.mode.dataset.view = selected ? view : "detached";
        el.mode.setAttribute("aria-pressed", String(selected && combat));
        el.mode.setAttribute("aria-label", gorilla
          ? `${shown}'s gorilla; ${view} view; ${combat ? "combat" : "carry"} mode. Press to switch combat or carry mode; hold to detach`
          : selected
          ? `${shown}; ${view} view; ${combat ? "combat" : "carry"} mode. Press to switch combat or carry mode; hold to detach`
          : `${DETACHED_NAMES[detachedPreset]} detached view. Press to cycle destinations`);
        el.mode.title = gorilla ? `${shown}'s gorilla · ${view} · ${combat ? "combat" : "carry"} · hold to detach` : selected ? `${shown} · ${view} · ${combat ? "combat" : "carry"} · hold to detach` : `${DETACHED_NAMES[detachedPreset]} · detached`;
      }
    };
    setDetachedView(detachedPreset);
    let primaryShown = false, primarySelected = false, primaryAiming = false, primaryHeld = false, primaryPower = 100;
    let primaryGeometry = null, primaryPointer = -1, primaryKey = "";
    const finishPrimary = (cancel) => {
      if (primaryPointer < 0 && !primaryKey) return;
      const pointer = primaryPointer;
      primaryPointer = -1; primaryKey = "";
      if (pointer >= 0 && el.primary.hasPointerCapture(pointer)) el.primary.releasePointerCapture(pointer);
      if (actionHandler) actionHandler(cancel ? "weapon-primary-cancel" : "weapon-primary-up");
    };
    const setPrimary = (available, selected, geometry, charge = 0, held = false, power = 1, aiming = false, ownerName = "") => {
      if (!available || !selected && primarySelected || geometry !== primaryGeometry) finishPrimary(true);
      if (available !== primaryShown) {
        primaryShown = available;
      }
      if (el.primary.hidden !== (!available || !!gorillaEntry)) el.primary.hidden = !available || !!gorillaEntry;
      if (available && geometry !== primaryGeometry) {
        renderPrimaryIcon(el.primaryIcon, geometry, ownerName === "timechainb");
        primaryGeometry = geometry;
      }
      if (selected !== primarySelected || aiming !== primaryAiming) {
        primarySelected = selected; primaryAiming = aiming;
        el.primary.dataset.equipped = String(selected);
        el.primary.setAttribute("aria-pressed", String(selected));
        el.primary.title = !selected ? "Equip primary melee weapon (1)" : "Melee weapon · 0.2s between hits for full power (1)";
        el.primary.setAttribute("aria-label", !selected ? "Equip primary melee weapon" : "Melee weapon · allow 0.2 seconds between hits for full power");
      }
      if (held !== primaryHeld) {
        primaryHeld = held;
        el.primary.dataset.charging = String(held);
      }
      const strength = Math.round(Math.max(0.25, Math.min(2, power)) * 100);
      if (strength !== primaryPower) {
        primaryPower = strength;
        el.primaryStrengthFill.style.transform = `scaleY(${strength / 200})`;
        el.primaryStrength.setAttribute("aria-valuenow", String(strength));
        el.primaryStrength.setAttribute("aria-valuetext", `${strength}% of normal swing damage`);
      }
    };
    let weaponShown = false, weaponEquipped = false, weaponAmmo = -1, weaponDisplayAmmo = -1, weaponReloading = false, weaponCanReload = false, weaponUnlimited = false;
    let magazineCount = 0, magazineHigh = -1, magazineLow = -1, magazineCanSwap = false;
    let magazineHighReloading = false, magazineLowReloading = false;
    let weaponTotal = -1, weaponLabelAmmo = -1, weaponLabelEquipped = false;
    const refreshWeaponSummary = () => {
      const total = weaponUnlimited ? Infinity : Math.max(0, weaponAmmo) + (magazineCount ? Math.max(0, magazineHigh) : 0) + (magazineCount > 1 ? Math.max(0, magazineLow) : 0);
      const shown = !gorillaEntry && weaponShown && weaponEquipped && magazineCount > 0;
      if (el.magazine.hidden === shown) el.magazine.hidden = !shown;
      const disabled = !shown || !magazineCanSwap;
      if (el.magazine.disabled !== disabled) el.magazine.disabled = disabled;
      if (total !== weaponTotal) {
        weaponTotal = total;
        el.weaponCompact.firstChild.data = weaponUnlimited ? "∞" : String(total);
        el.weaponCompact.dataset.level = total === 0 ? "empty" : total <= 5 ? "low" : "ok";
      }
      const labelAmmo = weaponEquipped ? weaponDisplayAmmo : total;
      if (labelAmmo !== weaponLabelAmmo || weaponEquipped !== weaponLabelEquipped) {
        weaponLabelAmmo = labelAmmo; weaponLabelEquipped = weaponEquipped;
        el.weaponToggle.setAttribute("aria-label", weaponUnlimited ? `${weaponEquipped ? "Fire" : "Equip"} AK-47; unlimited ammunition` : weaponEquipped ? `Fire AK-47; ammo ${labelAmmo} of 30 rounds` : `Equip AK-47; ${total} rounds total`);
      }
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const showWeaponAmmo = (ammo) => {
      if (ammo === weaponDisplayAmmo) return;
      weaponDisplayAmmo = ammo;
      el.weaponAmmo.firstChild.data = weaponUnlimited ? "∞" : `${ammo} / 30`;
      el.weaponMagazine.setAttribute("aria-valuenow", String(ammo));
      el.weaponMagazine.setAttribute("aria-valuetext", weaponUnlimited ? "Unlimited ammunition" : `${ammo} of 30 rounds`);
      el.weaponMagazine.dataset.level = weaponUnlimited ? "ok" : ammo === 0 ? "empty" : ammo <= 5 ? "low" : "ok";
      refreshWeaponSummary();
    };
    const clearWeaponLoad = () => {
      for (const banana of el.weaponBananas) {
        banana.classList.remove("weapon-banana--loading");
        banana.style.removeProperty("animation-delay");
      }
    };
    on(el.weaponMagazine, "animationstart", (event) => {
      if (event.animationName !== "weapon-banana-load" || !weaponShown || !weaponEquipped) return;
      const banana = event.target.closest(".weapon-banana");
      if (!banana.classList.contains("weapon-banana--loading") || banana.dataset.filled !== "true") return;
      // A banana credits three rounds at once; the readout follows each
      // already-loaded slot as its staggered fill actually appears.
      showWeaponAmmo(Math.min(weaponAmmo, Math.max(weaponDisplayAmmo, el.weaponBananas.indexOf(banana) + 1)));
    });
    on(el.weaponMagazine, "animationend", (event) => {
      if (event.animationName !== "weapon-banana-load") return;
      const banana = event.target.closest(".weapon-banana");
      banana.classList.remove("weapon-banana--loading");
      banana.style.removeProperty("animation-delay");
    });
    on(reducedMotion, "change", () => {
      if (!reducedMotion.matches) return;
      clearWeaponLoad();
      showWeaponAmmo(weaponAmmo);
    });
    const setWeapon = (available, equipped, ammo, reloading = false, canReload = false, unlimited = false) => {
      const modeChanged = weaponUnlimited !== unlimited;
      if (modeChanged) {
        weaponUnlimited = unlimited;
        weaponDisplayAmmo = weaponTotal = weaponLabelAmmo = -1;
      }
      ammo = Math.max(0, Math.min(30, Math.floor(ammo)));
      const animateReload = !unlimited && available && weaponShown && equipped && weaponEquipped && weaponAmmo >= 0
        && ammo > weaponAmmo && ammo <= weaponAmmo + 3 && (reloading || weaponReloading) && !reducedMotion.matches;
      if (modeChanged || (!available && weaponShown) || (!equipped && weaponEquipped) || ammo !== weaponAmmo && !animateReload) clearWeaponLoad();
      if (available !== weaponShown) {
        weaponShown = available;
      }
      if (el.weapon.hidden !== (!available || !!gorillaEntry)) el.weapon.hidden = !available || !!gorillaEntry;
      if (equipped !== weaponEquipped) {
        weaponEquipped = equipped;
        el.weapon.dataset.equipped = String(equipped);
        el.weaponToggle.setAttribute("aria-pressed", String(equipped));
        el.weaponToggle.setAttribute("aria-expanded", String(equipped));
        el.weaponToggle.title = equipped ? "Fire AK-47" : "Equip AK-47 (2)";
        el.weaponReadout.setAttribute("aria-hidden", String(!equipped));
      }
      if (modeChanged || reloading !== weaponReloading || canReload !== weaponCanReload) {
        weaponReloading = reloading;
        weaponCanReload = canReload;
        el.weapon.dataset.reloading = String(reloading);
        el.weapon.dataset.canReload = String(canReload);
        el.weaponLabel.firstChild.data = reloading ? "Reloading" : "Ammo";
        el.weaponMagazine.title = unlimited ? "Unlimited ammunition; firing does not consume rounds" : reloading ? "Stay near the pile to keep reloading; leave its range to stop" : canReload ? "Press Space to reload beside the pile; its level stays the same" : "Each slot is 1 round. Press Space beside the pile to reload.";
      }
      if (ammo === weaponAmmo) {
        if (modeChanged || !available || !equipped || reducedMotion.matches) showWeaponAmmo(ammo);
        refreshWeaponSummary(); return;
      }
      const from = Math.max(0, Math.min(ammo, weaponAmmo)), to = weaponAmmo < 0 ? 30 : Math.max(ammo, weaponAmmo);
      weaponAmmo = ammo;
      if (!animateReload) showWeaponAmmo(ammo);
      for (let i = from; i < to; i++) {
        const banana = el.weaponBananas[i];
        banana.dataset.filled = String(i < ammo);
        banana.classList.toggle("weapon-banana--loading", animateReload);
        if (animateReload) banana.style.animationDelay = `${(i - from) * 70}ms`;
        else banana.style.removeProperty("animation-delay");
      }
      refreshWeaponSummary();
    };
    const setMagazine = (count, firstAmmo, secondAmmo, canSwap, reloadingIndex = -1) => {
      const button = el.magazine;
      firstAmmo = Math.max(0, Math.min(30, Math.floor(firstAmmo)));
      secondAmmo = Math.max(0, Math.min(30, Math.floor(secondAmmo)));
      const front = count > 1 && secondAmmo > firstAmmo ? 1 : 0;
      const high = count ? front ? secondAmmo : firstAmmo : 0, low = count > 1 ? front ? firstAmmo : secondAmmo : 0;
      const highReloading = count > 0 && reloadingIndex === front, lowReloading = count > 1 && reloadingIndex === 1 - front;
      canSwap = count > 0 && canSwap && reloadingIndex < 0;
      if (count === magazineCount && high === magazineHigh && low === magazineLow && canSwap === magazineCanSwap
        && highReloading === magazineHighReloading && lowReloading === magazineLowReloading) return;
      if (count !== magazineCount) {
        magazineCount = count;
        button.dataset.count = String(count);
        button.dataset.owned = String(count > 0);
        el.magazineIcon.setAttribute("viewBox", count === 2 ? "0 0 32 32" : "2 0 32 32");
        el.magazineFront.setAttribute("transform", count === 2
          ? "translate(11.15 16) scale(0.86) rotate(20) scale(-1 1) translate(-12 -17)"
          : "translate(16 16) scale(0.94) rotate(20) scale(-1 1) translate(-12 -17)");
      }
      magazineCanSwap = canSwap;
      magazineHighReloading = highReloading; magazineLowReloading = lowReloading;
      button.dataset.reloading = String(highReloading);
      el.magazineLowAmmo.dataset.reloading = String(lowReloading);
      button.title = reloadingIndex >= 0 ? "Loading spare magazines; stay near the banana pile"
        : canSwap ? "Click or press R to use the fullest spare. Each banana is 6 rounds."
        : "Equip the AK-47 to swap magazines";
      button.setAttribute("aria-label", `${count} spare magazine${count === 1 ? "" : "s"}; ${high} of 30 rounds${count > 1 ? ` fullest, ${low} of 30 rounds lowest` : ""}${reloadingIndex >= 0 ? "; reloading" : canSwap ? "; click to use the fullest spare" : ""}`);
      if (high !== magazineHigh) {
        const filled = Math.round(high / 6), previous = Math.round(magazineHigh / 6);
        for (let i = 0; i < el.magazineBananas.length; i++) if (magazineHigh < 0 || (i < filled) !== (i < previous)) el.magazineBananas[i].dataset.filled = String(i < filled);
        magazineHigh = high;
        el.magazineAmmo.firstChild.data = String(high);
        button.dataset.level = high === 0 ? "empty" : high <= 5 ? "low" : "ok";
      }
      if (low !== magazineLow) {
        const filled = Math.round(low / 6), previous = Math.round(magazineLow / 6);
        for (let i = 0; i < el.magazineRearBananas.length; i++) if (magazineLow < 0 || (i < filled) !== (i < previous)) el.magazineRearBananas[i].dataset.filled = String(i < filled);
        magazineLow = low;
        el.magazineLowAmmo.firstChild.data = String(low);
        el.magazineLowAmmo.dataset.level = low === 0 ? "empty" : low <= 5 ? "low" : "ok";
      }
      refreshWeaponSummary();
    };
    let jetpackShown = false, jetpackEquipped = false, jetpackBlocked = false, jetpackPercent = -1, jetpackLevel = "";
    const setJetpack = (owned, equipped, fuel, blocked = false) => {
      if (owned !== jetpackShown) {
        jetpackShown = owned;
      }
      if (el.jetpack.hidden !== (!owned || !!gorillaEntry)) el.jetpack.hidden = !owned || !!gorillaEntry;
      if (equipped !== jetpackEquipped || blocked !== jetpackBlocked) {
        jetpackEquipped = equipped;
        jetpackBlocked = blocked;
        el.jetpack.disabled = blocked;
        el.jetpack.dataset.equipped = String(equipped);
        el.jetpack.setAttribute("aria-pressed", String(equipped));
        el.jetpack.setAttribute("aria-label", blocked ? "Jetpack unavailable underground" : equipped ? "Take off jetpack" : "Put on jetpack");
        el.jetpack.title = blocked ? "Jetpack unavailable underground" : "";
      }
      if (!owned) return;
      const percent = Math.ceil(fuel * 100);
      const level = fuel < 0.2 ? "low" : "ok";
      if (level !== jetpackLevel) {
        jetpackLevel = level;
        el.jetpackFuel.dataset.level = level;
        el.jetpackCompactFuel.dataset.level = level;
      }
      if (percent === jetpackPercent) return;
      jetpackPercent = percent;
      el.jetpackFuelFill.style.transform = `scaleX(${percent / 100})`;
      el.jetpackCompactFill.style.transform = `scaleY(${percent / 100})`;
      el.jetpackFuel.setAttribute("aria-valuenow", String(percent));
      el.jetpackCompactFuel.setAttribute("aria-valuenow", String(percent));
      el.jetpackFuelValue.firstChild.data = `${percent}%`;
    };
    const setGorilla = (entry, view = "orbit", combat = false) => {
      if (entry === gorillaEntry && view === gorillaView && combat === gorillaCombat) { syncOwnOoga(); return; }
      if (entry !== gorillaEntry) finishPrimary(true);
      gorillaEntry = entry;
      gorillaView = view;
      gorillaCombat = combat;
      el.gorillaSmash.hidden = !entry;
      el.primary.hidden = !primaryShown || !!entry;
      el.weapon.hidden = !weaponShown || !!entry;
      el.jetpack.hidden = !jetpackShown || !!entry;
      refreshWeaponSummary();
      setMode(null);
    };
    const setGorillaSmashPower = (power, returning = false, throwing = false) => {
      const percent = Math.round(Math.max(0, Math.min(throwing ? 1 : 5, power)) * (throwing ? 100 : 40));
      el.gorillaSmash.dataset.returning = String(returning);
      el.gorillaStrengthFill.style.transform = `scaleY(${percent / (throwing ? 100 : 200)})`;
      el.gorillaStrength.setAttribute("aria-label", throwing ? "Ooga throw power" : "Ground smash power");
      el.gorillaStrength.setAttribute("aria-valuemax", throwing ? "100" : "200");
      el.gorillaStrength.setAttribute("aria-valuenow", String(percent));
      el.gorillaStrength.setAttribute("aria-valuetext", throwing ? `${percent}% throw power` : `${percent}% of normal smash damage`);
      el.gorillaSmash.setAttribute("aria-label", throwing ? "Throw Ooga; hold click to charge, release to throw" : "Ground smash; hold for double damage");
      el.gorillaSmash.title = throwing ? "Throw Ooga · hold click to charge, release to throw" : "Ground smash · hold for double damage (1)";
    };
    const setSubtitle = (text) => {
      el.subtitle.textContent = text;
    };
    const onAction = (fn) => {
      actionHandler = fn;
    };
    const openFeed = () => {
      if (!el.feed.open) el.feed.showModal();
    };
    const closeFeed = () => {
      if (el.feed.open) el.feed.close();
    };
    on(el.feed, "keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeFeed();
    });
    const floatingBoards = [];
    const stackBoards = () => {
      for (let i = 0; i < floatingBoards.length; i++) floatingBoards[i].setLayer(20 + i);
    };
    let boardWindowId = 0;
    let lastBoard = null, lastBoardWidth = 550, boardSaveTimer = 0, boardSavingEnabled = false, boardSavingSuspended = false;
    const saveBoardState = () => {
      window.clearTimeout(boardSaveTimer);
      boardSaveTimer = 0;
      if (!boardSavingEnabled || boardSavingSuspended) return;
      if (lastBoard) lastBoardWidth = lastBoard.width;
      try {
        localStorage.setItem(BOARD_STATE_KEY, JSON.stringify({ version: 1, lastWidth: lastBoardWidth,
          lastUsed: floatingBoards.indexOf(lastBoard), windows: floatingBoards.map((popup) => popup.snapshot()) }));
      } catch { /* Storage may be unavailable or full. */ }
    };
    const scheduleBoardSave = () => {
      if (boardSavingEnabled && !boardSavingSuspended && !boardSaveTimer) boardSaveTimer = window.setTimeout(saveBoardState, 100);
    };
    on(window, "pagehide", saveBoardState);
    const createBoardWindow = (node, floatingId = 0, saved = null) => {
      const el = { board: node };
      const ids = {
        boardTitle: "board-title", boardScreen: "board-screen", boardCaption: "board-caption", boardNote: "board-note",
        boardDots: "board-dots", boardPrev: "board-prev", boardNext: "board-next", boardHelp: "board-help",
        boardHead: "board-head", boardPause: "board-pause", boardResize: "board-resize",
        boardFilter: "board-filter", boardFilterMenu: "board-filter-menu", boardFilterList: "board-filter-list", boardRollup: "board-rollup",
        boardFilterRepos: "board-filter-repos", boardFilterUsers: "board-filter-users", boardFilterTypes: "board-filter-types"
      };
      for (const key in ids) el[key] = node.querySelector(`[id="${ids[key]}"]`);
      const boardNav = node.querySelector(".board-nav"), boardCenter = node.querySelector(".board-center");
      if (floatingId) {
        node.id += `-${floatingId}`;
        for (const child of node.querySelectorAll("[id]")) child.id += `-${floatingId}`;
        node.setAttribute("aria-labelledby", el.boardTitle.id);
      }
      el.boardFilter.setAttribute("aria-controls", el.boardFilterMenu.id);
      el.boardFilterRepos.setAttribute("aria-controls", el.boardFilterList.id);
      el.boardFilterUsers.setAttribute("aria-controls", el.boardFilterList.id);
      el.boardFilterTypes.setAttribute("aria-controls", el.boardFilterList.id);
      const boardListeners = [];
      const on = (target, type, fn, options) => {
        target.addEventListener(type, fn, options);
        boardListeners.push(() => target.removeEventListener(type, fn, options));
      };
      // Each window copies a readable board's canvas and owns its controls.
      // A board is any object with `title`, `help`, `canvas`, `count`, `index`, `caption`, `note`, `version` and
      // `go(index)`, plus optional `wide` and `captionAbove` layouts. The dialog copies the canvas, captions the page, lays one dot per page and pages with the
      // chevrons, the dots and the arrow keys; it never learns what a board shows, so a board can change freely.
      // `updateBoard` repaints whenever the open board's version moves.
      // A `floating` board also supplies `paused` and `setPaused`, and keeps island input available.
      let board = null, boardShown = -1, boardDots = -1;
      let filterTab = "repos", filterShown = -1;
      const filterTabs = [el.boardFilterRepos, el.boardFilterUsers, el.boardFilterTypes];
      const typeLabels = { commit: "Commits", pr: "Pull requests", review: "Reviews", merge: "Merges", issue: "Issues", comment: "Comments" };
      const filterOptions = () => filterTab === "repos" ? board.repos : filterTab === "users" ? board.users : board.types;
      const filterKey = (entry) => filterTab === "repos" ? entry.name : filterTab === "users" ? entry.login : entry;
      const paintFilters = () => {
        filterShown = board.filterVersion;
        const selected = board.filters[filterTab];
        const active = document.activeElement;
        const focusedChoice = el.boardFilterList.contains(active) ? active.dataset.filterChoice : null;
        const focusedValue = focusedChoice ? active.value : null;
        const rows = [];
        const row = (value, text, checked, all = false) => {
          const label = document.createElement("label"), input = document.createElement("input"), caption = document.createElement("span");
          input.type = "checkbox"; input.checked = checked; input.value = value;
          input.dataset.filterChoice = all ? "all" : "one";
          caption.textContent = text;
          label.append(input, caption); rows.push(label);
        };
        row("", filterTab === "repos" ? "All repos" : filterTab === "users" ? "All contributors" : "All types", selected === null, true);
        for (const entry of filterOptions()) {
          const key = filterKey(entry);
          const label = filterTab === "repos" ? key
            : filterTab === "users" ? BL.characters.displayOf(key) : typeLabels[key];
          row(key, label, selected === null || selected.includes(key));
        }
        const scroll = el.boardFilterList.scrollTop;
        el.boardFilterList.replaceChildren(...rows);
        el.boardFilterList.scrollTop = scroll;
        if (focusedChoice) for (const input of el.boardFilterList.querySelectorAll("input")) {
          if (input.dataset.filterChoice === focusedChoice && input.value === focusedValue) { input.focus({ preventScroll: true }); break; }
        }
        el.boardFilterList.setAttribute("aria-labelledby", filterTabs.find((tab) => tab.dataset.filterTab === filterTab).id);
        for (const tab of filterTabs) {
          const active = tab.dataset.filterTab === filterTab;
          tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
        }
      };
      const positionFilters = () => {
        const screen = el.boardScreen, play = el.boardPause, menu = el.boardFilterMenu;
        // Match the screen's edges and stop at the play button's bottom.
        menu.style.left = `${screen.offsetLeft}px`;
        menu.style.top = `${screen.offsetTop}px`;
        menu.style.width = `${screen.offsetWidth}px`;
        menu.style.height = `${play.offsetTop + play.offsetHeight - screen.offsetTop}px`;
      };
      const showFilters = (open) => {
        el.boardFilterMenu.hidden = !open;
        el.boardFilter.setAttribute("aria-expanded", String(open));
        if (open) { paintFilters(); positionFilters(); }
      };
      // Geometry and pointer state belong to this window for this visit.
      const boardRatio = 550 / 368;
      const width = saved?.width ?? lastBoard?.width ?? lastBoardWidth;
      const boardWindow = { x: saved?.x ?? 0, y: saved?.y ?? 0, width, height: width / boardRatio, placed: !!saved };
      const interactBoard = () => {
        if (!floatingId) return;
        lastBoard = controller;
        lastBoardWidth = boardWindow.width;
        const index = floatingBoards.indexOf(controller);
        if (index >= 0 && index !== floatingBoards.length - 1) {
          floatingBoards.splice(index, 1);
          floatingBoards.push(controller);
        }
        // Keep pressed controls and pointer capture attached while raising the window.
        stackBoards();
        scheduleBoardSave();
      };
      let boardPointer = -1, boardHandle = null, boardResizing = false;
      let boardStartX = 0, boardStartY = 0, boardStartLeft = 0, boardStartTop = 0, boardStartWidth = 0;
      const layoutBoard = () => {
        const w = window.innerWidth, h = window.innerHeight, b = boardWindow;
        const maxWidth = Math.min(w, h * boardRatio);
        b.width = Math.min(maxWidth, Math.max(Math.min(260, maxWidth), b.width));
        b.height = b.width / boardRatio;
        b.x = Math.max(0, Math.min(w - b.width, b.x));
        b.y = Math.max(0, Math.min(h - b.height, b.y));
        el.board.style.width = `${b.width}px`;
        el.board.style.height = `${b.height}px`;
        el.board.style.left = `${b.x}px`;
        el.board.style.top = `${b.y}px`;
        el.board.style.setProperty("--board-scale", String(Math.min(b.width, 550) / 440));
        if (!el.boardFilterMenu.hidden) positionFilters();
      };
      const resizeBoard = (width) => {
        const maxWidth = Math.min(window.innerWidth - boardWindow.x, (window.innerHeight - boardWindow.y) * boardRatio);
        boardWindow.width = Math.min(maxWidth, Math.max(Math.min(260, maxWidth), width));
        layoutBoard();
      };
      const finishBoardPointer = () => {
        const id = boardPointer, handle = boardHandle;
        boardPointer = -1;
        boardHandle = null;
        if (handle && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
        if (id >= 0) scheduleBoardSave();
      };
      const startBoardPointer = (e, resizing) => {
        if (!board?.floating || boardPointer >= 0 || e.button !== 0 || !e.isPrimary) return;
        if (!resizing && e.target.closest("button")) return;
        interactBoard();
        e.preventDefault();
        e.stopPropagation();
        document.activeElement?.blur();
        boardPointer = e.pointerId;
        boardHandle = resizing ? el.boardResize : el.boardHead;
        boardResizing = resizing;
        boardStartX = e.clientX; boardStartY = e.clientY;
        boardStartLeft = boardWindow.x; boardStartTop = boardWindow.y;
        boardStartWidth = boardWindow.width;
        // The locked virtual cursor already captures its synthetic pointer itself.
        if (e.isTrusted) boardHandle.setPointerCapture(e.pointerId);
      };
      on(el.boardHead, "pointerdown", (e) => startBoardPointer(e, false));
      on(el.boardResize, "pointerdown", (e) => startBoardPointer(e, true));
      on(el.board, "pointerdown", (e) => {
        if (board?.floating) {
          interactBoard();
          if (!e.target.closest("button, input, label")) e.preventDefault();
        }
      });
      on(el.board, "pointermove", (e) => {
        if (e.pointerId !== boardPointer) return;
        e.preventDefault(); e.stopPropagation();
        if (boardResizing) {
          // Project the pointer's motion onto the fixed-ratio corner diagonal.
          const dx = e.clientX - boardStartX, dy = e.clientY - boardStartY;
          resizeBoard(boardStartWidth + (dx + dy / boardRatio) / (1 + 1 / (boardRatio * boardRatio)));
        } else {
          boardWindow.x = boardStartLeft + e.clientX - boardStartX;
          boardWindow.y = boardStartTop + e.clientY - boardStartY;
          layoutBoard();
        }
      });
      const endBoardPointer = (e) => {
        if (e.pointerId !== boardPointer) return;
        e.preventDefault(); e.stopPropagation();
        finishBoardPointer();
      };
      on(el.board, "pointerup", endBoardPointer);
      on(el.board, "pointercancel", endBoardPointer);
      on(el.board, "lostpointercapture", endBoardPointer);
      on(window, "blur", finishBoardPointer);
      on(window, "resize", () => {
        if (board?.floating) { layoutBoard(); scheduleBoardSave(); }
      });
      on(el.boardResize, "keydown", (e) => {
        let step;
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") step = -20;
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") step = 20;
        else return;
        e.preventDefault(); e.stopPropagation();
        interactBoard();
        resizeBoard(boardWindow.width + step);
        scheduleBoardSave();
      });
      const paintBoardPause = () => {
        el.boardPause.setAttribute("aria-label", board.paused ? "Resume screen cycling" : "Pause screen cycling");
        el.boardPause.setAttribute("aria-pressed", String(board.paused));
      };
      const paintBoard = () => {
        boardShown = board.version;
        const src = board.canvas, screen = el.boardScreen;
        if (screen.width !== src.width || screen.height !== src.height) {
          screen.width = src.width;
          screen.height = src.height;
          screen.style.setProperty("--board-ratio", String(src.width / src.height));
        }
        screen.getContext("2d").drawImage(src, 0, 0);
        el.boardCaption.textContent = board.caption;
        el.boardNote.textContent = board.note || "";
        el.boardNote.hidden = !!board.floating || !board.note;
        if (board.floating || board.carousel) paintBoardPause();
        if (board.floating) {
          el.boardRollup.checked = board.rollup;
          el.boardFilter.dataset.active = String(board.rollup || board.filters.repos !== null || board.filters.users !== null || board.filters.types !== null);
          if (!el.boardFilterMenu.hidden && filterShown !== board.filterVersion) paintFilters();
        }
        if (boardDots !== board.count) {
          boardDots = board.count;
          const dots = [];
          for (let i = 0; i < board.count; i++) {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "board-dot";
            dot.dataset.page = String(i);
            dot.setAttribute("aria-label", `Page ${i + 1}`);
            dots.push(dot);
          }
          el.boardDots.replaceChildren(...dots);
          el.boardDots.hidden = el.boardPrev.hidden = el.boardNext.hidden = !board.floating && board.count < 2;
          el.boardPrev.disabled = el.boardNext.disabled = board.count < 2;
        }
        for (const dot of el.boardDots.children) dot.setAttribute("aria-current", String(+dot.dataset.page === board.index));
        if (!el.boardFilterMenu.hidden) positionFilters();
        if (floatingId) scheduleBoardSave();
      };
      const openBoard = (next) => {
        finishBoardPointer();
        if (el.board.open && !!board?.floating !== !!next.floating) el.board.close();
        board = next;
        boardDots = -1;
        letterSign(el.boardTitle, board.title);
        el.board.classList.toggle("board-wide", !!board.wide);
        el.board.classList.toggle("board-floating", !!board.floating);
        el.board.classList.toggle("board-caption-above", !!board.captionAbove);
        el.board.classList.toggle("board-carousel", !!board.carousel);
        if (board.floating) {
          boardCenter.prepend(el.boardCaption);
          el.boardHead.insertBefore(el.boardDots, el.boardHead.lastElementChild);
        } else if (board.carousel) {
          el.boardScreen.before(el.boardCaption);
          boardCenter.prepend(el.boardPause);
          el.boardHead.insertBefore(el.boardDots, el.boardHead.lastElementChild);
        } else if (board.captionAbove) {
          el.boardScreen.before(el.boardCaption);
          boardCenter.prepend(el.boardDots);
        } else {
          boardCenter.prepend(el.boardCaption);
          boardNav.after(el.boardDots);
        }
        el.boardCaption.hidden = !!board.floating || !!board.hideCaption;
        el.boardPause.hidden = !board.floating && !board.carousel;
        el.boardResize.hidden = !board.floating;
        el.boardFilter.hidden = !board.floating;
        showFilters(false);
        el.boardHelp.hidden = !!board.floating || !board.help;
        el.boardHelp.textContent = board.help;
        if (board.floating) {
          if (!boardWindow.placed) {
            const offset = ((floatingId - 1) % 6) * 24;
            boardWindow.x = (window.innerWidth - boardWindow.width) / 2 + offset;
            boardWindow.y = (window.innerHeight - boardWindow.height) / 2 + offset;
            boardWindow.placed = true;
          }
          layoutBoard();
        } else {
          el.board.removeAttribute("style");
        }
        if (board.update) board.update();
        paintBoard();
        if (!el.board.open) {
          if (board.floating) {
            el.board.show();
            document.activeElement?.blur();
          } else el.board.showModal();
        }
      };
      const closeBoard = () => {
        finishBoardPointer();
        const closing = board;
        board = null;
        if (el.board.open) el.board.close();
        if (floatingId) {
          if (lastBoard === controller) { lastBoardWidth = boardWindow.width; lastBoard = null; }
          for (const off of boardListeners) off();
          boardListeners.length = 0;
          closing?.dispose();
          el.board.remove();
          el.boardScreen.width = el.boardScreen.height = 0;
          const index = floatingBoards.indexOf(controller);
          if (index >= 0) floatingBoards.splice(index, 1);
          stackBoards();
          scheduleBoardSave();
        }
      };
      const updateBoard = (elapsed) => {
        if (board?.update) board.update(elapsed);
        if (board && board.version !== boardShown) paintBoard();
      };
      const pageBoard = (step) => {
        if (!board) return;
        board.go((board.index + step + board.count) % board.count);
        updateBoard();
      };
      on(el.board, "keydown", (e) => {
        interactBoard();
        if (e.target.closest(".board-filter-menu")) {
          if (e.key === "Escape") { showFilters(false); el.boardFilter.focus(); }
          else return;
        }
        else if (e.key === "Escape") {
          if (!el.boardFilterMenu.hidden) showFilters(false);
          else closeBoard();
        }
        else if (e.key === "ArrowLeft") pageBoard(-1);
        else if (e.key === "ArrowRight") pageBoard(1);
        else return;
        e.preventDefault();
        e.stopPropagation();
      });
      on(el.boardFilterMenu, "click", (e) => {
        const tab = e.target.closest("[data-filter-tab]");
        if (!tab) return;
        interactBoard(); filterTab = tab.dataset.filterTab;
        el.boardFilterList.scrollTop = 0;
        paintFilters();
      });
      on(el.boardFilterMenu, "keydown", (e) => {
        if (!e.target.closest("[data-filter-tab]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const current = filterTabs.findIndex((tab) => tab.dataset.filterTab === filterTab);
        const next = e.key === "Home" ? 0 : e.key === "End" ? filterTabs.length - 1
          : (current + (e.key === "ArrowRight" ? 1 : filterTabs.length - 1)) % filterTabs.length;
        filterTab = filterTabs[next].dataset.filterTab;
        paintFilters();
        filterTabs[next].focus();
      });
      on(el.boardFilterList, "change", (e) => {
        const input = e.target.closest("[data-filter-choice]");
        if (!input) return;
        interactBoard();
        const choices = filterOptions().map(filterKey);
        let values;
        if (input.dataset.filterChoice === "all") values = input.checked ? null : [];
        else {
          const selected = new Set(board.filters[filterTab] ?? choices);
          if (input.checked) selected.add(input.value); else selected.delete(input.value);
          values = choices.every((key) => selected.has(key)) ? null : [...selected];
        }
        board.setFilter(filterTab, values);
        updateBoard();
        scheduleBoardSave();
      });
      on(el.boardRollup, "change", () => {
        if (!board?.floating) return;
        interactBoard();
        board.setRollup(el.boardRollup.checked);
        updateBoard();
        scheduleBoardSave();
      });
      on(el.boardDots, "click", (e) => {
        const dot = e.target.closest(".board-dot");
        if (!dot || !board) return;
        interactBoard();
        dot.blur();
        board.go(+dot.dataset.page);
        updateBoard();
      });
      on(el.board, "click", (e) => {
        const button = e.target.closest("[data-action]");
        if (!button) return;
        interactBoard();
        button.blur();
        if (button.dataset.action === "board-close") closeBoard();
        else if (button.dataset.action === "board-prev") pageBoard(-1);
        else if (button.dataset.action === "board-next") pageBoard(1);
        else if (button.dataset.action === "board-filter") showFilters(el.boardFilterMenu.hidden);
        else if (button.dataset.action === "board-filter-done") showFilters(false);
        else if (button.dataset.action === "board-pause" && (board?.floating || board?.carousel)) {
          board.setPaused(!board.paused);
          paintBoardPause();
          scheduleBoardSave();
        }
      });
      const controller = {
        open: openBoard, close: closeBoard, update: updateBoard,
        setLayer(layer) { el.board.style.zIndex = String(layer); },
        get width() { return boardWindow.width; },
        snapshot() { return { x: boardWindow.x, y: boardWindow.y, width: boardWindow.width, screen: board.view, paused: board.paused, filters: board.filters, rollup: board.rollup }; },
        dispose() {
          closeBoard();
          for (const off of boardListeners) off();
          boardListeners.length = 0;
        }
      };
      return controller;
    };
    const mainBoard = createBoardWindow(el.board);
    const openFloatingBoard = (next, saved = null) => {
      // Bound bitmap/DOM memory while still opening a fresh window on every click.
      if (floatingBoards.length === MAX_FLOATING_BOARDS) floatingBoards[0].close();
      const node = el.board.cloneNode(true);
      node.removeAttribute("open");
      const popup = createBoardWindow(node, ++boardWindowId, saved);
      el.board.parentElement.append(node);
      floatingBoards.push(popup);
      popup.open(next.createReader(saved));
      stackBoards();
      return popup;
    };
    const restoreBoards = (next) => {
      if (boardSavingEnabled) return;
      const saved = readBoardState();
      boardSavingEnabled = true;
      boardSavingSuspended = true;
      if (saved) {
        lastBoardWidth = saved.lastWidth;
        for (const entry of saved.windows) openFloatingBoard(next, entry);
        lastBoard = floatingBoards[saved.lastUsed] || null;
      }
      boardSavingSuspended = false;
    };
    const openBoard = (next) => {
      if (!next.floating) { mainBoard.open(next); return; }
      restoreBoards(next);
      lastBoard = openFloatingBoard(next);
      scheduleBoardSave();
    };
    const closeBoard = (preserve = false) => {
      if (preserve && !boardSavingSuspended) {
        saveBoardState();
        boardSavingSuspended = true;
      }
      mainBoard.close();
      while (floatingBoards.length) floatingBoards[floatingBoards.length - 1].close();
    };
    const updateBoard = (elapsed) => {
      mainBoard.update(elapsed);
      for (let i = 0; i < floatingBoards.length; i++) floatingBoards[i].update(elapsed);
    };
    const openRecipe = () => {
      if (!el.recipe.open) el.recipe.showModal();
    };
    const closeRecipe = () => {
      if (el.recipe.open) el.recipe.close();
    };
    on(el.recipe, "keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRecipe();
    });
    // Every popup closes when the visitor presses outside it, in every scene: a modal dialog on its
    // backdrop (the press lands on the dialog itself, outside its box), a card or a pause box anywhere
    // else on the page. The island's dialogs are registered here; a scene adds its own.
    const outside = [];
    const dismissOutside = (node, close) => {
      if (node) outside.push({ node, close });
    };
    on(document, "pointerdown", (e) => {
      for (const entry of outside) {
        const node = entry.node;
        if (node.tagName === "DIALOG" ? !node.open : node.hidden) continue;
        const r = node.getBoundingClientRect();
        if (node.contains(e.target) && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) continue;
        entry.close();
      }
    }, true);
    dismissOutside(el.feed, closeFeed);
    dismissOutside(el.recipe, closeRecipe);
    dismissOutside(el.board, () => mainBoard.close());
    // The prompt is written to be pasted, so it leaves in one click.
    const copyRecipe = (button) => {
      const text = el.recipeText.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
      else {
        const field = document.createElement("textarea");
        field.value = text;
        document.body.append(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      // A toast would sit behind the modal's backdrop, so the button answers.
      window.clearTimeout(copyTimer);
      button.textContent = "Copied";
      copyTimer = window.setTimeout(() => { button.textContent = "Copy prompt"; }, 1600);
    };
    const primaryPointerEvent = (e) => {
      if (e.button !== 0) return;
      // Pressing or releasing one mouse button while another stays held is a
      // pointermove, both natively and through the virtual carry cursor.
      const down = e.type === "pointerdown" || e.type === "pointermove" && (e.buttons & 1);
      if (down) {
        if (primaryPointer >= 0 || primaryKey || el.primary.hidden) return;
        e.preventDefault(); e.stopPropagation();
        primaryPointer = e.pointerId;
        // The locked carry cursor already captures its synthetic pointer target.
        if (e.isTrusted && !document.pointerLockElement) el.primary.setPointerCapture(e.pointerId);
        if (actionHandler) actionHandler("weapon-primary-down");
      } else if (e.pointerId === primaryPointer) {
        e.preventDefault(); e.stopPropagation();
        finishPrimary(false);
        el.primary.blur();
      }
    };
    on(el.primary, "pointerdown", primaryPointerEvent);
    on(el.primary, "pointerup", primaryPointerEvent);
    on(el.primary, "pointermove", primaryPointerEvent);
    on(el.primary, "pointercancel", (e) => { if (e.pointerId === primaryPointer) finishPrimary(true); });
    on(el.primary, "lostpointercapture", (e) => { if (e.pointerId === primaryPointer) finishPrimary(true); });
    on(el.primary, "keydown", (e) => {
      if (e.code !== "Space" && e.code !== "Enter") return;
      e.preventDefault(); e.stopPropagation();
      if (e.repeat || primaryKey || primaryPointer >= 0 || el.primary.hidden) return;
      primaryKey = e.code;
      if (actionHandler) actionHandler("weapon-primary-down");
    });
    on(el.primary, "keyup", (e) => {
      if (e.code !== primaryKey) return;
      e.preventDefault(); e.stopPropagation();
      finishPrimary(false);
    });
    on(el.primary, "blur", () => finishPrimary(true));
    on(window, "blur", () => finishPrimary(true));
    on(document, "visibilitychange", () => { if (document.hidden) finishPrimary(true); });
    on(el.primary, "contextmenu", (e) => e.preventDefault());
    const MODE_HOLD_MS = 650;
    let modePointer = -1, modeHoldTimer = 0, modeLong = false;
    const clearModeHold = () => {
      window.clearTimeout(modeHoldTimer);
      modeHoldTimer = 0;
      el.mode.dataset.holding = "false";
    };
    on(el.mode, "pointerdown", (e) => {
      if (e.button !== 0 || modePointer >= 0) return;
      e.preventDefault(); e.stopPropagation();
      modePointer = e.pointerId;
      modeLong = false;
      el.mode.dataset.holding = String(modeSelected);
      if (e.isTrusted) el.mode.setPointerCapture(e.pointerId);
      if (modeSelected) {
        modeHoldTimer = window.setTimeout(() => {
          modeHoldTimer = 0;
          modeLong = true;
          el.mode.dataset.holding = "false";
          if (actionHandler) actionHandler("mode-release");
        }, MODE_HOLD_MS);
      }
    });
    const finishModePress = (e, cancel = false) => {
      if (e.pointerId !== modePointer) return;
      e.preventDefault(); e.stopPropagation();
      modePointer = -1;
      if (el.mode.hasPointerCapture(e.pointerId)) el.mode.releasePointerCapture(e.pointerId);
      clearModeHold();
      if (!cancel && !modeLong && modeSelected && actionHandler) actionHandler("mode-toggle");
      modeLong = false;
      el.mode.blur();
    };
    on(el.mode, "pointerup", (e) => finishModePress(e));
    on(el.mode, "pointercancel", (e) => finishModePress(e, true));
    on(el.mode, "lostpointercapture", (e) => { if (e.pointerId === modePointer) finishModePress(e, true); });
    on(el.mode, "contextmenu", (e) => e.preventDefault());
    for (const b of el.actions.filter((button) => !button.dataset.action.startsWith("board-"))) on(b, "click", (e) => {
      // Native and virtual pointer clicks already completed their press/release.
      // A detail-zero click is an assistive or programmatic tap without a hold.
      if (b === el.primary && (e.detail !== 0 || primaryPointer >= 0 || primaryKey)) return;
      if (b === el.mode && e.detail !== 0) return;
      b.blur();
      if (b.dataset.action === "feed") openFeed();
      else if (b.dataset.action === "feed-close") closeFeed();
      else if (b.dataset.action === "recipe-close") closeRecipe();
      else if (b.dataset.action === "recipe-copy") copyRecipe(b);
      else if (b.dataset.action === "intro-go") b.closest("[data-intro]").hidden = true;
      else if (b === el.modeDestination) {
        // The locked virtual cursor dispatches to the enclosing button.
        // Resolve the dot at its screen coordinates as well as native targets.
        const dot = e.target.closest("[data-detached-preset]")
          || (e.detail > 0 ? document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-detached-preset]") : null);
        actionHandler && actionHandler("mode-preset", dot ? dot.dataset.detachedPreset : nextDetachedView());
      }
      else if (b.dataset.action === "account-login") BL.net.login();
      else if (b.dataset.action === "account-logout") BL.net.logout();
      else if (b.dataset.action === "account-rejoin") BL.net.rejoin();
      else if (b.dataset.action === "account-voice") BL.voice.toggle();
      else actionHandler && actionHandler(b.dataset.action);
    });
    // A game's side panels fold away and come back from a tab on the screen's edge: a `data-fold`
    // button toggles the panel it names, and the stylesheet shows the tab while the panel is folded.
    for (const b of document.querySelectorAll("[data-fold]")) on(b, "click", () => {
      b.blur();
      const panel = document.getElementById(b.dataset.fold);
      panel.dataset.folded = String(panel.dataset.folded !== "true");
    });
    const toast = (text) => {
      window.clearTimeout(toastTimer);
      window.clearTimeout(toastHideTimer);
      el.toast.textContent = text;
      el.toast.hidden = false;
      el.messageStack.append(el.toast);
      el.toast.classList.add("show");
      toastTimer = window.setTimeout(() => {
        el.toast.classList.remove("show");
        toastHideTimer = window.setTimeout(() => {
          if (!el.toast.classList.contains("show")) el.toast.hidden = true;
        }, MESSAGE_FADE_MS);
      }, 2800);
    };
    let tipText = "", tipState = "", tipHealth = -1, tipHealthMax = -1, tipW = 0, tipH = 0, tipCave = null, tipName = false, tipLeft = NaN, tipTop = NaN;
    let tipVisibility = null, tipSpeechTop = Infinity;
    const tipScreen = { x: 0, y: 0, depth: 0 };
    const placeTooltip = (left, top) => {
      left = Math.round(left); top = Math.round(top);
      if (left === tipLeft && top === tipTop) return;
      tipLeft = left; tipTop = top;
      el.tooltip.style.transform = `translate(${left}px, ${top}px)`;
    };
    const tooltip = {
      show: (text, x, y, cave = null, noStatusDot = false, above = false) => {
        if (cave !== tipCave) tipSpeechTop = Infinity;
        tipCave = cave;
        const name = !!cave;
        const changed = text !== tipText || name !== tipName || el.tooltip.classList.contains("tooltip--no-status-dot") !== noStatusDot;
        el.tooltip.classList.toggle("tooltip--no-status-dot", noStatusDot);
        if (name !== tipName) {
          tipName = name;
          el.tooltip.classList.toggle("tooltip--name", name);
          el.tooltipHealth.hidden = !name;
          if (!name) {
            tipState = "";
            tipHealth = tipHealthMax = -1;
            delete el.tooltip.dataset.state;
            el.tooltip.removeAttribute("aria-label");
          }
        }
        el.tooltip.hidden = false;
        if (changed) {
          tipText = text;
          tipState = "";
          el.tooltipText.textContent = text;
          tipW = el.tooltip.offsetWidth;
          tipH = el.tooltip.offsetHeight;
        }
        if (cave) {
          tooltip.update();
          return;
        }
        const w = tipW, h = tipH;
        const left = above ? Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) : Math.min(window.innerWidth - w - 8, x + 14);
        const top = above ? Math.max(8, y - h - 10) : y + 18 + h > window.innerHeight ? y - h - 10 : y + 18;
        placeTooltip(left, top);
      },
      setVisibility: (visibility) => {
        tipVisibility = visibility;
        if (!visibility) tooltip.hide();
      },
      beginFrame: () => {
        tipSpeechTop = Infinity;
        tooltip.update(false);
      },
      update: (place = true) => {
        if (!tipCave) return;
        const state = statusFor(tipCave);
        const healthMax = tipCave.health && tipCave.health.max || BL.crew.HEALTH_MAX;
        const health = tipCave.health ? Math.max(0, Math.min(healthMax, tipCave.health.value)) : healthMax;
        const shownHealth = Math.ceil(health);
        const healthChanged = health !== tipHealth || healthMax !== tipHealthMax;
        if (healthChanged) {
          tipHealth = health; tipHealthMax = healthMax;
          el.tooltipHealthFill.style.transform = `scaleX(${health / healthMax})`;
          el.tooltipHealth.setAttribute("aria-valuemax", String(healthMax));
          el.tooltipHealth.setAttribute("aria-valuenow", String(shownHealth));
        }
        if (state !== tipState || healthChanged) {
          tipState = state;
          el.tooltip.dataset.state = state;
          el.tooltip.setAttribute("aria-label", `${tipText}, ${STATE_LABELS[state]}, ${shownHealth} of ${healthMax} health`);
        }
        el.tooltip.hidden = !tipVisibility.anchor(tipCave, tipScreen);
        if (el.tooltip.hidden || !place) return;
        const top = Math.min(tipScreen.y - 8, tipSpeechTop - 6) - tipH;
        placeTooltip(Math.max(8, Math.min(window.innerWidth - tipW - 8, tipScreen.x - tipW / 2)), Math.max(8, top));
      },
      // The name sits above speech; reserve room for both near the top edge.
      speechSpace: (cave) => cave && cave === tipCave && !el.tooltip.hidden ? tipH + 6 : 0,
      aboveSpeech: (cave, top) => {
        if (cave && cave === tipCave) tipSpeechTop = Math.min(tipSpeechTop, top);
      },
      hide: () => {
        tipCave = null;
        tipSpeechTop = Infinity;
        el.tooltip.hidden = true;
        el.tooltip.classList.remove("tooltip--name");
        el.tooltipHealth.hidden = true;
        delete el.tooltip.dataset.state;
        el.tooltip.removeAttribute("aria-label");
        tipName = false;
        tipText = tipState = "";
        tipHealth = tipHealthMax = -1;
      }
    };
    const hint = (text, ms = 4200) => {
      window.clearTimeout(hintTimer);
      window.clearTimeout(hintHideTimer);
      el.hint.textContent = text;
      el.hint.hidden = false;
      el.messageStack.append(el.hint);
      el.hint.classList.add("show");
      hintTimer = window.setTimeout(() => {
        el.hint.classList.remove("show");
        hintHideTimer = window.setTimeout(() => {
          if (!el.hint.classList.contains("show")) el.hint.hidden = true;
        }, MESSAGE_FADE_MS);
      }, ms);
    };
    // Takes the hint down now: a scene whose state moved on (a race starting) does not leave garage advice up.
    const hideHint = () => {
      window.clearTimeout(hintTimer);
      window.clearTimeout(hintHideTimer);
      el.hint.classList.remove("show");
      hintHideTimer = window.setTimeout(() => {
        if (!el.hint.classList.contains("show")) el.hint.hidden = true;
      }, MESSAGE_FADE_MS);
    };
    const selectedSheetTab = () => el.tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.tab || "roster";
    const setSheetOpen = (open) => {
      el.sheet.dataset.open = String(open);
      writeSheetState(open, selectedSheetTab());
    };
    const selectTab = (name) => {
      for (const t of el.tabs) t.setAttribute("aria-selected", String(t.dataset.tab === name));
      for (const p of el.panels) p.hidden = p.dataset.panel !== name;
      setSheetOpen(true);
    };
    for (const t of el.tabs) {
      on(t, "click", () => {
        const already = t.getAttribute("aria-selected") === "true" && el.sheet.dataset.open === "true";
        if (already && window.matchMedia("(max-width: 720px)").matches) setSheetOpen(false);
        else selectTab(t.dataset.tab);
      });
    }
    // A pull tab opens its own panel, and folds the sheet when that panel is already showing.
    const pull = (name) => {
      const showing = el.sheet.dataset.open === "true" && el.tabs.some((t) => t.dataset.tab === name && t.getAttribute("aria-selected") === "true");
      if (showing) setSheetOpen(false);
      else selectTab(name);
    };
    on(el.sheetToggle, "click", () => pull("roster"));
    on(el.sheetBananas, "click", () => pull("bananas"));
    let presetHandler = null;
    for (const b of el.presets) on(b, "click", () => {
      b.blur();
      presetHandler && presetHandler(b.dataset.preset);
    });
    const onPreset = (fn) => {
      presetHandler = fn;
    };
    let identityHandler = null;
    const onIdentityChange = (fn) => {
      identityHandler = fn;
    };
    const emitIdentity = () => identityHandler && identityHandler({ handle: el.handle.value, message: el.message.value });
    on(el.handle, "change", emitIdentity);
    on(el.message, "change", emitIdentity);
    const setIdentity = ({ handle, message }) => {
      el.handle.value = handle || "";
      el.message.value = message || "";
    };
    const setDonationUrl = (url) => {
      el.qrUrl.textContent = url;
    };
    let assignHandler = null, unassignHandler = null;
    const onAssign = (fn) => {
      assignHandler = fn;
    };
    const onUnassign = (fn) => {
      unassignHandler = fn;
    };
    const iconCache = new Map();
    const iconFor = (item) => {
      let icon = iconCache.get(item.id);
      if (!icon && renderIcon) {
        icon = renderIcon(item);
        iconCache.set(item.id, icon);
      }
      return icon;
    };
    const groupEntries = (entries) => {
      const groups = new Map();
      for (const entry of entries) {
        const item = catalog.find((c) => c.id === entry.itemId);
        if (!item) continue;
        let group = groups.get(item.id);
        if (!group) {
          group = { item, tier: entry.tier, entries: [] };
          groups.set(item.id, group);
        }
        group.entries.push(entry);
      }
      return [...groups.values()].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.item.name.localeCompare(b.item.name));
    };
    const renderInventory = (entries, assignedTo, wornBy = () => null) => {
      el.inventory.replaceChildren();
      el.inventoryEmpty.hidden = entries.length > 0;
      el.lootCount.hidden = entries.length === 0;
      el.lootCount.textContent = String(entries.length);
      for (const group of groupEntries(entries)) {
        const { item } = group;
        const worn = group.entries.map((e) => ({ entry: e, name: assignedTo(e.id) })).filter((w) => w.name);
        const free = group.entries.filter((e) => !assignedTo(e.id));
        const li = document.createElement("li");
        li.className = "loot-row";
        li.style.setProperty("--tier", tierColors[group.tier]);
        const icon = iconFor(item);
        if (icon) {
          const canvas = document.createElement("canvas");
          canvas.className = "loot-icon";
          canvas.width = icon.width;
          canvas.height = icon.height;
          canvas.getContext("2d").drawImage(icon, 0, 0);
          li.append(canvas);
        }
        const main = document.createElement("div");
        main.className = "loot-main";
        const title = document.createElement("div");
        title.className = "loot-title";
        const name = document.createElement("span");
        name.className = "loot-name";
        name.textContent = item.name;
        const badge = document.createElement("span");
        badge.className = "loot-tier";
        badge.textContent = group.tier;
        title.append(name, badge);
        if (group.entries.length > 1) {
          const count = document.createElement("span");
          count.className = "loot-count";
          count.textContent = `×${group.entries.length}`;
          title.append(count);
        }
        main.append(title);
        if (worn.length) {
          const chips = document.createElement("div");
          chips.className = "loot-worn";
          for (const w of worn) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "chip";
            chip.title = `Take ${item.name} off ${BL.characters.displayOf(w.name)}`;
            chip.textContent = BL.characters.displayOf(w.name);
            chip.addEventListener("click", () => unassignHandler && unassignHandler(w.name));
            chips.append(chip);
          }
          main.append(chips);
        }
        li.append(main);
        const select = document.createElement("select");
        select.className = "loot-assign";
        select.setAttribute("aria-label", `Give ${item.name} to a caveman`);
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = free.length ? `Give one to… (${free.length} free)` : "All worn";
        select.append(placeholder);
        select.disabled = free.length === 0;
        for (const contributor of roster) {
          const opt = document.createElement("option");
          opt.value = contributor.name;
          const wearing = wornBy(contributor.name);
          opt.textContent = wearing ? `${contributor.display} · ${wearing}` : `${contributor.display} · no swag`;
          select.append(opt);
        }
        select.addEventListener("change", () => {
          const target = select.value;
          select.value = "";
          select.blur();
          if (target && free.length) assignHandler && assignHandler(free[0].id, target);
        });
        li.append(select);
        el.inventory.append(li);
      }
    };
    // dispose removes only the rows and timers this instance added.
    const dispose = () => {
      finishPrimary(true);
      window.clearTimeout(toastTimer);
      window.clearTimeout(toastHideTimer);
      window.clearTimeout(hintTimer);
      window.clearTimeout(hintHideTimer);
      window.clearTimeout(copyTimer);
      for (const off of listeners) off();
      el.roster.replaceChildren();
      el.inventory.replaceChildren();
      el.toast.classList.remove("show");
      el.toast.hidden = true;
      el.hint.classList.remove("show");
      el.hint.hidden = true;
      tooltip.hide();
      clearModeHold();
      modePointer = -1;
      setOwnOoga(null);
      setGorilla(null);
      setMode(null, false, "detached", false);
      setPrimary(false, false, null);
      primaryGeometry = null;
      el.primaryIcon.width = ICON_PX;
      setWeapon(false, false, 0);
      setMagazine(0, 0, 0, false);
      setJetpack(false, false, 0);
      closeFeed();
      closeRecipe();
      closeBoard(true);
      mainBoard.dispose();
      el.board.classList.remove("board-floating");
      el.board.removeAttribute("style");
    };
    return { el, openFeed, closeFeed, openRecipe, closeRecipe, dismissOutside, openBoard, closeBoard, updateBoard, restoreBoards, setRosterRow, setMeter, setStats, setAct, setMode, setOwnOoga, setGorilla, setGorillaSmashPower, setDetachedView, fadeDetachedName, setAreaLabel, setPrimary, setWeapon, setMagazine, setJetpack, setSubtitle, onAction, toast, tooltip, hint, hideHint, letterSign, selectTab, onPreset, onIdentityChange, setIdentity, setDonationUrl, onAssign, onUnassign, renderInventory, dispose };
  };
  // The account line in the sheet's foot is page-level: shown only when a backend answered, and
  // the director hands every change of `BL.net.state` here, whichever scene is active.
  const ROOM_WORDS = { replaced: "open in another tab", full: "island full" };
  const showAccount = ({ backend, me, room, online }) => {
    $("account").hidden = !backend;
    $("account-name").textContent = me ? me.display : "";
    $("account-name").hidden = !me;
    $("account-login").hidden = !!me;
    $("account-logout").hidden = !me;
    const words = room === "live" ? `${online} online` : ROOM_WORDS[room] || "";
    $("account-room").textContent = words;
    $("account-room").hidden = !me || !words;
    $("account-rejoin").hidden = !me || !ROOM_WORDS[room];
    // Voice: join, then mute and unmute; a failure says why on the button until the next try.
    const voice = BL.voice.stats, voiceButton = $("account-voice");
    voiceButton.hidden = room !== "live";
    voiceButton.textContent = voice.joining ? "Joining voice" : voice.error && !voice.enabled ? `Voice: ${voice.error}` : !voice.enabled ? "Join voice" : voice.muted ? "Unmute" : "Mute";
    voiceButton.setAttribute("aria-pressed", String(voice.enabled && !voice.muted));
  };
  BL.hud = { create, renderIcon, signLettering, showAccount, STATE_LABELS, statusFor };
})();
