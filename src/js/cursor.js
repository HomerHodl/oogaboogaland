// The virtual cursor shares pointer lock and real picking across carry and overhead views.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const BUTTON_MASK = [1, 4, 2];
  const INTERACTIVE = "button, a, input, select, textarea, [role='button']";
  const create = ({ canvas, requestLock, unlock }) => {
    const element = document.getElementById("carry-cursor"), reticle = document.getElementById("weapon-reticle");
    const pressed = [null, null, null];
    let active = false, visible = true, dispatching = false, x = window.innerWidth / 2, y = window.innerHeight / 2;
    let canvasLeft = 0, canvasTop = 0, canvasWidth = 1, canvasHeight = 1;
    let pointerId = 1, buttons = 0, blockedButtons = 0, suppressClick = false;
    let captured = null, hovered = null, hoverButton = null, pendingMove = null;
    let aimAnimation = null, reticleAnimation = null, aimProgress = 0, aimBase = 0, visualBase = 0;
    let aimFromX = 0, aimFromY = 0, aimToX = 0, aimToY = 0;
    const locked = () => document.pointerLockElement === canvas;
    const hitAtCursor = () => document.elementFromPoint(x, y) || canvas;
    const targetAtCursor = () => {
      const hit = hitAtCursor();
      return hit.closest(INTERACTIVE) || hit;
    };
    const measureCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvasLeft = rect.left; canvasTop = rect.top;
      canvasWidth = rect.width || 1; canvasHeight = rect.height || 1;
      return rect;
    };
    const setHoverButton = (button) => {
      if (button === hoverButton) return;
      if (hoverButton) hoverButton.classList.remove("virtual-hover");
      hoverButton = button;
      if (hoverButton && !hoverButton.matches(":disabled")) hoverButton.classList.add("virtual-hover");
    };
    const dispatch = (target, event) => {
      const previous = dispatching;
      dispatching = true;
      try { return target.dispatchEvent(event); }
      finally { dispatching = previous; }
    };
    const pointer = (target, type, e, button = e.button, held = e.buttons & ~blockedButtons) => dispatch(target, new PointerEvent(type, {
      bubbles: type !== "pointerleave" && type !== "pointerenter", cancelable: true,
      pointerType: "mouse", pointerId, isPrimary: true,
      clientX: x, clientY: y, button, buttons: held,
      movementX: e.movementX || 0, movementY: e.movementY || 0,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
    }));
    const mouse = (target, type, e, button = e.button, held = e.buttons & ~blockedButtons) => dispatch(target, new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, detail: type === "click" ? 1 : 0,
      clientX: x, clientY: y, button, buttons: held,
      movementX: e.movementX || 0, movementY: e.movementY || 0,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
    }));
    const paint = () => {
      x = Math.max(0, Math.min(window.innerWidth - 1, x));
      y = Math.max(0, Math.min(window.innerHeight - 1, y));
      element.style.transform = `translate(${x}px, ${y}px)`;
    };
    const animateAimArrow = () => {
      const opacity = Math.min(1, (1 - aimProgress) / 0.3);
      aimAnimation = element.animate([
        { transform: `translate(${aimFromX}px, ${aimFromY}px)`, opacity, offset: 0 },
        { opacity, offset: Math.max(0, (0.7 - aimProgress) / (1 - aimProgress)) },
        { transform: `translate(${aimToX}px, ${aimToY}px)`, opacity: 0, offset: 1 }
      ], { duration: 1000, fill: "both" });
      aimAnimation.pause();
      aimAnimation.currentTime = 0;
    };
    const endAim = () => {
      if (!aimAnimation) return;
      if (!active) {
        element.hidden = true;
        document.body.classList.remove("carry-cursor-active");
      }
      aimAnimation.cancel(); reticleAnimation.cancel();
      aimAnimation = reticleAnimation = null;
    };
    const beginAim = (clientX, clientY) => {
      endAim();
      const rect = measureCanvas();
      x = aimFromX = clientX; y = aimFromY = clientY;
      aimToX = rect.left + rect.width / 2; aimToY = rect.top + rect.height / 2;
      aimProgress = aimBase = visualBase = 0;
      element.style.transform = `translate(${x}px, ${y}px)`;
      element.hidden = false;
      document.body.classList.add("carry-cursor-active");
      animateAimArrow();
      reticleAnimation = reticle.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1, offset: 1 }], { duration: 1000, fill: "both" });
      reticleAnimation.pause();
      reticleAnimation.currentTime = 0;
    };
    const updateAim = (progress) => {
      if (!aimAnimation) return;
      aimProgress = aimBase + (1 - aimBase) * Math.max(0, Math.min(1, progress));
      if (aimProgress >= 1) {
        x = aimToX; y = aimToY;
        endAim();
        return;
      }
      const local = (aimProgress - visualBase) / (1 - visualBase);
      x = aimFromX + (aimToX - aimFromX) * local;
      y = aimFromY + (aimToY - aimFromY) * local;
      // The camera owns time. Only numeric animation clocks change per frame;
      // pointer events and the fixed reticle position are untouched.
      aimAnimation.currentTime = local * 1000;
      reticleAnimation.currentTime = aimProgress * 1000;
    };
    const rebaseAim = () => { if (aimAnimation) aimBase = aimProgress; };
    const hover = (e) => {
      const target = targetAtCursor(), button = target.closest(INTERACTIVE);
      setHoverButton(button);
      if (target !== hovered) {
        if (hovered) pointer(hovered, "pointerleave", e, -1);
        hovered = target;
        pointer(target, "pointerenter", e, -1);
      }
      return target;
    };
    const clearPresses = () => {
      const target = captured;
      captured = null;
      pressed[0] = pressed[1] = pressed[2] = null;
      pendingMove = null;
      if (target) pointer(target, "pointercancel", { button: -1, buttons: 0 }, -1, 0);
      // Clear the canvas's two-button walk even if its press began in aim.
      if (target !== canvas) pointer(canvas, "pointercancel", { button: -1, buttons: 0 }, -1, 0);
    };
    const stop = () => {
      endAim();
      if (!active) return;
      active = false;
      clearPresses();
      if (hovered) pointer(hovered, "pointerleave", { button: -1, buttons: 0 }, -1, 0);
      hovered = null;
      setHoverButton(null);
      element.hidden = true;
      document.body.classList.remove("carry-cursor-active");
    };
    const start = (clientX = null, clientY = null, show = true) => {
      endAim();
      if (active) clearPresses();
      const rect = measureCanvas();
      x = clientX ?? rect.left + rect.width / 2; y = clientY ?? rect.top + rect.height / 2;
      active = true;
      visible = show;
      blockedButtons = buttons;
      suppressClick = true;
      element.hidden = !visible;
      document.body.classList.add("carry-cursor-active");
      paint();
      clearPresses();
      if (locked()) {
        const e = { button: -1, buttons: 0 };
        pointer(hover(e), "pointermove", e, -1, 0);
      } else requestLock();
    };
    const placeCanvas = (localX, localY, width, height) => {
      x = canvasLeft + localX * canvasWidth / Math.max(1, width);
      y = canvasTop + localY * canvasHeight / Math.max(1, height);
      paint();
      if (active) setHoverButton(targetAtCursor().closest(INTERACTIVE));
    };
    const nativeControl = (target) => target.matches("input, select, textarea") || !!target.closest("dialog:modal");
    const focusNative = (target) => {
      stop(); unlock();
      target.focus({ preventScroll: true });
      if (target.tagName === "SELECT" && target.showPicker && navigator.userActivation.isActive) target.showPicker();
    };
    const routePointer = (e) => {
      const held = e.buttons & ~blockedButtons, button = e.button, mask = BUTTON_MASK[button] || 0;
      const changed = button >= 0 && button < pressed.length;
      const down = changed && (e.type === "pointerdown" || e.type === "pointermove" && (held & mask));
      const up = changed && (e.type === "pointerup" || e.type === "pointermove" && !(held & mask));
      if (mask & blockedButtons) return;
      const under = hover(e), target = captured || under;
      if (down) {
        if (target.matches(":disabled")) return;
        suppressClick = true;
        if (nativeControl(target)) {
          focusNative(target);
          mouse(target, "click", e, button, 0);
          return;
        }
        captured = target;
        pressed[button] = target;
      }
      if (e.type === "pointercancel") {
        clearPresses();
        return;
      }
      // An up from the old shooting hold has no matching carry press.
      if (up && !pressed[button]) return;
      pointer(target, e.type, e, button, held);
      if (!active) return;
      if (up) {
        const original = pressed[button];
        pressed[button] = null;
        if (!held) captured = null;
        if (button === 0 && original && (original === under || original.contains(under))) {
          mouse(original, "click", e, 0, held);
          // Modal fields need the native cursor and ordinary text input.
          if (active && document.querySelector("dialog:modal")) { stop(); unlock(); }
        }
      }
    };
    const onPointer = (e) => {
      if (dispatching || e.pointerType !== "mouse") return;
      pointerId = e.pointerId;
      buttons = e.type === "pointercancel" ? 0 : e.buttons;
      if (!active) {
        if (!locked()) { x = e.clientX; y = e.clientY; }
        if (e.type === "pointerdown") suppressClick = false;
        return;
      }
      // Pointer lock may swallow the release of the right press that changed
      // views. A new right down proves that hold ended; route this new click.
      if (e.type === "pointerdown" && e.button === 2) blockedButtons &= ~BUTTON_MASK[2];
      blockedButtons &= buttons;
      if (!locked()) {
        if (e.target !== canvas) {
          // A denied lock never creates an offset native cursor. HUD controls
          // remain usable; a canvas press only retries capture.
          if (e.type === "pointerdown") { stop(); unlock(); suppressClick = false; }
          return;
        }
        // Right-click changes the pilot's view even before pointer lock has
        // settled. Let its press and release reach the canvas in that case.
        if (e.button === 2) {
          if (e.type === "pointerdown") requestLock();
          return;
        }
        e.stopImmediatePropagation();
        if (e.type === "pointerdown") {
          blockedButtons |= buttons;
          suppressClick = true;
          requestLock();
        }
        return;
      }
      // Do not cancel native pointerdown's default: that would suppress the
      // compatibility mousemove stream used for relative motion.
      e.stopImmediatePropagation();
      if (e.type === "pointermove" && e.button < 0) { pendingMove = e; return; }
      routePointer(e);
    };
    const onMouseMove = (e) => {
      if (dispatching || !active || !locked() || e.sourceCapabilities?.firesTouchEvents) return;
      e.stopImmediatePropagation();
      x += e.movementX; y += e.movementY;
      paint();
      const source = pendingMove || e;
      pendingMove = null;
      const target = captured || hover(e);
      pointer(target, "pointermove", source, -1, buttons & ~blockedButtons);
      if (active) mouse(target, "mousemove", e, -1, buttons & ~blockedButtons);
    };
    const onMouseButton = (e) => {
      if (dispatching || e.pointerType && e.pointerType !== "mouse" || e.sourceCapabilities?.firesTouchEvents || e.type === "click" && e.detail === 0) return;
      if (suppressClick && (e.type === "click" || !active && (e.type === "mousedown" || e.type === "mouseup"))) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.type === "click") suppressClick = false;
        return;
      }
      if (!active || !locked()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      // Pointer events own press/release/click routing; native compatibility
      // events still target the canvas and must not activate anything twice.
    };
    const scrollPanel = (target, e) => {
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const dx = e.deltaX * scale, dy = e.deltaY * scale;
      for (let node = target; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        const vertical = /auto|scroll/.test(style.overflowY) && (dy < 0 ? node.scrollTop > 0 : dy > 0 && node.scrollTop + node.clientHeight < node.scrollHeight);
        const horizontal = /auto|scroll/.test(style.overflowX) && (dx < 0 ? node.scrollLeft > 0 : dx > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth);
        if (vertical || horizontal) {
          if (vertical) node.scrollTop += dy;
          if (horizontal) node.scrollLeft += dx;
          return;
        }
      }
    };
    const onWheel = (e) => {
      if (dispatching || !active || !locked()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const target = hitAtCursor();
      const wheel = new WheelEvent("wheel", {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
      });
      // A synthetic event must remain part of the original wheel gesture,
      // including its pause/reversal boundary and remaining momentum.
      Object.defineProperty(wheel, "timeStamp", { value: e.timeStamp });
      const allowed = dispatch(target, wheel);
      if (active && allowed && target !== canvas) { scrollPanel(target, e); hover(e); }
    };
    const onResize = () => {
      measureCanvas();
      if (active) paint();
      else if (aimAnimation) {
        // Keep the displayed pixel when the viewport changes, then finish the
        // remaining glide toward its new center without replaying old motion.
        const point = element.getBoundingClientRect(), rect = canvas.getBoundingClientRect();
        x = aimFromX = point.left; y = aimFromY = point.top;
        aimToX = rect.left + rect.width / 2; aimToY = rect.top + rect.height / 2;
        visualBase = aimProgress;
        aimAnimation.cancel();
        animateAimArrow();
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("pointermove", onPointer, true);
    window.addEventListener("pointerup", onPointer, true);
    window.addEventListener("pointercancel", onPointer, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mousedown", onMouseButton, true);
    window.addEventListener("mouseup", onMouseButton, true);
    window.addEventListener("click", onMouseButton, true);
    window.addEventListener("contextmenu", onMouseButton, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("resize", onResize);
    const dispose = () => {
      stop();
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("pointerup", onPointer, true);
      window.removeEventListener("pointercancel", onPointer, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mousedown", onMouseButton, true);
      window.removeEventListener("mouseup", onMouseButton, true);
      window.removeEventListener("click", onMouseButton, true);
      window.removeEventListener("contextmenu", onMouseButton, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("resize", onResize);
    };
    return { start, stop, placeCanvas, beginAim, updateAim, rebaseAim, endAim, dispose, element,
      get active() { return active; }, get visible() { return visible; }, get x() { return x; }, get y() { return y; } };
  };
  BL.cursor = { create };
})();
