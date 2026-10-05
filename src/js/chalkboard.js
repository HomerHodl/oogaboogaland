// The EntropyLab chalkboard keeps one bounded list of marks for its close-up and its world-space writing.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const KEY = "ooga-chalkboard-v2", OLD_KEY = "ooga-chalkboard-v1", MAX_STROKES = 550, MAX_POINTS = 10000;
  const W = 800, H = 500, BOARD_W = 1.5, BOARD_H = 0.875, BOARD_FACE_Z = -1 / 16 + 0.002;
  const GRID_W = 160, GRID_H = 100, WASH_MS = 650, DRAW_MS = 700, WASH_BANDS = 6, WORLD_UPDATE_MS = 100;
  const TEXT_FONT = "58.125px 'Bradley Hand', 'Marker Felt', cursive", TEXT_SIZE = 60, TEXT_LINE = 84.375, TEXT_MARGIN = 32;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const initial = () => {
    const marks = [];
    for (const [row, text] of ["01101010110", "11111101101"].entries()) {
      for (let i = 0; i < text.length; i++) {
        const x = 0.5 + (i - (text.length - 1) / 2) * 0.075, y = 0.39 + row * 0.22, size = 1.75;
        const wobble = Math.sin(i * 8.1 + row * 3.2) * 0.003 * size;
        if (text[i] === "0") marks.push({ t: "c", p: [x - 0.011 * size, y - 0.041 * size, x + wobble, y - 0.047 * size,
          x + 0.014 * size, y - 0.027 * size, x + 0.016 * size, y + 0.021 * size, x + 0.008 * size, y + 0.046 * size,
          x - 0.011 * size, y + 0.04 * size, x - 0.016 * size, y + 0.009 * size, x - 0.011 * size, y - 0.041 * size] });
        else marks.push({ t: "c", p: [x - 0.014 * size, y - 0.022 * size, x, y - 0.045 * size,
          x + 0.004 * size + wobble, y + 0.043 * size, x - 0.013 * size, y + 0.045 * size, x + 0.018 * size, y + 0.042 * size] });
      }
    }
    return marks;
  };
  const read = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved) || saved.length > MAX_STROKES) return null;
      let points = 0;
      return saved.filter((mark) => {
        if (!mark || !Array.isArray(mark.p)) return false;
        if (mark.t === "t") {
          if (typeof mark.ch !== "string" || Array.from(mark.ch).length !== 1 || /[\x00-\x1f\x7f]/.test(mark.ch) || mark.p.length !== 2) return false;
        } else if ((mark.t !== "c" && mark.t !== "e") || (mark.s !== undefined && mark.s !== 2 && mark.s !== 4)
          || mark.p.length < 2 || mark.p.length % 2 || mark.p.length > 2000) return false;
        points += mark.p.length / 2;
        return points <= MAX_POINTS && mark.p.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
      });
    } catch (_) { return null; }
  };
  const write = (marks) => {
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (_) { /* Storage may be unavailable. */ }
  };
  const quad = (geo, x0, y0, x1, y1, z, color) => {
    const start = geo.verts.length / 3;
    geo.verts.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    geo.faces.push({ i: [start, start + 1, start + 2, start + 3], color, emissive: 0.35 });
  };
  const geometryFor = (ctx) => {
    // Sample the finished popup image, including translucent dust and erasures, so the world board matches it.
    const pixels = ctx.getImageData(0, 0, W, H).data;
    const geo = { verts: [], faces: [], lines: [], castShadow: false };
    const tileW = W / GRID_W, tileH = H / GRID_H;
    const colors = new Map(), pad = 0.006, left = -BOARD_W / 2 + pad, top = 0.75 + BOARD_H - pad;
    const stepX = (BOARD_W - pad * 2) / GRID_W, stepY = (BOARD_H - pad * 2) / GRID_H;
    for (let row = 0; row < GRID_H; row++) {
      let runColor = -1, runStart = 0;
      for (let col = 0; col <= GRID_W; col++) {
        let key = -1;
        if (col < GRID_W) {
          let red = 0, green = 0, blue = 0, bright = 0;
          for (let dy = 0; dy < tileH; dy++) for (let dx = 0; dx < tileW; dx++) {
            const at = ((row * tileH + dy) * W + col * tileW + dx) * 4;
            red += pixels[at]; green += pixels[at + 1]; blue += pixels[at + 2];
            bright = Math.max(bright, pixels[at], pixels[at + 1], pixels[at + 2]);
          }
          const count = tileW * tileH;
          const gain = bright > 170 ? 1.55 : 1;
          const r = Math.min(255, Math.round(red / count * gain / 8) * 8);
          const g = Math.min(255, Math.round(green / count * gain / 8) * 8);
          const b = Math.min(255, Math.round(blue / count * gain / 8) * 8);
          key = (r << 16) | (g << 8) | b;
        }
        if (key === runColor) continue;
        if (runColor >= 0) {
          let color = colors.get(runColor);
          if (!color) { color = [runColor >> 16 & 255, runColor >> 8 & 255, runColor & 255]; colors.set(runColor, color); }
          quad(geo, left + runStart * stepX, top - (row + 1) * stepY,
            left + col * stepX, top - row * stepY, BOARD_FACE_Z, color);
        }
        runColor = key;
        runStart = col;
      }
    }
    return geo;
  };
  const create = ({ renderer, onOpen, onClose }) => {
    const dialog = document.getElementById("chalk-modal"), frame = document.getElementById("chalk-frame");
    const canvas = document.getElementById("chalk-canvas"), ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    const pointer = document.getElementById("chalk-pointer"), caret = document.getElementById("chalk-caret"), typeInput = document.getElementById("chalk-type-input"), hint = document.getElementById("chalk-hint");
    const eraser = document.getElementById("chalk-eraser"), chalk = document.getElementById("chalk-chalk");
    const keyboard = document.getElementById("chalk-keyboard"), clean = document.getElementById("chalk-clean"), reset = document.getElementById("chalk-reset");
    const closeButton = document.getElementById("chalk-close");
    const listeners = new AbortController();
    const startingMarks = initial(), saved = read(KEY), legacy = saved === null ? read(OLD_KEY) : null;
    const marks = saved !== null ? saved : legacy !== null ? startingMarks.concat(legacy) : startingMarks.slice();
    const startingSegments = startingMarks.reduce((n, mark) => n + mark.p.length / 2 - 1, 0);
    let node = null, tool = null, stroke = null, pointCount = marks.reduce((n, mark) => n + mark.p.length / 2, 0);
    let changed = false, activePointer = -1, animation = null, liveTimer = 0, worldDirty = false;
    let cursorX = TEXT_MARGIN, cursorY = TEXT_MARGIN + TEXT_SIZE, textStartX = TEXT_MARGIN;
    const typeHistory = [];
    const coords = (e) => {
      const r = canvas.getBoundingClientRect();
      return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
    };
    const paintSegment = (mark, i) => {
      const p = mark.p, size = mark.s || 1;
      ctx.lineCap = mark.t === "e" ? "butt" : "round";
      ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(p[i - 2] * W, p[i - 1] * H); ctx.lineTo(p[i] * W, p[i + 1] * H);
      if (mark.t === "e") {
        ctx.lineWidth = 48 * size; ctx.strokeStyle = "rgba(27,65,52,0.9)"; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p[i - 2] * W + 3 * size, p[i - 1] * H + 2 * size); ctx.lineTo(p[i] * W + 3 * size, p[i + 1] * H + 2 * size);
        ctx.lineWidth = 32 * size; ctx.strokeStyle = "rgba(177,196,167,0.11)"; ctx.stroke();
      } else {
        ctx.lineWidth = 5.2 * size; ctx.strokeStyle = "rgba(237,244,220,0.88)"; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p[i - 2] * W + 1.2 * size, p[i - 1] * H + size); ctx.lineTo(p[i] * W + 1.2 * size, p[i + 1] * H + size);
        ctx.lineWidth = 2 * size; ctx.strokeStyle = "rgba(217,228,204,0.36)"; ctx.stroke();
      }
    };
    const paintText = (mark) => {
      const x = mark.p[0] * W, y = mark.p[1] * H;
      ctx.font = TEXT_FONT;
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = "rgba(214,229,203,0.55)";
      ctx.strokeText(mark.ch, x, y);
      ctx.fillStyle = "rgba(239,244,220,0.82)";
      ctx.fillText(mark.ch, x, y);
    };
    const paintBase = () => {
      ctx.fillStyle = "#1b4034"; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 900; i++) {
        const x = (i * 1973 % 797), y = (i * 839 % 499);
        ctx.fillStyle = i % 3 ? "#325549" : "#15392f";
        ctx.fillRect(x, y, 1 + i % 2, 1);
      }
    };
    const paint = () => {
      paintBase();
      for (const mark of marks) {
        if (mark.t === "t") paintText(mark);
        else for (let i = 2; i < mark.p.length; i += 2) paintSegment(mark, i);
      }
    };
    const syncWorld = () => {
      liveTimer = 0;
      if (!worldDirty || !node) return;
      const old = node.geometry;
      node.geometry = geometryFor(ctx);
      renderer.releaseGeometry(old);
      worldDirty = false;
    };
    const markWorld = () => {
      worldDirty = true;
      if (!liveTimer) liveTimer = setTimeout(syncWorld, WORLD_UPDATE_MS);
    };
    const flushWorld = () => {
      if (liveTimer) clearTimeout(liveTimer);
      syncWorld();
    };
    const placeCaret = () => {
      caret.style.left = `${cursorX / W * 100}%`;
      caret.style.top = `${(cursorY - TEXT_SIZE) / H * 100}%`;
    };
    const newTextLine = () => {
      if (cursorY + TEXT_LINE > H - TEXT_MARGIN) { hint.textContent = "Bottom of board reached"; return false; }
      cursorX = textStartX;
      cursorY += TEXT_LINE;
      placeCaret();
      return true;
    };
    const typeText = (value) => {
      for (const ch of value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
        if (ch === "\n") {
          const x = cursorX, y = cursorY;
          if (!newTextLine()) break;
          typeHistory.push({ x, y, mark: null });
          continue;
        }
        if (/[\x00-\x1f\x7f]/.test(ch)) continue;
        if (marks.length >= MAX_STROKES || pointCount >= MAX_POINTS) { hint.textContent = "Board is full"; break; }
        ctx.font = TEXT_FONT;
        const advance = Math.max(12, ctx.measureText(ch).width + 2);
        const x = cursorX, y = cursorY;
        if (cursorX + advance > W - TEXT_MARGIN && !newTextLine()) break;
        const mark = { t: "t", ch, p: [cursorX / W, cursorY / H] };
        marks.push(mark);
        typeHistory.push({ x, y, mark });
        pointCount++;
        paintText(mark);
        cursorX += advance;
        placeCaret();
        changed = true;
        markWorld();
      }
    };
    const backspaceText = () => {
      const previous = typeHistory.pop();
      if (!previous) return;
      cursorX = previous.x;
      cursorY = previous.y;
      placeCaret();
      if (!previous.mark) return;
      marks.pop();
      pointCount--;
      paint();
      changed = true;
      markWorld();
    };
    const finishAnimation = () => {
      if (!animation) return;
      cancelAnimationFrame(animation.raf);
      const type = animation.type;
      animation = null;
      marks.length = 0;
      if (type === "reset") marks.push(...startingMarks);
      pointCount = marks.reduce((n, mark) => n + mark.p.length / 2, 0);
      changed = true;
      clean.disabled = reset.disabled = eraser.disabled = chalk.disabled = keyboard.disabled = false;
      select("c");
      hint.textContent = type === "reset" ? "Original message restored" : "Board is clean";
      paint();
      markWorld();
      if (dialog.open) flushWorld();
    };
    const washFrame = (time) => {
      if (!animation) return;
      if (!animation.started) animation.started = time;
      const elapsed = time - animation.started, washMs = animation.wash ? WASH_MS : 0;
      if (elapsed < washMs) {
        paint();
        const wash = elapsed / WASH_MS;
        const position = wash * WASH_BANDS, band = Math.min(WASH_BANDS - 1, Math.floor(position));
        const fraction = position - band, bandH = H / WASH_BANDS;
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, band * bandH); ctx.clip(); paintBase(); ctx.restore();
        const rightward = band % 2 === 0, edge = (rightward ? fraction : 1 - fraction) * W;
        ctx.save(); ctx.beginPath(); ctx.rect(rightward ? 0 : edge, band * bandH, rightward ? edge : W - edge, bandH);
        ctx.clip(); paintBase(); ctx.restore();
        ctx.save(); ctx.translate(edge, (band + 0.5) * bandH); ctx.rotate(rightward ? -0.12 : 0.12);
        ctx.fillStyle = "#b8bc9a"; ctx.fillRect(-37, -25, 74, 50);
        ctx.fillStyle = "#d9dcc1"; ctx.fillRect(-31, -21, 62, 9);
        ctx.strokeStyle = "#777c66"; ctx.lineWidth = 4; ctx.strokeRect(-37, -25, 74, 50);
        ctx.restore();
      } else if (animation.type === "reset" && elapsed < washMs + DRAW_MS) {
        paintBase();
        let segments = Math.floor((elapsed - washMs) / DRAW_MS * startingSegments);
        for (const mark of startingMarks) for (let i = 2; i < mark.p.length && segments > 0; i += 2, segments--) paintSegment(mark, i);
      } else { finishAnimation(); return; }
      markWorld();
      animation.raf = requestAnimationFrame(washFrame);
    };
    const startAnimation = (type) => {
      if (animation) finishAnimation();
      if (stroke) return;
      select(null);
      pointer.classList.remove("visible");
      const wash = type === "clean" || marks.length > 0;
      clean.disabled = reset.disabled = eraser.disabled = chalk.disabled = keyboard.disabled = true;
      hint.textContent = type === "reset" ? wash ? "Washing, then rewriting…" : "Rewriting original message…" : "Washing the board…";
      animation = { type, wash, started: 0, raf: requestAnimationFrame(washFrame) };
    };
    const select = (next) => {
      tool = next;
      eraser.setAttribute("aria-pressed", String(tool === "e"));
      chalk.setAttribute("aria-pressed", String(tool === "c"));
      keyboard.setAttribute("aria-pressed", String(tool === "k"));
      pointer.classList.toggle("eraser", tool === "e");
      frame.classList.toggle("has-tool", !!tool);
      frame.classList.toggle("typing", tool === "k");
      caret.hidden = tool !== "k";
      if (tool === "k") { pointer.classList.remove("visible"); placeCaret(); typeInput.focus({ preventScroll: true }); }
      else { typeInput.blur(); typeHistory.length = 0; }
      hint.textContent = tool === "e" ? "Drag on the board to erase · Esc to leave" : tool === "c" ? "Drag on the board to write · Esc to leave"
        : tool === "k" ? "Type to write · Click board to place cursor · Enter for a new line" : "Pick up the chalk, eraser, or keyboard";
    };
    const movePointer = (e) => {
      if (!tool || tool === "k") { pointer.classList.remove("visible"); return; }
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) { pointer.classList.remove("visible"); return; }
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
      pointer.classList.add("visible");
    };
    const addPoint = (e) => {
      if (!stroke || pointCount >= MAX_POINTS) return;
      const [x, y] = coords(e), p = stroke.p, last = p.length - 2;
      if (Math.hypot(x - p[last], y - p[last + 1]) < 0.003) return;
      p.push(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
      pointCount++;
      paintSegment(stroke, p.length - 2);
      changed = true;
      markWorld();
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (tool === "k") {
        if (!e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        const [x, y] = coords(e);
        cursorX = Math.max(TEXT_MARGIN, Math.min(W - TEXT_MARGIN - 48, x * W));
        textStartX = cursorX;
        cursorY = Math.max(TEXT_MARGIN + TEXT_SIZE, Math.min(H - TEXT_MARGIN, y * H + TEXT_SIZE));
        typeHistory.length = 0;
        placeCaret();
        typeInput.focus({ preventScroll: true });
        return;
      }
      if (stroke || !e.isPrimary || e.button !== 0 || !tool || marks.length >= MAX_STROKES || pointCount >= MAX_POINTS) return;
      e.preventDefault();
      const [x, y] = coords(e);
      stroke = { t: tool, s: tool === "c" ? 2 : 4, p: [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] };
      marks.push(stroke); pointCount++;
      activePointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      movePointer(e);
    }, { signal: listeners.signal });
    canvas.addEventListener("pointermove", (e) => { movePointer(e); if (e.pointerId === activePointer) addPoint(e); }, { signal: listeners.signal });
    const endStroke = (e) => {
      if (!stroke || e.pointerId !== activePointer) return;
      if (stroke.p.length === 2) {
        if (stroke.t === "e") { marks.pop(); pointCount--; }
        else {
          const x = Math.min(1, stroke.p[0] + 0.001), y = stroke.p[1];
          stroke.p.push(x, y); pointCount++; paintSegment(stroke, 2); changed = true;
          markWorld();
        }
      }
      flushWorld();
      stroke = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      activePointer = -1;
      if (e.pointerType === "touch") pointer.classList.remove("visible");
    };
    canvas.addEventListener("pointerup", endStroke, { signal: listeners.signal });
    canvas.addEventListener("pointercancel", endStroke, { signal: listeners.signal });
    canvas.addEventListener("pointerleave", () => pointer.classList.remove("visible"), { signal: listeners.signal });
    eraser.addEventListener("click", () => select("e"), { signal: listeners.signal });
    chalk.addEventListener("click", () => select("c"), { signal: listeners.signal });
    keyboard.addEventListener("click", () => select(tool === "k" ? "c" : "k"), { signal: listeners.signal });
    const receiveText = () => {
      const value = typeInput.value;
      typeInput.value = "";
      if (tool === "k" && !animation && value) typeText(value);
    };
    typeInput.addEventListener("input", (e) => { if (!e.isComposing) receiveText(); }, { signal: listeners.signal });
    typeInput.addEventListener("keydown", (e) => {
      if (tool !== "k" || e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const x = cursorX, y = cursorY;
        if (newTextLine()) typeHistory.push({ x, y, mark: null });
      } else if (e.key === "Backspace") { e.preventDefault(); backspaceText(); }
    }, { signal: listeners.signal });
    typeInput.addEventListener("beforeinput", (e) => {
      if (tool === "k" && e.inputType === "deleteContentBackward") { e.preventDefault(); backspaceText(); }
    }, { signal: listeners.signal });
    clean.addEventListener("click", () => startAnimation("clean"), { signal: listeners.signal });
    reset.addEventListener("click", () => startAnimation("reset"), { signal: listeners.signal });
    closeButton.addEventListener("click", () => dialog.close(), { signal: listeners.signal });
    dialog.addEventListener("close", () => {
      finishAnimation();
      if (activePointer >= 0 && canvas.hasPointerCapture(activePointer)) canvas.releasePointerCapture(activePointer);
      activePointer = -1;
      if (stroke && stroke.p.length === 2) {
        if (stroke.t === "e") { marks.pop(); pointCount--; }
        else { stroke.p.push(Math.min(1, stroke.p[0] + 0.001), stroke.p[1]); changed = true; }
      }
      stroke = null; pointer.classList.remove("visible");
      typeInput.value = "";
      if (changed) {
        paint();
        write(marks);
        worldDirty = true;
        changed = false;
      }
      flushWorld();
      onClose();
    }, { signal: listeners.signal });
    return {
      attach(parent, x, y, z, angle = 0) {
        paint();
        node = BL.scene.createNode({ position: { x, y, z }, rotation: { x: 0, y: angle, z: 0 }, geometry: geometryFor(ctx), sightHidden: true });
        BL.scene.addChild(parent, node);
      },
      open(focal) {
        if (dialog.open) return;
        cursorX = textStartX = TEXT_MARGIN;
        cursorY = TEXT_MARGIN + TEXT_SIZE;
        select("c");
        paint();
        onOpen();
        if (document.pointerLockElement) document.exitPointerLock();
        if (focal) dialog.style.transformOrigin = `${Math.round(focal.x / innerWidth * 100)}% ${Math.round(focal.y / innerHeight * 100)}%`;
        dialog.showModal();
      },
      dispose() {
        listeners.abort();
        if (animation) { cancelAnimationFrame(animation.raf); animation = null; }
        if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
        if (dialog.open) dialog.close();
        node = null;
      },
      get openNow() { return dialog.open; }
    };
  };
  BL.chalkboard = { create };
})();
