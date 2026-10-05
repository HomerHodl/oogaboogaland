(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  // Housekeeping trims the idle particle-node pool back to this many nodes.
  const POOL_KEEP = 32;
  const setVec = (v, x, y, z) => {
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  };
  const CONFETTI = ["#d8892b", "#22c55e", "#6f9fca", "#f3efe4", "#f5c542"].map((c) => models.particleGeometry(c, 0.09, 0.6));
  const SMOKE_TRAIL = models.particleGeometry("#c9cbce", 0.09, 0.15);
  const SCREEN = { x: 0, y: 0, depth: 0 };
  // Sleep marks span 11px to 23px, so the whole font range is a fixed table instead of per-frame strings.
  const ZZZ_FONTS = [];
  for (let size = 11; size <= 23; size++) ZZZ_FONTS[size] = `${size}px ui-monospace, monospace`;
  const drawBubble = (ctx, text, x, y, alpha, topSpace = 0) => {
    ctx.globalAlpha = alpha;
    ctx.font = "bold 10px ui-monospace, monospace";
    const tw = ctx.measureText(text).width;
    const px = 3;
    const bw = Math.ceil((tw + 28) / px) * px;
    const bh = 11 * px;
    const bx = Math.round(Math.max(8, Math.min(window.innerWidth - bw - 8, x - bw / 2)) / px) * px;
    const by = Math.round(Math.max(8 + topSpace, Math.min(window.innerHeight - bh - 14, y - bh - 14)) / px) * px;
    const tx = Math.round(Math.max(bx + 2 * px, Math.min(bx + bw - 2 * px, x)) / px) * px;
    const bg = "rgba(18,18,18,0.95)";
    ctx.fillStyle = bg;
    ctx.fillRect(bx + px, by + px, bw - 2 * px, bh - 2 * px);
    ctx.fillStyle = "#d8892b";
    ctx.fillRect(bx + px, by, bw - 2 * px, px);
    ctx.fillRect(bx + px, by + bh - px, bw - 2 * px, px);
    ctx.fillRect(bx, by + px, px, bh - 2 * px);
    ctx.fillRect(bx + bw - px, by + px, px, bh - 2 * px);
    ctx.fillRect(tx - 2 * px, by + bh, 4 * px, px);
    ctx.fillRect(tx - px, by + bh + px, 2 * px, px);
    ctx.fillStyle = bg;
    ctx.fillRect(tx - px, by + bh - px, 2 * px, 2 * px);
    ctx.fillStyle = "#eeeeee";
    ctx.textAlign = "center";
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 4);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
    return by;
  };
  const create = ({ root, renderer, camera, overlay, tickerAt, hud = null, overlayVisible = null, zzzVisible = null, characterOccluded = null, renderOpts = null }) => {
    const overlayCtx = overlay.getContext("2d");
    const visibility = BL.characterVisibility.create({ root, renderer, camera, occluded: characterOccluded, renderOpts });
    const speechScreen = { x: 0, y: 0 };
    if (hud) hud.tooltip.setVisibility(visibility);
    // Prepare only the current celebrants' exact sight queries while the scene
    // is covered. Immutable blocker meshes remain shared across scene visits.
    const warmVisibility = (crew) => {
      BL.scene.updateWorld(root);
      visibility.begin();
      for (const cave of crew.list) if (cave.state === "working") visibility.visible(cave);
    };
    const particles = [];
    const particlePool = [];
    const MAX_PARTICLES = 240;
    const spawnParticle = (geometry, x, y, z, vx, vy, vz, life, spin = 6, gravity = 3.2, floor = 0.03) => {
      if (particles.length >= MAX_PARTICLES) return null;
      let p = particlePool.pop();
      if (!p) {
        p = { node: createNode({ visible: false, sightHidden: true }), vx: 0, vy: 0, vz: 0, life: 0, spin: 0, gravity: 3.2, floor: 0.03, smoke: false, maxLife: 0 };
        addChild(root, p.node);
      }
      p.node.geometry = geometry;
      p.node.visible = true;
      setVec(p.node.position, x, y, z);
      setVec(p.node.scale, 1, 1, 1);
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.life = life;
      p.spin = spin;
      p.smoke = false;
      p.maxLife = life;
      p.gravity = gravity;
      p.floor = floor;
      particles.push(p);
      return p;
    };
    const stepParticles = (dt) => {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          p.node.visible = false;
          particles.splice(i, 1);
          particlePool.push(p);
          continue;
        }
        if (p.smoke) {
          const drag = Math.max(0, 1 - 1.6 * dt);
          p.vx *= drag;
          p.vz *= drag;
          p.vy += 0.3 * dt;
          p.node.position.x += p.vx * dt;
          p.node.position.y += p.vy * dt;
          p.node.position.z += p.vz * dt;
          p.node.rotation.y += p.spin * dt;
          const s = (0.5 + 1.3 * (1 - p.life / p.maxLife)) * Math.min(1, p.life / 0.3);
          p.node.scale.x = p.node.scale.y = p.node.scale.z = s;
          continue;
        }
        p.vy -= p.gravity * dt;
        p.node.position.x += p.vx * dt;
        p.node.position.y += p.vy * dt;
        p.node.position.z += p.vz * dt;
        if (p.node.position.y < p.floor) {
          p.node.position.y = p.floor;
          p.vy *= -0.3;
          p.vx *= 0.7;
          p.vz *= 0.7;
        }
        p.node.rotation.x += p.spin * dt;
        p.node.rotation.z += p.spin * 0.7 * dt;
        const s = Math.min(1, p.life / 0.4);
        p.node.scale.x = p.node.scale.y = p.node.scale.z = s;
      }
    };
    const burst = (x, y, z, count, geos, speed = 3) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
        spawnParticle(geos[i % geos.length], x, y, z, Math.cos(a) * s, 1.5 + Math.random() * 2.5, Math.sin(a) * s, 1.4 + Math.random() * 0.8);
      }
    };
    const puff = (x, y, z, vx, vy, vz, life) => {
      const p = spawnParticle(SMOKE_TRAIL, x, y, z, vx, vy, vz, life, 1.2);
      if (p) p.smoke = true;
    };
    const bubbles = [];
    const zzz = [];
    const damageNumbers = Array.from({ length: 32 }, () => ({ x: 0, y: 0, z: 0, life: 0, text: "" }));
    let damageCursor = 0, damageCount = 0;
    const DAMAGE_LIFE = 0.8;
    const damageNumber = (x, y, z, amount) => {
      if (!(amount > 0)) return;
      const number = damageNumbers[damageCursor];
      damageCursor = (damageCursor + 1) % damageNumbers.length;
      if (!number.life) damageCount++;
      number.x = x + (Math.random() - 0.5) * 0.2;
      number.y = y + (Math.random() - 0.5) * 0.08;
      number.z = z + (Math.random() - 0.5) * 0.2;
      number.life = DAMAGE_LIFE;
      number.text = String(Math.round(amount * 2) / 2);
    };
    let ticker = null;
    const MAX_BUBBLES = 10;
    const say = (cave, text, dur = 2.4) => {
      const existing = bubbles.find((b) => b.cave === cave);
      if (existing) {
        existing.text = text;
        existing.t = 0;
        existing.dur = dur;
        return;
      }
      if (bubbles.length >= MAX_BUBBLES) bubbles.shift();
      bubbles.push({ cave, text, t: 0, dur });
    };
    const sayAt = (x, y, z, text, dur = 2) => {
      if (bubbles.length >= MAX_BUBBLES) bubbles.shift();
      bubbles.push({ at: { x, y, z }, text, t: 0, dur });
    };
    const zzzAt = (x, y, z, cave = null) => {
      zzz.push({ x, y, z, cave, t: 0 });
      if (zzz.length > 40) zzz.shift();
    };
    // The ticker's glow is baked once into a small canvas: a shadow blur on the full overlay costs
    // twenty to forty milliseconds a frame at a 4K backing store, and the text never changes.
    const TICKER_PAD = 18, TICKER_ASCENT = 10;
    const renderTicker = (text, dpr) => {
      const ctx = overlayCtx;
      ctx.font = "bold 13px ui-monospace, monospace";
      const w = Math.ceil(ctx.measureText(text).width) + TICKER_PAD * 2, h = 13 + TICKER_PAD * 2;
      const canvas = document.createElement("canvas"), c = canvas.getContext("2d");
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.font = "bold 13px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillStyle = "#ffd27a";
      c.shadowColor = "#d8892b";
      c.shadowBlur = 12;
      c.fillText(text, w / 2, TICKER_PAD + TICKER_ASCENT);
      return { canvas, w, h };
    };
    const showTicker = (text, dur) => {
      ticker = { text, t: 0, dur, image: null, dpr: 0 };
    };
    let overlayW = 0, overlayH = 0, overlayDpr = 1;
    // The overlay's CSS size, read on resize rather than every frame: a per-frame read forces layout after the HUD writes.
    let cssW = overlay.clientWidth, cssH = overlay.clientHeight;
    const sizeObserver = new ResizeObserver(() => {
      cssW = overlay.clientWidth;
      cssH = overlay.clientHeight;
    });
    sizeObserver.observe(overlay);
    const projectRaw = (x, y, z) => renderer.project(x, y, z, SCREEN);
    const project = (x, y, z) => !overlayVisible || overlayVisible(x, y, z) ? projectRaw(x, y, z) : null;
    const drawSpeech = (ctx, text, x, y, alpha, cave = null) => {
      if (cave) {
        if (!visibility.anchor(cave, speechScreen)) return;
        x = speechScreen.x; y = speechScreen.y;
      }
      const top = drawBubble(ctx, text, x, y, alpha, hud ? hud.tooltip.speechSpace(cave) : 0);
      if (hud) hud.tooltip.aboveSpeech(cave, top);
    };
    // drawExtra paints between the bubbles and the ticker.
    const drawOverlay = (dt, drawExtra) => {
      visibility.begin();
      if (hud) hud.tooltip.beginFrame();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cssW, h = cssH;
      if (w !== overlayW || h !== overlayH || dpr !== overlayDpr) {
        overlayW = w;
        overlayH = h;
        overlayDpr = dpr;
        overlay.width = Math.max(1, Math.round(w * dpr));
        overlay.height = Math.max(1, Math.round(h * dpr));
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const ctx = overlayCtx;
      ctx.clearRect(0, 0, w, h);
      if (damageCount) {
        ctx.save();
        ctx.font = "bold 12px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ff4545";
        ctx.strokeStyle = "#24100e";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        for (let i = 0; i < damageNumbers.length; i++) {
          const number = damageNumbers[i];
          if (!number.life) continue;
          number.life = Math.max(0, number.life - dt);
          if (!number.life) { number.text = ""; damageCount--; continue; }
          const pos = project(number.x, number.y + (DAMAGE_LIFE - number.life) * 0.45, number.z);
          if (!pos) continue;
          ctx.globalAlpha = Math.min(1, number.life / 0.25);
          ctx.strokeText(number.text, pos.x, pos.y);
          ctx.fillText(number.text, pos.x, pos.y);
        }
        ctx.restore();
      }
      for (let i = zzz.length - 1; i >= 0; i--) {
        const p = zzz[i];
        p.t += dt;
        if (p.t > 2.4) {
          zzz.splice(i, 1);
          continue;
        }
        if (zzzVisible && !zzzVisible(p.cave, p.x, p.y, p.z)) continue;
        const pos = project(p.x, p.y + p.t * 0.45, p.z);
        if (!pos) continue;
        ctx.globalAlpha = (1 - p.t / 2.4) * 0.8;
        ctx.fillStyle = "#ffb347";
        ctx.font = ZZZ_FONTS[Math.round(11 + p.t * 5)];
        ctx.fillText("z", pos.x + Math.sin(p.t * 3) * 6, pos.y);
      }
      ctx.globalAlpha = 1;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.t += dt;
        if (b.t > b.dur) {
          bubbles.splice(i, 1);
          continue;
        }
        const pos = b.cave ? speechScreen : project(b.at.x, b.at.y, b.at.z);
        if (!pos) continue;
        const fade = Math.min(1, b.t / 0.2, (b.dur - b.t) / 0.3);
        drawSpeech(ctx, b.text, pos.x, pos.y, fade, b.cave);
      }
      drawExtra(ctx, project, drawSpeech);
      if (hud) hud.tooltip.update();
      if (ticker) {
        ticker.t += dt;
        if (ticker.t > ticker.dur) ticker = null;
        else {
          const pos = projectRaw(tickerAt.x, tickerAt.y, tickerAt.z);
          if (pos) {
            if (!ticker.image || ticker.dpr !== dpr) { ticker.image = renderTicker(ticker.text, dpr); ticker.dpr = dpr; }
            const fade = Math.min(1, ticker.t / 0.3, (ticker.dur - ticker.t) / 0.5), img = ticker.image;
            ctx.globalAlpha = fade;
            ctx.drawImage(img.canvas, pos.x - img.w / 2, pos.y - TICKER_PAD - TICKER_ASCENT, img.w, img.h);
            ctx.globalAlpha = 1;
          }
        }
      }
    };
    const trimPool = () => {
      while (particlePool.length > POOL_KEEP) removeChild(root, particlePool.pop().node);
    };
    // A replacement world must not retain dust or sparks from the one it removed.
    const clearParticles = () => {
      while (particles.length) {
        const p = particles.pop();
        p.node.visible = false;
        particlePool.push(p);
      }
      trimPool();
    };
    const dispose = () => {
      sizeObserver.disconnect();
      if (hud) hud.tooltip.setVisibility(null);
      visibility.dispose();
      for (const p of particles) removeChild(root, p.node);
      for (const p of particlePool) removeChild(root, p.node);
      particles.length = 0;
      particlePool.length = 0;
      bubbles.length = 0;
      zzz.length = 0;
      for (const number of damageNumbers) { number.life = 0; number.text = ""; }
      damageCursor = damageCount = 0;
      ticker = null;
    };
    const stats = () => ({ particles: particles.length, pool: particlePool.length, bubbles: bubbles.length, zzz: zzz.length, damageNumbers: damageCount });
    return {
      spawnParticle, burst, puff, clearParticles, say, sayAt, zzzAt, damageNumber, showTicker, drawOverlay, warmVisibility, warmBlockers: visibility.warm, update: stepParticles, trimPool, dispose, stats,
      get inMotion() {
        return particles.length > 0 || damageCount > 0;
      }
    };
  };
  BL.fx = { create, CONFETTI };
})();
