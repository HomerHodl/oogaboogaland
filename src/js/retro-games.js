// Ooga Arcade's retro games: the eight cabinets on the mezzanine, each a short Ooga take on an arcade classic played
// on its own cabinet's screen. The carnival scene (`scene-carnival.js`) stages them as it stages the carnival games
// (title card, 3-2-1, play, pause, results with stars, best and tickets); the machine is the cabinet, and its screen
// is this module's one offscreen canvas, which the scene lays over the cabinet's glass every frame.
//
// A game is a factory `make(host)` returning { kind, name, help, coach, stars, tickets(score), status, playing,
// start(seed), act(), stop(), update(dt), draw(ctx), aims: true }, the carnival games' interface plus `draw`, which
// paints the whole W x H screen (the backdrop first) into the shared canvas's context, and `coach`, the first run's
// coaching line [keys, touch]. `status` is written in place for the HUD, as the carnival games write it: score,
// left and its label, round, target, meter (-1: none), streak, fire, verb, and the optional mult and note. Optional:
// `roundLabel`, the HUD's name for `round` ("Round" without it), `notch`, the share of the screen's width a drag
// moves for one of `steps` (the scene's own notch without it), and `taps: true` for a game that never steers, whose
// press on the canvas acts as it goes down rather than as a tap lifts.
//
// host: { best, aim, still, onEnd(score), over(), popup(text, big), cue(name, gain), shake(k), crack(big), flop() }. `aim` is read,
// never written: `x` -1..1 (a drag across the screen or held arrows and A and D), `hold` -1, 0 or 1 while a key is
// held, and `steps`, a count moved one each press of left or right (and each notch of a drag), for games that step
// rather than slide: keep the last value read and take the difference; `y` is 1 while S or the down arrow is held
// (or a drag is pulled down) and -1 while W or the up arrow is, and `stepsY` counts down and up as `steps` counts
// across (a press of S or the down arrow one more, of W or the up arrow one less, and each notch of a drag that goes
// more down or up than across). `crack(big)` stages a coconut cracking over
// the cabinet (the watchers cheer and chant on a big one), `flop` a miss the watchers groan at; `still` is the
// visitor's reduced-motion wish. `over()` is called once, after its cue, the moment the run is decided (the last life
// lost or the game won), and stops the cabinet's tune so the end beat's own sounds play alone; `onEnd` follows when
// that beat is done.
//
// The rules every game keeps: `update` and `draw` allocate nothing (preset ink strings, typed arrays and fixed pools
// for entities, text through the kit's atlas and numbers through its digit buffer, popups cached per value), state
// that changes every frame lives on objects or typed arrays (a double in a closure's `let` is boxed on every write),
// play runs on a fixed step, the seeded `rng` decides everything that matters so a seed replays a run, and
// `Math.random` only throws sparks.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { glyphOf, GLYPH_W, GLYPH_H, TRACKING } = BL.jumbotron.text;
  const noop = () => {};

  // ---- the kit ------------------------------------------------------------------------------------------
  // The screen's logical size, 4:3 like the cabinet's glass, and the inks: the arcade's own colours as preset fill
  // strings, so a frame never builds one.
  const W = 160, H = 120;
  const INK = {
    night: "#07080d", cave: "#0d0f16", deep: "#161a26", band: "#05060a", rule: "#1a2030", earth: "#2a1e14", earthDk: "#1c140d",
    bone: "#efe6d2", cream: "#f6ecd2", banana: "#ffd23a", gold: "#ffb02e", ember: "#ff8a2a", red: "#e0452b", rust: "#b8472c",
    ochre: "#d9953a", teal: "#46ffd2", sky: "#5ec8ff", violet: "#b98cff", pink: "#ff5fa2", lime: "#c8ff5a", leaf: "#6fae3a",
    moss: "#3a6e24", husk: "#8a5a2c", huskDk: "#4a2e18", skin: "#c68642", hair: "#3a2414", stone: "#8e8e96", stoneLt: "#b4b4bc",
    stoneDk: "#5a5a62", charcoal: "#2b221d", white: "#ffffff"
  };
  // The font's inks, one atlas row each; `TEXT` names the rows for `text` and `number`.
  const TEXT_INKS = [INK.bone, INK.banana, INK.red, INK.teal, INK.gold, INK.stone, INK.night, INK.leaf, INK.white, INK.sky, INK.pink, INK.ember, INK.lime, INK.violet];
  const TEXT = { bone: 0, banana: 1, red: 2, teal: 3, gold: 4, stone: 5, night: 6, leaf: 7, white: 8, sky: 9, pink: 10, ember: 11, lime: 12, violet: 13 };
  const canvasOf = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  };
  // The one screen every game paints, made on first use (with the font's atlas) and kept for the page.
  const SCREEN = { canvas: null, ctx: null };
  const screen = () => {
    if (!SCREEN.canvas) {
      SCREEN.canvas = canvasOf(W, H);
      SCREEN.ctx = SCREEN.canvas.getContext("2d");
      SCREEN.ctx.imageSmoothingEnabled = false;
      if (!atlas) buildAtlas();
    }
    return SCREEN;
  };
  // The jumbotron's 5x7 font pre-rendered once in every ink: character codes 32 to 95 (lower case folds to upper), the
  // unknown box last. `GLYPH` maps a code to its column; 0 is the space, which draws nothing.
  const CELL = GLYPH_W + TRACKING, UNKNOWN = 64, GLYPH = new Uint8Array(128).fill(UNKNOWN);
  for (let c = 32; c < 96; c++) GLYPH[c] = c - 32;
  for (let c = 97; c < 123; c++) GLYPH[c] = c - 64;
  // Painted a pixel at a time in the first ink's row only, then copied down a row per ink and recoloured in place:
  // `source-atop` keeps each glyph's opaque pixels and gives them the row's ink, the same pixels as painting every
  // ink, in a dozen calls an ink rather than a thousand.
  let atlas = null;
  const buildAtlas = () => {
    atlas = canvasOf((UNKNOWN + 1) * CELL, TEXT_INKS.length * GLYPH_H);
    const x = atlas.getContext("2d"), aw = atlas.width;
    x.imageSmoothingEnabled = false;
    x.fillStyle = TEXT_INKS[0];
    for (let g = 0; g <= UNKNOWN; g++) {
      const rows = glyphOf(g < UNKNOWN ? String.fromCharCode(32 + g) : "\u0001");
      for (let r = 0; r < GLYPH_H; r++) for (let k = 0; k < GLYPH_W; k++) if (rows[r] >> (GLYPH_W - 1 - k) & 1) x.fillRect(g * CELL + k, r, 1, 1);
    }
    for (let row = 1; row < TEXT_INKS.length; row++) {
      x.drawImage(atlas, 0, 0, aw, GLYPH_H, 0, row * GLYPH_H, aw, GLYPH_H);
      x.globalCompositeOperation = "source-atop";
      x.fillStyle = TEXT_INKS[row];
      x.fillRect(0, row * GLYPH_H, aw, GLYPH_H);
      x.globalCompositeOperation = "source-over";
    }
  };
  // Text from the atlas at (x, y), `scale` whole pixels a font pixel: one drawImage a letter, nothing built. Strings
  // drawn in play are literals; a number goes through `number`.
  const text = (ctx, s, x, y, ink = 0, scale = 1) => {
    if (!atlas) buildAtlas();
    const sy = ink * GLYPH_H, w = GLYPH_W * scale, h = GLYPH_H * scale, step = CELL * scale;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i), g = code < 128 ? GLYPH[code] : UNKNOWN;
      if (g) ctx.drawImage(atlas, g * CELL, sy, GLYPH_W, GLYPH_H, x, y, w, h);
      x += step;
    }
  };
  const textWidth = (s, scale = 1) => s.length ? (s.length * CELL - TRACKING) * scale : 0;
  const centre = (ctx, s, y, ink = 0, scale = 1) => text(ctx, s, (W - textWidth(s, scale)) >> 1, y, ink, scale);
  // A whole number, its digits taken into a preallocated buffer: `align` 0 from x, 1 centred on x, 2 ending at x;
  // `pad` leading zeros up to that many digits, as an arcade score shows.
  const DIGITS = new Uint8Array(12);
  const number = (ctx, n, x, y, ink = 0, scale = 1, align = 0, pad = 0) => {
    if (!atlas) buildAtlas();
    let v = n > 0 ? Math.floor(n) : 0, k = 0;
    do { DIGITS[k++] = v % 10; v = Math.floor(v / 10); } while (v > 0 && k < 12);
    while (k < pad && k < 12) DIGITS[k++] = 0;
    const w = (k * CELL - TRACKING) * scale, sy = ink * GLYPH_H, step = CELL * scale;
    let cx = align === 1 ? x - (w >> 1) : align === 2 ? x - w : x;
    for (let i = k - 1; i >= 0; i--) {
      ctx.drawImage(atlas, (16 + DIGITS[i]) * CELL, sy, GLYPH_W, GLYPH_H, cx, y, GLYPH_W * scale, GLYPH_H * scale);
      cx += step;
    }
  };
  // A sprite baked once into its own little canvas from rows of characters, each an ink in `inks` ("." is clear);
  // `flip` bakes it mirrored, and `solid` bakes every lit pixel in one ink (a hit's white flash).
  const sprite = (rows, inks, flip = false, solid = null) => {
    const h = rows.length, w = rows[0].length, c = canvasOf(w, h), x = c.getContext("2d");
    for (let r = 0; r < h; r++) for (let k = 0; k < w; k++) {
      const ch = rows[r][flip ? w - 1 - k : k];
      if (ch === ".") continue;
      x.fillStyle = solid || inks[ch];
      x.fillRect(k, r, 1, 1);
    }
    return { canvas: c, w, h };
  };
  const blit = (ctx, s, x, y) => ctx.drawImage(s.canvas, Math.round(x), Math.round(y));
  // A sprite's rows turned a quarter clockwise, for a spinning thing's frames.
  const quarter = (rows) => rows[0].split("").map((_, k) => rows.map((r) => r[k]).reverse().join(""));
  // A seeded generator (mulberry32) whose state lives in a typed array: `seed(n)`, `fresh()` for a run nobody can
  // predict, returning the seed so it can be replayed, `next()` in [0, 1), `int(n)`, `range(a, b)`, `chance(p)`.
  const rng = () => {
    const s = new Uint32Array(1);
    const next = () => {
      s[0] += 0x6d2b79f5;
      let t = s[0];
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    return {
      seed: (n) => { s[0] = n >>> 0; },
      fresh: () => { crypto.getRandomValues(s); return s[0]; },
      next, int: (n) => Math.floor(next() * n), range: (a, b) => a + (b - a) * next(), chance: (p) => next() < p
    };
  };
  // Pixel sparks: a fixed pool of `cap` in typed arrays, each one of `inks` (preset strings), thrown from a point and
  // falling under `gravity` px/s², two pixels while fresh, then one. Throwaway, so `Math.random` throws them. `live`
  // counts the lit ones and `lit` those of each ink, so an empty pool costs nothing to update or draw and the draw
  // walks the pool only for the inks in the air.
  const sparks = (cap, inks, gravity = 90) => {
    const x = new Float32Array(cap), y = new Float32Array(cap), vx = new Float32Array(cap), vy = new Float32Array(cap);
    const life = new Float32Array(cap), full = new Float32Array(cap), ink = new Uint8Array(cap), P = { next: 0, live: 0 };
    const lit = new Uint16Array(inks.length);
    const spawn = (px, py, count, speed, inkA, inkB = inkA, lifeS = 0.6) => {
      for (let n = 0; n < count; n++) {
        const i = P.next;
        P.next = (P.next + 1) % cap;
        if (life[i] > 0) lit[ink[i]]--;
        else P.live++;
        const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
        x[i] = px; y[i] = py; vx[i] = Math.cos(a) * v; vy[i] = Math.sin(a) * v - speed * 0.35;
        life[i] = full[i] = lifeS * (0.6 + Math.random() * 0.6);
        ink[i] = n & 1 ? inkB : inkA;
        lit[ink[i]]++;
      }
    };
    const update = (dt) => {
      if (!P.live) return;
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { P.live--; lit[ink[i]]--; }
        vy[i] += gravity * dt;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      }
    };
    const draw = (ctx) => {
      if (!P.live) return;
      for (let k = 0; k < inks.length; k++) {
        if (!lit[k]) continue;
        ctx.fillStyle = inks[k];
        for (let i = 0; i < cap; i++) {
          if (life[i] <= 0 || ink[i] !== k) continue;
          const s = life[i] > full[i] * 0.55 ? 2 : 1;
          ctx.fillRect(Math.round(x[i]), Math.round(y[i]), s, s);
        }
      }
    };
    const clear = () => { life.fill(0); lit.fill(0); P.live = 0; };
    return { spawn, update, draw, clear };
  };
  // The screen's own juice: a shake in whole pixels that decays, and a flash of one ink over everything, both off
  // under reduced motion. `begin` offsets the play by the shake, `end` restores it and lays the flash.
  const juice = (host) => {
    const J = { shake: 0, flash: 0, t: 0, dx: 0, dy: 0, color: INK.white };
    return {
      shake: (k) => { if (!host.still) J.shake = Math.max(J.shake, k); },
      flash: (color, k) => { if (!host.still) { J.flash = Math.max(J.flash, k); J.color = color; } },
      update: (dt) => {
        J.t += dt;
        J.shake = Math.max(0, J.shake - dt * 12);
        J.flash = Math.max(0, J.flash - dt * 3.5);
        J.dx = Math.round(Math.sin(J.t * 71) * J.shake);
        J.dy = Math.round(Math.cos(J.t * 53) * J.shake * 0.7);
      },
      begin: (ctx) => { if (J.dx || J.dy) ctx.setTransform(1, 0, 0, 1, J.dx, J.dy); },
      end: (ctx) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (J.flash <= 0) return;
        ctx.globalAlpha = Math.min(0.85, J.flash);
        ctx.fillStyle = J.color;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      },
      reset: () => { J.shake = J.flash = 0; J.dx = J.dy = 0; }
    };
  };
  // The host's calls with the optional ones filled in, so a game calls them unguarded (the smoke's stub host has few).
  const AIM = { x: 0, hold: 0, steps: 0, y: 0, stepsY: 0 };
  const hooks = (host) => ({ popup: host.popup || noop, cue: host.cue || noop, shake: host.shake || noop, crack: host.crack || noop, flop: host.flop || noop, aim: host.aim || AIM, onEnd: host.onEnd || noop, over: host.over || noop });
  const makeStatus = (label) => ({ score: 0, left: 0, label, round: 1, target: 0, meter: -1, window0: 0, window1: 0, streak: 0, fire: false, verb: "", mult: 0, note: "" });
  // Popups built once per value and kept, so a score builds no string in play.
  const worded = (pre, post = "") => { const said = []; return (n) => said[n] || (said[n] = `${pre}${n}${post}`); };
  // The fixed step every game plays on: frame time accumulates into 1/120 s steps, at most eight a frame.
  const STEP = 1 / 120, MAX_STEPS = 8;
  const stepper = (step) => {
    const A = { acc: 0 };
    return (dt) => {
      A.acc = Math.min(A.acc + dt, STEP * MAX_STEPS);
      while (A.acc >= STEP) { A.acc -= STEP; step(STEP); }
    };
  };
  // The helpers the carnival scene lays the screen with, made once: a cover three rows to a screen pixel, holding the
  // scanlines (at 0.3) under a vignette with a faint sheen of glass, one pass over the screen where they were two
  // (laying one over the other first is the same as laying each in turn); and a small canvas the screen is shrunk
  // into for its glow, `gw` by `gh` inside a clear border `pad` wide, so the glow fades out past the screen's edges
  // when it is drawn large.
  const CRT = { cover: null, glow: null, glowCtx: null, gw: 20, gh: 15, pad: 2 };
  const crt = () => {
    if (CRT.cover) return CRT;
    CRT.cover = canvasOf(W, H * 3);
    const v = CRT.cover.getContext("2d");
    v.fillStyle = "#000000";
    v.globalAlpha = 0.3;
    for (let y = 2; y < H * 3; y += 3) v.fillRect(0, y, W, 1);
    v.globalAlpha = 1;
    v.setTransform(1, 0, 0, 3, 0, 0);
    const g = v.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
    const sheen = v.createLinearGradient(0, 0, W * 0.6, H);
    sheen.addColorStop(0, "rgba(255,255,255,0.07)");
    sheen.addColorStop(0.45, "rgba(255,255,255,0)");
    v.fillStyle = sheen;
    v.fillRect(0, 0, W, H);
    CRT.glow = canvasOf(CRT.gw + 2 * CRT.pad, CRT.gh + 2 * CRT.pad);
    CRT.glowCtx = CRT.glow.getContext("2d");
    CRT.glowCtx.imageSmoothingEnabled = true;
    return CRT;
  };
  const kit = { W, H, INK, TEXT, STEP, screen, crt, text, textWidth, centre, number, sprite, blit, quarter, rng, sparks, juice, hooks, makeStatus, worded, stepper };

  // ---- Coconut Invaders -----------------------------------------------------------------------------------
  // Space Invaders in the cave: waves of pterodactyls, beetles and bugs march down on an Ooga who throws coconuts up
  // at them from behind four stone shields. The formation speeds up as it thins and each wave starts lower and
  // faster; pterodactyls peel off and dive-bomb the Ooga (double points while they dive); bombs and the formation
  // chip the shields away cell by cell; a mammoth now and then plods across the top for a bonus; every eighth hit in
  // a row (not counting what a golden one takes) charges a golden coconut that pierces a whole column and blasts its
  // neighbours; the formation's march beats a drum that quickens as it does; hits in a row multiply the
  // score (x2 from five, x3 from ten, x4 from fifteen). Three Oogas, one more at 3000; five waves, a bonus for every
  // Ooga standing at the end; lose them all, or let the formation land, and it is over.
  const INV_ROWS = 4, INV_COLS = 8, INV_N = INV_ROWS * INV_COLS, GAP_X = 14, GAP_Y = 11, SLOT_W = 13;
  const EDGE_L = 4, EDGE_R = 156, LAND_Y = 100, TOP_Y = 10, GROUND_Y = 114, PLAYER_Y = 103, PW = 11, PH = 11;
  const WAVES = 5, LIVES = 3, EXTRA_AT = 3000, COCONUT_SPEED = 150, GOLD_SPEED = 190, COOL = 0.2, GOLD_COOL = 0.3, IN_AIR = 2, COCONUTS = 4, BOMBS = 8;
  const PLAYER_SPEED = 118, ENTRY = 0.9, CLEAR_S = 1.8, DEAD_S = 1.3, OVER_S = 1.8, INVULNERABLE = 1.7, GOLD_EVERY = 8, BLAST = 17, UP_S = 1.6;
  const SHIELD_X = [16, 56, 96, 136], SHIELD_Y = 88, SHIELD_COLS = 8, SHIELD_ROWS = 4, SHIELD_CELLS = SHIELD_COLS * SHIELD_ROWS;
  const SHIELD_SHAPE = [".######.", "########", "########", "###..###"];
  // The rows' creatures (0 pterodactyl, 1 beetle, 2 bug), their points, sprite sizes and what they drop (0 spit, 1 rock).
  const ROW_KIND = [0, 1, 1, 2], POINTS = [30, 20, 10], KIND_W = [13, 11, 9], KIND_H = [7, 8, 7], DROPS = [1, 1, 0];
  const MAMMOTH_PAYS = [100, 150, 200, 300], MAMMOTH_Y = 11, MAMMOTH_SPEED = 26;
  // The sparks' inks, by index: a creature's two, the Ooga's, stone dust, the golden coconut and the mammoth.
  const INV_SPARKS = [INK.violet, "#7a5ab8", INK.teal, "#1f8f78", INK.lime, "#6f9a2a", INK.skin, INK.hair, INK.stoneLt, INK.stone, INK.banana, INK.white, "#7a5230", INK.bone];
  const KIND_SPARK = [0, 2, 4];
  // The bugs' spit, paler than the bugs so it reads falling past them, over a lime trail.
  const SPIT = "#f4ffd0", SPIT_TRAIL = INK.lime;
  const S_OOGA = 6, S_STONE = 8, S_GOLD = 10, S_MAMMOTH = 12;
  const OOGA_INKS = { H: INK.hair, h: "#5a3a1e", S: INK.skin, s: "#9a6232", W: INK.cream, K: "#1b1410", L: INK.ochre, l: "#6b3a1e" };
  const OOGA_ROWS = [
    ["...hhhhh...", "..hHHHHHh..", ".HHHHHHHHH.", ".HSSSSSSSH.", "..SWKSWKS..", "..SSSsSSS..", "...SKKKS...", "..SSSSSSS..", ".SSLLLLLSS.", ".S.LlLlL.S.", "...SS.SS..."],
    ["...hhhhh...", "..hHHHHHh..", ".HHHHHHHHH.", ".HSSSSSSSH.", "..SWKSWKS..", "..SSSsSSS..", "...SKKKS...", "..SSSSSSS..", ".SSLLLLLSS.", ".S.LlLlL.S.", "..SS...SS.."],
    ["S..hhhhh..S", "S.hHHHHHh.S", "SHHHHHHHHHS", ".HSSSSSSSH.", "..SWKSWKS..", "..SSSsSSS..", "...SKKKS...", "..SSSSSSS..", "...LLLLL...", "...LlLlL...", "...SS.SS..."]
  ];
  const PTERO_INKS = { P: INK.violet, p: "#7a5ab8", C: INK.bone, E: INK.banana, B: INK.gold };
  const PTERO_ROWS = [
    ["pP.........Pp", ".pPP.....PPp.", "..pPPPCPPPp..", "...PPPPPPP...", "....PEPEP....", ".....PBP.....", "......B......"],
    [".............", "......C......", "...PPPPPPP...", "..pPPEPEPPp..", ".pPP.PBP.PPp.", "pP....B....Pp", "............."]
  ];
  const BEETLE_INKS = { T: INK.teal, t: "#1f8f78", A: INK.bone, e: INK.night };
  const BEETLE_ROWS = [
    ["..A.....A..", "...A...A...", "..TTTTTTT..", ".TTeTTTeTT.", "TTTTtTtTTTT", "T.TTTTTTT.T", "T.t.....t.T", "...tt.tt..."],
    ["..A.....A..", "T..A...A..T", "T.TTTTTTT.T", "TTTeTTTeTTT", "TTTTtTtTTTT", "..TTTTTTT..", "..t.....t..", ".t.......t."]
  ];
  const BUG_INKS = { G: INK.lime, g: "#6f9a2a", e: INK.night };
  const BUG_ROWS = [
    ["...GGG...", ".GGGGGGG.", "GGeGGGeGG", "GGGGGGGGG", "..g...g..", ".g.ggg.g.", "g.......g"],
    ["...GGG...", ".GGGGGGG.", "GGeGGGeGG", "GGGGGGGGG", ".g.g.g.g.", "g.......g", ".g.....g."]
  ];
  const MAMMOTH_INKS = { M: "#7a5230", m: "#4e3420", K: "#1b1410", T: INK.bone };
  const MAMMOTH_TOP = ["....mmmmmm......", "..mmMMMMMMmm....", ".mMMMMMMMMMMm...", "mMMMMMMMMMMMMm..", "MMMMMMMMMMMMKMm.", "MMMMMMMMMMMMMMMM", "MMMMMMMMMMMMTTMM"];
  const MAMMOTH_ROWS = [
    [...MAMMOTH_TOP, ".MM.MM..MM.T..MM", ".MM.MM..MM.TT.M.", ".MM..MM.MM....M."],
    [...MAMMOTH_TOP, ".MM.MM..MM.T..MM", "..MM.MM..MM.TTM.", "..MM.MM..MM...M."]
  ];
  const NUT_ROWS = [".CC.", "CcCC", "CCCk", ".Ck."], NUT_INKS = { C: INK.husk, c: "#c89a5a", k: INK.huskDk };
  const GOLD_ROWS = [".GGG.", "GgGGG", "GGGGo", "GGGoo", ".Goo."], GOLD_INKS = { G: INK.banana, g: "#fff3a0", o: "#e0a228" };
  const HEAD_ROWS = [".hhh.", "hSSSh", "SWSWS", ".SSS."], WORMS = 10;
  // Built once for the page on the first game: every sprite, its hit silhouette, and the cave backdrop.
  let invArt = null;
  const invadersArt = () => {
    if (invArt) return invArt;
    const both = (rows, inks) => rows.map((r) => sprite(r, inks));
    const back = canvasOf(W, H), b = back.getContext("2d"), dots = BL.math.mulberry32(7);
    b.fillStyle = INK.night; b.fillRect(0, 0, W, H);
    b.fillStyle = "#0a0d17"; b.fillRect(0, 10, W, 50);
    // Rock pillars far off in the dark, the ceiling's stalactites, and glow-worms.
    b.fillStyle = "#0b0e18";
    for (const [x, w] of [[26, 7], [70, 4], [118, 8], [146, 5]]) b.fillRect(x, 20, w, GROUND_Y - 20);
    b.fillStyle = "#12162a";
    for (const [x, len] of [[5, 5], [19, 8], [38, 4], [61, 7], [84, 5], [103, 9], [127, 4], [141, 7], [155, 5]]) for (let k = 0; k < len; k++) b.fillRect(x - Math.max(0, 1 - (k >> 2)), 10 + k, 1 + Math.max(0, 2 - (k >> 1)), 1);
    for (let i = 0; i < 26; i++) { b.fillStyle = i % 3 ? "#1d4f48" : "#2b3a66"; b.fillRect(Math.floor(dots() * W), 12 + Math.floor(dots() * 70), 1, 1); }
    b.fillStyle = INK.band; b.fillRect(0, 0, W, TOP_Y - 1);
    b.fillStyle = INK.rule; b.fillRect(0, TOP_Y - 1, W, 1);
    b.fillStyle = INK.earth; b.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    b.fillStyle = INK.earthDk; b.fillRect(0, GROUND_Y + 2, W, 1);
    for (let x = 0; x < W; x += 3) { b.fillStyle = x % 2 ? INK.moss : INK.leaf; b.fillRect(x, GROUND_Y, 2, 1); if (x % 9 === 0) b.fillRect(x + 1, GROUND_Y - 1, 1, 1); }
    const white = (rows) => rows.map((r) => sprite(r, null, false, INK.white));
    // Glow-worms that wake and dim on the cave's ceiling, [x, y, phase] each.
    const worms = new Float32Array(WORMS * 3);
    for (let k = 0; k < WORMS; k++) { worms[k * 3] = 4 + Math.floor(dots() * (W - 8)); worms[k * 3 + 1] = 12 + Math.floor(dots() * 40); worms[k * 3 + 2] = dots() * 3; }
    invArt = {
      back, worms, ooga: both(OOGA_ROWS, OOGA_INKS),
      kinds: [both(PTERO_ROWS, PTERO_INKS), both(BEETLE_ROWS, BEETLE_INKS), both(BUG_ROWS, BUG_INKS)],
      mammoth: [both(MAMMOTH_ROWS, MAMMOTH_INKS), MAMMOTH_ROWS.map((r) => sprite(r, MAMMOTH_INKS, true))], mammothHit: white(MAMMOTH_ROWS),
      nut: [NUT_ROWS, quarter(NUT_ROWS), quarter(quarter(NUT_ROWS)), quarter(quarter(quarter(NUT_ROWS)))].map((r) => sprite(r, NUT_INKS)),
      gold: sprite(GOLD_ROWS, GOLD_INKS), head: sprite(HEAD_ROWS, OOGA_INKS)
    };
    return invArt;
  };
  // The host's callouts, only where play stands still (a wave's end, a lost Ooga); in play the screen says it itself.
  const INV_SAY = { clear: worded("Wave clear! +"), won: worded("Cave saved! +"), landed: "They landed!", ouch: "Ooga bonked!" };
  const COS8 = new Float32Array(8), SIN8 = new Float32Array(8);
  for (let k = 0; k < 8; k++) { COS8[k] = Math.cos(k * Math.PI / 4); SIN8[k] = Math.sin(k * Math.PI / 4); }

  const invaders = (host) => {
    const out = hooks(host), aim = out.aim, status = makeStatus("Lives"), art = invadersArt(), R = rng(), J = juice(host);
    const fx = sparks(180, INV_SPARKS, 110);
    // The creatures: alive, kind, dive state (0 in the formation, 1 looping out, 2 diving, 3 flying home), where
    // each is, its dive clock, sway and the side it loops to, and whether it has dropped its bomb this dive.
    const E = { alive: new Uint8Array(INV_N), kind: new Uint8Array(INV_N), dive: new Uint8Array(INV_N), bombed: new Uint8Array(INV_N), side: new Int8Array(INV_N),
      x: new Float32Array(INV_N), y: new Float32Array(INV_N), t: new Float32Array(INV_N), vx: new Float32Array(INV_N), ox: new Float32Array(INV_N), oy: new Float32Array(INV_N) };
    for (let i = 0; i < INV_N; i++) E.kind[i] = ROW_KIND[Math.floor(i / INV_COLS)];
    // Thrown coconuts, enemy bombs, the shields' cells, the score numbers floating up and the burst rings.
    const C = { alive: new Uint8Array(COCONUTS), gold: new Uint8Array(COCONUTS), hit: new Uint8Array(COCONUTS), x: new Float32Array(COCONUTS), y: new Float32Array(COCONUTS) };
    const B = { alive: new Uint8Array(BOMBS), kind: new Uint8Array(BOMBS), x: new Float32Array(BOMBS), y: new Float32Array(BOMBS), v: new Float32Array(BOMBS) };
    const SH = new Uint8Array(SHIELD_X.length * SHIELD_CELLS);
    const POPS = 8, PN = { value: new Int32Array(POPS), x: new Float32Array(POPS), y: new Float32Array(POPS), t: new Float32Array(POPS), next: 0 };
    const RINGS = 8, RG = { x: new Float32Array(RINGS), y: new Float32Array(RINGS), t: new Float32Array(RINGS), size: new Float32Array(RINGS), next: 0 };
    // The run on one object, so a frame's writes change it in place: the formation (`fx`, `fy` and where this wave
    // starts it, `dir`, how far it has marched for its step animation, `left` alive, its column and row bounds),
    // the Ooga (`px`, `inv` seconds untouchable, `throwT` its throw pose, `alive`), the timers (`cool`, `fireT`,
    // `diveT`, `mamT`, `timer` for the phase), the mammoth, the streak and golden coconut, and the run's tally; the
    // aim last seen (`ax`), whether the Ooga walks to it (`follow`), and the extra Ooga's 1UP (`upT`).
    const S = { fx: 0, fy: 0, fy0: 0, dir: 1, march: 0, left: 0, minC: 0, maxC: 0, maxR: 0, px: 74, inv: 0, throwT: 0, alive: 1, cool: 0, fireT: 0, diveT: 0, mamT: 0, timer: 0,
      diving: 0, streak: 0, golden: 0, charge: 0, beat: 0, extra: 0, clock: 0, walk: 0, wave: 1, lives: LIVES, mx: 0, mdir: 1, mon: 0, mwalk: 0, mhit: 0, throws: 0, hits: 0, divers: 0, mammoths: 0, cleared: 0, seed: 0, won: 0,
      ax: 0, follow: 0, upT: 0 };
    let phase = "idle";
    const bounds = () => {
      let minC = INV_COLS, maxC = -1, maxR = -1;
      for (let i = 0; i < INV_N; i++) {
        if (!E.alive[i]) continue;
        const c = i % INV_COLS, r = Math.floor(i / INV_COLS);
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r > maxR) maxR = r;
      }
      S.minC = minC; S.maxC = maxC; S.maxR = maxR;
    };
    const slotX = (i) => S.fx + (i % INV_COLS) * GAP_X + ((SLOT_W - KIND_W[E.kind[i]]) >> 1);
    const slotY = (i) => S.fy + Math.floor(i / INV_COLS) * GAP_Y;
    const buildShields = () => {
      for (let s = 0; s < SHIELD_X.length; s++) for (let r = 0; r < SHIELD_ROWS; r++) for (let c = 0; c < SHIELD_COLS; c++) SH[s * SHIELD_CELLS + r * SHIELD_COLS + c] = SHIELD_SHAPE[r][c] === "#" ? 1 : 0;
    };
    // The shield cell under a point, or -1.
    const cellAt = (x, y) => {
      if (y < SHIELD_Y || y >= SHIELD_Y + SHIELD_ROWS * 2) return -1;
      for (let s = 0; s < SHIELD_X.length; s++) {
        const dx = x - SHIELD_X[s];
        if (dx < 0 || dx >= SHIELD_COLS * 2) continue;
        const i = s * SHIELD_CELLS + Math.floor((y - SHIELD_Y) / 2) * SHIELD_COLS + Math.floor(dx / 2);
        return SH[i] ? i : -1;
      }
      return -1;
    };
    // A hit knocks out the cells within `r` px of it, and a ragged ring round that by the seeded draw, throwing dust.
    const crumble = (x, y, r) => {
      for (let s = 0; s < SHIELD_X.length; s++) {
        if (x < SHIELD_X[s] - r - 2 || x > SHIELD_X[s] + SHIELD_COLS * 2 + r + 2) continue;
        for (let i = 0; i < SHIELD_CELLS; i++) {
          const k = s * SHIELD_CELLS + i;
          if (!SH[k]) continue;
          const cx = SHIELD_X[s] + (i % SHIELD_COLS) * 2 + 1, cy = SHIELD_Y + Math.floor(i / SHIELD_COLS) * 2 + 1, d = Math.hypot(cx - x, cy - y);
          if (d <= r || (d <= r + 2 && R.chance(0.45))) SH[k] = 0;
        }
      }
      fx.spawn(x, y, 5, 28, S_STONE, S_STONE + 1, 0.4);
    };
    const ring = (x, y, size) => {
      const i = RG.next;
      RG.next = (RG.next + 1) % RINGS;
      RG.x[i] = x; RG.y[i] = y; RG.t[i] = 0.001; RG.size[i] = size;
    };
    const pop = (x, y, value) => {
      const i = PN.next;
      PN.next = (PN.next + 1) % POPS;
      PN.value[i] = value; PN.x[i] = x; PN.y[i] = y; PN.t[i] = 0.001;
    };
    const setVerb = () => { status.verb = S.alive && (phase === "entry" || phase === "play") ? "Throw!" : ""; };
    const addScore = (n) => {
      status.score += n;
      if (!S.extra && status.score >= EXTRA_AT) {
        S.extra = 1; S.lives++; status.left = S.lives; S.upT = UP_S;
        out.cue("coin");
      }
    };
    const setStreak = (n) => {
      S.streak = n;
      status.streak = n;
      status.mult = n >= 15 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : 1;
    };
    // The Ooga's coconut went by everything: the streak breaks, and a long one is groaned at. One still flying when
    // the wave is cleared or the Ooga is bonked is no miss.
    const missed = () => {
      if (phase !== "play" && phase !== "entry") return;
      if (S.streak >= 5) out.flop();
      setStreak(0);
      S.charge = 0;
    };
    const startWave = (w) => {
      S.wave = w; status.round = w;
      for (let i = 0; i < INV_N; i++) { E.alive[i] = 1; E.dive[i] = 0; }
      S.left = INV_N; S.diving = 0; S.beat = 0; bounds();
      S.fx = (W - (INV_COLS - 1) * GAP_X - SLOT_W) >> 1; S.fy0 = 20 + (w - 1) * 3; S.fy = S.fy0 - 48; S.dir = 1; S.march = 0;
      B.alive.fill(0);
      buildShields();
      S.fireT = 1.6; S.diveT = 4 + R.next() * 2; S.mamT = 12 + R.next() * 8; S.mon = 0;
      phase = "entry"; S.timer = ENTRY;
      setVerb();
    };
    // A creature taken out: its points (twice while diving) times the streak's multiplier, sparks, a ring and a
    // number; a golden coconut's blast takes the ones round it too.
    const kill = (i, gold) => {
      E.alive[i] = 0;
      const k = E.kind[i], diving = E.dive[i] !== 0, cx = E.x[i] + KIND_W[k] / 2, cy = E.y[i] + KIND_H[k] / 2;
      if (diving) { S.diving--; S.divers++; }
      setStreak(S.streak + 1);
      S.hits++;
      const pts = POINTS[k] * (diving ? 2 : 1) * status.mult;
      addScore(pts);
      pop(cx, cy - 4, pts);
      fx.spawn(cx, cy, diving || gold ? 20 : 13, diving ? 70 : 55, KIND_SPARK[k], KIND_SPARK[k] + 1, 0.55);
      ring(cx, cy, diving ? 9 : 6);
      J.shake(diving || gold ? 2 : 1);
      out.cue(diving ? "clang" : "bonk");
      if (!gold && !S.golden && ++S.charge >= GOLD_EVERY) {
        S.charge = 0; S.golden = 1; status.fire = true;
        out.cue("fire");
        out.crack(false);
      }
      S.left--;
      bounds();
    };
    const blast = (x, y) => {
      for (let i = 0; i < INV_N; i++) {
        if (!E.alive[i]) continue;
        const k = E.kind[i];
        if (Math.hypot(E.x[i] + KIND_W[k] / 2 - x, E.y[i] + KIND_H[k] / 2 - y) < BLAST) kill(i, true);
      }
      ring(x, y, 14);
      fx.spawn(x, y, 16, 80, S_GOLD, S_GOLD + 1, 0.6);
      J.flash(INK.banana, 0.3);
    };
    const waveCleared = () => {
      S.cleared++;
      const bonus = 100 * S.wave;
      addScore(bonus);
      B.alive.fill(0);
      out.crack(true);
      J.flash(INK.teal, 0.35);
      if (S.wave >= WAVES) {
        const won = 500 * S.lives + 1000;
        addScore(won);
        S.won = 1;
        out.popup(INV_SAY.won(bonus + won), true);
        out.cue("win"); out.over();
        phase = "won"; S.timer = OVER_S + 0.6;
      } else {
        out.popup(INV_SAY.clear(bonus), true);
        out.cue("round");
        phase = "clear"; S.timer = CLEAR_S;
      }
      setVerb();
    };
    const hitPlayer = (landed) => {
      S.alive = 0;
      S.lives = landed ? 0 : S.lives - 1;
      status.left = S.lives;
      const cx = S.px + PW / 2, cy = PLAYER_Y + PH / 2;
      fx.spawn(cx, cy, 26, 75, S_OOGA, S_OOGA + 1, 0.8);
      fx.spawn(cx, cy, 14, 50, S_GOLD, S_GOLD + 1, 0.5);
      ring(cx, cy, 16);
      J.shake(5); J.flash(INK.red, 0.55);
      out.shake(0.8); out.cue("slam"); out.flop();
      out.popup(landed ? INV_SAY.landed : INV_SAY.ouch, landed);
      setStreak(0);
      B.alive.fill(0);
      for (let i = 0; i < INV_N; i++) if (E.alive[i] && (E.dive[i] === 1 || E.dive[i] === 2)) { E.dive[i] = 3; E.y[i] = Math.min(E.y[i], -12); }
      phase = S.lives > 0 ? "dead" : "over";
      S.timer = S.lives > 0 ? DEAD_S : OVER_S;
      if (S.lives <= 0) out.over();
      setVerb();
    };
    const finish = () => {
      phase = "done";
      setVerb();
      status.note = `Waves ${S.cleared}/${WAVES} · divers ${S.divers} · mammoths ${S.mammoths}`;
      out.cue(S.won ? "big" : "buzzer");
      out.onEnd(status.score);
    };
    // Throw a coconut: at most two in the air (a golden one besides), after a short cooldown.
    const throwCoconut = () => {
      if (!S.alive || S.cool > 0 || !(phase === "entry" || phase === "play")) return;
      let inAir = 0, free = -1;
      for (let k = 0; k < COCONUTS; k++) { if (C.alive[k]) { if (!C.gold[k]) inAir++; } else if (free < 0) free = k; }
      const gold = S.golden === 1;
      if (free < 0 || (!gold && inAir >= IN_AIR)) return;
      C.alive[free] = 1; C.gold[free] = gold ? 1 : 0; C.hit[free] = 0; C.x[free] = S.px + PW / 2; C.y[free] = PLAYER_Y - 2;
      S.cool = gold ? GOLD_COOL : COOL; S.throwT = 0.16; S.throws++;
      if (gold) { S.golden = 0; status.fire = false; out.cue("swish"); J.flash(INK.banana, 0.2); }
      else out.cue("throw");
    };
    const bombFrom = (x, y, kind) => {
      for (let k = 0; k < BOMBS; k++) {
        if (B.alive[k]) continue;
        B.alive[k] = 1; B.kind[k] = kind; B.x[k] = x; B.y[k] = y; B.v[k] = (kind ? 46 : 58) + S.wave * 6;
        return;
      }
    };
    // The formation fires from the lowest creature of a column: a random one, or now and then the one over the Ooga.
    const fire = () => {
      let col = -1;
      if (R.chance(0.3)) col = Math.max(S.minC, Math.min(S.maxC, Math.floor((S.px + PW / 2 - S.fx) / GAP_X)));
      for (let tries = 0; tries < 8; tries++) {
        const c = col >= 0 ? col : S.minC + R.int(S.maxC - S.minC + 1);
        col = -1;
        for (let r = INV_ROWS - 1; r >= 0; r--) {
          const i = r * INV_COLS + c;
          if (!E.alive[i] || E.dive[i]) continue;
          const k = E.kind[i];
          bombFrom(E.x[i] + KIND_W[k] / 2, E.y[i] + KIND_H[k], DROPS[k]);
          return;
        }
      }
    };
    const startDive = () => {
      let pick = -1, seen = 0;
      for (let pass = 0; pass < 2 && pick < 0; pass++) {
        for (let i = pass * INV_COLS; i < (pass + 1) * INV_COLS; i++) {
          if (!E.alive[i] || E.dive[i]) continue;
          seen++;
          if (R.int(seen) === 0) pick = i;
        }
      }
      if (pick < 0) return;
      E.dive[pick] = 1; E.t[pick] = 0; E.bombed[pick] = 0; E.vx[pick] = 0;
      E.ox[pick] = E.x[pick]; E.oy[pick] = E.y[pick]; E.side[pick] = E.x[pick] + KIND_W[E.kind[pick]] / 2 < W / 2 ? -1 : 1;
      S.diving++;
      out.cue("chirp");
    };
    const overlaps = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    const hitsPlayer = (x, y, w, h) => S.alive && S.inv <= 0 && overlaps(x, y, w, h, S.px + 1, PLAYER_Y + 1, PW - 2, PH - 1);

    const stepCoconuts = (h) => {
      for (let k = 0; k < COCONUTS; k++) {
        if (!C.alive[k]) continue;
        const gold = C.gold[k] === 1;
        C.y[k] -= (gold ? GOLD_SPEED : COCONUT_SPEED) * h;
        const x = C.x[k], y = C.y[k];
        if (y < TOP_Y) { C.alive[k] = 0; if (!C.hit[k]) missed(); continue; }
        // A coconut knocks a bomb out of the air.
        for (let b = 0; b < BOMBS; b++) {
          if (!B.alive[b] || Math.abs(B.x[b] - x) > 3 || Math.abs(B.y[b] - y) > 4) continue;
          B.alive[b] = 0; C.hit[k] = 1;
          addScore(5);
          fx.spawn(x, y, 6, 35, S_STONE, S_STONE + 1, 0.35);
          out.cue("clack");
          if (!gold) C.alive[k] = 0;
          break;
        }
        if (!C.alive[k]) continue;
        if (S.mon && !S.mhit && overlaps(x - 2, y - 2, 4, 4, S.mx, MAMMOTH_Y, 16, 10)) {
          const pays = MAMMOTH_PAYS[R.int(MAMMOTH_PAYS.length)];
          S.mhit = 0.5; S.mammoths++; C.hit[k] = 1;
          setStreak(S.streak + 1);
          addScore(pays);
          pop(S.mx + 8, MAMMOTH_Y + 12, pays);
          fx.spawn(S.mx + 8, MAMMOTH_Y + 5, 34, 85, S_MAMMOTH, S_MAMMOTH + 1, 0.8);
          ring(S.mx + 8, MAMMOTH_Y + 5, 18);
          J.shake(4); J.flash(INK.gold, 0.4);
          out.cue("big"); out.crack(true);
          if (!gold) { C.alive[k] = 0; continue; }
        }
        for (let i = 0; i < INV_N; i++) {
          if (!E.alive[i]) continue;
          const kind = E.kind[i];
          if (!overlaps(x - 1.5, y - 2, 3, 4, E.x[i], E.y[i], KIND_W[kind], KIND_H[kind])) continue;
          C.hit[k] = 1;
          kill(i, gold);
          if (gold) blast(x, y);
          else { C.alive[k] = 0; break; }
        }
        if (!C.alive[k] || gold) continue;
        if (cellAt(x, y) >= 0) { crumble(x, y, 2); C.alive[k] = 0; out.cue("thunk"); if (!C.hit[k]) missed(); }
      }
    };
    const stepBombs = (h) => {
      for (let b = 0; b < BOMBS; b++) {
        if (!B.alive[b]) continue;
        B.y[b] += B.v[b] * h;
        const x = B.x[b], y = B.y[b];
        if (y > GROUND_Y) { B.alive[b] = 0; fx.spawn(x, GROUND_Y, 3, 20, S_STONE, S_STONE + 1, 0.3); continue; }
        if (cellAt(x, y + 2) >= 0) { crumble(x, y + 2, B.kind[b] ? 3 : 2.2); B.alive[b] = 0; out.cue("thunk"); continue; }
        if (hitsPlayer(x - 1, y, 2, 3)) { B.alive[b] = 0; hitPlayer(false); return; }
      }
    };
    // The formation marches across and steps down at each edge, faster as it thins, chewing through any shield it
    // reaches; reaching the Ooga's line is the end.
    const march = (h) => {
      const speed = (7 + (S.wave - 1) * 2) * (1 + 2.3 * (1 - S.left / INV_N));
      S.fx += S.dir * speed * h;
      S.march += speed * h;
      // The march's drum, a beat every few pixels, so it quickens as the formation does.
      const beat = S.march / 7 | 0;
      if (beat !== S.beat) { S.beat = beat; out.cue("tap", 0.35 + 0.35 * (1 - S.left / INV_N)); }
      const left = S.fx + S.minC * GAP_X, right = S.fx + S.maxC * GAP_X + SLOT_W;
      if ((S.dir < 0 && left <= EDGE_L) || (S.dir > 0 && right >= EDGE_R)) {
        S.fx += S.dir < 0 ? EDGE_L - left : EDGE_R - right;
        S.dir = -S.dir;
        S.fy += 4;
      }
      for (let i = 0; i < INV_N; i++) if (E.alive[i] && !E.dive[i]) { E.x[i] = slotX(i); E.y[i] = slotY(i); }
      const bottom = S.fy + S.maxR * GAP_Y + 8;
      if (bottom >= SHIELD_Y) for (let i = 0; i < INV_N; i++) {
        if (!E.alive[i] || E.dive[i]) continue;
        const k = E.kind[i];
        for (let x = E.x[i]; x < E.x[i] + KIND_W[k]; x += 2) for (let y = E.y[i]; y < E.y[i] + KIND_H[k]; y += 2) { const c = cellAt(x, y); if (c >= 0) SH[c] = 0; }
      }
      if (bottom >= LAND_Y && S.alive) hitPlayer(true);
    };
    // A diver loops out of its slot, swoops down on the Ooga weaving and dropping a bomb on the way, leaves by the
    // bottom and flies back into its slot from the top.
    const stepDivers = (h) => {
      for (let i = 0; i < INV_N; i++) {
        const d = E.dive[i];
        if (!E.alive[i] || !d) continue;
        E.t[i] += h;
        const t = E.t[i], k = E.kind[i];
        if (d === 1) {
          const a = Math.min(1, t / 0.5) * Math.PI;
          E.x[i] = E.ox[i] + E.side[i] * 9 * (1 - Math.cos(a)); E.y[i] = E.oy[i] - 9 * Math.sin(a);
          if (t >= 0.5) { E.dive[i] = 2; E.t[i] = 0; }
        } else if (d === 2) {
          const want = Math.max(-48, Math.min(48, (S.px + PW / 2 - E.x[i] - KIND_W[k] / 2) * 1.4));
          E.vx[i] += (want - E.vx[i]) * Math.min(1, h * 3);
          E.x[i] += (E.vx[i] + Math.sin(t * 7) * 18) * h;
          E.y[i] += (50 + S.wave * 8) * h;
          if (!E.bombed[i] && E.y[i] > 52) { E.bombed[i] = 1; bombFrom(E.x[i] + KIND_W[k] / 2, E.y[i] + KIND_H[k], 1); }
          // A diver that reaches the Ooga goes down with it and pays nothing.
          if (hitsPlayer(E.x[i], E.y[i], KIND_W[k], KIND_H[k])) {
            E.alive[i] = 0; S.diving--; S.left--;
            bounds();
            fx.spawn(E.x[i] + KIND_W[k] / 2, E.y[i] + KIND_H[k] / 2, 13, 55, KIND_SPARK[k], KIND_SPARK[k] + 1, 0.55);
            hitPlayer(false);
            return;
          }
          if (E.y[i] > H + 4) { E.dive[i] = 3; E.y[i] = -12; E.x[i] = slotX(i); }
        } else {
          const dx = slotX(i) - E.x[i], dy = slotY(i) - E.y[i], dist = Math.hypot(dx, dy);
          if (dist < 1.5) { E.dive[i] = 0; S.diving--; E.x[i] = slotX(i); E.y[i] = slotY(i); }
          else { const v = Math.min(dist, 75 * h); E.x[i] += dx / dist * v; E.y[i] += dy / dist * v; }
        }
      }
    };
    const stepMammoth = (h) => {
      S.mhit = Math.max(0, S.mhit - h);
      if (S.mon) {
        if (S.mhit > 0) { if (S.mhit <= h) { S.mon = 0; S.mamT = 14 + R.next() * 10; } return; }
        S.mx += S.mdir * MAMMOTH_SPEED * h; S.mwalk += h;
        if (S.mx < -20 || S.mx > W + 4) { S.mon = 0; S.mamT = 14 + R.next() * 10; }
        return;
      }
      S.mamT -= h;
      if (S.mamT <= 0 && S.left >= 6) { S.mon = 1; S.mdir = R.chance(0.5) ? 1 : -1; S.mx = S.mdir > 0 ? -18 : W + 2; S.mwalk = 0; out.cue("knock"); }
    };
    const step = (h) => {
      S.cool = Math.max(0, S.cool - h);
      S.throwT = Math.max(0, S.throwT - h);
      S.inv = Math.max(0, S.inv - h);
      // A held key walks the Ooga while it is held, so it stops where the key lets go; a drag or the mouse sets a spot
      // it walks to.
      if (S.alive) {
        const want = W / 2 + aim.x * 72 - PW / 2, reach = PLAYER_SPEED * h;
        const dx = aim.hold ? aim.hold * reach : S.follow ? Math.max(-reach, Math.min(reach, want - S.px)) : 0;
        S.px = Math.max(EDGE_L, Math.min(EDGE_R - PW, S.px + dx));
        if (Math.abs(dx) > 0.05) S.walk += h;
      }
      stepCoconuts(h);
      if (phase === "entry") {
        S.timer -= h;
        const k = Math.max(0, S.timer / ENTRY);
        S.fy = S.fy0 - 48 * k * k;
        for (let i = 0; i < INV_N; i++) { E.x[i] = slotX(i); E.y[i] = slotY(i); }
        if (S.timer <= 0) { S.fy = S.fy0; phase = "play"; setVerb(); }
      } else if (phase === "play") {
        march(h);
        if (phase !== "play") return;
        stepDivers(h);
        if (phase !== "play") return;
        stepMammoth(h);
        S.fireT -= h;
        if (S.fireT <= 0) { S.fireT = Math.max(0.42, 1.55 - 0.22 * (S.wave - 1)) * (0.55 + R.next() * 0.9) * (0.6 + 0.4 * S.left / INV_N); fire(); }
        S.diveT -= h;
        if (S.diveT <= 0) { S.diveT = Math.max(2, 5.8 - 0.8 * (S.wave - 1)) * (0.7 + R.next() * 0.6); if (S.diving < (S.wave >= 3 ? 2 : 1)) startDive(); }
        if (S.left <= 0) waveCleared();
      } else if (phase === "dead") {
        stepDivers(h);
        S.timer -= h;
        if (S.timer <= 0) { S.alive = 1; S.inv = INVULNERABLE; phase = "play"; setVerb(); }
      } else if (phase === "clear") {
        S.timer -= h;
        if (S.timer <= 0) startWave(S.wave + 1);
      } else if (phase === "over" || phase === "won") {
        S.timer -= h;
        if (S.timer <= 0) finish();
      }
      stepBombs(h);
    };
    const run = stepper(step);

    // ---- drawing --------------------------------------------------------------------------------------------
    const drawShields = (ctx) => {
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? INK.stoneLt : INK.stone;
        for (let s = 0; s < SHIELD_X.length; s++) for (let i = 0; i < SHIELD_CELLS; i++) {
          const k = s * SHIELD_CELLS + i;
          if (!SH[k]) continue;
          const c = i % SHIELD_COLS, r = Math.floor(i / SHIELD_COLS), lit = r === 0 || !SH[k - SHIELD_COLS];
          if ((pass === 1) !== lit) continue;
          ctx.fillRect(SHIELD_X[s] + c * 2, SHIELD_Y + r * 2, 2, 2);
        }
      }
    };
    const drawHud = (ctx) => {
      // The band laid again over the play, so a wave dropping in and sparks flying up pass behind the score.
      ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, TOP_Y - 1);
      ctx.fillStyle = INK.rule; ctx.fillRect(0, TOP_Y - 1, W, 1);
      number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
      if (status.mult > 1) { text(ctx, "X", 36, 1, TEXT.ember); number(ctx, status.mult, 42, 1, TEXT.ember); }
      if (S.golden && (S.clock * 4 | 0) % 2) blit(ctx, art.gold, 50, 1);
      // The golden coconut's charge, a pip a hit, all lit and blinking once it is ready.
      for (let k = 0; k < GOLD_EVERY; k++) {
        ctx.fillStyle = S.golden ? ((S.clock * 4 | 0) % 2 ? INK.banana : INK.gold) : k < S.charge ? INK.banana : INK.rule;
        ctx.fillRect(100 + k * 3, 3, 2, 3);
      }
      text(ctx, "WAVE", 64, 1, TEXT.teal);
      number(ctx, S.wave, 89, 1, TEXT.teal);
      for (let k = 0; k < S.lives && k < 6; k++) blit(ctx, art.head, W - 8 - k * 7, 2);
    };
    const drawPlay = (ctx) => {
      J.begin(ctx);
      if (S.mon) {
        const hit = S.mhit > 0, frame = (S.mwalk * 5 | 0) & 1;
        blit(ctx, hit && (S.clock * 20 | 0) % 2 ? art.mammothHit[frame] : art.mammoth[S.mdir > 0 ? 0 : 1][frame], S.mx, MAMMOTH_Y);
      }
      drawShields(ctx);
      const beat = (S.march / 5 | 0) & 1;
      for (let i = 0; i < INV_N; i++) {
        if (!E.alive[i]) continue;
        const frame = E.dive[i] ? (E.t[i] * 9 | 0) & 1 : beat;
        blit(ctx, art.kinds[E.kind[i]][frame], E.x[i], E.y[i]);
      }
      // Bombs big enough to see on a phone: a rock 3x3 lit on its top left, spit a pale drop on a trail.
      for (let b = 0; b < BOMBS; b++) {
        if (!B.alive[b]) continue;
        const bx = Math.round(B.x[b]), by = Math.round(B.y[b]);
        if (B.kind[b]) { ctx.fillStyle = INK.stoneDk; ctx.fillRect(bx - 1, by, 3, 3); ctx.fillStyle = INK.stoneLt; ctx.fillRect(bx - 1, by, 2, 2); }
        else { const sx = Math.round(B.x[b] + Math.sin(B.y[b] * 0.6)) - 1; ctx.fillStyle = SPIT_TRAIL; ctx.fillRect(sx, by - 1, 2, 4); ctx.fillStyle = SPIT; ctx.fillRect(sx, by + 1, 2, 2); }
      }
      for (let k = 0; k < COCONUTS; k++) {
        if (!C.alive[k]) continue;
        if (C.gold[k]) {
          ctx.fillStyle = INK.gold; ctx.fillRect(Math.round(C.x[k]) - 1, Math.round(C.y[k]) + 3, 2, 4);
          ctx.fillStyle = INK.ember; ctx.fillRect(Math.round(C.x[k]), Math.round(C.y[k]) + 7, 1, 3);
          blit(ctx, art.gold, C.x[k] - 2.5, C.y[k] - 2.5);
        } else blit(ctx, art.nut[(C.y[k] / 6 | 0) & 3], C.x[k] - 2, C.y[k] - 2);
      }
      if (S.alive && !(S.inv > 0 && (S.clock * 12 | 0) % 2)) blit(ctx, art.ooga[S.throwT > 0 ? 2 : (S.walk * 8 | 0) & 1], S.px, PLAYER_Y);
      // The golden coconut waiting in the Ooga's hands.
      if (S.alive && S.golden && S.throwT <= 0) blit(ctx, art.gold, S.px + 3, PLAYER_Y - 5);
      fx.draw(ctx);
      ctx.fillStyle = INK.cream;
      for (let i = 0; i < RINGS; i++) {
        if (RG.t[i] <= 0) continue;
        const r = 2 + RG.size[i] * RG.t[i] / 0.2;
        for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(RG.x[i] + COS8[k] * r), Math.round(RG.y[i] + SIN8[k] * r), 1, 1);
      }
      // Points float up, never into the top band's score and wave; an extra Ooga floats a 1UP off the Ooga.
      for (let i = 0; i < POPS; i++) if (PN.t[i] > 0 && (PN.t[i] < 0.6 || (S.clock * 16 | 0) % 2)) number(ctx, PN.value[i], Math.round(PN.x[i]), Math.max(TOP_Y + 1, Math.round(PN.y[i] - PN.t[i] * 14)), TEXT.banana, 1, 1);
      if (S.upT > 0 && (S.upT > 0.6 || (S.clock * 16 | 0) % 2)) text(ctx, "1UP", Math.round(S.px) - 3, PLAYER_Y - 10 - Math.round((UP_S - S.upT) * 8), TEXT.lime);
      J.end(ctx);
    };
    const drawAttract = (ctx) => {
      centre(ctx, "COCONUT", 14, TEXT.gold, 2);
      centre(ctx, "INVADERS", 32, TEXT.teal, 2);
      const f = (S.clock * 2 | 0) & 1;
      blit(ctx, art.mammoth[0][f], 44, 54); text(ctx, "= ???", 66, 56, TEXT.bone);
      blit(ctx, art.kinds[0][f], 46, 68); text(ctx, "= 30", 66, 68, TEXT.violet);
      blit(ctx, art.kinds[1][f], 47, 79); text(ctx, "= 20", 66, 80, TEXT.teal);
      blit(ctx, art.kinds[2][f], 48, 91); text(ctx, "= 10", 66, 91, TEXT.lime);
      if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 104, TEXT.bone);
      text(ctx, "HI", 3, 1, TEXT.stone);
      number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
    };
    const drawBanner = (ctx) => {
      if (phase === "entry" && S.timer > 0.15) {
        if (S.wave === WAVES) centre(ctx, "LAST WAVE!", 64, TEXT.gold, 2);
        else { centre(ctx, "WAVE", 58, TEXT.teal, 2); number(ctx, S.wave, W / 2, 76, TEXT.bone, 2, 1); }
      } else if (phase === "clear") centre(ctx, "WAVE CLEAR!", 58, TEXT.teal, 2);
      else if (phase === "done") {
        ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, TOP_Y, W, GROUND_Y - TOP_Y); ctx.globalAlpha = 1;
        centre(ctx, S.won ? "CAVE SAVED!" : "GAME OVER", 40, S.won ? TEXT.gold : TEXT.red, 2);
        centre(ctx, "SCORE", 62, TEXT.stone);
        number(ctx, status.score, W / 2, 72, TEXT.banana, 2, 1);
      }
    };

    const reset = () => {
      E.alive.fill(0); C.alive.fill(0); B.alive.fill(0); PN.t.fill(0); RG.t.fill(0);
      fx.clear(); J.reset();
      buildShields();
      S.alive = 1; S.px = (W - PW) / 2; S.inv = S.cool = S.throwT = 0; S.mon = 0; S.golden = S.charge = 0; S.upT = 0; S.follow = 0; S.ax = aim.x;
      status.fire = false; status.meter = -1; status.target = 0; status.note = "";
      setStreak(0);
    };
    reset();
    status.left = LIVES;
    return {
      kind: "invaders", name: "Coconut Invaders", aims: true, status,
      help: "Drag, arrows or A and D move your Ooga; Space or tap throws. Eight hits in a row charge a golden coconut. Five waves.",
      coach: ["A and D move, Space throws a coconut", "Drag to move, tap to throw"],
      stars: [1500, 3500, 6500], tickets: (score) => Math.floor(score / 130),
      get playing() { return phase !== "idle" && phase !== "done"; },
      get seed() { return S.seed; },
      start: (seed) => {
        if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
        reset();
        status.score = 0; S.lives = LIVES; status.left = LIVES; S.extra = S.won = 0;
        S.throws = S.hits = S.divers = S.mammoths = S.cleared = 0;
        startWave(1);
      },
      stop: () => { phase = "idle"; reset(); status.round = 1; status.left = LIVES; setVerb(); },
      act: throwCoconut,
      update: (dt) => {
        S.clock += dt;
        S.upT = Math.max(0, S.upT - dt);
        J.update(dt);
        fx.update(dt);
        for (let i = 0; i < POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
        for (let i = 0; i < RINGS; i++) if (RG.t[i] > 0) { RG.t[i] += dt; if (RG.t[i] > 0.2) RG.t[i] = 0; }
        // Read once a frame, as the scene moves the aim: a key held stops the walk to a spot, and a spot moved without
        // one (a drag, the mouse) starts it.
        if (aim.hold) S.follow = 0;
        else if (aim.x !== S.ax) S.follow = 1;
        S.ax = aim.x;
        if (phase !== "idle" && phase !== "done") run(dt);
      },
      draw: (ctx) => {
        ctx.drawImage(art.back, 0, 0);
        ctx.fillStyle = INK.teal;
        for (let k = 0; k < WORMS; k++) if ((S.clock * 0.8 + art.worms[k * 3 + 2]) % 3 < 1.1) ctx.fillRect(art.worms[k * 3], art.worms[k * 3 + 1], 1, 1);
        if (phase === "idle") { drawAttract(ctx); return; }
        drawPlay(ctx);
        drawHud(ctx);
        drawBanner(ctx);
      }
    };
  };

  // ---- the placeholder ------------------------------------------------------------------------------------
  // What each unbuilt game plays until its builder replaces it: the whole interface over a thirty-second coconut
  // catch (aim slides the Ooga under falling coconuts, act hops), so its cabinet, card, HUD, save and tickets work
  // end to end already. `spec` is { kind, name, help, coach, stars, per (score a ticket), ink (its title's TEXT ink) }.
  const PLACEHOLDER_S = 30;
  const placeholder = (host, spec) => {
    const out = hooks(host), aim = out.aim, status = makeStatus("Time"), art = invadersArt(), R = rng(), fx = sparks(40, INV_SPARKS), title = spec.name.toUpperCase();
    const S = { t: 0, x: (W - PW) / 2, nx: 80, ny: -6, nv: 40, hop: 0, clock: 0, seed: 0 };
    let phase = "idle";
    const drop = () => { S.nx = 10 + R.next() * (W - 20); S.ny = TOP_Y; S.nv = 40 + R.next() * 30; };
    const run = stepper((h) => {
      S.t -= h;
      S.hop = Math.max(0, S.hop - h);
      const want = W / 2 + aim.x * 72 - PW / 2;
      S.x += Math.max(-PLAYER_SPEED * h, Math.min(PLAYER_SPEED * h, want - S.x));
      S.ny += S.nv * h;
      if (S.ny > PLAYER_Y - 2 && S.ny < PLAYER_Y + 4 && S.nx > S.x - 1 && S.nx < S.x + PW + 1) {
        status.score += 10;
        fx.spawn(S.nx, S.ny, 10, 40, S_GOLD, S_GOLD + 1);
        out.cue("bonk");
        drop();
      } else if (S.ny > GROUND_Y) { fx.spawn(S.nx, GROUND_Y, 4, 20, S_STONE, S_STONE + 1); drop(); }
      const secs = Math.max(0, Math.ceil(S.t));
      if (secs !== status.left) status.left = secs;
      if (S.t <= 0) { phase = "done"; status.verb = ""; out.cue("buzzer"); out.onEnd(status.score); }
    });
    return {
      kind: spec.kind, name: spec.name, help: spec.help, coach: spec.coach, stars: spec.stars, aims: true, status,
      tickets: (score) => Math.floor(score / spec.per),
      get playing() { return phase === "play"; },
      get seed() { return S.seed; },
      start: (seed) => {
        if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
        phase = "play"; status.score = 0; S.t = PLACEHOLDER_S; status.left = PLACEHOLDER_S; status.verb = "Hop!"; drop();
      },
      stop: () => { phase = "idle"; status.verb = ""; status.left = PLACEHOLDER_S; fx.clear(); },
      act: () => { if (phase === "play" && S.hop <= 0) { S.hop = 0.3; out.cue("tick"); } },
      update: (dt) => {
        S.clock += dt;
        fx.update(dt);
        if (phase === "play") run(dt);
      },
      draw: (ctx) => {
        ctx.drawImage(art.back, 0, 0);
        centre(ctx, title, 20, spec.ink);
        centre(ctx, "STILL BEING CARVED", 32, TEXT.stone);
        if (phase === "idle") { if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 60, TEXT.bone); return; }
        blit(ctx, art.nut[(S.ny / 6 | 0) & 3], S.nx - 2, S.ny - 2);
        blit(ctx, art.ooga[S.hop > 0 ? 2 : 0], S.x, PLAYER_Y - Math.round(Math.sin(S.hop / 0.3 * Math.PI) * 6));
        fx.draw(ctx);
        number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
        number(ctx, status.left, W - 3, 1, TEXT.bone, 1, 2);
      }
    };
  };

  // ---- Banana Snake -----------------------------------------------------------------------------------------
  // Snake in the cave. The Ooga's banana snake heads the way an arrow or a swipe points (up to three turns wait for
  // their move; one back the way it came, or the way it already goes, is dropped) and eats coconuts, a segment
  // longer and a little faster each. Coconuts eaten back to back inside a window, timed from how far each lands,
  // chain: x2 from three, x3 from six, x4 from ten, x5 from fifteen. Space dashes at double speed for half a second
  // (then it recharges), to make a window or snatch a golden banana, which turns up every few seconds in a tight spot
  // (a corner, or hard by a rock or the snake's own body) for five seconds and pays five coconuts but grows three.
  // Ninety seconds to sundown, in three stages: from thirty seconds boulders fall (their shadows first; one landing on
  // the snake squashes the tail behind it), from sixty fire pits flare and die down. A wall, a boulder, a burning pit
  // or its own body bonks it; three snakes, then it is over. At sundown every segment still on the snake pays, and
  // every snake left. The idle screen is a demo snake eating its way round the cave.
  const SN_COLS = 26, SN_ROWS = 17, SN_N = SN_COLS * SN_ROWS, SN_CELL = 6, SN_X = 2, SN_Y = 12;
  const SN_TIME = 90, SN_LIVES = 3, SN_LEN = 4, SN_QUEUE = 3, SN_TIP = 0.45, SN_LUMP = 26, SN_SQUASH = 0.9;
  const SN_CPS = 7.5, SN_CPS_EAT = 0.1, SN_CPS_STAGE = 0.8, SN_CPS_MAX = 12.5, SN_DEMO_CPS = 9, SN_DASH = 2, SN_DASH_S = 0.5, SN_DASH_COOL = 2.5;
  const SN_CHAIN = 1, SN_CHAIN_SLACK = 1.4, SN_NUT = 10, SN_GOLD = 50, SN_GOLD_GROW = 3, SN_GOLD_S = 5, SN_GOLD_FIRST = 9;
  const SN_WARN = 1.1, SN_PIT_OUT = 1.9, SN_PIT_WARN = 0.6, SN_PIT_BURN = 1.8, SN_PIT_CYCLE = SN_PIT_OUT + SN_PIT_WARN + SN_PIT_BURN;
  const SN_READY = 0.9, SN_DEAD = 1.2, SN_OVER = 1.8, SN_SEG = 10, SN_LIFE = 250, SN_ROCKS = 12, SN_PITS = 4, SN_FALLS = 6, SN_LUMPS = 6, SN_POPS = 8;
  // What comes when, seconds into the run, in threes: [second, 1 boulders or 2 fire pits, how many].
  const SN_EVENTS = [30, 1, 4, 45, 1, 2, 60, 2, 3, 75, 1, 2];
  // The four headings clockwise from right, so a heading's reverse is two on.
  const SN_DX = new Int8Array([1, 0, -1, 0]), SN_DY = new Int8Array([0, 1, 0, -1]);
  // The tongue's four pixels (stem, then fork) off the 8x8 head's top left for each heading, turned as `quarter`
  // turns the head.
  const SN_TONGUE = new Int8Array(32);
  for (let d = 0, P = [8, 4, 9, 4, 10, 3, 10, 5]; d < 4; d++, P = P.map((v, i) => (i & 1 ? P[i - 1] : 7 - P[i + 1]))) SN_TONGUE.set(P, d * 8);
  const SN_INKS = { Y: INK.banana, h: "#fff3a0", d: "#c8962a", K: "#1b1410", W: INK.white, o: "#e0a228", t: "#5a3a1e", C: INK.husk, c: "#c89a5a", k: INK.huskDk,
    l: INK.stoneLt, S: INK.stone, s: INK.stoneDk, E: INK.ember, e: "#7a2a14", R: INK.red, w: "#fff0b0" };
  const SN_INK = { body: INK.banana, shade: "#c8962a", light: "#fff3a0", freckle: "#8a6a2a", tip: "#5a3a1e", tongue: INK.red, shadow: "#000000", meter: "#15120e" };
  // The head is 8x8, a pixel proud of its cell all round: eyes forward, a pointed snout, and its jaws open to gulp.
  const SNR_HEAD = ["..hhh...", ".hYWWh..", "hYYWKYh.", "YYYYYYYY", "YYYYYYYd", "dYYWKYd.", ".dYWWd..", "..ddd..."];
  const SNR_GULP = ["..hhh...", ".hYWWhh.", "hYYWKYYh", "YYYYYKR.", "YYYYYKK.", "dYYWKYYd", ".dYWWdd.", "..ddd..."];
  const SNR_NUT = [".CCCC.", "CccCCC", "CcCkCk", "CCCCCk", "CCCCkk", ".Ckkk."];
  const SNR_GOLD = [".....t", "....hY", "...hYo", "..hYYo", "hYYYo.", ".ooo.."];
  const SNR_ROCK = [".llSS.", "llSSSS", "lSSSSs", "SSSSss", "SSSsss", ".ssss."];
  const SNR_PIT = ["......", ".sSSs.", "SeEeeS", "SeeEeS", ".sSSs.", "......"];
  const SNR_FLAME = [
    ["...R..", "..RE..", ".REE..", ".EYYE.", "EYwYE.", ".EYYE."],
    ["..R...", "..ER..", "..EER.", ".EYYE.", ".EYwYE", ".EYYE."],
    ["......", "..R.R.", ".REER.", ".EYYE.", "EYwYYE", ".EYYE."]
  ];
  const SNR_LIFE = [".hhh.", "hWKYh", "YYYYY", ".ddd."];
  const SNR_SUN = ["..E..", ".EYE.", "EYYYE", ".EYE.", "..E.."];
  // The sparks' inks in pairs: banana, husk, coconut milk, stone, fire, and the banana's shade with gold.
  const SN_SPARKS = [INK.banana, "#fff3a0", INK.husk, "#c89a5a", INK.cream, INK.white, INK.stoneLt, INK.stone, INK.ember, INK.red, "#c8962a", INK.gold];
  const SNS_BANANA = 0, SNS_HUSK = 2, SNS_MILK = 4, SNS_STONE = 6, SNS_FIRE = 8, SNS_GOLD = 10;
  // The host's callouts, only where play stands still: the snake needs its whole field in view, so the stages, a
  // golden banana, a squashed tail and the last ten seconds show on the screen itself.
  const SN_SAY = { sundown: worded("Sundown! +"), crash: ["Bonk! The wall!", "Ooga bit its tail!", "Bonk! A boulder!", "Burnt!"] };
  // Built once for the page on the first game: the cave floor and its rim, and every sprite, the head in each heading.
  let snArt = null;
  const snakeArt = () => {
    if (snArt) return snArt;
    const back = canvasOf(W, H), b = back.getContext("2d"), dots = BL.math.mulberry32(23), FW = SN_COLS * SN_CELL, FH = SN_ROWS * SN_CELL;
    b.fillStyle = INK.band; b.fillRect(0, 0, W, H);
    b.fillStyle = INK.rule; b.fillRect(0, 9, W, 1);
    // The stone rim round the floor, speckled, moss along its top lip, and the dash meter's slot cut in its foot.
    b.fillStyle = "#34313a"; b.fillRect(0, 10, W, H - 10);
    for (let i = 0; i < 160; i++) { b.fillStyle = i % 3 ? "#26242b" : "#4a4652"; b.fillRect(Math.floor(dots() * W), 10 + Math.floor(dots() * (H - 10)), 1 + (i & 1), 1); }
    for (let x = 0; x < W; x += 2) { b.fillStyle = x % 6 ? INK.moss : INK.leaf; b.fillRect(x, 10, 2, 1); if (x % 10 === 4) b.fillRect(x, 11, 1, 1); }
    b.fillStyle = SN_INK.meter; b.fillRect(61, 115, 38, 4);
    // The cave floor, a faint checker so the cells read, with pebbles and old bones in it.
    for (let y = 0; y < SN_ROWS; y++) for (let x = 0; x < SN_COLS; x++) {
      b.fillStyle = (x + y) & 1 ? "#11151e" : "#0d1017";
      b.fillRect(SN_X + x * SN_CELL, SN_Y + y * SN_CELL, SN_CELL, SN_CELL);
    }
    for (let i = 0; i < 46; i++) { b.fillStyle = i % 5 ? "#1b202b" : "#262219"; b.fillRect(SN_X + Math.floor(dots() * FW), SN_Y + Math.floor(dots() * FH), 1, 1); }
    b.fillStyle = "#28251f";
    for (let i = 0; i < 5; i++) {
      const x = SN_X + 4 + Math.floor(dots() * (FW - 10)), y = SN_Y + 3 + Math.floor(dots() * (FH - 6));
      b.fillRect(x, y, 4, 1); b.fillRect(x - 1, y - 1, 1, 1); b.fillRect(x - 1, y + 1, 1, 1); b.fillRect(x + 4, y - 1, 1, 1); b.fillRect(x + 4, y + 1, 1, 1);
    }
    const turns = (rows) => { const list = [rows]; for (let k = 1; k < 4; k++) list.push(quarter(list[k - 1])); return list.map((r) => sprite(r, SN_INKS)); };
    snArt = {
      back, head: turns(SNR_HEAD), gulp: turns(SNR_GULP), nut: sprite(SNR_NUT, SN_INKS), gold: sprite(SNR_GOLD, SN_INKS),
      rock: [sprite(SNR_ROCK, SN_INKS), sprite(SNR_ROCK, SN_INKS, true)], pit: sprite(SNR_PIT, SN_INKS), flame: SNR_FLAME.map((r) => sprite(r, SN_INKS)),
      life: sprite(SNR_LIFE, SN_INKS), sun: sprite(SNR_SUN, SN_INKS)
    };
    return snArt;
  };

  const snake = (host) => {
    const out = hooks(host), aim = out.aim, status = makeStatus("Time"), art = snakeArt(), R = rng(), J = juice(host);
    const fx = sparks(220, SN_SPARKS, 100);
    // The snake is a ring of cells, the head at `S.head` and segment k at cells[S.head - k] (mod SN_N), `S.len` long;
    // `occ` marks it on the grid and `haz` the hazards (1 a boulder, 2 a fire pit). `Q` holds the headings waiting.
    const cells = new Uint16Array(SN_N), occ = new Uint8Array(SN_N), haz = new Uint8Array(SN_N), Q = new Int8Array(SN_QUEUE);
    // The boulders landed and falling (a cell and the seconds to land), the fire pits (a cell, a clock, and 0 out,
    // 1 flickering, 2 burning), the gulped coconuts sliding down the body (segments from the head, -1 none) and the
    // score numbers floating up.
    const RK = { cell: new Int16Array(SN_ROCKS), n: 0 }, FA = { cell: new Int16Array(SN_FALLS), t: new Float32Array(SN_FALLS) };
    const PT = { cell: new Int16Array(SN_PITS), t: new Float32Array(SN_PITS), lit: new Uint8Array(SN_PITS), n: 0 }, LU = new Float32Array(SN_LUMPS).fill(-1);
    const PN = { value: new Int32Array(SN_POPS), big: new Uint8Array(SN_POPS), x: new Float32Array(SN_POPS), y: new Float32Array(SN_POPS), t: new Float32Array(SN_POPS), next: 0 };
    // The run on one object, written in place: the snake (`head`, `len`, heading `dir`, the cells it moved `from` and
    // its tail left, `tailFrom`, how far into the next move it is, `move`, segments still to grow, an eaten coconut or
    // golden banana `pend`ing till the head reaches it, the turn queue's length and the presses last read), the coconut
    // and the golden banana (cells, -1 none), the chain (`chainT` left of `chainMax`), the dash and its recharge, `pace`
    // (eats that speed it), the stage and the run's clock `t`, the next event, lives, a phase's `timer`, the death's and
    // the sundown's popping (`pop`, `payT`, `every`, lives `paid`), the stage banner, a squashed tail's word (`sqT` at
    // `sqX`, `sqY`), and the run's tally.
    const S = { head: 0, len: 0, dir: 0, from: -1, tailFrom: -1, move: 0, grow: 0, pend: 0, qn: 0, steps: 0, stepsY: 0,
      nut: -1, gold: -1, goldT: 0, goldNext: 0, chainT: 0, chainMax: 1, streak: 0, dash: 0, dashCool: 0, pace: 0, stage: 1, t: 0, event: 0,
      lives: SN_LIVES, timer: 0, pop: 0, payT: 0, every: 0, paid: 0, bonkT: 0, eatT: 0, banner: 0, bannerT: 0, startCell: 0, startDir: 0,
      sqT: 0, sqX: 0, sqY: 0, clock: 0, nuts: 0, golds: 0, longest: 0, won: 0, demo: 1, seed: 0 };
    const HP = { x: 0, y: 0 }, TP = { x: 0, y: 0 };
    let phase = "idle";
    // The demo snake makes no sound.
    const cue = (name, gain) => { if (!S.demo) out.cue(name, gain); };
    const seg = (k) => cells[(S.head - k + SN_N) % SN_N];
    const px = (c) => SN_X + (c % SN_COLS) * SN_CELL;
    const py = (c) => SN_Y + ((c / SN_COLS) | 0) * SN_CELL;
    const shadowed = (c) => { for (let i = 0; i < SN_FALLS; i++) if (FA.t[i] > 0 && FA.cell[i] === c) return true; return false; };
    const open = (c) => !occ[c] && !haz[c] && c !== S.nut && c !== S.gold && !shadowed(c);
    // How many of a cell's four sides are wall, hazard or snake.
    const walled = (c) => {
      const x = c % SN_COLS, y = (c / SN_COLS) | 0;
      return (x === 0 || occ[c - 1] || haz[c - 1] ? 1 : 0) + (x === SN_COLS - 1 || occ[c + 1] || haz[c + 1] ? 1 : 0)
        + (y === 0 || occ[c - SN_COLS] || haz[c - SN_COLS] ? 1 : 0) + (y === SN_ROWS - 1 || occ[c + SN_COLS] || haz[c + SN_COLS] ? 1 : 0);
    };
    // Whether a hazard, landed or falling, lies in the 3x3 round a cell (the part of it on the field).
    const crowded = (c) => {
      const x = c % SN_COLS, x0 = x ? -1 : 0, x1 = x < SN_COLS - 1 ? 1 : 0;
      for (let dy = -SN_COLS; dy <= SN_COLS; dy += SN_COLS) for (let dx = x0; dx <= x1; dx++) if (haz[c + dy + dx] || shadowed(c + dy + dx)) return true;
      return false;
    };
    const baseSpeed = () => Math.min(SN_CPS_MAX, SN_CPS + SN_CPS_EAT * S.pace + SN_CPS_STAGE * (S.stage - 1));
    const setVerb = () => { status.verb = phase === "play" && S.dash <= 0 && S.dashCool <= 0 ? "Dash!" : ""; };
    const setChain = (n) => {
      S.streak = n; status.streak = n;
      status.mult = n >= 15 ? 5 : n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1;
    };
    // A score number floating up from (x, y), a `big` one twice the size, kept inside the field below the HUD band.
    const pop = (x, y, value, big) => {
      const i = PN.next, half = big ? 18 : 9;
      PN.next = (PN.next + 1) % SN_POPS;
      PN.value[i] = value; PN.big[i] = big; PN.x[i] = Math.max(half, Math.min(W - half, x)); PN.y[i] = Math.max(SN_Y + 13, y); PN.t[i] = 0.001;
    };
    const wipe = () => {
      occ.fill(0); haz.fill(0); FA.t.fill(0); LU.fill(-1);
      RK.n = PT.n = 0; S.len = S.head = 0; S.nut = S.gold = -1;
    };
    // Lays a fresh snake `len` long with its head on `c0`, heading `dir`, its body straight behind.
    const lay = (c0, dir, len) => {
      for (let k = 0; k < S.len; k++) occ[seg(k)] = 0;
      S.len = 0;
      const x0 = c0 % SN_COLS, y0 = (c0 / SN_COLS) | 0;
      for (let k = len - 1; k >= 0; k--) {
        const c = (y0 - SN_DY[dir] * k) * SN_COLS + x0 - SN_DX[dir] * k;
        S.head = (S.head + 1) % SN_N; cells[S.head] = c; occ[c] = 1; S.len++;
      }
      S.dir = dir; S.from = S.tailFrom = -1; S.move = S.grow = S.pend = S.qn = S.pop = 0;
      LU.fill(-1);
    };
    // Where a fresh snake starts after a bonk: the spot near the middle with the longest clear run ahead of it and
    // its body clear behind, into `startCell` and `startDir`.
    const findStart = () => {
      let best = -1e9;
      for (let y = 2; y < SN_ROWS - 2; y += 2) for (let x = 3; x < SN_COLS - 3; x += 2) for (let d = 0; d < 4; d++) {
        let ok = true, run = 0;
        for (let k = 0; k < SN_LEN && ok; k++) { const c = (y - SN_DY[d] * k) * SN_COLS + x - SN_DX[d] * k; ok = !haz[c] && !shadowed(c); }
        for (let k = 1; ok && k <= 12; k++) {
          const ax = x + SN_DX[d] * k, ay = y + SN_DY[d] * k;
          if (ax < 0 || ay < 0 || ax >= SN_COLS || ay >= SN_ROWS || haz[ay * SN_COLS + ax]) break;
          run++;
        }
        const score = run * 4 - Math.abs(x - 12.5) - Math.abs(y - 8);
        if (ok && score > best) { best = score; S.startCell = y * SN_COLS + x; S.startDir = d; }
      }
    };
    // A coconut on an open cell five to twenty-four steps off (never in a dead end), and its chain window: the time to
    // get there at this speed and more than half as much again, plus a moment.
    const spawnNut = () => {
      const h = seg(0), hx = h % SN_COLS, hy = (h / SN_COLS) | 0;
      let pick = -1;
      for (let tries = 0; tries < 90 && pick < 0; tries++) {
        const c = R.int(SN_N), d = Math.abs(c % SN_COLS - hx) + Math.abs(((c / SN_COLS) | 0) - hy);
        if (d >= 5 && d <= 24 && open(c) && walled(c) <= 2) pick = c;
      }
      for (let k = 0, c0 = R.int(SN_N); pick < 0 && k < SN_N; k++) if (open((c0 + k) % SN_N)) pick = (c0 + k) % SN_N;
      S.nut = pick;
      if (pick < 0) return;
      const d = Math.abs(pick % SN_COLS - hx) + Math.abs(((pick / SN_COLS) | 0) - hy);
      S.chainMax = S.chainT = SN_CHAIN + SN_CHAIN_SLACK * d / baseSpeed();
    };
    // A golden banana somewhere tight (two sides walled, else one), never a dead end, six steps off and reachable in
    // its time; the next one is due a few seconds after it goes.
    const spawnGold = () => {
      const h = seg(0), hx = h % SN_COLS, hy = (h / SN_COLS) | 0, reach = SN_GOLD_S * baseSpeed() * 0.7;
      let pick = -1;
      for (let want = 2; want >= 0 && pick < 0; want--) for (let tries = 0; tries < 60 && pick < 0; tries++) {
        const c = R.int(SN_N), d = Math.abs(c % SN_COLS - hx) + Math.abs(((c / SN_COLS) | 0) - hy);
        if (d < 6 || d > reach || !open(c)) continue;
        const w = walled(c);
        if (w >= want && w <= 2) pick = c;
      }
      S.goldNext = S.t + SN_GOLD_S + R.range(5, 9);
      if (pick < 0) return;
      S.gold = pick; S.goldT = SN_GOLD_S;
      fx.spawn(px(pick) + 3, py(pick) + 3, 10, 30, SNS_BANANA + 1, SNS_GOLD + 1, 0.45);
      cue("ding", 0.7);
    };
    // A cell for a boulder or a fire pit, anywhere (the wall is no hiding place): four steps off the head and not in
    // its path for six, clear of the snake, the food and the other hazards all round.
    const hazardAt = () => {
      const h = seg(0), hx = h % SN_COLS, hy = (h / SN_COLS) | 0, dx = SN_DX[S.dir], dy = SN_DY[S.dir];
      for (let tries = 0; tries < 80; tries++) {
        const c = R.int(SN_N), x = c % SN_COLS, y = (c / SN_COLS) | 0, ax = x - hx, ay = y - hy;
        if (Math.abs(ax) + Math.abs(ay) < 4) continue;
        const ahead = dx ? ay === 0 && ax * dx > 0 && ax * dx <= 6 : ax === 0 && ay * dy > 0 && ay * dy <= 6;
        if (!ahead && open(c) && !crowded(c)) return c;
      }
      return -1;
    };
    const event = () => {
      const kind = SN_EVENTS[S.event + 1], n = SN_EVENTS[S.event + 2];
      S.event += 3;
      if (kind === 1) {
        for (let k = 0, slot = 0; k < n; k++) {
          while (slot < SN_FALLS && FA.t[slot] > 0) slot++;
          const c = slot < SN_FALLS ? hazardAt() : -1;
          if (c >= 0) { FA.cell[slot] = c; FA.t[slot] = SN_WARN + k * 0.25; }
        }
        cue("knock", 0.7); J.shake(2); out.shake(0.3);
        if (S.stage < 2) { S.stage = 2; status.round = 2; S.banner = 1; S.bannerT = 1.4; cue("round"); }
      } else {
        for (let k = 0; k < n && PT.n < SN_PITS; k++) {
          const c = hazardAt();
          if (c < 0) continue;
          PT.cell[PT.n] = c; PT.t[PT.n] = -k * 1.2; PT.lit[PT.n] = 0; PT.n++; haz[c] = 2;
          fx.spawn(px(c) + 3, py(c) + 3, 8, 30, SNS_FIRE, SNS_FIRE + 1, 0.5);
        }
        S.stage = 3; status.round = 3; S.banner = 2; S.bannerT = 1.4; cue("round");
      }
    };
    // A boulder lands: on the head it bonks the snake, on the body it squashes the tail behind it off, and on food it
    // crushes it (a coconut comes back elsewhere).
    const land = (i) => {
      const c = FA.cell[i];
      FA.t[i] = 0;
      haz[c] = 1; RK.cell[RK.n++] = c;
      fx.spawn(px(c) + 3, py(c) + 4, 10, 40, SNS_STONE, SNS_STONE + 1, 0.5);
      J.shake(2); cue("thud", 0.4);
      if (c === S.gold) S.gold = -1;
      if (c === S.nut) spawnNut();
      if (!occ[c]) return;
      if (c === seg(0)) { crash(2); return; }
      let k = 1;
      while (seg(k) !== c) k++;
      for (let j = k; j < S.len; j++) { const t = seg(j); occ[t] = 0; fx.spawn(px(t) + 3, py(t) + 3, 3, 35, SNS_BANANA, SNS_GOLD, 0.45); }
      S.len = k; S.tailFrom = -1; S.grow = 0;
      S.sqT = SN_SQUASH; S.sqX = px(c) + 3; S.sqY = py(c);
      out.flop();
    };
    const crash = (why) => {
      if (S.demo) { demo(); return; }
      S.lives--;
      phase = "dead"; S.timer = SN_DEAD; S.bonkT = 0.18; S.pop = 0; S.payT = 0; S.every = Math.min(0.05, 0.7 / S.len);
      S.move = 1; S.pend = S.qn = 0; S.chainT = S.dash = S.dashCool = 0;
      setChain(0);
      const h = seg(0);
      fx.spawn(px(h) + 3, py(h) + 3, 16, 60, SNS_BANANA, SNS_GOLD + 1, 0.7);
      J.shake(4); J.flash(INK.red, 0.5);
      out.shake(0.7); out.flop(); cue("slam");
      if (S.lives <= 0) out.over();
      out.popup(SN_SAY.crash[why], false);
      setVerb();
    };
    const respawn = () => {
      findStart();
      lay(S.startCell, S.startDir, SN_LEN);
      S.pace = Math.floor(S.pace * 0.6); S.steps = aim.steps; S.stepsY = aim.stepsY;
      if (S.nut < 0 || occ[S.nut]) spawnNut();
      if (S.gold >= 0 && occ[S.gold]) S.gold = -1;
      S.chainT = 0;
      phase = "ready"; S.timer = SN_READY;
      cue("chirp", 0.6);
      setVerb();
    };
    // The head reaches what it ate: a coconut grows a segment and chains; a golden banana pays five, grows three,
    // tops the chain's window up and recharges the dash. Each sends a lump down the body.
    const eat = () => {
      const gold = S.pend === 2, c = gold ? S.gold : S.nut, x = px(c) + 3, y = py(c) + 3, mult = status.mult;
      S.pend = 0; S.eatT = 0.22;
      for (let i = 0; i < SN_LUMPS; i++) if (LU[i] < 0) { LU[i] = 1; break; }
      if (S.demo) { S.grow++; fx.spawn(x, y, 8, 40, SNS_HUSK, SNS_HUSK + 1, 0.45); spawnNut(); return; }
      setChain(S.chainT > 0 ? S.streak + 1 : 1);
      const pts = (gold ? SN_GOLD : SN_NUT) * status.mult;
      status.score += pts; S.pace++;
      pop(x, y - (gold ? 12 : 8), pts, gold ? 1 : 0);
      if (gold) {
        S.golds++; S.grow += SN_GOLD_GROW; S.gold = -1; S.chainT = S.chainMax; S.dash = S.dashCool = 0;
        fx.spawn(x, y, 24, 80, SNS_BANANA, SNS_GOLD + 1, 0.8); fx.spawn(x, y, 10, 50, SNS_MILK + 1, SNS_BANANA + 1, 0.5);
        J.shake(3); J.flash(INK.banana, 0.35);
        cue("big"); out.crack(true);
      } else {
        S.nuts++; S.grow++;
        fx.spawn(x, y, 10, 45, SNS_HUSK, SNS_HUSK + 1, 0.5); fx.spawn(x, y, 6, 35, SNS_MILK, SNS_MILK + 1, 0.4);
        J.shake(1); cue("crack", 0.45);
        spawnNut();
      }
      if (status.mult > mult) { cue("score", 0.7); out.crack(false); }
      setVerb();
    };
    // One move: the next queued turn, then a step ahead, or a bonk on a wall, the body (its tail cell is free when the
    // tail moves on), a boulder or a burning pit.
    const pitLit = (c) => { for (let i = 0; i < PT.n; i++) if (PT.cell[i] === c) return PT.lit[i] === 2; return false; };
    const stepSnake = () => {
      if (S.pend) eat();
      if (S.qn) { S.dir = Q[0]; Q[0] = Q[1]; Q[1] = Q[2]; S.qn--; cue("click", 0.25); }
      const h = seg(0), x = h % SN_COLS + SN_DX[S.dir], y = ((h / SN_COLS) | 0) + SN_DY[S.dir];
      if (x < 0 || y < 0 || x >= SN_COLS || y >= SN_ROWS) { crash(0); return; }
      const c = y * SN_COLS + x, tail = seg(S.len - 1), moves = S.grow === 0;
      if (occ[c] && !(moves && c === tail)) { crash(1); return; }
      if (haz[c] === 1) { crash(2); return; }
      if (haz[c] === 2 && pitLit(c)) { crash(3); return; }
      if (moves) { occ[tail] = 0; S.tailFrom = tail; S.len--; } else { S.grow--; S.tailFrom = -1; }
      S.from = h;
      S.head = (S.head + 1) % SN_N; cells[S.head] = c; occ[c] = 1; S.len++;
      if (S.len > S.longest) S.longest = S.len;
      if (c === S.nut) S.pend = 1;
      else if (c === S.gold) S.pend = 2;
    };
    // The demo's steering: of straight on, left and right, the open way nearest the coconut, keeping out of pockets.
    const steer = () => {
      if (S.nut < 0) return;
      const h = seg(0), hx = h % SN_COLS, hy = (h / SN_COLS) | 0, nx = S.nut % SN_COLS, ny = (S.nut / SN_COLS) | 0, tail = seg(S.len - 1);
      let best = S.dir, bestScore = 1e9;
      for (let t = -1; t <= 1; t++) {
        const d = (S.dir + t + 4) & 3, x = hx + SN_DX[d], y = hy + SN_DY[d], c = y * SN_COLS + x;
        if (x < 0 || y < 0 || x >= SN_COLS || y >= SN_ROWS || (occ[c] && c !== tail)) continue;
        const score = Math.abs(x - nx) + Math.abs(y - ny) + (walled(c) >= 3 ? 40 : 0) + (t ? 0.5 : 0);
        if (score < bestScore) { bestScore = score; best = d; }
      }
      S.dir = best;
    };
    const demo = () => {
      S.demo = 1; phase = "idle";
      wipe();
      S.pace = S.won = 0; S.stage = 1; S.bannerT = S.sqT = 0;
      lay(8 * SN_COLS + 6, 0, 6);
      spawnNut();
      S.chainT = 0;
    };
    const sundown = () => {
      if (S.pend) eat();
      phase = "sundown"; S.won = 1; S.timer = 0.8; S.pop = S.paid = 0; S.payT = 0; S.every = Math.min(0.05, 1.5 / S.len); S.move = 1; S.gold = -1;
      status.left = 0;
      setVerb();
      J.flash(INK.ember, 0.45);
      out.popup(SN_SAY.sundown(S.len * SN_SEG + S.lives * SN_LIFE), true); cue("round"); out.crack(true); out.over();
    };
    // Sundown pays each segment from the tail up, then each snake left.
    const paying = (h) => {
      if (S.timer > 0) return;
      S.payT -= h;
      while (S.payT <= 0) {
        if (S.pop < S.len) {
          const c = seg(S.len - 1 - S.pop);
          status.score += SN_SEG; S.pop++;
          fx.spawn(px(c) + 3, py(c) + 3, 4, 40, SNS_BANANA, SNS_GOLD + 1, 0.5);
          cue("tally", 0.6); S.payT += S.every;
        } else if (S.paid < S.lives) {
          status.score += SN_LIFE; S.paid++;
          pop(W - 12 - (S.lives - S.paid) * 7, 15, SN_LIFE, 0);
          J.shake(1); cue("coin", 0.8); S.payT += 0.35;
        } else { phase = "over"; S.timer = SN_OVER; cue("win"); return; }
      }
    };
    // A bonk pops the snake from the head down, then a fresh one starts, or it is over.
    const dying = (h) => {
      if (S.bonkT > 0) { S.bonkT -= h; return; }
      S.payT -= h;
      while (S.pop < S.len && S.payT <= 0) {
        const c = seg(S.pop);
        fx.spawn(px(c) + 3, py(c) + 3, 4, 45, SNS_BANANA, SNS_GOLD, 0.5);
        if ((S.pop & 3) === 0) cue("clack", 0.3);
        S.pop++; S.payT += S.every;
      }
      if (S.timer > 0) return;
      if (S.lives > 0) respawn();
      else { phase = "over"; S.timer = SN_OVER; }
    };
    const finish = () => {
      phase = "done";
      setVerb();
      status.note = `Coconuts ${S.nuts} · golden ${S.golds} · longest ${S.longest}`;
      cue(S.won ? "big" : "buzzer");
      out.onEnd(status.score);
    };
    const playing = (h) => {
      S.t += h;
      const secs = Math.max(0, Math.ceil(SN_TIME - S.t));
      if (secs !== status.left) { status.left = secs; if (secs <= 10 && secs > 0) cue("tick", 0.6); }
      while (S.event < SN_EVENTS.length && S.t >= SN_EVENTS[S.event]) event();
      if (S.dash > 0) { if ((S.dash -= h) <= 0) { S.dash = 0; S.dashCool = SN_DASH_COOL; } }
      else if (S.dashCool > 0 && (S.dashCool -= h) <= 0) { S.dashCool = 0; setVerb(); }
      if (S.chainT > 0 && (S.chainT -= h) <= 0) {
        S.chainT = 0;
        if (S.streak >= 5) out.flop();
        if (S.streak > 0) cue("miss", 0.4);
        setChain(0);
      }
      if (S.gold >= 0) { if ((S.goldT -= h) <= 0) { fx.spawn(px(S.gold) + 3, py(S.gold) + 3, 8, 30, SNS_GOLD, SNS_GOLD + 1, 0.4); S.gold = -1; } }
      else if (S.t >= S.goldNext) spawnGold();
      for (let i = 0; i < PT.n; i++) {
        const k = (PT.t[i] += h) < 0 ? 0 : PT.t[i] % SN_PIT_CYCLE, lit = k < SN_PIT_OUT ? 0 : k < SN_PIT_OUT + SN_PIT_WARN ? 1 : 2;
        if (lit === PT.lit[i]) continue;
        PT.lit[i] = lit;
        if (lit === 2) { cue("roll", 0.3); if (seg(0) === PT.cell[i]) { crash(3); return; } }
      }
      for (let i = 0; i < SN_FALLS; i++) if (FA.t[i] > 0 && (FA.t[i] -= h) <= 0) { land(i); if (phase !== "play") return; }
      S.move += h * baseSpeed() * (S.dash > 0 ? SN_DASH : 1);
      while (S.move >= 1) { S.move -= 1; stepSnake(); if (phase !== "play") return; }
      if (S.pend && S.move >= SN_TIP) eat();
      if (S.t >= SN_TIME) sundown();
    };
    const tick = (h) => {
      if (phase === "idle") {
        S.move += h * SN_DEMO_CPS;
        while (S.move >= 1) { S.move -= 1; steer(); stepSnake(); }
        if (S.pend && S.move >= SN_TIP) eat();
        return;
      }
      if (phase === "play") { playing(h); return; }
      S.timer -= h;
      if (phase === "ready") { if (S.timer <= 0) { phase = "play"; setVerb(); } }
      else if (phase === "dead") dying(h);
      else if (phase === "sundown") paying(h);
      else if (phase === "over" && S.timer <= 0) finish();
    };
    const run = stepper(tick);
    // The turns pressed or swiped since the last frame, each a heading as the screen shows it (the steps across right
    // or left, then the steps down or up), queued unless it is the way the snake will already be going or back the
    // way it came, so a slow swipe's many notches or a key pressed twice turn it once.
    const head = (d) => {
      const last = S.qn ? Q[S.qn - 1] : S.dir;
      if (d !== last && d !== (last + 2 & 3) && S.qn < SN_QUEUE) Q[S.qn++] = d;
    };
    const turns = () => {
      const dx = aim.steps - S.steps, dy = aim.stepsY - S.stepsY;
      S.steps = aim.steps; S.stepsY = aim.stepsY;
      if (phase !== "play" && phase !== "ready") return;
      if (dx) head(dx > 0 ? 0 : 2);
      if (dy) head(dy > 0 ? 1 : 3);
    };

    // ---- drawing --------------------------------------------------------------------------------------------
    const aheadFood = () => {
      const h = seg(0);
      for (let k = 1; k <= 2; k++) {
        const x = h % SN_COLS + SN_DX[S.dir] * k, y = ((h / SN_COLS) | 0) + SN_DY[S.dir] * k, c = y * SN_COLS + x;
        if (x < 0 || y < 0 || x >= SN_COLS || y >= SN_ROWS) return false;
        if (c === S.nut || c === S.gold) return true;
      }
      return false;
    };
    // Where segment k is drawn: the head and the tail slide between cells (HP, TP), the rest sit on theirs.
    const ptX = (k) => k === 0 ? HP.x : k === S.len - 1 ? TP.x : px(seg(k));
    const ptY = (k) => k === 0 ? HP.y : k === S.len - 1 ? TP.y : py(seg(k));
    // The snake from segment k0 up to k1: each link between neighbours one rect four pixels thick spanning both, then
    // its shade and its highlight, each corner drawn again whole (so the straight links' edges crossing it give way to
    // its own: lit where it has no neighbour up or left, shaded where it has none down or right), banana freckles
    // every other segment, the lumps, the tail's dark tip, and the head with its tongue; the front glows while it
    // dashes. `f` is how far the move has gone.
    const drawSnake = (ctx, f, k0, k1) => {
      const h = seg(0), t = seg(S.len - 1);
      HP.x = px(h); HP.y = py(h); TP.x = px(t); TP.y = py(t);
      if (f < 1 && S.from >= 0) { HP.x = Math.round(px(S.from) + (HP.x - px(S.from)) * f); HP.y = Math.round(py(S.from) + (HP.y - py(S.from)) * f); }
      if (f < 1 && S.tailFrom >= 0 && S.len > 1) { TP.x = Math.round(px(S.tailFrom) + (TP.x - px(S.tailFrom)) * f); TP.y = Math.round(py(S.tailFrom) + (TP.y - py(S.tailFrom)) * f); }
      if (phase === "dead" && S.bonkT > 0) { HP.x += SN_DX[S.dir] * 2; HP.y += SN_DY[S.dir] * 2; }
      for (let pass = 0; pass < 3; pass++) {
        ctx.fillStyle = pass === 0 ? SN_INK.body : pass === 1 ? SN_INK.shade : SN_INK.light;
        for (let k = k0; k < k1 - 1; k++) {
          const ax = ptX(k), ay = ptY(k), bx = ptX(k + 1), by = ptY(k + 1), x = Math.min(ax, bx) + 1, y = Math.min(ay, by) + 1, w = Math.abs(ax - bx) + 4, hh = Math.abs(ay - by) + 4;
          if (pass === 0) ctx.fillRect(x, y, w, hh);
          else if (ay === by) ctx.fillRect(pass === 2 ? x + 1 : x, pass === 1 ? y + 3 : y, pass === 2 ? w - 2 : w, 1);
          else ctx.fillRect(pass === 1 ? x + 3 : x, pass === 2 ? y + 1 : y, 1, pass === 2 ? hh - 2 : hh);
        }
        if (pass === 0 && k1 - k0 === 1) ctx.fillRect(ptX(k0) + 1, ptY(k0) + 1, 4, 4);
      }
      for (let k = Math.max(k0, 1); k < k1 - 1; k++) {
        const a = seg(k - 1), c = seg(k), n = seg(k + 1), x = px(c), y = py(c);
        if (px(a) === px(n) || py(a) === py(n)) continue;
        ctx.fillStyle = SN_INK.body; ctx.fillRect(x + 1, y + 1, 4, 4);
        ctx.fillStyle = SN_INK.light;
        if (py(a) >= y && py(n) >= y) ctx.fillRect(x + 1, y + 1, 4, 1);
        if (px(a) >= x && px(n) >= x) ctx.fillRect(x + 1, y + 1, 1, 4);
        ctx.fillStyle = SN_INK.shade;
        if (py(a) <= y && py(n) <= y) ctx.fillRect(x + 1, y + 4, 4, 1);
        if (px(a) <= x && px(n) <= x) ctx.fillRect(x + 4, y + 1, 1, 4);
      }
      ctx.fillStyle = SN_INK.freckle;
      for (let k = Math.max(k0, 2) + (Math.max(k0, 2) & 1); k < k1 - 1; k += 2) {
        const c = seg(k), x = px(c), y = py(c), side = (k >> 1) & 1;
        if (py(seg(k - 1)) === y) ctx.fillRect(x + 2 + side * 2, y + 3 - side, 1, 1);
        else ctx.fillRect(x + 3 - side, y + 2 + side * 2, 1, 1);
      }
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? SN_INK.light : SN_INK.body;
        for (let i = 0; i < SN_LUMPS; i++) {
          const k = LU[i] | 0;
          if (LU[i] < 0 || k < Math.max(1, k0) || k >= k1 - 1) continue;
          const x = px(seg(k)), y = py(seg(k));
          if (pass) { ctx.fillRect(x + 1, y + 1, 2, 1); ctx.fillRect(x + 1, y + 2, 1, 1); }
          else { ctx.fillRect(x, y + 1, 6, 4); ctx.fillRect(x + 1, y, 4, 6); }
        }
      }
      if (k1 === S.len && S.len > 1) { ctx.fillStyle = SN_INK.tip; ctx.fillRect(TP.x + 2, TP.y + 2, 2, 2); }
      if (S.dash > 0) {
        ctx.globalAlpha = 0.55; ctx.fillStyle = INK.white;
        for (let k = k0; k < k1 - 1 && k < 5; k++) { const ax = ptX(k), ay = ptY(k), bx = ptX(k + 1), by = ptY(k + 1); ctx.fillRect(Math.min(ax, bx) + 1, Math.min(ay, by) + 1, Math.abs(ax - bx) + 4, Math.abs(ay - by) + 4); }
        ctx.globalAlpha = 1;
      }
      if (k0 > 0) return;
      const food = S.pend || S.eatT > 0 || aheadFood();
      blit(ctx, (food ? art.gulp : art.head)[S.dir], HP.x - 1, HP.y - 1);
      if (!food && S.clock % 1.3 < 0.16) {
        ctx.fillStyle = SN_INK.tongue;
        for (let i = S.dir * 8; i < S.dir * 8 + 8; i += 2) ctx.fillRect(HP.x - 1 + SN_TONGUE[i], HP.y - 1 + SN_TONGUE[i + 1], 1, 1);
      }
    };
    // The floor's things under the snake: a new stage's name painted across it, fading, boulders, pits, the falling
    // boulders' shadows (darker and wider as they come, under bone-white corners closing from three cells wide onto
    // the cell, whose edge blinks ember the last moment), the coconut bobbing and the golden banana glinting
    // (blinking as it goes).
    const drawField = (ctx) => {
      if (S.bannerT > 0) {
        ctx.globalAlpha = Math.min(1, S.bannerT * 2) * 0.6;
        centre(ctx, S.banner === 1 ? "ROCKFALL!" : "FIRE PITS!", SN_Y + 44, S.banner === 1 ? TEXT.stone : TEXT.ember, 2);
        ctx.globalAlpha = 1;
      }
      for (let i = 0; i < RK.n; i++) blit(ctx, art.rock[RK.cell[i] & 1], px(RK.cell[i]), py(RK.cell[i]));
      for (let i = 0; i < PT.n; i++) blit(ctx, art.pit, px(PT.cell[i]), py(PT.cell[i]));
      for (let i = 0; i < SN_FALLS; i++) {
        if (FA.t[i] <= 0) continue;
        const k = 1 - Math.min(1, FA.t[i] / SN_WARN), r = 1 + Math.round(k * 2), x = px(FA.cell[i]), y = py(FA.cell[i]);
        ctx.globalAlpha = 0.35 + 0.45 * k; ctx.fillStyle = SN_INK.shadow;
        ctx.fillRect(x + 3 - r, y + 3, r * 2, 2); ctx.fillRect(x + 4 - r, y + 2, r * 2 - 2, 4);
        // The ring's four corners, kept on the screen and under the top band.
        const q = Math.min(3 + Math.round((1 - k) * 6), x + 3, W - 3 - x, y + 5 - SN_Y, H - 3 - y), l = x + 3 - q, t = y + 3 - q, e = 2 * q;
        ctx.globalAlpha = 0.7 + 0.3 * k; ctx.fillStyle = INK.bone;
        ctx.fillRect(l, t, 3, 1); ctx.fillRect(l, t, 1, 3); ctx.fillRect(l + e - 3, t, 3, 1); ctx.fillRect(l + e - 1, t, 1, 3);
        ctx.fillRect(l, t + e - 1, 3, 1); ctx.fillRect(l, t + e - 3, 1, 3); ctx.fillRect(l + e - 3, t + e - 1, 3, 1); ctx.fillRect(l + e - 1, t + e - 3, 1, 3);
        ctx.globalAlpha = 1;
        if (FA.t[i] < 0.4 && (S.clock * 12 | 0) & 1) { ctx.fillStyle = INK.ember; ctx.fillRect(x, y, 6, 1); ctx.fillRect(x, y + 5, 6, 1); ctx.fillRect(x, y + 1, 1, 4); ctx.fillRect(x + 5, y + 1, 1, 4); }
      }
      if (S.nut >= 0) blit(ctx, art.nut, px(S.nut), py(S.nut) - ((S.clock * 3 | 0) & 1));
      if (S.gold >= 0 && (S.goldT > 1.5 || (S.clock * 10 | 0) & 1)) {
        const x = px(S.gold), y = py(S.gold), s = (S.clock * 8 | 0) & 3;
        ctx.globalAlpha = 0.3; ctx.fillStyle = INK.gold; ctx.fillRect(x - 1, y - 1, 8, 8); ctx.globalAlpha = 1;
        blit(ctx, art.gold, x, y);
        ctx.fillStyle = INK.white; ctx.fillRect(x + (s & 1 ? 6 : -1), y + (s & 2 ? 5 : -1), 1, 1);
      }
    };
    // Over the snake: the pits' flames, and the boulders dropping the last stretch onto their shadows.
    const drawOver = (ctx) => {
      for (let i = 0; i < PT.n; i++) {
        const x = px(PT.cell[i]), y = py(PT.cell[i]);
        if (PT.lit[i] === 2) blit(ctx, art.flame[(((S.clock * 10) | 0) + i) % 3], x, y - 3);
        else if (PT.lit[i] === 1 && (S.clock * 14 | 0) & 1) { ctx.fillStyle = INK.ember; ctx.fillRect(x + 2 + (i & 1), y + 1, 1, 2); ctx.fillRect(x + 3, y, 1, 1); }
      }
      for (let i = 0; i < SN_FALLS; i++) if (FA.t[i] > 0 && FA.t[i] < 0.35) blit(ctx, art.rock[0], px(FA.cell[i]), py(FA.cell[i]) - FA.t[i] / 0.35 * 30);
    };
    const band = (ctx, y, h) => { ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, y, W, h); ctx.globalAlpha = 1; };
    const drawHud = (ctx) => {
      number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
      if (status.mult > 1) { text(ctx, "X", 35, 1, TEXT.ember); number(ctx, status.mult, 41, 1, TEXT.ember); }
      // The chain's window, draining, red and blinking at the end.
      if (S.streak > 0 && S.chainT > 0) {
        ctx.fillStyle = INK.rule; ctx.fillRect(50, 3, 38, 3);
        ctx.fillStyle = S.chainT < 0.8 && (S.clock * 10 | 0) & 1 ? INK.red : INK.banana;
        ctx.fillRect(50, 3, Math.ceil(38 * S.chainT / S.chainMax), 3);
      }
      blit(ctx, art.sun, 95, 2);
      // The last ten seconds blink red.
      if (status.left > 10 || phase !== "play" || (S.clock * 4 | 0) & 1) number(ctx, status.left, 102, 1, status.left <= 10 ? TEXT.red : TEXT.bone, 1, 0, 2);
      for (let k = 0; k < S.lives - S.paid; k++) blit(ctx, art.life, W - 8 - k * 7, 3);
      // The dash meter in the rim's foot: white draining while it dashes, ochre filling as it recharges, then banana.
      const m = S.dash > 0 ? S.dash / SN_DASH_S : S.dashCool > 0 ? 1 - S.dashCool / SN_DASH_COOL : 1;
      ctx.fillStyle = S.dash > 0 ? INK.white : S.dashCool > 0 ? INK.ochre : (S.clock * 3 | 0) & 1 ? INK.banana : INK.gold;
      ctx.fillRect(62, 116, Math.round(36 * m), 2);
    };
    const drawBanner = (ctx) => {
      if (phase === "sundown" || phase === "over" || phase === "done") {
        // Through the tally the host calls sundown and its bonus; the screen's own title comes after.
        const won = S.won === 1;
        if (phase !== "sundown") { band(ctx, 18, 20); centre(ctx, won ? "SUNDOWN!" : "GAME OVER", 21, won ? TEXT.gold : TEXT.red, 2); }
        band(ctx, 88, 22);
        centre(ctx, "SCORE", 90, TEXT.stone);
        number(ctx, status.score, W / 2, 99, TEXT.banana, 1, 1);
      } else if (phase === "ready") { band(ctx, 18, 20); centre(ctx, S.lives === 1 ? "LAST SNAKE" : "READY", 21, TEXT.banana, 2); }
    };
    // The attract: the demo under the title, now and then the legend, PRESS START and the best.
    const drawAttract = (ctx) => {
      band(ctx, 16, 40);
      if (S.clock % 10 < 6) { centre(ctx, "BANANA", 19, TEXT.banana, 2); centre(ctx, "SNAKE", 37, TEXT.lime, 2); }
      else {
        blit(ctx, art.nut, 52, 20); text(ctx, "= 10", 62, 20, TEXT.bone);
        blit(ctx, art.gold, 52, 31); text(ctx, "= 50", 62, 31, TEXT.banana);
        centre(ctx, "CHAIN X5", 44, TEXT.ember);
      }
      if ((S.clock * 1.6 | 0) % 2) { band(ctx, 98, 11); centre(ctx, "PRESS START", 100, TEXT.bone); }
      text(ctx, "HI", 3, 1, TEXT.stone);
      number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
    };

    demo();
    status.left = SN_TIME;
    return {
      kind: "snake", name: "Banana Snake", aims: true, status,
      help: "The arrows or W A S D steer the snake, a swipe on a touch screen; Space or tap dashes. Chain coconuts, never bite your tail.",
      coach: ["Arrows steer, Space dashes", "Swipe to steer, tap to dash"],
      stars: [450, 1100, 2900], tickets: (score) => Math.floor(score / 70),
      get playing() { return phase !== "idle" && phase !== "done"; },
      get seed() { return S.seed; },
      start: (seed) => {
        if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
        wipe(); fx.clear(); J.reset(); PN.t.fill(0);
        S.demo = 0; phase = "play";
        status.score = 0; status.left = SN_TIME; status.round = 1; status.note = ""; status.meter = -1; status.target = 0;
        S.lives = SN_LIVES; S.t = 0; S.event = 0; S.stage = 1; S.pace = 0; S.nuts = S.golds = S.won = S.paid = 0; S.bannerT = 0;
        S.dash = S.dashCool = 0; S.goldNext = SN_GOLD_FIRST;
        setChain(0);
        lay(8 * SN_COLS + 6, 0, SN_LEN);
        S.longest = SN_LEN;
        // The first coconut six steps dead ahead.
        S.nut = 8 * SN_COLS + 12; S.chainMax = S.chainT = SN_CHAIN + SN_CHAIN_SLACK * 6 / baseSpeed();
        S.steps = aim.steps; S.stepsY = aim.stepsY; S.sqT = 0;
        setVerb();
      },
      stop: () => { setChain(0); status.round = 1; status.left = SN_TIME; status.note = ""; S.paid = 0; demo(); setVerb(); },
      act: () => {
        if (phase !== "play" || S.dash > 0 || S.dashCool > 0) return;
        S.dash = SN_DASH_S;
        const h = seg(0);
        fx.spawn(px(h) + 3, py(h) + 3, 8, 40, SNS_BANANA + 1, SNS_MILK + 1, 0.3);
        cue("swish", 0.8);
        setVerb();
      },
      update: (dt) => {
        S.clock += dt;
        J.update(dt);
        fx.update(dt);
        for (let i = 0; i < SN_POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
        for (let i = 0; i < SN_LUMPS; i++) if (LU[i] >= 0 && (LU[i] += dt * SN_LUMP) >= S.len - 1) LU[i] = -1;
        S.eatT = Math.max(0, S.eatT - dt); S.bannerT = Math.max(0, S.bannerT - dt); S.sqT = Math.max(0, S.sqT - dt);
        turns();
        if (phase !== "done") run(dt);
      },
      draw: (ctx) => {
        ctx.drawImage(art.back, 0, 0);
        J.begin(ctx);
        drawField(ctx);
        const k0 = S.won ? 0 : S.pop, k1 = S.won ? S.len - S.pop : S.len;
        if (k1 > k0 && !(phase === "ready" && (S.clock * 10 | 0) & 1)) drawSnake(ctx, phase === "play" || phase === "idle" ? S.move : 1, k0, k1);
        drawOver(ctx);
        fx.draw(ctx);
        for (let i = 0; i < SN_POPS; i++) if (PN.t[i] > 0 && (PN.t[i] < 0.6 || (S.clock * 16 | 0) % 2)) number(ctx, PN.value[i], Math.round(PN.x[i]), Math.round(PN.y[i] - PN.t[i] * 14), PN.big[i] ? TEXT.gold : TEXT.banana, PN.big[i] + 1, 1);
        if (S.sqT > 0 && (S.sqT > 0.3 || (S.clock * 16 | 0) & 1)) text(ctx, "SQUASH!", Math.max(1, Math.min(W - 42, Math.round(S.sqX) - 20)), Math.max(SN_Y + 1, Math.round(S.sqY - 8 - (SN_SQUASH - S.sqT) * 10)), TEXT.red);
        // Toward sundown the cave glows orange.
        const dusk = S.won ? 0.2 : phase !== "idle" && S.t > SN_TIME - 10 ? (S.t - SN_TIME + 10) * 0.014 : 0;
        if (dusk > 0) { ctx.globalAlpha = dusk; ctx.fillStyle = INK.ember; ctx.fillRect(SN_X, SN_Y, SN_COLS * SN_CELL, SN_ROWS * SN_CELL); ctx.globalAlpha = 1; }
        J.end(ctx);
        if (phase === "idle") { drawAttract(ctx); return; }
        drawHud(ctx);
        drawBanner(ctx);
      }
    };
  };

  // ---- Ooga Pong --------------------------------------------------------------------------------------------
  // Pong down a cave court. The Ooga at the bottom holds a bone club over its head and knocks a coconut up past a net
  // of bones at a rival across the court; where the coconut meets the club angles it (the ends send it wide) and the
  // club's own sweep carries into it. Space swings the club: timed as the coconut lands it is a smash, a burning
  // coconut that flies fast and pays more; swung too soon, the Ooga is off balance and the coconut pops up weak for
  // the rival to smash back. Each return quickens the coconut and a rally multiplies what a point pays (x2 from two
  // of the Ooga's returns, x3 from four, x4 from six), so a long rally is worth winning and hard to; a golden banana
  // hangs over the rival's half now and then for one of the Ooga's coconuts to knock down. A point is a coconut past
  // a club, and whoever lost it serves the next (the Ooga with Space, or by itself after a moment). Four rivals, each
  // with its knack: Little Ooga, a Mammoth with a long log, a quick and wild Ptero, and the Ooga Chief, who aims away
  // and smashes back; knock out a rival's hearts to face the next. Three Oogas; lose them all and it is over.
  // Its names live in its own scope, so no other game on this screen can clash with them.
  const pong = (() => {
    const PONG_TOP = 9, RIVAL_FACE = 24, PLAYER_FACE = 100, NET_Y = 62, COURT_L = 4, COURT_R = 156, BALL_R = 2, PONG_GROUND = 114;
    const CLUB_W = 24, CLUB_SPEED = 165, SWING = 0.14, RECOVER = 0.3, MAX_TILT = 1.05, MIN_VY = 0.45, CARRY = 0.2;
    const SPEED_UP = 4, SPEED_MAX = 220, SMASH_K = 1.5, RIVAL_SMASH_K = 1.35, WEAK_K = 0.8, PONG_MAX = 99999;
    const PONG_LIVES = 3, SERVE_WAIT = 3, RSERVE_S = 0.9, POINT_S = 1.3, OUT_S = 1.1, ENTER_S = 0.9, VS_S = 1.9, VS_WAIT = 0.3, PONG_END_S = 1.8, TRAIL = 8;
    // The rivals in the order they come: name, its ink, its club (0 bone, 1 log, 2 the Chief's painted bone) and the
    // club's width, top speed, how long it takes to read a shot, how far it misjudges one, how often it aims away from
    // the Ooga and smashes, its hearts, the pace a point with it starts at and how hard it hits back.
    const RIVALS = 4, RV_NAME = ["LITTLE OOGA", "MAMMOTH", "PTERO", "OOGA CHIEF"], RV_INK = [TEXT.ember, TEXT.gold, TEXT.violet, TEXT.red], RV_CLUB = [1, 1, 0, 2];
    const RV_W = [22, 32, 16, 20], RV_SPEED = [85, 80, 150, 128], RV_REACT = [0.25, 0.22, 0.1, 0.1], RV_ERR = [9, 6, 12, 7];
    const RV_AIM = [0.3, 0.45, 0.55, 0.85], RV_SMASH = [0, 0.05, 0.12, 0.3], RV_HEARTS = [2, 3, 3, 4], RV_BASE = [82, 92, 112, 122], RV_HIT = [1, 1, 1, 1.15];
    // Words over the play, each with its ink.
    const PONG_WORDS = ["SMASH!", "TOO SOON!", "BANANA!", "RALLY X2", "RALLY X3", "RALLY X4", "HOT!"];
    const PONG_WORD_INK = [TEXT.banana, TEXT.stone, TEXT.banana, TEXT.teal, TEXT.lime, TEXT.ember, TEXT.red];
    const W_SMASH = 0, W_SOON = 1, W_BANANA = 2, W_RALLY = 3, W_HOT = 6;
    // The sparks' inks, by index: coconut husk, bone, fire, stone dust, a bonk, the golden banana.
    const PONG_SPARKS = [INK.husk, "#b8864a", INK.bone, "#b8ac94", INK.banana, INK.ember, INK.stoneLt, INK.stone, INK.red, INK.skin, INK.gold, INK.cream];
    const P_NUT = 0, P_BONE = 2, P_FIRE = 4, P_STONE = 6, P_OUCH = 8, P_GOLD = 10;
    const KID_INKS = { H: "#b8472c", h: "#7a2e1c", S: "#d8a070", s: "#a86a3a", W: INK.cream, K: "#1b1410", L: INK.leaf, l: INK.moss };
    const CHIEF_INKS = { F: INK.red, f: INK.banana, C: INK.bone, K: "#1b1410", H: INK.hair, S: INK.skin, s: "#9a6232", W: INK.cream, R: INK.red, L: INK.ochre, l: "#6b3a1e" };
    const CHIEF_TOP = ["...f.F.F.f...", "...FfFfFfF...", "...CCCCCCC...", "..CKCCCCCKC..", "..HHSSSSSHH..", "...SWKSWKS...", "...RSSsSSR...", "....SKKKS....", "..SSSSSSSSS..", ".SSLLLLLLLSS.", ".S.LlLlLlL.S."];
    const CHIEF_ROWS = [[...CHIEF_TOP, "...SS...SS..."], [...CHIEF_TOP, "....SS.SS...."]];
    const PONG_BANANA = [".......k", "......yk", "Y....YY.", "YY..YYy.", ".YYYYyy.", "..yyy..."], BANANA_INKS = { Y: INK.banana, y: INK.gold, k: INK.huskDk };
    const HEART_ROWS = ["RR.RR", "RrRRR", "RRRRR", ".RRR.", "..R.."], HEART_INKS = { R: INK.red, r: "#ff9a8a" };
    // The coconut, a size up from the invaders' and lit, so it reads at speed on the dark earth; its light turns as it spins.
    const PONG_NUT = [".CCC.", "CwcCC", "CcCCk", "CCCkk", ".kkk."], PONG_NUT_INKS = { C: "#b8783c", c: "#e2b270", w: "#fff0cc", k: "#6a4222" };
    // Built once for the page on the first game: the court, and the sprites it does not share with Coconut Invaders.
    let pongCache = null;
    const pongArt = () => {
      if (pongCache) return pongCache;
      const inv = invadersArt(), back = canvasOf(W, H), b = back.getContext("2d"), dots = BL.math.mulberry32(23);
      // Packed earth, the dark of the cave behind the rival, and the Ooga's own ground at the bottom.
      b.fillStyle = "#130e0a"; b.fillRect(0, 0, W, H);
      b.fillStyle = INK.night; b.fillRect(0, PONG_TOP, W, 11);
      b.fillStyle = "#0e0b08"; b.fillRect(0, PONG_TOP + 11, W, 3);
      b.fillStyle = "#171b2e";
      for (const [x, len] of [[16, 4], [33, 2], [55, 5], [104, 4], [126, 2], [143, 5]]) for (let k = 0; k < len; k++) b.fillRect(x - (k < 2 ? 1 : 0), PONG_TOP + k, k < 2 ? 3 : 1, 1);
      for (let i = 0; i < 170; i++) { b.fillStyle = i % 3 ? "#1c150f" : "#0b0806"; b.fillRect(COURT_L + Math.floor(dots() * (COURT_R - COURT_L)), 25 + Math.floor(dots() * 88), 1, 1); }
      // The torches' warmth on the floor either side, dithered out from each.
      for (const [x, y] of [[COURT_L, 40], [COURT_R, 40], [COURT_L, 86], [COURT_R, 86]]) for (let dy = -24; dy <= 24; dy++) for (let dx = -24; dx <= 24; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy) / 25;
        if (d < 1 && dots() < (1 - d) * (1 - d) * 0.8) { b.fillStyle = d < 0.4 ? "#2c1a0c" : "#21150c"; b.fillRect(x + dx, y + dy, 1, 1); }
      }
      // The court's chalk, a faded ochre service line near each end, and cave paint: a red-earth spiral on the rival's
      // half and a handprint on the Ooga's.
      b.fillStyle = "#33251a";
      b.fillRect(COURT_L + 3, 33, COURT_R - COURT_L - 6, 1); b.fillRect(COURT_L + 3, 91, COURT_R - COURT_L - 6, 1);
      b.fillStyle = "#3a1c14";
      for (let t = 0; t < 12.5; t += 0.22) b.fillRect(Math.round(118 + Math.cos(t) * (1 + t * 0.75)), Math.round(46 + Math.sin(t) * (1 + t * 0.75) * 0.8), 1, 1);
      b.fillRect(36, 76, 5, 5); b.fillRect(35, 72, 1, 4); b.fillRect(37, 71, 1, 5); b.fillRect(39, 71, 1, 5); b.fillRect(41, 72, 1, 4); b.fillRect(42, 77, 2, 1); b.fillRect(43, 76, 1, 1);
      // The net: bones laid knob to knob across the middle.
      for (let x = COURT_L + 2; x + 7 <= COURT_R - 1; x += 8) {
        b.fillStyle = "#7d7466"; b.fillRect(x, NET_Y - 1, 2, 3); b.fillRect(x + 5, NET_Y - 1, 2, 3); b.fillRect(x + 2, NET_Y, 3, 1);
        b.fillStyle = "#4e483e"; b.fillRect(x, NET_Y + 1, 2, 1); b.fillRect(x + 5, NET_Y + 1, 2, 1);
      }
      // The side walls, stone blocks with their lit inner faces and an iron-dark sconce under each torch.
      for (const x0 of [0, COURT_R]) for (let y = PONG_TOP; y < PONG_GROUND; y += 5) {
        b.fillStyle = (y - PONG_TOP) / 5 & 1 ? INK.stoneDk : "#4a4a52"; b.fillRect(x0, y, 4, 4);
        b.fillStyle = INK.charcoal; b.fillRect(x0, y + 4, 4, 1);
        b.fillStyle = INK.stone; b.fillRect(x0 ? x0 : 3, y, 1, 4);
      }
      b.fillStyle = INK.charcoal;
      for (const y of [42, 88]) { b.fillRect(COURT_L, y, 2, 2); b.fillRect(COURT_R - 2, y, 2, 2); }
      b.fillStyle = INK.earth; b.fillRect(0, PONG_GROUND, W, H - PONG_GROUND);
      b.fillStyle = INK.earthDk; b.fillRect(0, PONG_GROUND + 2, W, 1);
      for (let x = 0; x < W; x += 3) { b.fillStyle = x % 2 ? INK.moss : INK.leaf; b.fillRect(x, PONG_GROUND, 2, 1); if (x % 9 === 0) b.fillRect(x + 1, PONG_GROUND - 1, 1, 1); }
      b.fillStyle = INK.band; b.fillRect(0, 0, W, PONG_TOP - 1);
      b.fillStyle = INK.rule; b.fillRect(0, PONG_TOP - 1, W, 1);
      const white = (rows) => sprite(rows, null, false, INK.white);
      // The Ooga holds its club over its head (Coconut Invaders' throw pose), stepping.
      const hold = [OOGA_ROWS[2], [...OOGA_ROWS[2].slice(0, 10), "..SS...SS.."]];
      pongCache = {
        back, ooga: hold.map((r) => sprite(r, OOGA_INKS)), oogaHit: white(OOGA_ROWS[2]),
        kid: [OOGA_ROWS[0], OOGA_ROWS[1], OOGA_ROWS[2]].map((r) => sprite(r, KID_INKS)), kidHit: white(OOGA_ROWS[0]),
        mammoth: inv.mammoth, mammothHit: inv.mammothHit, ptero: inv.kinds[0], pteroHit: PTERO_ROWS.map(white),
        chief: CHIEF_ROWS.map((r) => sprite(r, CHIEF_INKS)), chiefHit: white(CHIEF_ROWS[0]),
        nut: [PONG_NUT, quarter(PONG_NUT), quarter(quarter(PONG_NUT)), quarter(quarter(quarter(PONG_NUT)))].map((r) => sprite(r, PONG_NUT_INKS)),
        gold: inv.gold, head: inv.head, banana: sprite(PONG_BANANA, BANANA_INKS), heart: sprite(HEART_ROWS, HEART_INKS),
        heartOut: sprite(HEART_ROWS, null, false, "#3a2424")
      };
      return pongCache;
    };
    const PONG_SAY = {
      point: worded("Point! +"), smash: worded("Smash point! +"),
      beaten: [worded("Little Ooga beaten! +"), worded("Mammoth beaten! +"), worded("Ptero beaten! +")], champ: worded("Champion! +"),
      bonked: "Ooga bonked!", last: "Last Ooga!", out: "Out of Oogas!"
    };

    return (host) => {
      const out = hooks(host), aim = out.aim, status = makeStatus("Lives"), art = pongArt(), R = rng(), J = juice(host), fx = sparks(160, PONG_SPARKS, 100);
      // The coconut's last places (a ring, for its trail), the score numbers floating up, words over the play, and
      // burst rings.
      const TR = { x: new Float32Array(TRAIL), y: new Float32Array(TRAIL), fire: new Uint8Array(TRAIL), next: 0, n: 0, t: 0 };
      const POPS = 6, PN = { value: new Int32Array(POPS), x: new Float32Array(POPS), y: new Float32Array(POPS), t: new Float32Array(POPS), next: 0 };
      const SAYS = 4, WP = { word: new Uint8Array(SAYS), x: new Float32Array(SAYS), y: new Float32Array(SAYS), t: new Float32Array(SAYS), next: 0 };
      const RINGS = 6, RG = { x: new Float32Array(RINGS), y: new Float32Array(RINGS), t: new Float32Array(RINGS), size: new Float32Array(RINGS), next: 0 };
      // The run on one object, so a frame's writes change it in place: the Ooga's club (`px`, its speed `pv`, `walk`),
      // the swing (`swing` the smash window, `recover` until the next), `dizzy` after a bonk and `flash` after a smash;
      // the coconut (`bx`, `by`, `vx`, `vy`, `speed` the rally's pace, `fire` 1 the Ooga's smash and 2 the rival's,
      // `last` who hit it, `weak` a return swung too soon, `on` while it shows, `spin` its turn); the rival (`rival`,
      // `hearts`, `rx`, `rv`, `rWant` where it heads, `rReact` before it reads a shot, `rErr` how far it misjudges it,
      // `rAim` where it wants it on its club, `rSmash`, `rHit`, `rSwing`, `rWalk`, `out` flying off beaten, `enter`
      // dropping in, `vsT` its name on the screen, `lost` Oogas lost to it, `cross` where the coconut will meet its line);
      // the golden banana; the phase's `timer`, who serves `next` and a champion's next firework (`fireT`); and the tally.
      const S = { px: W / 2, pv: 0, walk: 0, swing: 0, recover: 0, dizzy: 0, flash: 0, bx: W / 2, by: 0, vx: 0, vy: 0, speed: 0, fire: 0, last: 0, weak: 0, on: 1, spin: 0,
        rival: 0, hearts: 0, rx: W / 2, rv: 0, rWant: W / 2, rReact: 0, rErr: 0, rAim: 0, rSmash: 0, rHit: 0, rSwing: 0, rWalk: 0, out: 0, enter: 0, vsT: 0, lost: 0, cross: 0,
        ban: 0, banX: 0, banY: 0, banT: 0, banNext: 0, timer: 0, next: 1, clock: 0, fireT: 0, lives: PONG_LIVES, rally: 0, seed: 0, won: 0,
        returns: 0, smashes: 0, points: 0, bananas: 0, beaten: 0, longest: 0 };
      let phase = "idle";
      const setVerb = () => { status.verb = phase === "serve" ? "Serve!" : phase === "rally" || phase === "rserve" ? "Smash!" : ""; };
      const addScore = (n) => { status.score = Math.min(PONG_MAX, status.score + n); };
      const setRally = (n) => {
        S.rally = n;
        status.streak = n;
        status.mult = n >= 6 ? 4 : n >= 4 ? 3 : n >= 2 ? 2 : 1;
        status.fire = n >= 6;
      };
      const pop = (x, y, value) => {
        const i = PN.next;
        PN.next = (i + 1) % POPS;
        PN.value[i] = value; PN.x[i] = x; PN.y[i] = y; PN.t[i] = 0.001;
      };
      const say = (word, x, y) => {
        const i = WP.next;
        WP.next = (i + 1) % SAYS;
        WP.word[i] = word; WP.x[i] = x; WP.y[i] = y; WP.t[i] = 0.001;
      };
      const ring = (x, y, size) => {
        const i = RG.next;
        RG.next = (i + 1) % RINGS;
        RG.x[i] = x; RG.y[i] = y; RG.t[i] = 0.001; RG.size[i] = size;
      };
      // Where the coconut crosses the line `y` on its way, off the walls, into `S.cross` (a returned number is boxed).
      const predict = (y) => {
        const lo = COURT_L + BALL_R, span = COURT_R - BALL_R - lo;
        let p = (S.bx - lo + S.vx * (y - S.by) / S.vy) % (2 * span);
        if (p < 0) p += 2 * span;
        S.cross = lo + (p <= span ? p : 2 * span - p);
      };
      // The coconut at speed `v` on its heading, never flatter than MIN_VY of it, so it always crosses the court.
      const heading = (v) => {
        const k = v / Math.sqrt(S.vx * S.vx + S.vy * S.vy), min = MIN_VY * v;
        S.vx *= k; S.vy *= k;
        if (S.vy < min && S.vy > -min) { S.vy = S.vy < 0 ? -min : min; S.vx = (S.vx < 0 ? -1 : 1) * Math.sqrt(v * v - min * min); }
      };
      // The rival reads a shot coming its way: when it will start to move, how far off it will be, where it wants the
      // coconut on its club (away from the Ooga when it aims, never so far out that its misjudging misses) and whether it
      // smashes (always, off a weak one).
      const think = () => {
        const r = S.rival, v = Math.sqrt(S.vx * S.vx + S.vy * S.vy);
        S.rReact = RV_REACT[r] * (0.75 + 0.5 * R.next());
        S.rErr = (R.next() + R.next() - 1) * RV_ERR[r] * (0.6 + 0.4 * v / RV_BASE[r]);
        S.rAim = R.chance(RV_AIM[r]) ? (S.px < W / 2 ? 1 : -1) * (0.55 + 0.45 * R.next()) : (R.next() - 0.5) * 0.6;
        const room = Math.max(0, 0.92 - Math.abs(S.rErr) / (RV_W[r] / 2 + BALL_R));
        if (S.rAim > room) S.rAim = room; else if (S.rAim < -room) S.rAim = -room;
        S.rSmash = S.weak || R.chance(RV_SMASH[r]) ? 1 : 0;
      };
      // The coconut in someone's hands: on the Ooga's club (it serves with Space, or by itself after a moment), or the
      // rival's, which walks a little way and serves.
      const toServe = (who) => {
        S.on = 1; S.fire = S.weak = S.last = 0; TR.n = 0;
        setRally(0);
        phase = who === 1 ? "serve" : "rserve";
        S.timer = who === 1 ? SERVE_WAIT : RSERVE_S;
        if (who === 2) S.rWant = COURT_L + 24 + R.next() * (COURT_R - COURT_L - 48);
        setVerb();
      };
      const launch = (who) => {
        const base = RV_BASE[S.rival];
        S.speed = base;
        phase = "rally";
        if (who === 1) {
          const a = Math.max(-0.6, Math.min(0.6, S.pv / CLUB_SPEED * 0.45 + R.range(-0.2, 0.2)));
          S.vx = Math.sin(a) * base; S.vy = -Math.cos(a) * base; S.last = 1; S.flash = 0.06;
          out.cue("throw");
          think();
        } else {
          const a = R.range(0.2, 0.55) * (R.chance(0.5) ? 1 : -1);
          S.vx = Math.sin(a) * base; S.vy = Math.cos(a) * base; S.last = 2; S.rSwing = 0.2;
          out.cue("bonk", 0.8);
        }
        setVerb();
      };
      // Space: serves the coconut on the club, or swings the club, whose first SWING seconds smash.
      const act = () => {
        if (phase === "serve") { launch(1); return; }
        if ((phase !== "rally" && phase !== "rserve") || S.recover > 0) return;
        S.swing = SWING; S.recover = SWING + RECOVER;
        out.cue("swish", 0.45);
      };
      const wall = (x) => {
        fx.spawn(x, S.by, 3, 25, P_STONE, P_STONE + 1, 0.3);
        out.cue("clack", 0.45);
      };
      // The coconut meets the Ooga's club: angled by where it lands on it and carried by its sweep; a smash in the
      // swing's window, a weak pop off balance just after it.
      const hitOoga = () => {
        const smash = S.swing > 0, weak = !smash && S.recover > 0, u = Math.max(-1, Math.min(1, (S.bx - S.px) / (CLUB_W / 2 + BALL_R)));
        S.speed = Math.min(SPEED_MAX, S.speed + SPEED_UP);
        const v = S.speed * (smash ? SMASH_K : weak ? WEAK_K : 1), a = u * MAX_TILT + (weak ? R.range(-0.3, 0.3) : 0);
        S.vx = Math.sin(a) * v + S.pv * CARRY; S.vy = -Math.cos(a) * v;
        heading(v);
        S.by = PLAYER_FACE - BALL_R; S.last = 1; S.fire = smash ? 1 : 0; S.weak = weak ? 1 : 0;
        S.returns++;
        setRally(S.rally + 1);
        if (S.rally > S.longest) S.longest = S.rally;
        const pts = (smash ? 30 : 10) * status.mult;
        addScore(pts);
        pop(S.bx, PLAYER_FACE - 7, pts);
        if (smash) {
          S.swing = 0; S.smashes++; S.flash = 0.12;
          say(W_SMASH, S.bx, PLAYER_FACE - 16);
          ring(S.bx, PLAYER_FACE, 10);
          fx.spawn(S.bx, PLAYER_FACE - 1, 18, 70, P_FIRE, P_FIRE + 1, 0.5);
          J.shake(2); J.flash(INK.banana, 0.18);
          out.shake(0.25); out.cue("clang"); out.cue("fire", 0.5);
        } else {
          fx.spawn(S.bx, PLAYER_FACE - 1, weak ? 4 : 8, 40, P_NUT, P_BONE, 0.4);
          out.cue(weak ? "thunk" : "bonk");
          if (weak) say(W_SOON, S.bx, PLAYER_FACE - 16);
        }
        if (S.rally === 2 || S.rally === 4 || S.rally === 6) { say(W_RALLY + S.rally / 2 - 1, W / 2, NET_Y + 12); out.cue("score", 0.6); }
        think();
      };
      const hitRival = () => {
        const r = S.rival, smash = S.rSmash === 1, u = Math.max(-1, Math.min(1, (S.bx - S.rx) / (RV_W[r] / 2 + BALL_R)));
        S.speed = Math.min(SPEED_MAX, S.speed + SPEED_UP);
        const v = S.speed * RV_HIT[r] * (smash ? RIVAL_SMASH_K : 1), a = u * MAX_TILT;
        S.vx = Math.sin(a) * v + S.rv * CARRY * 0.5; S.vy = Math.cos(a) * v;
        heading(v);
        S.by = RIVAL_FACE + BALL_R; S.last = 2; S.fire = smash ? 2 : 0; S.weak = 0; S.rSwing = 0.2;
        fx.spawn(S.bx, RIVAL_FACE + 1, smash ? 12 : 6, smash ? 60 : 35, smash ? P_OUCH : P_NUT, smash ? P_FIRE + 1 : P_NUT + 1, 0.4);
        if (smash) { say(W_HOT, S.bx, RIVAL_FACE + 10); out.cue("clang", 0.8); J.shake(1); }
        else out.cue(r === 1 ? "knock" : "bonk", 0.7);
        // The Mammoth stomps as it swings.
        if (r === 1) J.shake(1);
      };
      // A rival steps up: the first is there from the start, the others drop in once the last has flown off, named on
      // the screen (the callout still carries the last one's beating).
      const meet = (r) => {
        S.rival = r; S.hearts = RV_HEARTS[r]; S.lost = 0; S.rHit = S.out = 0; S.enter = r ? ENTER_S : 0; S.vsT = VS_S; S.rx = S.rWant = W / 2;
        status.round = r + 1; status.target = S.hearts;
        if (r) out.cue("knock");
      };
      const finish = () => {
        phase = "done";
        setVerb();
        status.note = `Rivals ${S.beaten}/${RIVALS} · smashes ${S.smashes} · longest rally ${S.longest}`;
        out.cue(S.won ? "big" : "buzzer");
        out.onEnd(status.score);
      };
      // The rival's hearts are out: a bonus for its place in the line, more for beating it without losing an Ooga; the
      // last one crowns the Ooga, with a bonus for every Ooga standing.
      const beaten = (pts) => {
        const r = S.rival, bonus = 300 * (r + 1) + (S.lost === 0 ? 300 : 0);
        S.beaten++;
        addScore(bonus);
        out.crack(true);
        J.flash(INK.teal, 0.35);
        if (r === RIVALS - 1) {
          const champ = 1500 + 500 * S.lives;
          addScore(champ);
          S.won = 1;
          out.popup(PONG_SAY.champ(pts + bonus + champ), true);
          out.cue("win"); out.over();
          phase = "won"; S.timer = PONG_END_S + 0.6; S.out = 0.001;
        } else {
          out.popup(PONG_SAY.beaten[r](pts + bonus), true);
          out.cue("round");
          phase = "beaten"; S.timer = OUT_S + ENTER_S + 0.3; S.out = 0.001;
        }
        setVerb();
      };
      // The coconut got past the rival's club and bonks the cave wall behind it: the point's worth at the rally's
      // multiplier, twice off a smash.
      const pointWon = () => {
        const smash = S.fire === 1, pts = 150 * status.mult * (smash ? 2 : 1);
        S.on = 0; S.points++; S.hearts--; S.rHit = 0.9;
        status.target = S.hearts;
        addScore(pts);
        pop(S.bx, PONG_TOP + 5, pts);
        fx.spawn(S.bx, PONG_TOP + 4, 22, 70, P_NUT, P_NUT + 1, 0.7);
        fx.spawn(S.bx, PONG_TOP + 4, 8, 50, smash ? P_FIRE : P_BONE, smash ? P_FIRE + 1 : P_BONE + 1, 0.5);
        ring(S.bx, PONG_TOP + 4, 12);
        J.shake(smash ? 3 : 2); J.flash(smash ? INK.banana : INK.cream, smash ? 0.3 : 0.12);
        if (S.hearts <= 0) { beaten(pts); return; }
        out.crack(smash || S.rally >= 6);
        out.cue(smash ? "big" : "score");
        out.popup(smash ? PONG_SAY.smash(pts) : PONG_SAY.point(pts), smash);
        phase = "point"; S.timer = POINT_S; S.next = 2;
        setVerb();
      };
      // The coconut got past the Ooga's club and cracks on the ground: an Ooga lost, and the rally with it.
      const pointLost = () => {
        S.on = 0; S.lives--; S.lost++; S.dizzy = 1.2;
        status.left = S.lives;
        setRally(0);
        fx.spawn(S.bx, PONG_GROUND - 2, 20, 60, P_NUT, P_NUT + 1, 0.6);
        fx.spawn(S.px, PLAYER_FACE + 5, 10, 45, P_OUCH, P_OUCH + 1, 0.5);
        ring(S.bx, PONG_GROUND - 2, 12);
        J.shake(4); J.flash(INK.red, 0.45);
        out.shake(0.7); out.cue("slam"); out.flop();
        if (S.lives <= 0) { out.popup(PONG_SAY.out, true); phase = "over"; S.timer = PONG_END_S; out.over(); }
        else { out.popup(S.lives === 1 ? PONG_SAY.last : PONG_SAY.bonked, false); phase = "point"; S.timer = POINT_S; S.next = 1; }
        setVerb();
      };
      const banana = () => {
        const pts = 100 * status.mult, x = S.banX + 4, y = S.banY + 3;
        S.ban = 0; S.banNext = 7 + R.next() * 5; S.bananas++;
        addScore(pts);
        pop(x, y - 5, pts);
        say(W_BANANA, x, y - 13);
        fx.spawn(x, y, 20, 60, P_GOLD, P_FIRE, 0.6);
        ring(x, y, 10);
        J.flash(INK.banana, 0.15);
        out.cue("ding"); out.cue("coin", 0.6); out.crack(false);
      };
      // The banana hangs over the rival's half for a while now and then; only a coconut of the Ooga's knocks it down.
      const stepBanana = (h) => {
        if (S.ban) {
          S.banT -= h;
          if (S.banT <= 0) { S.ban = 0; S.banNext = 6 + R.next() * 5; }
          return;
        }
        if (phase !== "rally" && phase !== "serve" && phase !== "rserve") return;
        S.banNext -= h;
        if (S.banNext <= 0) { S.ban = 1; S.banT = 8; S.banX = COURT_L + 14 + Math.floor(R.next() * (COURT_R - COURT_L - 36)); S.banY = 34 + Math.floor(R.next() * 16); out.cue("chirp", 0.5); }
      };
      // The rival reads the shot after its reaction time and heads where it will meet the coconut on its club where it
      // wants to; otherwise it drifts back toward the middle, following the coconut a little.
      const stepRival = (h) => {
        const r = S.rival, half = RV_W[r] / 2;
        let top = RV_SPEED[r];
        if (S.out > 0 || S.enter > 0) { S.rv = 0; return; }
        if (phase === "rally" && S.vy < 0) {
          if (S.rReact > 0) S.rReact -= h;
          else { predict(RIVAL_FACE + BALL_R); S.rWant = S.cross + S.rErr - S.rAim * (half + BALL_R); }
        } else if (phase !== "rserve") { S.rWant = W / 2 + (S.bx - W / 2) * 0.3; top *= 0.55; }
        const want = Math.max(COURT_L + half, Math.min(COURT_R - half, S.rWant)), dx = Math.max(-top * h, Math.min(top * h, want - S.rx));
        S.rx += dx; S.rv = dx / h;
        if (dx > 0.05 || dx < -0.05) S.rWalk += h;
      };
      const stepBall = (h) => {
        const oy = S.by, r = S.rival;
        S.bx += S.vx * h; S.by += S.vy * h; S.spin += h;
        if (S.bx < COURT_L + BALL_R) { S.bx = 2 * (COURT_L + BALL_R) - S.bx; S.vx = -S.vx; wall(COURT_L + 1); }
        else if (S.bx > COURT_R - BALL_R) { S.bx = 2 * (COURT_R - BALL_R) - S.bx; S.vx = -S.vx; wall(COURT_R - 1); }
        if (S.vy > 0 && oy + BALL_R < PLAYER_FACE && S.by + BALL_R >= PLAYER_FACE && S.bx > S.px - CLUB_W / 2 - BALL_R && S.bx < S.px + CLUB_W / 2 + BALL_R) hitOoga();
        else if (S.vy < 0 && oy - BALL_R > RIVAL_FACE && S.by - BALL_R <= RIVAL_FACE && S.bx > S.rx - RV_W[r] / 2 - BALL_R && S.bx < S.rx + RV_W[r] / 2 + BALL_R) hitRival();
        else if (S.by > PONG_GROUND - 3) { pointLost(); return; }
        else if (S.by < PONG_TOP + 3) { pointWon(); return; }
        if (S.ban && S.last === 1 && S.bx > S.banX - 2 && S.bx < S.banX + 10 && S.by > S.banY - 2 && S.by < S.banY + 8) banana();
        TR.t += h;
        if (TR.t >= 1 / 60) {
          const i = TR.next;
          TR.t = 0; TR.next = (i + 1) % TRAIL;
          TR.x[i] = S.bx; TR.y[i] = S.by; TR.fire[i] = S.fire;
          if (TR.n < TRAIL) TR.n++;
        }
      };
      const step = (h) => {
        S.swing = Math.max(0, S.swing - h); S.recover = Math.max(0, S.recover - h);
        S.dizzy = Math.max(0, S.dizzy - h); S.flash = Math.max(0, S.flash - h);
        S.rHit = Math.max(0, S.rHit - h); S.rSwing = Math.max(0, S.rSwing - h); S.enter = Math.max(0, S.enter - h); S.vsT = Math.max(0, S.vsT - h);
        if (S.out > 0) S.out = Math.min(OUT_S, S.out + h);
        // The club follows the aim at the Ooga's own pace; a dizzy Ooga stands still.
        const want = Math.max(COURT_L + CLUB_W / 2, Math.min(COURT_R - CLUB_W / 2, W / 2 + aim.x * 72));
        const dx = S.dizzy > 0 ? 0 : Math.max(-CLUB_SPEED * h, Math.min(CLUB_SPEED * h, want - S.px));
        S.px += dx; S.pv = dx / h;
        if (dx > 0.05 || dx < -0.05) S.walk += h;
        stepRival(h);
        stepBanana(h);
        if (phase === "rally") stepBall(h);
        else if (phase === "serve") {
          S.bx = S.px; S.by = PLAYER_FACE - BALL_R - 1;
          S.timer -= h;
          if (S.timer <= 0) launch(1);
        } else if (phase === "rserve") {
          S.bx = S.rx; S.by = RIVAL_FACE + BALL_R + 1;
          if (S.enter <= 0 && (S.timer -= h) <= 0) launch(2);
        } else if (phase === "point") {
          S.timer -= h;
          if (S.timer <= 0) toServe(S.next);
        } else if (phase === "beaten") {
          S.timer -= h;
          if (S.out >= OUT_S) meet(S.rival + 1);
          else if (S.out <= 0 && S.timer <= 0) toServe(1);
        } else if (phase === "over" || phase === "won") {
          S.timer -= h;
          // A champion's fireworks over the court.
          if (phase === "won" && (S.fireT -= h) <= 0) { S.fireT = 0.28; fx.spawn(20 + Math.random() * (W - 40), 26 + Math.random() * 40, 22, 65, Math.random() < 0.5 ? P_FIRE : P_GOLD, P_FIRE + 1, 0.9); out.cue("tap", 0.5); }
          if (S.timer <= 0) finish();
        }
      };
      const run = stepper(step);

      // ---- drawing ------------------------------------------------------------------------------------------
      // A club across `w` px centred on `cx`, its top at `y`: kind 0 a bone, 1 a log, 2 the Chief's painted bone; `lit`
      // flashes it white.
      const club = (ctx, cx, y, w, kind, lit) => {
        const x0 = Math.round(cx - w / 2), x1 = x0 + w;
        if (kind === 1) {
          ctx.fillStyle = lit ? INK.white : "#7a4e28"; ctx.fillRect(x0, y, w, 3);
          ctx.fillStyle = "#4e3018"; ctx.fillRect(x0, y + 2, w, 1);
          for (let x = x0 + 3; x < x1 - 3; x += 5) ctx.fillRect(x, y + 1, 2, 1);
          ctx.fillStyle = "#b07a44"; ctx.fillRect(x0, y, 1, 3); ctx.fillRect(x1 - 1, y, 1, 3);
          return;
        }
        ctx.fillStyle = lit ? INK.white : INK.bone; ctx.fillRect(x0 + 2, y, w - 4, 2); ctx.fillRect(x0, y - 1, 3, 4); ctx.fillRect(x1 - 3, y - 1, 3, 4);
        ctx.fillStyle = "#b8ac94"; ctx.fillRect(x0 + 3, y + 2, w - 6, 1);
        if (kind === 2) { ctx.fillStyle = INK.red; ctx.fillRect(x0 + 5, y, 2, 2); ctx.fillRect(x1 - 7, y, 2, 2); ctx.fillRect(x0 + (w >> 1) - 1, y, 2, 2); }
      };
      // Three stars going round a bonked head.
      const stars = (ctx, cx, cy) => {
        ctx.fillStyle = INK.banana;
        for (let k = 0; k < 3; k++) { const a = S.clock * 7 + k * 2.09; ctx.fillRect(Math.round(cx + Math.cos(a) * 6), Math.round(cy + Math.sin(a) * 2), 1, 1); }
      };
      const drawTorches = (ctx) => {
        for (let k = 0; k < 4; k++) {
          const x = k & 1 ? COURT_R - 2 : COURT_L, y = k & 2 ? 84 : 38, f = (S.clock * 9 + k * 1.7) | 0;
          ctx.fillStyle = INK.red; ctx.fillRect(x, y + 2, 2, 2);
          ctx.fillStyle = f & 1 ? INK.banana : INK.ember; ctx.fillRect(x, y + (f & 2 ? 0 : 1), 2, 2);
          ctx.fillStyle = INK.banana; ctx.fillRect(x + (f & 1), y - 1 + (f & 2 ? 0 : 1), 1, 1);
        }
      };
      // Sprites and clubs are placed on whole pixels before the calls, as a fraction handed to a call is boxed.
      const drawRival = (ctx) => {
        const r = S.rival, cx = Math.round(S.rx), f = (S.rWalk * 7 | 0) & 1, hit = S.rHit > 0.5 && (S.clock * 20 | 0) % 2 === 1;
        // Beaten, it flies up out of the court; the next drops in.
        const dy = S.out > 0 ? -Math.round(S.out * S.out / (OUT_S * OUT_S) * 36) : S.enter > 0 ? -Math.round(S.enter / ENTER_S * 30) : 0;
        if (r === 0) blit(ctx, hit ? art.kidHit : art.kid[S.rSwing > 0 ? 2 : f], cx - 5, RIVAL_FACE - 14 + dy);
        else if (r === 1) blit(ctx, hit ? art.mammothHit[f] : art.mammoth[S.rv < 0 ? 1 : 0][f], cx - 8, RIVAL_FACE - 13 + dy);
        else if (r === 2) blit(ctx, hit ? art.pteroHit[(S.clock * 6 | 0) & 1] : art.ptero[(S.clock * 6 | 0) & 1], cx - 6, RIVAL_FACE - 11 + dy + Math.round(Math.sin(S.clock * 5)));
        else blit(ctx, hit ? art.chiefHit : art.chief[f], cx - 6, RIVAL_FACE - 15 + dy);
        club(ctx, cx, RIVAL_FACE - 3 + dy - (S.rSwing > 0.1 ? 1 : 0), RV_W[r], RV_CLUB[r], S.rSwing > 0.14);
        if (S.rHit > 0 && S.out <= 0) stars(ctx, cx, RIVAL_FACE - 15);
      };
      const drawBall = (ctx) => {
        if (!S.on) return;
        // The trail, oldest first: dust behind a coconut, fire behind a smash.
        for (let k = TR.n; k > 0; k--) {
          const i = (TR.next - k + TRAIL) % TRAIL, x = Math.round(TR.x[i]), y = Math.round(TR.y[i]), fire = TR.fire[i];
          if (fire) {
            ctx.fillStyle = fire === 1 ? (k < 3 ? INK.banana : k < 6 ? INK.ember : INK.red) : k < 4 ? INK.red : INK.rust;
            if (k < 4) ctx.fillRect(x - 1, y - 1, 2, 2); else ctx.fillRect(x, y, 1, 1);
          } else if (k < 5) { ctx.fillStyle = "#5a3e24"; ctx.fillRect(x, y, 1, 1); }
        }
        if (S.fire === 1) blit(ctx, art.gold, Math.round(S.bx - 2.5), Math.round(S.by - 2.5));
        else {
          blit(ctx, art.nut[(S.spin * 14 | 0) & 3], Math.round(S.bx - 2.5), Math.round(S.by - 2.5));
          if (S.fire === 2 && (S.clock * 20 | 0) % 2) { ctx.fillStyle = INK.red; ctx.fillRect(Math.round(S.bx) - 2, Math.round(S.by) - 3, 4, 1); }
        }
        // Waiting on the club to be served: an arrow over it.
        if (phase === "serve" && (S.clock * 3 | 0) % 2) { const x = Math.round(S.bx); ctx.fillStyle = INK.bone; ctx.fillRect(x, PLAYER_FACE - 13, 1, 5); ctx.fillRect(x - 1, PLAYER_FACE - 12, 3, 1); ctx.fillRect(x - 2, PLAYER_FACE - 11, 1, 1); ctx.fillRect(x + 2, PLAYER_FACE - 11, 1, 1); }
      };
      const drawOoga = (ctx) => {
        const lift = S.swing > 0 ? 2 : S.recover > RECOVER ? 1 : phase === "won" ? Math.round(Math.abs(Math.sin(S.clock * 9)) * 3) : 0, cx = Math.round(S.px), hit = S.dizzy > 0.8 && (S.clock * 20 | 0) % 2 === 1;
        blit(ctx, hit ? art.oogaHit : art.ooga[(S.walk * 8 | 0) & 1], cx - 5, PLAYER_FACE + 3 - lift);
        club(ctx, cx, PLAYER_FACE - lift, CLUB_W, 0, S.flash > 0);
        // The swing's whoosh off the club's ends.
        if (S.swing > 0) { ctx.fillStyle = INK.cream; ctx.fillRect(Math.round(cx - CLUB_W / 2) - 2, PLAYER_FACE - 4, 1, 3); ctx.fillRect(Math.round(cx + CLUB_W / 2) + 1, PLAYER_FACE - 4, 1, 3); }
        if (S.dizzy > 0) stars(ctx, cx, PLAYER_FACE + 2);
      };
      const drawHud = (ctx) => {
        const r = S.rival, name = RV_NAME[r];
        number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
        if (status.mult > 1) { text(ctx, "X", 36, 1, TEXT.ember); number(ctx, status.mult, 42, 1, TEXT.ember); }
        text(ctx, name, 89 - (textWidth(name) >> 1), 1, RV_INK[r]);
        for (let k = 0; k < RV_HEARTS[r]; k++) blit(ctx, k < S.hearts ? art.heart : art.heartOut, W - 8 - k * 6, 2);
        for (let k = 0; k < S.lives; k++) blit(ctx, art.head, 3 + k * 7, PONG_GROUND + 1);
      };
      // A new rival's name across the court, under the play so a coconut in flight always shows over it, from VS_WAIT
      // on, once the callout for the last one's beating has gone.
      const drawVs = (ctx) => {
        const r = S.rival, name = RV_NAME[r];
        ctx.globalAlpha = 0.55; ctx.fillStyle = INK.night; ctx.fillRect(COURT_L, 40, COURT_R - COURT_L, 42); ctx.globalAlpha = 1;
        centre(ctx, "VS", 44, TEXT.bone, 2);
        if (S.vsT < VS_S - VS_WAIT - 0.25 || (S.clock * 12 | 0) % 2) text(ctx, name, (W - textWidth(name, 2)) >> 1, 64, RV_INK[r], 2);
      };
      const drawOver = (ctx) => {
        ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, PONG_TOP, W, PONG_GROUND - PONG_TOP); ctx.globalAlpha = 1;
        centre(ctx, S.won ? "CHAMPION!" : "GAME OVER", 40, S.won ? TEXT.gold : TEXT.red, 2);
        centre(ctx, "SCORE", 62, TEXT.stone);
        number(ctx, status.score, W / 2, 72, TEXT.banana, 2, 1);
      };
      const drawAttract = (ctx) => {
        ctx.globalAlpha = 0.7; ctx.fillStyle = INK.night; ctx.fillRect(COURT_L, PONG_TOP, COURT_R - COURT_L, PONG_GROUND - PONG_TOP); ctx.globalAlpha = 1;
        centre(ctx, "OOGA", 12, TEXT.gold, 2);
        centre(ctx, "PONG", 30, TEXT.lime, 2);
        const f = (S.clock * 2 | 0) & 1;
        blit(ctx, art.kid[f], 43, 49); text(ctx, "LITTLE OOGA", 62, 51, TEXT.ember);
        blit(ctx, art.mammoth[0][f], 40, 62); text(ctx, "MAMMOTH", 62, 64, TEXT.gold);
        blit(ctx, art.ptero[f], 42, 77); text(ctx, "PTERO", 62, 77, TEXT.violet);
        blit(ctx, art.chief[f], 42, 87); text(ctx, "OOGA CHIEF", 62, 90, TEXT.red);
        if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 104, TEXT.bone);
        text(ctx, "HI", 3, 1, TEXT.stone);
        number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
      };

      const reset = () => {
        PN.t.fill(0); WP.t.fill(0); RG.t.fill(0);
        fx.clear(); J.reset();
        S.px = S.rx = S.rWant = S.bx = W / 2; S.by = PLAYER_FACE - BALL_R - 1; S.pv = S.rv = 0;
        S.swing = S.recover = S.dizzy = S.flash = S.rHit = S.rSwing = S.out = S.enter = S.vsT = 0;
        S.ban = 0; S.on = 1; S.fire = S.weak = S.last = 0; TR.n = 0;
        status.fire = false; status.meter = -1; status.note = "";
        setRally(0);
      };
      reset();
      status.left = PONG_LIVES; status.target = RV_HEARTS[0];
      return {
        kind: "pong", name: "Ooga Pong", aims: true, status,
        help: "Drag, arrows or A and D move your Ooga; the club's ends angle the coconut. Space or tap smashes as it lands. Beat four rivals.",
        coach: ["A and D move, Space smashes as it lands", "Drag to move, tap Smash as it lands"],
        stars: [1500, 5500, 12000], tickets: (score) => Math.floor(score / 375),
        get playing() { return phase !== "idle" && phase !== "done"; },
        get seed() { return S.seed; },
        start: (seed) => {
          if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
          reset();
          status.score = 0; S.lives = PONG_LIVES; status.left = PONG_LIVES; S.won = 0;
          S.returns = S.smashes = S.points = S.bananas = S.beaten = S.longest = 0;
          S.banNext = 7 + R.next() * 4;
          meet(0);
          toServe(1);
        },
        stop: () => { phase = "idle"; reset(); S.rival = 0; status.round = 1; status.left = PONG_LIVES; status.target = RV_HEARTS[0]; setVerb(); },
        act,
        update: (dt) => {
          S.clock += dt;
          J.update(dt);
          fx.update(dt);
          for (let i = 0; i < POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
          for (let i = 0; i < SAYS; i++) if (WP.t[i] > 0) { WP.t[i] += dt; if (WP.t[i] > 0.8) WP.t[i] = 0; }
          for (let i = 0; i < RINGS; i++) if (RG.t[i] > 0) { RG.t[i] += dt; if (RG.t[i] > 0.2) RG.t[i] = 0; }
          if (phase !== "idle" && phase !== "done") run(dt);
        },
        draw: (ctx) => {
          ctx.drawImage(art.back, 0, 0);
          drawTorches(ctx);
          if (phase === "idle") { drawAttract(ctx); return; }
          if (S.vsT > 0 && S.vsT < VS_S - VS_WAIT) drawVs(ctx);
          J.begin(ctx);
          if (S.ban && (S.banT > 2 || (S.clock * 8 | 0) % 2)) blit(ctx, art.banana, S.banX, S.banY + Math.round(Math.sin(S.clock * 3)));
          drawRival(ctx);
          drawBall(ctx);
          drawOoga(ctx);
          fx.draw(ctx);
          ctx.fillStyle = INK.cream;
          for (let i = 0; i < RINGS; i++) {
            if (RG.t[i] <= 0) continue;
            const rr = 2 + RG.size[i] * RG.t[i] / 0.2;
            for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(RG.x[i] + COS8[k] * rr), Math.round(RG.y[i] + SIN8[k] * rr), 1, 1);
          }
          for (let i = 0; i < POPS; i++) if (PN.t[i] > 0 && (PN.t[i] < 0.6 || (S.clock * 16 | 0) % 2)) number(ctx, PN.value[i], Math.round(PN.x[i]), Math.round(PN.y[i] - PN.t[i] * 12), TEXT.banana, 1, 1);
          for (let i = 0; i < SAYS; i++) {
            if (WP.t[i] <= 0) continue;
            const s = PONG_WORDS[WP.word[i]], w = textWidth(s), x = Math.max(2, Math.min(W - 2 - w, Math.round(WP.x[i] - w / 2)));
            if (WP.t[i] < 0.55 || (S.clock * 16 | 0) % 2) text(ctx, s, x, Math.round(WP.y[i] - WP.t[i] * 10), PONG_WORD_INK[WP.word[i]]);
          }
          J.end(ctx);
          // A rival flying off or dropping in passes behind the score band.
          if (S.out > 0 || S.enter > 0) ctx.drawImage(art.back, 0, 0, W, PONG_TOP, 0, 0, W, PONG_TOP);
          drawHud(ctx);
          if (phase === "done") drawOver(ctx);
        }
      };
    };
  })();

  // ---- Mammoth Stampede ---------------------------------------------------------------------------------------
  // Frogger in the valley. An Ooga hops up from the grass across five lanes of charging beasts (boars, mammoth
  // calves, sabre-tooths, woolly rhinos, mammoths), gets its breath back on the stones half way, then rides logs and
  // stone turtles over the river into one of the five caves in the cliff; fill all five and the next herd comes
  // faster. Now and then STAMPEDE! flashes in a lane and a herd of mammoths thunders through it a moment later.
  // From the second herd turtles dive and a crocodile swims the top of the river; the third brings shorter logs, a
  // thicker plain and a python sliding over the stones. A banana bunch rides a log (it pays when grabbed and again
  // when carried home), a golden coconut glows in a cave for a while, a hop that lands a hair from a charging beast is
  // a close shave, and caves reached in a row without losing an Ooga multiply what a cave pays. Each crossing runs
  // against the clock under the field, and the time left pays at the cave. Three Oogas, one more at MS_EXTRA_AT;
  // three herds; lose them all and it is over.
  // Act hops forward (never back), `aim.steps` steps aside a column a press, and a held key keeps stepping.
  const MS_ROWS = 13, MS_PER = 6, MS_LANE = 8, MS_Y0 = 107, MS_MID = 6, MS_HOME = 12, MS_PW = 7, MS_START_X = 76, MS_SIDE = 8;
  const MS_HOP_T = 0.1, MS_SIDE_T = 0.07, MS_REPEAT = 0.24, MS_REPEAT_EVERY = 0.12, MS_TIME = 25, MS_LIVES = 3, MS_EXTRA_AT = 6000, MS_LEVELS = 3;
  const MS_DEAD_S = 1.1, MS_HOME_S = 0.35, MS_CLEAR_S = 2, MS_OVER_S = 1.8, MS_BANNER = 1.6, MS_CLOSE_S = 0.3, MS_SHAVE = 3, MS_DIVE = 5, MS_GAP = 17;
  const MS_CAVE_X = [16, 48, 80, 112, 144], MS_CAVE_TOL = 7, MS_SPAN_PLAIN = W + 40, MS_SPAN_RIVER = W + 72;
  // What stands in a lane: the beasts 0..4 (boar, calf, sabre-tooth, woolly rhino, mammoth), then the river's log,
  // raft of turtles and crocodile; each beast's width and how far down its lane it stands.
  const MS_MAMMOTH = 4, MS_LOG = 5, MS_TURTLES = 6, MS_CROC = 7;
  const MS_BEAST_W = [10, 11, 12, 14, 16], MS_BEAST_DY = [2, 1, 2, 1, 1];
  // The lanes by row, bottom up (0 the grass, 1-5 the plain, 6 the stones, 7-11 the river, 12 the caves): what runs
  // there, its way, its speed at the first herd in px/s, how many, and a log's length or a raft's turtles.
  const MS_KIND = [-1, 0, 1, 2, 3, 4, -1, 6, 5, 5, 6, 5, -1], MS_DIR = [0, -1, 1, -1, 1, -1, 0, -1, 1, -1, 1, -1, 0];
  const MS_SPEED = [0, 15, 20, 34, 22, 13, 0, 12, 10, 18, 14, 13, 0], MS_COUNT = [0, 3, 3, 2, 2, 3, 0, 4, 3, 3, 4, 4, 0];
  const MS_SIZE = [0, 0, 0, 0, 0, 0, 0, 3, 40, 48, 3, 32, 0];
  // How an Ooga goes down, which picks its line and its fall.
  const MS_TRAMPLE = 0, MS_SPLASH = 1, MS_SWEPT = 2, MS_ROCK = 3, MS_TAKEN = 4, MS_CHOMP = 5, MS_BITE = 6, MS_SLOW = 7;
  const msRowY = (r) => MS_Y0 - r * MS_LANE;
  // The sparks' inks, by index: dust, water, the Ooga, gold, leaf, stone, ember.
  const MS_SPARKS = ["#8a6440", "#5a3f28", "#7fb8e0", "#dff2ff", INK.skin, INK.hair, INK.banana, INK.white, INK.leaf, INK.lime, INK.stoneLt, INK.stone, INK.ember, INK.red];
  const M_DUST = 0, M_WATER = 2, M_OOGA = 4, M_GOLD = 6, M_LEAF = 8, M_STONE = 10, M_EMBER = 12;
  const MS_OOGA_ROWS = [
    [".hHHHh.", "hHHHHHh", "HSKSKSH", ".SSsSS.", "SLLLLLS", ".LlLlL.", ".S...S."],
    ["S.hHh.S", "ShHHHhS", ".SKSKS.", ".SSsSS.", "..LLL..", ".SLlLS.", "S.....S"]
  ];
  const MS_SPLAT_ROWS = ["..hHHHh..", ".HSKSKSH.", "SSLLLLLSS", "S.S...S.S"];
  const MS_BEAST_INKS = [
    { B: "#6b4a2c", b: "#3e2818", K: "#1b1410", T: INK.bone, P: "#c9876a" },
    { M: "#8a6440", m: "#5a3f28", K: "#1b1410", T: INK.bone },
    { O: INK.ochre, o: "#8a5210", K: "#1b1410", T: INK.bone },
    { R: "#8a7a66", r: "#5a4c3e", K: "#1b1410", C: INK.bone },
    { M: "#7a5230", m: "#4e3420", K: "#1b1410", T: INK.bone }
  ];
  // The stampede's mammoths: red with rage and a glowing eye, so a charging herd never reads as the lane's own.
  const MS_HERD_INKS = { M: "#9a4a26", m: "#5a2410", K: INK.banana, T: INK.cream };
  const MS_BEAST_ROWS = [
    [[".bbbbbb...", "bBBBBBBBb.", "BBBBBBBBKb", "BBBBBBBBBP", ".BBBBBBBT.", ".B.B..B.B."], [".bbbbbb...", "bBBBBBBBb.", "BBBBBBBBKb", "BBBBBBBBBP", ".BBBBBBBT.", "B.B..B.B.."]],
    [["...mmmm....", ".mmMMMMmm..", "mMMMMMMMMm.", "MMMMMMMMMKm", "MMMMMMMMMMM", ".MMMMMMMMTM", ".M.M..M.M.M"], ["...mmmm....", ".mmMMMMmm..", "mMMMMMMMMm.", "MMMMMMMMMKm", "MMMMMMMMMMM", ".MMMMMMMMTM", "M.M..M.M..M"]],
    [["o.........O.", ".oOoOoOoOOOO", "..OOOOOOOOKO", "..OOOOOOOOOO", "..O.O..O.OTT", ".O...O.O..T."], ["o.........O.", ".oOoOoOoOOOO", "..OOOOOOOOKO", "..OOOOOOOOOO", "..O.O..O.OTT", "..O.O...O.T."]],
    [["......rrrr....", "...rrRRRRRr..C", ".rRRRRRRRRRRCC", "rRRRRRRRRRRKRC", "RRRRRRRRRRRRRR", ".RRRRRRRRRRRR.", ".RR.RR..RR.RR."], ["......rrrr....", "...rrRRRRRr..C", ".rRRRRRRRRRRCC", "rRRRRRRRRRRKRC", "RRRRRRRRRRRRRR", ".RRRRRRRRRRRR.", "..RR.RR..RRRR."]],
    [["....mmmmmm......", "..mmMMMMMMmm....", ".mMMMMMMMMMMMm..", "mMMMMMMMMMMMKMm.", "MMMMMMMMMMMMMMMM", "MMMMMMMMMMMTTTMM", ".MM.MM..MM.M..TM"], ["....mmmmmm......", "..mmMMMMMMmm....", ".mMMMMMMMMMMMm..", "mMMMMMMMMMMMKMm.", "MMMMMMMMMMMMMMMM", "MMMMMMMMMMMTTTMM", "..MM.MM..MM..T.M"]]
  ];
  // A raft's turtle facing left (up, half under and under), the crocodile facing right (shut and open), the python
  // on the stones and the banana bunch.
  const MS_TURTLE_INKS = { G: "#4f8a3a", g: "#2f5a24", h: INK.stone, f: "#6b6b73", w: "#9fd0f0" };
  const MS_TURTLE_ROWS = [
    ["..GGGG..", ".GgGGgG.", "hGGgGGgG", ".GgGGGG.", ".f.ff.f."],
    ["........", "........", "..GGGG..", "wGgGGgGw", ".ww..ww."],
    ["........", "........", "........", ".w.ww.w.", "........"]
  ];
  const MS_CROC_INKS = { C: "#4a7a3a", c: "#2f4f24", x: "#6fae3a", K: INK.banana, t: INK.bone, r: "#b8472c" };
  const MS_CROC_ROWS = [
    ["..........................K.....", "..x.x.x.x.x.x.x.x.x.CCCCCCCCC...", "cCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.", ".ccCCCCCCCCCCCCCCCCCCCCCtCtCtCCC", "...cc.......cc......ccCCCCCCCC.."],
    ["........................CCCCK...", "..x.x.x.x.x.x.x.x.x.CCCCCtCtCtC.", "cCCCCCCCCCCCCCCCCCCCCCCr........", ".ccCCCCCCCCCCCCCCCCCCCCrtCtCtCCC", "...cc.......cc......ccCCCCCCCC.."]
  ];
  const MS_SNAKE_INKS = { s: "#c8a040", S: "#8a6a20", K: "#1b1410" };
  const MS_SNAKE_ROWS = [["..ss....ss..SS", ".s..s..s..s.SK", "s....ss....s.."], ["s....ss....sSS", ".s..s..s..s.SK", "..ss....ss...."]];
  const MS_BANANA_ROWS = ["..g..", ".YgY.", "YYyYY", "Yy.yY", ".y.y."], MS_BANANA_INKS = { Y: INK.banana, y: "#e0a228", g: INK.leaf }, MS_BANANA_LANES = [8, 9, 11];
  // Built once for the page on the first game: every sprite both ways, the logs, a river lane's water to scroll and
  // the valley's backdrop (the cliff and its caves, the stones, the plain and the grass).
  let msArt = null;
  const stampedeArt = () => {
    if (msArt) return msArt;
    const ways = (rows, inks) => [rows.map((r) => sprite(r, inks)), rows.map((r) => sprite(r, inks, true))];
    const back = canvasOf(W, H), b = back.getContext("2d"), dots = BL.math.mulberry32(11);
    const speck = (x0, y0, w, h, inks, n) => { for (let i = 0; i < n; i++) { b.fillStyle = inks[i % inks.length]; b.fillRect(x0 + Math.floor(dots() * w), y0 + Math.floor(dots() * h), 1 + (i % 3 === 0 ? 1 : 0), 1); } };
    b.fillStyle = INK.night; b.fillRect(0, 0, W, H);
    b.fillStyle = INK.band; b.fillRect(0, 0, W, 9);
    // The cliff: a rock face with a jagged lit edge and a dark foot, cave paint between the mouths, and the five caves.
    const top = msRowY(MS_HOME);
    b.fillStyle = "#4a3a2e"; b.fillRect(0, 9, W, top + MS_LANE - 9);
    speck(0, 9, W, top + MS_LANE - 9, ["#5c4a3a", "#3a2c22", "#6b5646"], 110);
    for (let x = 0; x < W; x++) { b.fillStyle = x % 5 === 2 ? "#3a2c22" : "#6b5646"; b.fillRect(x, 9 + (x * 7 % 3 === 0 ? 1 : 0), 1, 1); }
    b.fillStyle = "#2a1e16"; b.fillRect(0, top + MS_LANE - 1, W, 1);
    for (const cx of MS_CAVE_X) {
      b.fillStyle = "#6b5646"; b.fillRect(cx - 5, top - 1, 10, 1); b.fillRect(cx - 7, top, 14, 1);
      b.fillStyle = "#140d09"; b.fillRect(cx - 4, top, 8, 1); b.fillRect(cx - 6, top + 1, 12, 1); b.fillRect(cx - 7, top + 2, 14, MS_LANE - 2);
      b.fillStyle = "#24170f"; b.fillRect(cx - 7, top + MS_LANE - 1, 14, 1);
    }
    for (let k = 0; k < 4; k++) {
      const x = 30 + k * 32;
      b.fillStyle = k & 1 ? INK.ochre : INK.rust;
      if (k & 1) { b.fillRect(x, top + 1, 1, 1); b.fillRect(x - 1, top + 2, 3, 1); b.fillRect(x, top + 3, 1, 2); b.fillRect(x - 1, top + 5, 1, 1); b.fillRect(x + 1, top + 5, 1, 1); }
      else { b.fillRect(x - 2, top + 2, 4, 2); b.fillRect(x - 2, top + 4, 1, 2); b.fillRect(x + 1, top + 4, 1, 2); b.fillRect(x + 2, top + 2, 1, 3); }
    }
    // The stones mid-way: a wet edge to the river, pebbles and tufts.
    const mid = msRowY(MS_MID);
    b.fillStyle = "#5a5048"; b.fillRect(0, mid, W, MS_LANE);
    b.fillStyle = "#3a322c"; b.fillRect(0, mid, W, 1);
    speck(0, mid + 1, W, MS_LANE - 1, ["#7a6e62", "#46403a", "#6b6258"], 120);
    for (let x = 3; x < W; x += 11 + (x % 3)) { b.fillStyle = INK.leaf; b.fillRect(x, mid + 6, 1, 2); b.fillRect(x + 1, mid + 5, 1, 3); b.fillStyle = INK.moss; b.fillRect(x + 2, mid + 6, 1, 2); }
    // The plain: packed earth, each lane a shade, dust lines between them and hoof prints.
    for (let r = 1; r <= 5; r++) {
      const y = msRowY(r);
      b.fillStyle = r & 1 ? "#3b2a1a" : "#34251a"; b.fillRect(0, y, W, MS_LANE);
      if (r < 5) { b.fillStyle = "#4e3822"; for (let x = (r * 3) % 6; x < W; x += 6) b.fillRect(x, y, 3, 1); }
      speck(0, y + 1, W, MS_LANE - 1, ["#261a10", "#4a3522"], 22);
    }
    // The grass the Ooga starts from, with flowers.
    const grass = msRowY(0);
    b.fillStyle = INK.moss; b.fillRect(0, grass, W, MS_LANE);
    b.fillStyle = "#4f8a3a"; b.fillRect(0, grass, W, 1);
    speck(0, grass + 1, W, MS_LANE - 1, [INK.leaf, "#2c5a1c", "#4f8a3a"], 90);
    for (let x = 5; x < W; x += 13 + (x % 5)) { b.fillStyle = x & 1 ? INK.banana : INK.pink; b.fillRect(x, grass + 3 + (x % 3), 1, 1); }
    b.fillStyle = INK.band; b.fillRect(0, grass + MS_LANE, W, H - grass - MS_LANE);
    // A river lane's water, a 32 px tile repeated so a scroll by any whole offset under 32 is seamless.
    const water = canvasOf(W + 32, MS_LANE), w = water.getContext("2d"), rip = BL.math.mulberry32(5);
    w.fillStyle = "#1d4470"; w.fillRect(0, 0, W + 32, MS_LANE);
    w.fillStyle = "#173a60"; w.fillRect(0, MS_LANE - 1, W + 32, 1);
    for (let k = 0; k < 6; k++) {
      const x0 = Math.floor(rip() * 32), y0 = 1 + Math.floor(rip() * 5), len = 2 + Math.floor(rip() * 4);
      w.fillStyle = k === 5 ? "#9fd0f0" : k & 1 ? "#3d74a8" : "#2f6194";
      for (let x = x0 - 32; x < W + 32; x += 32) w.fillRect(x, y0, k === 5 ? 1 : len, 1);
    }
    // The logs, one for each length from 16 to 48 px: bark, a lit top, a shadow under, cut ends and a knot.
    const logs = [];
    for (let len = 16; len <= 48; len += 8) {
      const c = canvasOf(len, 6), x = c.getContext("2d"), bark = BL.math.mulberry32(len);
      x.fillStyle = "#8a5a2c"; x.fillRect(1, 0, len - 2, 6);
      x.fillStyle = "#a8743c"; x.fillRect(1, 0, len - 2, 1);
      x.fillStyle = "#4a2e18"; x.fillRect(1, 5, len - 2, 1);
      x.fillStyle = "#5c3a1c";
      for (let k = 3; k < len - 4; k += 3 + Math.floor(bark() * 3)) x.fillRect(k, 1 + Math.floor(bark() * 3), 2 + Math.floor(bark() * 2), 1);
      x.fillStyle = "#c89a5a"; x.fillRect(0, 1, 1, 4); x.fillRect(len - 1, 1, 1, 4);
      x.fillStyle = "#6b4424"; x.fillRect(len - 1, 2, 1, 2);
      x.fillStyle = "#4a2e18"; x.fillRect(len >> 1, 2, 2, 2);
      x.fillStyle = INK.leaf; x.fillRect((len >> 2) + 1, 0, 1, 1); x.fillRect((len >> 2) + 2, 0, 2, 1);
      logs.push({ canvas: c, w: len, h: 6 });
    }
    // The see-through bands, baked so a frame lays them at whole pixels rather than setting a fractional alpha: the
    // stampede's red lane, and the night the banners (dim) and the attract (dark) sit on.
    const tint = (w, h, ink, alpha) => { const c = canvasOf(w, h), x = c.getContext("2d"); x.globalAlpha = alpha; x.fillStyle = ink; x.fillRect(0, 0, w, h); return c; };
    msArt = {
      back, water, logs, warn: tint(W, MS_LANE, INK.red, 0.35), dim: tint(W, H, INK.night, 0.55), dark: tint(W, H, INK.night, 0.72),
      ooga: MS_OOGA_ROWS.map((r) => sprite(r, OOGA_INKS)), oogaLit: sprite(MS_OOGA_ROWS[0], null, false, INK.white), splat: sprite(MS_SPLAT_ROWS, OOGA_INKS), head: sprite(HEAD_ROWS, OOGA_INKS),
      beasts: MS_BEAST_ROWS.map((frames, k) => ways(frames, MS_BEAST_INKS[k])), herd: ways(MS_BEAST_ROWS[MS_MAMMOTH], MS_HERD_INKS),
      turtle: ways(MS_TURTLE_ROWS, MS_TURTLE_INKS), croc: ways(MS_CROC_ROWS, MS_CROC_INKS),
      snake: ways(MS_SNAKE_ROWS, MS_SNAKE_INKS), banana: sprite(MS_BANANA_ROWS, MS_BANANA_INKS), gold: sprite(GOLD_ROWS, GOLD_INKS)
    };
    return msArt;
  };
  const MS_SAY = {
    cave: worded("Cave! +"), gold: worded("Golden coconut! +"),
    home: worded("Banana home! +"), clear: worded("Caves full! +"), won: worded("Valley crossed! +"), extra: "Extra Ooga!",
    down: ["Trampled!", "Splash!", "Swept away!", "Bonk! Missed the cave!", "Cave taken!", "Croc chomp!", "Snake bite!", "Too slow!"]
  };

  const stampede = (host) => {
    const out = hooks(host), aim = out.aim, status = makeStatus("Lives"), art = stampedeArt(), R = rng(), J = juice(host), fx = sparks(160, MS_SPARKS, 100);
    // Everything in the lanes, MS_PER slots a row: kind, width, x, whether a raft dives and its phase in the cycle
    // (or a crocodile's in its bite); and each lane's count and velocity.
    const N = MS_ROWS * MS_PER;
    const O = { kind: new Uint8Array(N), w: new Uint8Array(N), dive: new Uint8Array(N), x: new Float32Array(N), phase: new Float32Array(N) };
    const LN = { n: new Uint8Array(MS_ROWS), v: new Float32Array(MS_ROWS) };
    const CV = new Uint8Array(MS_CAVE_X.length);
    const POPS = 8, PN = { value: new Int32Array(POPS), x: new Float32Array(POPS), y: new Float32Array(POPS), t: new Float32Array(POPS), next: 0 };
    const RINGS = 6, RG = { x: new Float32Array(RINGS), y: new Float32Array(RINGS), t: new Float32Array(RINGS), size: new Float32Array(RINGS), ink: new Uint8Array(RINGS), next: 0 };
    const RING_INKS = [INK.cream, "#9fd0f0", INK.banana];
    // The run on one object: the Ooga (`x`, `row`, the hop under way: `hopT` left of it, `side` for a step aside,
    // `offX` and `offY` where it is drawn from, the furthest row this crossing `far`, a queued step count `steps`,
    // a held key's `holdT`, `banana` carried, a close shave waiting to pay `closeT` and the lanes that paid one this
    // crossing `shaved`, a bit a row, so a lane's shave pays once a crossing), the crossing's `time`, the
    // phase's `timer`, the level's banner, how the last Ooga went down and where, the lanes' own clock `lt`, and
    // the run's tally.
    const S = { x: MS_START_X, row: 0, hopT: 0, side: 0, offX: 0, offY: 0, far: 0, steps: 0, holdT: 0, banana: 0, closeT: 0, shaved: 0, time: MS_TIME, timer: 0, banner: 0,
      dead: 0, how: 0, dx: 0, dy: 0, lt: 0, clock: 0, lives: MS_LIVES, level: 1, streak: 0, extra: 0, won: 0, seed: 0, homes: 0, bananas: 0 };
    // The stampede (`state` 0 waiting, 1 warning, 2 running), the python on the stones, the golden coconut in a cave
    // and the banana bunch on a log.
    const HD = { state: 0, t: 0, row: 1, dir: 1, x: 0, n: 3, w: 0, v: 0 };
    const SN = { on: 0, x: 0, dir: 1, v: 0 };
    const GC = { cave: -1, t: 0, next: 0 };
    const BN = { obj: -1, row: 0, off: 0, t: 0, next: 0 };
    let phase = "idle";

    const setVerb = () => { status.verb = phase === "play" ? "Hop!" : ""; };
    const setStreak = (n) => {
      S.streak = n;
      status.streak = n;
      status.mult = Math.min(4, 1 + n);
      status.fire = n >= 3;
    };
    const addScore = (n) => {
      status.score += n;
      if (!S.extra && status.score >= MS_EXTRA_AT) {
        S.extra = 1; S.lives++; status.left = S.lives;
        out.popup(MS_SAY.extra, false); out.cue("coin");
      }
    };
    const ring = (x, y, size, ink) => {
      const i = RG.next;
      RG.next = (RG.next + 1) % RINGS;
      RG.x[i] = x; RG.y[i] = y; RG.t[i] = 0.001; RG.size[i] = size; RG.ink[i] = ink;
    };
    const pop = (x, y, value) => {
      const i = PN.next;
      PN.next = (PN.next + 1) % POPS;
      PN.value[i] = value; PN.x[i] = x; PN.y[i] = y; PN.t[i] = 0.001;
    };
    // The level's lanes: each row's beasts or floats spaced evenly round its loop with some seeded slack, faster each
    // herd; from the second herd a raft a lane dives and the top lane's first log is a crocodile, and at the third
    // two rafts dive, the logs are shorter and the plain's small beasts come thicker.
    const layLevel = (L) => {
      const k = 1 + 0.2 * (L - 1);
      for (let r = 0; r < MS_ROWS; r++) {
        const kind = MS_KIND[r];
        LN.n[r] = 0;
        if (kind < 0) continue;
        const river = kind >= MS_LOG, span = river ? MS_SPAN_RIVER : MS_SPAN_PLAIN, n = MS_COUNT[r] + (!river && L >= 3 && kind < 3 ? 1 : 0), gap = span / n;
        let dives = kind === MS_TURTLES ? (L >= 3 ? 2 : L >= 2 ? 1 : 0) : 0;
        LN.n[r] = n;
        LN.v[r] = MS_DIR[r] * MS_SPEED[r] * k;
        for (let i = 0; i < n; i++) {
          const o = r * MS_PER + i, own = kind === MS_LOG && r === 11 && L >= 2 && i === 0 ? MS_CROC : kind;
          const w = own === MS_CROC ? 32 : own === MS_LOG ? Math.max(24, MS_SIZE[r] - (L >= 3 ? 8 : 0)) : own === MS_TURTLES ? MS_SIZE[r] * 9 - 1 : MS_BEAST_W[own];
          O.kind[o] = own; O.w[o] = w;
          O.x[o] = -24 + i * gap + R.next() * Math.max(0, gap - w - 18) * 0.5;
          O.dive[o] = 0;
          if (dives > 0 && i & 1) { O.dive[o] = 1; dives--; }
          O.phase[o] = R.next() * MS_DIVE;
        }
      }
    };
    const moveLanes = (h) => {
      for (let r = 1; r < MS_HOME; r++) {
        const n = LN.n[r];
        if (!n) continue;
        const v = LN.v[r], span = MS_KIND[r] >= MS_LOG ? MS_SPAN_RIVER : MS_SPAN_PLAIN;
        for (let i = 0; i < n; i++) {
          const o = r * MS_PER + i;
          let x = O.x[o] + v * h;
          if (v > 0 && x > W + 8) x -= span;
          else if (v < 0 && x + O.w[o] < -8) x += span;
          O.x[o] = x;
        }
      }
    };
    // A diving raft's frame in its cycle: 0 up, 1 going under or coming up (still safe), 2 under.
    const diveFrame = (o) => {
      if (!O.dive[o]) return 0;
      const c = (S.lt + O.phase[o]) % MS_DIVE;
      return c < 3 ? 0 : c < 3.5 ? 1 : c < 4.5 ? 2 : 1;
    };
    const crocOpen = (o) => (S.lt + O.phase[o]) % 2.4 > 1.5;
    // These read the Ooga's place from `S` and answer in small whole numbers, so no double crosses a call.
    // The float under the Ooga's middle in river row `r`, or -1: a raft under water holds nobody.
    const floatAt = (r) => {
      const cx = S.x + 3.5;
      for (let i = 0; i < LN.n[r]; i++) {
        const o = r * MS_PER + i, x = O.x[o];
        if (cx >= x - 1 && cx <= x + O.w[o] + 1 && diveFrame(o) !== 2) return o;
      }
      return -1;
    };
    // How near a beast (or the stampede) in plain row `r` is to the Ooga's feet: 2 it has them, 1 within MS_SHAVE px.
    const beastNear = (r) => {
      const x0 = S.x + 1, x1 = S.x + MS_PW - 1;
      let near = 0;
      for (let i = 0; i < LN.n[r]; i++) {
        const o = r * MS_PER + i, b0 = O.x[o] + 2, b1 = O.x[o] + O.w[o] - 2;
        if (x0 < b1 && x1 > b0) return 2;
        if (b0 - x1 <= MS_SHAVE && x0 - b1 <= MS_SHAVE) near = 1;
      }
      if (HD.state === 2 && HD.row === r) {
        const b0 = HD.x + 2, b1 = HD.x + HD.w - 2;
        if (x0 < b1 && x1 > b0) return 2;
        if (b0 - x1 <= MS_SHAVE && x0 - b1 <= MS_SHAVE) near = 1;
      }
      return near;
    };

    const respawn = () => {
      S.row = 0; S.x = MS_START_X; S.hopT = S.offX = S.offY = 0; S.far = 0; S.time = MS_TIME; S.dead = 0; S.banana = 0; S.closeT = 0;
      S.steps = aim.steps; S.holdT = 0; S.shaved = 0;
      phase = "play";
      setVerb();
      fx.spawn(S.x + 3.5, msRowY(0) + 6, 6, 22, M_LEAF, M_LEAF + 1, 0.4);
    };
    const startLevel = (L) => {
      S.level = L; status.round = L;
      CV.fill(0);
      layLevel(L);
      SN.on = L >= 3 ? 1 : 0; SN.x = R.chance(0.5) ? 4 : W - 18; SN.dir = SN.x < 80 ? 1 : -1; SN.v = 10 + 3 * L;
      HD.state = 0; HD.t = 8 + R.next() * 3;
      GC.cave = -1; GC.next = 5 + R.next() * 4;
      BN.obj = -1; BN.next = 1.5 + R.next() * 2;
      S.banner = MS_BANNER;
      respawn();
    };
    const finish = () => {
      phase = "done";
      setVerb();
      status.note = `Herds ${S.won ? MS_LEVELS : S.level - 1}/${MS_LEVELS} · caves ${S.homes} · bananas ${S.bananas}`;
      out.cue(S.won ? "big" : "buzzer");
      out.onEnd(status.score);
    };
    // The Ooga goes down: its line, its fall (a flattened Ooga, or rings on the water), a life gone, the streak and
    // any banana lost.
    const down = (how) => {
      S.dead = 1; S.how = how; S.dx = S.x; S.dy = msRowY(Math.min(S.row, MS_HOME));
      S.lives--; status.left = S.lives;
      setStreak(0);
      if (S.banana) { S.banana = 0; BN.next = 4 + R.next() * 3; }
      const cx = S.x + 3.5, cy = S.dy + 4;
      if (how === MS_SPLASH || how === MS_SWEPT) {
        fx.spawn(cx, cy, 18, 45, M_WATER, M_WATER + 1, 0.7);
        ring(cx, cy, 8, 1); ring(cx, cy, 14, 1);
        out.cue("miss");
      } else {
        fx.spawn(cx, cy, 20, 60, M_OOGA, M_OOGA + 1, 0.7);
        fx.spawn(cx, cy, 10, 40, how === MS_TRAMPLE ? M_DUST : M_STONE, (how === MS_TRAMPLE ? M_DUST : M_STONE) + 1, 0.5);
        ring(cx, cy, 12, 0);
        out.cue("slam");
        if (how === MS_TRAMPLE) out.shake(0.6);
      }
      J.shake(how === MS_TRAMPLE ? 4 : 2); J.flash(INK.red, 0.45);
      out.flop();
      out.popup(MS_SAY.down[how], S.lives <= 0);
      phase = S.lives > 0 ? "dead" : "over";
      S.timer = S.lives > 0 ? MS_DEAD_S : MS_OVER_S;
      if (S.lives <= 0) out.over();
      setVerb();
    };
    // Into cave `c`: what it pays (a cave and the time left, times the streak's multiplier), a golden coconut in it
    // and a banana carried home on top; all five full clears the herd.
    const home = (c) => {
      CV[c] = 1; S.homes++;
      const mult = status.mult, cx = MS_CAVE_X[c], cy = msRowY(MS_HOME) + 4, carried = S.banana, gold = GC.cave === c;
      const pts = (50 + 10 * Math.ceil(S.time) + (carried ? 200 : 0) + (gold ? 300 : 0)) * mult;
      addScore(pts);
      pop(cx, cy + 8, pts);
      fx.spawn(cx, cy, 16, 55, M_GOLD, M_GOLD + 1, 0.6);
      ring(cx, cy, 10, 2);
      J.flash(INK.banana, 0.2);
      if (carried) { S.banana = 0; BN.next = 4 + R.next() * 3; }
      if (gold) {
        GC.cave = -1; GC.next = 8 + R.next() * 5;
        fx.spawn(cx, cy, 24, 80, M_GOLD, M_EMBER, 0.8);
        ring(cx, cy, 18, 2);
        J.shake(3); J.flash(INK.gold, 0.4);
        out.popup(MS_SAY.gold(pts), true); out.cue("big"); out.crack(true);
      } else if (carried) { out.popup(MS_SAY.home(pts), true); out.cue("big"); out.crack(false); }
      else { out.popup(MS_SAY.cave(pts), false); out.cue("score"); out.crack(false); }
      setStreak(S.streak + 1);
      let full = 1;
      for (let k = 0; k < CV.length; k++) if (!CV[k]) full = 0;
      // A beat in the cave before the next Ooga, with no verb, so a press made during the last hop is dropped
      // rather than hopping the fresh Ooga off the grass.
      if (!full) { phase = "home"; S.timer = MS_HOME_S; setVerb(); return; }
      // The herd crossed: a bonus by the herd, or at the last herd the valley and every Ooga left.
      const bonus = 500 * S.level;
      addScore(bonus);
      J.flash(INK.teal, 0.4);
      out.crack(true);
      if (S.level >= MS_LEVELS) {
        const won = 1000 * S.lives;
        addScore(won);
        S.won = 1;
        out.popup(MS_SAY.won(bonus + won), true); out.cue("win"); out.over();
        phase = "won"; S.timer = MS_OVER_S + 0.6;
      } else {
        out.popup(MS_SAY.clear(bonus), true); out.cue("round");
        phase = "clear"; S.timer = MS_CLEAR_S;
      }
      HD.state = 0; HD.t = 99;
      setVerb();
    };
    // A hop has landed: a new furthest row pays, the cliff takes the Ooga into a cave or knocks it down, and a
    // landing a hair from a charging beast is a close shave (paid if the Ooga lives through it).
    const landed = () => {
      const r = S.row;
      if (r > S.far) { S.far = r; addScore(10); }
      if (r === MS_HOME) {
        const cx = S.x + 3.5;
        for (let c = 0; c < CV.length; c++) {
          if (Math.abs(cx - MS_CAVE_X[c]) > MS_CAVE_TOL) continue;
          if (CV[c]) { down(MS_TAKEN); return; }
          home(c);
          return;
        }
        down(MS_ROCK);
        return;
      }
      if (r >= 1 && r <= 5) {
        if (beastNear(r) === 1 && !(S.shaved & 1 << r)) { S.shaved |= 1 << r; S.closeT = MS_CLOSE_S; }
      }
    };
    const hop = () => {
      if (phase !== "play" || S.hopT > 0) return;
      S.row++; S.offX = 0; S.offY = MS_LANE; S.hopT = MS_HOP_T; S.side = 0;
      fx.spawn(S.x + 3.5, msRowY(S.row - 1) + 7, 3, 16, S.row - 1 >= 7 ? M_WATER : M_DUST, (S.row - 1 >= 7 ? M_WATER : M_DUST) + 1, 0.3);
      out.cue("flip", 0.55);
    };
    const step1 = (dir) => {
      const nx = Math.max(0, Math.min(W - MS_PW, S.x + dir * MS_SIDE));
      if (nx === S.x) return;
      S.offX = S.x - nx; S.offY = 0; S.x = nx; S.hopT = MS_SIDE_T; S.side = 1;
      out.cue("click", 0.5);
    };
    const pickBanana = () => {
      BN.obj = -1; S.banana = 1; S.bananas++;
      const pts = 100 * status.mult;
      addScore(pts);
      pop(S.x + 3.5, Math.max(22, msRowY(S.row) - 3), pts);
      fx.spawn(S.x + 3.5, msRowY(S.row) + 2, 12, 45, M_GOLD, M_LEAF, 0.5);
      out.cue("coin");
    };
    const spawnBanana = () => {
      const r = MS_BANANA_LANES[R.int(MS_BANANA_LANES.length)];
      for (let tries = 0; tries < 6; tries++) {
        const o = r * MS_PER + R.int(LN.n[r]);
        if (O.kind[o] !== MS_LOG) continue;
        BN.obj = o; BN.row = r; BN.off = 3 + R.next() * (O.w[o] - 11); BN.t = 12;
        return;
      }
      BN.next = 1;
    };
    // The Ooga on the ground: the plain's beasts and the stampede trample, the python bites, the river drowns or
    // carries it (off the edge is swept away, a crocodile's open jaws chomp, a banana on its log is picked up).
    const grounded = (h) => {
      const r = S.row;
      if (r >= 1 && r <= 5) { if (beastNear(r) === 2) down(MS_TRAMPLE); return; }
      if (r === MS_MID) { if (SN.on && S.x + 1 < SN.x + 13 && S.x + MS_PW - 1 > SN.x + 1) down(MS_BITE); return; }
      if (r < 7 || r > 11) return;
      const o = floatAt(r);
      if (o < 0) { down(MS_SPLASH); return; }
      S.x += LN.v[r] * h;
      if (S.x < -3 || S.x > W - MS_PW + 3) { down(MS_SWEPT); return; }
      if (O.kind[o] === MS_CROC && crocOpen(o)) {
        const head = LN.v[r] > 0 ? O.x[o] + O.w[o] - 10 : O.x[o], cx = S.x + 3.5;
        if (cx >= head && cx <= head + 10) { down(MS_CHOMP); return; }
      }
      if (BN.obj === o && Math.abs(S.x + 3.5 - (O.x[o] + BN.off + 2.5)) <= 5) pickBanana();
    };
    const stepOoga = (h) => {
      const before = Math.ceil(S.time);
      S.time -= h;
      if (S.time <= 5 && Math.ceil(S.time) !== before && S.time > 0) out.cue("tick", 0.55);
      if (S.time <= 0) { down(MS_SLOW); return; }
      if (S.hopT > 0) {
        S.hopT -= h;
        if (S.hopT > 0) return;
        S.hopT = 0;
        landed();
        if (phase !== "play") return;
      }
      grounded(h);
      if (phase !== "play") return;
      if (S.closeT > 0 && (S.closeT -= h) <= 0) {
        S.closeT = 0;
        const pts = 25 * status.mult;
        addScore(pts);
        pop(S.x + 3.5, msRowY(S.row) - 3, pts);
        fx.spawn(S.x + 3.5, msRowY(S.row) + 4, 8, 40, M_STONE, M_GOLD + 1, 0.4);
        out.cue("swish", 0.7);
      }
      // A step aside: one a press (a queue of two at most), and while a key is held, again and again.
      let d = aim.steps - S.steps;
      if (d > 2 || d < -2) { S.steps = aim.steps - (d > 0 ? 2 : -2); d = d > 0 ? 2 : -2; }
      if (d) { S.steps += d > 0 ? 1 : -1; S.holdT = 0; step1(d > 0 ? 1 : -1); }
      else if (aim.hold) { S.holdT += h; if (S.holdT >= MS_REPEAT) { S.holdT -= MS_REPEAT_EVERY; step1(aim.hold); } }
      else S.holdT = 0;
    };
    // The stampede: a warning in a lane, then a herd of mammoths at a gallop through it, trailing dust.
    const stepHerd = (h) => {
      if (HD.state === 0) {
        if (phase !== "play") return;
        HD.t -= h;
        if (HD.t > 0) return;
        HD.row = 1 + R.int(5); HD.dir = MS_DIR[HD.row]; HD.n = 2 + S.level; HD.w = HD.n * MS_GAP - 1;
        HD.v = 64 + 10 * S.level; HD.state = 1; HD.t = 1.45 - 0.12 * (S.level - 1);
        out.cue("knock");
      } else if (HD.state === 1) {
        HD.t -= h;
        if (HD.t <= 0) { HD.state = 2; HD.x = HD.dir > 0 ? -HD.w - 2 : W + 2; out.cue("roll"); out.shake(0.35); J.shake(2); }
      } else {
        HD.x += HD.dir * HD.v * h;
        if ((HD.dir > 0 && HD.x > W + 2) || (HD.dir < 0 && HD.x + HD.w < -2)) { HD.state = 0; HD.t = Math.max(5, 9 + R.next() * 4 - 0.8 * (S.level - 1)); }
      }
    };
    // The golden coconut comes to an empty cave for a while; the banana bunch rides a log until it is picked up or
    // goes over the falls.
    const stepBonus = (h) => {
      if (GC.cave >= 0) { if ((GC.t -= h) <= 0 || CV[GC.cave]) { GC.cave = -1; GC.next = 7 + R.next() * 5; } }
      else if ((GC.next -= h) <= 0) {
        let free = 0;
        for (let c = 0; c < CV.length; c++) if (!CV[c]) free++;
        let pick = R.int(Math.max(1, free));
        for (let c = 0; c < CV.length && GC.cave < 0; c++) if (!CV[c] && pick-- === 0) GC.cave = c;
        GC.t = 6;
        if (GC.cave >= 0) out.cue("ding", 0.6);
        else GC.next = 3;
      }
      if (BN.obj >= 0) { if ((BN.t -= h) <= 0) { BN.obj = -1; BN.next = 4 + R.next() * 4; } }
      else if (!S.banana && (BN.next -= h) <= 0) spawnBanana();
    };
    const step = (h) => {
      S.lt += h;
      moveLanes(h);
      stepHerd(h);
      if (SN.on) {
        SN.x += SN.dir * SN.v * h;
        if (SN.x < 2 || SN.x > W - 16) { SN.dir = -SN.dir; SN.x = Math.max(2, Math.min(W - 16, SN.x)); }
      }
      if (phase === "play") {
        S.banner = Math.max(0, S.banner - h);
        stepBonus(h);
        stepOoga(h);
        return;
      }
      S.timer -= h;
      if (S.timer > 0) return;
      if (phase === "dead" || phase === "home") respawn();
      else if (phase === "clear") startLevel(S.level + 1);
      else if (phase === "over" || phase === "won") finish();
    };
    const run = stepper(step);

    // ---- drawing --------------------------------------------------------------------------------------------
    const drawRiver = (ctx) => {
      for (let r = 7; r <= 11; r++) {
        const off = ((-S.lt * LN.v[r] * 0.5) % 32 + 32) % 32 | 0;
        ctx.drawImage(art.water, off, 0, W, MS_LANE, 0, msRowY(r), W, MS_LANE);
      }
    };
    const drawCaves = (ctx) => {
      const y = msRowY(MS_HOME);
      for (let c = 0; c < CV.length; c++) {
        if (CV[c]) blit(ctx, art.ooga[(S.clock * 3 + c | 0) & 1], MS_CAVE_X[c] - 3, y + 1);
        else if (GC.cave === c && (GC.t > 1.5 || (S.clock * 8 | 0) % 2)) blit(ctx, art.gold, MS_CAVE_X[c] - 2, y + 2 + ((S.clock * 3 | 0) & 1));
      }
    };
    // What moves is drawn at whole pixels rounded here, straight to the canvas: a fraction handed to a call is boxed.
    const drawLanes = (ctx) => {
      for (let r = 1; r < MS_HOME; r++) {
        const n = LN.n[r];
        if (!n) continue;
        const y = msRowY(r), flip = LN.v[r] < 0 ? 1 : 0;
        for (let i = 0; i < n; i++) {
          const o = r * MS_PER + i, k = O.kind[o], x = O.x[o], px = Math.round(x);
          if (x > W || x + O.w[o] < 0) continue;
          if (k <= MS_MAMMOTH) ctx.drawImage(art.beasts[k][flip][(x * 0.34 | 0) & 1].canvas, px, y + MS_BEAST_DY[k]);
          else if (k === MS_LOG) ctx.drawImage(art.logs[(O.w[o] >> 3) - 2].canvas, px, y + 1);
          else if (k === MS_TURTLES) { const f = art.turtle[1 - flip][diveFrame(o)].canvas; for (let t = 0; t * 9 < O.w[o]; t++) ctx.drawImage(f, px + t * 9, y + 2); }
          else ctx.drawImage(art.croc[flip][crocOpen(o) ? 1 : 0].canvas, px, y + 2);
          if (BN.obj === o) ctx.drawImage(art.banana.canvas, Math.round(x + BN.off), y + 1 - ((S.clock * 4 | 0) & 1));
        }
      }
    };
    // The warning lies under the lane's own beasts, which are still live while it shows, so they always read.
    const drawWarn = (ctx) => {
      if (HD.state !== 1) return;
      const y = msRowY(HD.row);
      if ((S.clock * 8 | 0) % 2) {
        ctx.drawImage(art.warn, 0, y);
        centre(ctx, "STAMPEDE!", y + 1, TEXT.banana);
      }
      // Chevrons chasing in from the side the herd will come from.
      ctx.fillStyle = INK.red;
      const f = (S.clock * 10 | 0) % 3;
      for (let k = 0; k < 3; k++) {
        if (k === f) continue;
        const x = HD.dir > 0 ? 2 + k * 5 : W - 5 - k * 5;
        for (let j = 0; j < 5; j++) { const o = j < 3 ? j : 4 - j; ctx.fillRect(HD.dir > 0 ? x + o : x + 2 - o, y + 1 + j, 1, 1); }
      }
    };
    const drawHerd = (ctx) => {
      if (HD.state === 2) {
        const y = msRowY(HD.row), way = HD.dir > 0 ? 0 : 1;
        for (let k = 0; k < HD.n; k++) {
          const x = HD.x + k * MS_GAP, px = Math.round(x);
          if (x > W + 8 || x + 24 < 0) continue;
          ctx.drawImage(art.herd[way][(x * 0.5 + k | 0) & 1].canvas, px, y + 1 - ((S.lt * 12 + k | 0) & 1));
          // Dust kicked up behind each one, puffs drifting back and up as they thin, drawn rather than spawned.
          for (let d = 0; d < 4; d++) {
            const age = ((S.lt * 18 | 0) + d * 2 + k) % 7, back = way ? 16 + age : -1 - age;
            ctx.fillStyle = MS_SPARKS[age < 4 ? 0 : 1];
            ctx.fillRect(px + back, y + 6 - (age >> 1) - (d & 1), age < 3 ? 2 : 1, 1);
          }
        }
      }
    };
    const drawOoga = (ctx) => {
      if (S.dead) {
        if (S.how === MS_SPLASH || S.how === MS_SWEPT) return;
        if (phase === "over" || S.timer > 0.3 || (S.clock * 12 | 0) % 2) ctx.drawImage(art.splat.canvas, Math.round(S.dx) - 1, S.dy + 3);
        return;
      }
      if (phase !== "play") return;
      const k = S.hopT > 0 ? S.hopT / (S.side ? MS_SIDE_T : MS_HOP_T) : 0;
      const x = Math.round(S.x + S.offX * k), y = Math.round(msRowY(S.row) + 1 + S.offY * k - (S.side ? 1 : 3) * Math.sin(k * Math.PI));
      // Carried near the edge of the river, the Ooga flashes: hop on or step back along the float, or be swept away.
      const edge = S.row >= 7 && S.row <= 11 && S.hopT <= 0 && (S.x < 14 || S.x > W - MS_PW - 14) && (S.clock * 10 | 0) & 1;
      ctx.drawImage(edge ? art.oogaLit.canvas : art.ooga[S.hopT > 0 ? 1 : 0].canvas, x, y);
      if (S.banana) ctx.drawImage(art.banana.canvas, x + 1, y - 5);
    };
    const drawHud = (ctx) => {
      number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
      if (status.mult > 1) { text(ctx, "X", 36, 1, TEXT.ember); number(ctx, status.mult, 42, 1, TEXT.ember); }
      if (S.banana) blit(ctx, art.banana, 52, 2);
      text(ctx, "HERD", 64, 1, TEXT.teal);
      number(ctx, S.level, 92, 1, TEXT.teal);
      for (let k = 0; k < S.lives && k < 6; k++) blit(ctx, art.head, W - 8 - k * 7, 2);
      // The crossing's clock under the field, gold then red and blinking as it runs out.
      const k = Math.max(0, Math.min(1, S.time / MS_TIME));
      ctx.fillStyle = INK.rule; ctx.fillRect(20, 116, 120, 3);
      ctx.fillStyle = k > 0.5 ? INK.lime : k > 0.24 ? INK.gold : (S.clock * 6 | 0) % 2 ? INK.red : INK.ember;
      ctx.fillRect(20, 116, Math.round(k * 120), 3);
    };
    const drawFx = (ctx) => {
      fx.draw(ctx);
      for (let i = 0; i < RINGS; i++) {
        if (RG.t[i] <= 0) continue;
        ctx.fillStyle = RING_INKS[RG.ink[i]];
        const r = 2 + RG.size[i] * RG.t[i] / 0.3;
        for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(RG.x[i] + COS8[k] * r), Math.round(RG.y[i] + SIN8[k] * r * 0.6), 1, 1);
      }
      for (let i = 0; i < POPS; i++) if (PN.t[i] > 0 && (PN.t[i] < 0.6 || (S.clock * 16 | 0) % 2)) number(ctx, PN.value[i], Math.round(PN.x[i]), Math.round(PN.y[i] - PN.t[i] * 14), TEXT.banana, 1, 1);
    };
    const drawBanner = (ctx) => {
      if (phase === "play" && S.banner > 0 && (S.banner > 0.3 || (S.clock * 10 | 0) % 2)) {
        ctx.drawImage(art.dim, 0, 0, W, 34, 0, 26, W, 34);
        centre(ctx, S.level === MS_LEVELS ? "LAST HERD" : "HERD", 29, TEXT.gold, 2);
        number(ctx, S.level, W / 2, 45, TEXT.bone, 2, 1);
      } else if (phase === "clear") {
        ctx.drawImage(art.dim, 0, 0, W, 22, 0, 34, W, 22);
        centre(ctx, "CAVES FULL!", 38, TEXT.teal, 2);
      } else if (phase === "done") {
        ctx.drawImage(art.dim, 0, 0, W, 106, 0, 9, W, 106);
        centre(ctx, S.won ? "YOU MADE IT!" : "GAME OVER", 40, S.won ? TEXT.gold : TEXT.red, 2);
        centre(ctx, "SCORE", 62, TEXT.stone);
        number(ctx, status.score, W / 2, 72, TEXT.banana, 2, 1);
      }
    };
    const drawAttract = (ctx) => {
      ctx.drawImage(art.dark, 0, 0, W, 92, 0, 14, W, 92);
      centre(ctx, "MAMMOTH", 17, TEXT.gold, 2);
      centre(ctx, "STAMPEDE", 34, TEXT.ember, 2);
      const f = (S.clock * 2 | 0) & 1;
      blit(ctx, art.beasts[MS_MAMMOTH][0][f], 28, 55); text(ctx, "HOP ACROSS", 50, 55, TEXT.bone);
      blit(ctx, art.logs[1], 22, 67); text(ctx, "RIDE THE LOGS", 50, 66, TEXT.sky);
      blit(ctx, art.banana, 31, 76); text(ctx, "+100, +200 HOME", 50, 76, TEXT.banana);
      blit(ctx, art.gold, 31, 86); text(ctx, "+300 IN A CAVE", 50, 86, TEXT.gold);
      if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 97, TEXT.bone);
      text(ctx, "HI", 3, 1, TEXT.stone);
      number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
    };

    const reset = () => {
      PN.t.fill(0); RG.t.fill(0); CV.fill(0);
      fx.clear(); J.reset();
      S.dead = 0; S.banana = 0; S.hopT = S.offX = S.offY = 0; S.row = 0; S.x = MS_START_X; S.time = MS_TIME; S.banner = 0; S.closeT = 0;
      HD.state = 0; HD.t = 99; SN.on = 0; GC.cave = -1; BN.obj = -1;
      status.fire = false; status.meter = -1; status.target = 0; status.note = "";
      setStreak(0);
    };
    // The attract's valley: the first herd's lanes from a fixed seed, running under the title.
    R.seed(1);
    layLevel(1);
    reset();
    status.left = MS_LIVES;
    return {
      kind: "stampede", name: "Mammoth Stampede", aims: true, status,
      help: "Space or tap hops forward; A and D, the arrows or a swipe step aside. Ride logs and turtles into the five caves. Three herds.",
      coach: ["Space hops, A and D step aside", "Tap hops, swipe steps aside"],
      stars: [800, 2500, 9000], tickets: (score) => Math.floor(score / 300),
      get playing() { return phase !== "idle" && phase !== "done"; },
      get seed() { return S.seed; },
      start: (seed) => {
        if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
        reset();
        status.score = 0; S.lives = MS_LIVES; status.left = MS_LIVES; S.extra = S.won = 0; S.lt = 0;
        S.homes = S.bananas = 0;
        startLevel(1);
      },
      stop: () => { phase = "idle"; reset(); R.seed(1); layLevel(1); status.round = 1; status.left = MS_LIVES; setVerb(); },
      act: hop,
      update: (dt) => {
        S.clock += dt;
        J.update(dt);
        fx.update(dt);
        for (let i = 0; i < POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
        for (let i = 0; i < RINGS; i++) if (RG.t[i] > 0) { RG.t[i] += dt; if (RG.t[i] > 0.3) RG.t[i] = 0; }
        if (phase === "idle" || phase === "done") { S.lt += dt; moveLanes(dt); }
        else run(dt);
      },
      draw: (ctx) => {
        // The whole valley shakes as one, over the night the shake shows at its edges.
        ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, H);
        J.begin(ctx);
        ctx.drawImage(art.back, 0, 0);
        drawRiver(ctx);
        drawCaves(ctx);
        drawWarn(ctx);
        drawLanes(ctx);
        if (SN.on) ctx.drawImage(art.snake[SN.dir > 0 ? 0 : 1][(S.lt * 5 | 0) & 1].canvas, Math.round(SN.x), msRowY(MS_MID) + 3);
        drawHerd(ctx);
        if (phase !== "idle") { drawOoga(ctx); drawFx(ctx); }
        J.end(ctx);
        if (phase === "idle") { drawAttract(ctx); return; }
        drawHud(ctx);
        drawBanner(ctx);
      }
    };
  };

  // ---- Ptero Flap -------------------------------------------------------------------------------------------
  // A pterodactyl flaps (act) through bone gates over a lava river, five caves long, to its nest on the volcano's
  // rim; gravity does the rest. Each cave adds a twist and a little speed: gates that slide, fire that leaps out of
  // the lava, mammoth jaws that snap, then all of it at once. Through a gate's dead centre is a bullseye, and
  // bullseyes in a row multiply every point (x2 from three, x3 from six, x4 from ten, on fire); any other pass
  // scores at the multiplier held and breaks the run. Bananas mark the centre line and trace the way between gates;
  // a bunch hangs by a gate's lip, worth six, for whoever dares leave the centre; and each cave past the first hides
  // a golden coconut down by the lava, another life. Three lives: a bone costs one (it shatters), the lava one (it
  // throws the ptero up), a leap of fire one; a cave without a scratch pays extra. Lose them all and it is over;
  // reach the nest and every life left pays.
  const FL_PX = 40, FL_CEIL = 17, FL_LAVA = 108, FL_GRAV = 330, FL_FLAP = -108, FL_FALL = 160, FL_HW = 6, FL_HH = 3;
  const FL_COL = 10, FL_COL_H = 112, FL_TOP = 12, FL_GATES = 6, FL_NANAS = 28, FL_FIRES = 4, FL_LIVES = 3, FL_MAX_LIVES = 5;
  const FL_BULL = 3.5, FL_INV = 1.6, FL_CLEAR = 1.8, FL_NAME = 1.6, FL_OVER = 2.2, FL_LANDED = 2.8, FL_JAW = 12;
  // The nest's rim, its width and where it comes to rest, its right half under the landed ptero and its eggs clear.
  const FL_NEST_Y = 72, FL_NEST_W = 34, FL_NEST_AT = FL_PX - 26, FL_POPS = 8, FL_RINGS = 6;
  const FL_PTS = { gate: 10, bull: 15, banana: 5, bunch: 30, cave: 100, clean: 200, gold: 150, nest: 500, life: 300 };
  // The caves in order: gates, speed (px/s) and how much it gains by the cave's last gate, spacing (px), the gap
  // (px), how far one gap may sit from the last, the chance a gate slides (and how far and how slowly, px and s)
  // or is a pair of jaws, seconds between leaps of fire (0 none), the air's ink, the lava's glow and the name its
  // banner gives it.
  const FL_CAVES = [
    { name: "BONE CANYON", gates: 8, speed: 40, ramp: 3, spacing: 82, gap: 46, shift: 22, slide: 0, amp: 0, period: 3, jaw: 0, fire: 0, air: "#1a1226", glow: 0.35 },
    { name: "RIB CAGE", gates: 10, speed: 44, ramp: 3, spacing: 78, gap: 44, shift: 26, slide: 0.5, amp: 8, period: 3.4, jaw: 0, fire: 0, air: "#0c1a1e", glow: 0.3 },
    { name: "FIRE PIT", gates: 10, speed: 47, ramp: 3, spacing: 78, gap: 42, shift: 28, slide: 0.3, amp: 10, period: 3.1, jaw: 0, fire: 3.8, air: "#240d08", glow: 0.75 },
    { name: "MAMMOTH JAWS", gates: 10, speed: 50, ramp: 3, spacing: 76, gap: 40, shift: 32, slide: 0.25, amp: 11, period: 2.9, jaw: 0.6, fire: 0, air: "#1f1709", glow: 0.45 },
    { name: "VOLCANO", gates: 12, speed: 54, ramp: 4, spacing: 74, gap: 37, shift: 36, slide: 0.35, amp: 12, period: 2.7, jaw: 0.35, fire: 2.6, air: "#0b0d24", glow: 0.6 }
  ];
  const FL_TOTAL = FL_CAVES.reduce((n, c) => n + c.gates, 0);
  // Where each cave ends along the HUD's course bar, 34 px long.
  const FL_BAR = 34, FL_ENDS = new Int16Array(FL_CAVES.length - 1);
  for (let k = 0, n = 0; k < FL_ENDS.length; k++) { n += FL_CAVES[k].gates; FL_ENDS[k] = Math.round(FL_BAR * n / FL_TOTAL); }
  // Where each cave's banner sets its words, centred on one line: CAVE n (LAST CAVE for the last), two spaces, the name.
  const FL_LAST = FL_CAVES.length - 1;
  for (const [z, c] of FL_CAVES.entries()) {
    const tag = (z === FL_LAST ? "LAST CAVE" : `CAVE ${z + 1}`) + "  ";
    c.tagX = (W - textWidth(tag + c.name)) >> 1; c.nameX = c.tagX + tag.length * CELL;
  }
  // The ptero facing right, 23 by 16: wings up, level and down, a long crest back and a long beak forward, the
  // body's middle at (11, 8).
  const FL_PTERO_INKS = { P: INK.violet, p: "#7a5ab8", L: "#dcc8ff", C: INK.bone, B: INK.gold, b: "#c07818", E: "#1b1410" };
  const FL_BODY = [".......pPPPPPPPPPPbb", "......ppPPPPPPPp", "....pp..pppppp", "..........B.B"];
  const FL_PTERO_ROWS = [
    ["pp", "pLPp", ".pLPPp", ".pLLPPPp.....C", "..pLLPPPPp....CC", "..pLLLPPPPPp....CCPP", "...pLLPPPPPPp..PPPPEPBB", "....ppLLPPPPpPPPPPPBBBB", ...FL_BODY],
    ["", "", "", ".............C", "..............CC", "pp..............CCPP", "pLLLp..........PPPPEPBB", ".pLLLPPPPPPpPPPPPPBBBB", "..ppLLPPPPPPPPPPPbb", ...FL_BODY.slice(1)],
    ["", "", "", ".............C", "..............CC", "................CCPP", "...............PPPPEPBB", "..........pPPPPPPPBBBB", FL_BODY[0], FL_BODY[1],
      "....ppLLPPPPPp", "....pLLPPPPpB.B", "...pLLPPPp", "..pLPPp", ".pLPp", "pp"]
  ].map((rows) => { const out = rows.map((r) => r.padEnd(23, ".")); while (out.length < 16) out.push("".padEnd(23, ".")); return out; });
  const FL_HEAD = ["CC....", ".CPPP.", "..PEBB", "...PB."];
  const FL_BANANA = ["k......", "Yy....Y", "YYy..YY", ".YYYYY.", "..yyy.."];
  const FL_NANA_INKS = { Y: INK.banana, y: "#e0a228", k: "#6b4a1e" };
  // A leap of fire, rising with its flame trailing under it (turned over as it falls), two flickers.
  const FL_FIRE_ROWS = [["..rrr..", ".rOOOr.", "rOYYYOr", "rOYgYOr", "rOYYYOr", ".rOOOr.", "..rOr..", "...r..."], [".r.r.r.", ".rOOOr.", "rOYYYOr", "rOYYYOr", "rOYgYOr", ".rOYOr.", "..rOr..", "..r.r.."]];
  const FL_FIRE_INKS = { r: INK.red, O: INK.ember, Y: INK.banana, g: "#fff3a0" };
  // A gate's bones: the vertebra its columns stack, the knuckle cap at a gap's edge (knobs to the gap) and the
  // mammoth's teeth a jaw gate snaps with.
  const FL_VERT = [".dCCCCCCd.", "dCCCCCCCcd", "dcCCCCCccd", ".ddcCCcdd.", "...dCCd...", "...dCcd...", "..dcCCcd..", "..kkkkkk.."];
  const FL_KNOB = [".dCCd....dCCd.", "dCCCCd..dCCCCd", "dCCCCCddCCCCcd", ".dCCCCCCCCCcd.", "..dCCCCCCCcd..", "...dCCCCCcd..."];
  const FL_JAWS = [".C..C..C..C..C..", ".Cd.Cd.Cd.Cd.Cd.", "GCdGCdGCdGCdGCdG", "GGGGGGGGGGGGGGGG", "gGGGGGGGGGGGGGGg", ".gggggggggggggg.", "..dCCCCCCCCCCd.."];
  const FL_BONE_INKS = { C: INK.bone, c: "#cfc2a4", d: "#8a7e66", k: "#3a332a", G: "#b8402e", g: "#7a2a1e" };
  // The sparks' inks: feathers, bone, banana, fire, a bullseye's white and a cleared cave's teal; and the embers'.
  const FL_SPARKS = [INK.violet, "#7a5ab8", INK.bone, "#8a7e66", INK.banana, INK.gold, INK.ember, INK.red, INK.white, INK.teal];
  const FLS_FEATHER = 0, FLS_BONE = 2, FLS_BANANA = 4, FLS_FIRE = 6, FLS_WHITE = 8, FLS_TEAL = 9;
  const FL_EMBERS = [INK.ember, INK.banana, INK.red];
  const FL_SAY = {
    hurt: ["Bonk!", "Singed!", "Burned!"], down: "Ptero down!", fire: "On fire! x4", oneUp: "Golden coconut! 1UP",
    gold: worded("Golden coconut! +"), clear: worded("Cave clear! +"), clean: worded("Clean cave! +"), nest: worded("Nest! +")
  };
  const FL_TAU = Math.PI * 2, FL_BEAT = new Uint8Array([0, 1, 2, 1]);

  // Built once for the page on the first flight: the sprites, the gates' bones, the scrolling cave and its lava.
  let flArt = null;
  const flapArt = () => {
    if (flArt) return flArt;
    const rand = BL.math.mulberry32(41);
    const both = (rows, inks) => [sprite(rows, inks), sprite(rows.slice().reverse(), inks)];
    const vert = sprite(FL_VERT, FL_BONE_INKS), col = canvasOf(FL_COL, FL_COL_H), cx = col.getContext("2d");
    for (let y = 0; y < FL_COL_H; y += FL_VERT.length) cx.drawImage(vert.canvas, 0, y);
    // The far rock (a quarter of the scroll) and the near (a half), both in shadow so they sit on any cave's air,
    // each wide enough to tile seamlessly.
    const far = canvasOf(256, H), f = far.getContext("2d");
    f.fillStyle = "rgba(0,0,0,0.32)";
    for (let x = 0; x < 256; x++) {
      const a = x / 256 * FL_TAU, up = 30 + 12 * Math.sin(a * 2) + 8 * Math.sin(a * 5 + 1) + 7 * Math.abs(Math.sin(a * 9 + 2)), down = 10 + 6 * Math.sin(a * 3 + 2) + 5 * Math.abs(Math.sin(a * 7));
      f.fillRect(x, Math.round(FL_LAVA - up), 1, Math.round(up) + 12);
      f.fillRect(x, 10, 1, Math.round(down));
    }
    const mid = canvasOf(192, H), m = mid.getContext("2d");
    m.fillStyle = "rgba(0,0,0,0.5)";
    const spike = (x, base, h, down) => { for (let r = 0; r < h; r++) { const w = Math.max(1, Math.round(base * (1 - r / h))); m.fillRect(x - (w >> 1), down ? 12 + r : FL_LAVA - r, w, 1); } };
    for (const [x, b, h] of [[14, 12, 26], [58, 9, 17], [150, 14, 32], [182, 8, 14]]) spike(x, b, h, false);
    for (const [x, b, h] of [[34, 8, 20], [96, 10, 26], [128, 6, 13], [172, 7, 18]]) spike(x, b, h, true);
    // A mammoth's ribs standing out of the lava shore, and its skull.
    for (let k = 0; k < 5; k++) for (let r = 0; r < 26 - k * 3; r++) m.fillRect(Math.round(80 + k * 7 + 5 * Math.sin(r / (26 - k * 3) * Math.PI * 0.85)), FL_LAVA - r, 2, 1);
    m.fillRect(112, FL_LAVA - 9, 14, 9); m.fillRect(114, FL_LAVA - 12, 9, 3); m.fillRect(125, FL_LAVA - 4, 5, 2);
    // The rock roof over the flight, tiling every 48 px, lit from the lava below; and the lava, four frames of 32 px.
    const ceil = canvasOf(48, 10), c = ceil.getContext("2d");
    for (let x = 0; x < 48; x++) {
      const a = x / 48 * FL_TAU, d = 4 + Math.round(1.2 * Math.sin(a * 3) + 0.8 * Math.sin(a * 7 + 1));
      c.fillStyle = "#231b16"; c.fillRect(x, 0, 1, d);
      c.fillStyle = "#4a3326"; c.fillRect(x, d - 1, 1, 1);
    }
    for (const [x, len] of [[6, 4], [21, 3], [33, 5], [43, 3]]) for (let r = 0; r < len; r++) { c.fillStyle = r === len - 1 ? "#4a3326" : "#231b16"; c.fillRect(x - (r < 2 ? 1 : 0), 5 + r, r < 2 ? 3 : 1, 1); }
    const lava = [];
    for (let fr = 0; fr < 4; fr++) {
      const l = canvasOf(32, 14), x = l.getContext("2d"), p = fr * Math.PI / 2;
      for (let k = 0; k < 32; k++) {
        const a = k / 32 * FL_TAU, top = 3 + Math.round(1.4 * Math.sin(a * 2 + p) + 0.8 * Math.sin(a * 5 - p * 2));
        x.fillStyle = "#c2361f"; x.fillRect(k, top, 1, 14 - top);
        x.fillStyle = "#8a1e10"; if ((k + fr) % 7 < 3) x.fillRect(k, 9 + ((k >> 2) & 1), 1, 5);
        x.fillStyle = INK.ember; x.fillRect(k, top, 1, 1);
        if (Math.sin(a * 3 + p) > 0.55) { x.fillStyle = INK.banana; x.fillRect(k, top - 1, 1, 1); if (Math.sin(a * 3 + p) > 0.85) { x.fillStyle = INK.ember; x.fillRect(k, top - 2, 1, 1); } }
      }
      lava.push(l);
    }
    // Each cave's lava glow, one pixel wide and stretched across; the volcano's night sky and moon.
    const glow = FL_CAVES.map((cave) => {
      const g = canvasOf(1, 48), x = g.getContext("2d"), grad = x.createLinearGradient(0, 0, 0, 48);
      grad.addColorStop(0, "rgba(255,120,40,0)");
      grad.addColorStop(1, `rgba(255,120,40,${cave.glow})`);
      x.fillStyle = grad; x.fillRect(0, 0, 1, 48);
      return g;
    });
    const stars = canvasOf(W, 60), s = stars.getContext("2d");
    for (let i = 0; i < 38; i++) { s.fillStyle = i % 5 ? "#8fa0d8" : INK.cream; s.fillRect(Math.floor(rand() * W), Math.floor(rand() * 58), 1, 1); }
    s.fillStyle = INK.cream;
    for (let r = -5; r <= 5; r++) { const w = Math.round(Math.sqrt(30 - r * r)); s.fillRect(130 - w, 12 + r, w * 2, 1); }
    s.fillStyle = "#cbbf9f"; s.fillRect(127, 10, 2, 2); s.fillRect(132, 14, 3, 2); s.fillRect(129, 15, 1, 1);
    // The nest on its rock: a bowl of twigs round three eggs.
    const nest = canvasOf(FL_NEST_W, 12), n = nest.getContext("2d");
    for (const ex of [9, 15, 21]) { n.fillStyle = INK.cream; n.fillRect(ex, 1, 4, 5); n.fillRect(ex - 1, 2, 6, 3); n.fillStyle = INK.ochre; n.fillRect(ex + 1, 2, 1, 1); n.fillRect(ex + 3, 4, 1, 1); }
    for (let x = 0; x < FL_NEST_W; x++) {
      const d = Math.round(3 + 3 * Math.sin(x / (FL_NEST_W - 1) * Math.PI));
      n.fillStyle = INK.husk; n.fillRect(x, 5, 1, d + 1);
      n.fillStyle = x % 3 ? INK.huskDk : "#c89a5a"; n.fillRect(x, 5 + (x * 7 % 3), 1, 1);
      n.fillStyle = INK.huskDk; n.fillRect(x, 5 + d, 1, 1);
    }
    // A bunch is three bananas fanned on one stem.
    const banana = sprite(FL_BANANA, FL_NANA_INKS), bunch = { canvas: canvasOf(13, 9), w: 13, h: 9 }, bx = bunch.canvas.getContext("2d");
    for (const [x, y] of [[0, 3], [6, 3], [3, 0]]) bx.drawImage(banana.canvas, x, y);
    flArt = {
      ptero: FL_PTERO_ROWS.map((r) => sprite(r, FL_PTERO_INKS)), white: FL_PTERO_ROWS.map((r) => sprite(r, null, false, INK.white)),
      head: sprite(FL_HEAD, FL_PTERO_INKS), banana, bunch, gold: sprite(GOLD_ROWS, GOLD_INKS),
      fire: [...FL_FIRE_ROWS, ...FL_FIRE_ROWS.map((r) => r.slice().reverse())].map((r) => sprite(r, FL_FIRE_INKS)), col, knob: both(FL_KNOB, FL_BONE_INKS), jaw: both(FL_JAWS, FL_BONE_INKS),
      far, mid, ceil, lava, glow, stars, nest
    };
    return flArt;
  };
  // A canvas laid again and again across the screen from `offset` (px scrolled), at `y`.
  const flTile = (ctx, canvas, offset, y) => {
    for (let x = -(Math.floor(offset) % canvas.width); x < W; x += canvas.width) ctx.drawImage(canvas, x, y);
  };

  const flap = (host) => {
    const out = hooks(host), status = makeStatus("Lives"), art = flapArt(), R = rng(), J = juice(host);
    const fx = sparks(160, FL_SPARKS, 110), embers = sparks(48, FL_EMBERS, -26);
    // The gates: alive, kind (0 still, 1 sliding, 2 jaws), passed, broken halves (1 top, 2 bottom), whether it ends
    // its cave, whether the ptero went through its bone unhurt (so it scores nothing); where it is, its gap's middle
    // now and at rest, its gap now and at rest, and the slide's or the jaws' phase, rate and reach.
    const G = { alive: new Uint8Array(FL_GATES), kind: new Uint8Array(FL_GATES), passed: new Uint8Array(FL_GATES), broke: new Uint8Array(FL_GATES), last: new Uint8Array(FL_GATES), ghost: new Uint8Array(FL_GATES),
      x: new Float32Array(FL_GATES), y: new Float32Array(FL_GATES), y0: new Float32Array(FL_GATES), gap: new Float32Array(FL_GATES), gap0: new Float32Array(FL_GATES),
      ph: new Float32Array(FL_GATES), rate: new Float32Array(FL_GATES), amp: new Float32Array(FL_GATES) };
    // Bananas (kind 0 one, 1 a bunch, 2 the golden coconut), the leaps of fire (state 0 none, 1 bubbling, 2 in the
    // air), the score numbers floating up and the rings.
    const N = { alive: new Uint8Array(FL_NANAS), kind: new Uint8Array(FL_NANAS), x: new Float32Array(FL_NANAS), y: new Float32Array(FL_NANAS) };
    const F = { state: new Uint8Array(FL_FIRES), x: new Float32Array(FL_FIRES), y: new Float32Array(FL_FIRES), vy: new Float32Array(FL_FIRES), t: new Float32Array(FL_FIRES) };
    const PN = { value: new Int32Array(FL_POPS), x: new Float32Array(FL_POPS), y: new Float32Array(FL_POPS), t: new Float32Array(FL_POPS), next: 0 };
    const RG = { x: new Float32Array(FL_RINGS), y: new Float32Array(FL_RINGS), t: new Float32Array(FL_RINGS), size: new Float32Array(FL_RINGS), next: 0 };
    // The run on one object, written in place: the ptero (`py`, `vy`, `flapT` since its last flap, `inv` seconds
    // untouchable, `hurtT` its white flash), the world (`speed`, `scroll`, `dist` since the last gate, `spacing`),
    // the cave (`zone`, gates spawned in it, `lastGy` the last gap's middle, `goldAt` the gate its golden coconut
    // comes before, `clean` while nothing has hurt), the banner (1 the cave's name, 2 waiting to show it) and its clock, the
    // timers, the nest, and the run's tally.
    const S = { py: 60, vy: 0, flapT: 1, inv: 0, hurtT: 0, speed: 40, scroll: 0, dist: 0, spacing: 82, zone: 0, zoneGates: 0, lastGy: 60, goldAt: 0, clean: 1,
      banner: 0, bannerT: 0, fireT: 0, emberT: 0, trailT: 0, bonkT: 0, timer: 0, splash: 0, nestX: 0, landed: 0, clock: 0,
      streak: 0, lives: FL_LIVES, passed: 0, bulls: 0, hits: 0, cleared: 0, won: 0, seed: 0 };
    let phase = "idle";
    const flying = () => phase === "ready" || phase === "fly";
    const setVerb = () => { status.verb = flying() ? "Flap!" : ""; };
    const pop = (x, y, value) => {
      const i = PN.next;
      PN.next = (PN.next + 1) % FL_POPS;
      PN.value[i] = value; PN.x[i] = x; PN.y[i] = y; PN.t[i] = 0.001;
    };
    const ring = (x, y, size) => {
      const i = RG.next;
      RG.next = (RG.next + 1) % FL_RINGS;
      RG.x[i] = x; RG.y[i] = y; RG.t[i] = 0.001; RG.size[i] = size;
    };
    // Bullseyes in a row set the multiplier; climbing a step is a moment, and x4 sets the ptero on fire.
    const setStreak = (n) => {
      const was = status.mult;
      S.streak = n;
      status.streak = n;
      status.mult = n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1;
      status.fire = status.mult >= 4;
      if (status.mult <= Math.max(1, was)) return;
      ring(FL_PX, S.py, 12);
      fx.spawn(FL_PX, S.py, 14, 60, FLS_FIRE, FLS_BANANA, 0.6);
      out.crack(false);
      if (status.fire) { out.cue("fire"); out.popup(FL_SAY.fire, false); J.flash(INK.ember, 0.25); }
      else out.cue("score");
    };
    const nana = (x, y, kind) => {
      for (let k = 0; k < FL_NANAS; k++) {
        if (N.alive[k]) continue;
        N.alive[k] = 1; N.kind[k] = kind; N.x[k] = x; N.y[k] = y;
        return;
      }
    };
    // A cave begins: its pace, where its golden coconut hides, and its banner; the first gate comes soon after.
    const startCave = (z) => {
      const c = FL_CAVES[z];
      S.zone = z; status.round = z + 1;
      S.zoneGates = 0; S.clean = 1; S.spacing = c.spacing; S.dist = c.spacing * 0.4;
      S.goldAt = z > 0 ? 2 + R.int(c.gates - 3) : -1;
      S.fireT = c.fire * 0.8;
      S.banner = 1; S.bannerT = FL_NAME;
    };
    // A gate at the right edge: its kind by the cave's odds, its gap where the last one's can be reached from, and
    // what it carries: a banana on its centre line or a bunch by a lip, a line of bananas from the last gate, or
    // the cave's golden coconut down by the lava between the two.
    const spawnGate = () => {
      const c = FL_CAVES[S.zone], k = S.zoneGates;
      let i = 0;
      while (G.alive[i]) i++;
      const kind = R.chance(c.jaw) ? 2 : R.chance(c.slide) ? 1 : 0, gap = c.gap - 3 * k / c.gates, half = gap / 2;
      const amp = kind === 1 ? c.amp * (0.7 + 0.3 * R.next()) : 0, room = half + 6 + amp + (kind === 2 ? FL_JAW / 2 : 0);
      const y = Math.max(FL_CEIL + room, Math.min(FL_LAVA - room, S.lastGy + R.range(-c.shift, c.shift)));
      G.alive[i] = 1; G.kind[i] = kind; G.passed[i] = G.broke[i] = G.ghost[i] = 0; G.last[i] = k === c.gates - 1 ? 1 : 0;
      G.x[i] = W + 4; G.y0[i] = G.y[i] = y; G.gap0[i] = G.gap[i] = gap; G.amp[i] = amp;
      G.ph[i] = R.next() * FL_TAU; G.rate[i] = FL_TAU / (kind === 2 ? R.range(1.5, 2.1) : R.range(c.period, c.period + 0.8));
      const cx = W + 4 + FL_COL / 2, back = S.spacing;
      if (k === S.goldAt) nana(cx - back / 2, FL_LAVA - 10, 2);
      else if (k > 0 && R.chance(0.45)) for (let n = 1; n <= 3; n++) nana(cx - back + back * n / 4, S.lastGy + (y - S.lastGy) * n / 4, 0);
      if (kind !== 1) {
        if (S.zone > 0 && R.chance(0.35)) nana(cx, y + (R.chance(0.5) ? -1 : 1) * (half - 7), 1);
        else if (R.chance(0.65)) nana(cx, y, 0);
      }
      S.lastGy = y; S.zoneGates++;
    };
    // Fire leaps between two gates, never at a gap's mouth, bubbling first where it will rise as the ptero comes by;
    // with no such stretch of lava ahead yet it tries again a moment later.
    // A golden coconut still hanging within 16 px of `x`: fire never leaps under one, so diving for it is fair.
    const goldNear = (x) => {
      for (let k = 0; k < FL_NANAS; k++) if (N.alive[k] && N.kind[k] === 2 && Math.abs(N.x[k] - x) < 16) return true;
      return false;
    };
    const launchFire = () => {
      let x = -1;
      for (let i = 0; i < FL_GATES; i++) {
        const m = G.x[i] + FL_COL / 2 + S.spacing / 2;
        if (G.alive[i] && m >= FL_PX + S.speed * 1.2 && m <= FL_PX + S.speed * 1.9 && (x < 0 || m < x) && !goldNear(m)) x = m;
      }
      if (x < 0) return false;
      for (let k = 0; k < FL_FIRES; k++) {
        if (F.state[k]) continue;
        F.state[k] = 1; F.t[k] = 0.9; F.x[k] = x + R.range(-6, 6); F.y[k] = FL_LAVA + 2; F.vy[k] = -R.range(165, 192);
        return true;
      }
      return true;
    };
    // A hurt: bone (0), lava (1) or fire (2). The streak breaks, a life goes, and the ptero is thrown up (hard off
    // the lava) and untouchable a moment; the last life sends it tumbling into the lava.
    const hurt = (how) => {
      S.lives--; status.left = S.lives; S.hits++; S.clean = 0;
      setStreak(0);
      fx.spawn(FL_PX, S.py, 16, 60, FLS_FEATHER, FLS_FEATHER + 1, 0.8);
      if (how) fx.spawn(FL_PX, S.py + 2, 14, 55, FLS_FIRE, FLS_FIRE + 1, 0.6);
      ring(FL_PX, S.py, 12);
      J.shake(4); J.flash(how ? INK.ember : INK.red, 0.45);
      out.shake(0.7); out.cue(how ? "burn" : "slam"); out.flop();
      S.hurtT = 0.25;
      if (S.lives <= 0) {
        phase = "fall"; S.vy = -90; S.timer = FL_OVER; S.splash = 0;
        out.over();
        setVerb();
        out.popup(FL_SAY.down, true);
        return;
      }
      S.inv = FL_INV;
      S.vy = how === 1 ? -175 : Math.min(S.vy, -70);
      out.popup(FL_SAY.hurt[how], false);
    };
    // The ptero flew into one half of a gate: that half shatters into bone.
    const crash = (i, top) => {
      G.broke[i] |= top ? 1 : 2;
      const x = G.x[i] + FL_COL / 2, edge = top ? G.y[i] - G.gap[i] / 2 : G.y[i] + G.gap[i] / 2, from = top ? FL_TOP : edge, to = top ? edge : FL_LAVA;
      for (let y = from; y < to; y += 9) fx.spawn(x, y, 2, 40, FLS_BONE, FLS_BONE + 1, 0.7);
      fx.spawn(x, edge, 12, 70, FLS_BONE, FLS_BONE + 1, 0.8);
      out.cue("crack");
      hurt(0);
    };
    const land = () => {
      S.landed = 1; S.won = 1; S.timer = FL_LANDED;
      const bonus = FL_PTS.nest + FL_PTS.life * S.lives;
      status.score += bonus;
      pop(FL_PX, FL_NEST_Y - 16, bonus);
      fx.spawn(FL_PX, FL_NEST_Y - 4, 30, 80, FLS_BANANA, FLS_WHITE, 0.9);
      fx.spawn(FL_PX, FL_NEST_Y - 4, 20, 70, FLS_FEATHER, FLS_TEAL, 0.9);
      ring(FL_PX, FL_NEST_Y - 4, 16);
      J.flash(INK.gold, 0.4);
      out.popup(FL_SAY.nest(bonus), true); out.cue("win"); out.crack(true); out.over();
    };
    // The cave's last gate is behind the ptero: a bonus (more for a clean cave), then the next cave, or the nest.
    const caveCleared = () => {
      S.cleared++;
      const bonus = FL_PTS.cave * (S.zone + 1) + (S.clean ? FL_PTS.clean : 0);
      status.score += bonus;
      pop(FL_PX, S.py - 12, bonus);
      fx.spawn(FL_PX, S.py, 18, 70, FLS_TEAL, FLS_WHITE, 0.7);
      out.crack(true);
      J.flash(INK.teal, 0.3);
      out.cue("round");
      out.popup(S.clean ? FL_SAY.clean(bonus) : FL_SAY.clear(bonus), true);
      if (S.zone >= FL_CAVES.length - 1) {
        phase = "nest"; S.nestX = W + 6; S.banner = 0;
        setVerb();
        return;
      }
      // The next cave's name comes up once the popup has had its moment.
      startCave(S.zone + 1);
      S.banner = 2; S.bannerT = FL_CLEAR;
    };
    const passGate = (i) => {
      G.passed[i] = 1; S.passed++;
      const cx = G.x[i] + FL_COL / 2, y = G.y[i];
      if (!G.broke[i] && !G.ghost[i]) {
        if (Math.abs(S.py - y) <= FL_BULL) {
          setStreak(S.streak + 1);
          S.bulls++;
          const pts = (FL_PTS.gate + FL_PTS.bull) * status.mult;
          status.score += pts;
          pop(cx, y - 10, pts);
          ring(cx, y, 7);
          fx.spawn(cx, y, 10, 45, FLS_WHITE, FLS_BANANA, 0.45);
          out.cue("ding");
        } else {
          const pts = FL_PTS.gate * status.mult;
          status.score += pts;
          pop(cx, y - 10, pts);
          if (S.streak >= 6) out.flop();
          setStreak(0);
          out.cue("tick");
        }
      }
      if (G.last[i]) caveCleared();
    };
    const grab = (k) => {
      N.alive[k] = 0;
      const x = N.x[k], y = N.y[k], kind = N.kind[k];
      if (kind === 2) {
        fx.spawn(x, y, 22, 70, FLS_BANANA, FLS_WHITE, 0.8);
        ring(x, y, 12);
        J.flash(INK.banana, 0.3);
        out.cue("bell"); out.crack(true);
        if (S.lives < FL_MAX_LIVES) { S.lives++; status.left = S.lives; out.popup(FL_SAY.oneUp, true); }
        else { status.score += FL_PTS.gold; pop(x, y - 6, FL_PTS.gold); out.popup(FL_SAY.gold(FL_PTS.gold), true); }
        return;
      }
      const pts = (kind ? FL_PTS.bunch : FL_PTS.banana) * status.mult;
      status.score += pts;
      pop(x, y - 6, pts);
      fx.spawn(x, y, kind ? 16 : 6, kind ? 55 : 35, FLS_BANANA, FLS_BANANA + 1, 0.5);
      if (kind) { ring(x, y, 9); out.cue("score"); out.crack(false); } else out.cue("coin", 0.7);
    };
    // Flap: the wings beat down and the ptero lifts. It hovers on GET READY, the cave still, until the first flap
    // sets it flying and the cave rolling.
    const flapWings = () => {
      if (!flying()) return;
      if (phase === "ready") { phase = "fly"; S.dist = S.spacing * 0.8; }
      S.vy = FL_FLAP; S.flapT = 0;
      fx.spawn(FL_PX - 3, S.py + 4, 2, 14, FLS_FEATHER + 1, FLS_FEATHER + 1, 0.35);
      out.cue("flip", 0.8);
    };

    const step = (h) => {
      const c = FL_CAVES[S.zone];
      S.inv = Math.max(0, S.inv - h); S.hurtT = Math.max(0, S.hurtT - h); S.bonkT = Math.max(0, S.bonkT - h); S.flapT += h;
      // The world: its pace eases toward the cave's (it waits for the first flap, and the fall and the nest bring it
      // to a stop), and everything in it slides left.
      const pace = phase === "ready" || phase === "fall" ? 0 : phase === "nest" ? Math.max(0, Math.min(c.speed, (S.nestX - FL_NEST_AT) * 2.4)) : c.speed + c.ramp * S.zoneGates / c.gates;
      S.speed += (pace - S.speed) * Math.min(1, h * (phase === "nest" ? 6 : 2));
      const v = S.speed * h;
      S.scroll += v;
      for (let i = 0; i < FL_GATES; i++) {
        if (!G.alive[i]) continue;
        G.x[i] -= v;
        if (G.x[i] < -16) { G.alive[i] = 0; continue; }
        if (G.kind[i]) {
          G.ph[i] += G.rate[i] * h;
          if (G.kind[i] === 1) G.y[i] = G.y0[i] + G.amp[i] * Math.sin(G.ph[i]);
          else G.gap[i] = G.gap0[i] + FL_JAW * Math.sin(G.ph[i]);
        }
      }
      for (let k = 0; k < FL_NANAS; k++) {
        if (!N.alive[k]) continue;
        N.x[k] -= v;
        if (N.x[k] < -10) N.alive[k] = 0;
        else if (flying() && Math.abs(N.x[k] - FL_PX) < 7 && Math.abs(N.y[k] - S.py) < 7) grab(k);
      }
      for (let k = 0; k < FL_FIRES; k++) {
        if (!F.state[k]) continue;
        F.x[k] -= v;
        if (F.state[k] === 1) {
          F.t[k] -= h;
          if (F.t[k] <= 0) { F.state[k] = 2; out.cue("spit", 0.5); embers.spawn(F.x[k], FL_LAVA, 6, 30, 0, 1, 0.6); }
        } else {
          F.vy[k] += FL_GRAV * 0.9 * h; F.y[k] += F.vy[k] * h;
          // In the air `t` times its trail of embers.
          F.t[k] -= h;
          if (F.t[k] <= 0) { F.t[k] = 0.05; embers.spawn(F.x[k], F.y[k] + (F.vy[k] < 0 ? 4 : -4), 1, 6, 0, 1, 0.45); }
          if (F.y[k] > FL_LAVA + 4 && F.vy[k] > 0) { F.state[k] = 0; embers.spawn(F.x[k], FL_LAVA, 4, 20, 0, 2, 0.5); continue; }
          if (phase === "fly" && S.inv <= 0 && Math.abs(F.x[k] - FL_PX) < 6 && Math.abs(F.y[k] - S.py) < 6) { F.state[k] = 0; hurt(2); }
        }
        if (F.x[k] < -8) F.state[k] = 0;
      }
      // The lava's embers, thicker in the fire caves.
      S.emberT -= h;
      if (S.emberT <= 0) { S.emberT = c.fire ? 0.05 : 0.14; embers.spawn(Math.random() * W, FL_LAVA - 1, 1, 9, 0, 1, 1.3); }
      if (S.banner) {
        S.bannerT -= h;
        if (S.bannerT <= 0) {
          if (S.banner === 2) { S.banner = 1; S.bannerT = FL_NAME; }
          else S.banner = 0;
        }
      }

      if (phase === "ready") {
        S.py = 60 + Math.sin(S.clock * 3) * 3; S.vy = 0;
      } else if (phase === "fly") {
        S.vy = Math.min(FL_FALL, S.vy + FL_GRAV * h);
        S.py += S.vy * h;
        if (S.py - FL_HH < FL_CEIL) {
          S.py = FL_CEIL + FL_HH;
          if (S.vy < 0) { S.vy = 20; if (S.bonkT <= 0) { S.bonkT = 0.3; out.cue("bonk", 0.5); fx.spawn(FL_PX + 3, FL_CEIL, 3, 20, FLS_BONE + 1, FLS_BONE + 1, 0.3); } }
        }
        if (S.py + FL_HH > FL_LAVA) {
          if (S.inv > 0) S.vy = -150;
          else hurt(1);
        }
        if (phase === "fly") for (let i = 0; i < FL_GATES; i++) {
          if (!G.alive[i]) continue;
          const x = G.x[i];
          if (x - 1 < FL_PX + FL_HW && x + FL_COL + 1 > FL_PX - FL_HW) {
            const top = S.py - FL_HH < G.y[i] - G.gap[i] / 2, bottom = S.py + FL_HH > G.y[i] + G.gap[i] / 2;
            if ((top && !(G.broke[i] & 1)) || (bottom && !(G.broke[i] & 2))) {
              if (S.inv > 0) G.ghost[i] = 1;
              else { crash(i, top); if (phase !== "fly") break; }
            }
          }
          if (!G.passed[i] && x + FL_COL / 2 <= FL_PX) { passGate(i); if (phase !== "fly") break; }
        }
        if (phase === "fly" && S.zoneGates < c.gates) {
          S.dist += v;
          if (S.dist >= S.spacing) { S.dist -= S.spacing; spawnGate(); }
          if (c.fire && S.zoneGates > 0) { S.fireT -= h; if (S.fireT <= 0) S.fireT = launchFire() ? c.fire * R.range(0.7, 1.3) : 0.2; }
        }
        if (status.fire) { S.trailT -= h; if (S.trailT <= 0) { S.trailT = 0.05; fx.spawn(FL_PX - 6, S.py, 1, 16, FLS_FIRE, FLS_BANANA, 0.35); } }
      } else if (phase === "fall") {
        S.vy = Math.min(FL_FALL * 1.2, S.vy + FL_GRAV * h);
        S.py += S.vy * h;
        if (!S.splash && S.py > FL_LAVA) {
          S.splash = 1;
          fx.spawn(FL_PX, FL_LAVA, 26, 80, FLS_FIRE, FLS_FIRE + 1, 0.8);
          embers.spawn(FL_PX, FL_LAVA, 12, 40, 0, 1, 0.9);
          J.shake(3); out.cue("fire");
        }
        S.timer -= h;
        if (S.timer <= 0) finish();
      } else if (phase === "nest") {
        S.nestX -= v;
        const sit = FL_NEST_Y - 3;
        S.vy = 0;
        S.py += (sit - S.py) * Math.min(1, h * 2.2);
        if (!S.landed && S.nestX <= FL_NEST_AT + 1 && Math.abs(S.py - sit) < 1.5) land();
        if (S.landed) { S.timer -= h; if (S.timer <= 0) finish(); }
      }
    };
    const run = stepper(step);
    const finish = () => {
      phase = "done";
      setVerb();
      status.note = `Caves ${S.cleared}/${FL_CAVES.length} · gates ${S.passed}/${FL_TOTAL} · bullseyes ${S.bulls}`;
      out.cue(S.won ? "big" : "buzzer");
      out.onEnd(status.score);
    };

    // ---- drawing --------------------------------------------------------------------------------------------
    // The cave behind the flight: its air, the volcano's stars, far rock, the lava's glow, glow-worms in the rib
    // cage and the near rock, each scrolling slower the further off it is.
    const drawBack = (ctx) => {
      const z = S.zone;
      ctx.fillStyle = FL_CAVES[z].air;
      ctx.fillRect(0, 0, W, H);
      if (z === 4) ctx.drawImage(art.stars, 0, 10);
      flTile(ctx, art.far, S.scroll * 0.25, 0);
      ctx.drawImage(art.glow[z], 0, 0, 1, 48, 0, FL_LAVA - 46, W, 48);
      if (z === 1) {
        ctx.fillStyle = INK.teal;
        for (let k = 0; k < 12; k++) if ((S.clock * 0.9 + k * 0.77) % 3 < 1.2) ctx.fillRect(((k * 53 - Math.floor(S.scroll * 0.4)) % W + W) % W, 20 + (k * 29) % 50, 1, 1);
      }
      flTile(ctx, art.mid, S.scroll * 0.5, 0);
    };
    const drawGates = (ctx) => {
      for (let i = 0; i < FL_GATES; i++) {
        if (!G.alive[i]) continue;
        const x = Math.round(G.x[i]), yt = Math.round(G.y[i] - G.gap[i] / 2), yb = Math.round(G.y[i] + G.gap[i] / 2), cap = G.kind[i] === 2 ? art.jaw : art.knob, inset = (cap[0].w - FL_COL) >> 1;
        if (G.broke[i] & 1) ctx.drawImage(art.col, 0, FL_COL_H - 6, FL_COL, 6, x, FL_TOP, FL_COL, 6);
        else {
          const len = yt - cap[1].h + 1 - FL_TOP;
          if (len > 0) ctx.drawImage(art.col, 0, FL_COL_H - len, FL_COL, len, x, FL_TOP, FL_COL, len);
          ctx.drawImage(cap[1].canvas, x - inset, yt - cap[1].h);
        }
        if (G.broke[i] & 2) ctx.drawImage(art.col, 0, 0, FL_COL, 6, x, FL_LAVA - 4, FL_COL, 6);
        else {
          const len = FL_LAVA + 2 - yb;
          if (len > 0) ctx.drawImage(art.col, 0, 0, FL_COL, len, x, yb, FL_COL, len);
          ctx.drawImage(cap[0].canvas, x - inset, yb);
        }
      }
    };
    const drawNanas = (ctx) => {
      for (let k = 0; k < FL_NANAS; k++) {
        if (!N.alive[k]) continue;
        const kind = N.kind[k], bob = Math.round(Math.sin(S.clock * 4 + k) * 1.2);
        if (kind === 2) {
          blit(ctx, art.gold, N.x[k] - 2, N.y[k] - 2 + bob);
          if ((S.clock * 6 + k | 0) % 3 === 0) { ctx.fillStyle = INK.white; ctx.fillRect(Math.round(N.x[k]) + 2, Math.round(N.y[k]) - 4 + bob, 1, 1); }
        } else blit(ctx, kind ? art.bunch : art.banana, N.x[k] - (kind ? 6 : 3), N.y[k] - (kind ? 4 : 2) + bob);
      }
    };
    const drawFires = (ctx) => {
      for (let k = 0; k < FL_FIRES; k++) {
        const st = F.state[k];
        if (!st) continue;
        const x = Math.round(F.x[k]);
        if (st === 1) {
          // The lava swells where the fire will leap, wider as it comes, blinking at the last.
          const r = 1 + Math.round(3 * (1 - F.t[k] / 0.9));
          ctx.fillStyle = F.t[k] < 0.25 && (S.clock * 16 | 0) & 1 ? INK.white : INK.ember;
          ctx.fillRect(x - r - 1, FL_LAVA - 2, 2 * r + 3, 3);
          ctx.fillStyle = INK.banana;
          ctx.fillRect(x - r, FL_LAVA - 3, 2 * r + 1, 2);
          ctx.fillRect(x - 1 + ((S.clock * 9 | 0) % 3), FL_LAVA - 5 - r, 1, 1);
        } else blit(ctx, art.fire[((S.clock * 10 | 0) & 1) + (F.vy[k] > 0 ? 2 : 0)], x - 3, F.y[k] - 4);
      }
    };
    const drawNest = (ctx) => {
      if (phase !== "nest" && !(phase === "done" && S.won)) return;
      const x = Math.round(S.nestX);
      ctx.fillStyle = INK.stoneDk; ctx.fillRect(x + 6, FL_NEST_Y + 8, 22, FL_LAVA - FL_NEST_Y - 6);
      ctx.fillStyle = INK.stone; ctx.fillRect(x + 8, FL_NEST_Y + 8, 6, FL_LAVA - FL_NEST_Y - 6);
      ctx.fillStyle = INK.stoneLt; ctx.fillRect(x + 9, FL_NEST_Y + 12, 2, 9); ctx.fillRect(x + 20, FL_NEST_Y + 16, 3, 1);
      ctx.fillStyle = INK.charcoal; ctx.fillRect(x + 2, FL_NEST_Y + 6, 30, 4);
      ctx.drawImage(art.nest, x, FL_NEST_Y - 2);
    };
    // The chicks put their heads up out of the eggs one by one once their parent lands beside them.
    const drawChicks = (ctx) => {
      if (!S.landed) return;
      const x = Math.round(S.nestX);
      for (let k = 0; k < 3; k++) if (S.timer < FL_LANDED - 0.3 - k * 0.25) blit(ctx, art.head, x + 3 + k * 6, FL_NEST_Y - 4 - ((S.clock * 6 + k) & 1));
    };
    const drawPtero = (ctx) => {
      if (phase === "fall" && S.py > FL_LAVA + 6) return;
      if (S.inv > 0 && (S.clock * 12 | 0) % 2) return;
      let frame = 1;
      if (phase === "fall") frame = (S.clock * 14 | 0) & 1 ? 0 : 2;
      else if (phase === "ready" || (phase === "nest" && !S.landed)) frame = FL_BEAT[(S.clock * 9 | 0) & 3];
      else if (S.landed) frame = (S.clock * 3 | 0) & 1 ? 0 : 1;
      else if (S.flapT < 0.08) frame = 2;
      else if (S.flapT < 0.16) frame = 1;
      else if (S.flapT < 0.24) frame = 0;
      else frame = S.vy > 70 ? 0 : 1;
      blit(ctx, (S.hurtT > 0 ? art.white : art.ptero)[frame], FL_PX - 11, S.py - 8);
    };
    const drawFx = (ctx) => {
      ctx.fillStyle = INK.cream;
      for (let i = 0; i < FL_RINGS; i++) {
        if (RG.t[i] <= 0) continue;
        const r = 2 + RG.size[i] * RG.t[i] / 0.22;
        for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(RG.x[i] + COS8[k] * r), Math.round(RG.y[i] + SIN8[k] * r), 1, 1);
      }
      for (let i = 0; i < FL_POPS; i++) if (PN.t[i] > 0 && (PN.t[i] < 0.6 || (S.clock * 16 | 0) % 2)) number(ctx, PN.value[i], Math.round(PN.x[i]), Math.round(PN.y[i] - PN.t[i] * 14), TEXT.banana, 1, 1);
    };
    const drawHud = (ctx) => {
      ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, 9);
      ctx.fillStyle = INK.rule; ctx.fillRect(0, 9, W, 1);
      number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
      if (status.mult > 1) { text(ctx, "X", 36, 1, status.fire ? TEXT.banana : TEXT.ember); number(ctx, status.mult, 42, 1, status.fire ? TEXT.banana : TEXT.ember); }
      text(ctx, "CAVE", 52, 1, TEXT.teal);
      number(ctx, S.zone + 1, 77, 1, TEXT.teal);
      // The course: how far along the five caves the ptero is, each cave's end a notch.
      ctx.fillStyle = INK.rule; ctx.fillRect(86, 3, FL_BAR, 3);
      ctx.fillStyle = INK.banana; ctx.fillRect(86, 3, Math.round(FL_BAR * S.passed / FL_TOTAL), 3);
      ctx.fillStyle = INK.bone;
      for (let k = 0; k < FL_ENDS.length; k++) ctx.fillRect(86 + FL_ENDS[k], 2, 1, 5);
      for (let k = 0; k < S.lives && k < FL_MAX_LIVES; k++) blit(ctx, art.head, W - 8 - k * 7, 3);
    };
    const drawBanner = (ctx) => {
      if (phase === "done") {
        ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, 10, W, FL_LAVA - 10); ctx.globalAlpha = 1;
        centre(ctx, S.won ? "NEST!" : "GAME OVER", 34, S.won ? TEXT.gold : TEXT.red, 2);
        centre(ctx, "SCORE", 58, TEXT.stone);
        number(ctx, status.score, W / 2, 68, TEXT.banana, 2, 1);
      } else if (S.banner === 1) {
        // A ribbon over the rock roof, never the flight, sliding out from under the HUD's band and back.
        const c = FL_CAVES[S.zone], y = 10 - Math.round(10 * (1 - Math.min(1, (FL_NAME - S.bannerT) / 0.15, S.bannerT / 0.15)));
        ctx.fillStyle = INK.band; ctx.fillRect(0, y, W, 10);
        ctx.fillStyle = INK.rule; ctx.fillRect(0, y + 10, W, 1);
        if (S.zone === FL_LAST) text(ctx, "LAST CAVE", c.tagX, y + 2, TEXT.ember);
        else { text(ctx, "CAVE", c.tagX, y + 2, TEXT.bone); number(ctx, S.zone + 1, c.tagX + 5 * CELL, y + 2, TEXT.banana); }
        text(ctx, c.name, c.nameX, y + 2, TEXT.teal);
      }
      if (phase === "ready" && (S.clock * 2.4 | 0) % 2) centre(ctx, "GET READY", 84, TEXT.bone);
    };
    // Idle: the title over the cave, the ptero flapping, what pays, PRESS START and the best.
    const drawAttract = (ctx) => {
      centre(ctx, "PTERO", 14, TEXT.violet, 2);
      centre(ctx, "FLAP", 32, TEXT.sky, 2);
      blit(ctx, art.ptero[FL_BEAT[(S.clock * 8 | 0) & 3]], 16, 58 + Math.round(Math.sin(S.clock * 2.5) * 4));
      blit(ctx, art.banana, 72, 54); text(ctx, "+5", 86, 54, TEXT.banana);
      blit(ctx, art.bunch, 69, 64); text(ctx, "+30", 86, 66, TEXT.gold);
      blit(ctx, art.gold, 73, 78); text(ctx, "1UP", 86, 78, TEXT.bone);
      if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 94, TEXT.bone);
      ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, 9);
      text(ctx, "HI", 3, 1, TEXT.stone);
      number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
    };

    const reset = () => {
      G.alive.fill(0); N.alive.fill(0); F.state.fill(0); PN.t.fill(0); RG.t.fill(0);
      fx.clear(); embers.clear(); J.reset();
      S.py = 60; S.vy = 0; S.flapT = 1; S.inv = S.hurtT = S.bonkT = 0; S.scroll = 0; S.zone = 0; S.banner = 0; S.landed = 0;
      S.speed = 0; S.lastGy = 60;
      status.fire = false; status.meter = -1; status.target = 0; status.note = "";
      setStreak(0);
    };
    reset();
    status.left = FL_LIVES;
    return {
      kind: "flap", name: "Ptero Flap", aims: true, taps: true, status,
      help: "Space or tap flaps. Fly the bone gates through five caves to the nest; dead centre is a bullseye, and bullseyes in a row multiply.",
      coach: ["Space flaps: through the bone gates", "Tap to flap through the bone gates"],
      stars: [600, 1400, 3500], tickets: (score) => Math.floor(score / 110),
      get playing() { return phase !== "idle" && phase !== "done"; },
      get seed() { return S.seed; },
      start: (seed) => {
        if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
        reset();
        status.score = 0; S.lives = FL_LIVES; status.left = FL_LIVES;
        S.passed = S.bulls = S.hits = S.cleared = S.won = 0;
        // The first cave's name waits out the count's "Ooga go!".
        startCave(0);
        S.banner = 2; S.bannerT = 0.9;
        phase = "ready";
        // A line of bananas leads in, so the first flaps already pay.
        for (let n = 0; n < 5; n++) nana(112 + n * 13, 60 - Math.round(Math.sin(n * 0.9) * 10), 0);
        setVerb();
      },
      stop: () => { phase = "idle"; reset(); status.round = 1; status.left = FL_LIVES; setVerb(); },
      act: flapWings,
      update: (dt) => {
        S.clock += dt;
        J.update(dt);
        fx.update(dt);
        embers.update(dt);
        for (let i = 0; i < FL_POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
        for (let i = 0; i < FL_RINGS; i++) if (RG.t[i] > 0) { RG.t[i] += dt; if (RG.t[i] > 0.22) RG.t[i] = 0; }
        if (phase === "idle") {
          S.scroll += 18 * dt;
          S.emberT -= dt;
          if (S.emberT <= 0) { S.emberT = 0.14; embers.spawn(Math.random() * W, FL_LAVA - 1, 1, 9, 0, 1, 1.3); }
        } else if (phase !== "done") run(dt);
      },
      draw: (ctx) => {
        drawBack(ctx);
        if (phase === "idle") {
          flTile(ctx, art.ceil, S.scroll, 10);
          flTile(ctx, art.lava[(S.clock * 8 | 0) & 3], S.scroll, FL_LAVA - 3);
          embers.draw(ctx);
          drawAttract(ctx);
          return;
        }
        J.begin(ctx);
        drawGates(ctx);
        flTile(ctx, art.ceil, S.scroll, 10);
        drawNest(ctx);
        drawNanas(ctx);
        drawFires(ctx);
        drawPtero(ctx);
        drawChicks(ctx);
        flTile(ctx, art.lava[(S.clock * 8 | 0) & 3], S.scroll, FL_LAVA - 3);
        embers.draw(ctx);
        fx.draw(ctx);
        drawFx(ctx);
        J.end(ctx);
        drawBanner(ctx);
        drawHud(ctx);
      }
    };
  };

  // ---- Rock Breaker -----------------------------------------------------------------------------------------
  // Breakout in a quarry cave: an Ooga holds a log over its head and bounces a coconut up into a rock face that
  // hangs from the cave's ceiling and creeps down on a rumble; let the rock reach the red line over the Ooga and the
  // cave comes in. Where the coconut meets the log steers it (the ends send it wide), and moving as you launch picks
  // its side. Space as it lands is a smash: the coconut leaves hot and faster, bursts through three rocks (bone too)
  // and keeps the chain going, where a plain catch or a swing at nothing ends it; rocks broken in a chain multiply their points (x2 from
  // five, x3 from ten, x4 from fifteen, x5 from twenty). Stone takes one hit, rock two, granite three; bone gives only
  // to a smash, fire or a blast; an ember rock blows up the rocks round it and lights the embers beside it; banana ore
  // drops a bunch, crystal ore a power (a tusk that lengthens the log, three coconuts, a fire coconut that burns
  // through everything), and so does a pterodactyl gliding under the rock now and then, bonked for a bonus. Four
  // walls, each faster and creeping sooner, a bonus for a quick clear; three coconuts, one more at 6000.
  const BK_COLS = 12, BK_ROWS = 6, BK_N = BK_COLS * BK_ROWS, BK_PX = 12, BK_PY = 6, BK_BW = 11, BK_BH = 5, BK_X0 = 8;
  const BK_L = 4, BK_R = 156, BK_TOP = 9, BK_WALL_Y = 16, BK_LOG_Y = 100, BK_OOGA_Y = 103, BK_GROUND = 114, BK_FLOOR = 118, BK_DANGER = 88, BK_WARN = 12;
  const BK_BALL = 2, BK_BALLS = 3, BK_DROPS = 4, BK_TRAIL = 6, BK_LOG_W = 26, BK_WIDE_W = 40, BK_LOG_SPEED = 200, BK_REACH = 72, BK_ANGLE = 1.08, BK_ANGLE_MIN = 0.26, BK_JITTER = 0.06;
  const BK_SWING = 0.13, BK_LATE = 0.06, BK_COOL = 0.55, BK_COOL_HIT = 0.1, BK_PIERCE = 3, BK_SMASH_K = 1.22, BK_SPEED_MAX = 165, BK_TEMPO_UP = 0.4, BK_TEMPO_MAX = 24;
  const BK_LIVES = 3, BK_EXTRA_AT = 6000, BK_AUTO = 5, BK_LOST_S = 1.2, BK_CLEAR_S = 2.2, BK_OVER_S = 2, BK_TUSK_S = 14, BK_FIRE_S = 7, BK_CREEP = 3, BK_CREEP_K = 0.86, BK_CREEP_MIN = 0.8, BK_ROCK_H = 112;
  const BK_FALL = 36, BK_PTERO_V = 32, BK_PTERO_PAYS = 250, BK_BANANA_PAYS = 150, BK_FUSE = 0.09, BK_LOOSE = 8, BK_LOOSE_S = 1.2, BK_LOOSE_EVERY = 0.6;
  // Rock kinds (0 none, 1 stone, 2 rock, 3 granite, 4 ember, 5 banana ore, 6 crystal ore, 7 bone): the hits each
  // takes, its points and its letter in a wall's rows.
  const BK_HP = [0, 1, 2, 3, 1, 1, 1, 1], BK_PTS = [0, 10, 20, 40, 25, 30, 30, 50], BK_CHARS = ".srgebpx", BK_EMBER = 4, BK_BANANA = 5, BK_CRYSTAL = 6, BK_BONE = 7;
  // Pickups: 1 a banana bunch, 2 a tusk (the long log), 3 three coconuts, 4 a fire coconut.
  const BK_P_BANANA = 1, BK_P_TUSK = 2, BK_P_TRIPLE = 3, BK_P_FIRE = 4;
  // The four walls, top row first, each with its coconut's speed, the seconds to the rock's first creep (each later
  // one comes sooner, so a wall left standing half a minute comes most of the way down) and the par for its
  // quick-clear bonus; parsed once into cells and a count of the rocks that must break.
  const BK_WALLS = [
    { speed: 98, creep: 5, par: 20, rows: ["ssbsssssspss", "sssessssesss", "sseesssseess"] },
    { speed: 106, creep: 4.5, par: 26, rows: ["rrrrrrrrrrrr", "sspssrrsspss", "sbssseessbss", "ssesssssesss"] },
    { speed: 114, creep: 4, par: 30, rows: ["rgrrrggrrrgr", "rrprrsrrbrrr", "seesrssrsees", "sssessssesss"] },
    { speed: 124, creep: 3.5, par: 38, rows: ["gggggggggggg", "gxrrpeeprrxg", "rxeesrrseexr", "rsrsrbbrsrsr", "sessssssssse"] }
  ];
  for (const w of BK_WALLS) {
    w.cells = new Uint8Array(BK_N); w.left = 0;
    w.rows.forEach((row, r) => { for (let c = 0; c < BK_COLS; c++) { const k = BK_CHARS.indexOf(row[c]); w.cells[r * BK_COLS + c] = k; if (k && k !== BK_BONE) w.left++; } });
  }
  // The sparks' inks in pairs: stone, rock, granite, ember, banana, crystal, bone, coconut milk, husk, pterodactyl, dust.
  const BK_SPARKS = [INK.stoneLt, INK.stone, "#a8988a", "#7c6c60", "#c47a58", "#8e4632", INK.ember, INK.red, INK.banana, "#b8872a", INK.teal, "#1f8f78", INK.bone, "#c8bca0",
    INK.cream, INK.white, INK.husk, INK.huskDk, INK.violet, "#7a5ab8", "#5a4a3a", "#3a2e22"];
  const BK_S_OF = [0, 0, 2, 4, 6, 8, 10, 12], BK_S_EMBER = 6, BK_S_BANANA = 8, BK_S_BONE = 12, BK_S_MILK = 14, BK_S_HUSK = 16, BK_S_PTERO = 18, BK_S_DUST = 20;
  // Each rock's pixels (an 11x5 block lit from above), its cracked states, and the pickups' icons.
  const BK_BRICK = {
    stone: ["hhhhhhhhhhm", "hmmmmmmmmmd", "hmmdmmmmmmd", "hmmmmmmdmmd", "mdddddddddd"],
    rock: ["hhhhhhhhhhm", "hmmmmmmmmmd", "hmdmmmmmdmd", "hmmmmmmmmmd", "mdddddddddd"],
    rock1: ["hhhhhkhhhhm", "hmmmmkmmmmd", "hmdmkmkmdmd", "hmmkmmmkmmd", "mdddddddddd"],
    granite: ["hhhhhhhhhhm", "hmsmmmmsmmd", "hmmmmsmmmmd", "hmmsmmmmmsd", "mdddddddddd"],
    granite1: ["hhhhhhhkhhm", "hmsmmmmkmmd", "hmmmmsmkkmd", "hmmsmmkmmsd", "mdddddddddd"],
    granite2: ["hhkhhhhkhhm", "hmkmmmmkmmd", "hmmkksmkkmd", "hmmskmkmmkd", "mdddkddddkd"],
    ember: ["hhhhhhhOhhm", "hmmmmmOYmmd", "hmmOOYOmmmd", "hmOYmmmmmmd", "mdOdddddddd"],
    banana: ["hhhhhhhhhhm", "hmmmmmmmYbd", "hmYmmmmYYmd", "hmmYYYYYmmd", "mdddddddddd"],
    crystal: ["hhhhhhhhhhm", "hmmmmCmmmmd", "hmmmCGCmmmd", "hmmmcCcmmmd", "mdddddddddd"],
    bone: ["eeeeeeeeeee", "BBdddddddBB", "bBBBBBBBBBb", "BBdddddddBB", "ddddddddddd"]
  };
  const BK_ORE = { h: INK.stoneLt, m: INK.stone, d: INK.stoneDk, Y: INK.banana, b: "#b8872a", C: INK.teal, c: "#1f8f78", G: INK.white };
  const BK_INKS = {
    stone: { h: INK.stoneLt, m: INK.stone, d: INK.stoneDk }, rock: { h: "#a8988a", m: "#7c6c60", d: "#4a3e36", k: "#241c18" },
    granite: { h: "#c47a58", m: "#8e4632", d: "#56281c", s: "#e8b89c", k: "#241410" }, bone: { e: "#4a3c2e", d: "#3a2e22", B: INK.bone, b: "#c8bca0" },
    ember: [{ h: "#6a3a28", m: "#3c1e14", d: "#20100a", O: INK.ember, Y: INK.banana }, { h: "#7a4230", m: "#4a2418", d: "#20100a", O: INK.banana, Y: "#fff3a0" }],
    ore: [BK_ORE, { ...BK_ORE, G: INK.teal }]
  };
  const BK_ICONS = [null,
    ["b......", "Y......", "YY....Y", ".YY..YY", ".YYYYY.", "..YYY..", "......."],
    [".......", "B.....B", "BB...BB", "BBBBBBB", "BB...BB", "B.....B", "......."],
    ["..CC...", "..Ck...", ".......", "CC...CC", "Ck...Ck", ".......", "......."],
    ["...R...", "..RO...", "..ROR..", ".ROYOR.", ".OYYYO.", ".OYYYO.", "..OOO.."]];
  const BK_ICON_INKS = { Y: INK.banana, b: "#b8872a", B: INK.bone, C: INK.husk, k: INK.huskDk, R: INK.red, O: INK.ember };
  const BK_RIMS = [null, INK.banana, INK.bone, INK.cream, INK.ember];
  // The attract screen's little wall.
  const BK_DEMO = [2, 1, 4, 1, 1, 6, 1, 2, 1, 5, 1, 1, 4, 1, 1, 1];
  const BK_SAY = {
    wall: ["", "Wall 1!", "Wall 2!", "Wall 3!", "Last wall!"], clear: worded("Wall down! +"), won: worded("All clear! +"), ptero: worded("Ptero! +"),
    chain: ["", "", "Chain x2!", "Chain x3!", "Chain x4!", "Chain x5!"], boom: "Boom!", tusk: "Tusk log!", triple: "Three coconuts!", fire: "Fire coconut!",
    extra: "Extra coconut!", lost: "Coconut cracked!", last: "Last coconut!", warn: "Cave coming down!", caved: "Cave-in!"
  };
  // Built once for the page on the first game: the quarry backdrop, the rock mass over the wall, every rock's frames,
  // the logs, the hot coconut, and the pickups (an icon each, and in a tablet that blinks).
  let bkArt = null;
  const breakerArt = () => {
    if (bkArt) return bkArt;
    const rand = BL.math.mulberry32(23), back = canvasOf(W, H), b = back.getContext("2d");
    b.fillStyle = "#0b0908"; b.fillRect(0, 0, W, H);
    b.fillStyle = "#110d0b"; b.fillRect(BK_L, 44, BK_R - BK_L, BK_GROUND - 44);
    // Cave paint, faint on the back wall: a handprint, a mammoth and an Ooga.
    b.fillStyle = "#28180e";
    for (const [x, y, w, h] of [[18, 70, 4, 4], [18, 67, 1, 3], [19, 66, 1, 4], [20, 66, 1, 4], [21, 67, 1, 3], [22, 71, 2, 1],
      [60, 74, 14, 6], [72, 71, 5, 5], [76, 75, 1, 5], [77, 79, 1, 1], [61, 80, 2, 4], [65, 80, 2, 4], [69, 80, 2, 4], [72, 80, 2, 4], [61, 72, 1, 2],
      [131, 62, 3, 3], [132, 65, 1, 6], [129, 66, 7, 1], [131, 71, 1, 4], [133, 71, 1, 4]]) b.fillRect(x, y, w, h);
    // The quarry's rock walls either side, their inner faces dark, and a torch on each.
    for (let y = BK_TOP; y < BK_GROUND; y++) for (let x = 0; x < W; x++) {
      if (x >= BK_L && x < BK_R) continue;
      b.fillStyle = x === BK_L - 1 || x === BK_R ? "#1e1b18" : rand() < 0.22 ? "#3a3530" : "#2a2622";
      b.fillRect(x, y, 1, 1);
    }
    b.fillStyle = INK.huskDk; b.fillRect(BK_L, 62, 3, 1); b.fillRect(BK_R - 3, 62, 3, 1);
    b.fillStyle = INK.husk; b.fillRect(BK_L + 1, 63, 1, 4); b.fillRect(BK_R - 2, 63, 1, 4);
    b.fillStyle = INK.band; b.fillRect(0, 0, W, BK_TOP - 1);
    b.fillStyle = INK.rule; b.fillRect(0, BK_TOP - 1, W, 1);
    b.fillStyle = INK.earth; b.fillRect(0, BK_GROUND, W, H - BK_GROUND);
    b.fillStyle = INK.earthDk; b.fillRect(0, BK_GROUND + 2, W, 1);
    for (let x = 0; x < W; x += 3) { b.fillStyle = x % 2 ? INK.moss : INK.leaf; b.fillRect(x, BK_GROUND, 2, 1); if (x % 9 === 0) b.fillRect(x + 1, BK_GROUND - 1, 1, 1); }
    // The rock mass the wall hangs from, strata and flecks over dark stone, its underside ragged; its foot is drawn
    // on the wall's top, so it slides down with it.
    const rock = canvasOf(W, BK_ROCK_H), k = rock.getContext("2d");
    k.fillStyle = "#34302c"; k.fillRect(0, 0, W, BK_ROCK_H);
    k.fillStyle = "#2a2622";
    for (let y = 2; y < BK_ROCK_H; y += 5 + Math.floor(rand() * 4)) for (let x = 0; x < W; x++) if (rand() < 0.7) k.fillRect(x, y + (rand() < 0.15 ? 1 : 0), 1, 1);
    for (let n = 0; n < 480; n++) { k.fillStyle = rand() < 0.5 ? "#46403a" : "#221e1a"; k.fillRect(Math.floor(rand() * W), Math.floor(rand() * BK_ROCK_H), rand() < 0.3 ? 2 : 1, 1); }
    k.fillStyle = "#1c1916"; k.fillRect(0, BK_ROCK_H - 1, W, 1);
    for (let x = 0; x < W; x++) if (rand() < 0.35) { const d = 1 + Math.floor(rand() * 2); k.fillRect(x, BK_ROCK_H - 1 - d, 1, d); }
    const log = (w, tusk) => {
      const c = canvasOf(w, 4), x = c.getContext("2d");
      x.fillStyle = INK.husk; x.fillRect(0, 1, w, 2);
      x.fillStyle = "#b07a44"; x.fillRect(1, 0, w - 2, 1);
      x.fillStyle = INK.huskDk; x.fillRect(1, 3, w - 2, 1);
      x.fillStyle = "#6b4a26"; for (let n = 4; n < w - 5; n += 6) x.fillRect(n, 1 + (n >> 1 & 1), 2, 1);
      x.fillStyle = "#c89a5a"; x.fillRect(0, 1, 1, 2); x.fillRect(w - 1, 1, 1, 2);
      if (tusk) { x.fillStyle = INK.bone; x.fillRect(0, 0, 5, 2); x.fillRect(w - 5, 0, 5, 2); x.fillStyle = "#c8bca0"; x.fillRect(0, 2, 4, 1); x.fillRect(w - 4, 2, 4, 1); }
      return { canvas: c, w, h: 4 };
    };
    const I = BK_INKS, T = BK_BRICK, icons = BK_ICONS.map((rows) => rows && sprite(rows, BK_ICON_INKS));
    const tablet = (kind, lit) => {
      const c = canvasOf(9, 9), x = c.getContext("2d");
      x.fillStyle = "#1a1410"; x.fillRect(1, 1, 7, 7);
      x.fillStyle = lit ? INK.white : BK_RIMS[kind];
      x.fillRect(1, 0, 7, 1); x.fillRect(1, 8, 7, 1); x.fillRect(0, 1, 1, 7); x.fillRect(8, 1, 1, 7);
      x.drawImage(icons[kind].canvas, 1, 1);
      return { canvas: c, w: 9, h: 9 };
    };
    const hotInks = { C: INK.ember, c: INK.banana, k: INK.red };
    bkArt = {
      back, rock, icons, log: log(BK_LOG_W, false), wide: log(BK_WIDE_W, true),
      bricks: [null, [sprite(T.stone, I.stone)], [sprite(T.rock, I.rock), sprite(T.rock1, I.rock)], [sprite(T.granite, I.granite), sprite(T.granite1, I.granite), sprite(T.granite2, I.granite)],
        I.ember.map((inks) => sprite(T.ember, inks)), [sprite(T.banana, BK_ORE)], I.ore.map((inks) => sprite(T.crystal, inks)), [sprite(T.bone, I.bone)]],
      hot: [NUT_ROWS, quarter(NUT_ROWS), quarter(quarter(NUT_ROWS)), quarter(quarter(quarter(NUT_ROWS)))].map((r) => sprite(r, hotInks)),
      drops: [null, 1, 2, 3, 4].map((kind) => kind && [tablet(kind, false), tablet(kind, true)])
    };
    return bkArt;
  };

  const breaker = (host) => {
    const out = hooks(host), aim = out.aim, status = makeStatus("Coconuts"), inv = invadersArt(), art = breakerArt(), R = rng(), J = juice(host);
    const fx = sparks(220, BK_SPARKS, 120);
    // The rock face: each cell's kind, hits left, hit flash and, for a lit ember, its fuse.
    const KIND = new Uint8Array(BK_N), HP = new Uint8Array(BK_N), FLASH = new Float32Array(BK_N), FUSE = new Float32Array(BK_N);
    // The coconuts (up to three in the air, each with its speed and how many rocks it still bursts through), their
    // trails, the falling pickups, the score numbers floating up and the burst rings.
    const B = { alive: new Uint8Array(BK_BALLS), pierce: new Uint8Array(BK_BALLS), x: new Float32Array(BK_BALLS), y: new Float32Array(BK_BALLS),
      vx: new Float32Array(BK_BALLS), vy: new Float32Array(BK_BALLS), sp: new Float32Array(BK_BALLS) };
    const TR = { x: new Float32Array(BK_BALLS * BK_TRAIL), y: new Float32Array(BK_BALLS * BK_TRAIL), head: 0 };
    const D = { kind: new Uint8Array(BK_DROPS), x: new Float32Array(BK_DROPS), y: new Float32Array(BK_DROPS), t: new Float32Array(BK_DROPS) };
    const POPS = 8, PN = { value: new Int32Array(POPS), x: new Float32Array(POPS), y: new Float32Array(POPS), t: new Float32Array(POPS), next: 0 };
    const RINGS = 8, RG = { x: new Float32Array(RINGS), y: new Float32Array(RINGS), t: new Float32Array(RINGS), size: new Float32Array(RINGS), next: 0 };
    // The run on one object, so a frame's writes change it in place: the log (`lx`, `lw`, its `vel`, `walk` for the
    // Ooga's step, `swing` the smash window a press opens and `cool` before the next, `lift` and `bump` its jolts,
    // `late` the moment after a plain catch a press still smashes, for `lateBall` at offset `lateO`, putting back
    // `lateChain`), the coconut riding the log before a launch (`stick`, `auto`), the rock (`fy` its top, `bottom` its
    // foot, `creepT` to its next creep, which comes sooner each time, `creepEvery`), the coconut's `tempo`, the wall
    // and its clock, the chain, the powers' seconds, the phase `timer`, the pterodactyl, and the run's tally.
    const S = { lx: W / 2, lw: BK_LOG_W, vel: 0, walk: 0, swing: 0, lift: 0, bump: 0, cool: 0, late: 0, lateBall: 0, lateO: 0, lateChain: 0, stick: 0, auto: 0,
      fy: BK_WALL_Y, bottom: 0, creepT: 0, creepEvery: 0, tempo: 0, wall: 1, wallT: 0, intro: 0, left: 0, lives: BK_LIVES, extra: 0, chain: 0, bestChain: 0, tusk: 0, fire: 0,
      timer: 0, sfx: 0, boom: 0, boomed: 0, blast: 0, blastPts: 0, warned: 0, caved: 0, pt: 0, px: 0, py: 0, pt0: 0, pdir: 1, pwalk: 0, ptT: 0, looseT: 0, smashT: 0, smashX: 0, bonus: 0,
      clock: 0, demo: 0, cleared: 0, smashes: 0, pteros: 0, won: 0, seed: 0 };
    let phase = "idle";
    const ring = (x, y, size) => { const i = RG.next; RG.next = (i + 1) % RINGS; RG.x[i] = x; RG.y[i] = y; RG.t[i] = 0.001; RG.size[i] = size; };
    // A score number floating up; one landing on a fresh one nearby adds to it instead, so a burst rolls one number up.
    const pop = (x, y, value) => {
      for (let k = 0; k < POPS; k++) if (PN.t[k] > 0 && PN.t[k] < 0.35 && Math.abs(PN.x[k] - x) < 14 && Math.abs(PN.y[k] - PN.t[k] * 14 - y) < 10) { PN.value[k] += value; PN.t[k] = 0.001; return; }
      const i = PN.next; PN.next = (i + 1) % POPS; PN.value[i] = value; PN.x[i] = x; PN.y[i] = y; PN.t[i] = 0.001;
    };
    // A rock's sound, at most one every few steps, so a blast through a dozen rocks is one crack and not a dozen.
    const sound = (name, gain) => { if (S.sfx > 0) return; S.sfx = 0.035; out.cue(name, gain); };
    const setVerb = () => { status.verb = phase === "ready" ? "Launch!" : phase === "play" ? "Smash!" : ""; };
    const addScore = (n) => {
      status.score += n;
      if (!S.extra && status.score >= BK_EXTRA_AT) { S.extra = 1; S.lives++; status.left = S.lives; out.popup(BK_SAY.extra, false); out.cue("coin"); }
    };
    // Rocks broken since the coconut last met the log without a smash; `quiet` sets it with no fanfare.
    const setChain = (n, quiet) => {
      const was = status.mult;
      S.chain = n; status.streak = n;
      status.mult = n >= 20 ? 5 : n >= 15 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : 1;
      if (n > S.bestChain) S.bestChain = n;
      if (quiet || status.mult <= was) return;
      out.popup(BK_SAY.chain[status.mult], status.mult >= 4);
      out.cue("score");
      if (status.mult >= 4) out.crack(status.mult === 5);
    };
    // The first pixel row under the rock's lowest block.
    const lowest = () => {
      for (let r = BK_ROWS - 1; r >= 0; r--) for (let c = 0; c < BK_COLS; c++) if (KIND[r * BK_COLS + c]) return S.fy + r * BK_PY + BK_BH;
      return S.fy;
    };
    const drop = (kind, x, y) => {
      for (let d = 0; d < BK_DROPS; d++) if (!D.kind[d]) { D.kind[d] = kind; D.x[d] = Math.max(BK_L + 5, Math.min(BK_R - 5, x)); D.y[d] = y; D.t[d] = 0; return; }
    };
    const power = () => { const u = R.next(); return u < 0.36 ? BK_P_TRIPLE : u < 0.7 ? BK_P_TUSK : BK_P_FIRE; };
    // A rock broken: its points times the chain's multiplier, chips, a number, what it drops, and an ember's blast.
    const destroy = (k) => {
      const kind = KIND[k], r = Math.floor(k / BK_COLS), c = k - r * BK_COLS, cx = BK_X0 + c * BK_PX + BK_BW / 2, cy = S.fy + r * BK_PY + BK_BH / 2;
      KIND[k] = 0; HP[k] = 0; FUSE[k] = 0;
      if (kind !== BK_BONE) S.left--;
      S.tempo = Math.min(BK_WALLS[S.wall - 1].speed + BK_TEMPO_MAX, S.tempo + BK_TEMPO_UP);
      setChain(S.chain + 1);
      const pts = BK_PTS[kind] * status.mult;
      addScore(pts);
      if (S.blast) S.blastPts += pts;
      else pop(cx, cy - 3, pts);
      fx.spawn(cx, cy, kind === BK_EMBER ? 16 : 9, kind === BK_EMBER ? 75 : 45, BK_S_OF[kind], BK_S_OF[kind] + 1, 0.5);
      if (kind === BK_BANANA) drop(BK_P_BANANA, cx, cy);
      else if (kind === BK_CRYSTAL) drop(power(), cx, cy);
      if (kind === BK_EMBER) explode(r, c, cx, cy);
      else sound(kind === BK_BONE ? "clang" : "bonk");
    };
    // An ember's blast breaks every rock round it (bone too) and lights the embers beside it, which go a beat later;
    // what it broke pays as one number.
    const explode = (r, c, cx, cy) => {
      S.boom++;
      ring(cx, cy, 13);
      fx.spawn(cx, cy, 10, 60, BK_S_EMBER, BK_S_EMBER + 1, 0.6);
      J.shake(2.5); J.flash(INK.ember, 0.22);
      S.sfx = 0; sound("slam", 0.6);
      S.blast = 1; S.blastPts = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr === 0 && dc === 0) || rr < 0 || rr >= BK_ROWS || cc < 0 || cc >= BK_COLS) continue;
        const n = rr * BK_COLS + cc;
        if (!KIND[n]) continue;
        if (KIND[n] === BK_EMBER) { if (FUSE[n] <= 0) FUSE[n] = BK_FUSE; }
        else destroy(n);
      }
      S.blast = 0;
      if (S.blastPts) pop(cx, cy + 2, S.blastPts);
      if (S.boom >= 3 && !S.boomed) { S.boomed = 1; out.popup(BK_SAY.boom, true); out.crack(true); out.shake(0.5); }
    };
    // Coconut `i` meets rock `k`: a hot or fire coconut bursts through it; otherwise it takes a hit (bone none) and the
    // coconut bounces. Returns whether it bounces.
    const hit = (k, i) => {
      const kind = KIND[k];
      if (S.fire > 0 || B.pierce[i] > 0) {
        if (S.fire <= 0) B.pierce[i]--;
        destroy(k);
        return 0;
      }
      if (kind !== BK_BONE && (HP[k] <= 1 || FUSE[k] > 0)) { destroy(k); return 1; }
      FLASH[k] = 0.1;
      const r = Math.floor(k / BK_COLS), cx = BK_X0 + (k - r * BK_COLS) * BK_PX + BK_BW / 2, cy = S.fy + r * BK_PY + BK_BH / 2;
      if (kind === BK_BONE) { fx.spawn(cx, cy, 3, 25, BK_S_BONE, BK_S_BONE + 1, 0.3); sound("clack", 0.7); return 1; }
      HP[k]--;
      fx.spawn(cx, cy, 4, 30, BK_S_OF[kind], BK_S_OF[kind] + 1, 0.35);
      sound("thunk");
      return 1;
    };
    // The rocks coconut `i`'s box overlaps, each hit; whether it bounces off any.
    const strike = (i) => {
      const x = B.x[i], y = B.y[i];
      const c0 = Math.max(0, Math.floor((x - BK_BALL - BK_X0) / BK_PX)), c1 = Math.min(BK_COLS - 1, Math.floor((x + BK_BALL - 0.01 - BK_X0) / BK_PX));
      const r0 = Math.max(0, Math.floor((y - BK_BALL - S.fy) / BK_PY)), r1 = Math.min(BK_ROWS - 1, Math.floor((y + BK_BALL - 0.01 - S.fy) / BK_PY));
      let bounce = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = r * BK_COLS + c; if (KIND[k] && hit(k, i)) bounce = 1; }
      return bounce;
    };
    // Up at angle `a` from straight up (plus a touch of the seeded draw, so no path repeats) at speed `sp`.
    const angleTo = (i, a, sp) => {
      a += (R.next() - 0.5) * BK_JITTER;
      B.sp[i] = sp; B.vx[i] = sp * Math.sin(a); B.vy[i] = -sp * Math.cos(a);
    };
    // Off the log at `o` (-1 its left end, 1 its right): never straight up, so a coconut caught in the middle keeps
    // going the way it came at the shallowest angle and the ends send it wide; `k` steepens a smash.
    const launchAt = (i, o, sp, k) => {
      const side = Math.abs(o) < 0.08 ? (B.vx[i] < 0 ? -1 : 1) : o < 0 ? -1 : 1;
      angleTo(i, side * (BK_ANGLE_MIN + Math.abs(o) * (BK_ANGLE - BK_ANGLE_MIN)) * k, sp);
    };
    const smash = (i, o) => {
      S.swing = 0; S.smashes++; S.cool = Math.min(S.cool, BK_COOL_HIT);
      launchAt(i, o, Math.min(BK_SPEED_MAX, S.tempo * BK_SMASH_K), 0.75);
      B.pierce[i] = BK_PIERCE;
      S.smashT = 0.5; S.smashX = B.x[i]; S.bump = 0.1;
      fx.spawn(B.x[i], BK_LOG_Y - 1, 12, 65, BK_S_EMBER, BK_S_EMBER + 1, 0.4);
      ring(B.x[i], BK_LOG_Y - 1, 7);
      J.shake(1.5);
      out.cue("clang");
    };
    // The coconut lands on the log: a smash if a press is swinging it, else a plain bounce that ends the chain, which
    // a press in the next moment can still turn into a smash.
    const catchBall = (i) => {
      const o = Math.max(-1, Math.min(1, (B.x[i] - S.lx) / (S.lw / 2 + BK_BALL)));
      B.y[i] = BK_LOG_Y - BK_BALL;
      B.pierce[i] = 0;
      S.boom = S.boomed = 0;
      if (S.swing > 0) { smash(i, o); return; }
      S.late = BK_LATE; S.lateBall = i; S.lateO = o; S.lateChain = S.chain;
      launchAt(i, o, S.tempo, 1);
      setChain(0, true);
      S.bump = 0.08;
      out.cue("tap", 0.55);
    };
    const bonkPtero = (i) => {
      S.pt = 0; S.pteros++; S.ptT = 14 + R.next() * 8;
      B.vy[i] = -B.vy[i];
      setChain(S.chain + 1);
      const pts = BK_PTERO_PAYS * status.mult, cx = S.px + 6.5, cy = S.py + 3.5;
      addScore(pts);
      pop(cx, cy - 4, pts);
      drop(power(), cx, cy);
      fx.spawn(cx, cy, 26, 80, BK_S_PTERO, BK_S_PTERO + 1, 0.8);
      ring(cx, cy, 16);
      J.shake(3); J.flash(INK.violet, 0.3);
      out.popup(BK_SAY.ptero(pts), true); out.cue("big"); out.crack(true);
    };
    // A coconut gone past the log splits on the ground; the last one in the air costs a coconut.
    const lose = (i) => {
      B.alive[i] = 0; B.pierce[i] = 0;
      fx.spawn(B.x[i], BK_GROUND - 1, 14, 55, BK_S_MILK, BK_S_HUSK, 0.6);
      out.cue("miss");
      for (let k = 0; k < BK_BALLS; k++) if (B.alive[k]) return;
      S.lives--; status.left = S.lives;
      J.shake(3); J.flash(INK.red, 0.4);
      out.shake(0.5); out.cue("fall"); out.flop();
      out.popup(S.lives > 0 ? BK_SAY.lost : BK_SAY.last, S.lives <= 0);
      setChain(0, true);
      S.fire = S.tusk = 0; S.lw = BK_LOG_W; status.fire = false;
      D.kind.fill(0);
      S.tempo = BK_WALLS[S.wall - 1].speed;
      phase = S.lives > 0 ? "lost" : "over";
      S.timer = S.lives > 0 ? BK_LOST_S : BK_OVER_S;
      if (S.lives <= 0) out.over();
      setVerb();
    };
    const stepBall = (i, h) => {
      B.x[i] += B.vx[i] * h;
      if (B.x[i] < BK_L + BK_BALL) { B.x[i] = BK_L + BK_BALL; B.vx[i] = Math.abs(B.vx[i]); }
      else if (B.x[i] > BK_R - BK_BALL) { B.x[i] = BK_R - BK_BALL; B.vx[i] = -Math.abs(B.vx[i]); }
      if (strike(i)) { B.x[i] -= B.vx[i] * h; B.vx[i] = -B.vx[i]; }
      const y0 = B.y[i];
      B.y[i] += B.vy[i] * h;
      if (B.y[i] < S.fy + BK_BALL) { B.y[i] = S.fy + BK_BALL; B.vy[i] = Math.abs(B.vy[i]); fx.spawn(B.x[i], S.fy, 2, 16, BK_S_DUST, BK_S_DUST + 1, 0.3); }
      if (strike(i)) { B.y[i] -= B.vy[i] * h; B.vy[i] = -B.vy[i]; }
      if (!B.alive[i]) return;
      if (B.vy[i] > 0 && B.y[i] + BK_BALL >= BK_LOG_Y && y0 + BK_BALL < BK_LOG_Y + 2 && Math.abs(B.x[i] - S.lx) <= S.lw / 2 + BK_BALL) catchBall(i);
      else if (B.y[i] > BK_FLOOR) lose(i);
      else if (S.pt && B.x[i] + BK_BALL > S.px && B.x[i] - BK_BALL < S.px + 13 && B.y[i] + BK_BALL > S.py && B.y[i] - BK_BALL < S.py + 7) bonkPtero(i);
    };
    // Every coconut in the air throws two more a little either side of it, three in all.
    const split = () => {
      let src = -1;
      for (let i = 0; i < BK_BALLS; i++) if (B.alive[i]) { src = i; break; }
      if (src < 0) return;
      for (let i = 0, side = 1; i < BK_BALLS; i++) {
        if (B.alive[i]) continue;
        const a = side * 0.4, c = Math.cos(a), s = Math.sin(a), sp = B.sp[src];
        B.alive[i] = 1; B.pierce[i] = B.pierce[src]; B.x[i] = B.x[src]; B.y[i] = B.y[src]; B.sp[i] = sp;
        B.vx[i] = B.vx[src] * c - B.vy[src] * s; B.vy[i] = B.vx[src] * s + B.vy[src] * c;
        if (Math.abs(B.vy[i]) < sp * 0.45) { B.vy[i] = (B.vy[i] < 0 ? -0.45 : 0.45) * sp; B.vx[i] = (B.vx[i] < 0 ? -0.89 : 0.89) * sp; }
        for (let n = 0; n < BK_TRAIL; n++) { TR.x[i * BK_TRAIL + n] = B.x[i]; TR.y[i * BK_TRAIL + n] = B.y[i]; }
        side = -side;
      }
    };
    const take = (kind, x) => {
      if (kind === BK_P_BANANA) {
        const pts = BK_BANANA_PAYS * status.mult;
        addScore(pts); pop(x, BK_LOG_Y - 10, pts);
        fx.spawn(x, BK_LOG_Y - 2, 14, 55, BK_S_BANANA, BK_S_BANANA + 1, 0.5);
        out.cue("coin");
        return;
      }
      if (kind === BK_P_TUSK) { S.tusk = BK_TUSK_S; S.lw = BK_WIDE_W; out.popup(BK_SAY.tusk, false); out.cue("ding"); }
      else if (kind === BK_P_TRIPLE) { split(); out.popup(BK_SAY.triple, false); out.cue("spit"); }
      else { S.fire = BK_FIRE_S; status.fire = true; out.popup(BK_SAY.fire, false); out.cue("fire"); J.flash(INK.ember, 0.25); }
      fx.spawn(x, BK_LOG_Y - 2, 12, 50, kind === BK_P_FIRE ? BK_S_EMBER : BK_S_BONE, kind === BK_P_FIRE ? BK_S_EMBER + 1 : BK_S_MILK, 0.5);
    };
    const stepDrops = (h) => {
      for (let d = 0; d < BK_DROPS; d++) {
        if (!D.kind[d]) continue;
        D.t[d] += h; D.y[d] += BK_FALL * h;
        if (D.y[d] + 4 >= BK_LOG_Y && D.y[d] - 4 <= BK_LOG_Y + 3 && Math.abs(D.x[d] - S.lx) <= S.lw / 2 + 4) { take(D.kind[d], D.x[d]); D.kind[d] = 0; }
        else if (D.y[d] > BK_GROUND + 4) D.kind[d] = 0;
      }
    };
    // Now and then a pterodactyl glides across under the rock, bobbing, where there is room for it.
    const stepPtero = (h) => {
      if (!S.pt) {
        S.ptT -= h;
        if (S.ptT > 0) return;
        S.ptT = 14 + R.next() * 8;
        const room = BK_DANGER - 8 - S.bottom;
        if (room < 14) return;
        S.pt = 1; S.pdir = R.chance(0.5) ? 1 : -1; S.px = S.pdir > 0 ? -14 : W + 1; S.pt0 = S.bottom + 5 + R.next() * (room - 12); S.pwalk = 0;
        out.cue("chirp");
        return;
      }
      S.pwalk += h;
      S.px += S.pdir * BK_PTERO_V * h;
      S.pt0 = Math.max(S.pt0, S.bottom + 5);
      S.py = S.pt0 + Math.sin(S.pwalk * 3) * 3;
      if (S.px < -16 || S.px > W + 3) S.pt = 0;
    };
    // The rock creeps down a notch on a rumble; a coconut it comes down on is knocked below it.
    const creep = () => {
      S.fy += BK_CREEP;
      for (let i = 0; i < BK_BALLS; i++) {
        if (!B.alive[i]) continue;
        if (B.y[i] < S.fy + BK_BALL) { B.y[i] = S.fy + BK_BALL; B.vy[i] = Math.abs(B.vy[i]); }
        if (strike(i)) { B.y[i] = S.fy + (Math.floor((B.y[i] - S.fy) / BK_PY) + 1) * BK_PY + BK_BALL; B.vy[i] = Math.abs(B.vy[i]); }
      }
      J.shake(1.2);
      out.cue("knock", 0.45);
      for (let n = 0; n < 4; n++) fx.spawn(BK_L + Math.random() * (BK_R - BK_L), S.fy, 2, 14, BK_S_DUST, BK_S_DUST + 1, 0.5);
    };
    const caveIn = () => {
      S.caved = 1;
      B.alive.fill(0); D.kind.fill(0); S.pt = 0;
      J.shake(6); J.flash(INK.red, 0.6);
      out.shake(1); out.cue("slam"); out.flop();
      out.popup(BK_SAY.caved, true);
      phase = "over"; S.timer = BK_OVER_S + 0.5;
      out.over();
      setVerb();
    };
    const ready = () => {
      B.alive.fill(0); B.pierce.fill(0);
      B.alive[0] = 1; B.x[0] = S.lx; B.y[0] = BK_LOG_Y - BK_BALL; S.auto = BK_AUTO;
      phase = "ready";
      setVerb();
    };
    const startWall = (w) => {
      const L = BK_WALLS[w - 1];
      S.wall = w; status.round = w;
      KIND.set(L.cells);
      for (let k = 0; k < BK_N; k++) HP[k] = BK_HP[KIND[k]];
      FLASH.fill(0); FUSE.fill(0); D.kind.fill(0);
      S.left = L.left; S.fy = BK_WALL_Y; S.creepT = S.creepEvery = L.creep; S.tempo = L.speed; S.wallT = 0; S.warned = 0; S.pt = 0; S.ptT = 8 + R.next() * 6; S.looseT = BK_LOOSE_S;
      S.fire = S.tusk = 0; S.lw = BK_LOG_W; status.fire = false; S.intro = 1.4;
      S.bottom = lowest();
      ready();
      out.popup(BK_SAY.wall[w], w === BK_WALLS.length);
    };
    const wallCleared = () => {
      S.cleared++;
      const quick = Math.max(0, Math.round(BK_WALLS[S.wall - 1].par - S.wallT)) * 10, bonus = 250 * S.wall + quick;
      addScore(bonus);
      S.bonus = bonus;
      for (let k = 0; k < BK_N; k++) if (KIND[k]) { const r = Math.floor(k / BK_COLS); fx.spawn(BK_X0 + (k - r * BK_COLS) * BK_PX + 5, S.fy + r * BK_PY + 2, 5, 40, BK_S_BONE, BK_S_BONE + 1, 0.5); KIND[k] = 0; }
      for (let i = 0; i < BK_BALLS; i++) if (B.alive[i]) { fx.spawn(B.x[i], B.y[i], 8, 40, BK_S_MILK, BK_S_BANANA, 0.5); B.alive[i] = 0; }
      D.kind.fill(0); S.pt = 0; S.fire = 0; status.fire = false;
      out.crack(true);
      J.flash(INK.teal, 0.35);
      if (S.wall >= BK_WALLS.length) {
        const won = 1000 + 500 * S.lives;
        addScore(won);
        S.won = 1;
        out.popup(BK_SAY.won(bonus + won), true);
        out.cue("win"); out.over();
        phase = "won"; S.timer = BK_OVER_S + 0.6;
      } else {
        out.popup(BK_SAY.clear(bonus), true);
        out.cue("round");
        phase = "clear"; S.timer = BK_CLEAR_S;
      }
      setVerb();
    };
    const finish = () => {
      phase = "done";
      setVerb();
      status.note = `Walls ${S.cleared}/${BK_WALLS.length} · best chain ${S.bestChain} · smashes ${S.smashes}`;
      out.cue(S.won ? "big" : "buzzer");
      out.onEnd(status.score);
    };
    // Launch the coconut riding the log: up and away to the side the log is moving, or either side from still.
    const launch = () => {
      const side = S.vel > 20 ? 1 : S.vel < -20 ? -1 : R.chance(0.5) ? 1 : -1;
      angleTo(0, side * (0.42 + R.next() * 0.17), S.tempo);
      S.boom = S.boomed = 0; S.cool = 0.2;
      phase = "play";
      setVerb();
      out.cue("throw");
    };
    // Space: launches from the log, else swings it up for a smash (or smashes the coconut that just left it); a swing
    // that meets nothing leaves the log heavy for a moment and drops the chain, so mashing pays far less than timing.
    const act = () => {
      if (phase === "ready") { launch(); return; }
      if (phase !== "play" || S.cool > 0) return;
      S.cool = BK_COOL; S.lift = 0.12;
      if (S.late > 0 && B.alive[S.lateBall] && B.vy[S.lateBall] < 0) { S.late = 0; setChain(S.lateChain, true); smash(S.lateBall, S.lateO); return; }
      S.swing = BK_SWING;
      out.cue("swish", 0.4);
    };
    const step = (h) => {
      S.cool = Math.max(0, S.cool - h); S.late = Math.max(0, S.late - h); S.sfx = Math.max(0, S.sfx - h);
      // A swing that meets nothing drops the chain: only a smash keeps it going.
      if (S.swing > 0 && (S.swing -= h) <= 0) { S.swing = 0; if (S.chain >= 5) out.flop(); setChain(0, true); }
      if (S.tusk > 0 && (S.tusk -= h) <= 0) { S.tusk = 0; S.lw = BK_LOG_W; out.cue("tick"); }
      if (S.fire > 0 && (S.fire -= h) <= 0) { S.fire = 0; status.fire = false; }
      if (!S.caved) {
        const half = S.lw / 2, want = Math.max(BK_L + half, Math.min(BK_R - half, W / 2 + aim.x * BK_REACH));
        const dx = Math.max(-BK_LOG_SPEED * h, Math.min(BK_LOG_SPEED * h, want - S.lx));
        S.lx += dx; S.vel = dx / h;
        if (Math.abs(dx) > 0.05) S.walk += h;
      }
      if (phase === "ready") {
        S.intro = Math.max(0, S.intro - h);
        S.stick = Math.sin(S.clock * 2.6) * (S.lw / 2 - 4);
        B.x[0] = S.lx + S.stick; B.y[0] = BK_LOG_Y - BK_BALL;
        if ((S.auto -= h) <= 0) launch();
      } else if (phase === "play") {
        S.wallT += h;
        for (let k = 0; k < BK_N; k++) if (FUSE[k] > 0 && (FUSE[k] -= h) <= 0 && KIND[k] === BK_EMBER) destroy(k);
        // The wall's last few rocks shake loose and fall out one by one, so no wall ends on a hunt for one rock.
        if (S.left <= BK_LOOSE && (S.looseT -= h) <= 0) {
          S.looseT = BK_LOOSE_EVERY;
          for (let k = BK_N - 1; k >= 0; k--) if (KIND[k] && KIND[k] !== BK_BONE) { destroy(k); out.cue("knock", 0.5); break; }
        }
        for (let i = 0; i < BK_BALLS; i++) {
          if (B.alive[i]) stepBall(i, h);
          if (phase !== "play") return;
        }
        stepDrops(h);
        S.bottom = lowest();
        stepPtero(h);
        if (S.left <= 0) { wallCleared(); return; }
        if ((S.creepT -= h) <= 0) { S.creepEvery = Math.max(BK_CREEP_MIN, S.creepEvery * BK_CREEP_K); S.creepT += S.creepEvery; creep(); S.bottom = lowest(); }
        if (S.bottom >= BK_DANGER) caveIn();
        else if (S.bottom >= BK_DANGER - BK_WARN && !S.warned) { S.warned = 1; out.popup(BK_SAY.warn, true); out.cue("count"); }
      } else if (phase === "lost") {
        S.timer -= h;
        if (S.timer <= 0) ready();
      } else if (phase === "clear") {
        S.timer -= h;
        if (S.timer <= 0) startWall(S.wall + 1);
      } else if (phase === "over" || phase === "won") {
        // A cave-in brings the rock down onto the Ooga, and dust up where it lands.
        if (S.caved === 1) {
          S.fy += 90 * h; S.bottom = lowest();
          if (S.bottom >= BK_GROUND) { S.caved = 2; J.shake(5); out.cue("slam", 0.7); for (let x = BK_L + 4; x < BK_R; x += 10) fx.spawn(x, BK_GROUND - 1, 3, 30, BK_S_DUST, BK_S_DUST + 1, 0.7); }
        }
        S.timer -= h;
        if (S.timer <= 0) finish();
      }
    };
    const run = stepper(step);
    // The attract screen's coconut: up and down between the log and a little wall, sweeping across.
    const DEMO = { x: 0, y: 0 };
    const demoAt = () => {
      const u = (S.clock / 1.3) % 1, s = (S.clock / 6.1) % 1;
      DEMO.x = 40 + 80 * (s < 0.5 ? s * 2 : 2 - s * 2);
      DEMO.y = 84 - 20 * (u < 0.5 ? u * 2 : 2 - u * 2);
    };

    // ---- drawing --------------------------------------------------------------------------------------------
    const torches = (ctx) => {
      for (let s = 0; s < 2; s++) {
        const x = s ? BK_R - 3 : BK_L, f = Math.floor(S.clock * 9 + s * 3);
        ctx.fillStyle = INK.ember; ctx.fillRect(x, 59 - (f & 1), 3, 3);
        ctx.fillStyle = INK.banana; ctx.fillRect(x + 1, 60, 1, 2);
        ctx.fillStyle = INK.red; ctx.fillRect(x + (f >> 1 & 1) * 2, 58 - (f & 1), 1, 1);
      }
    };
    const drawBricks = (ctx, fy) => {
      for (let k = 0; k < BK_N; k++) {
        const kind = KIND[k];
        if (!kind) continue;
        const r = Math.floor(k / BK_COLS), c = k - r * BK_COLS;
        const f = kind === 2 || kind === 3 ? BK_HP[kind] - HP[k] : kind === BK_EMBER ? Math.floor(S.clock * 3 + c * 0.7 + r * 0.5) & 1 : kind === BK_CRYSTAL ? ((S.clock * 1.5 + k * 0.37) % 2 < 0.3 ? 0 : 1) : 0;
        ctx.drawImage(art.bricks[kind][f].canvas, BK_X0 + c * BK_PX + (S.left <= BK_LOOSE && kind !== BK_BONE ? Math.floor(S.clock * 30 + k) & 1 : 0), fy + r * BK_PY);
      }
      ctx.fillStyle = INK.white;
      const blink = Math.floor(S.clock * 24) & 1;
      for (let k = 0; k < BK_N; k++) {
        if (!KIND[k] || !(FLASH[k] > 0 || (FUSE[k] > 0 && blink))) continue;
        const r = Math.floor(k / BK_COLS);
        ctx.fillRect(BK_X0 + (k - r * BK_COLS) * BK_PX, fy + r * BK_PY, BK_BW, BK_BH);
      }
    };
    const drawLog = (ctx) => {
      const lift = S.lift > 0 ? 2 : 0, bump = S.bump > 0 ? 1 : 0, lg = S.lw > BK_LOG_W ? art.wide : art.log, ooga = inv.ooga[2];
      ctx.drawImage(ooga.canvas, Math.round(S.lx - ooga.w / 2), BK_OOGA_Y - lift + bump + (S.vel !== 0 ? Math.floor(S.walk * 10) & 1 : 0));
      ctx.drawImage(lg.canvas, Math.round(S.lx - lg.w / 2), BK_LOG_Y - lift + bump);
    };
    const drawBalls = (ctx) => {
      for (let i = 0; i < BK_BALLS; i++) {
        if (!B.alive[i]) continue;
        const hot = phase === "play" && (S.fire > 0 || B.pierce[i] > 0);
        if (hot) for (let n = 1; n < BK_TRAIL; n++) {
          const j = i * BK_TRAIL + (TR.head + BK_TRAIL - n) % BK_TRAIL;
          ctx.fillStyle = n < 3 ? INK.banana : n < 5 ? INK.ember : INK.red;
          ctx.fillRect(Math.round(TR.x[j]) - (n < 3 ? 1 : 0), Math.round(TR.y[j]) - (n < 3 ? 1 : 0), n < 3 ? 2 : 1, n < 3 ? 2 : 1);
        }
        const s = phase === "ready" ? inv.nut[0] : hot ? art.hot[Math.floor(S.clock * 16 + i) & 3] : inv.nut[Math.floor(S.clock * 10 + i) & 3];
        ctx.drawImage(s.canvas, Math.round(B.x[i] - 2), Math.round(B.y[i] - 2));
      }
    };
    const drawPlay = (ctx) => {
      J.begin(ctx);
      const fy = Math.floor(S.fy), hgt = Math.min(BK_ROCK_H, fy - BK_TOP);
      if (hgt > 0) ctx.drawImage(art.rock, 0, BK_ROCK_H - hgt, W, hgt, 0, fy - hgt, W, hgt);
      const near = !S.caved && S.bottom >= BK_DANGER - BK_WARN;
      ctx.fillStyle = near && Math.floor(S.clock * 6) & 1 ? INK.red : INK.rust;
      for (let x = BK_L + 1; x < BK_R; x += 4) ctx.fillRect(x, BK_DANGER, 2, 1);
      drawBricks(ctx, fy);
      const lit = Math.floor(S.clock * 5) & 1;
      for (let d = 0; d < BK_DROPS; d++) if (D.kind[d]) ctx.drawImage(art.drops[D.kind[d]][lit].canvas, Math.round(D.x[d] - 4 + Math.sin(D.t[d] * 5) * 1.5), Math.round(D.y[d] - 4));
      if (S.pt) { const p = inv.kinds[0][Math.floor(S.pwalk * 6) & 1]; ctx.drawImage(p.canvas, Math.round(S.px), Math.round(S.py)); }
      if (!S.caved || S.bottom < BK_LOG_Y) drawLog(ctx);
      drawBalls(ctx);
      fx.draw(ctx);
      ctx.fillStyle = INK.cream;
      for (let i = 0; i < RINGS; i++) {
        if (RG.t[i] <= 0) continue;
        const r = 2 + RG.size[i] * RG.t[i] / 0.2;
        for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(RG.x[i] + COS8[k] * r), Math.round(RG.y[i] + SIN8[k] * r), 1, 1);
      }
      for (let i = 0; i < POPS; i++) if (PN.t[i] > 0 && (PN.t[i] < 0.6 || Math.floor(S.clock * 16) & 1)) number(ctx, PN.value[i], Math.round(PN.x[i]), Math.round(PN.y[i] - PN.t[i] * 14), TEXT.banana, 1, 1);
      if (S.smashT > 0) text(ctx, "SMASH!", Math.round(Math.max(BK_L + 1, Math.min(BK_R - 36, S.smashX - 17))), Math.round(BK_LOG_Y - 12 - (0.5 - S.smashT) * 16), TEXT.gold);
      J.end(ctx);
    };
    // The powers running, an icon each with the seconds left as a bar under it.
    const drawPower = (ctx, x, kind, left, full) => {
      ctx.drawImage(art.icons[kind].canvas, x, 0);
      ctx.fillStyle = BK_RIMS[kind];
      ctx.fillRect(x, BK_TOP - 1, Math.ceil(7 * left / full), 1);
    };
    const drawHud = (ctx) => {
      ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, BK_TOP - 1);
      number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
      if (status.mult > 1) { text(ctx, "X", 36, 1, TEXT.ember); number(ctx, status.mult, 42, 1, TEXT.ember); }
      text(ctx, "WALL", 58, 1, TEXT.stone);
      number(ctx, S.wall, 83, 1, TEXT.bone);
      if (S.tusk > 0) drawPower(ctx, 96, BK_P_TUSK, S.tusk, BK_TUSK_S);
      if (S.fire > 0) drawPower(ctx, 106, BK_P_FIRE, S.fire, BK_FIRE_S);
      for (let k = 0; k < S.lives && k < 5; k++) ctx.drawImage(inv.nut[0].canvas, W - 7 - k * 6, 2);
    };
    const drawBanner = (ctx) => {
      if (phase === "ready" && S.intro > 0) { centre(ctx, "WALL", 54, TEXT.ember, 2); number(ctx, S.wall, W / 2, 72, TEXT.bone, 2, 1); }
      else if (phase === "clear") { centre(ctx, "WALL DOWN!", 48, TEXT.teal, 2); centre(ctx, "BONUS", 66, TEXT.stone); number(ctx, S.bonus, W / 2, 76, TEXT.banana, 1, 1); }
      else if (phase === "over" && S.caved) centre(ctx, "CAVE-IN!", 50, TEXT.red, 2);
      else if (phase === "done") {
        ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, BK_TOP, W, BK_GROUND - BK_TOP); ctx.globalAlpha = 1;
        centre(ctx, S.won ? "ALL CLEAR!" : S.caved ? "CAVE-IN!" : "GAME OVER", 40, S.won ? TEXT.gold : TEXT.red, 2);
        centre(ctx, "SCORE", 62, TEXT.stone);
        number(ctx, status.score, W / 2, 72, TEXT.banana, 2, 1);
      }
    };
    const drawAttract = (ctx) => {
      centre(ctx, "ROCK", 12, TEXT.stone, 2);
      centre(ctx, "BREAKER", 30, TEXT.ember, 2);
      for (let k = 0; k < BK_DEMO.length; k++) ctx.drawImage(art.bricks[BK_DEMO[k]][BK_DEMO[k] === BK_EMBER ? Math.floor(S.clock * 3 + k) & 1 : 0].canvas, 32 + (k & 7) * BK_PX, 52 + (k >> 3) * BK_PY);
      demoAt();
      const ooga = inv.ooga[2];
      ctx.drawImage(ooga.canvas, Math.round(DEMO.x - ooga.w / 2), 89);
      ctx.drawImage(art.log.canvas, Math.round(DEMO.x - BK_LOG_W / 2), 86);
      ctx.drawImage(inv.nut[Math.floor(S.clock * 10) & 3].canvas, Math.round(DEMO.x - 2), Math.round(DEMO.y - 2));
      fx.draw(ctx);
      if (Math.floor(S.clock * 1.6) % 2) centre(ctx, "PRESS START", 104, TEXT.bone);
      text(ctx, "HI", 3, 1, TEXT.stone);
      number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
    };

    const reset = () => {
      KIND.fill(0); HP.fill(0); FLASH.fill(0); FUSE.fill(0); B.alive.fill(0); B.pierce.fill(0); D.kind.fill(0); PN.t.fill(0); RG.t.fill(0);
      fx.clear(); J.reset();
      S.lx = W / 2; S.lw = BK_LOG_W; S.vel = S.swing = S.cool = S.late = S.lift = S.bump = S.smashT = 0; S.tusk = S.fire = 0; S.caved = 0; S.pt = 0; S.fy = BK_WALL_Y;
      status.fire = false; status.meter = -1; status.target = 0; status.note = "";
      setChain(0, true);
    };
    reset();
    status.left = BK_LIVES;
    return {
      kind: "breaker", name: "Rock Breaker", aims: true, status,
      help: "The mouse, a drag, arrows or A and D move the log; Space, a click or Smash! launches, then smashes the coconut as it lands. Break the rock before it caves in.",
      coach: ["Mouse or A and D move, Space or click as it lands", "Drag to move, tap Smash! as it lands"],
      stars: [2500, 12000, 21000], tickets: (score) => Math.floor(score / 550),
      get playing() { return phase !== "idle" && phase !== "done"; },
      get seed() { return S.seed; },
      start: (seed) => {
        if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
        reset();
        status.score = 0; S.lives = BK_LIVES; status.left = BK_LIVES; S.extra = S.won = 0; S.bestChain = 0;
        S.cleared = S.smashes = S.pteros = 0;
        startWall(1);
      },
      stop: () => { phase = "idle"; reset(); S.wall = 1; status.round = 1; status.left = BK_LIVES; setVerb(); },
      act,
      update: (dt) => {
        S.clock += dt;
        J.update(dt);
        fx.update(dt);
        for (let i = 0; i < POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
        for (let i = 0; i < RINGS; i++) if (RG.t[i] > 0) { RG.t[i] += dt; if (RG.t[i] > 0.2) RG.t[i] = 0; }
        for (let k = 0; k < BK_N; k++) if (FLASH[k] > 0) FLASH[k] -= dt;
        S.lift = Math.max(0, S.lift - dt); S.bump = Math.max(0, S.bump - dt); S.smashT = Math.max(0, S.smashT - dt);
        if (phase === "idle") {
          // The attract's coconut chips the little wall at the top of each bounce.
          const n = Math.floor(S.clock / 1.3 + 0.5);
          if (n !== S.demo) { S.demo = n; demoAt(); fx.spawn(DEMO.x, 64, 6, 35, 0, 1, 0.35); }
        } else if (phase !== "done") run(dt);
        TR.head = (TR.head + 1) % BK_TRAIL;
        for (let i = 0; i < BK_BALLS; i++) { TR.x[i * BK_TRAIL + TR.head] = B.x[i]; TR.y[i * BK_TRAIL + TR.head] = B.y[i]; }
      },
      draw: (ctx) => {
        ctx.drawImage(art.back, 0, 0);
        torches(ctx);
        if (phase === "idle") { drawAttract(ctx); return; }
        drawPlay(ctx);
        drawHud(ctx);
        drawBanner(ctx);
      }
    };
  };

  // ---- Dino Dash ----------------------------------------------------------------------------------------------
  // An endless runner through four lands, each faster and busier than the last (the jungle at dawn, the badlands at
  // dusk, the volcano and the stampede by night, then round again): an Ooga rides a dino that runs on its own; act
  // jumps and a second press in the air jumps again. Cacti, bone piles and campfires are cleared; pterodactyls fly
  // low (jump them) or high (stay low under them, where bananas lie), and mammoths charge. A pterodactyl or a mammoth
  // landed on from above is stomped: the dino bounces off with its air jump back, and each stomp before it lands
  // again pays double the last. Every banana taken in a row builds the multiplier on everything (x2 from ten, x3
  // from twenty-five, x4 from fifty) and one let by breaks the row; once a land a golden coconut hangs high over the
  // path (an air jump reaches it) and sets the dino on fire, smashing through whatever it meets. Each land reached
  // pays a bonus and heals one bonk; a third bonk before then ends the run. Its constants and art are its own, in
  // this closure, so no name here meets another game's.
  const dash = (() => {
    // The ground's top, where the dino runs and its hit box (inset from the 20 x 18 sprite), and where bananas are
    // taken (the whole sprite and a pixel or two round it).
    const GROUND = 100, DINO_X = 20, DINO_H = 18, HIT_L = 4, HIT_R = 15, HIT_T = 15, TAKE_L = 0, TAKE_R = 21;
    // The run: speed in px/s from V0 up by ACCEL a second to MAX (at MAX_AT s), then by LATE a second up to TOP (a
    // start fast enough that a jump's window is never narrow: at a crawl an obstacle stays under the dino longer than
    // the jump's arc clears it); the jump (G_UP rising, G_DOWN falling, a heavier fall for a crisp arc), the air jump
    // and a stomp's bounce; how long a bonk leaves the dino untouchable and slowed; fire, a land's length, the pause
    // over the crash, the land's banner and how long the first waits for the Go callout to clear, a metre in px and
    // the score's cap, which ends the run as a win.
    const V0 = 92, ACCEL = 0.7, MAX = 165, LATE = 0.3, TOP = 205, MAX_AT = (MAX - V0) / ACCEL, G_UP = 470, G_DOWN = 760, JUMP_V = 160, AIR_V = 140, STOMP_V = 170, NEAR_GROUND = 14;
    const HEARTS = 3, HURT_S = 1.5, STUMBLE_S = 0.9, FIRE_S = 6, LAND_S = 30, OVER_S = 2, BANNER_S = 1.8, GO_S = 1.2, FADE_S = 1.2, METRE = 10, CAP = 99999;
    // A jump's top in px and an air jump's from a jump's top, the half-time of a jump's arc (for laying bananas on
    // it), how far apart two cacti in a row arrive (seconds), and how far into a land its golden coconut may come.
    const JUMP_TOP = 27, AIR_TOP = 46, AIR_HALF = 0.3, TWIN_S = 0.9, GOLD_AFTER = 10;
    const OBS = 12, PICKS = 24, POPS = 8, RINGS = 6, EMBERS = 10, STARS = 8, LINES = 5;
    // Obstacles: 0 small cactus, 1 tall cactus, 2 bone pile, 3 campfire, 4 pterodactyl, 5 mammoth: sprite size, hit
    // box insets (left, top, right), whether landing on it stomps it and what that pays, how much faster than the
    // ground it comes on, and its sparks' first ink.
    const OB_W = [7, 9, 13, 13, 16, 26], OB_H = [11, 16, 7, 11, 9, 17], IN_L = [1, 1, 1, 2, 2, 3], IN_T = [1, 1, 2, 3, 2, 2], IN_R = [1, 1, 1, 2, 3, 2];
    const STOMPS = [0, 0, 0, 0, 1, 1], STOMP_PAYS = [0, 0, 0, 0, 50, 150], OB_VX = [0, 0, 0, 0, 26, 44], OB_SPARK = [4, 4, 6, 8, 10, 12];
    // A high pterodactyl flies five pixels over the running dino's head, so staying under it is no close call.
    const PTERO_LOW = GROUND - 14, PTERO_HIGH = GROUND - 29;
    // What each land deals, a pattern a draw (repeats weigh it): 0 a cactus, 1 a tall one, 2 a pair, 3 bones, 4 two
    // obstacles a landing apart, 5 a campfire, 6 a low pterodactyl, 7 a high one over bananas, 8 a mammoth, 9 a treat
    // high up (an air jump's), 10 a trail of bananas, 11 two mammoths; the fifth list deals from the sixth land on. And
    // the gap after a pattern, seconds, from the fifth land closing by TIGHTEN a land down to TIGHTEST of it.
    const DEALS = [[0, 0, 0, 3, 3, 10, 10, 6, 9, 2], [0, 1, 2, 3, 4, 5, 6, 7, 7, 9, 10, 1], [0, 1, 2, 4, 4, 5, 5, 6, 7, 8, 9, 3], [1, 2, 4, 5, 6, 7, 7, 8, 8, 11, 9, 4], [1, 1, 2, 2, 4, 4, 4, 6, 7, 8, 11, 11, 9]];
    const GAP_MIN = [0.95, 0.82, 0.74, 0.68, 0.66], GAP_MAX = [1.7, 1.35, 1.15, 1.02, 0.98], TIGHTEN = 0.05, TIGHTEST = 0.7;
    const LAND_BONUS = 250, BANANA = 10, GOLD = 250, CLOSE = 20, SMASH = 40, MULT_AT = [10, 25, 50];
    // The callouts over the cabinet; a land, the banana row's multiplier and the run's end are the screen's own.
    const SAY = { chain: ["", "", "Double stomp!", "Triple stomp!", "Mega stomp!"], mammoth: "Mammoth stomp!", fire: "Fire dino!", ouch: ["", "Last Ooga!", "Ouch!"] };
    // A land's name and ink, the words that float up, and the banana row's multiplier as it steps up (x2 to x4, shown
    // MULT_S seconds under the score's bar).
    const TITLES = ["JUNGLE", "BADLANDS", "VOLCANO", "STAMPEDE"], TITLE_INK = [TEXT.lime, TEXT.ember, TEXT.red, TEXT.sky], WORDS = ["", "CLOSE!", "STOMP!", "SMASH!"];
    const MULTS = ["BANANA X2", "BANANA X3", "BANANA X4"], MULT_S = 1.2;
    // The sparks' inks: banana, gold, dust (two), cactus (two), bone (two), fire (two), pterodactyl (two), mammoth
    // (two), white and skin.
    const SPARK_INKS = [INK.banana, INK.gold, "#8a6a4a", "#5a3a22", "#2f8a3a", "#8fd05a", INK.bone, "#b8ac94", INK.ember, INK.red, INK.violet, "#7a5ab8", "#7a5230", "#4e3420", INK.white, INK.skin];
    const SP_BANANA = 0, SP_DUST = 2, SP_FIRE = 8, SP_WHITE = 14;

    // ---- the art, baked once for the page on the first game ----
    const DINO_INKS = { G: "#6fae3a", g: "#3a6e24", b: "#a6d45a", E: INK.night, W: INK.bone, H: INK.hair, h: "#5a3a1e", S: INK.skin, s: "#9a6232", K: "#1b1410", w: INK.cream, L: INK.ochre, l: "#6b3a1e" };
    const HOT_INKS = { ...DINO_INKS, G: INK.ember, g: INK.red, b: INK.banana };
    const DINO_TOP = [
      "..hHHh..............", ".hHHHHHh............", "hHHHHHHSS....GGGGGG.", "HHHHSwKS....GGGGGGGG", ".HHSSSSSs...GGEGGGGG", "..HSSKKS....GGGGGGGG",
      "...sSSS.....GGGGGWWW", "..SSSSSSSS..GGGGGG..", "G.LSSSS.SSGGGGGG....", "G.LLLLLGGGGGGGG.....", "GGLlLlLGGGGGGGGGW...", "GGGGGGGGGGGGGG..W...",
      ".GGGGGGGGGGGGG......", "..gGGGGbbbbGG.......", "...ggGGGbbGG........"
    ];
    // The air jump's top: the Ooga's fist up.
    const DINO_WHOOP = DINO_TOP.map((r, i) => ["..hHHh..SS..........", ".hHHHHHhSS..........", "hHHHHHHSSS...GGGGGG."][i] || (i === 7 ? "..SSSSS.....GGGGGG.." : i === 8 ? "G.LSSSS...GGGGGG...." : r));
    const DINO_LEGS = [
      [".....GGG..GG........", ".....GG....GGW......", ".....WW............."], [".....GG...GG........", "....WGg...GG........", "..........WW........"],
      [".....GG...GG........", ".....GG...GG........", ".....WW...WW........"], ["....GGGGGGG.........", "....WW..WW..........", "...................."]
    ];
    const CACTUS_INKS = { C: "#2f8a3a", c: "#1c5a26", x: "#c8ff5a", o: "#8fd05a" };
    const CACTUS_S = ["..xCc..", "..CoC..", "C.CCc..", "C.CCc.C", "CcCoc.C", ".CCCcCc", "..CCCc.", "..CoC..", "..CCc..", "..CCc..", "..CCc.."];
    const CACTUS_T = ["...xCc...", "...CCCc..", "...CoCc..", "...CCCc..", "C..CCCc..", "Cc.CoCc..", "Cc.CCCc.C", "CcCCCCc.C", ".CCCCCccC", "..CCoCCC.", "...CCCc..", "...CoCc..", "...CCCc..", "...CCCc..", "...CoCc..", "...CCCc.."];
    const BONES_INKS = { B: INK.bone, k: "#8a806c", d: "#b8ac94" };
    const BONES = [".....BBB.....", "....BBBBB....", "....BkBkB....", "BB...BdB...BB", ".BBBB.d.BBBB.", "BB..BBBBB..BB", "...BB...BB..."];
    const FIRE_INKS = { y: INK.banana, Y: INK.gold, O: INK.ember, R: INK.red, N: INK.husk, n: INK.huskDk, T: INK.stone, t: INK.stoneDk };
    const FIRE_BASE = [".TnNNNNNNnT..", "TtNnNNNnNNtT.", ".TTTtTTtTTT.."];
    const FLAMES = [
      ["......y......", ".....yY......", "....yYYy.....", "...yYOYy.y...", "...YOOOYyY...", "..yOORROYY...", "..YORRRROY...", "..YORRRROY..."],
      [".......y.....", "......yY.....", "....y.YYy....", "...yYYOYy....", "..yYOOOOY....", "..YOORRROy...", "..YORRRROY...", "..YORRRROY..."],
      [".....y.......", "....yY...y...", "....YYy..Y...", "...yYOYyYY...", "...YOOOOY....", "..yOORROOY...", "..YORRRROY...", "..YORRRROY..."]
    ];
    const PTERO_INKS = { P: INK.violet, p: "#7a5ab8", Q: INK.gold, V: INK.bone, E: INK.night };
    const PTEROS = [
      [".........pp.....", "........pPPp....", "....V..pPPp.....", "...VPPpPPp......", "QQQPEPPPPPPPPp..", "...PPPPPPPppppp.", "......PPP.......", ".......pp.......", "................"],
      ["................", "................", "....V...........", "...VPP..........", "QQQPEPPPPPPPPp..", "...PPPPPPPPpppp.", "......pPPPp.....", ".......pPPp.....", "........pp......"]
    ];
    const MAM_INKS = { M: "#7a5230", m: "#4e3420", f: "#9a6a40", U: INK.bone, K: "#1b1410" };
    const MAM_TOP = [
      ".......mmmmmm.............", ".....mmMMMMMMmm...........", "....mMMMMMMMMMMmmmmm......", "...mMMMMMMMMMMMMMMMMmm....", "...MKMMMMMfMMMMMMfMMMMm...",
      "..mMMMMMMMMMMMMMMMMMMMMm..", "..MMMMMMfMMMMMfMMMMMMMMMm.", "..MMmMMMMMMMMMMMMMMMfMMMm.", ".MMMmMMMMMMfMMMMMMMMMMMMMm", "UMM.mMMMMMMMMMMMMMfMMMMMMm",
      "UMM..MMMMMMMMMMMMMMMMMMMMm", "UMm..mMMMMMMMMMMMMMMMMMMm.", "UUM...mMMMMmmmmmmMMMMMMm.."
    ];
    const MAM_LEGS = [
      [".UMm...MMM.......MMM.MMm..", "..mM...MMM.......MMM.MM...", "...mM..MMm.......MMm.Mm...", "......mmmm......mmmm.mm..."],
      [".UMm....MMM.....MMM...MMm.", "..mM....MMM.....MMM...MM..", "...mM...MMm.....MMm...Mm..", ".......mmmm....mmmm...mm.."]
    ];
    const BANANA_ROWS = [".....nn", "....yY.", "..yyyY.", "yyyYY..", ".YYY..."], BANANA_INKS = { y: INK.banana, Y: INK.gold, n: INK.huskDk };
    // The lands: sky bands from the top to the horizon, a sun or moon [x, y, r, ink], and the far layer's, the mid
    // layer's and the ground's inks.
    const LANDS = [
      { sky: ["#1d2b53", "#2a4a78", "#3f7aa0", "#7fb4b0", "#e8c68a"], orb: [118, 64, 9, "#fff3c0"], far: "#24545a", farLt: "#34706a", mid: "#1d3d22", midLt: "#2f5a2a", top: "#6fae3a", topDk: "#3a6e24", earth: "#5a3a22", earthDk: "#3e2716", grit: "#7a5a3a" },
      { sky: ["#2a1638", "#4d2352", "#8a3658", "#cf5a48", "#f59a52"], orb: [42, 76, 11, "#ffd27a"], far: "#5e2a3e", farLt: "#7a3a4a", mid: "#3e1a26", midLt: "#56243a", top: "#d9953a", topDk: "#b8472c", earth: "#8a4a26", earthDk: "#6a3419", grit: "#a8643a" },
      { sky: ["#120608", "#240a0e", "#3e1012", "#621a14", "#a8341a"], orb: null, far: "#1e0a0a", farLt: "#ff8a2a", mid: "#140808", midLt: "#e0452b", top: "#4a3a32", topDk: "#2b221d", earth: "#2b221d", earthDk: "#1c1512", grit: "#5a4a40" },
      { sky: ["#05060f", "#0a1028", "#111c42", "#1a2b5e", "#27407a"], orb: [30, 28, 8, "#efe6d2"], far: "#0f1a38", farLt: "#8a9ac0", mid: "#0a1226", midLt: "#16233e", top: "#3a6e24", topDk: "#24461a", earth: "#2a2016", earthDk: "#1c150e", grit: "#4a3a2a" }
    ];
    const FAR_Y = GROUND - 60, MID_Y = GROUND - 40, FAR_K = 0.12, MID_K = 0.4, GROUND_H = H - GROUND;
    let baked = null;
    const art = () => {
      if (baked) return baked;
      const inv = invadersArt(), rand = BL.math.mulberry32(19);
      const dino = (inks) => [0, 1, 2].map((k) => sprite([...DINO_TOP, ...DINO_LEGS[k]], inks)).concat([sprite([...DINO_WHOOP, ...DINO_LEGS[3]], inks)]);
      const mams = MAM_LEGS.map((legs) => [...MAM_TOP, ...legs]), fires = FLAMES.map((f) => [...f, ...FIRE_BASE]);
      const kinds = [[CACTUS_S], [CACTUS_T], [BONES], fires, PTEROS, mams], inks = [CACTUS_INKS, CACTUS_INKS, BONES_INKS, FIRE_INKS, PTERO_INKS, MAM_INKS];
      // A layer as wide as the screen and `h` tall, whose `col(x, from, to, ink)` paints column x (wrapped round the
      // tile) from row `from` to `to`; `wave` sums sines whose periods divide the tile, so a skyline built on it tiles.
      const layer = (h) => { const c = canvasOf(W, h), g = c.getContext("2d"); return { c, g, col: (x, from, to, ink) => { g.fillStyle = ink; g.fillRect(((x % W) + W) % W, from, 1, to - from); } }; };
      const wave = (x, parts) => { let v = 0; for (let k = 0; k < parts.length; k += 3) v += parts[k] * Math.sin(2 * Math.PI * x / W * parts[k + 1] + parts[k + 2]); return v; };
      const lands = LANDS.map((L, n) => {
        // The sky: its bands, each blended into the one above by two dithered rows, then the sun or moon.
        const sky = layer(GROUND), g = sky.g, band = GROUND / L.sky.length;
        L.sky.forEach((ink, b) => { g.fillStyle = ink; g.fillRect(0, Math.round(b * band), W, Math.ceil(band) + 1); });
        for (let b = 1; b < L.sky.length; b++) {
          const y = Math.round(b * band);
          g.fillStyle = L.sky[b];
          for (let x = 0; x < W; x += 4) g.fillRect(x, y - 2, 1, 1);
          for (let x = 1; x < W; x += 2) g.fillRect(x, y - 1, 1, 1);
          g.fillStyle = L.sky[b - 1];
          for (let x = 0; x < W; x += 2) g.fillRect(x, y, 1, 1);
          for (let x = 2; x < W; x += 4) g.fillRect(x, y + 1, 1, 1);
        }
        if (n === 3) for (let k = 0; k < 60; k++) { g.fillStyle = k % 5 ? "#6a7aa8" : INK.cream; g.fillRect(Math.floor(rand() * W), Math.floor(rand() * 70), 1, 1); }
        if (n === 2) for (let k = 0; k < 7; k++) { g.fillStyle = "#2e1214"; g.fillRect(Math.floor(rand() * W), 14 + Math.floor(rand() * 30), 10 + Math.floor(rand() * 18), 2); }
        if (L.orb) {
          const [ox, oy, r, ink] = L.orb;
          g.fillStyle = ink;
          for (let dy = -r; dy <= r; dy++) { const half = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(ox - half, oy + dy, half * 2 + 1, 1); }
          if (n === 3) { g.fillStyle = "#c8bfa8"; g.fillRect(ox - 3, oy - 2, 2, 2); g.fillRect(ox + 2, oy + 2, 3, 2); g.fillRect(ox - 1, oy + 4, 1, 1); }
        }
        // The far layer: hills, mesas, the volcano or snowy peaks, seamless round the tile.
        const far = layer(60);
        for (let x = 0; x < W; x++) {
          let top;
          if (n === 0) top = 60 - (18 + wave(x, [6, 2, 1, 4, 5, 2]));
          else if (n === 1) { const m = x % 53, flat = m > 8 && m < 40; top = 60 - (flat ? 30 + (x % 106 < 53 ? 6 : 0) : 14 + wave(x, [3, 7, 0])); }
          else if (n === 2) top = Math.min(60 - (10 + wave(x, [3, 4, 1])), 60 - Math.min(42, Math.max(0, 46 - Math.abs(x - 100) * 1.1)));
          else top = 60 - (22 + Math.abs(wave(x, [12, 3, 0.5])) + wave(x, [3, 11, 1]));
          top = Math.round(top);
          far.col(x, top, 60, L.far);
          // The skyline's lit edge; the night's peaks under snow instead.
          if (n === 3) far.col(x, top, top + (top < 30 ? Math.min(3, 31 - top) : 1), top < 30 ? L.farLt : "#1a2a52");
          else far.col(x, top, top + 1, n === 2 ? "#3a1410" : L.farLt);
        }
        if (n === 2) {
          // The crater's glow and a lava run down the cone's left flank.
          for (let x = 97; x <= 103; x++) far.col(x, 18, 20, x & 1 ? INK.gold : L.farLt);
          for (let k = 0; k < 26; k++) far.col(97 - Math.floor(k * 0.8), 20 + k, 21 + k, k & 1 ? L.farLt : INK.red);
        }
        // The mid layer: palms and bushes, rock spires, jagged rock over lava, or tall grass and a herd.
        const mid = layer(40);
        // Round-topped scrub: two rows of humps (20 and 16 px apart, so the tile still wraps), lit along the top.
        const bushes = (ink, lit, base, amp) => {
          for (let x = 0; x < W; x++) {
            const hump = Math.max(Math.sqrt(Math.abs(Math.sin(Math.PI * x / 20))), 0.75 * Math.sqrt(Math.abs(Math.sin(Math.PI * (x + 6) / 16)))), top = Math.round(40 - base - amp * hump);
            mid.col(x, top, 40, ink); mid.col(x, top, top + 1, lit);
          }
        };
        if (n === 0) {
          // Palms: a curved trunk two pixels thick, six drooping fronds and a cluster of coconuts under the crown.
          for (const px of [14, 62, 104, 146]) {
            const tall = 24 + Math.floor(rand() * 10), lean = rand() < 0.5 ? -1 : 1;
            for (let k = 0; k < tall; k++) { const x = px + Math.round(Math.sin(k / tall * 1.6) * 3 * lean); mid.col(x, 40 - k - 1, 40 - k, k % 3 ? L.mid : "#16301a"); mid.col(x + 1, 40 - k - 1, 40 - k, "#16301a"); }
            const tx = px + Math.round(Math.sin(1.6) * 3 * lean), ty = 40 - tall;
            for (let f = 0; f < 6; f++) {
              const dir = f < 3 ? -1 : 1, rise = [0.9, 0.45, 0.1][f % 3];
              for (let k = 1; k <= 11; k++) { const y = ty - Math.round(rise * k) + Math.round(k * k * 0.08); mid.col(tx + dir * k, y, y + (k < 7 ? 2 : 1), f % 3 === 1 ? L.midLt : L.mid); }
            }
            mid.col(tx - 1, ty + 1, ty + 3, "#4a3218"); mid.col(tx + 1, ty + 1, ty + 3, "#4a3218"); mid.col(tx, ty + 2, ty + 4, "#3a2412");
          }
          bushes(L.mid, L.midLt, 3, 7);
        } else if (n === 1) {
          for (const [sx, w, tall] of [[10, 7, 26], [48, 5, 16], [86, 9, 30], [128, 6, 20]]) for (let k = 0; k < w; k++) {
            const top = 40 - tall + Math.abs(k - (w >> 1)) * 2;
            mid.col(sx + k, top, 40, L.mid); if (k === 1) mid.col(sx + k, top, 40, L.midLt);
          }
          for (const tx of [30, 110]) { for (let k = 0; k < 16; k++) mid.col(tx, 24 + k, 25 + k, L.mid); for (let k = 1; k < 6; k++) { mid.col(tx - k, 28 - k, 29 - k, L.mid); mid.col(tx + k, 30 - k, 31 - k, L.mid); } }
          bushes(L.mid, L.midLt, 2, 3);
        } else if (n === 2) {
          for (let x = 0; x < W; x++) {
            const top = Math.round(40 - 6 - Math.abs(wave(x, [10, 5, 0.2])) - (x % 17 < 3 ? 6 : 0));
            mid.col(x, top, 40, L.mid);
            if (x % 11 === 3) mid.col(x, top + 4 + x % 3, top + 5 + x % 3, INK.ember);
          }
          for (let x = 0; x < W; x++) if (wave(x, [1, 3, 2]) > 0.6) mid.col(x, 38, 40, x & 1 ? INK.ember : L.midLt);
        } else {
          // A herd grazing on the skyline: a hump, a head with its trunk hanging and a tusk, four legs.
          for (const hx of [20, 76, 120]) {
            for (let k = 0; k < 14; k++) { const hump = Math.round(6 - Math.abs(k - 5) * 0.55); mid.col(hx + k, 25 - hump, 33, "#26365c"); }
            for (const lx of [1, 4, 9, 12]) mid.col(hx + lx, 33, 38, "#26365c");
            mid.col(hx - 1, 21, 30, "#26365c"); mid.col(hx - 2, 22, 34, "#26365c"); mid.col(hx - 3, 32, 35, "#26365c"); mid.col(hx - 3, 28, 30, "#c8bfa8"); mid.col(hx - 4, 27, 28, "#c8bfa8");
          }
          for (let x = 0; x < W; x++) { const top = Math.round(40 - 3 - Math.abs(wave(x, [4, 17, 0.7])) - (x % 5 === 0 ? 3 : 0)); mid.col(x, top, 40, L.mid); }
        }
        // The ground: its top edge, the earth under it with a darker seam, grit, and a fossil bone here and there
        // (lava cracks on the volcano).
        const ground = layer(GROUND_H), gg = ground.g;
        gg.fillStyle = L.earth; gg.fillRect(0, 0, W, GROUND_H);
        gg.fillStyle = L.top; gg.fillRect(0, 0, W, 2);
        gg.fillStyle = L.topDk; for (let x = 0; x < W; x += 2) gg.fillRect(x + ((x >> 1) & 1), 1, 1, 1 + ((x * 7) % 3 === 0 ? 1 : 0));
        gg.fillStyle = L.earthDk; for (let x = 0; x < W; x++) if (wave(x, [1, 13, 0.4]) > -0.3) gg.fillRect(x, 7 + (x % 3 === 0 ? 1 : 0), 1, 1);
        for (let k = 0; k < 34; k++) { gg.fillStyle = k & 1 ? L.grit : L.earthDk; gg.fillRect(Math.floor(rand() * W), 3 + Math.floor(rand() * (GROUND_H - 4)), 1 + (k % 5 === 0 ? 1 : 0), 1); }
        if (n === 2) { gg.fillStyle = INK.ember; for (let k = 0; k < 5; k++) { let x = Math.floor(rand() * W), y = 4 + Math.floor(rand() * 8); for (let s = 0; s < 7; s++) { gg.fillRect(((x % W) + W) % W, y, 1, 1); x += 1; y += rand() < 0.5 ? -1 : 1; y = Math.max(3, Math.min(GROUND_H - 2, y)); } } }
        else for (let k = 0; k < 3; k++) { const x = Math.floor(rand() * (W - 6)), y = 10 + Math.floor(rand() * 7); gg.fillStyle = "#b8ac94"; gg.fillRect(x + 1, y, 3, 1); gg.fillRect(x, y - 1, 1, 1); gg.fillRect(x, y + 1, 1, 1); gg.fillRect(x + 4, y - 1, 1, 1); gg.fillRect(x + 4, y + 1, 1, 1); }
        return { sky: sky.c, far: far.c, mid: mid.c, ground: ground.c };
      });
      // Cosmetic spots, [x, y, phase] each: the volcano's embers rising, the night's stars twinkling, the speed
      // lines' rows and lengths.
      const spots = new Float32Array((EMBERS + STARS + LINES) * 3);
      for (let k = 0; k < spots.length; k += 3) { spots[k] = rand() * W; spots[k + 1] = 12 + rand() * 70; spots[k + 2] = rand() * 6; }
      baked = {
        inv, lands, spots, dino: dino(DINO_INKS), hot: dino(HOT_INKS), white: sprite([...DINO_TOP, ...DINO_LEGS[2]], null, false, INK.white),
        down: sprite([...DINO_TOP, ...DINO_LEGS[2]].map((r) => r.replace(/[HhSsKwLl]/g, ".")).reverse(), DINO_INKS),
        kinds: kinds.map((frames, k) => frames.map((rows) => sprite(rows, inks[k]))), whites: kinds.map((frames) => sprite(frames[0], null, false, INK.white)),
        banana: sprite(BANANA_ROWS, BANANA_INKS), lost: sprite(HEAD_ROWS, null, false, "#2c2830")
      };
      return baked;
    };

    return (host) => {
      const out = hooks(host), status = makeStatus("Lives"), A = art(), R = rng(), J = juice(host), fx = sparks(170, SPARK_INKS, 150);
      // Obstacles: alive (1 in the way, 2 knocked or stomped and falling out), kind, passed and seen (their cue played),
      // where each is, its fall, its own clock, and the closest the dino came over or under it (for a close call).
      const O = { alive: new Uint8Array(OBS), kind: new Uint8Array(OBS), passed: new Uint8Array(OBS), seen: new Uint8Array(OBS),
        x: new Float32Array(OBS), y: new Float32Array(OBS), vy: new Float32Array(OBS), t: new Float32Array(OBS), clear: new Float32Array(OBS) };
      // Bananas (kind 0) and golden coconuts (1): alive, kind, let by, where, and a phase for their bob.
      const P = { alive: new Uint8Array(PICKS), kind: new Uint8Array(PICKS), miss: new Uint8Array(PICKS), x: new Float32Array(PICKS), y: new Float32Array(PICKS), t: new Float32Array(PICKS) };
      // Points floating up (a number, or a word from WORDS) and the rings a jump, a stomp or a banana row throws.
      const PN = { value: new Int32Array(POPS), word: new Uint8Array(POPS), x: new Float32Array(POPS), y: new Float32Array(POPS), t: new Float32Array(POPS), next: 0 };
      const RG = { x: new Float32Array(RINGS), y: new Float32Array(RINGS), t: new Float32Array(RINGS), size: new Float32Array(RINGS), next: 0 };
      // The run on one object, written in place: the dino (`y` its feet, `prevY` last step's, `vy`, `ground`, `air`
      // 1 once its air jump is spent, `hurt` seconds untouchable, `stumble` seconds slowed, `fire`, `chain` stomps
      // since it landed, `stride` and `dust` px run for its legs and its dust), the run's clock (`run` seconds, `landT`
      // into this land, `land`, `speed`, `scroll` px and `dx` this step's), distance (`metres` and the px toward the next), what comes
      // next (`nextT`, `dealt` patterns so far, `gold` whether this land's golden coconut came), `hearts`, `streak`,
      // the end (`dead` after the crash or `won` at the cap, the thrown Ooga's `hx` `hy` `hvy`, `timer`), the land's
      // crossfade (`fade`, `from`) and banner, the multiplier's name (`multT` seconds of it, `multN`), the clock, seed
      // and the tally.
      const S = { y: GROUND, prevY: GROUND, vy: 0, ground: 1, air: 0, hurt: 0, stumble: 0, fire: 0, chain: 0, stride: 0, dust: 0, run: 0, landT: 0, land: 1, speed: V0, scroll: 0, dx: 0,
        metres: 0, metreAcc: 0, nextT: 0, dealt: 0, gold: 0, hearts: HEARTS, streak: 0, dead: 0, won: 0, hx: 0, hy: 0, hvy: 0, timer: 0, fade: 0, from: 0, banner: 0, multT: 0, multN: 2, clock: 0, seed: 0,
        bananas: 0, stomps: 0, closes: 0, smashes: 0, golds: 0 };
      let phase = "idle";
      const setVerb = () => { status.verb = phase === "play" ? "Jump!" : ""; };
      const addScore = (n) => { status.score = Math.min(CAP, status.score + n); };
      // Points floating up. A number landing on the last one while it is fresh adds to it and floats on from where
      // it is, so an arc of bananas counts up in one place rather than piling its numbers on each other.
      const pop = (x, y, value, word) => {
        const j = (PN.next + POPS - 1) % POPS;
        if (!word && !PN.word[j] && PN.t[j] > 0 && PN.t[j] < 0.4 && Math.abs(PN.x[j] - x) < 14) {
          PN.value[j] += value; PN.y[j] -= (PN.t[j] - 0.001) * 16; PN.t[j] = 0.001;
          return;
        }
        const i = PN.next;
        PN.next = (i + 1) % POPS;
        PN.value[i] = value; PN.word[i] = word; PN.x[i] = x; PN.y[i] = y; PN.t[i] = 0.001;
      };
      const ring = (x, y, size) => {
        const i = RG.next;
        RG.next = (i + 1) % RINGS;
        RG.x[i] = x; RG.y[i] = y; RG.t[i] = 0.001; RG.size[i] = size;
      };
      // The banana row: its multiplier steps up at each of MULT_AT, named under the score's bar; setting it back is
      // silent.
      const setStreak = (n) => {
        S.streak = n; status.streak = n;
        const m = n >= MULT_AT[2] ? 4 : n >= MULT_AT[1] ? 3 : n >= MULT_AT[0] ? 2 : 1;
        if (n > 0 && m > status.mult) {
          S.multT = MULT_S; S.multN = m; out.cue("score");
          ring(DINO_X + 10, S.y - 9, 12); J.flash(INK.banana, 0.18);
        }
        status.mult = m;
      };

      // ---- what comes down the track ----
      const obstacle = (kind, x, y) => {
        for (let i = 0; i < OBS; i++) {
          if (O.alive[i]) continue;
          O.alive[i] = 1; O.kind[i] = kind; O.passed[i] = O.seen[i] = 0; O.x[i] = x; O.y[i] = y; O.vy[i] = 0; O.t[i] = R.next() * 3; O.clear[i] = 99;
          return;
        }
      };
      const onGround = (kind, x) => obstacle(kind, x, GROUND - OB_H[kind]);
      // A mover starts further out by what it gains on the ground coming in, so it reaches the dino when a cactus
      // laid at `x` would.
      const mover = (kind, x, top) => obstacle(kind, x + (x - DINO_X - HIT_R) * OB_VX[kind] / S.speed, top);
      const fruit = (kind, x, y) => {
        for (let i = 0; i < PICKS; i++) {
          if (P.alive[i]) continue;
          P.alive[i] = 1; P.kind[i] = kind; P.miss[i] = 0; P.x[i] = x; P.y[i] = y; P.t[i] = R.next() * 6;
          return;
        }
      };
      // `n` bananas along the arc a jump topping out `top` px up over `cx` carries the Ooga through, or a trail of
      // them on the ground from `x`, where only a dino that stays low takes them.
      const arc = (cx, n, top) => {
        const half = S.speed * AIR_HALF, gap = Math.min(12, half * 0.55);
        for (let k = 0; k < n; k++) {
          const dx = (k - (n - 1) / 2) * gap, f = dx / half;
          fruit(0, cx + dx - 3, GROUND - 12 - top * (1 - f * f));
        }
      };
      const trail = (x, n) => { for (let k = 0; k < n; k++) fruit(0, x + k * 10, GROUND - 9); };
      const deal = () => {
        const d = S.land > 5 ? 4 : Math.min(S.land, 4) - 1, list = DEALS[d], x = W + 4, tighter = S.land > 4 ? Math.max(TIGHTEST, 1 - TIGHTEN * (S.land - 4)) : 1;
        let p = list[R.int(list.length)], len = 8;
        // The run opens on a trail of bananas, then a cactus with bananas over it, so the first seconds pay.
        if (S.dealt < 2) p = S.dealt ? 0 : 10;
        else if (!S.gold && S.landT > GOLD_AFTER && R.chance(0.3)) p = 9;
        S.dealt++;
        if (p === 0) { onGround(0, x); if (S.dealt === 2 || R.chance(0.6)) arc(x + 3.5, 3, JUMP_TOP); len = 7; }
        else if (p === 1) { onGround(1, x); if (R.chance(0.5)) arc(x + 4.5, 3, JUMP_TOP); len = 9; }
        else if (p === 2) { onGround(0, x); onGround(0, x + 6); arc(x + 6.5, 3, JUMP_TOP); len = 13; }
        else if (p === 3) { onGround(2, x); if (R.chance(0.5)) arc(x + 6.5, 3, JUMP_TOP); else trail(x + 30, 3); len = 13; }
        else if (p === 4) { const gap = S.speed * TWIN_S, k = R.chance(0.5) ? 2 : 1; onGround(0, x); onGround(k, x + gap); arc(x + 3.5, 1, JUMP_TOP); arc(x + gap + OB_W[k] / 2, 1, JUMP_TOP); len = gap + OB_W[k]; }
        else if (p === 5) { onGround(3, x); arc(x + 6.5, 4, JUMP_TOP); len = 13; }
        else if (p === 6) { mover(4, x, PTERO_LOW); arc(x + 8, 1, JUMP_TOP + 4); len = 16; }
        else if (p === 7) { mover(4, x, PTERO_HIGH); trail(x - 6, 3); len = 24; }
        else if (p === 8) { mover(5, x, GROUND - OB_H[5]); arc(x + 20, 2, AIR_TOP - 6); len = 26; }
        else if (p === 9) {
          onGround(0, x); arc(x + 3.5, 3, AIR_TOP);
          if (!S.gold) { S.gold = 1; fruit(1, x + 1, GROUND - 17 - AIR_TOP); }
          len = 7;
        } else if (p === 10) { trail(x, 5); len = 44; }
        else { const gap = S.speed * TWIN_S * 1.1; mover(5, x, GROUND - OB_H[5]); mover(5, x + gap, GROUND - OB_H[5]); len = gap + 26; }
        S.nextT = len / S.speed + R.range(GAP_MIN[d], GAP_MAX[d]) * tighter;
      };

      // ---- the dino ----
      const jump = () => {
        if (S.ground) {
          S.ground = 0; S.vy = -JUMP_V;
          fx.spawn(DINO_X + 7, GROUND - 1, 4, 30, SP_DUST, SP_DUST + 1, 0.35);
          out.cue("throw", 0.5);
          return;
        }
        // An air jump, unless the dino is all but down, when the press waits for the landing (the carnival holds a
        // press a game does not take for a moment and tries it again) and jumps from the ground.
        if (S.air || (S.vy > 0 && GROUND - S.y < NEAR_GROUND)) return;
        S.air = 1; S.vy = -AIR_V;
        ring(DINO_X + 9, S.y - 2, 7);
        fx.spawn(DINO_X + 9, S.y - 1, 5, 40, SP_WHITE, SP_BANANA, 0.3);
        out.cue("swish", 0.6);
      };
      const land = () => {
        S.y = GROUND; S.vy = 0; S.ground = 1; S.air = 0; S.chain = 0;
        fx.spawn(DINO_X + 6, GROUND - 1, 5, 34, SP_DUST, SP_DUST + 1, 0.4);
        fx.spawn(DINO_X + 13, GROUND - 1, 3, 26, SP_DUST, SP_DUST + 1, 0.3);
        out.cue("tap", 0.3);
      };
      const hurt = (i) => {
        const k = O.kind[i], cx = O.x[i] + OB_W[k] / 2, cy = O.y[i] + OB_H[k] / 2;
        O.alive[i] = 2; O.vy[i] = -70; O.t[i] = 0;
        S.hearts--; status.left = S.hearts; S.hurt = HURT_S; S.stumble = STUMBLE_S;
        fx.spawn(cx, cy, 16, 60, OB_SPARK[k], OB_SPARK[k] + 1, 0.6);
        fx.spawn(DINO_X + 10, S.y - 9, 10, 45, SP_WHITE, SP_WHITE + 1, 0.4);
        ring(DINO_X + 10, S.y - 9, 14);
        J.shake(5); J.flash(INK.red, 0.5);
        out.shake(0.7); out.cue("slam"); out.flop();
        setStreak(0);
        if (S.hearts > 0) { out.popup(SAY.ouch[S.hearts], S.hearts === 1); return; }
        // The last bonk: the dino goes over and the Ooga flies off; the world rolls to a stop under GAME OVER.
        phase = "over"; S.dead = 1; S.timer = OVER_S; S.hx = DINO_X + 4; S.hy = S.y - DINO_H; S.hvy = -120;
        out.over();
        setVerb();
      };
      // The score's cap reached: the run is won, and the dino runs the world to a stop under TOP DINO.
      const win = () => {
        phase = "over"; S.won = 1; S.timer = OVER_S;
        setVerb();
        fx.spawn(DINO_X + 10, S.y - 9, 30, 90, SP_BANANA, SP_BANANA + 1, 0.8);
        ring(DINO_X + 10, S.y - 9, 20);
        J.flash(INK.banana, 0.5); J.shake(3);
        out.cue("win"); out.crack(true); out.over();
      };
      const stomp = (i) => {
        const k = O.kind[i], cx = O.x[i] + OB_W[k] / 2;
        O.alive[i] = 2; O.vy[i] = k === 5 ? -30 : -10; O.t[i] = 0;
        S.vy = -STOMP_V; S.air = 0; S.chain++; S.stomps++;
        const pts = STOMP_PAYS[k] * (1 << Math.min(S.chain - 1, 4)) * status.mult;
        addScore(pts);
        pop(cx, O.y[i] - 6, pts, 0);
        fx.spawn(cx, O.y[i] + 2, k === 5 ? 22 : 14, k === 5 ? 70 : 55, OB_SPARK[k], OB_SPARK[k] + 1, 0.55);
        ring(cx, O.y[i] + 2, k === 5 ? 16 : 10);
        J.shake(k === 5 ? 3 : 2);
        out.cue(k === 5 ? "knock" : "bonk");
        if (S.chain >= 2) { out.cue("clang"); out.popup(SAY.chain[Math.min(S.chain, 4)], true); out.crack(true); }
        else if (k === 5) { out.popup(SAY.mammoth, true); out.crack(true); }
        else out.crack(false);
      };
      const smash = (i) => {
        const k = O.kind[i], cx = O.x[i] + OB_W[k] / 2, cy = O.y[i] + OB_H[k] / 2;
        O.alive[i] = 2; O.vy[i] = -90; O.t[i] = 0; S.smashes++;
        const pts = SMASH * status.mult;
        addScore(pts);
        pop(cx, O.y[i] - 4, pts, 0);
        fx.spawn(cx, cy, 18, 70, SP_FIRE, OB_SPARK[k], 0.6);
        J.shake(2);
        out.cue("thunk");
      };
      // Past the dino: a close call if it went over or under with no more than four pixels to spare.
      const passed = (i) => {
        O.passed[i] = 1;
        if (O.clear[i] < 0 || O.clear[i] > 4) return;
        S.closes++;
        const pts = CLOSE * status.mult;
        addScore(pts);
        pop(DINO_X + 10, S.y - DINO_H - 4, 0, 1);
        out.cue("tick", 0.6);
      };
      // The step's scroll is read from `S.dx`, not handed in: a fraction passed to a call is boxed, a field is not.
      const stepObstacles = (h) => {
        const dx = S.dx, hx0 = DINO_X + HIT_L, hx1 = DINO_X + HIT_R, hy0 = S.y - HIT_T, hy1 = S.y, play = phase === "play";
        for (let i = 0; i < OBS; i++) {
          const a = O.alive[i];
          if (!a) continue;
          const k = O.kind[i];
          O.t[i] += h;
          if (a === 2) {
            O.x[i] -= dx * 0.7; O.vy[i] += 320 * h; O.y[i] += O.vy[i] * h;
            if (O.y[i] > H + 4 || O.x[i] < -30) O.alive[i] = 0;
            continue;
          }
          O.x[i] -= dx + OB_VX[k] * h * (play ? 1 : 0.4);
          if (O.x[i] + OB_W[k] < -4) { O.alive[i] = 0; continue; }
          if (!O.seen[i] && O.x[i] < W) {
            O.seen[i] = 1;
            if (k === 4) out.cue("chirp", 0.4);
            else if (k === 5) out.cue("knock", 0.55);
          }
          // A charging mammoth kicks up dust and a campfire spits embers, each on its own clock's beat.
          if (k === 5 && (O.t[i] * 14 | 0) !== ((O.t[i] - h) * 14 | 0)) fx.spawn(O.x[i] + 20, GROUND - 1, 1, 22, SP_DUST, SP_DUST + 1, 0.3);
          else if (k === 3 && (O.t[i] * 5 | 0) !== ((O.t[i] - h) * 5 | 0)) fx.spawn(O.x[i] + 6, O.y[i] + 2, 1, 16, SP_FIRE, SP_BANANA, 0.5);
          if (!play) continue;
          const ox0 = O.x[i] + IN_L[k], ox1 = O.x[i] + OB_W[k] - IN_R[k], oy0 = O.y[i] + IN_T[k], oy1 = O.y[i] + OB_H[k];
          if (ox1 < hx0) { if (!O.passed[i]) passed(i); continue; }
          if (ox0 > hx1) continue;
          if (hy1 <= oy0) { if (O.clear[i] >= 0) O.clear[i] = Math.min(O.clear[i], oy0 - hy1); }
          else if (hy0 >= oy1) { if (O.clear[i] >= 0) O.clear[i] = Math.min(O.clear[i], hy0 - oy1); }
          else {
            O.clear[i] = -1;
            if (S.fire > 0) smash(i);
            else if (STOMPS[k] && S.vy > 0 && S.prevY <= oy0 + 3) stomp(i);
            else if (S.hurt <= 0) { hurt(i); if (phase !== "play") return; }
          }
        }
      };
      const stepFruit = () => {
        const dx = S.dx, bx0 = DINO_X + TAKE_L, bx1 = DINO_X + TAKE_R, by0 = S.y - DINO_H - 2, by1 = S.y + 1;
        for (let i = 0; i < PICKS; i++) {
          if (!P.alive[i]) continue;
          P.x[i] -= dx;
          const k = P.kind[i], w = k ? 5 : 7;
          if (P.x[i] + w < -2) { P.alive[i] = 0; continue; }
          if (phase !== "play" || P.miss[i]) continue;
          if (P.x[i] + w < bx0) {
            P.miss[i] = 1;
            if (!k && S.streak > 0) { if (S.streak >= 10) out.flop(); setStreak(0); }
            continue;
          }
          if (P.x[i] > bx1 || P.y[i] + 5 < by0 || P.y[i] > by1) continue;
          P.alive[i] = 0;
          const cx = P.x[i] + w / 2, cy = P.y[i] + 2;
          if (k) {
            S.fire = FIRE_S; status.fire = true; S.golds++;
            const pts = GOLD * status.mult;
            addScore(pts); pop(cx, cy - 6, pts, 0);
            fx.spawn(cx, cy, 24, 80, SP_BANANA, SP_BANANA + 1, 0.7);
            ring(cx, cy, 16);
            J.flash(INK.banana, 0.45); J.shake(3);
            out.cue("fire"); out.popup(SAY.fire, true); out.crack(true);
          } else {
            S.bananas++;
            const pts = BANANA * status.mult;
            addScore(pts); pop(cx, cy - 5, pts, 0);
            fx.spawn(cx, cy, 6, 34, SP_BANANA, SP_BANANA + 1, 0.4);
            out.cue("coin", 0.45);
            setStreak(S.streak + 1);
          }
        }
      };
      const newLand = () => {
        S.from = (S.land - 1) % 4; S.land++; status.round = S.land; S.landT = 0; S.gold = 0; S.fade = 1; S.banner = BANNER_S;
        const bonus = LAND_BONUS * (S.land - 1);
        addScore(bonus);
        pop(DINO_X + 10, S.y - DINO_H - 6, bonus, 0);
        if (S.hearts < HEARTS) { S.hearts++; status.left = S.hearts; }
        J.flash(INK.white, 0.25);
        out.cue("round"); out.crack(false);
      };
      const finish = () => {
        phase = "done";
        setVerb();
        status.note = `${S.metres} m · bananas ${S.bananas} · stomps ${S.stomps}`;
        if (!S.won) out.cue("buzzer");
        out.onEnd(status.score);
      };
      const step = (h) => {
        const play = phase === "play";
        if (play) {
          S.run += h; S.landT += h;
          S.stumble = Math.max(0, S.stumble - h);
          S.speed = (S.run < MAX_AT ? V0 + ACCEL * S.run : Math.min(TOP, MAX + LATE * (S.run - MAX_AT))) * (1 - 0.45 * S.stumble / STUMBLE_S);
          if (S.run >= S.land * LAND_S) newLand();
          S.nextT -= h;
          if (S.nextT <= 0) deal();
        } else {
          S.speed = Math.max(0, S.speed - 110 * h);
          S.timer -= h;
          S.hvy += 300 * h; S.hy += S.hvy * h; S.hx += 24 * h;
          if (S.hy > GROUND - 11) { S.hy = GROUND - 11; S.hvy = -Math.abs(S.hvy) * 0.35; }
        }
        const dx = S.dx = S.speed * h;
        S.scroll += dx;
        S.hurt = Math.max(0, S.hurt - h);
        if (S.fire > 0) {
          S.fire = Math.max(0, S.fire - h);
          if (S.fire <= 0) status.fire = false;
          else if ((S.fire * 30 | 0) !== ((S.fire + h) * 30 | 0)) fx.spawn(DINO_X + 2, S.y - 8 - (S.fire * 97 | 0) % 6, 1, 18, SP_FIRE, SP_FIRE + 1, 0.35);
        }
        if (play) {
          S.metreAcc += dx;
          while (S.metreAcc >= METRE) { S.metreAcc -= METRE; S.metres++; if (S.metres % 10 === 0) addScore(10 * status.mult); }
        }
        // The dino: a run's stride and dust, or the jump's arc under the heavier fall.
        S.prevY = S.y;
        if (S.ground) {
          S.stride += dx; S.dust += dx;
          if (S.dust >= 22 && play) { S.dust = 0; fx.spawn(DINO_X + 5, GROUND - 1, 1, 14, SP_DUST, SP_DUST + 1, 0.3); }
        } else {
          S.vy += (S.vy < 0 ? G_UP : G_DOWN) * h;
          S.y += S.vy * h;
          if (S.y >= GROUND) land();
        }
        stepObstacles(h);
        stepFruit();
        if (phase === "play" && status.score >= CAP) win();
        else if (phase === "over" && S.timer <= 0) finish();
      };
      const run = stepper(step);

      // ---- drawing ----
      // A layer tiled across at a whole-pixel offset `o` (0 to W - 1). Positions reach draw calls as whole numbers,
      // which pass unboxed where a fraction would be boxed.
      const tile = (ctx, c, o, y) => { ctx.drawImage(c, -o, y); ctx.drawImage(c, W - o, y); };
      const drawLand = (ctx, n) => {
        const L = A.lands[n];
        ctx.drawImage(L.sky, 0, 0);
        const s = A.spots;
        if (n === 3) { ctx.fillStyle = INK.white; for (let k = EMBERS; k < EMBERS + STARS; k++) if ((S.clock * 0.9 + s[k * 3 + 2]) % 3 < 0.9) ctx.fillRect(s[k * 3] | 0, (s[k * 3 + 1] * 0.8) | 0, 1, 1); }
        tile(ctx, L.far, Math.floor(S.scroll * FAR_K) % W, FAR_Y);
        tile(ctx, L.mid, Math.floor(S.scroll * MID_K) % W, MID_Y);
        if (n === 2) {
          for (let k = 0; k < EMBERS; k++) {
            ctx.fillStyle = k & 1 ? INK.ember : INK.gold;
            const x = ((s[k * 3] - S.scroll * 0.5 + Math.sin(S.clock + s[k * 3 + 2]) * 4) % W + W) % W, y = GROUND - ((S.clock * 9 + s[k * 3 + 1]) % 80);
            ctx.fillRect(x | 0, y | 0, 1, 1);
          }
        }
        tile(ctx, L.ground, Math.floor(S.scroll) % W, GROUND);
      };
      // Speed lines streaking back once the run is quick.
      const drawLines = (ctx) => {
        if (S.speed <= 115) return;
        const k = (S.speed - 115) / (MAX - 115);
        const s = A.spots, o = (EMBERS + STARS) * 3;
        ctx.globalAlpha = k < 0.3 ? 0.15 : k < 0.6 ? 0.25 : 0.35;
        ctx.fillStyle = INK.cream;
        for (let i = 0; i < LINES; i++) {
          const len = 8 + (i * 5) % 11, x = ((s[o + i * 3] - S.scroll * 1.7) % (W + 40) + W + 40) % (W + 40) - 20;
          ctx.fillRect(x | 0, (20 + s[o + i * 3 + 1]) | 0, len, 1);
        }
        ctx.globalAlpha = 1;
      };
      const drawDino = (ctx) => {
        if (S.dead) {
          ctx.drawImage(A.down.canvas, DINO_X + Math.round(Math.min(10, (OVER_S - S.timer) * 14)), GROUND - DINO_H + 1);
          ctx.drawImage(A.inv.ooga[2].canvas, Math.round(S.hx), Math.round(S.hy));
          return;
        }
        if (S.hurt > 0 && (S.clock * 14 | 0) & 1) return;
        const f = S.ground ? (S.stride / 9 | 0) & 1 : S.air ? 3 : 2, set = S.fire > 0 && (S.clock * 16 | 0) & 1 ? A.hot : A.dino;
        ctx.drawImage((S.hurt > HURT_S - 0.1 ? A.white : set[f]).canvas, DINO_X, Math.round(S.y) - DINO_H);
      };
      const drawPlay = (ctx) => {
        J.begin(ctx);
        for (let i = 0; i < PICKS; i++) {
          if (!P.alive[i]) continue;
          const x = Math.round(P.x[i]), y = Math.round(P.y[i]) + (Math.sin(S.clock * 5 + P.t[i]) > 0 ? 1 : 0);
          if (P.kind[i]) {
            ctx.drawImage(A.inv.gold.canvas, x, y);
            if ((S.clock * 6 + P.t[i]) % 2 < 0.5) { ctx.fillStyle = INK.white; ctx.fillRect(x + 1, y - 2, 1, 1); ctx.fillRect(x + 5, y + 1, 1, 1); }
          } else ctx.drawImage(A.banana.canvas, x, y);
        }
        for (let i = 0; i < OBS; i++) {
          const a = O.alive[i];
          if (!a) continue;
          const k = O.kind[i], t = O.t[i], frames = A.kinds[k];
          const s = a === 2 && t < 0.12 ? A.whites[k] : frames.length === 1 ? frames[0] : k === 3 ? frames[(t * 10 | 0) % 3] : frames[(t * (k === 4 ? 7 : 6) | 0) & 1];
          ctx.drawImage(s.canvas, Math.round(O.x[i]), Math.round(O.y[i]) + (k === 4 && a === 1 ? Math.round(Math.sin(t * 4) * 1.5) : 0));
        }
        drawDino(ctx);
        fx.draw(ctx);
        ctx.fillStyle = INK.cream;
        for (let i = 0; i < RINGS; i++) {
          if (RG.t[i] <= 0) continue;
          const r = 2 + RG.size[i] * RG.t[i] / 0.22;
          for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(RG.x[i] + COS8[k] * r), Math.round(RG.y[i] + SIN8[k] * r), 1, 1);
        }
        for (let i = 0; i < POPS; i++) {
          if (PN.t[i] <= 0 || (PN.t[i] > 0.6 && (S.clock * 16 | 0) & 1)) continue;
          const y = Math.round(PN.y[i] - PN.t[i] * 16);
          if (PN.word[i]) { const s = WORDS[PN.word[i]]; text(ctx, s, Math.round(PN.x[i] - textWidth(s) / 2), y, TEXT.teal); }
          else number(ctx, PN.value[i], Math.round(PN.x[i]), y, TEXT.banana, 1, 1);
        }
        J.end(ctx);
      };
      const drawHud = (ctx) => {
        ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, 9);
        ctx.fillStyle = INK.rule; ctx.fillRect(0, 9, W, 1);
        number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 5);
        if (status.mult > 1) { text(ctx, "X", 35, 1, TEXT.ember); number(ctx, status.mult, 41, 1, TEXT.ember); }
        blit(ctx, A.banana, 51, 2);
        number(ctx, S.streak, 60, 1, TEXT.banana);
        number(ctx, S.metres, 125, 1, TEXT.bone, 1, 2);
        text(ctx, "M", 127, 1, TEXT.stone);
        for (let k = 0; k < HEARTS; k++) blit(ctx, k < S.hearts ? A.inv.head : A.lost, W - 8 - k * 7, 2);
        if (S.fire > 0) { ctx.fillStyle = (S.clock * 8 | 0) & 1 && S.fire < 1.5 ? INK.gold : INK.ember; ctx.fillRect(0, 10, Math.round(W * S.fire / FIRE_S), 1); }
      };
      // The multiplier's name as it steps up; a land's name as it begins (the first once the Go callout has cleared),
      // and the end: GAME OVER a beat after the crash, TOP DINO at once on a win.
      const drawBanner = (ctx) => {
        if (phase === "play" && S.multT > 0 && (S.multT > 0.35 || (S.clock * 8 | 0) & 1)) centre(ctx, MULTS[S.multN - 2], 13, TEXT.banana);
        if (phase === "play" && S.banner > 0 && S.banner <= BANNER_S && (S.banner > 0.45 || (S.clock * 8 | 0) & 1)) {
          const n = (S.land - 1) % 4;
          text(ctx, "LAND", 62, 22, TEXT.stone);
          number(ctx, S.land, 92, 22, TEXT.stone);
          centre(ctx, TITLES[n], 32, TITLE_INK[n], 2);
        } else if (phase === "done" || (phase === "over" && (S.won || S.timer < OVER_S - 0.7))) {
          ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, 30, W, 46); ctx.globalAlpha = 1;
          if (S.won) centre(ctx, "TOP DINO!", 36, TEXT.banana, 2);
          else centre(ctx, "GAME OVER", 36, TEXT.red, 2);
          centre(ctx, "SCORE", 56, TEXT.stone);
          number(ctx, status.score, W / 2, 64, TEXT.banana, 1, 1);
        }
      };
      // The attract: the jungle rolling by, the dino hopping a cactus again and again, the title and PRESS START.
      const drawAttract = (ctx) => {
        drawLand(ctx, 0);
        const u = Math.floor(S.clock * 75) % 230, cx = W + 10 - u, t = (DINO_X + 28 - cx) / 75, air = t > 0 && t < 0.6;
        blit(ctx, A.kinds[0][0], cx, GROUND - OB_H[0]);
        const lift = air ? Math.round(JUMP_TOP * 4 * (t / 0.6) * (1 - t / 0.6)) : 0;
        blit(ctx, A.dino[air ? 2 : (S.clock * 8 | 0) & 1], DINO_X, GROUND - DINO_H - lift);
        blit(ctx, A.banana, 96, 70 + ((S.clock * 3 | 0) & 1));
        ctx.fillStyle = INK.band; ctx.fillRect(0, 0, W, 9);
        text(ctx, "HI", 3, 1, TEXT.stone);
        number(ctx, host.best || 0, 17, 1, TEXT.gold, 1, 0, 5);
        centre(ctx, "DINO", 16, TEXT.lime, 2);
        centre(ctx, "DASH", 34, TEXT.teal, 2);
        if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 56, TEXT.bone);
      };

      const reset = () => {
        O.alive.fill(0); P.alive.fill(0); PN.t.fill(0); RG.t.fill(0);
        fx.clear(); J.reset();
        S.y = S.prevY = GROUND; S.vy = 0; S.ground = 1; S.air = 0; S.hurt = S.stumble = S.fire = 0; S.chain = 0; S.stride = S.dust = 0;
        S.run = S.landT = 0; S.land = 1; S.speed = V0; S.scroll = 0; S.metres = 0; S.metreAcc = 0; S.dealt = 0; S.gold = 0; S.hearts = HEARTS; S.dead = S.won = 0;
        S.fade = 0; S.from = 0; S.banner = S.multT = 0;
        status.fire = false; status.meter = -1; status.target = 0; status.note = ""; status.round = 1; status.left = HEARTS;
        setStreak(0);
      };
      reset();
      return {
        // Nothing steers: every press is the jump, taken as the finger goes down (`taps`); the HUD's round is the land.
        kind: "dash", name: "Dino Dash", aims: true, taps: true, roundLabel: "Land", status,
        help: "Space or tap jumps, and again in the air. Bananas in a row multiply, a golden coconut sets the dino on fire. Three bonks and the run is over.",
        coach: ["Space jumps, again in the air", "Tap to jump, again in the air"],
        stars: [1500, 4500, 10000], tickets: (score) => Math.min(75, Math.floor(score / 200)),
        get playing() { return phase === "play" || phase === "over"; },
        get seed() { return S.seed; },
        start: (seed) => {
          if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
          reset();
          status.score = 0; S.bananas = S.stomps = S.closes = S.smashes = S.golds = 0;
          S.nextT = 1.4; S.banner = BANNER_S + GO_S;
          phase = "play";
          setVerb();
        },
        stop: () => { phase = "idle"; reset(); setVerb(); },
        act: () => { if (phase === "play") jump(); },
        update: (dt) => {
          S.clock += dt;
          J.update(dt);
          fx.update(dt);
          for (let i = 0; i < POPS; i++) if (PN.t[i] > 0) { PN.t[i] += dt; if (PN.t[i] > 0.9) PN.t[i] = 0; }
          for (let i = 0; i < RINGS; i++) if (RG.t[i] > 0) { RG.t[i] += dt; if (RG.t[i] > 0.22) RG.t[i] = 0; }
          S.fade = Math.max(0, S.fade - dt / FADE_S);
          S.banner = Math.max(0, S.banner - dt); S.multT = Math.max(0, S.multT - dt);
          if (phase === "play" || phase === "over") run(dt);
          else if (phase === "idle") S.scroll += dt * 40;
        },
        draw: (ctx) => {
          if (phase === "idle") { drawAttract(ctx); return; }
          const n = (S.land - 1) % 4;
          if (S.fade > 0) { drawLand(ctx, S.from); ctx.globalAlpha = 1 - S.fade; drawLand(ctx, n); ctx.globalAlpha = 1; }
          else drawLand(ctx, n);
          drawLines(ctx);
          drawPlay(ctx);
          drawHud(ctx);
          drawBanner(ctx);
        }
      };
    };
  })();

  // ---- Stone Stacker --------------------------------------------------------------------------------------
  // Falling stones in a cave well: A and D (or a swipe) step the stone a column, holding slides it, Space (or W, or the
  // up arrow) turns it, and it falls on its own, faster each level (every four rows), or fast while S or the down arrow
  // is held (or a drag pulled down), a point a row, paid as it lands. A full row crumbles: one row 100, two 300, three
  // 500, four at once (the long bone stone down a deep gap) an OOGA clear, 800, all times the level. Stones that clear
  // rows one after another build a combo (50 a link), and from the third link the stones burn: every clear pays double
  // until a stone lands without one. The well starts on rubble whose top two rows have a gap the first stone (the
  // square) fits; every so often a mammoth stomps past and a row of rubble with bones in it rises from below, sooner each
  // level, its gap most often over the last one's; a rubble row cleared pays 50 more. A press while rows crumble turns
  // the stone that comes next. It ends when a stone has no room to come in, or the rubble lifts the stack out of the top.
  // Its names live in their own scope, so the other games' constants never meet them.
  const stacker = (() => {
    const COLS = 8, ROWS = 15, N = COLS * ROWS, C = 7, WX = 52, WY = 12, RUBBLE = 8, BONE = 9;
    const DAS = 0.16, ARR = 0.045, LOCK = 0.5, RESETS = 12, CLEAR = 0.3, CLEAR_MORE = 0.08, PETRIFY = 0.045, OVER = 1.7;
    const PER_LEVEL = 4, FALL0 = 0.22, FALL_K = 0.81, FALL_MIN = 0.028, SOFT = 0.025;
    const PAYS = [0, 100, 300, 500, 800], COMBO_PAY = 50, FIRE_AT = 3, RUBBLE_PAY = 50, SWEPT_PAY = 1000;
    const RUMBLE0 = 22, RUMBLE_STEP = 2, RUMBLE_MIN = 7, WARN = 2, STOMP = 0.4, SAME_GAP = 0.65;
    // The seven stones in their boxes at rest, [x, y] a cell: the long bone stone, the square, then T, S, Z, J and L.
    const SHAPES = [[0, 1, 1, 1, 2, 1, 3, 1], [1, 0, 2, 0, 1, 1, 2, 1], [1, 0, 0, 1, 1, 1, 2, 1], [1, 0, 2, 0, 0, 1, 1, 1], [0, 0, 1, 0, 1, 1, 2, 1], [0, 0, 0, 1, 1, 1, 2, 1], [2, 0, 0, 1, 1, 1, 2, 1]];
    const BOX = [4, 4, 3, 3, 3, 3, 3];
    // Every stone's four turns (clockwise) as cell offsets at (type * 4 + turn) * 8, and the row each turn comes in on
    // (`LIFT`, its top row negated, so its top cells enter the well's first row); the square never turns. The lift is
    // stored negated rather than negated in play, where a top row of 0 would make a -0 and turn `y` from an integer.
    const SHAPE = new Int8Array(7 * 4 * 8), LIFT = new Int8Array(7 * 4);
    for (let t = 0; t < 7; t++) for (let r = 0; r < 4; r++) {
      let top = 9;
      for (let k = 0; k < 4; k++) {
        let x = SHAPES[t][k * 2], y = SHAPES[t][k * 2 + 1];
        if (t !== 1) for (let q = 0; q < r; q++) { const nx = BOX[t] - 1 - y; y = x; x = nx; }
        SHAPE[(t * 4 + r) * 8 + k * 2] = x; SHAPE[(t * 4 + r) * 8 + k * 2 + 1] = y;
        if (y < top) top = y;
      }
      LIFT[t * 4 + r] = -top;
    }
    // Where a turn may nudge a stone to fit, [dx, dy] in order: none, a column either way, up a row, and two columns.
    const KICKS = new Int8Array([0, 0, -1, 0, 1, 0, 0, -1, -1, -1, 1, -1, -2, 0, 2, 0]);
    // Each stone's inks (face, lit edge, shadow, carving) and its carving in the cell's 5x5 middle: bone, granite,
    // ochre, moss, red earth, slate and teal crystal, then rubble and rubble with a bone in it; the carvings tell the
    // stones apart without their colours.
    const STONES = [
      ["#efe6d2", "#fffaf0", "#b8ac94", "#c9bb9c"], ["#8e8e96", "#b4b4bc", "#5a5a62", "#6b6b73"], ["#d9953a", "#f2c070", "#8a5a2c", "#a86a28"],
      ["#6fae3a", "#a2d86c", "#3a6e24", "#4f8a2c"], ["#c8583a", "#ec8a62", "#7a2e1e", "#9a3e26"], ["#4a7ab0", "#7fb0e0", "#2a4a70", "#34598a"],
      ["#2fb8a0", "#6ff0d2", "#1a6a5a", "#1f8f78"], ["#5a3a22", "#7a5230", "#2a1e14", "#46301c"], ["#5a3a22", "#7a5230", "#2a1e14", "#cfc4a8"]
    ];
    const CARVE = [[1, 2, 3, 2], [1, 1, 2, 1, 3, 1, 1, 2, 3, 2, 1, 3, 2, 3, 3, 3], [1, 1, 2, 1, 3, 1, 2, 2, 2, 3], [3, 1, 2, 2, 1, 3], [1, 1, 2, 2, 3, 3], [2, 1, 2, 2, 1, 3, 2, 3], [2, 1, 2, 2, 2, 3, 3, 3], [3, 3], [1, 2, 2, 2, 3, 2, 1, 1, 3, 3]];
    const GREY = ["#4a4a52", "#63636b", "#2b2b31", "#3a3a42"];
    // The sparks' inks: each stone's face, rubble's earth and bone, then white, ember, banana and dust. Few inks and a
    // small pool keep the kit's spark loop (inks times pool) short enough that V8 compiles it whole rather than
    // entering and leaving its inner loop every frame.
    const SPARK_INKS = [...STONES.slice(0, 7).map((s) => s[0]), "#7a5230", INK.bone, INK.white, INK.ember, INK.banana, "#6b6b73"];
    const SP_RUBBLE = 7, SP_BONE = 8, SP_WHITE = 9, SP_EMBER = 10, SP_BANANA = 11, SP_DUST = 12;
    const WORDS = ["", "", "DOUBLE", "TRIPLE", "OOGA!", "SWEPT!"], RIM_X = new Uint8Array([WX - 4, WX - 3, WX - 1, WX + COLS * C, WX + COLS * C + 2, WX + COLS * C + 3]);
    // The screen names every clear, level and the fire itself; only how a run ended is said over it.
    const SAY = { toppled: "Stack toppled!", buried: "Buried in rubble!" };
    // The attract loop's settled stack, the well's bottom four rows.
    const DEMO = new Uint8Array([0, 0, 0, 0, 0, 0, 7, 0, 5, 5, 0, 0, 0, 6, 7, 7, 3, 5, 5, 0, 0, 6, 6, 6, 8, 9, 8, 0, 0, 8, 8, 9]);

    // Built once for the page on the first game: a cell sprite per stone (and grey for a toppled stack, white for a
    // flash, the ghost's outline), and the backdrop: the cave, the well of carved stone, the panels and their labels.
    let art = null;
    const cellRows = (carve) => {
      const g = ["LLLLLLB", "LBBBBBD", "LBBBBBD", "LBBBBBD", "LBBBBBD", "LBBBBBD", "BDDDDDD"].map((r) => r.split(""));
      for (let k = 0; k < carve.length; k += 2) g[1 + carve[k + 1]][1 + carve[k]] = "M";
      return g.map((r) => r.join(""));
    };
    const inksOf = (s) => ({ B: s[0], L: s[1], D: s[2], M: s[3] });
    const stackerArt = () => {
      if (art) return art;
      const back = canvasOf(W, H), b = back.getContext("2d"), dots = BL.math.mulberry32(23);
      b.fillStyle = INK.night; b.fillRect(0, 0, W, H);
      b.fillStyle = "#0b0e18"; b.fillRect(0, 10, W, H - 10);
      for (let i = 0; i < 150; i++) { b.fillStyle = i % 3 ? "#10141f" : "#080a12"; b.fillRect(Math.floor(dots() * W), 10 + Math.floor(dots() * (H - 10)), 1 + (i & 1), 1); }
      b.fillStyle = "#12162a";
      for (const [x, len] of [[4, 5], [13, 8], [29, 4], [40, 6], [117, 7], [126, 4], [141, 8], [154, 5]]) for (let k = 0; k < len; k++) b.fillRect(x - Math.max(0, 1 - (k >> 2)), 10 + k, 1 + Math.max(0, 2 - (k >> 1)), 1);
      for (let i = 0; i < 14; i++) { b.fillStyle = i % 3 ? "#1d4f48" : "#2b3a66"; const x = Math.floor(dots() * 44); b.fillRect(i & 1 ? x + 114 : x + 2, 12 + Math.floor(dots() * 60), 1, 1); }
      b.fillStyle = INK.band; b.fillRect(0, 0, W, 9);
      b.fillStyle = INK.rule; b.fillRect(0, 9, W, 1);
      // The well: a dark shaft with a dot at each cell's corner to steer by, walls and a floor of carved stone blocks.
      b.fillStyle = "#07090f"; b.fillRect(WX, WY, COLS * C, ROWS * C);
      b.fillStyle = "#161b29";
      for (let r = 1; r < ROWS; r++) for (let c = 1; c < COLS; c++) b.fillRect(WX + c * C - 1, WY + r * C - 1, 1, 1);
      const block = (x, y, w, h) => {
        b.fillStyle = "#5a5a62"; b.fillRect(x, y, w, h);
        b.fillStyle = "#8e8e96"; b.fillRect(x, y, w, 1);
        b.fillStyle = "#6b6b73"; b.fillRect(x, y + 1, 1, h - 1);
        b.fillStyle = "#2b2b31"; b.fillRect(x, y + h - 1, w, 1);
      };
      for (let y = WY - C; y < WY + ROWS * C; y += C) { block(WX - 4, y, 4, C); block(WX + COLS * C, y - 3, 4, C); }
      block(WX + COLS * C, WY + ROWS * C - 3, 4, 3);
      for (let x = WX - 4; x < WX + COLS * C + 4; x += 9) block(x, WY + ROWS * C, Math.min(9, WX + COLS * C + 4 - x), H - WY - ROWS * C);
      b.fillStyle = INK.band; b.fillRect(WX - 4, 0, COLS * C + 8, WY - 2);
      b.fillStyle = INK.rule; b.fillRect(WX - 4, 9, COLS * C + 8, 1);
      // The left panel: the next stone's box under its label, the rows and the best; a stone fire bowl at its foot.
      text(b, "NEXT", 13, 12, TEXT.teal);
      b.fillStyle = INK.rule; b.fillRect(5, 20, 38, 39);
      b.fillStyle = "#05060a"; b.fillRect(6, 21, 36, 37);
      text(b, "ROWS", 13, 62, TEXT.stone);
      text(b, "HI", 19, 86, TEXT.stone);
      block(13, 112, 22, 5);
      b.fillStyle = "#6b6b73"; b.fillRect(15, 110, 18, 2);
      b.fillStyle = "#2b2b31"; b.fillRect(16, 110, 16, 1);
      // The right panel: the mammoth's rumble meter, the combo, and the ground the Ooga stands on.
      text(b, "COMBO", 121, 34, TEXT.stone);
      b.fillStyle = INK.earth; b.fillRect(112, 114, W - 112, H - 114);
      b.fillStyle = INK.earthDk; b.fillRect(112, 116, W - 112, 1);
      for (let x = 112; x < W; x += 3) { b.fillStyle = x % 2 ? INK.moss : INK.leaf; b.fillRect(x, 114, 2, 1); if (x % 9 === 0) b.fillRect(x + 1, 113, 1, 1); }
      b.fillStyle = INK.rule; b.fillRect(117, 27, 38, 5);
      const cell = (s, carve) => sprite(cellRows(carve), inksOf(s)).canvas;
      const cells = [null];
      for (let v = 0; v < 9; v++) cells.push(cell(STONES[v], CARVE[v]));
      // The danger glow's pulse (a wall's red at eight strengths) and the dark strip text sits on, baked, so a frame
      // only draws them and never hands the canvas an alpha.
      const tint = (w, h, fill) => { const c = canvasOf(w, h), x = c.getContext("2d"); x.fillStyle = fill; x.fillRect(0, 0, w, h); return c; };
      art = {
        back, cells, grey: cell(GREY, CARVE[7]), white: sprite(cellRows([]), null, false, INK.white).canvas,
        ghost: sprite(["GGGGGGG", "G.....G", "G.....G", "G.....G", "G.....G", "G.....G", "GGGGGGG"], { G: "#34405a" }).canvas,
        glow: [0.12, 0.2, 0.3, 0.4, 0.45, 0.4, 0.3, 0.2].map((a) => tint(4, ROWS * C, `rgba(224,69,43,${a})`)), strip: tint(COLS * C, 36, "rgba(7,8,13,0.7)")
      };
      return art;
    };

    return (host) => {
      const out = hooks(host), aim = out.aim, status = makeStatus("Rows"), inv = invadersArt(), A = stackerArt(), R = rng(), J = juice(host);
      const fx = sparks(120, SPARK_INKS, 120);
      // The well (0 empty, 1-7 a stone, 8 and 9 rubble), each cell's landing flash, the rows crumbling, and the bag
      // the stones are dealt from, all seven in a seeded shuffle before any comes again.
      const B = new Uint8Array(N), FL = new Float32Array(N), CLR = new Uint8Array(ROWS), BAG = new Uint8Array(7);
      // The run on one object, written in place: the falling stone (`t` type, `r` turn, `x`, `y`), the next and its
      // turn (`pre`), the bag's place, the fall and lock clocks, the slide's charge (`dasDir`, `dasT`, `arr`), the
      // steps read and whether up was held (`up`), the rows dropped fast (`dropped`), the tally (rows, level and its
      // `speed` a row, combo, fire), the mammoth (`rumbleT` to its stomp, `warned`, the rubble's `gap`), the phases'
      // clocks, the stack's top row, the callout (`call` the rows it names or 5 a swept cave, its points, clock and row,
      // and `levelUp` when its clear also raised the level) and the Ooga's cheer. The clocks start at -0, zero but a
      // double, so V8 lays them out as doubles from the start and never has to change their fields while a run plays.
      const S = { t: 0, r: 0, x: 0, y: 0, next: 0, pre: 0, bag: 7, fall: -0, lock: -0, resets: 0, grounded: 0, dasDir: 0, dasT: -0, arr: -0, steps: 0, up: 0, soft: 0, dropped: 0,
        lines: 0, level: 1, speed: FALL0, combo: 0, fire: 0, rumbleT: -0, warned: 0, gap: 0, clearT: -0, overT: -0, top: ROWS, call: 0, callPts: 0, callT: -0, callY: 0,
        levelUp: 0, rumbleCall: -0, cheer: -0, stomp: -0, stompT: -0, wob: -0, beatT: -0, emberT: -0, clock: -0, pieces: 0, oogas: 0, bestCombo: 0, seed: 0 };
      let phase = "idle";
      const setVerb = () => { status.verb = phase === "fall" || phase === "clear" ? "Turn!" : ""; };
      // Whether stone `t` at turn `r` would meet a wall, the floor or a settled cell at (x, y); above the top is open.
      const hit = (t, r, x, y) => {
        const o = (t * 4 + r) * 8;
        for (let k = 0; k < 8; k += 2) {
          const c = x + SHAPE[o + k], w = y + SHAPE[o + k + 1];
          if (c < 0 || c >= COLS || w >= ROWS || (w >= 0 && B[w * COLS + c])) return true;
        }
        return false;
      };
      const deal = () => {
        if (S.bag >= 7) {
          for (let i = 0; i < 7; i++) BAG[i] = i;
          for (let i = 6; i > 0; i--) { const j = R.int(i + 1), v = BAG[i]; BAG[i] = BAG[j]; BAG[j] = v; }
          S.bag = 0;
        }
        return BAG[S.bag++];
      };
      const measure = () => {
        let top = ROWS;
        for (let i = 0; i < N; i++) if (B[i]) { top = (i / COLS) | 0; break; }
        S.top = top;
      };
      const settle = () => { S.grounded = hit(S.t, S.r, S.x, S.y + 1) ? 1 : 0; };
      const add = (n) => { status.score += n; };
      // The callout over the well: what was cleared and its points, on a dark strip that ends just above row `row`, with
      // LEVEL UP on the strip over them when the clear raised the level, so the two never land on each other.
      const callout = (call, pts, row) => {
        S.call = call; S.callPts = pts; S.callT = 1;
        S.callY = Math.max(WY + 2 + (S.levelUp ? 10 : 0), WY + row * C - (call === 4 ? 26 : call > 1 ? 19 : 11));
      };
      const topple = (buried) => {
        phase = "over"; S.overT = 0;
        setVerb();
        S.fire = 0; status.fire = false;
        J.shake(4); J.flash(INK.red, 0.5);
        out.shake(0.7); out.cue("slam"); out.flop(); out.over();
        out.popup(buried ? SAY.buried : SAY.toppled, true);
      };
      const finish = () => {
        phase = "done";
        setVerb();
        status.note = `Rows ${S.lines} · OOGA clears ${S.oogas} · best combo ${S.bestCombo}`;
        out.cue("buzzer");
        out.onEnd(status.score);
      };
      // The next stone comes in at the top, turned as a press during the crumble asked if it fits so.
      const spawn = () => {
        S.t = S.next; S.next = deal();
        const r = S.t === 1 ? 0 : S.pre & 3;
        S.pre = 0;
        S.r = r; S.x = 2; S.y = LIFT[S.t * 4 + r];
        if (r && hit(S.t, r, S.x, S.y)) { S.r = 0; S.y = LIFT[S.t * 4]; }
        S.fall = S.lock = S.resets = 0; S.pieces++;
        S.soft = aim.y > 0 ? 2 : 0;
        phase = "fall";
        setVerb();
        if (hit(S.t, S.r, S.x, S.y)) { topple(false); return; }
        settle();
      };
      // A move or turn on the ground buys the stone its lock time again, a few times at most.
      const moved = () => {
        const was = S.grounded;
        settle();
        if ((was || S.grounded) && S.resets < RESETS) { S.lock = 0; S.resets++; }
      };
      const shift = (dx) => {
        if (hit(S.t, S.r, S.x + dx, S.y)) return false;
        S.x += dx;
        moved();
        return true;
      };
      const turn = () => {
        if (phase === "clear") { S.pre = (S.pre + 1) & 3; out.cue("click", 0.4); return; }
        if (phase !== "fall") return;
        if (S.t === 1) { S.wob = 0.12; out.cue("click", 0.4); return; }
        const r = (S.r + 1) & 3;
        for (let k = 0; k < KICKS.length; k += 2) {
          if (hit(S.t, r, S.x + KICKS[k], S.y + KICKS[k + 1])) continue;
          S.r = r; S.x += KICKS[k]; S.y += KICKS[k + 1];
          moved();
          out.cue("flip", 0.55);
          return;
        }
      };
      // Rows crumbled: their pay (by how many at once, the combo's link, rubble, doubled on fire, times the level),
      // the rows, the level, and the juice by size.
      const scored = (n, rubble, row) => {
        S.combo++;
        if (S.combo > S.bestCombo) S.bestCombo = S.combo;
        status.streak = S.combo;
        const lit = !S.fire && S.combo >= FIRE_AT;
        if (lit) { S.fire = 1; status.fire = true; out.cue("fire"); }
        status.mult = S.fire ? 2 : 1;
        const pts = (PAYS[n] + COMBO_PAY * (S.combo - 1) + RUBBLE_PAY * rubble) * S.level * status.mult;
        add(pts);
        S.lines += n; status.left = S.lines;
        const level = 1 + Math.floor(S.lines / PER_LEVEL);
        S.levelUp = level > S.level ? 1 : 0;
        callout(n, pts, row);
        S.cheer = 0.45 + 0.15 * n;
        for (let w = 0; w < ROWS; w++) {
          if (!CLR[w]) continue;
          for (let c = 0; c < COLS; c++) {
            const v = B[w * COLS + c], junk = v >= RUBBLE;
            fx.spawn(WX + c * C + 3, WY + w * C + 3, n > 2 ? 3 : 2, 34 + n * 10, junk ? SP_RUBBLE : v - 1, junk ? SP_BONE : SP_DUST, 0.55);
          }
        }
        if (n === 1) { J.shake(1); out.cue("score", 0.7); }
        else if (n === 2) { J.shake(2); J.flash(INK.cream, 0.15); out.cue("score"); out.crack(false); }
        else if (n === 3) { J.shake(3); J.flash(INK.banana, 0.25); out.cue("big"); out.crack(false); }
        else {
          S.oogas++; J.shake(4); J.flash(INK.banana, 0.45);
          fx.spawn(WX + COLS * C / 2, WY + (row + 2) * C, 24, 95, SP_WHITE, SP_BANANA, 0.8);
          out.cue("big"); out.crack(true); out.shake(0.6);
        }
        if (S.levelUp) {
          S.level = level; status.round = level;
          S.speed = Math.max(FALL_MIN, FALL0 * Math.pow(FALL_K, level - 1));
          out.cue("round");
          J.flash(INK.teal, 0.25);
        }
      };
      // The stone settles: a flash and a puff of dust, then any full rows crumble, or the combo and the fire go out.
      const land = () => {
        const o = (S.t * 4 + S.r) * 8;
        let above = false, low = 0;
        if (S.dropped) { add(S.dropped); S.dropped = 0; }
        for (let k = 0; k < 8; k += 2) {
          const c = S.x + SHAPE[o + k], w = S.y + SHAPE[o + k + 1];
          if (w < 0) { above = true; continue; }
          B[w * COLS + c] = S.t + 1; FL[w * COLS + c] = 0.14;
          if (w > low) low = w;
        }
        fx.spawn(WX + (S.x + BOX[S.t] / 2) * C, WY + (low + 1) * C, 6, 24, SP_DUST, SP_DUST, 0.35);
        out.cue("thunk", 0.7);
        if (above) { topple(false); return; }
        let n = 0, rubble = 0, first = 0;
        for (let w = 0; w < ROWS; w++) {
          let full = 1, junk = 0;
          for (let c = 0; c < COLS; c++) { const v = B[w * COLS + c]; if (!v) { full = 0; break; } if (v >= RUBBLE) junk = 1; }
          CLR[w] = full;
          if (full && !n++) first = w;
          rubble += full & junk;
        }
        if (!n) {
          if (S.fire) { S.fire = 0; status.fire = false; fx.spawn(WX + COLS * C / 2, WY + 4, 10, 30, SP_DUST, SP_DUST, 0.7); }
          S.combo = 0; status.streak = 0; status.mult = 1;
          measure();
          spawn();
          return;
        }
        scored(n, rubble, first);
        phase = "clear"; S.clearT = CLEAR + CLEAR_MORE * (n - 1);
        setVerb();
      };
      // The crumbled rows go and everything above drops; a well left empty is a swept cave.
      const collapse = () => {
        let w = ROWS - 1;
        for (let r = ROWS - 1; r >= 0; r--) {
          if (CLR[r]) { CLR[r] = 0; continue; }
          if (w !== r) { B.copyWithin(w * COLS, r * COLS, r * COLS + COLS); FL.copyWithin(w * COLS, r * COLS, r * COLS + COLS); }
          w--;
        }
        if (w >= 0) { B.fill(0, 0, (w + 1) * COLS); FL.fill(0, 0, (w + 1) * COLS); }
        measure();
        if (S.top === ROWS) {
          add(SWEPT_PAY * S.level);
          callout(5, SWEPT_PAY * S.level, 9);
          out.crack(true); out.cue("win");
          J.flash(INK.teal, 0.4);
        }
        spawn();
      };
      // The mammoth's stomp: everything rises a row and rubble comes up under it, its gap most often over the last.
      const rumble = () => {
        for (let c = 0; c < COLS; c++) if (B[c]) { topple(true); return; }
        B.copyWithin(0, COLS, N); FL.copyWithin(0, COLS, N);
        if (!R.chance(SAME_GAP)) S.gap = R.int(COLS);
        for (let c = 0; c < COLS; c++) { B[N - COLS + c] = c === S.gap ? 0 : R.chance(0.25) ? BONE : RUBBLE; FL[N - COLS + c] = 0; }
        if (hit(S.t, S.r, S.x, S.y)) S.y--;
        settle();
        measure();
        for (let c = 0; c < COLS; c++) fx.spawn(WX + c * C + 3, WY + ROWS * C - 2, 2, 30, SP_RUBBLE, SP_BONE, 0.5);
        J.shake(2);
        out.shake(0.35); out.cue("roll", 0.7);
        S.stomp = STOMP; S.rumbleCall = 1;
      };
      const rumbleIn = () => Math.max(RUMBLE_MIN, RUMBLE0 - RUMBLE_STEP * (S.level - 1));
      // One fixed step: a turn as up goes down, the slide (a step a press or drag notch, and held, a repeat after a
      // charge), gravity (fast while a drop is held), the lock, the mammoth's clock, the crumble and the stack turning
      // to stone at the end.
      const step = (h) => {
        const hold = aim.hold, up = aim.y < 0 ? 1 : 0;
        if (hold !== S.dasDir) { S.dasDir = hold; S.dasT = S.arr = 0; }
        else if (hold) S.dasT += h;
        if (up !== S.up) { S.up = up; if (up) turn(); }
        if (phase === "fall") {
          const d = aim.steps - S.steps;
          S.steps = aim.steps;
          let moves = 0;
          for (let k = 0; k < d; k++) if (shift(1)) moves++; else break;
          for (let k = 0; k > d; k--) if (shift(-1)) moves++; else break;
          if (moves) out.cue("tick", 0.2);
          if (hold && S.dasT >= DAS) {
            S.arr += h;
            while (S.arr >= ARR) { S.arr -= ARR; if (!shift(hold)) { S.arr = 0; break; } }
          }
          // A drop held from before this stone came in waits to be let go, so it never carries on into the next one.
          if (!(aim.y > 0)) S.soft = 0;
          else if (!S.soft) S.soft = 1;
          const fall = S.soft === 1 && S.speed > SOFT ? SOFT : S.speed;
          S.fall += h;
          while (S.fall >= fall) {
            S.fall -= fall;
            if (hit(S.t, S.r, S.x, S.y + 1)) { S.fall = 0; break; }
            S.y++; S.lock = 0;
            if (S.soft === 1) S.dropped++;
          }
          settle();
          if (S.grounded) { S.lock += h; if (S.lock >= LOCK) { land(); return; } }
          S.rumbleT -= h;
          if (!S.warned && S.rumbleT <= WARN) { S.warned = 1; S.stompT = 0; }
          if (S.rumbleT <= 0) { rumble(); S.rumbleT = rumbleIn(); S.warned = 0; }
        } else if (phase === "clear") {
          S.clearT -= h;
          if (S.clearT <= 0) collapse();
        } else if (phase === "over") {
          S.overT += h;
          if (S.overT >= OVER) finish();
        }
      };
      const run = stepper(step);

      // ---- drawing --------------------------------------------------------------------------------------------
      const drawStone = (ctx, t, r, x, y, img) => {
        const o = (t * 4 + r) * 8;
        for (let k = 0; k < 8; k += 2) {
          const w = y + SHAPE[o + k + 1] * C;
          if (w >= WY) ctx.drawImage(img, x + SHAPE[o + k] * C, w);
        }
      };
      const drawWell = (ctx) => {
        const crumbling = phase === "clear", flash = (S.clearT * 16 | 0) % 2 === 0, stone = phase === "over" || phase === "done";
        const grey = phase === "done" ? ROWS : (S.overT / PETRIFY) | 0;
        for (let w = 0; w < ROWS; w++) {
          const y = WY + w * C, gone = crumbling && CLR[w], dead = stone && ROWS - 1 - w < grey;
          for (let c = 0; c < COLS; c++) {
            const i = w * COLS + c, v = B[i];
            if (!v) continue;
            ctx.drawImage(gone ? (flash ? A.white : A.cells[v]) : dead ? A.grey : FL[i] > 0 ? A.white : A.cells[v], WX + c * C, y);
          }
        }
        if (phase !== "fall") return;
        let gy = S.y;
        while (!hit(S.t, S.r, S.x, gy + 1)) gy++;
        const px = WX + S.x * C + (S.wob > 0 ? ((S.clock * 60 | 0) & 1 ? 1 : -1) : 0);
        if (gy > S.y + 1) drawStone(ctx, S.t, S.r, px, WY + gy * C, A.ghost);
        const blink = S.grounded && S.lock > LOCK * 0.55 && (S.clock * 24 | 0) % 2;
        drawStone(ctx, S.t, S.r, px, WY + S.y * C, blink ? A.white : A.cells[S.t + 1]);
      };
      // The danger glow on the walls once the stack reaches the top four rows, and the fire along them while it burns.
      const drawRim = (ctx) => {
        if (S.top < 4 && phase === "fall") {
          const glow = A.glow[(S.clock * 12 | 0) & 7];
          ctx.drawImage(glow, WX - 4, WY); ctx.drawImage(glow, WX + COLS * C, WY);
        }
        if (!S.fire) return;
        // Flames licking up the walls' inner faces and off their tops.
        const lick = (S.clock * 24) & 3;
        for (let y = WY + lick, k = 0; y < WY + ROWS * C - 1; y += 4, k++) {
          ctx.fillStyle = k & 1 ? INK.gold : INK.ember;
          ctx.fillRect(WX - 1, y, 1, 2); ctx.fillRect(WX + COLS * C, y + 2 - (k & 1), 1, 2);
        }
        for (let k = 0; k < 6; k++) {
          const hl = (4 + 3 * Math.sin(S.clock * (11 + k) + k * 1.9)) | 0;
          ctx.fillStyle = k & 1 ? INK.ember : INK.gold;
          ctx.fillRect(RIM_X[k], WY - hl, 1, hl);
        }
      };
      // A strip of dark under a line of text across the well, so it reads over the stones.
      const strip = (ctx, y, h) => ctx.drawImage(A.strip, 0, 0, COLS * C, h, WX, y, COLS * C, h);
      const drawCalls = (ctx) => {
        if (S.callT > 0 && (S.callT > 0.3 || (S.clock * 16 | 0) % 2)) {
          const word = S.call > 1, big = S.call === 4, lv = S.levelUp ? 10 : 0, y = S.callY + (S.callT > 0.9 ? ((S.callT - 0.9) * 30) | 0 : 0);
          strip(ctx, y - 2 - lv, (word ? (big ? 26 : 19) : 11) + lv);
          if (lv) centre(ctx, "LEVEL UP", y - 10, TEXT.teal);
          if (word) centre(ctx, WORDS[S.call], y, big ? TEXT.banana : S.call === 5 ? TEXT.teal : S.call > 2 ? TEXT.gold : TEXT.bone, big ? 2 : 1);
          number(ctx, S.callPts, W / 2, y + (word ? (big ? 16 : 9) : 0), TEXT.banana, 1, 1);
        }
      };
      const drawPanels = (ctx) => {
        number(ctx, status.score, 3, 1, TEXT.gold, 1, 0, 6);
        if (S.fire) text(ctx, "X2", 42, 1, TEXT.ember);
        text(ctx, "LV", 131, 1, TEXT.teal);
        number(ctx, S.level, 157, 1, TEXT.teal, 1, 2);
        // The rumble named in the band over the well, never over the rubble row it brought up.
        if (S.rumbleCall > 0 && (S.clock * 12 | 0) % 2) centre(ctx, "RUMBLE!", 1, TEXT.ember);
        // The next stone, hanging from a pterodactyl, turned as the next press asked.
        const f = (S.clock * 6 | 0) & 1, t = S.next, r = t === 1 ? 0 : S.pre & 3, o = (t * 4 + r) * 8;
        let x0 = 9, x1 = 0, y0 = 9, y1 = 0;
        for (let k = 0; k < 8; k += 2) { const x = SHAPE[o + k], y = SHAPE[o + k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const top = 43 - (((y1 - y0 + 1) * C) >> 1) + f;
        ctx.drawImage(inv.kinds[0][f].canvas, 18, Math.max(21, top - 8));
        drawStone(ctx, t, r, 24 - (((x1 + x0 + 1) * C) >> 1), top - y0 * C, A.cells[t + 1]);
        number(ctx, S.lines, 24, 71, TEXT.bone, 2, 1);
        number(ctx, host.best || 0, 24, 94, TEXT.gold, 1, 1);
        // The fire bowl, roaring while the stones burn.
        const tall = S.fire ? 9 : 4;
        for (let k = 0; k < 6; k++) {
          const hl = 1 + ((tall * (0.55 + 0.45 * Math.sin(S.clock * (7 + k * 1.7) + k * 2))) | 0);
          ctx.fillStyle = k % 3 === 1 ? INK.banana : k & 1 ? INK.gold : INK.ember;
          ctx.fillRect(17 + k * 2, 111 - hl, 2, hl);
        }
        // The mammoth, stomping as its rubble comes, over the meter filling toward it.
        const warn = S.warned && phase === "fall", mf = warn ? (S.clock * 8 | 0) & 1 : (S.clock * 2 | 0) & 1;
        ctx.drawImage(inv.mammoth[0][mf].canvas, 128 + (S.stomp > 0 ? (S.clock * 40 | 0) & 1 : 0), 14 + (warn && mf ? 1 : 0));
        const full = phase === "idle" ? 0 : Math.max(0, Math.min(36, (36 * (1 - S.rumbleT / rumbleIn())) | 0));
        ctx.fillStyle = warn && (S.clock * 8 | 0) % 2 ? INK.red : INK.ochre;
        ctx.fillRect(118, 28, full, 3);
        if (S.combo > 1) { text(ctx, "X", 124, 44, S.fire ? TEXT.ember : TEXT.bone, 2); number(ctx, S.combo, 138, 44, S.fire ? TEXT.ember : TEXT.bone, 2); }
        if (S.fire && (S.clock * 4 | 0) % 2) text(ctx, "FIRE!", 121, 62, TEXT.ember);
        // The Ooga: arms up at a clear, jittery near the top, idle otherwise.
        const scared = S.top < 4 && phase === "fall", of = S.cheer > 0 ? 2 : scared ? (S.clock * 10 | 0) & 1 : (S.clock * 1.5 | 0) & 1;
        ctx.drawImage(inv.ooga[of].canvas, 125 + (scared ? (S.clock * 20 | 0) & 1 : 0), 92 - (S.cheer > 0.2 ? 3 : 0), 22, 22);
      };
      const drawAttract = (ctx) => {
        for (let i = 0; i < DEMO.length; i++) if (DEMO[i]) ctx.drawImage(A.cells[DEMO[i]], WX + (i % COLS) * C, WY + (11 + ((i / COLS) | 0)) * C);
        const k = (S.clock * 3) % 10, r = (S.clock * 1.5 | 0) & 3;
        drawStone(ctx, 2, r, WX + 3 * C, WY + ((k | 0) - 1) * C, A.cells[3]);
        ctx.globalAlpha = 0.78; ctx.fillStyle = INK.night; ctx.fillRect(0, 14, W, 38); ctx.fillRect(0, 99, W, 13); ctx.globalAlpha = 1;
        centre(ctx, "STONE", 17, TEXT.gold, 2);
        centre(ctx, "STACKER", 34, TEXT.pink, 2);
        if ((S.clock * 1.6 | 0) % 2) centre(ctx, "PRESS START", 102, TEXT.bone);
      };
      const drawBanner = (ctx) => {
        if (phase !== "done") return;
        ctx.globalAlpha = 0.6; ctx.fillStyle = INK.night; ctx.fillRect(0, 30, W, 52); ctx.globalAlpha = 1;
        centre(ctx, "GAME OVER", 38, TEXT.red, 2);
        centre(ctx, "SCORE", 58, TEXT.stone);
        number(ctx, status.score, W / 2, 68, TEXT.banana, 1, 1);
      };

      const reset = () => {
        B.fill(0); FL.fill(0); CLR.fill(0);
        fx.clear(); J.reset();
        S.combo = S.fire = S.warned = S.pre = S.wob = S.cheer = S.stomp = S.callT = S.levelUp = S.rumbleCall = S.overT = S.soft = S.dropped = 0;
        S.dasDir = aim.hold; S.dasT = S.arr = 0; S.steps = aim.steps; S.up = aim.y < 0 ? 1 : 0; S.top = ROWS;
        status.fire = false; status.meter = -1; status.target = 0; status.note = ""; status.streak = 0; status.mult = 1;
      };
      reset();
      return {
        kind: "stacker", name: "Stone Stacker", aims: true, status, roundLabel: "Level", notch: 1.5 * C / W,
        help: "A and D, the arrows or a swipe move the stone, S or down drops it; Space, W or a tap turns it. Full rows crumble; four at once is an OOGA clear.",
        coach: ["A and D move, S drops, Space turns", "Swipe moves, pull down drops, tap turns"],
        stars: [1000, 2500, 12000], tickets: (score) => Math.min(60, Math.floor(score / 250)),
        get playing() { return phase !== "idle" && phase !== "done"; },
        get seed() { return S.seed; },
        start: (seed) => {
          if (Number.isInteger(seed)) { R.seed(seed); S.seed = seed; } else S.seed = R.fresh();
          reset();
          status.score = 0; status.left = 0; status.round = 1;
          S.lines = S.pieces = S.oogas = S.bestCombo = 0; S.level = 1; S.speed = FALL0; S.rumbleT = rumbleIn();
          // Three rows of rubble: over a row with a gap of its own, two with a gap two wide, which the square dealt
          // first fills for a double.
          const wide = R.int(COLS - 1);
          S.gap = R.int(COLS);
          for (let i = N - 3 * COLS; i < N; i++) {
            const c = i % COLS, open = i < N - COLS ? c === wide || c === wide + 1 : c === S.gap;
            B[i] = open ? 0 : R.chance(0.25) ? BONE : RUBBLE;
          }
          S.bag = 7; deal(); S.bag = 0;
          for (let i = 0; i < 7; i++) if (BAG[i] === 1) { BAG[i] = BAG[0]; BAG[0] = 1; }
          S.next = deal();
          measure();
          spawn();
        },
        stop: () => { phase = "idle"; reset(); S.level = 1; S.lines = 0; status.round = 1; status.left = 0; setVerb(); },
        act: turn,
        update: (dt) => {
          S.clock += dt;
          J.update(dt);
          fx.update(dt);
          for (let i = 0; i < N; i++) if (FL[i] > 0) FL[i] -= dt;
          S.callT = Math.max(0, S.callT - dt); S.cheer = Math.max(0, S.cheer - dt);
          S.stomp = Math.max(0, S.stomp - dt); S.wob = Math.max(0, S.wob - dt); S.rumbleCall = Math.max(0, S.rumbleCall - dt);
          if (phase === "idle" || phase === "done") { S.steps = aim.steps; S.up = aim.y < 0 ? 1 : 0; return; }
          run(dt);
          if (phase !== "fall") return;
          // The mammoth's stomps as its rubble comes, the heart beating near the top, and embers off the burning rim.
          if (S.warned && (S.stompT -= dt) <= 0) { S.stompT = STOMP; J.shake(1); out.cue("knock", 0.45); }
          if (S.top < 4 && (S.beatT -= dt) <= 0) { S.beatT = 0.55; out.cue("tap", 0.35); }
          if (S.fire && (S.emberT -= dt) <= 0) { S.emberT = 0.06; fx.spawn((S.clock * 10 | 0) & 1 ? WX - 2 : WX + COLS * C + 2, WY - 2, 1, 22, SP_EMBER, SP_BANANA, 0.6); }
        },
        draw: (ctx) => {
          ctx.drawImage(A.back, 0, 0);
          if (phase === "idle") {
            drawPanels(ctx);
            drawAttract(ctx);
            return;
          }
          J.begin(ctx);
          drawWell(ctx);
          drawRim(ctx);
          fx.draw(ctx);
          drawCalls(ctx);
          J.end(ctx);
          drawPanels(ctx);
          drawBanner(ctx);
        }
      };
    };
  })();

  BL.retroGames = { kit, invaders, snake, pong, stampede, flap, breaker, dash, stacker };
})();
