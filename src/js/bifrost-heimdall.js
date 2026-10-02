// Heimdall, who keeps ₿IFRÖST's bridge: a voxel caveman grown half again as tall and dressed as the watchman of the
// gods in the concept's colours, standing on a round rune-cut step on the islet's court at the foot of the gate's
// stairs. He is built as the boat passengers are, a clone of `models.caveman` from hashed traits and dress hooks, never
// a `src/characters/` file, which would sign him up to the crew. His head is a navy great helm banded in gold, his
// far-seeing eyes burning blue in its visor slit and two golden horns rising from its sides and forking at the tips.
// He wears a long navy coat trimmed in gold with a ₿ medallion on the chest, broad gold-rimmed pauldrons, gold cuffs,
// dark boots and a navy cape bearing the banners' white bind rune. In his right hand stands a tall staff crowned with a
// glowing blue crystal, and Gjallarhorn hangs at his left hip.
//
// Here he is posed and given his few moods. He breathes and lets his gaze drift over the sea; he turns to whoever comes
// within sight, raises his staff to hail a played Ooga that walks up, mutters now and then, and at a tap lifts
// Gjallarhorn from his hip to his lips and blows it, gold sparks leaping from the bell. `create` builds one visit's
// Heimdall under the hub's root and returns the root, the node to pick him by, the step to add to the solids, and
// `update`, `poke` and `dispose`. Every accessory is built once for the page: the voxel ones in the caveman's own bake,
// the rest at his unit height and scaled by it on its node. `update` allocates nothing.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { cached, geometry, box, lathe, ring, tube, merge, forward, moved, turnedY, turnedZ, makeVox } = models;
  const { createNode, addChild, updateWorld } = BL.scene;
  const { damp, clamp, quat } = math;
  const BM = BL.bifrostModels, FM = BL.factoryModels;
  const { STONE, STONE_DK, BRONZE, GOLD, FIELD, FIELD_LT } = BM.PALETTE;
  const TAU = Math.PI * 2;

  // No GitHub login holds a slash, so his template in `models.caveman`'s cache never meets a contributor's.
  const NAME = "heimdall/bifrost";
  // His build in the caveman's own units, where 1 is his `HEIGHT` in metres before the root's `SCALE`: the hip `LEG`
  // up, the shoulders `ARM_X` either side (buildCaveman's formula at his `BELLY`).
  const HEIGHT = 1.1, BELLY = 1.08, SCALE = 1.35, LEG = 5 / 16, ARM_X = 0.29 * BELLY + 0.09, STATURE = HEIGHT * SCALE;
  // The step he stands on, in metres: its radius and top, and the column of its collision shell round him, `column`
  // across and up to `crown`, so a walker bumps into him rather than through him but can still step onto the rim.
  const PLINTH = { r: 0.95, top: 0.24, column: 0.6, crown: 2.1 };
  // Above the ground under the step: his eyes, and where his bubbles hang, clear of the helmet's horns.
  const EYE_Y = PLINTH.top + STATURE * (LEG + 0.5 + 0.19), SAY_Y = PLINTH.top + STATURE * (LEG + 0.5 + 0.9);

  const LOOK = {
    navy: "#1c2c6e", navyDk: "#131d4c", gold: "#e8b53a", goldLt: "#ffd66b", goldDk: "#b8791a", glove: "#3d2616",
    boot: "#161a2e", slit: "#070a16", eye: "#9fe6ff", rune: "#eef2fa", wood: "#6b4424", ivory: "#f4ecd8",
    ivoryDk: "#d6c49a", throat: "#2a1a0e", crystalDk: "#2a5fd6", crystalLt: "#8fd0ff", crystalCore: "#e6f9ff"
  };
  // Cloth woven from two tones by the cell, never drawn from `k.rand`, so the jitter needs no draws.
  const weave = (a, b) => (x, y, z) => (x * 3 + y * 5 + z * 7) % 5 === 0 ? b : a;

  // ---- his pose --------------------------------------------------------------------------------------

  // His arms at rest, in the angles models.buildCaveman's arms take (z outward on either side). The engine's `armR`
  // hangs at +x, his left as he faces +z, by Gjallarhorn at his hip; `armL` at -x, his right, reaches forward to hold
  // the staff upright on the step's rim, the staff leaning out by `lean`. `GRIP` is the fist's middle down the arm.
  const REST = { x: -0.2, z: 0.2 };
  const STAFF = { x: -0.74, z: 0, lean: 0.05 };
  const GRIP = 10 / 16;
  // How far the staff reaches below the fist to stand on the step at rest, a hair into the stone.
  const STAFF_BELOW = (0.46 - GRIP * Math.cos(STAFF.x) * Math.cos(STAFF.z) + LEG) / Math.cos(STAFF.lean) + 0.01;

  // A rotation matrix m[row][col] as a unit quaternion [x, y, z, w] with w >= 0, the way fromTQS reads one back.
  const quatOf = (m) => {
    const tr = m[0][0] + m[1][1] + m[2][2];
    let x, y, z, w;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      w = 0.25 / s; x = (m[2][1] - m[1][2]) * s; y = (m[0][2] - m[2][0]) * s; z = (m[1][0] - m[0][1]) * s;
    } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
      const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
      w = (m[2][1] - m[1][2]) / s; x = 0.25 * s; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s;
    } else if (m[1][1] > m[2][2]) {
      const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
      w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = 0.25 * s; z = (m[1][2] + m[2][1]) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
      w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = 0.25 * s;
    }
    return w < 0 ? [-x, -y, -z, -w] : [x, y, z, w];
  };
  // An arm's axes in the body at angles (x, z), in fromTRS's order with no yaw.
  const armAxes = (x, z) => {
    const cx = Math.cos(x), sx = Math.sin(x), cz = Math.cos(z), sz = Math.sin(z);
    return [[cz, cx * sz, sx * sz], [-sz, cx * cz, sx * cz], [0, -sx, cx]];
  };
  // The horn's axes in the body when its sweep points along the unit `aim`: curling upward, and across to match.
  const hornAxes = (aim) => {
    const ul = Math.hypot(aim[0] * aim[1], 1 - aim[1] * aim[1], aim[2] * aim[1]);
    const up = [-aim[0] * aim[1] / ul, (1 - aim[1] * aim[1]) / ul, -aim[2] * aim[1] / ul];
    return [[up[1] * aim[2] - up[2] * aim[1], up[2] * aim[0] - up[0] * aim[2], up[0] * aim[1] - up[1] * aim[0]], up, aim];
  };
  // The horn's turn in an arm's frame, from both sets of axes in the body.
  const inArm = (arm, horn) => quatOf(arm.map((a) => horn.map((h) => a[0] * h[0] + a[1] * h[1] + a[2] * h[2])));

  // The pose he blows the horn in, solved once in his own units: the head tipped back by `pitch`, the mouthpiece at
  // the helm's face plate pointing `aim` (ahead and a little up), and the left arm reaching the grip, the club's spot
  // in the fist (`grip` down the arm and `cuff` forward). How long the mouthpiece must be for that reach to come out
  // exact is `lm`, and the horn is built to it, so pose and horn agree. `x` and `z` are the arm's angles there, and `q`
  // the horn's turn in the hand, which `update` eases in from `HANG` as he lifts it.
  const BLOW = (() => {
    const pitch = -0.22, grip = 0.62, cuff = 0.08, lipY = 0.13, lipZ = 0.27, sp = Math.sin(pitch), cp = Math.cos(pitch);
    const mouth = [0, 0.5 + lipY * cp - lipZ * sp, 0.02 + lipY * sp + lipZ * cp], shoulder = [ARM_X, 0.46, 0];
    const al = Math.hypot(0.3, 0.95), aim = [0, 0.3 / al, 0.95 / al];
    const d = [mouth[0] - shoulder[0], mouth[1] - shoulder[1], mouth[2] - shoulder[2]];
    const along = d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2];
    const lm = -along + Math.sqrt(along * along - (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) + grip * grip + cuff * cuff);
    // Where the grip must go from the shoulder, then the roll that carries it across and the swing that lifts it.
    const tx = d[0] + lm * aim[0], ty = d[1] + lm * aim[1], tz = d[2] + lm * aim[2];
    const sz = tx / grip, cz = Math.sqrt(1 - sz * sz), A = grip * cz, det = A * A + cuff * cuff;
    const x = Math.atan2((-cuff * ty - A * tz) / det, (-A * ty + cuff * tz) / det), z = Math.asin(sz);
    return { pitch, x, z, lm, q: inArm(armAxes(x, z), hornAxes(aim)) };
  })();
  // How Gjallarhorn hangs at his hip in the resting fist: slung back along his thigh, its bell behind him curling up and
  // its mouthpiece forward. Signed to lie on BLOW's side, so easing from one to the other takes the short way round.
  const HANG = (() => {
    const l = Math.hypot(0.45, 0.89), q = inArm(armAxes(REST.x, REST.z), hornAxes([0, -0.45 / l, -0.89 / l]));
    return q[0] * BLOW.q[0] + q[1] * BLOW.q[1] + q[2] * BLOW.q[2] + q[3] * BLOW.q[3] < 0 ? q.map((c) => -c) : q;
  })();
  // The staff's turn in the fist that undoes the arm's, so it stands upright in the body whatever the arm does,
  // leaning out by `STAFF.lean` (out is toward -x, a positive roll). `TURN` is scratch.
  const LEAN = quat.fromEuler(quat.create(), 0, 0, STAFF.lean), TURN = quat.create();
  const upright = (out, arm) => {
    quat.fromEuler(TURN, arm.rotation.x, 0, arm.rotation.z);
    TURN[0] = -TURN[0];
    TURN[1] = -TURN[1];
    TURN[2] = -TURN[2];
    return quat.multiply(out, TURN, LEAN);
  };

  // ---- the gear, at his unit height ------------------------------------------------------------------

  // A chunky rod of blocks stepped along the polyline `points` [[x, y], ...] in the plane z 0, every block square to the
  // axes as the island's voxels are, `w0` across at its root and `w1` at its tip, its colours running root to tip.
  const ROD_STEP = 0.028;
  const rod = (points, w0, w1, colors, emissive) => {
    const lens = [0], parts = [];
    for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const total = lens[lens.length - 1], n = Math.ceil(total / ROD_STEP);
    for (let k = 0, i = 1; k <= n; k++) {
      const d = total * k / n, t = k / n, w = w0 + (w1 - w0) * t;
      while (i < points.length - 1 && lens[i] < d) i++;
      const a = points[i - 1], b = points[i], f = (d - lens[i - 1]) / (lens[i] - lens[i - 1]);
      parts.push(box({ w, h: w, d: w, color: colors[Math.min(colors.length - 1, Math.floor(t * colors.length))], emissive, offset: { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f } }));
    }
    return merge(...parts);
  };

  // The helmet's right horn in head space, where the helm's sides stand at x ±0.28 and its crown at y 0.5: [x, y]
  // points from its root in the helm's side out, then up, curling out at the tip, and the two tines it forks into,
  // one near the tip and one lower down, both turning inward. The left horn is its mirror.
  const HELM_HORN = [[0.25, 0.35], [0.33, 0.365], [0.385, 0.4], [0.415, 0.46], [0.425, 0.54], [0.43, 0.62], [0.44, 0.69], [0.47, 0.75], [0.51, 0.79], [0.545, 0.805]];
  const HELM_TINES = [[[0.44, 0.67], [0.41, 0.73], [0.395, 0.785]], [[0.425, 0.5], [0.385, 0.545], [0.37, 0.585]]];
  // Both horns in gold blocks, glinting, each rooted in a gold boss on the helm's side.
  const helmHorns = cached(() => {
    const golds = [LOOK.goldDk, LOOK.gold, LOOK.gold, LOOK.goldLt], parts = [];
    for (const s of [-1, 1]) {
      const side = (points) => points.map(([x, y]) => [s * x, y]);
      parts.push(rod(side(HELM_HORN), 0.075, 0.04, golds, 0.15));
      for (const tine of HELM_TINES) parts.push(rod(side(tine), 0.045, 0.03, golds.slice(1), 0.15));
      parts.push(box({ w: 0.05, h: 0.11, d: 0.12, color: LOOK.goldDk, offset: { x: s * 0.29, y: 0.35 } }));
    }
    return merge(...parts);
  });

  // A crystal of the portal's blue: two pyramids joined at a flattened girdle `w` either side and `d` deep at `y`, its
  // point at `top` and its foot at `foot`. Every facet is a pale core inside a blue border, brightest on the front, so
  // it seems lit from within.
  const crystal = (y, top, foot, w, d) => {
    const geo = geometry(), girdle = [[-w, y, 0], [0, y, d], [w, y, 0], [0, y, -d]];
    for (const [tip, border, cores] of [[[0, top, 0], FIELD, [LOOK.crystalCore, FIELD_LT]], [[0, foot, 0], LOOK.crystalDk, [FIELD_LT, LOOK.crystalLt]]]) {
      for (let i = 0; i < 4; i++) {
        const tri = [tip, girdle[i], girdle[(i + 1) % 4]];
        const mid = [0, 1, 2].map((k) => (tri[0][k] + tri[1][k] + tri[2][k]) / 3);
        const core = tri.map((p) => p.map((c, k) => mid[k] + (c - mid[k]) * 0.5));
        // A point out past the facet from the crystal's middle, which BM.facing winds each face toward.
        const ox = 2 * mid[0], oy = 2 * mid[1] - y, oz = 2 * mid[2];
        BM.facing(geo, core, cores[i < 2 ? 0 : 1], 1, ox, oy, oz);
        for (let k = 0; k < 3; k++) BM.facing(geo, [tri[k], tri[(k + 1) % 3], core[(k + 1) % 3], core[k]], border, 0.85, ox, oy, oz);
      }
    }
    return geo;
  };
  // The staff in its own frame, upright with the fist's grip at the origin: a squared shaft of dark wood bound in gold
  // and shod in gold where it stands on the step, and at its head a gold crown whose two curls cradle the crystal.
  // `STAFF_CURL` is the right curl's [x, y] path; `STAFF_TOP` is the crystal's point above the grip.
  const STAFF_CURL = [[0.05, 1], [0.095, 1.03], [0.13, 1.08], [0.145, 1.14], [0.135, 1.2], [0.11, 1.245]];
  const STAFF_TOP = 1.46;
  const staff = cached(() => {
    const foot = -STAFF_BELOW, band = (y, h, w, color) => box({ w, h, d: w, color, offset: { y } });
    const parts = [FM.beam(0, foot, 0, 0, 0.99, 0, 0.056, LOOK.wood), band(foot + 0.04, 0.08, 0.072, LOOK.goldDk)];
    for (const y of [0.2, 0.5, 0.78]) parts.push(band(y, 0.032, 0.07, LOOK.gold));
    parts.push(band(0.95, 0.05, 0.08, LOOK.goldDk), band(0.995, 0.04, 0.1, LOOK.gold));
    for (const s of [-1, 1]) parts.push(rod(STAFF_CURL.map(([x, y]) => [s * x, y]), 0.042, 0.026, [LOOK.goldDk, LOOK.gold, LOOK.goldLt], 0.2));
    parts.push(crystal(1.13, STAFF_TOP, 1, 0.115, 0.065));
    return merge(...parts);
  });

  // Gjallarhorn, in the hand's frame: the grip at the origin, the mouthpiece `BLOW.lm` back along -z, and the horn
  // sweeping forward and curling upward through `sweep` radians of a bend `bend` across, swelling from a gold
  // mouthpiece through ivory to a flared bell rimmed in gold, with raised gold bands along it and a dark throat inside
  // the bell. `bell` is a point just past the bell's mouth, where the sparks leap from. The ivory is shaded smooth.
  const HORN = { bend: 0.36, sweep: 1.25 };
  const horn = cached(() => {
    const { bend, sweep } = HORN, lm = BLOW.lm, arc = bend * sweep, total = lm + arc;
    // Built running along +x and curling to +y, where `tube` keeps a steady frame, then turned to run along +z.
    const at = (s) => {
      if (s <= lm) return { x: s - lm, y: 0, z: 0 };
      const a = (s - lm) / bend;
      return { x: bend * Math.sin(a), y: bend * (1 - Math.cos(a)), z: 0 };
    };
    const girth = (s) => {
      if (s <= lm) return 0.017 + 0.007 * s / lm;
      const q = (s - lm) / arc;
      return 0.024 + 0.03 * q * Math.sqrt(q) + (q > 0.86 ? 0.036 * ((q - 0.86) / 0.14) ** 2 : 0);
    };
    const span = (s0, s1, grow, rings, colorFn) => tube({ path: (t) => at(s0 + (s1 - s0) * t), radius: (t) => girth(s0 + (s1 - s0) * t) + grow, rings, segments: 10, colorFn });
    const body = turnedY(span(0, total, 0, 24, (t) => {
      if (t * total < lm * 0.55) return GOLD;
      const tone = BM.blend(LOOK.ivoryDk, LOOK.ivory, Math.min(1, t * 1.3));
      return Math.round(t * 24) % 4 === 2 ? BM.blend(tone, LOOK.ivoryDk, 0.45) : tone;
    }), -Math.PI / 2);
    body.smooth = true;
    const trim = [lm, lm + arc * 0.34, lm + arc * 0.66].map((s) => span(s - 0.013, s + 0.013, 0.007, 2, () => GOLD));
    trim.push(span(total - 0.022, total, 0.006, 2, () => GOLD));
    const end = at(total - 0.012);
    trim.push(moved(turnedZ(lathe({ profile: [[0, 0], [girth(total) * 0.92, 0]], segments: 10, color: LOOK.throat }), Math.PI / 2 + sweep), end.x, end.y, 0));
    const tip = at(total + 0.05);
    return { geometry: BL.hubModels.flatInto(body, ...trim.map((g) => turnedY(g, -Math.PI / 2))), bell: { x: 0, y: tip.y, z: tip.x } };
  });

  // The ₿ medallion on his chest, where the coat's gold lapels meet: a gold disc in a bright ring, the ₿ raised on it
  // and glowing. `F` is the chest's face at his belly.
  const medallion = cached(() => {
    const F = 3 / 16 * BELLY, y = 0.33;
    return merge(
      moved(BM.disc(0.068, 0.022, LOOK.goldDk), 0, y, F + 0.011),
      moved(forward(ring({ r: 0.06, thickness: 0.009, segments: 16, color: LOOK.goldLt })), 0, y, F + 0.022),
      moved(FM.smoothBitcoin(0.085, 0.018, GOLD, 0.6), 0, y, F + 0.026)
    );
  });

  // The cape, hung from a pivot behind his shoulders (`y`, `z` in the body, `rest` its resting tilt), in the caveman's
  // own blocks: a collar two deep against his back, gold over navy, then navy cloth `drop` blocks down from the pivot
  // and eleven across, edged and hemmed in gold, with the banners' white bind rune on its back (`RUNE_CELLS`, [x, y]).
  const CAPE = { y: 0.5, z: -4.2 / 16, rest: 0.03, drop: 11 };
  const RUNE_CELLS = [[-2, -4], [0, -4], [2, -4], [-1, -5], [0, -5], [1, -5], [0, -6], [0, -7], [-1, -8], [0, -8], [1, -8], [-2, -9], [0, -9], [2, -9]];
  const capeVox = (T) => {
    const v = makeVox(), cloth = weave(T.navy, T.navyDk), drop = CAPE.drop;
    v.fill(-4, 4, -1, -1, 0, 1, T.gold);
    v.fill(-4, 4, -2, -2, 0, 1, cloth);
    v.fill(-5, 5, -drop, -3, 0, 0, (x, y, z) => x === -5 || x === 5 || y === -drop ? T.gold : cloth(x, y, z));
    for (const [x, y] of RUNE_CELLS) v.set(x, y, 0, T.rune);
    return v;
  };
  // The coat's skirts: a hollow ring of blocks flaring past the tunic from the waist to just above his boots, eleven
  // across and eight deep with its corners cut, navy hemmed in gold and open down the front between two gold edges.
  const skirtVox = (T) => {
    const v = makeVox(), cloth = weave(T.navy, T.navyDk);
    for (let x = 0; x <= 10; x++) for (let z = 0; z <= 7; z++) {
      const side = x === 0 || x === 10, end = z === 0 || z === 7;
      // Only the ring's walls, and never a corner.
      if (side === end) continue;
      for (let y = -3; y <= 1; y++) v.set(x, y, z, y === -3 ? T.gold : z === 7 && x >= 4 && x <= 6 ? (x === 5 ? T.navyDk : T.gold) : cloth(x, y, z));
    }
    return v;
  };

  // ---- the step --------------------------------------------------------------------------------------

  // Elder Futhark, as strokes [x0, y0, x1, y1] in a rune `width` wide and 1.5 tall with its foot at y 0.
  const RUNES = {
    H: [0.7, [[0, 0, 0, 1.5], [0.7, 0, 0.7, 1.5], [0, 1.05, 0.7, 0.45]]],
    E: [0.8, [[0, 0, 0, 1.5], [0.8, 0, 0.8, 1.5], [0, 1.5, 0.4, 1.05], [0.4, 1.05, 0.8, 1.5]]],
    I: [0, [[0, 0, 0, 1.5]]],
    M: [0.8, [[0, 0, 0, 1.5], [0.8, 0, 0.8, 1.5], [0, 1.5, 0.8, 0.85], [0.8, 1.5, 0, 0.85]]],
    D: [0.9, [[0, 0, 0, 1.5], [0.9, 0, 0.9, 1.5], [0, 1.5, 0.9, 0], [0, 0, 0.9, 1.5]]],
    A: [0.6, [[0, 0, 0, 1.5], [0, 1.5, 0.6, 1.1], [0, 1.05, 0.6, 0.65]]],
    L: [0.6, [[0, 0, 0, 1.5], [0, 1.5, 0.6, 1.05]]],
    B: [0.55, [[0, 0, 0, 1.5], [0, 1.5, 0.55, 1.12], [0.55, 1.12, 0, 0.75], [0, 0.75, 0.55, 0.38], [0.55, 0.38, 0, 0]]],
    F: [0.6, [[0, 0, 0, 1.5], [0, 1, 0.6, 1.4], [0, 0.6, 0.6, 1]]],
    R: [0.6, [[0, 0, 0, 1.5], [0, 1.5, 0.6, 1.15], [0.6, 1.15, 0, 0.8], [0, 0.8, 0.6, 0]]],
    O: [0.8, [[0.4, 1.5, 0.8, 1.05], [0.4, 1.5, 0, 1.05], [0.8, 1.05, 0, 0], [0, 1.05, 0.8, 0]]],
    S: [0.6, [[0.6, 1.5, 0, 1], [0, 1, 0.6, 0.5], [0.6, 0.5, 0, 0]]],
    T: [0.8, [[0.4, 0, 0.4, 1.5], [0, 1.1, 0.4, 1.5], [0.4, 1.5, 0.8, 1.1]]]
  };
  // Round the step, glowing gold, his name and his bridge's: HEIMDALL centred at his front, ₿IFRÖST at his back (its ₿
  // as berkanan), each followed by three dots. They read left to right from outside the ring, their feet outward.
  const RING_TEXT = "HEIMDALL:BIFROST:", RUNE = { r: 0.62, h: 0.15, w: 0.017 };
  // The step, in metres with its foot at y 0 and his front along +z: a round plinth of dark stone with a chamfered edge,
  // its top laid with pale flags round a dark disc where he stands, a gold inlay between them, a bronze rim, and the
  // runes. Its collision shell is a closed stepped column: the step itself, and `column` round him up to `crown`.
  const plinth = cached(() => {
    const { r, top, column, crown } = PLINTH, y = top + 0.003, parts = [];
    const up = (pts, color) => BM.facing(geometry(), pts, color, 0, pts[0][0], 50, pts[0][2]);
    parts.push(lathe({ profile: [[r, 0], [r, top - 0.05], [r - 0.04, top], [0, top]], segments: 28, color: (t) => t < 0.3 ? STONE_DK : t < 0.6 ? STONE[3] : "#2b2622" }));
    parts.push(lathe({ profile: [[0.36, y], [0, y]], segments: 20, color: STONE[1] }));
    parts.push(lathe({ profile: [[0.39, y + 0.001], [0.36, y + 0.001]], segments: 20, color: GOLD, emissive: 0.35 }));
    parts.push(lathe({ profile: [[r - 0.04, y + 0.001], [0.86, y + 0.001]], segments: 28, color: BRONZE }));
    const flags = ["#8d8275", "#83786c", "#978c7f"], gap = 0.02;
    for (let k = 0; k < 12; k++) {
      const a0 = k / 12 * TAU, a1 = a0 + TAU / 12, i0 = 0.4 + gap, i1 = 0.84 - gap, g0 = gap / i0, g1 = gap / i1;
      parts.push(up([[i0, a0 + g0], [i1, a0 + g1], [i1, (a0 + a1) / 2], [i1, a1 - g1], [i0, a1 - g0]].map(([rr, a]) => [Math.sin(a) * rr, y, Math.cos(a) * rr]), flags[(k * 5) % 3]));
    }
    const n = RING_TEXT.length, em = RUNE.h / 1.5, ry = top + 0.009;
    for (let i = 0; i < n; i++) {
      const a = (i - 3.5) / n * TAU, sa = Math.sin(a), ca = Math.cos(a), rune = RUNES[RING_TEXT[i]], width = rune ? rune[0] : 0;
      // Outward is (sin a, cos a) and reading on is (cos a, -sin a); a rune's top points in toward him.
      const at = (gx, gy) => { const rr = RUNE.r + RUNE.h / 2 - gy * em, tt = (gx - width / 2) * em; return [sa * rr + ca * tt, ca * rr - sa * tt]; };
      if (!rune) {
        for (const gy of [0.35, 0.75, 1.15]) { const [px, pz] = at(0, gy); parts.push(box({ w: 0.024, h: 0.016, d: 0.024, color: GOLD, emissive: 0.5, offset: { x: px, y: ry, z: pz } })); }
        continue;
      }
      for (const [x0, y0, x1, y1] of rune[1]) {
        const [ax, az] = at(x0, y0), [bx, bz] = at(x1, y1);
        parts.push(FM.beam(ax, ry, az, bx, ry, bz, RUNE.w, GOLD, 0.5));
      }
    }
    const geo = merge(...parts);
    geo.collisionGeometry = lathe({ profile: [[0, 0], [r, 0], [r, top], [column, top], [column, crown], [0, crown]], segments: 12, color: STONE_DK });
    return geo;
  });

  // ---- the man -------------------------------------------------------------------------------------

  // The colours of his voxels, joined to the caveman's palette once per build.
  const TONES = ["navy", "navyDk", "gold", "goldLt", "goldDk", "glove", "boot", "slit", "eye", "rune"];
  const tones = (k) => k.heimdall || (k.heimdall = Object.fromEntries(TONES.map((key) => [key, k.color(LOOK[key])])));
  // The dress hooks models.buildCaveman calls, in its order.
  const DRESS = {
    // A navy coat with a gold gorget at the throat, gold lapels running down and in to a gold band over the belly, and
    // a gold belt with a bright buckle; the loincloth's flaps are the tunic's, hidden under the skirts.
    torso(k, v) {
      const T = tones(k);
      v.fill(0, 8, 0, 6, 0, 5, weave(T.navy, T.navyDk));
      v.fill(0, 8, 7, 7, 0, 5, (x, y, z) => (x + z) % 3 ? T.gold : T.goldLt);
      v.fill(0, 8, 2, 2, 0, 5, T.goldDk);
      v.fill(4, 4, 3, 5, 5, 5, T.gold);
      for (let i = 0; i < 3; i++) {
        v.set(1 + i, 6 - i, 5, T.gold);
        v.set(7 - i, 6 - i, 5, T.gold);
      }
      v.fill(3, 5, 2, 2, 6, 6, T.gold);
      v.set(4, 2, 6, T.goldLt);
      k.loin = [T.navy, T.navyDk];
    },
    // Navy sleeves under broad pauldrons rimmed in gold, gold cuffs over dark gauntlets, and dark boots with gold toes
    // under the coat.
    gear(k) {
      const T = tones(k), u = k.u, cloth = weave(T.navy, T.navyDk), arm = makeVox(), leg = makeVox();
      arm.fill(-1, 3, 0, 1, -1, 3, T.glove);
      arm.fill(-1, 3, 2, 3, -1, 3, (x, y, z) => y === 2 ? T.goldDk : (x + z) & 1 ? T.gold : T.goldLt);
      arm.fill(0, 2, 4, 7, 0, 2, cloth);
      arm.fill(-2, 4, 8, 10, -1, 3, (x, y, z) => y === 8 ? T.gold : cloth(x, y, z));
      arm.fill(-1, 3, 11, 11, 0, 2, cloth);
      arm.set(1, 11, 1, T.goldLt);
      k.parts.armL.geometry = k.parts.armR.geometry = k.vg(arm, { x: -1.5 * u, y: -11 * u, z: -1.5 * u });
      leg.fill(0, 3, 2, 4, 0, 3, T.navyDk);
      leg.fill(0, 3, 0, 1, 0, 4, T.boot);
      leg.fill(0, 3, 0, 1, 5, 5, (x, y) => y === 0 ? T.gold : T.goldDk);
      leg.fill(0, 3, 0, 0, 6, 6, T.gold);
      k.parts.legL.geometry = k.parts.legR.geometry = k.vg(leg, { x: -2 * u, y: -5 * u, z: -2.5 * u });
    },
    // A navy great helm over the whole head, a block wider than it all round, its upright corners cut: gold bands at the
    // rim and the brow, a gold ridge from nape to brow with a crest along the crown, and below the visor a gold face
    // plate with two dark breaths. The neck guard sits on the gorget.
    skull(k, v) {
      const T = tones(k), cloth = weave(T.navy, T.navyDk);
      for (let x = -1; x <= 7; x++) for (let z = -1; z <= 6; z++) {
        const side = x === -1 || x === 7, end = z === -1 || z === 6;
        if (side && end) continue;
        for (let y = 1; y <= 6; y++) v.set(x, y, z, y === 1 || y === 4 || (x === 3 && end) ? T.gold : cloth(x, y, z));
      }
      v.fill(0, 6, 0, 0, 0, 5, T.goldDk);
      v.fill(0, 6, 7, 7, 0, 5, (x, y, z) => (x === 0 || x === 6) && (z === 0 || z === 5) ? null : x === 3 ? T.gold : cloth(x, y, z));
      v.fill(3, 3, 8, 8, 1, 4, T.goldLt);
      v.fill(0, 6, 2, 2, 6, 6, T.gold);
      for (const x of [1, 5]) {
        v.del(x, 2, 6);
        v.set(x, 2, 5, T.slit);
      }
      return true;
    },
    // His eyes burn blue in the visor's slit, sunk a block into the helm either side of the gold nasal.
    eyes(k, v) {
      const T = tones(k);
      for (const x of [0, 1, 2, 4, 5, 6]) {
        v.del(x, 3, 6);
        v.set(x, 3, 5, x === 0 || x === 6 ? T.slit : T.eye);
      }
      k.headEmissive = { [T.eye]: 0.85 };
      return true;
    },
    headgear(k) {
      addChild(k.parts.head, createNode({ scale: { x: k.h, y: k.h, z: k.h }, geometry: helmHorns() }));
    },
    // The staff in his right fist where the club would hang (it and the snack stay hidden), Gjallarhorn in his left,
    // the cape on its pivot, the coat's skirts and the medallion. `staff`, `horn`, `bell` and `cape` join the parts so
    // every clone gets its own.
    extras(k) {
      const h = k.h, u = k.u, P = k.parts, T = tones(k), scale = () => ({ x: h, y: h, z: h }), gjallar = horn();
      P.club.visible = false;
      P.staff = createNode({ position: { x: 0, y: -GRIP * h, z: 0 }, scale: scale(), quaternion: quat.create(), geometry: staff() });
      addChild(P.armL, P.staff);
      P.horn = createNode({ position: { x: 0, y: -0.62 * h, z: 0.08 * h }, scale: scale(), quaternion: quat.create(), geometry: gjallar.geometry });
      P.bell = createNode({ position: { ...gjallar.bell } });
      addChild(P.horn, P.bell);
      addChild(P.armR, P.horn);
      P.cape = createNode({ position: { x: 0, y: CAPE.y * h, z: CAPE.z * h }, rotation: { x: CAPE.rest, y: 0, z: 0 }, geometry: k.vg(capeVox(T), { x: -0.5 * u, y: 0, z: -u }) });
      addChild(k.root, P.cape, createNode({ geometry: k.vg(skirtVox(T), { x: -5.5 * u, y: 0, z: -4 * u }) }), createNode({ scale: scale(), geometry: medallion() }));
    }
  };
  const traits = cached(() => ({
    ...BL.contributors.traitsFor(NAME), display: "Heimdall", skin: LOOK.glove, hair: LOOK.navy, fur: LOOK.navy, height: HEIGHT, belly: BELLY,
    face: "none", hairless: true, noBrow: true, noPupils: true, dress: DRESS
  }));
  const sparks = cached(() => ["#ffc83a", "#ffe7a0", "#fff8e0", "#bfe3ff"].map((c) => models.particleGeometry(c, 0.07, 1)));

  // ---- what he says ----------------------------------------------------------------------------------

  // Each fits a bubble; he says them in turn.
  const GREETINGS = [
    "Hail, traveller! ₿IFRÖST awaits.", "I heard you coming three blocks ago.", "Well met, Ooga. Mind the rainbow.",
    "I saw you from nine worlds away.", "Welcome. Wipe your feet, it's a rainbow.", "Hail, Ooga! Few cross. You may."
  ];
  const MUTTERS = [
    "I can hear the mempool growing.", "The bridge holds. The chain holds.", "Mind the edge. It's a long way down.",
    "Tick tock, next block.", "I hear grass grow. And hashes.", "I sleep less than a bird. Or a node.",
    "Don't trust. Verify. Then cross.", "I guard the bridge. Nodes guard the rest.", "Nine worlds. Twenty-one million coins.",
    "A fee spike, three realms away. Hmm."
  ];
  const BLASTS = [
    "Gjallarhorn sounds at every halving.", "Heard in all nine worlds. Hi!", "Loud enough to wake a sleeping node.",
    "Not Ragnarök. Just saying hello.", "That one's for the next block!", "The gods know you're here now."
  ];
  for (const line of [...GREETINGS, ...MUTTERS, ...BLASTS]) if ([...line].length > 42) throw new Error(`Heimdall's line is too long for a bubble: ${line}`);

  // ---- Gjallarhorn's voice -----------------------------------------------------------------------------

  // A pooled synth on mine-audio's pattern: one context opened from a gesture the browser has already counted, two
  // sawtooths a fifth apart with a slow vibrato through one lowpass and one gain, all built and started once. A blast
  // only schedules automation: the pitch scoops up, the filter swells and settles, the level rises, holds and dies
  // away; another is refused while one sounds. Once a blast has died the context sleeps, so an idle horn costs nothing.
  const MUTE_KEY = "oogaboogaland.audio";
  const SOUND = { hz: [110, 165], master: 0.5, peak: 0.2, hold: 1.4, end: 2.2 };
  const noop = () => {};
  const hornVoice = () => {
    let ctx = null, gain = null, filter = null, lfo = null, until = 0, asleep = false;
    const oscs = [];
    const muted = () => {
      try {
        return localStorage.getItem(MUTE_KEY) === "off";
      } catch {
        return false;
      }
    };
    const init = () => {
      if (typeof AudioContext === "undefined") return;
      ctx = new AudioContext();
      const master = ctx.createGain(), depth = ctx.createGain();
      master.gain.value = SOUND.master;
      master.connect(ctx.destination);
      gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(master);
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 300;
      filter.Q.value = 1.4;
      filter.connect(gain);
      // The vibrato is in cents, so the fifth stays true.
      lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      depth.gain.value = 9;
      lfo.connect(depth);
      for (const hz of SOUND.hz) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = hz;
        depth.connect(osc.detune);
        osc.connect(filter);
        osc.start();
        oscs.push(osc);
      }
      lfo.start();
    };
    const activate = () => {
      if (ctx) {
        // Also after the browser suspended it mid-blast (a call, a trip to the background), which no flag records.
        if (asleep || ctx.state !== "running") {
          asleep = false;
          ctx.resume().catch(noop);
        }
        return;
      }
      if (!muted() && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) init();
    };
    // A blast starting `delay` seconds from now.
    const blow = (delay) => {
      if (!ctx || muted()) return false;
      const now = ctx.currentTime;
      if (now < until) return false;
      const t = now + delay;
      for (let i = 0; i < oscs.length; i++) {
        const f = oscs[i].frequency, hz = SOUND.hz[i];
        f.cancelScheduledValues(now);
        f.setValueAtTime(hz * 0.93, t);
        f.exponentialRampToValueAtTime(hz, t + 0.12);
        f.setValueAtTime(hz, t + SOUND.hold);
        f.exponentialRampToValueAtTime(hz * 0.97, t + SOUND.end);
      }
      const cut = filter.frequency;
      cut.cancelScheduledValues(now);
      cut.setValueAtTime(300, t);
      cut.exponentialRampToValueAtTime(1500, t + 0.25);
      cut.setTargetAtTime(900, t + 0.25, 0.3);
      cut.setTargetAtTime(420, t + SOUND.hold, 0.35);
      const g = gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0.0001, t);
      g.exponentialRampToValueAtTime(SOUND.peak, t + 0.18);
      g.setValueAtTime(SOUND.peak, t + SOUND.hold);
      g.exponentialRampToValueAtTime(0.0001, t + SOUND.end);
      until = t + SOUND.end;
      return true;
    };
    const update = () => {
      if (ctx && !asleep && ctx.currentTime > until + 0.5) {
        asleep = true;
        ctx.suspend().catch(noop);
      }
    };
    const dispose = () => {
      if (!ctx) return;
      for (const osc of oscs) osc.stop();
      lfo.stop();
      ctx.close().catch(noop);
      ctx = gain = filter = lfo = null;
      oscs.length = 0;
    };
    return { activate, blow, update, dispose };
  };

  // ---- the visit ---------------------------------------------------------------------------------------

  const IDLE = 0, GREET = 1, BLAST = 2;
  // How far he watches, hails a played Ooga (and how far it must go before he hails it again, and how long after), and
  // mutters; how far his gaze turns from his heading, how much of the turn his body takes, and how far his head tips.
  // The head keeps to half a radian either way and never bows far, so his horns stay clear of his shoulders.
  const WATCH_R = 14, GREET_R = 5, REARM_R = 8, MUTTER_R = 20, LOOK_MAX = 1.1, BODY_SHARE = 0.55, PITCH = [-0.3, 0.2];
  const GREET_AGAIN = 18, MUTTER_EVERY = 25, FIRST_MUTTER = 12;
  // A blast in seconds: the lift to the lips, the sound (just before the horn arrives), the hold and the lowering, the
  // second shower of sparks, the line he says after and the end. A hail: the staff raised high, held with a wave, and
  // lowered, its arm's angles at the top.
  const HORN_T = { lift: 0.45, sound: 0.4, hold: 2.55, lower: 0.5, second: 1.3, say: 2.85, end: 3.3 };
  const HAIL = { up: 0.35, hold: 2.1, down: 0.4, end: 2.6, x: -2.55, z: 0.32 };
  const smooth = (k) => k * k * (3 - 2 * k);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // Heimdall at (x, y, z), y the ground under his step, facing `heading` (a node's rotation.y for a figure whose front is
  // local +z). His root and step go under `parent`; bubbles and sparks go through `fx`.
  const create = ({ parent, x, y, z, heading, fx }) => {
    const figure = models.caveman(traits()), parts = figure.parts, body = figure.root, q = parts.horn.quaternion;
    body.scale.x = body.scale.y = body.scale.z = SCALE;
    body.position.y = SCALE * LEG * HEIGHT;
    const root = createNode({ position: { x, y: y + PLINTH.top, z }, rotation: { x: 0, y: heading, z: 0 }, sightHidden: true });
    addChild(root, body);
    const step = createNode({ position: { x, y, z }, rotation: { x: 0, y: heading, z: 0 }, geometry: plinth() });
    addChild(parent, step, root);
    const voice = hornVoice();
    // The visit's state: his mood and how long he has been in it, where his gaze rests, how high his staff is raised,
    // the cape's gust, whether a played Ooga may be hailed and from when, when he next mutters, how many of each line
    // he has said, and how far a blast has got (showers of sparks, its line).
    const s = { mode: IDLE, t: 0, look: 0, pitch: 0, hail: 0, gust: 0, armed: true, greetAt: 0, mutterAt: FIRST_MUTTER, greets: 0, mutters: 0, blasts: 0, bursts: 0, said: false };
    const say = (lines, count, dur) => fx.sayAt(x, y + SAY_Y, z, lines[count % lines.length], dur);
    const begin = (mode) => {
      s.mode = mode;
      s.t = 0;
      s.bursts = 0;
      s.said = false;
    };
    // Sparks from the bell, wherever the pose has put it this frame.
    const sparkle = (count) => {
      updateWorld(root, parent.world);
      const w = parts.bell.world;
      fx.burst(w[12], w[13], w[14], count, sparks(), 2.4);
    };

    // (px, py, pz): the played Ooga's feet, or the view's target when none is played.
    const update = (dt, elapsed, px, py, pz, played) => {
      const dx = px - x, dz = pz - z, d2 = dx * dx + dz * dz;
      s.t += dt;
      if (d2 > REARM_R * REARM_R) s.armed = true;
      if (s.mode === IDLE) {
        if (played && s.armed && d2 < GREET_R * GREET_R && elapsed >= s.greetAt) {
          begin(GREET);
          s.armed = false;
          s.greetAt = elapsed + GREET_AGAIN;
          s.mutterAt = Math.max(s.mutterAt, elapsed + 10);
          say(GREETINGS, s.greets++, 2.6);
        } else if (elapsed >= s.mutterAt) {
          s.mutterAt = elapsed + MUTTER_EVERY + (s.mutters * 7) % 9 - 4;
          if (d2 < MUTTER_R * MUTTER_R) say(MUTTERS, s.mutters++, 2.6);
        }
      }
      // His gaze: whoever is within sight, else the far horizon, drifting.
      let yaw, pitch;
      if (d2 < WATCH_R * WATCH_R && d2 > 0.04) {
        yaw = clamp(wrap(Math.atan2(dx, dz) - heading), -LOOK_MAX, LOOK_MAX);
        pitch = clamp(Math.atan2(y + EYE_Y - py - 1, Math.sqrt(d2)), PITCH[0], PITCH[1]);
      } else {
        yaw = Math.sin(elapsed * 0.31) * 0.5 + Math.sin(elapsed * 0.13 + 1) * 0.25;
        pitch = -0.04 + Math.sin(elapsed * 0.23) * 0.04;
      }
      s.look = damp(s.look, yaw, 3.5, dt);
      s.pitch = damp(s.pitch, pitch, 3.5, dt);
      // How far the horn is lifted and the staff raised, the nod of a hail, and the breath drawn in as the horn comes up
      // and spent through the blast. The staff eases, so a tap that cuts a hail short lowers it rather than dropping it.
      let lift = 0, hail = 0, nod = 0, chest = 0;
      if (s.mode === BLAST) {
        const t = s.t, H = HORN_T;
        lift = t < H.lift ? smooth(t / H.lift) : t < H.hold ? 1 : t < H.hold + H.lower ? 1 - smooth((t - H.hold) / H.lower) : 0;
        chest = t < H.lift ? 0.05 * smooth(t / H.lift) : t < H.hold ? 0.05 - 0.06 * (t - H.lift) / (H.hold - H.lift) : -0.01 * (1 - clamp((t - H.hold) / H.lower, 0, 1));
      } else if (s.mode === GREET) {
        const t = s.t;
        hail = t < HAIL.up ? smooth(t / HAIL.up) : t < HAIL.hold ? 1 : t < HAIL.hold + HAIL.down ? 1 - smooth((t - HAIL.hold) / HAIL.down) : 0;
        nod = 0.12 * Math.sin(Math.PI * clamp((t - 0.1) / 0.6, 0, 1));
      }
      s.hail = damp(s.hail, hail, 14, dt);
      // The blast's pose is solved for a still head and body facing ahead, so the lift takes over from the gaze. The
      // horn eases from its hang at his hip to its turn at his lips; the staff arm rises for a hail and the staff turns
      // against it, so it stays upright in his fist.
      const keep = 1 - lift, breath = Math.sin(elapsed * 1.8);
      parts.torso.scale.y = 1 + breath * 0.018 + chest;
      body.rotation.y = s.look * BODY_SHARE * keep;
      parts.head.rotation.y = s.look * (1 - BODY_SHARE) * keep;
      parts.head.rotation.x = clamp(s.pitch + nod, PITCH[0], PITCH[1]) * keep + BLOW.pitch * lift;
      parts.armR.rotation.x = (REST.x + breath * 0.015) * keep + BLOW.x * lift;
      parts.armR.rotation.z = REST.z * keep + BLOW.z * lift;
      parts.armL.rotation.x = STAFF.x + (HAIL.x - STAFF.x) * s.hail;
      parts.armL.rotation.z = -(STAFF.z + (HAIL.z - STAFF.z + Math.sin(s.t * 6.5) * 0.09) * s.hail);
      upright(parts.staff.quaternion, parts.armL);
      for (let i = 0; i < 4; i++) q[i] = HANG[i] * keep + BLOW.q[i] * lift;
      quat.normalize(q);
      s.gust = damp(s.gust, 0, 1.4, dt);
      parts.cape.rotation.x = CAPE.rest + breath * 0.01 + Math.sin(elapsed * 0.7 + 0.4) * 0.014 + s.gust;
      if (s.mode === BLAST) {
        const t = s.t;
        if (s.bursts === 0 && t >= HORN_T.lift) {
          s.bursts = 1;
          s.gust = 0.22;
          sparkle(20);
        } else if (s.bursts === 1 && t >= HORN_T.second) {
          s.bursts = 2;
          sparkle(12);
        }
        if (!s.said && t >= HORN_T.say) {
          s.said = true;
          say(BLASTS, s.blasts++, 2.8);
        }
        if (t >= HORN_T.end) {
          s.mode = IDLE;
          s.mutterAt = Math.max(s.mutterAt, elapsed + 10);
        }
      } else if (s.mode === GREET && s.t >= HAIL.end) s.mode = IDLE;
      voice.update();
    };
    // A tap: he lifts Gjallarhorn and blows it, unless it is already at his lips. The tap is the gesture that lets the
    // horn's voice open.
    const poke = () => {
      if (s.mode === BLAST) return false;
      voice.activate();
      voice.blow(HORN_T.sound);
      begin(BLAST);
      return true;
    };
    return { root, pick: parts.torso, plinth: step, update, poke, dispose: voice.dispose };
  };

  BL.bifrostHeimdall = { create, PLINTH, SCALE, HEIGHT, EYE_Y, SAY_Y };
})();
