(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { clamp, damp, mat4 } = BL.math;
  const SHOULDER_DISTANCE = 3.8, SHOULDER_SIDE = 1.05, POUND_CHARGE_TIME = 1;
  const THROW_CHARGE_TIME = 1, THROW_MIN_POWER = 1 / 3, THROW_RESULT_TIME = 0.35;
  const PITCH_LIMIT = Math.PI / 2 - 0.0001, ZOOM_PAUSE = 180;
  const create = ({ canvas, camera, renderer, pilot, hud, clankers, input = null, constrainCamera = null,
    reticleTarget = null, sightClear = null, aimCeiling = null, grabOoga = null, releaseOoga = null, birdsEyeMin = 5, maxDistance = 32 }) => {
    const orbit = pilot.orbit, target = { x: 0, y: 0, z: 0 };
    const smashMin = clankers.smashPower(0, true), smashBase = clankers.smashPower(0, false);
    const smashMax = clankers.smashPower(1, false), smashRate = (smashMax - smashBase) / POUND_CHARGE_TIME;
    const command = { x: 0, z: 0, climbAxis: 0, climbSide: 0, heading: NaN, jumpHeld: false, jumpPressed: false, run: false };
    const followOffset = { x: 0, y: 0, z: 0 };
    const previousEye = { x: 0, y: 0, z: 0 };
    const eye = new Float64Array(3), rayView = mat4.create(), cameraUp = { x: 0, y: 1, z: 0 };
    const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    const hit = { node: null, owner: null, x: 0, y: 0, z: 0, distance: 0, type: "object" };
    const reticle = document.getElementById("weapon-reticle");
    let savedNear = camera.near;
    const listeners = [];
    let player = null, view = "orbit", combat = false, disposed = false, jumpKey = false, jumpTap = false, run = false;
    let actPointer = -1, smashPointer = -1, smashFromButton = false, smashCharge = 0, smashCombo = false, smashMeter = smashBase, shownPower = -1, mouseButtons = 0, blockedButtons = 0, shoulder = 0;
    let grabHeld = false, grabActive = false, grabSpent = false;
    let throwPointer = -1, throwFromButton = false, throwCharge = 0, throwMeter = THROW_MIN_POWER, throwResult = 0, shownThrow = false;
    let focused = false, lockPending = false, wasLocked = false, unlockedAt = -Infinity, focusVersion = 0;
    let actMode = -1;
    let handoffBefore = false, holdingFollow = false, pinnedFollow = false, viewChanged = false, moving = false;
    let shoulderSide = SHOULDER_SIDE, peek = 0, orbitPitch = 0.42, overheadHeight = 14, headHidden = null, savedHeadHidden = false;
    let pointerX = 0.5, pointerY = 0.5, targetWait = 0, rightAt = -Infinity, rightDownAt = -Infinity, rightTravel = 0;
    let combatTooltipEntry = null, combatTooltipText = "";
    let zoomAt = -Infinity, zoomDirection = 0, zoomStopped = false, stoppedGesture = null;
    let canvasLeft = 0, canvasTop = 0, canvasWidth = 1, canvasHeight = 1;
    const measureCanvas = () => {
      const r = canvas.getBoundingClientRect();
      canvasLeft = r.left; canvasTop = r.top; canvasWidth = Math.max(1, r.width); canvasHeight = Math.max(1, r.height);
    };
    measureCanvas();
    const isCombat = () => combat;
    const cursor = BL.cursor.create({ canvas, requestLock: () => focusCombat(), unlock: () => blurCombat() });
    const restoreHead = () => {
      if (headHidden) headHidden.cameraHidden = savedHeadHidden;
      headHidden = null;
    };
    const setCombatTooltip = (entry) => {
      if (entry !== combatTooltipEntry) combatTooltipText = entry ? `🦍 ${entry.owner.traits.display}` : "";
      else if (!entry || !hud.el.tooltip.hidden && hud.el.tooltipText.textContent === combatTooltipText) return;
      combatTooltipEntry = entry;
      if (entry) hud.tooltip.show(combatTooltipText, 0, 0, entry, true);
      else hud.tooltip.hide();
    };
    const resetReticle = () => {
      setCombatTooltip(null);
      reticle.hidden = true;
      reticle.dataset.target = reticle.dataset.hit = "none";
      reticle.dataset.ads = reticle.dataset.sight = reticle.dataset.close = reticle.dataset.occluded = "false";
      reticle.style.removeProperty("left"); reticle.style.removeProperty("top"); reticle.style.removeProperty("--reticle-hit");
      reticle.style.setProperty("--reticle-radius", "14px");
      targetWait = 0;
    };
    const syncCursor = () => {
      if (focused && !combat && !grabHeld) {
        measureCanvas();
        if (cursor.active) {
          pointerX = clamp((cursor.x - canvasLeft) / canvasWidth, 0, 1);
          pointerY = clamp((cursor.y - canvasTop) / canvasHeight, 0, 1);
        }
        cursor.start(canvasLeft + pointerX * canvasWidth, canvasTop + pointerY * canvasHeight, true);
      } else cursor.stop();
      document.body.classList.toggle("aim-cursor-focused", focused && combat);
      reticle.hidden = !player || !(combat || grabHeld);
    };
    const setView = (next) => {
      if (next === view) return;
      if (view !== "birds-eye") orbitPitch = orbit.tPitch;
      view = next; viewChanged = true;
      if (view === "first-person") orbit.tDist = 0;
      else if (view === "shoulder") { orbit.tDist = SHOULDER_DISTANCE; orbit.tPitch = orbitPitch; }
      else if (view === "birds-eye") {
        overheadHeight = clamp(Math.max(birdsEyeMin, orbit.dist), birdsEyeMin, maxDistance);
        orbit.tDist = overheadHeight; orbit.tPitch = PITCH_LIMIT;
        pinnedFollow = false;
      } else { orbit.tDist = Math.max(SHOULDER_DISTANCE, orbit.dist); orbit.tPitch = orbitPitch; }
      camera.near = view === "first-person" ? 0.05 : savedNear;
      syncCursor(); hud.setGorilla(player, view, combat);
    };
    const viewRay = () => {
      const size = renderer.size;
      mat4.lookAt(rayView, camera.position, camera.target, camera.up || cameraUp);
      mat4.rayFromView(ray, rayView, size.width, size.height, camera.fov, camera.position,
        size.width * 0.5, size.height * 0.5, camera.orthoMix, camera.orthoHeight);
      if (view === "birds-eye" && aimCeiling && ray.dy < -1e-5) {
        const skip = Math.max(0, (aimCeiling(player) - ray.oy) / ray.dy);
        ray.ox += ray.dx * skip; ray.oy += ray.dy * skip; ray.oz += ray.dz * skip;
      }
    };
    const acceptTarget = (owner) => owner.entry !== player;
    const updateReticle = (dt) => {
      if (!combat && !grabHeld) { setCombatTooltip(null); return; }
      reticle.hidden = false;
      targetWait -= dt;
      if (targetWait > 0) return;
      targetWait = 0.05;
      viewRay();
      let type = "none";
      let tooltipEntry = null;
      if (input && input.weaponTargets.ray(hit, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, 60, null, acceptTarget, true)) {
        const near = Math.max(0, hit.distance - 0.035);
        if (!sightClear || sightClear(ray.ox, ray.oy, ray.oz, ray.ox + ray.dx * near, ray.oy + ray.dy * near, ray.oz + ray.dz * near, hit.node, true)) {
          const kind = hit.owner.kind;
          type = kind === "clanker" || kind === "agent" ? "friendly" : kind === "caveman" ? hit.type
            : kind === "crate" ? "object" : reticleTarget ? reticleTarget(hit) : "none";
          if (combat && kind === "clanker") tooltipEntry = hit.owner.entry;
        }
      }
      setCombatTooltip(tooltipEntry);
      if (reticle.dataset.target !== type) reticle.dataset.target = type;
    };
    const climbHandoff = () => {
      const c = player.climb;
      return c.active && !c.free && (c.handoffDirection || c.autoTo >= 0 || c.progress <= c.lowerGroundDistance + 0.001
        || c.progress >= c.mantleStart - 0.001);
    };
    // Anchor transitions to the displayed view, including an already shortened
    // collision boom. Automatic body motion must not re-orbit the camera.
    const holdCamera = (preserveInput) => {
      const a = camera.target, b = camera.position;
      const yawDelta = preserveInput ? orbit.tYaw - orbit.yaw : 0;
      const pitchDelta = preserveInput ? orbit.tPitch - orbit.pitch : 0;
      const distanceDelta = preserveInput ? orbit.tDist - orbit.dist : 0;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      orbit.yaw = Math.atan2(dx, dz); orbit.tYaw = orbit.yaw + yawDelta;
      orbit.pitch = Math.atan2(dy, Math.hypot(dx, dz)); orbit.tPitch = orbit.pitch + pitchDelta;
      if (view === "first-person") {
        orbit.tx = b.x; orbit.ty = b.y; orbit.tz = b.z;
        orbit.dist = orbit.tDist = 0; shoulder = 0;
        return;
      }
      orbit.dist = Math.max(0.01, Math.hypot(dx, dy, dz)); orbit.tDist = Math.max(0.01, orbit.dist + distanceDelta);
      orbit.tx = a.x - Math.cos(orbit.yaw) * shoulder; orbit.ty = a.y;
      orbit.tz = a.z + Math.sin(orbit.yaw) * shoulder;
    };
    const on = (node, type, callback, options) => {
      node.addEventListener(type, callback, options);
      listeners.push(() => node.removeEventListener(type, callback, options));
    };
    on(window, "resize", measureCanvas);
    const consume = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const typing = (event) => event.target && (event.target.isContentEditable
      || event.target.closest && event.target.closest("input, textarea, select, dialog"));
    const updateSmashGauge = () => {
      const percent = grabHeld ? Math.round(throwMeter * 100) : Math.round(smashMeter * 40);
      if (percent === shownPower && shownThrow === grabHeld) return;
      shownPower = percent;
      shownThrow = grabHeld;
      hud.setGorillaSmashPower(grabHeld ? throwMeter : smashMeter, false, grabHeld);
    };
    // The pilot owns private first-person transitions. Reset those through its
    // public preset API, then restore the displayed camera's exact orbit.
    const rebasePilot = () => {
      target.x = camera.target.x; target.y = camera.target.y; target.z = camera.target.z;
      const dx = camera.position.x - target.x, dy = camera.position.y - target.y, dz = camera.position.z - target.z;
      const distance = Math.max(0.1, Math.hypot(dx, dy, dz));
      const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      pilot.goPreset("pile");
      pilot.cursor.stop();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      pilot.controls.clearPointer();
      orbit.target = target;
      orbit.tx = target.x; orbit.ty = target.y; orbit.tz = target.z;
      orbit.yaw = orbit.tYaw = yaw; orbit.pitch = orbit.tPitch = pitch; orbit.dist = orbit.tDist = distance;
      camera.up = null;
    };
    const cancelInput = () => {
      jumpKey = jumpTap = run = grabHeld = grabSpent = false;
      mouseButtons = 0;
      blockedButtons = 0;
      const pointer = actPointer;
      actPointer = -1;
      if (pointer >= 0 && hud.el.act.hasPointerCapture(pointer)) hud.el.act.releasePointerCapture(pointer);
      const smash = smashPointer;
      const throwing = throwPointer;
      if (grabActive && releaseOoga) releaseOoga(player, false);
      grabActive = false;
      smashPointer = -1; smashFromButton = false; smashCharge = 0; smashCombo = false;
      throwPointer = -1; throwFromButton = false; throwCharge = throwResult = 0; throwMeter = THROW_MIN_POWER;
      smashMeter = Math.min(smashMeter, smashBase);
      if (player) player.motion.poundCharge = 0;
      if (smash >= 0 && hud.el.gorillaSmash.hasPointerCapture(smash)) hud.el.gorillaSmash.releasePointerCapture(smash);
      if (throwing >= 0 && hud.el.gorillaSmash.hasPointerCapture(throwing)) hud.el.gorillaSmash.releasePointerCapture(throwing);
      shownPower = -1;
      updateSmashGauge();
      if (input) input.reset();
      pilot.controls.clearPointer();
      clankers.cancelInput();
      moving = false;
    };
    const blurCombat = () => {
      focused = false; lockPending = false; focusVersion++;
      unlockedAt = performance.now();
      cursor.stop();
      document.body.classList.remove("aim-cursor-focused");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      cancelInput();
    };
    const focusCombat = () => {
      if (!player || disposed) return;
      focused = true;
      document.body.classList.toggle("aim-cursor-focused", combat);
      canvas.focus({ preventScroll: true });
      if (document.pointerLockElement === canvas || lockPending || !canvas.requestPointerLock) return;
      const version = ++focusVersion;
      lockPending = true;
      const failed = () => { if (version === focusVersion) lockPending = false; };
      try {
        const request = canvas.requestPointerLock();
        if (request && request.then) request.then(() => {
          if (version === focusVersion) lockPending = false;
          if ((!player || !focused) && document.pointerLockElement === canvas) document.exitPointerLock();
        }, failed);
      } catch (_) { failed(); }
    };
    const lockChanged = () => {
      if (!player) return;
      const locked = document.pointerLockElement === canvas, lost = wasLocked && !locked;
      wasLocked = locked;
      if (locked) {
        lockPending = false;
        if (!focused) document.exitPointerLock();
      } else if (lost) blurCombat();
    };
    on(document, "pointerlockchange", lockChanged);
    on(document, "pointerlockerror", () => { if (player) lockPending = false; });
    const showAct = () => {
      if (!player) return;
      if (hud.el.act.hidden) hud.el.act.hidden = false;
      const mode = player.climb.active ? 4 : player.fire.rolling ? 3 : player.fire.burning ? 2
        : player.drive.airborne ? player.drive.jumps < 2 ? 1 : 5 : 0;
      if (mode === actMode) return;
      actMode = mode;
      hud.setAct(mode === 5 ? "IN AIR" : mode === 4 ? "JUMP OFF" : mode === 3 ? "ROLLING!" : mode === 2 ? "DROP & ROLL" : mode === 1 ? "DOUBLE JUMP" : "JUMP");
    };
    const beginJump = () => {
      if (player.fire.burning) {
        jumpTap = false;
        clankers.cancelInput();
        clankers.dropRoll();
      } else {
        // Preserve even a down/up pair between simulation frames as one jump.
        jumpTap = true;
      }
      showAct();
    };
    const release = () => {
      if (!player) return false;
      blurCombat();
      restoreHead(); resetReticle();
      clankers.release();
      player = null; combat = false; wasLocked = false;
      holdingFollow = handoffBefore = pinnedFollow = viewChanged = moving = false;
      followOffset.x = followOffset.y = followOffset.z = 0;
      pilot.setExternalControl(false);
      rebasePilot();
      camera.near = savedNear; camera.orthoMix = camera.orthoHeight = 0;
      hud.setGorilla(null);
      hud.el.act.hidden = true;
      return true;
    };
    const possess = (entry, atBoot = false) => {
      if (disposed || !entry || !entry.active || !entry.root.visible) return false;
      if (entry === player) return true;
      if (!player) savedNear = camera.near;
      if (player) { blurCombat(); restoreHead(); }
      if (!clankers.possess(entry)) return false;
      pilot.release(true);
      rebasePilot();
      player = entry;
      smashMeter = smashBase;
      pilot.setExternalControl(true, isCombat);
      combat = true; focused = wasLocked = false;
      view = "shoulder"; shoulder = 0; shoulderSide = SHOULDER_SIDE; peek = 0; actMode = -1;
      pointerX = pointerY = 0.5; rightAt = rightDownAt = zoomAt = -Infinity; zoomStopped = false; stoppedGesture = null;
      resetReticle(); camera.near = savedNear;
      cameraUp.x = cameraUp.z = 0; cameraUp.y = 1;
      measureCanvas();
      holdingFollow = handoffBefore = pinnedFollow = viewChanged = false;
      followOffset.x = followOffset.y = followOffset.z = 0;
      cancelInput();
      const p = player.root.position;
      target.x = orbit.tx = p.x; target.y = orbit.ty = p.y + 1.25; target.z = orbit.tz = p.z;
      orbit.tPitch = clamp(orbit.pitch, -0.25, 1.15);
      orbitPitch = orbit.tPitch;
      orbit.tDist = SHOULDER_DISTANCE;
      if (atBoot) {
        orbit.yaw = orbit.tYaw; orbit.pitch = orbit.tPitch; orbit.dist = orbit.tDist;
        shoulder = SHOULDER_SIDE;
      }
      hud.setGorilla(player, view, combat);
      reticle.hidden = false;
      hud.tooltip.hide();
      showAct();
      // A URL selection has no activating gesture. Its first canvas click
      // focuses combat and requests pointer lock through the ordinary path.
      if (!atBoot) focusCombat();
      return true;
    };
    const action = (name) => {
      if (!player) return false;
      if (name === "gorilla-smash") {
        if (grabHeld) return true;
        if (clankers.smash(0, clankers.quickSmash(player), smashMeter)) {
          smashMeter = smashMin;
          updateSmashGauge();
        }
      } else if (name === "gorilla-beat") clankers.chestBeat();
      else if (name === "mode-release") release();
      else if (name === "mode-toggle") {
        combat = !combat;
        if (!combat) setCombatTooltip(null);
        targetWait = 0;
        cancelInput();
        if (view === "orbit" && combat) setView("birds-eye");
        else if (view === "birds-eye" && !combat) {
          orbitPitch = orbit.pitch;
          setView("orbit");
        }
        focusCombat(); syncCursor();
        hud.setGorilla(player, view, combat);
      } else if (name === "act") beginJump();
      else return false;
      return true;
    };
    const onKeyDown = (event) => {
      if (!player || event.metaKey || event.ctrlKey || event.altKey || typing(event)) return;
      const space = event.code === "Space" || event.key === " " || event.key === "Spacebar";
      const key = event.key.toLowerCase();
      if (space) {
        consume(event);
        if (!jumpKey && !event.repeat) { jumpKey = true; beginJump(); }
      } else if (key === "escape" || key === "tab") {
        consume(event);
        if (focused || document.pointerLockElement === canvas || performance.now() - unlockedAt < 100) blurCombat();
        else if (key === "escape") release();
      }
      else if (key === "shift" && event.code !== "ShiftRight" && event.location !== 2) { run = true; consume(event); }
      else if (key === "g") {
        consume(event);
        if (!grabHeld && !event.repeat) {
          grabHeld = true; grabSpent = false;
          throwCharge = throwResult = 0; throwMeter = THROW_MIN_POWER;
          syncCursor(); updateSmashGauge();
          if (smashPointer < 0) grabActive = !!(grabOoga && grabOoga(player));
        }
      }
      else if (key === "1") {
        consume(event);
        if (!event.repeat) action("gorilla-smash");
      } else if (key === "x") {
        consume(event);
        if (!event.repeat) action("mode-toggle");
      } else if (key === "n") {
        consume(event);
        if (view === "birds-eye") { orbit.tYaw = orbit.yaw + Math.atan2(-Math.sin(orbit.yaw), Math.cos(orbit.yaw)); viewChanged = true; }
      } else if (key === "c") {
        consume(event);
        if (!event.repeat) action("gorilla-beat");
      } else if (key === "v" || key === "j" || key.length === 1 && key >= "3" && key <= "9") consume(event);
    };
    const onKeyUp = (event) => {
      if (!player) return;
      // Shared controls may have seen the press before possession. Let their
      // keyup listener clear it as well; releasing a key triggers no action.
      if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
        jumpKey = false; event.preventDefault();
      }
      else if (event.key === "Shift" && event.code !== "ShiftRight" && event.location !== 2) { run = false; event.preventDefault(); }
      else if (event.key.toLowerCase() === "g") {
        consume(event);
        grabHeld = grabSpent = false;
        const throwing = throwPointer;
        throwPointer = -1; throwFromButton = false; throwCharge = throwResult = 0; throwMeter = THROW_MIN_POWER;
        if (grabActive && releaseOoga) releaseOoga(player, false);
        grabActive = false;
        if (throwing >= 0 && hud.el.gorillaSmash.hasPointerCapture(throwing)) hud.el.gorillaSmash.releasePointerCapture(throwing);
        syncCursor(); updateSmashGauge();
      }
    };
    on(window, "keydown", onKeyDown, true);
    on(window, "keyup", onKeyUp, true);
    const rightPress = () => {
      const now = performance.now();
      if (view === "birds-eye" || view === "orbit") {
        combat = true; setView("shoulder"); focusCombat();
        rightAt = rightDownAt = -Infinity;
      } else {
        if (now - rightAt <= 350) {
          setView(combat ? "birds-eye" : "orbit");
          rightAt = rightDownAt = -Infinity;
        } else { rightDownAt = now; rightTravel = 0; }
      }
    };
    const beginSmash = (event, fromButton) => {
      if (smashPointer >= 0 || throwPointer >= 0) return;
      if (grabHeld) {
        if (grabActive) {
          throwPointer = event.pointerId;
          throwFromButton = fromButton;
          throwCharge = 0; throwMeter = THROW_MIN_POWER; throwResult = 0;
          updateSmashGauge();
          if (fromButton && event.isTrusted) hud.el.gorillaSmash.setPointerCapture(event.pointerId);
        }
        return;
      }
      smashPointer = event.pointerId;
      smashFromButton = fromButton;
      smashCharge = 0;
      smashCombo = clankers.quickSmash(player);
      updateSmashGauge();
      if (fromButton && event.isTrusted) hud.el.gorillaSmash.setPointerCapture(event.pointerId);
    };
    const onDown = (event) => {
      if (!player) return;
      if (event.target === hud.el.act) {
        if (event.button !== 0 || actPointer >= 0) return;
        consume(event);
        actPointer = event.pointerId;
        if (event.isTrusted) hud.el.act.setPointerCapture(event.pointerId);
        beginJump();
      } else if (event.target === hud.el.gorillaSmash || hud.el.gorillaSmash.contains(event.target)) {
        if (event.button !== 0 || smashPointer >= 0) return;
        consume(event);
        beginSmash(event, true);
      } else if (event.target === canvas && event.button === 2 && event.pointerType !== "touch") {
        consume(event); mouseButtons = event.buttons;
        rightPress();
      } else if (event.target === canvas && (combat || grabHeld) && event.pointerType !== "touch") {
        consume(event);
        mouseButtons = event.buttons;
        if (event.button === 0 && grabHeld) { beginSmash(event, false); return; }
        if (!focused) { blockedButtons |= event.buttons; focusCombat(); return; }
        if (event.button === 0 && !(blockedButtons & 1)) beginSmash(event, false);
      }
    };
    const moveView = (dx, dy) => {
      if (!player) return false;
      if (view === "birds-eye") {
        if (dx) { orbit.tYaw -= dx * 0.004; viewChanged = true; }
        return true;
      }
      if (dx || dy) viewChanged = true;
      const direct = view === "shoulder" || view === "first-person";
      orbit.tYaw -= dx * (direct ? 0.0025 : 0.004);
      orbit.tPitch = clamp(orbit.tPitch + dy * (direct ? 0.0025 : 0.0035), -PITCH_LIMIT, PITCH_LIMIT);
      return true;
    };
    const zoom = (factor, gesture = null) => {
      if (!player) return false;
      if (factor === 1) return true;
      const direction = Math.sign(factor - 1), now = performance.now();
      const fresh = direction !== zoomDirection || now - zoomAt > ZOOM_PAUSE || gesture !== null && gesture !== stoppedGesture;
      zoomAt = now; zoomDirection = direction;
      if (fresh) zoomStopped = false;
      if (zoomStopped) return true;
      viewChanged = true;
      let next = view;
      if (view === "first-person" && direction > 0) next = "shoulder";
      else if (view === "shoulder") next = direction < 0 ? "first-person" : combat ? "birds-eye" : "orbit";
      else if (view === "birds-eye") {
        orbit.tDist = overheadHeight = clamp(overheadHeight * factor, birdsEyeMin, maxDistance);
        if (direction < 0 && overheadHeight <= birdsEyeMin) next = "shoulder";
      } else if (view === "orbit") {
        orbit.tDist = clamp(orbit.tDist * factor, SHOULDER_DISTANCE, maxDistance);
        if (direction < 0 && orbit.tDist <= SHOULDER_DISTANCE) { combat = true; next = "shoulder"; }
      }
      if (next !== view) {
        zoomStopped = true; stoppedGesture = gesture;
        setView(next);
      }
      return true;
    };
    const onMove = (event) => {
      if (!player || !combat || !focused || event.target !== canvas || event.pointerType === "touch") return;
      consume(event);
      const pressed = event.buttons & ~mouseButtons & ~blockedButtons;
      if (pressed & 1) beginSmash(event, false);
      if (pressed & 2) rightPress();
      mouseButtons = event.buttons;
      blockedButtons &= event.buttons;
    };
    const onUp = (event) => {
      if (!player) return;
      if (event.button === 2 && event.target === canvas) {
        rightAt = performance.now() - rightDownAt <= 350 && rightTravel <= 8 ? performance.now() : -Infinity;
        rightDownAt = -Infinity;
      }
      if (event.pointerId === actPointer) {
        consume(event);
        actPointer = -1;
        if (hud.el.act.hasPointerCapture(event.pointerId)) hud.el.act.releasePointerCapture(event.pointerId);
        hud.el.act.blur();
      } else if (event.pointerId === throwPointer) {
        consume(event);
        const charge = throwCharge, fromButton = throwFromButton;
        throwPointer = -1; throwFromButton = false; throwCharge = 0;
        if (fromButton) {
          if (hud.el.gorillaSmash.hasPointerCapture(event.pointerId)) hud.el.gorillaSmash.releasePointerCapture(event.pointerId);
          hud.el.gorillaSmash.blur();
        }
        if (grabHeld && grabActive) {
          viewRay();
          releaseOoga(player, true, charge, ray);
          grabActive = false; grabSpent = true;
          throwResult = THROW_RESULT_TIME;
        }
        updateSmashGauge();
      } else if (event.pointerId === smashPointer) {
        consume(event);
        const charge = smashCharge;
        const combo = smashCombo;
        const power = smashMeter;
        const fromButton = smashFromButton;
        smashPointer = -1; smashFromButton = false; smashCharge = 0; smashCombo = false; player.motion.poundCharge = 0;
        if (fromButton) {
          if (hud.el.gorillaSmash.hasPointerCapture(event.pointerId)) hud.el.gorillaSmash.releasePointerCapture(event.pointerId);
          hud.el.gorillaSmash.blur();
        }
        if (!grabHeld && clankers.smash(charge, combo, power)) smashMeter = smashMin;
        else smashMeter = Math.min(smashMeter, smashBase);
        updateSmashGauge();
      } else if (event.target === canvas && combat && event.pointerType !== "touch") {
        consume(event);
        mouseButtons = event.buttons;
        blockedButtons &= event.buttons;
      }
    };
    on(window, "pointerdown", onDown, true);
    on(window, "pointermove", onMove, true);
    on(window, "pointerup", onUp, true);
    on(window, "mousemove", (event) => {
      if (player && Number.isFinite(rightDownAt)) rightTravel += Math.hypot(event.movementX || 0, event.movementY || 0);
      if (player && combat && focused && (event.target === canvas || document.pointerLockElement === canvas)) {
        consume(event);
        moveView(event.movementX || 0, event.movementY || 0);
      }
    }, true);
    const cancelPointer = (event) => {
      if (player && (event.pointerId === actPointer || event.pointerId === smashPointer || event.pointerId === throwPointer
        || event.type === "pointercancel" && combat && event.target === canvas)) {
        consume(event);
        const blocked = blockedButtons | mouseButtons;
        cancelInput();
        blockedButtons = blocked;
      }
    };
    on(window, "pointercancel", cancelPointer, true);
    on(canvas, "lostpointercapture", cancelPointer);
    on(hud.el.act, "lostpointercapture", cancelPointer);
    on(hud.el.gorillaSmash, "lostpointercapture", cancelPointer);
    on(window, "click", (event) => {
      if (player && ((combat || grabHeld) && event.target === canvas || event.target === hud.el.act && event.detail > 0
        || (event.target === hud.el.gorillaSmash || hud.el.gorillaSmash.contains(event.target)) && event.detail > 0)) consume(event);
    }, true);
    on(canvas, "contextmenu", (event) => { if (player) consume(event); }, true);
    on(window, "wheel", (event) => {
      if (!player || event.target !== canvas) return;
      consume(event);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      zoom(Math.exp(clamp(delta * 0.0015, -0.5, 0.5)));
    }, { capture: true, passive: false });
    on(window, "blur", () => { if (player) blurCombat(); });
    on(document, "visibilitychange", () => { if (player && document.hidden) blurCombat(); });
    const readInput = (dt) => {
      if (!player) return;
      handoffBefore = climbHandoff();
      if (grabActive && !player.motion.dragging) grabActive = false;
      if (grabHeld && !grabActive && !grabSpent && smashPointer < 0) grabActive = !!(grabOoga && grabOoga(player));
      if (throwPointer >= 0) {
        throwCharge = Math.min(1, throwCharge + dt / THROW_CHARGE_TIME);
        throwMeter = THROW_MIN_POWER + (1 - THROW_MIN_POWER) * throwCharge;
      } else if (throwResult > 0) throwResult = Math.max(0, throwResult - dt);
      else throwMeter = Math.max(THROW_MIN_POWER, throwMeter - (1 - THROW_MIN_POWER) * dt / THROW_RESULT_TIME);
      if (smashPointer >= 0) {
        smashCharge = Math.min(1, smashCharge + dt / POUND_CHARGE_TIME);
        smashMeter = Math.min(smashMax, smashMeter + smashRate * dt);
        player.motion.poundCharge = smashCharge;
      } else smashMeter = Math.min(smashBase, smashMeter + smashRate * dt);
      updateSmashGauge();
      const axes = pilot.controls.read();
      const shoulderCombat = combat && view === "shoulder";
      if (shoulderCombat && axes.shiftTap) { shoulderSide = -shoulderSide; viewChanged = true; }
      const planted = shoulderCombat && axes.peek && !run;
      peek = damp(peek, planted ? axes.x * 0.34 : 0, 14, dt);
      const moveX = planted ? 0 : axes.x, moveY = planted ? 0 : axes.y;
      const turn = combat ? view === "birds-eye" ? axes.orbitYaw : clamp(axes.yaw + axes.orbitYaw, -1, 1) : axes.yaw;
      if (turn || axes.pitch || planted) viewChanged = true;
      moving = Math.hypot(moveX, moveY) > 0.05;
      orbit.tYaw += turn * 1.7 * dt;
      if (view === "birds-eye") {
        orbit.tYaw += axes.yaw * 1.7 * dt;
        const delta = Math.atan2(Math.sin(orbit.tYaw - orbit.yaw), Math.cos(orbit.tYaw - orbit.yaw));
        orbit.tYaw = orbit.yaw + delta;
        // Match the gorilla's turning rate so it keeps facing the fixed reticle.
        const turnRate = player.drive.climbTurnTimer > 0 && !player.climb.active ? 14 : 7;
        orbit.yaw += clamp(delta, -turnRate * dt, turnRate * dt);
      } else orbit.tPitch = clamp(orbit.tPitch + axes.pitch * 1.1 * dt, -PITCH_LIMIT, PITCH_LIMIT);
      const movementYaw = orbit.yaw;
      const sy = Math.sin(movementYaw), cy = Math.cos(movementYaw);
      command.x = moveX * cy - moveY * sy;
      command.z = -moveX * sy - moveY * cy;
      command.heading = combat || view === "first-person" ? movementYaw + Math.PI : Math.hypot(command.x, command.z) > 0.01 ? Math.atan2(command.x, command.z) : NaN;
      command.climbAxis = axes.y;
      command.climbSide = -axes.x;
      command.jumpHeld = jumpKey || actPointer >= 0 || jumpTap;
      command.jumpPressed = jumpTap;
      moving ||= command.jumpPressed;
      command.run = run;
      clankers.control(command);
      jumpTap = false;
    };
    const update = (dt) => {
      if (!player) return;
      if (clankers.player !== player || !player.active || !player.root.visible) { release(); return; }
      updateSmashGauge();
      const p = player.root.position;
      const first = view === "first-person", overhead = view === "birds-eye";
      const hold = handoffBefore || climbHandoff();
      if (hold && !holdingFollow && !overhead) holdCamera(viewChanged);
      holdingFollow = hold;
      if (hold) pinnedFollow = true;
      else if (moving) pinnedFollow = false;
      const anchored = !overhead && (hold || pinnedFollow);
      target.x = p.x; target.y = p.y + (player.fire.rolling ? 0.7 : 1.25); target.z = p.z;
      if (overhead) {
        // Keep the centered reticle just beyond the front of the walking
        // rectangle, independent of zoom and of a climbing handoff.
        const scale = player.root.scale.x, upright = player.parked || player.biped;
        const ahead = (upright ? 1.015 : 2.2) * scale + 0.18;
        target.x += Math.sin(player.heading) * ahead;
        target.y = p.y + 0.15;
        target.z += Math.cos(player.heading) * ahead;
      }
      if (first || view === "shoulder") {
        const head = player.gorilla.parts.head, bounds = BL.scene.boundsOf(head.geometry);
        BL.scene.updateWorld(player.root, player.root.parent.world);
        if (first) {
          mat4.transformPoint(eye, head.world, bounds.center[0], bounds.min[1] + (bounds.max[1] - bounds.min[1]) * 0.65, bounds.max[2] + 0.01);
          target.x = eye[0]; target.y = eye[1]; target.z = eye[2];
        } else {
          const m = head.world;
          const top = m[1] * bounds.center[0] + m[5] * bounds.center[1] + m[9] * bounds.center[2] + m[13]
            + Math.abs(m[1]) * (bounds.max[0] - bounds.min[0]) * 0.5
            + Math.abs(m[5]) * (bounds.max[1] - bounds.min[1]) * 0.5
            + Math.abs(m[9]) * (bounds.max[2] - bounds.min[2]) * 0.5;
          // Follow the actual stance, from knuckle walking to standing, while
          // keeping the centered aim line above both the head and shoulders.
          target.y = Math.max(top + 0.16,
            Math.max(player.gorilla.parts.armR.world[13], player.gorilla.parts.armL.world[13]) + 0.38);
        }
      }
      if (anchored) {
        followOffset.x = orbit.tx - target.x; followOffset.y = orbit.ty - target.y; followOffset.z = orbit.tz - target.z;
      } else if (moving) {
        // Resume framing during deliberate travel, never by snapping back
        // after the gorilla's automatic mount or dismount ends.
        followOffset.x = damp(followOffset.x, 0, 4, dt);
        followOffset.y = damp(followOffset.y, 0, 4, dt);
        followOffset.z = damp(followOffset.z, 0, 4, dt);
      }
      const looking = viewChanged || Math.abs(orbit.tYaw - orbit.yaw) > 0.00001
        || Math.abs(orbit.tPitch - orbit.pitch) > 0.00001 || Math.abs(orbit.tDist - orbit.dist) > 0.00001;
      if (anchored && !looking) {
        updateReticle(dt); hud.setGorilla(player, view, combat); showAct();
        return;
      }
      if (!overhead) orbit.yaw = damp(orbit.yaw, orbit.tYaw, player.drive.climbTurnTimer > 0 && !player.climb.active ? 28 : 14, dt);
      orbit.pitch = damp(orbit.pitch, orbit.tPitch, 14, dt);
      orbit.dist = damp(orbit.dist, orbit.tDist, 9, dt);
      if (!anchored) {
        orbit.tx = overhead ? target.x : damp(orbit.tx, target.x + followOffset.x, 10, dt);
        orbit.ty = overhead ? target.y : damp(orbit.ty, target.y + followOffset.y, 10, dt);
        orbit.tz = overhead ? target.z : damp(orbit.tz, target.z + followOffset.z, 10, dt);
        shoulder = damp(shoulder, view === "shoulder" ? shoulderSide + peek : 0, 10, dt);
      }
      const sy = Math.sin(orbit.yaw), cy = Math.cos(orbit.yaw), cp = Math.cos(orbit.pitch);
      previousEye.x = camera.position.x; previousEye.y = camera.position.y; previousEye.z = camera.position.z;
      camera.target.x = orbit.tx + cy * shoulder;
      camera.target.y = orbit.ty;
      camera.target.z = orbit.tz - sy * shoulder;
      camera.position.x = camera.target.x + sy * cp * orbit.dist;
      camera.position.y = camera.target.y + Math.sin(orbit.pitch) * orbit.dist;
      camera.position.z = camera.target.z + cy * cp * orbit.dist;
      if (first) {
        camera.target.x = camera.position.x - sy * cp * 4;
        camera.target.y = camera.position.y - Math.sin(orbit.pitch) * 4;
        camera.target.z = camera.position.z - cy * cp * 4;
      }
      camera.orthoMix = damp(camera.orthoMix || 0, overhead ? 1 : 0, 10, dt);
      if (Math.abs(camera.orthoMix - (overhead ? 1 : 0)) < 0.001) camera.orthoMix = overhead ? 1 : 0;
      camera.orthoHeight = Math.max(0.1, orbit.dist * 2 * Math.tan(camera.fov / 2));
      cameraUp.x = -sy * Math.sin(orbit.pitch); cameraUp.y = cp; cameraUp.z = -cy * Math.sin(orbit.pitch);
      camera.up = cameraUp;
      // Shoulder framing keeps its fixed boom through scenery and stone.
      if (constrainCamera && view !== "shoulder") constrainCamera(player, camera, anchored, previousEye, first, overhead);
      if (first && orbit.dist < 0.65 && !headHidden) {
        headHidden = player.gorilla.parts.head; savedHeadHidden = headHidden.cameraHidden; headHidden.cameraHidden = true;
      } else if (!first && headHidden) {
        // Keep the head out of the near plane until the exit dolly clears it.
        BL.scene.updateWorld(player.root, player.root.parent.world);
        const bounds = BL.scene.boundsOf(headHidden.geometry), m = headHidden.world;
        mat4.transformPoint(eye, m, bounds.center[0], bounds.center[1], bounds.center[2]);
        const scale = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
        if (Math.hypot(camera.position.x - eye[0], camera.position.y - eye[1], camera.position.z - eye[2]) > bounds.radius * scale + camera.near) restoreHead();
      }
      if (anchored) {
        // A user-driven look can hit stone during the handoff. Retain the
        // resulting displayed boom instead of expanding it on the next frame.
        holdCamera(true);
        followOffset.x = orbit.tx - target.x; followOffset.y = orbit.ty - target.y; followOffset.z = orbit.tz - target.z;
      }
      viewChanged = false;
      updateReticle(dt);
      hud.setGorilla(player, view, combat);
      showAct();
    };
    const respawn = (dx, dy, dz) => {
      cancelInput();
      holdingFollow = pinnedFollow = handoffBefore = false;
      followOffset.x = followOffset.y = followOffset.z = 0;
      orbit.tx += dx; orbit.ty += dy; orbit.tz += dz;
      camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
      camera.target.x += dx; camera.target.y += dy; camera.target.z += dz;
      viewChanged = true; targetWait = 0;
    };
    const dispose = () => {
      if (disposed) return;
      release(); disposed = true; cursor.dispose();
      for (const off of listeners) off();
    };
    return { possess, release, respawn, readInput, update, action, orbit: moveView, zoom, cancelInput, dispose,
      get active() { return !!player; }, get player() { return player; }, get view() { return view; },
      get birdsEye() { return !!player && view === "birds-eye"; }, get birdsEyeMix() { return player ? camera.orthoMix || 0 : 0; },
      get firstPerson() { return !!player && view === "first-person"; },
      get combat() { return combat; }, get focused() { return focused; } };
  };
  BL.clankerPlay = { create };
})();
