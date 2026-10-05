(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { clamp } = BL.math;
  const KEYS = {
    w: "forward", s: "back", a: "left", d: "right", q: "yawLeft", e: "yawRight", r: "pitchDown", f: "pitchUp",
    z: "up", " ": "up", x: "down", arrowup: "forward", arrowdown: "back", arrowleft: "left", arrowright: "right", shift: "sprint"
  };
  const KNOB = 18;
  const keyName = (e) => e.key === "Shift" && (e.code === "ShiftRight" || e.location === 2) ? "peek" : KEYS[e.key.toLowerCase()];
  // Joystick state x/y track the pointer normalized to -1..1.
  const joystick = (el) => {
    const knob = el.firstElementChild;
    const s = { x: 0, y: 0, id: null };
    const onMove = (e) => {
      if (e.pointerId !== s.id) return;
      const r = el.getBoundingClientRect();
      const max = Math.max(1, r.width / 2 - KNOB);
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > max) {
        dx *= max / d;
        dy *= max / d;
      }
      knob.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
      s.x = dx / max;
      s.y = -dy / max;
    };
    const onDown = (e) => {
      if (s.id !== null) return;
      e.preventDefault();
      s.id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add("live");
      onMove(e);
    };
    const onUp = (e) => {
      if (e.pointerId !== s.id) return;
      s.id = null;
      s.x = s.y = 0;
      knob.style.transform = "";
      el.classList.remove("live");
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("lostpointercapture", onUp);
    s.reset = () => onUp({ pointerId: s.id });
    s.dispose = () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("lostpointercapture", onUp);
      onUp({ pointerId: s.id });
    };
    return s;
  };
  // Joystick bases, a hold-to-climb button, a canvas whose mouse chord walks, and a Space handler
  const create = ({ move = null, look = null, boost = null, chord = null, onAction = null, pressActions = false, shooter = () => false, canDescend = () => true } = {}) => {
    const held = { forward: 0, back: 0, left: 0, right: 0, yawLeft: 0, yawRight: 0, pitchDown: 0, pitchUp: 0, up: 0, space: 0, down: 0, boost: 0, chord: 0, sprint: 0, peek: 0 };
    const axes = { x: 0, y: 0, up: 0, yaw: 0, pitch: 0, orbitYaw: 0, sprint: 0, peek: 0, shiftTap: 0 };
    let spaceDown = false, boostPointer = null, boostClick = false, shiftAt = 0, shiftUsed = false, shiftTap = 0;
    const typing = (e) => e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || (e.target.closest && e.target.closest("dialog, #sheet")));
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      const name = pressActions && e.key === " " ? "space" : keyName(e);
      if (!name) return;
      if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault();
      if (name === "peek" && !held.peek) {
        shiftAt = e.timeStamp;
        shiftUsed = !!(held.left || held.right);
      } else if ((name === "left" || name === "right") && held.peek) shiftUsed = true;
      if (pressActions && e.key === " ") {
        if (spaceDown || e.repeat) return;
        spaceDown = true;
        if (onAction && onAction()) return;
      } else if (e.key === " " && !e.repeat && onAction && onAction()) return;
      held[name] = 1;
    };
    const onKeyUp = (e) => {
      const name = pressActions && e.key === " " ? "space" : keyName(e);
      if (name === "peek" && held.peek && !shiftUsed && e.timeStamp - shiftAt <= 300) shiftTap = 1;
      if (name) held[name] = 0;
      if (e.key === " ") spaceDown = false;
    };
    const onBlur = () => {
      for (const name in held) held[name] = 0;
      spaceDown = false;
      boostPointer = null;
      boostClick = false;
      shiftAt = shiftTap = 0;
      shiftUsed = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    const moveStick = move ? joystick(move) : null;
    const lookStick = look ? joystick(look) : null;
    // A pointer press has the same action/thrust priority as Space.
    // Consume its later click so a tap never acts twice or jumps on landing.
    const onBoostDown = (e) => {
      if (!pressActions) { held.boost = 1; return; }
      if (boostPointer !== null) return;
      boostPointer = e.pointerId;
      boostClick = !!onAction;
      held.boost = onAction && onAction() ? 0 : 1;
    };
    const onBoostUp = (e) => {
      if (!pressActions) { held.boost = 0; return; }
      if (e.pointerId !== boostPointer) return;
      boostPointer = null;
      held.boost = 0;
    };
    const onBoostClick = (e) => {
      if (boostClick && e.detail > 0) { e.preventDefault(); e.stopImmediatePropagation(); }
      boostClick = false;
    };
    if (boost) {
      boost.addEventListener("pointerdown", onBoostDown);
      boost.addEventListener("pointerup", onBoostUp);
      boost.addEventListener("pointercancel", onBoostUp);
      boost.addEventListener("pointerleave", onBoostUp);
      if (pressActions) boost.addEventListener("click", onBoostClick, true);
    }
    // Both mouse buttons down means forward (as W); a chorded press arrives as a move event.
    const onChord = (e) => {
      if (e.pointerType === "mouse") held.chord = (e.buttons & 3) === 3 ? 1 : 0;
    };
    if (chord) {
      chord.addEventListener("pointerdown", onChord);
      chord.addEventListener("pointermove", onChord);
      chord.addEventListener("pointerup", onChord);
      chord.addEventListener("pointercancel", onChord);
    }
    // Sign convention: yaw positive is left, pitch positive is down.
    const read = () => {
      axes.x = clamp(held.right - held.left + (moveStick ? moveStick.x : 0), -1, 1);
      axes.y = clamp(held.forward - held.back + (shooter() ? 0 : held.chord) + (moveStick ? moveStick.y : 0), -1, 1);
      axes.up = clamp(held.up + held.space + held.boost - (canDescend() ? held.down : 0), -1, 1);
      // Bird's-eye combat rotates with Q/E while its look stick aims the pointer.
      axes.orbitYaw = held.yawLeft - held.yawRight;
      axes.yaw = clamp((shooter() ? 0 : held.yawLeft - held.yawRight) - (lookStick ? lookStick.x : 0), -1, 1);
      axes.pitch = clamp((shooter() ? 0 : held.pitchDown - held.pitchUp) - (lookStick ? lookStick.y : 0), -1, 1);
      axes.sprint = held.sprint;
      axes.peek = shooter() ? held.peek : 0;
      axes.shiftTap = shiftTap;
      shiftTap = 0;
      return axes;
    };
    const dispose = () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (boost) {
        boost.removeEventListener("pointerdown", onBoostDown);
        boost.removeEventListener("pointerup", onBoostUp);
        boost.removeEventListener("pointercancel", onBoostUp);
        boost.removeEventListener("pointerleave", onBoostUp);
        if (pressActions) boost.removeEventListener("click", onBoostClick, true);
      }
      if (chord) {
        chord.removeEventListener("pointerdown", onChord);
        chord.removeEventListener("pointermove", onChord);
        chord.removeEventListener("pointerup", onChord);
        chord.removeEventListener("pointercancel", onChord);
      }
      if (moveStick) moveStick.dispose();
      if (lookStick) lookStick.dispose();
      onBlur();
    };
    const clearPointer = () => {
      held.chord = held.boost = 0;
      boostPointer = null;
      boostClick = false;
    };
    const reset = () => { onBlur(); if (moveStick) moveStick.reset(); if (lookStick) lookStick.reset(); };
    return { read, axes, clearPointer, reset, dispose, get rightShift() { return !!held.peek; } };
  };
  BL.controls = { create };
})();
