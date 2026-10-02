// Scene-owned gate; no destination scene, networking or character ownership lives here.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {}, S = BL.scene;
  const ACTIVATION_MS = 2000, ACTIVE_MS = 10000, SHUTDOWN_MS = 450;
  const create = ({ radius, outerRadius, position, rotation = { x: 0, y: 0, z: 0 }, destinations = [], receiving = false,
    onMenu = () => {}, onTraverse = null, menuHint = "Choose a destination, then walk through the active gate.", now = () => performance.now(), reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches }) => {
    const model = BL.oogaPortalModels.build(radius, outerRadius);
    Object.assign(model.root.position, position); Object.assign(model.root.rotation, rotation);
    const inverse = BL.math.mat4.create();
    let state = receiving ? "ACTIVE" : "OFF", started = 0, destination = null, disposed = false, crossed = false, opened = false, focus = null, focusFrame = 0, menuOwned = false;
    let selectedIndex = destinations.findIndex(entry => entry.enabled);
    const dialog = document.getElementById("ooga-portal-menu"), list = dialog.querySelector("ol"), closeButton = dialog.querySelector(".modal-close"), status = dialog.querySelector("[role=status]");
    const viewport = window.visualViewport;
    const rows = entries => entries.map((entry, index) => {
      const li = document.createElement("li"), button = document.createElement("button");
      button.type = "button"; button.textContent = `${index + 1}. ${entry.label}`; button.disabled = !entry.enabled;
      button.dataset.destination = String(index); li.appendChild(button); return { li, button };
    });
    let buttons = rows(destinations);
    const fit = () => { if (opened) dialog.style.setProperty("--gate-height", (viewport ? viewport.height : innerHeight) + "px"); };
    const finishClose = () => {
      if (!opened) return;
      opened = false; cancelAnimationFrame(focusFrame); focusFrame = 0; onMenu(false);
      if (focus && focus.isConnected) focus.focus({ preventScroll: true });
      focus = null;
    };
    const close = () => { if (opened && dialog.open) dialog.close(); finishClose(); };
    const update = () => {
      if (disposed) return;
      const clock = now(), elapsed = Math.max(0, clock - started);
      if (!receiving && state !== "OFF") {
        state = elapsed < ACTIVATION_MS ? "ACTIVATING" : elapsed < ACTIVATION_MS + ACTIVE_MS ? "ACTIVE" : elapsed < ACTIVATION_MS + ACTIVE_MS + SHUTDOWN_MS ? "SHUTDOWN" : "OFF";
      }
      const opening = state === "ACTIVATING" ? elapsed / ACTIVATION_MS : 1;
      // Smooth ignition accelerates from a small seed, then settles at the rim.
      const k = state === "ACTIVATING" ? opening * opening * (3 - 2 * opening)
        : state === "SHUTDOWN" ? Math.max(0, 1 - (elapsed - ACTIVATION_MS - ACTIVE_MS) / SHUTDOWN_MS) : state === "ACTIVE" ? 1 : 0;
      model.horizon.visible = k > 0;
      // Reveal a region of the full-size liquid instead of scaling its waves.
      model.horizon.portalReveal = k;
      model.horizon.glow = 0.9;
      model.horizon.portalTime = reducedMotion ? 1.2 : clock * 0.001;
      const burst = state === "ACTIVATING" && !reducedMotion ? Math.sin(Math.PI * opening) ** 2 : 0;
      model.horizon.portalSurge = burst;
      // A rolling lip surrounds the forming funnel, collapsing into the membrane.
      model.kawoosh.visible = burst > 0.01;
      model.kawoosh.scale.x = model.kawoosh.scale.z = radius * Math.max(0.001, k);
      model.kawoosh.scale.y = burst * Math.min(radius * 0.6, 2.4);
      model.kawoosh.position.y = model.surfaceY - burst * 0.32 * (1 - k * k) ** 2;
      model.kawoosh.glow = 0.4 + burst * 1.2;
    };
    const select = index => {
      const entry = destinations[index];
      if (receiving || disposed || !entry || !entry.enabled) return false;
      selectedIndex = index; destination = entry.id; return true;
    };
    const activate = (index = selectedIndex) => {
      update();
      const entry = destinations[index];
      if (receiving || disposed || state !== "OFF" || !entry || !entry.enabled) return false;
      select(index); started = now(); crossed = false; state = "ACTIVATING"; update(); return true;
    };
    const choose = event => {
      const button = event.target.closest("button[data-destination]");
      if (!button || button.disabled || !opened) return;
      if (activate(Number(button.dataset.destination))) close();
      else status.textContent = "The Ooga Portal is already cycling. Wait for it to close.";
    };
    const cancel = event => { event.preventDefault(); close(); };
    const key = event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } };
    const focusDialog = event => {
      // A touch that opened the modal may end over its backdrop/container.
      if (opened && event.target === dialog) (buttons.find(row => !row.button.disabled)?.button || closeButton).focus({ preventScroll: true });
    };
    const closed = () => { if (!dialog.open) finishClose(); };
    const open = () => {
      if (!menuOwned || receiving || disposed || opened || dialog.open) return false;
      focus = document.activeElement; opened = true;
      list.replaceChildren(...buttons.map(row => row.li)); status.textContent = menuHint;
      onMenu(true); dialog.showModal(); fit();
      const first = buttons.find(row => !row.button.disabled)?.button || closeButton;
      first.focus({ preventScroll: true });
      // Touch action opens on pointerdown, before the browser's default focus step.
      focusFrame = requestAnimationFrame(() => { focusFrame = 0; if (opened) first.focus({ preventScroll: true }); });
      return true;
    };
    // Signed local +Y -> -Y is front entry; receiving scenes explicitly choose the back.
    const traverse = (from, to, bodyRadius = 0, direction = 1) => {
      update();
      if (!onTraverse || state !== "ACTIVE" || crossed || disposed || !Number.isFinite(bodyRadius) || bodyRadius < 0 || bodyRadius >= radius || (direction !== 1 && direction !== -1)) return false;
      S.updateWorld(model.root, model.root.parent ? model.root.parent.world : undefined); BL.math.mat4.invert(inverse, model.root.world);
      const ay = inverse[1] * from.x + inverse[5] * from.y + inverse[9] * from.z + inverse[13] - model.surfaceY;
      const by = inverse[1] * to.x + inverse[5] * to.y + inverse[9] * to.z + inverse[13] - model.surfaceY;
      if (!(ay * direction > 0 && by * direction <= 0)) return false;
      const t = ay / (ay - by), x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      const lx = inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12], lz = inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14];
      if (!Number.isFinite(lx + lz) || Math.hypot(lx, lz) > radius - bodyRadius) return false;
      crossed = true; onTraverse(destination); return true;
    };
    const enableDialer = entries => {
      if (disposed) return;
      destinations = entries; buttons = rows(entries);
      selectedIndex = entries.findIndex(entry => entry.id === destination && entry.enabled);
      if (selectedIndex < 0) selectedIndex = entries.findIndex(entry => entry.enabled);
      if (menuOwned) return;
      menuOwned = true;
      dialog.addEventListener("click", choose); closeButton.addEventListener("click", close); dialog.addEventListener("cancel", cancel); dialog.addEventListener("close", closed); dialog.addEventListener("keydown", key); dialog.addEventListener("focusin", focusDialog);
      window.addEventListener("resize", fit); if (viewport) viewport.addEventListener("resize", fit);
    };
    if (!receiving) enableDialer(destinations);
    // The receiving host owns arrival duration; no outbound dial deadline runs here.
    const receive = () => { if (disposed) return; close(); receiving = true; state = "ACTIVE"; started = now(); crossed = false; update(); };
    const finishReceiving = (animate = false) => {
      if (!receiving || disposed) return;
      receiving = false; state = animate ? "SHUTDOWN" : "OFF";
      started = now() - ACTIVATION_MS - ACTIVE_MS; update();
    };
    const dispose = () => {
      if (disposed) return;
      close(); disposed = true; state = "OFF";
      dialog.removeEventListener("click", choose); closeButton.removeEventListener("click", close); dialog.removeEventListener("cancel", cancel); dialog.removeEventListener("close", closed); dialog.removeEventListener("keydown", key); dialog.removeEventListener("focusin", focusDialog);
      window.removeEventListener("resize", fit); if (viewport) viewport.removeEventListener("resize", fit);
      if (menuOwned) list.replaceChildren(); model.horizon.visible = model.kawoosh.visible = false;
      for (const node of model.ripples) node.visible = false;
      for (const node of [model.root, model.dialer]) if (node.parent) S.removeChild(node.parent, node);
    };
    return { ...model, radius, outerRadius, open, close, activate, update, traverse, enableDialer, receive, finishReceiving, dispose, reducedMotion,
      get receiving() { return receiving; }, get state() { return state; }, get isOpen() { return opened; }, get disposed() { return disposed; } };
  };
  BL.oogaPortal = { create, ACTIVATION_MS, ACTIVE_MS, SHUTDOWN_MS };
})();
