// ₿IFRÖST's chamber: a round hall of stone and bronze round a decorative ₿ mechanism, entered from the island by
// a short tunnel, with a ring of windows onto other worlds. Everything is built once for the page in the hall's
// own frame: the floor at y 0, the mechanism at the origin, the tunnel running out along +z to the field that
// joins it to the island, and each window at its bearing b on the wall, measured from +z toward +x (x = sin b,
// z = cos b): counter-clockwise seen from above, the mirror of the island's clock.
//
// A window is a row in `WINDOWS` and a slot in `SLOTS`, in the same order. A `travel` row walks through to its
// scene, and looks through a short passage lined with the field's blue onto a picture of that world (the scene
// takes the picture); a world not open yet is a `mirror`, a reflector linked to the next mirror in the hall.
// Opening a world is changing its row, and giving the scene its picture and the row its stand-in.
//
// The name is carved in raised gilt letters (`word`), chiselled strokes swept along each letter's centre line,
// since the island's 3x5 sign alphabet has no ₿ or Ö. `supportAt`, `clearAt` and `walkable` are the walkable
// floor, shared by the scene's walkers and its tests.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, math } = BL;
  const { cached, variants, geometry, pushVert, face, box, bevelBox, lathe, ring, tube, merge, forward, moved, turnedX, turnedY, turnedZ, noShadow, makeVox, voxelGeometry } = models;
  const { hexToRgb, mulberry32 } = math;
  const FM = BL.factoryModels;
  const TAU = Math.PI * 2;

  const STONE = ["#5e5751", "#544d48", "#69615a", "#4c4642"], STONE_DK = "#38332f", STONE_LT = "#7a7066";
  const BRONZE = "#a86a34", BRONZE_DK = "#6e4222", BRASS = "#c9962e", GOLD = "#ffc83a", GOLD_DK = "#b87a10";
  const TIMBER = "#8a5a32", TIMBER_DK = "#5c3a1e";
  const FIELD = "#3f8cff", FIELD_LT = "#bfe3ff", FIELD_DK = "#0b1a44", PASSAGE = "#10245e", CLOTH = "#1a2130";

  // The hall: its radius to the wall's inner face, the wall's height to the dome, the dome's crown, and the wall's
  // thickness in blocks of `unit`.
  const HALL = { r: 12.5, wall: 8.25, apex: 13, thick: 1.5, unit: 0.75 };
  // The way in: an arched opening `halfW` either side, its round top springing at `spring`, and the tunnel out along
  // +z to the field, which stands `field` from the middle of the hall. The island's gate will join it there.
  const ENTRY = { halfW: 2, spring: 2.4, field: HALL.r + 7, beyond: 1.2 };
  // A window's opening, the depth of its passage, the plane its field stands at past the wall's face, and how far
  // past that plane a traveller can walk while the scene fades.
  const WINDOW = { halfW: 1.8, spring: 2.6, depth: 4.5, plane: 0.3, recess: 1.6, flare: 0.6, rise: 0.8 };
  // The mechanism: the dais's two steps [radius, top], the plinth the Oogas cannot pass, and where the ₿ turns.
  const CORE = { steps: [[3.1, 0.25], [2.4, 0.5]], plinth: 1.5, glyphY: 3.4, rings: [1.6, 1.85, 2.1] };

  // Until the scene has its picture, a window shows its world simply, as a `stand` describes it: bands of colour from
  // the floor up, [from, to, colour, glow] in fractions of the picture's height, and nine small lights in the band
  // `dotY` [from, span], every third in the second colour. DSB Land's is its purple night over a band of its falls,
  // with stars.
  const DSB_STAND = {
    key: "dsb", bands: [[0, 0.3, "#403054", 0.55], [0.3, 0.36, "#49ddd9", 0.8], [0.36, 0.62, "#2a1648", 0.7], [0.62, 1, "#12082a", 0.8]],
    dots: ["#49ddd9", "#ffdf38"], dotY: [0.66, 0.3]
  };
  // The windows, left to right as the tunnel looks in, at their bearings round the wall. Only an open world carries a
  // label, a `tint` (the colour its frame's rim and light glow in, the colour of that world) and a `stand`-in; a world
  // whose looks change gives all of them through `look`. `instant` crosses without the fade, as that world's own way
  // back does.
  const WINDOWS = [
    { id: "west", kind: "mirror" },
    { id: "dsb", kind: "travel", scene: "dsb", name: "DSB Land", label: "DSB", tint: "#3f8cff", stand: DSB_STAND },
    { id: "poker", kind: "travel", scene: "poker", name: "The Ember Den", label: "EMBER DEN", instant: true, look: () => pokerLook() },
    { id: "east", kind: "mirror" }
  ];
  const SLOTS = [-1.95, -2.75, 2.75, 1.95];
  if (WINDOWS.length !== SLOTS.length) throw new Error("₿IFRÖST has a window without a slot");
  // A window's frame: on the wall's face at its bearing, turned so local +z looks into the hall and x runs across.
  const frameOf = (i) => {
    const b = SLOTS[i];
    return { bearing: b, x: Math.sin(b) * HALL.r, z: Math.cos(b) * HALL.r, ry: b + Math.PI };
  };
  // Whether (across, y) is inside an arched opening `halfW` either side whose round top springs at `spring`.
  const inArch = (across, y, halfW, spring) => y >= 0 && Math.abs(across) <= halfW && (y <= spring || Math.hypot(across, y - spring) <= halfW);
  // Every opening in the wall: the way in at bearing 0, then the windows.
  const OPENINGS = [{ bearing: 0, halfW: ENTRY.halfW, spring: ENTRY.spring }, ...SLOTS.map((bearing) => ({ bearing, halfW: WINDOW.halfW, spring: WINDOW.spring }))];

  // ---- small builders ------------------------------------------------------------------------------

  // A flat face through `points` [[x, y, z], ...], wound to look toward (tx, ty, tz).
  const facing = (geo, points, color, emissive, tx, ty, tz) => {
    const ids = points.map(([x, y, z]) => pushVert(geo, x, y, z)), v = geo.verts;
    let nx = 0, ny = 0, nz = 0, mx = 0, my = 0, mz = 0;
    for (let k = 0; k < ids.length; k++) {
      const p = ids[k] * 3, q = ids[(k + 1) % ids.length] * 3;
      nx += (v[p + 1] - v[q + 1]) * (v[p + 2] + v[q + 2]);
      ny += (v[p + 2] - v[q + 2]) * (v[p] + v[q]);
      nz += (v[p] - v[q]) * (v[p + 1] + v[q + 1]);
      mx += v[p] / ids.length; my += v[p + 1] / ids.length; mz += v[p + 2] / ids.length;
    }
    face(geo, nx * (tx - mx) + ny * (ty - my) + nz * (tz - mz) < 0 ? ids.reverse() : ids, hexToRgb(color), { emissive });
    return geo;
  };
  // The outline of an arched opening, counter-clockwise from its bottom left: convex, so one face.
  const archOutline = (halfW, spring, z, n = 14) => [
    [-halfW, 0, z], [halfW, 0, z],
    ...Array.from({ length: n + 1 }, (_, k) => { const a = Math.PI * k / n; return [Math.cos(a) * halfW, spring + Math.sin(a) * halfW, z]; })
  ];
  // An arch of dressed stone round an opening, facing +z about z 0: voussoirs round the top with a pale keystone,
  // and jambs of blocks down both sides. `depth` is its thickness through the wall.
  const archRing = (halfW, spring, depth, band = 0.8) => {
    const geos = [], r = halfW + band / 2, n = Math.max(7, Math.round(Math.PI * r / 0.62) | 1);
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * k / n, key = k === (n >> 1) && n % 2 === 0, w = r * Math.PI / n * 0.92;
      geos.push(moved(turnedZ(bevelBox({ w: key ? w * 1.3 : w, h: key ? band * 1.15 : band, d: key ? depth + 0.16 : depth, color: key ? STONE_LT : k % 2 ? STONE[3] : STONE[1], bevel: 0.08 }), a - Math.PI / 2), Math.cos(a) * r, spring + Math.sin(a) * r, 0));
    }
    const rows = Math.max(1, Math.round(spring / 0.62));
    for (const s of [-1, 1]) for (let row = 0; row < rows; row++) {
      const h = spring / rows;
      geos.push(bevelBox({ w: band, h: h - 0.04, d: depth, color: row % 2 ? STONE[0] : STONE[2], bevel: 0.07, offset: { x: s * r, y: h * (row + 0.5), z: 0 } }));
    }
    return merge(...geos);
  };
  // A point `d` along an arch's edge `halfW` out, from the foot of its left leg over the top to the foot of its right,
  // at z; `archEdge` gives the edge's whole length.
  const archEdge = (halfW, spring) => 2 * (spring - 0.1) + Math.PI * halfW;
  const archAt = (halfW, spring, z, d) => {
    const legs = spring - 0.1;
    if (d < legs) return { x: -halfW, y: 0.1 + d, z };
    if (d > legs + Math.PI * halfW) return { x: halfW, y: spring - (d - legs - Math.PI * halfW), z };
    const a = Math.PI - (d - legs) / halfW;
    return { x: Math.cos(a) * halfW, y: spring + Math.sin(a) * halfW, z };
  };
  // A round strip along an arch's edge and down both legs, at z: glowing neon, or brass trim with `emissive` 0.
  const archNeon = (halfW, spring, z, color, radius = 0.07, emissive = 1) => {
    const total = archEdge(halfW, spring);
    return tube({ path: (t) => archAt(halfW, spring, z, t * total), radius: () => radius, rings: 56, segments: 7, colorFn: () => color, emissive });
  };
  // A path through straight points [[x, y, z], ...], for `tube`.
  const through = (points) => {
    const lens = [0];
    for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]));
    const total = lens[lens.length - 1];
    return (t) => {
      const d = t * total;
      let i = 1;
      while (i < points.length - 1 && lens[i] < d) i++;
      const a = points[i - 1], b = points[i], k = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, z: a[2] + (b[2] - a[2]) * k };
    };
  };
  const ball = (r, color, emissive = 0) => lathe({ profile: Array.from({ length: 6 }, (_, k) => [Math.sin(k / 5 * Math.PI) * r, -Math.cos(k / 5 * Math.PI) * r]), segments: 10, color, emissive });
  // A disc `r` across and `d` thick facing +z about z 0, for medallions.
  const disc = (r, d, color, emissive = 0) => forward(lathe({ profile: [[0, -d / 2], [r, -d / 2], [r, d / 2], [0, d / 2]], segments: 20, color, emissive }));
  // A circle of round section `r` across in the plane z, for rims.
  const hoop = (r, z, thick, color, emissive = 0) => tube({ path: (t) => ({ x: Math.cos(t * TAU) * r, y: Math.sin(t * TAU) * r, z }), radius: () => thick, rings: 28, segments: 5, colorFn: () => color, emissive });
  // A banner as the concept hangs them: a long cloth of deep blue cut to a swallowtail, edged in gold, with a chevron at
  // its head and a big ₿ carved in raised gilt filling its width, on both faces; a bronze rod with brass finials, and a
  // gold tassel at each tail. The rod is at the origin and the cloth faces +z.
  const BANNER = { w: 1.12, h: 2.7, tail: 0.42, mark: 0.9 };
  const banner = cached(() => {
    const { w, h, tail } = BANNER, t = 0.02, cloth = geometry(), trim = [], y0 = -0.1;
    // The cloth in two convex halves either side of the notch, each face wound outward.
    for (const half of [[[-w / 2, y0], [0, y0], [0, y0 - h + tail], [-w / 2, y0 - h]], [[0, y0], [w / 2, y0], [w / 2, y0 - h], [0, y0 - h + tail]]]) {
      facing(cloth, half.map(([x, y]) => [x, y, t]), CLOTH, 0, 0, -h / 2, 5);
      facing(cloth, half.map(([x, y]) => [x, y, -t]), CLOTH, 0, 0, -h / 2, -5);
    }
    // One face's gold: the edging just inside the cloth's outline and the chevron at its head (`trim`), and the ₿
    // (`mark`), pressed flatter than the name's letters so it lies on the cloth.
    const face = () => {
      const i = 0.07, z = t + 0.012, edge = [[-w / 2 + i, y0 - i], [w / 2 - i, y0 - i], [w / 2 - i, y0 - h + i * 1.6], [0, y0 - h + tail + i * 1.2], [-w / 2 + i, y0 - h + i * 1.6]];
      const parts = edge.map((p, k) => { const q = edge[(k + 1) % edge.length]; return FM.beam(p[0], p[1], z, q[0], q[1], z, 0.04, GOLD, 0.25); });
      parts.push(FM.beam(-0.26, y0 - 0.2, z, 0, y0 - 0.34, z, 0.04, GOLD, 0.25), FM.beam(0, y0 - 0.34, z, 0.26, y0 - 0.2, z, 0.04, GOLD, 0.25));
      const mark = word("₿", BANNER.mark), v = mark.verts;
      for (let k = 2; k < v.length; k += 3) v[k] *= 0.35;
      return { trim: merge(...parts), mark: moved(mark, 0, y0 - 1.72, z - 0.01) };
    };
    const front = face(), back = face();
    trim.push(front.trim, turnedY(back.trim, Math.PI));
    for (const x of [-w / 2, w / 2]) trim.push(moved(ball(0.05, GOLD, 0.3), x, y0 - h - 0.06, 0), FM.beam(x, y0 - h, 0, x, y0 - h - 0.04, 0, 0.02, GOLD_DK));
    // The ₿ is shaded smooth, as the name is; everything else keeps its flat faces.
    const geo = merge(front.mark, turnedY(back.mark, Math.PI));
    geo.smooth = true;
    BL.hubModels.flatInto(geo,
      bevelBox({ w: w + 0.3, h: 0.09, d: 0.09, color: BRONZE_DK, bevel: 0.02 }),
      moved(ball(0.075, BRASS), -(w / 2 + 0.2), 0, 0), moved(ball(0.075, BRASS), w / 2 + 0.2, 0, 0),
      cloth, ...trim
    );
    return geo;
  });
  // Banners placed and merged into one geometry, shaded as `banner` is: `merge` drops `smooth`, and every flat face in a
  // banner has vertices of its own, so setting it again rounds only the ₿.
  const banners = (...placed) => Object.assign(merge(...placed), { smooth: true });

  // ---- the name, chiselled ---------------------------------------------------------------------------

  // Unit metrics, cap height 1: the stroke's width, how far it stands proud, and its chamfer. The face is gilt, the
  // chamfers catch the light and the walls sit in shadow.
  const GW = 0.2, GD = 0.14, GB = 0.045;
  const GILT = ["#ffc83a", "#ffe7a0", "#b87a10"].map(hexToRgb), GLOW = [0.3, 0.45, 0.12];
  // The corner `b` inside both lines through p with inward unit normals na and nb.
  const inset = (p, na, nb, b) => {
    const det = na[0] * nb[1] - na[1] * nb[0];
    if (Math.abs(det) < 1e-6) return [p[0] + na[0] * b, p[1] + na[1] * b];
    return [p[0] + b * (nb[1] - na[1]) / det, p[1] + b * (na[0] - nb[0]) / det];
  };
  // One stroke along centre-line points [[x, y], ...]: open, with chamfered ends square to the path (or along `caps`),
  // or closed. An end that runs into another stroke is `blind`: it has no end faces, and is buried past the other's
  // edge so none of its chamfer shows. Five strips (wall, chamfer, face, chamfer, wall), each with vertices of its
  // own, so smooth shading rounds curves along the stroke and keeps the creases across it.
  const stroke = (pts, { w = GW, closed = false, caps = [null, null], blind = [false, false] } = {}) => {
    const geo = geometry(), n = pts.length, h = w / 2, zs = GD - GB;
    const seg = (i) => { const a = pts[i], c = pts[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
    if (!closed) for (const [a, c, k] of [[pts[0], pts[1], 0], [pts[n - 1], pts[n - 2], 1]]) if (!blind[k] && Math.hypot(c[0] - a[0], c[1] - a[1]) < 2 * GB) throw new Error("A chiselled stroke's end is shorter than its chamfer");
    const L = [], R = [], FL = [], FR = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], end = !closed && (i === 0 || i === n - 1);
      const tin = closed || i > 0 ? seg((i - 1 + n) % n) : seg(0), tout = closed || i < n - 1 ? seg(i) : seg(n - 2);
      let l, r, fl, fr;
      if (end) {
        const t = i === 0 ? tout : tin, nrm = [-t[1], t[0]], k = i === 0 ? 0 : 1;
        if (blind[k]) {
          l = [p[0] + nrm[0] * h, p[1] + nrm[1] * h]; r = [p[0] - nrm[0] * h, p[1] - nrm[1] * h];
          fl = [p[0] + nrm[0] * (h - GB), p[1] + nrm[1] * (h - GB)]; fr = [p[0] - nrm[0] * (h - GB), p[1] - nrm[1] * (h - GB)];
        } else {
          const cap = caps[k] || nrm, along = cap[0] * nrm[0] + cap[1] * nrm[1], m = h / Math.abs(along) * Math.sign(along);
          l = [p[0] + cap[0] * m, p[1] + cap[1] * m];
          r = [2 * p[0] - l[0], 2 * p[1] - l[1]];
          // The cap's inward normal, toward the stroke's body.
          let cn = [-cap[1], cap[0]];
          const into = i === 0 ? t : [-t[0], -t[1]];
          if (cn[0] * into[0] + cn[1] * into[1] < 0) cn = [-cn[0], -cn[1]];
          fl = inset(l, [-nrm[0], -nrm[1]], cn, GB);
          fr = inset(r, nrm, cn, GB);
        }
      } else {
        const nin = [-tin[1], tin[0]], nout = [-tout[1], tout[0]];
        let mx = nin[0] + nout[0], my = nin[1] + nout[1];
        const ml = Math.hypot(mx, my);
        mx /= ml; my /= ml;
        const k = 1 / (mx * nin[0] + my * nin[1]);
        l = [p[0] + mx * h * k, p[1] + my * h * k]; r = [p[0] - mx * h * k, p[1] - my * h * k];
        fl = [p[0] + mx * (h - GB) * k, p[1] + my * (h - GB) * k]; fr = [p[0] - mx * (h - GB) * k, p[1] - my * (h - GB) * k];
      }
      L.push(l); R.push(r); FL.push(fl); FR.push(fr);
    }
    // A ribbon between two rails, wound so it looks away from the stroke's inside.
    const strip = (A, za, B, zb, part) => {
      const ia = A.map((q) => pushVert(geo, q[0], q[1], za)), ib = B.map((q) => pushVert(geo, q[0], q[1], zb));
      for (let i = 0; i < (closed ? n : n - 1); i++) { const j = (i + 1) % n; face(geo, [ia[i], ia[j], ib[j], ib[i]], GILT[part], { emissive: GLOW[part] }); }
    };
    strip(L, zs, L, 0, 2);
    strip(FL, GD, L, zs, 1);
    strip(FR, GD, FL, GD, 0);
    strip(R, zs, FR, GD, 1);
    strip(R, 0, R, zs, 2);
    if (!closed) for (const [i, k] of [[0, 0], [n - 1, 1]]) {
      if (blind[k]) continue;
      const q = (p, z) => pushVert(geo, p[0], p[1], z);
      const wall = [q(R[i], 0), q(L[i], 0), q(L[i], zs), q(R[i], zs)], bevel = [q(R[i], zs), q(L[i], zs), q(FL[i], GD), q(FR[i], GD)];
      face(geo, k === 0 ? wall.reverse() : wall, GILT[2], { emissive: GLOW[2] });
      face(geo, k === 0 ? bevel.reverse() : bevel, GILT[1], { emissive: GLOW[1] });
    }
    return geo;
  };
  // An arc sampled every `step` radians from a0 to a1, either way round.
  const arc = (cx, cy, rx, ry, a0, a1, step = Math.PI / 14) => {
    const k = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)), out = [];
    for (let i = 0; i <= k; i++) { const a = a0 + (a1 - a0) * i / k; out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    return out;
  };
  // The point `len` on past p, away from q: a straight lead onto a curve's end, so the end is longer than its chamfer.
  const lead = (p, q, len) => { const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy); return [p[0] + dx / l * len, p[1] + dy / l * len]; };
  // A round dot, turned with the stroke's chamfer.
  const dot = (x, y, r) => {
    const zs = GD - GB;
    // Doubled profile points keep the creases, as the factory's turned parts do.
    return moved(forward(lathe({ profile: [[r, 0], [r, zs], [r, zs], [r - GB, GD], [r - GB, GD], [0, GD]], segments: 16, color: (t) => t < 0.2 ? "#b87a10" : t < 0.7 ? "#ffe7a0" : "#ffc83a", emissive: 0.3 })), x, y, 0);
  };
  const gh = GW / 2, top = 1 - gh, bury = 1 - GW + GB;
  // A bowl from the stem: a bar out at y0, round the right, back in at y1 (y0 > y1), its outer edge at `outer`.
  const bowl = (y0, y1, outer) => {
    const r = (y0 - y1) / 2;
    return arc(outer - gh - r, (y0 + y1) / 2, r, r, Math.PI / 2, -Math.PI / 2);
  };
  // Each glyph: its advance, and the strokes it is cut from, in unit metrics with the baseline at y 0.
  const GLYPHS = {
    "₿": { width: 0.62, parts: () => {
      // The upper bowl ends blind at the foot of its curve, inside the middle bar, which the lower bowl carries.
      const upper = bowl(top, 0.53, 0.56), lower = bowl(0.53, gh, 0.62);
      return [
        stroke([[gh, GW - GB], [gh, bury]], { blind: [true, true] }),
        stroke([[0, top], ...upper], { blind: [false, true] }),
        stroke([[GW - GB, 0.53], ...lower, [0, gh]], { blind: [true, false] }),
        ...[0.14, 0.36].flatMap((x) => [stroke([[x, 1 - GB], [x, 1.17]], { w: 0.1, blind: [true, false] }), stroke([[x, GB], [x, -0.17]], { w: 0.1, blind: [true, false] })])
      ];
    } },
    I: { width: GW, parts: () => [stroke([[gh, 0], [gh, 1]])] },
    F: { width: 0.54, parts: () => [stroke([[gh, 0], [gh, bury]], { blind: [false, true] }), stroke([[0, top], [0.54, top]]), stroke([[GW - GB, 0.53], [0.46, 0.53]], { blind: [true, false] })] },
    R: { width: 0.62, parts: () => [
      stroke([[gh, 0], [gh, bury]], { blind: [false, true] }),
      stroke([[0, top], ...bowl(top, 0.47, 0.6), [GW - GB, 0.47]], { blind: [false, true] }),
      stroke([[0.3, 0.47], [0.52, 0]], { caps: [null, [1, 0]], blind: [true, false] })
    ] },
    "Ö": { width: 0.8, parts: () => [
      stroke(arc(0.4, 0.5, 0.4 - gh, 0.5 - gh, 0, TAU, TAU / 36).slice(0, -1), { closed: true }),
      dot(0.24, 1.17, 0.085), dot(0.56, 1.17, 0.085)
    ] },
    S: { width: 0.64, parts: () => {
      const r = (1 - GW) / 4, rx = r * 1.12, cx = 0.32;
      const upper = arc(cx, 1 - gh - r, rx, r, 0.75, Math.PI * 1.5), lower = arc(cx, gh + r, rx, r, Math.PI / 2, -Math.PI + 0.75);
      return [stroke([lead(upper[0], upper[1], 0.1), ...upper, ...lower.slice(1), lead(lower[lower.length - 1], lower[lower.length - 2], 0.1)])];
    } },
    T: { width: 0.62, parts: () => [stroke([[0, top], [0.62, top]]), stroke([[0.31, 0], [0.31, bury]], { blind: [false, true] })] }
  };
  // Text `height` metres to the cap line, centred on x 0 with its baseline at y 0, facing +z with its back at z 0.
  // Throws on a letter with no glyph. Built fresh: callers cache what they keep.
  const word = (text, height, gap = 0.16) => {
    const chars = [...text], parts = [];
    for (const ch of chars) if (!GLYPHS[ch]) throw new Error(`No chiselled glyph for "${ch}"`);
    const total = chars.reduce((sum, ch) => sum + GLYPHS[ch].width, 0) + gap * (chars.length - 1);
    let x = -total / 2;
    for (const ch of chars) {
      for (const g of GLYPHS[ch].parts()) parts.push(moved(g, x, 0, 0));
      x += GLYPHS[ch].width + gap;
    }
    const geo = merge(...parts), v = geo.verts;
    for (let i = 0; i < v.length; i++) v[i] *= height;
    // `merge` does not carry `smooth`; the strokes' own vertices keep their creases.
    geo.smooth = true;
    geo.castShadow = false;
    geo.width = total * height;
    return geo;
  };
  // The name over the way in, on a stone plaque in a bronze frame with gold studs at its corners, held out from the
  // curving wall on two brackets so the wall never hides its ends, and high enough to clear the arch below: the
  // letters, and the plaque behind them. `out` is how far the plaque's face stands into the hall from the wall's line.
  const NAME = { height: 0.8, y: 6.35, out: 1.1 };
  const name = cached(() => {
    const letters = word("₿IFRÖST", NAME.height), w = letters.width + 1.1, h = NAME.height + 1, cy = NAME.height / 2, back = -0.32;
    const frame = [
      bevelBox({ w: w + 0.3, h: 0.16, d: 0.42, color: BRONZE, bevel: 0.04, offset: { y: cy + h / 2 + 0.08, z: -0.16 } }),
      bevelBox({ w: w + 0.3, h: 0.16, d: 0.42, color: BRONZE, bevel: 0.04, offset: { y: cy - h / 2 - 0.08, z: -0.16 } }),
      bevelBox({ w: 0.16, h: h + 0.32, d: 0.42, color: BRONZE, bevel: 0.04, offset: { x: -w / 2 - 0.08, y: cy, z: -0.16 } }),
      bevelBox({ w: 0.16, h: h + 0.32, d: 0.42, color: BRONZE, bevel: 0.04, offset: { x: w / 2 + 0.08, y: cy, z: -0.16 } })
    ];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) frame.push(moved(ball(0.1, GOLD, 0.35), sx * (w / 2 + 0.08), cy + sy * (h / 2 + 0.08), 0.08));
    // The brackets back to the wall, and the brass rail under the letters.
    for (const x of [-w / 3, w / 3]) frame.push(FM.beam(x, cy, back, x, cy + 0.2, back - NAME.out + 0.1, 0.16, BRONZE_DK), FM.beam(x, cy - 0.5, back, x, cy + 0.1, back - NAME.out + 0.1, 0.1, BRONZE_DK));
    frame.push(box({ w: letters.width + 0.3, h: 0.05, d: 0.08, color: BRASS, offset: { y: -0.16, z: 0.02 } }));
    return { letters, plaque: merge(bevelBox({ w, h, d: 0.3, color: STONE[1], bevel: 0.08, offset: { y: cy, z: -0.15 } }), ...frame) };
  });

  // ---- the hall ------------------------------------------------------------------------------------

  // The wall in blocks, cut through at every opening a little wider than its arch, so the dressed stone of the arch
  // covers the cut; the dome over it; and the floor (`floor`).
  const hall = cached(() => {
    const u = HALL.unit, R = HALL.r, T = HALL.thick, n = Math.ceil((R + T) / u), rows = Math.round(HALL.wall / u), v = makeVox();
    const cut = (x, y, z) => OPENINGS.some((o) => {
      const sr = Math.sin(o.bearing), cr = Math.cos(o.bearing), along = x * sr + z * cr;
      return along > R - 1 && inArch(x * cr - z * sr, y, o.halfW + 0.3, o.spring);
    });
    for (let i = -n; i < n; i++) for (let k = -n; k < n; k++) {
      const x = (i + 0.5) * u, z = (k + 0.5) * u, r = Math.hypot(x, z);
      if (r < R || r > R + T) continue;
      for (let j = 0; j < rows; j++) {
        const y = (j + 0.5) * u;
        if (cut(x, y, z)) continue;
        // Courses of dressed stone, a darker plinth course at the foot and a pale string course under the dome.
        v.set(i, j, k, j === 0 ? 5 : j === rows - 1 ? 6 : 1 + ((Math.floor(Math.atan2(x, z) * R / 1.5) + j * 3) & 3));
      }
    }
    const walls = voxelGeometry(v, { unit: u, palette: [null, ...STONE, STONE_DK, STONE_LT], origin: { x: 0, y: 0, z: 0 } });
    // The dome is open to the night: a lattice of bronze ribs from the wall's head to the crown's ring, with two rings
    // round it and brass studs where they cross, so the sky shows between.
    const crown = 1.4, dome = [[crown, HALL.apex], [R * 0.5, HALL.apex - 1.1], [R * 0.82, HALL.wall + 2.7], [R + 0.3, HALL.wall - 0.05]];
    const domeAt = (t) => {
      const f = t * (dome.length - 1), i = Math.min(dome.length - 2, Math.floor(f)), k = f - i;
      return [dome[i + 1][0] + (dome[i][0] - dome[i + 1][0]) * (1 - k), dome[i + 1][1] + (dome[i][1] - dome[i + 1][1]) * (1 - k)];
    };
    const ribs = [];
    for (let s = 0; s < 12; s++) {
      const a = (s + 0.5) / 12 * TAU;
      ribs.push(tube({ path: (t) => { const [r, y] = domeAt(t); return { x: Math.sin(a) * (r - 0.18), y: y - 0.12, z: Math.cos(a) * (r - 0.18) }; }, radius: () => 0.13, rings: 18, segments: 6, colorFn: (t) => t > 0.9 ? BRASS : BRONZE }));
    }
    const rim = [ring({ r: R - 0.05, thickness: 0.14, y: HALL.wall, segments: 64, color: BRONZE }), ring({ r: crown, thickness: 0.16, y: HALL.apex - 0.1, segments: 32, color: BRASS })];
    for (const at of [0.34, 0.68]) {
      const [r, y] = domeAt(at);
      rim.push(ring({ r: r - 0.18, thickness: 0.09, y: y - 0.12, segments: 64, color: BRONZE }));
      for (let s = 0; s < 12; s++) { const a = (s + 0.5) / 12 * TAU; rim.push(moved(ball(0.16, BRASS), Math.sin(a) * (r - 0.18), y - 0.12, Math.cos(a) * (r - 0.18))); }
    }
    return { walls, dome: merge(...ribs, ...rim), ...floor() };
  });

  // The floor as the concept lays it: flags in rings round the dais over dark grout, each course broken to bond with
  // the last and each flag a shade of its course's stone; a pale court round the dais, a ring of ₿ cut into the next
  // course between bronze bands, bronze spokes across the middle courses, and bigger flags out to the wall. `inlay` is
  // the metal and the cut ₿, a hair above the flags.
  const COURSES = [
    [CORE.steps[0][0], 4.3, 20, ["#8d8275", "#83786c", "#978c7f"]],
    [4.45, 5.95, 24, ["#4f4741", "#564e47", "#4a433d"]],
    [6.1, 7.75, 36, ["#6d645b", "#665d55", "#736a60"]],
    [7.75, 9.4, 44, ["#5f574f", "#685f56", "#5a524b"]],
    [9.55, 11.2, 52, ["#4f4842", "#57504a", "#4b453f"]],
    [11.2, HALL.r + 0.8, 60, ["#5b534c", "#534c46", "#615951"]]
  ];
  const BANDS = [[4.3, 4.45, BRONZE], [5.95, 6.1, BRASS], [9.4, 9.55, BRONZE]];
  const floor = () => {
    const grout = lathe({ profile: [[HALL.r + 0.8, 0], [CORE.steps[0][0], 0]], segments: 64, color: "#2b2622" }), flags = geometry(), metal = geometry(), gap = 0.035;
    const up = (geo, pts, color, emissive = 0) => facing(geo, pts, color, emissive, pts[0][0], 50, pts[0][2]);
    COURSES.forEach(([r0, r1, n, tones], c) => {
      for (let k = 0; k < n; k++) {
        const a0 = (k + (c % 2) * 0.5) / n * TAU, a1 = a0 + TAU / n, i0 = r0 + gap, i1 = r1 - gap, g0 = gap / i0, g1 = gap / i1;
        const pts = [[i0, a0 + g0], [i1, a0 + g1], [i1, (a0 + a1) / 2], [i1, a1 - g1], [i0, a1 - g0]].map(([r, a]) => [Math.sin(a) * r, 0.01, Math.cos(a) * r]);
        up(flags, pts, tones[(k * 7 + c * 3 + (k * k) % 5) % tones.length]);
      }
    });
    for (const [r0, r1, color] of BANDS) for (let k = 0; k < 64; k++) {
      const a0 = k / 64 * TAU, a1 = (k + 1) / 64 * TAU;
      up(metal, [[r0, a0], [r1, a0], [r1, a1], [r0, a1]].map(([r, a]) => [Math.sin(a) * r, 0.014, Math.cos(a) * r]), color, 0.12);
    }
    // Bronze spokes on the joints between the middle courses' flags, from the brass band out to the outer bronze one.
    for (let k = 0; k < 12; k++) {
      const a = (k + 0.5) / 12 * TAU, s = Math.sin(a), c = Math.cos(a), px = c * 0.04, pz = -s * 0.04;
      up(metal, [[s * 6.1 - px, 0.014, c * 6.1 - pz], [s * 6.1 + px, 0.014, c * 6.1 + pz], [s * 9.4 + px, 0.014, c * 9.4 + pz], [s * 9.4 - px, 0.014, c * 9.4 - pz]], BRONZE, 0.12);
    }
    // Twelve ₿ cut into the dark course, turned to read from the dais, in the warm gold the concept lights them.
    const cut = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * TAU + TAU / 24;
      cut.push(moved(turnedY(turnedX(FM.smoothBitcoin(0.62, 0.01, "#e0923a", 0.4), -Math.PI / 2), a + Math.PI), Math.sin(a) * 5.2, 0.016, Math.cos(a) * 5.2));
    }
    return { floor: merge(grout, flags), inlay: noShadow(merge(metal, ...cut)) };
  };

  // Stone pilasters between the openings, each with a banner of the ₿ on its face, a bush on its capital and a lantern
  // on a post before it.
  const PILLARS = (() => {
    const at = OPENINGS.map((o) => o.bearing).sort((a, b) => a - b), out = [];
    for (let i = 0; i < at.length; i++) {
      const a = at[i], b = i + 1 < at.length ? at[i + 1] : at[0] + TAU;
      out.push((a + b) / 2);
    }
    return out;
  })();
  const PILLAR_R = HALL.r - 0.25, POST_R = HALL.r - 2.2;
  const pillars = cached(() => {
    const geos = [], cloth = [];
    for (const b of PILLARS) {
      const sr = Math.sin(b), cr = Math.cos(b), place = (g) => moved(turnedY(g, b + Math.PI), sr * PILLAR_R, 0, cr * PILLAR_R);
      geos.push(place(merge(
        bevelBox({ w: 1.3, h: HALL.wall, d: 0.9, color: STONE[2], bevel: 0.1, offset: { y: HALL.wall / 2 } }),
        bevelBox({ w: 1.55, h: 0.5, d: 1.1, color: STONE_DK, bevel: 0.08, offset: { y: 0.25 } }),
        bevelBox({ w: 1.5, h: 0.16, d: 1.05, color: BRONZE, bevel: 0.04, offset: { y: 0.58 } }),
        bevelBox({ w: 1.5, h: 0.16, d: 1.05, color: BRONZE, bevel: 0.04, offset: { y: HALL.wall - 0.5 } }),
        bevelBox({ w: 1.62, h: 0.4, d: 1.15, color: STONE_LT, bevel: 0.08, offset: { y: HALL.wall - 0.2 } })
      )));
      cloth.push(place(moved(merge(banner()), 0, 7.35, 0.52)));
    }
    return { stone: merge(...geos), banners: banners(...cloth) };
  });

  // ---- the openings -------------------------------------------------------------------------------

  // The arch round the way in, turned to face the hall, and the tunnel out to the field: coursed walls under a
  // barrel vault, three ribs of stone with blue studs, banners between the ribs, the field's strips down the floor,
  // and the field itself at the far end, set in an arch of its own between bronze emitters. Past the field the rock
  // closes the tunnel (`closer`), unless the scene hangs the island's picture there instead.
  const tunnel = cached(() => {
    const { halfW, spring, field } = ENTRY, R = HALL.r, z0 = R - 0.4, z1 = field + ENTRY.beyond + 0.2, len = z1 - z0, mid = (z0 + z1) / 2;
    const geos = [], lit = [], wall = halfW + 0.35, rows = Math.round(spring / 0.6);
    // A hair under the hall's grout, which reaches into the doorway.
    geos.push(box({ w: 2 * wall + 0.8, h: 0.3, d: len, color: STONE[3], offset: { y: -0.16, z: mid } }));
    for (const s of [-1, 1]) for (let row = 0; row < rows; row++) for (let z = z0; z < z1 - 0.3; z += 1.2) {
      const h = spring / rows;
      geos.push(bevelBox({ w: 0.7, h: h - 0.04, d: 1.16, color: (row + Math.round(z / 1.2)) % 2 ? STONE[0] : STONE[2], bevel: 0.07, offset: { x: s * wall, y: h * (row + 0.5), z: Math.min(z + 0.6, z1 - 0.6) } }));
    }
    const vr = halfW + 0.35, n = 11;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * k / n;
      geos.push(moved(turnedZ(box({ w: vr * Math.PI / n * 1.05, h: 0.5, d: len, color: k % 2 ? STONE[1] : STONE[3] }), a - Math.PI / 2), Math.cos(a) * (vr + 0.2), spring + Math.sin(a) * (vr + 0.2), mid));
    }
    for (const z of [R + 1.4, R + 3.7, field - 1.6]) {
      geos.push(moved(archRing(halfW + 0.1, spring, 0.5, 0.5), 0, 0, z));
      for (let k = 1; k < 6; k++) {
        const a = Math.PI * k / 6, r = halfW + 0.35;
        lit.push(box({ w: 0.14, h: 0.14, d: 0.56, color: FIELD, emissive: 1, offset: { x: Math.cos(a) * r, y: spring + Math.sin(a) * r, z } }));
      }
    }
    // A banner on each wall between the ribs, turned to face across the tunnel.
    const cloth = [];
    for (const z of [R + 2.55, R + 4.55]) for (const s of [-1, 1]) cloth.push(moved(turnedY(merge(banner()), -s * Math.PI / 2), s * (halfW - 0.05), 3.75, z));
    for (const x of [-1.2, 1.2]) lit.push(box({ w: 0.12, h: 0.02, d: field - z0, color: FIELD, emissive: 0.9, offset: { x, y: 0.01, z: (z0 + field) / 2 } }));
    // The field's arch and emitters.
    geos.push(moved(turnedY(archRing(halfW, spring, 0.7), Math.PI), 0, 0, field + 0.2));
    for (const s of [-1, 1]) {
      geos.push(bevelBox({ w: 0.36, h: spring + 0.6, d: 0.36, color: BRONZE_DK, bevel: 0.05, offset: { x: s * (halfW - 0.05), y: (spring + 0.6) / 2, z: field - 0.35 } }));
      for (let y = 0.5; y < spring + 0.3; y += 0.45) lit.push(box({ w: 0.44, h: 0.1, d: 0.44, color: FIELD_LT, emissive: 0.95, offset: { x: s * (halfW - 0.05), y, z: field - 0.35 } }));
    }
    const closer = box({ w: 2 * wall + 1.4, h: spring + halfW + 1.6, d: 0.6, color: STONE_DK, offset: { y: (spring + halfW + 1.6) / 2, z: z1 + 0.3 } });
    return { stone: merge(...geos), closer, banners: banners(...cloth), glow: noShadow(merge(...lit)), mouth: turnedY(archRing(halfW + 0.2, spring, 1.3), Math.PI) };
  });

  // The field, facing +z about z 0: a deep blue sheet filling an arched opening and a bright rim round its edge.
  const fieldSheet = (halfW, spring) => {
    const fill = facing(geometry(), archOutline(halfW, spring, 0), FIELD_DK, 0.9, 0, spring, 1);
    return noShadow(merge(fill, archNeon(halfW - 0.06, spring, 0.03, FIELD_LT, 0.06)));
  };
  // The field's sparkles at z, facing +z, as both sides of the way in show them: white and pale blue specks and a few
  // four-pointed glints, each glint two flat bars 0.03 wide run on past their ends.
  const fieldSparkles = (z) => {
    const geo = geometry(), rand = mulberry32(2150), S = ENTRY.spring, w = 0.015, zh = z + 0.002, zv = z + 0.004;
    for (let k = 0; k < 44;) {
      const x = (rand() * 2 - 1) * 1.8, y = 0.15 + rand() * 4.05, s = 0.03 + rand() * 0.045, color = rand() < 0.7 ? "#ffffff" : "#bde6ff";
      if (!inArch(x, y, 1.75, S)) continue;
      facing(geo, [[x - s, y - s, z], [x + s, y - s, z], [x + s, y + s, z], [x - s, y + s, z]], color, 1, x, y, z + 1);
      k++;
    }
    for (let k = 0; k < 7;) {
      const x = (rand() * 2 - 1) * 1.5, y = 0.5 + rand() * 3.5, l = 0.1 + rand() * 0.06;
      if (!inArch(x, y, 1.5, S)) continue;
      facing(geo, [[x - l - w, y - w, zh], [x + l + w, y - w, zh], [x + l + w, y + w, zh], [x - l - w, y + w, zh]], "#ffffff", 1, x - l, y, zh + 1);
      facing(geo, [[x + w, y - l - w, zv], [x + w, y + l + w, zv], [x - w, y + l + w, zv], [x - w, y - l - w, zv]], "#ffffff", 1, x, y - l, zv + 1);
      k++;
    }
    return geo;
  };
  // The way in's field: the deep blue sheet, or, with the island's picture hung past it, a veil of the field's blue that
  // the picture shows through, with the same bright rim; the island's sparkles on either.
  const entryField = cached(() => {
    const veil = facing(geometry(), archOutline(ENTRY.halfW, ENTRY.spring, 0), FIELD, 0.85, 0, ENTRY.spring, 1);
    veil.glass = 0.28;
    veil.castShadow = false;
    return { sheet: fieldSheet(ENTRY.halfW, ENTRY.spring), veil, rim: noShadow(archNeon(ENTRY.halfW - 0.06, ENTRY.spring, 0.03, FIELD_LT, 0.06)), sparkles: noShadow(fieldSparkles(0.05)) };
  });

  // A window, in its frame. The frame stands proud of the wall as the concept draws it: a deep ring of dressed stone
  // edged in brass inside and out, a second course stepped back behind it, plinths under the jambs, brass imposts
  // where the arch springs, and a gilt ₿ medallion on the keystone. Inside it runs the field's blue: a bright strip
  // round the opening, a deeper one behind, and studs of light along the soffit, all at part strength so the scene
  // can brighten an open world's as someone comes near (`glow`). A `travel` window has a passage going back to where its picture
  // hangs, lined in the field's dark blue with bright ribs; a `mirror` has a reflector just inside the arch.
  const WINDOW_TOP = WINDOW.spring + WINDOW.halfW;
  // The frame's ring (its width and depth), the stepped course behind it (width and depth), and how far the whole frame
  // stands proud of the wall's line, so the curving wall never covers the course: at the course's width the wall
  // comes about 0.4 m nearer the hall, and its blocks as much again. `front` and `courseFront` are the two faces.
  const PROUD = 0.45;
  const FRAME = { band: 1.2, depth: 1.5, course: 0.4, courseDepth: 0.8, proud: PROUD, front: PROUD + 0.75, courseFront: PROUD + 0.45 };
  const archStone = cached(() => {
    const { halfW, spring } = WINDOW, { band, depth, course, courseDepth, proud } = FRAME, front = FRAME.front + 0.03, out = halfW + band, jamb = halfW + band / 2;
    const geos = [moved(archRing(halfW, spring, depth, band), 0, 0, proud), moved(archRing(out, spring, courseDepth, course), 0, 0, FRAME.courseFront - courseDepth / 2)];
    geos.push(archNeon(halfW + 0.03, spring, front, BRASS, 0.06, 0), archNeon(out - 0.03, spring, front, BRASS, 0.06, 0), archNeon(out + course - 0.03, spring, FRAME.courseFront + 0.02, BRASS, 0.05, 0));
    for (const s of [-1, 1]) {
      geos.push(bevelBox({ w: band + 0.3, h: 0.7, d: depth + 0.3, color: STONE_DK, bevel: 0.08, offset: { x: s * jamb, y: 0.35, z: proud } }));
      geos.push(bevelBox({ w: band + 0.2, h: 0.12, d: depth + 0.2, color: BRASS, bevel: 0.03, offset: { x: s * jamb, y: 0.74, z: proud } }));
      geos.push(bevelBox({ w: band + 0.26, h: 0.2, d: depth + 0.22, color: BRASS, bevel: 0.04, offset: { x: s * jamb, y: spring, z: proud } }));
    }
    const key = spring + halfW + band / 2;
    geos.push(moved(disc(0.44, 0.1, BRONZE_DK), 0, key, front + 0.1), moved(hoop(0.4, 0, 0.035, GOLD, 0.3), 0, key, front + 0.16), moved(FM.smoothBitcoin(0.56, 0.06, GOLD, 0.8), 0, key, front + 0.18));
    return merge(...geos);
  });
  const archGlow = cached(() => {
    const { halfW, spring } = WINDOW, studs = [], edge = halfW - 0.02, total = archEdge(edge, spring);
    for (let d = 0.25; d < total; d += 0.42) studs.push(box({ w: 0.12, h: 0.12, d: 0.12, color: "#e8f6ff", emissive: 0.4, offset: archAt(edge, spring, FRAME.proud, d) }));
    return noShadow(merge(archNeon(halfW - 0.1, spring, FRAME.front - 0.4, FIELD_LT, 0.13, 0.35), archNeon(halfW - 0.08, spring, -0.25, FIELD, 0.08, 0.35), ...studs));
  });
  // An open world's frame is marked out by a glowing rim just outside its ring, growing outward so it never covers the
  // keystone's ₿, and a thinner one round the stepped course behind: its world's `tint` at rest, then in `RIM_STEPS` steps thicker and whiter, up to
  // white-hot, which the scene climbs as someone comes near. Cached by tint and step.
  const RIM_STEPS = 8;
  const blend = (a, b, t) => "#" + hexToRgb(a).map((v, k) => Math.round(v + (hexToRgb(b)[k] - v) * t).toString(16).padStart(2, "0")).join("");
  const rims = new Map();
  const portalRim = (tint, k) => {
    const key = `${tint}|${k}`;
    if (rims.has(key)) return rims.get(key);
    const t = k / (RIM_STEPS - 1), { halfW, spring } = WINDOW, out = halfW + FRAME.band;
    const color = blend(tint, "#f4f9ff", t * 0.9), glow = 0.65 + 0.35 * t;
    const r = 0.09 + 0.14 * t;
    const geo = noShadow(merge(archNeon(out - 0.06 + r, spring, FRAME.front + 0.05, color, r, glow), archNeon(out + FRAME.course, spring, FRAME.courseFront + 0.04, color, 0.05 + 0.08 * t, glow)));
    rims.set(key, geo);
    return geo;
  };
  // A label's board hangs from the wall on two brass rods, `w` wide, its middle at y 0, the rods climbing `up` and back
  // `back` to the wall.
  const hangers = new Map();
  const hanger = (w, up, back) => {
    const key = `${w.toFixed(2)}|${up}|${back}`;
    if (!hangers.has(key)) hangers.set(key, merge(...[-w / 2 + 0.12, w / 2 - 0.12].map((x) => FM.beam(x, 0.3, -0.02, x, up, -back, 0.04, BRASS))));
    return hangers.get(key);
  };
  const passage = cached(() => {
    const { halfW, spring, depth, flare, rise } = WINDOW, geo = geometry(), glow = [], near = halfW + 0.05, far = halfW + flare, h0 = spring + halfW + 0.05, h1 = h0 + rise;
    // The walls and roof look in, toward the passage's middle; the floor is a slate quad of its own, faintly lit.
    facing(geo, [[-near, 0, 0], [-far, 0, -depth], [-far, h1, -depth], [-near, h0, 0]], PASSAGE, 0.3, 0, h0 / 2, -depth / 2);
    facing(geo, [[near, 0, 0], [far, 0, -depth], [far, h1, -depth], [near, h0, 0]], PASSAGE, 0.3, 0, h0 / 2, -depth / 2);
    facing(geo, [[-near, h0, 0], [near, h0, 0], [far, h1, -depth], [-far, h1, -depth]], PASSAGE, 0.3, 0, 0, -depth / 2);
    facing(geo, [[-far, 0.005, -depth], [far, 0.005, -depth], [near, 0.005, 0], [-near, 0.005, 0]], "#3c3e52", 0.15, 0, 1, -depth / 2);
    for (const z of [-1.2, -2.4, -3.6]) {
      const k = -z / depth, w = near + (far - near) * k - 0.04, h = h0 + (h1 - h0) * k - 0.04;
      glow.push(tube({ path: through([[-w, 0.02, z], [-w, h, z], [w, h, z], [w, 0.02, z]]), radius: () => 0.05, rings: 24, segments: 5, colorFn: () => FIELD, emissive: 0.5 }));
    }
    return { walls: geo, glow: noShadow(merge(...glow)), picture: { w: 2 * far, h: h1, z: -depth + 0.02 } };
  });
  // The picture's quad, `w` by `h` from the floor up, facing +z at `z`, with `asset` (an image asset, as `outsideView`
  // takes it) over it.
  const pictureQuad = (asset, { w, h, z }) => {
    const geo = { verts: [-w / 2, 0, z, w / 2, 0, z, w / 2, h, z, -w / 2, h, z], faces: [{ i: [0, 1, 2, 3], color: [0, 0, 0], emissive: 0 }], lines: [], castShadow: false };
    geo.imageSurface = { asset, rect: [-w / 2, 0, w, h] };
    return geo;
  };
  // A window's stand-in picture, as its `stand` describes it (see `DSB_STAND`), cached by the stand's key.
  const stands = new Map();
  const standIn = (stand) => {
    if (stands.has(stand.key)) return stands.get(stand.key);
    const { w, h, z } = passage().picture, parts = [];
    for (const [y0, y1, color, emissive] of stand.bands) parts.push(box({ w, h: h * y1 - h * y0, d: 0.05, color, emissive, offset: { y: (h * y0 + h * y1) / 2, z } }));
    for (let k = 0; k < 9; k++) parts.push(box({ w: 0.14, h: 0.14, d: 0.04, color: k % 3 ? stand.dots[0] : stand.dots[1], emissive: 1, offset: { x: ((k * 0.618) % 1 - 0.5) * w * 0.85, y: h * (stand.dotY[0] + ((k * 0.37) % 1) * stand.dotY[1]), z: z + 0.04 } }));
    const geo = noShadow(merge(...parts));
    stands.set(stand.key, geo);
    return geo;
  };
  // A colour lifted to glow: its hue kept, its saturation and lightness raised to at least `s` and `l`.
  const glowing = (hex, s = 0.55, l = 0.58) => {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const S = Math.max(s, d === 0 ? 0 : d / (1 - Math.abs(max + min - 1))), L = Math.max(l, (max + min) / 2);
    const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(hue % 2 - 1)), m = L - c / 2;
    const rgb = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
    return "#" + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
  };
  // The poker room dresses itself in the cave theme its visitor last chose there, and so does its window: the theme's
  // felt, lifted to glow, is the window's colour, and the room's floor, felt, walls, ceiling and lamps are its stand-in.
  // The picture is the room in that theme, so it is keyed by the theme too.
  const pokerLook = () => {
    const theme = BL.pokerThemes.get(BL.pokerThemes.load()), ui = theme.ui, key = `poker:${theme.id}`;
    return {
      key, theme, tint: glowing(ui.feltLight),
      stand: { key, bands: [[0, 0.2, theme.runner, 0.35], [0.2, 0.3, ui.feltLight, 0.6], [0.3, 0.78, theme.stone[1], 0.3], [0.78, 1, ui.deep, 0.5]], dots: [ui.bright, ui.accent], dotY: [0.42, 0.3] }
    };
  };
  // An open world's looks now: the key its picture goes by, its tint and its stand-in.
  const lookOf = (row) => row.look ? row.look() : { key: row.id, tint: row.tint, stand: row.stand };
  // A window's mirror, `MIRROR_Z` past the wall's face inside its arch: one quad facing +z at z 0, a reflector keyed on
  // its own geometry, so each window has a glass of its own (by slot). `backing` closes the arch behind the glass,
  // which shows nothing until its first capture and on Canvas 2D only its sheen. Every window shares the backing.
  const MIRROR_Z = 0.25;
  const quadAt = (z, color, emissive) => ({
    verts: [-WINDOW.halfW, 0.05, z, WINDOW.halfW, 0.05, z, WINDOW.halfW, WINDOW_TOP, z, -WINDOW.halfW, WINDOW_TOP, z],
    faces: [{ i: [0, 1, 2, 3], color: hexToRgb(color), emissive }], lines: [], castShadow: false
  });
  const mirrorShared = cached(() => ({
    backing: box({ w: 2 * WINDOW.halfW + 0.4, h: WINDOW_TOP + 0.4, d: 0.2, color: "#0a0d16", offset: { y: (WINDOW_TOP + 0.4) / 2, z: -MIRROR_Z - 0.35 } })
  }));
  const mirror = variants(() => ({ glass: { ...quadAt(0, "#8395a6", 0), reflector: true }, ...mirrorShared() }));

  // ---- the mechanism ------------------------------------------------------------------------------

  // The dais and the plinth, turned in stone and bronze; the ₿ that turns over it; three rings of bronze and brass that
  // turn about it, each with gold studs; and the beam of light from over the ₿ into the sky.
  const coreBase = cached(() => {
    const [[r0, y0], [r1, y1]] = CORE.steps, p = CORE.plinth;
    const dais = lathe({ profile: [[r0, 0], [r0, y0], [r1, y0], [r1, y1], [p + 0.3, y1], [p + 0.3, y1 + 0.02]], segments: 40, color: (t) => t < 0.4 ? STONE[2] : STONE[1] });
    const plinth = lathe({ profile: [[p, y1], [p, y1 + 0.25], [p - 0.25, y1 + 0.35], [p - 0.45, y1 + 1.5], [p - 0.2, y1 + 1.65], [p - 0.2, y1 + 1.8], [0.6, y1 + 1.9], [0, y1 + 1.92]], segments: 24, color: (t) => t < 0.2 || t > 0.6 ? BRASS : BRONZE_DK });
    const lamps = [];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU;
      lamps.push(box({ w: 0.22, h: 0.1, d: 0.22, color: FIELD, emissive: 1, offset: { x: Math.sin(a) * (r1 - 0.25), y: y1 + 0.05, z: Math.cos(a) * (r1 - 0.25) } }));
    }
    return { stone: merge(dais, plinth), glow: noShadow(merge(ring({ r: p - 0.35, thickness: 0.06, y: y1 + 1.95, segments: 32, color: GOLD, emissive: 1 }), ...lamps)) };
  });
  const coreGlyph = cached(() => FM.smoothBitcoin(1.9, 0.32, GOLD, 1));
  const coreRings = cached(() => CORE.rings.map((r, i) => {
    const studs = [];
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + i * 0.4; studs.push(moved(ball(0.09, GOLD, 0.6), Math.cos(a) * r, 0, Math.sin(a) * r)); }
    return merge(ring({ r, thickness: 0.055 + i * 0.01, segments: 48, color: i === 1 ? BRASS : BRONZE }), ...studs);
  }));
  // The beam of light from over the ₿ into the sky, a stack of short drums sharing one mesh, each a little taller than
  // the one below, so the scene can light each drum on its own and run bands of light up the beam itself. `rows` hold
  // each drum's foot, height and radius, the beam's width up to the crown thinning to a thread at the top of the sky.
  const BEAM = { from: CORE.glyphY + 1.2, first: 0.2, grow: 1.075, waist: 90 };
  const BEAM_GOLD = "#ffd98a", SHOCK_GOLD = "#ffe6a0";
  const beamDrum = (color) => noShadow(lathe({ profile: [[0, 0], [1, 0], [1, 1], [0, 1]], segments: 10, color, emissive: 0.85 }));
  const coreBeam = cached(() => {
    const widthAt = (y) => y < HALL.apex ? 0.1 : y < BEAM.waist ? 0.1 - 0.05 * (y - HALL.apex) / (BEAM.waist - HALL.apex) : 0.05 * (SKY.beam - y) / (SKY.beam - BEAM.waist);
    const rows = [];
    for (let y = BEAM.from, h = BEAM.first; y < SKY.beam; y += h, h *= BEAM.grow) {
      const top = Math.min(SKY.beam, y + h);
      rows.push({ y, h: top - y, r: Math.max(0.006, widthAt((y + top) / 2)) });
    }
    return { geometry: beamDrum(BEAM_GOLD), rows };
  });
  // The shockwave the mechanism throws off when it bursts, a thin glowing ring a metre in radius that the scene spreads
  // out, seen from above and below.
  const shockRing = (color) => noShadow(merge(lathe({ profile: [[1, 0], [0.88, 0]], segments: 48, color, emissive: 1 }), lathe({ profile: [[0.88, 0], [1, 0]], segments: 48, color, emissive: 1 })));
  const shockwave = cached(() => shockRing(SHOCK_GOLD));
  // The mechanism charging toward an open world takes on that world's colour: the beam's drum and the shockwave blended
  // from their gold toward its `tint` in `CHARGE_STEPS` steps, the first their own gold. Cached by tint.
  const CHARGE_STEPS = 6;
  const chargedSets = new Map();
  const charged = (tint) => {
    if (chargedSets.has(tint)) return chargedSets.get(tint);
    const beam = [coreBeam().geometry], shock = [shockwave()];
    for (let k = 1; k < CHARGE_STEPS; k++) {
      const t = k / (CHARGE_STEPS - 1);
      beam.push(beamDrum(blend(BEAM_GOLD, tint, t)));
      shock.push(shockRing(blend(SHOCK_GOLD, tint, t)));
    }
    const set = { beam, shock };
    chargedSets.set(tint, set);
    return set;
  };

  // ---- the sky ------------------------------------------------------------------------------------------

  // What the open dome looks up into, all on a sphere `r` round the hall and emissive, so the hall's lamps never light
  // it: the scene's own sky pass paints the night's gradient, its moon and twinkling stars behind; over them a field of
  // brighter stars (`stars`), a galaxy's band of soft violet and teal haze (`band`, glass so its puffs blend), and the
  // planets, each shaded on its sunward side (`planets`, each built round its own middle with where it stands). A few
  // shooting stars (`meteors`) are laid out ready, each where it streaks and along which way (`dir`), for the scene to
  // light one now and then. `sparse` is Canvas 2D's lighter sky. The beam from the ₿ rises to `beam`.
  const SKY = { r: 320, beam: 180, sun: [0.6, 0.35, 0.72], band: [0.8, 0.25, 0.55] };
  const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  // A flat quad `w` by `h` facing the hall's middle at the point `d` (a unit direction) times `r`, turned `spin` about it.
  const facingIn = (geo, d, r, w, h, spin, color, emissive) => {
    const [dx, dy, dz] = d, up = Math.abs(dy) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    let ax = up[1] * dz - up[2] * dy, ay = up[2] * dx - up[0] * dz, az = up[0] * dy - up[1] * dx;
    const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax, c = Math.cos(spin), s = Math.sin(spin);
    const ux = (ax * c + bx * s) * w / 2, uy = (ay * c + by * s) * w / 2, uz = (az * c + bz * s) * w / 2;
    const vx = (bx * c - ax * s) * h / 2, vy = (by * c - ay * s) * h / 2, vz = (bz * c - az * s) * h / 2, cx = dx * r, cy = dy * r, cz = dz * r;
    return facing(geo, [[cx - ux - vx, cy - uy - vy, cz - uz - vz], [cx + ux - vx, cy + uy - vy, cz + uz - vz], [cx + ux + vx, cy + uy + vy, cz + uz + vz], [cx - ux + vx, cy - uy + vy, cz - uz + vz]], color, emissive, 0, 0, 0);
  };
  // A planet `r` across, banded from pole to pole in `bands` and shaded toward `sun`, its night side dim, turned so its
  // pole leans by `tilt`; `rings` [inner, outer, colours] if it has them. It is shaded upright against the sun turned back
  // by the tilt, so its lit side still faces the sun once it leans.
  const planet = ({ r, bands, sun = SKY.sun, tilt = 0, rings = null, rows = 12, segments = 20 }) => {
    const [ux, uy, uz] = unit(...sun), tc = Math.cos(tilt), ts = Math.sin(tilt);
    const geo = geometry(), rgb = bands.map(hexToRgb), sx = ux * tc + uy * ts, sy = uy * tc - ux * ts, sz = uz, P = [];
    for (let i = 0; i <= rows; i++) {
      const lat = -Math.PI / 2 + Math.PI * i / rows, row = [];
      for (let k = 0; k < segments; k++) { const lon = k / segments * TAU; row.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]); }
      P.push(row);
    }
    const shade = (n) => 0.18 + 0.82 * Math.max(0, n[0] * sx + n[1] * sy + n[2] * sz);
    for (let i = 0; i < rows; i++) for (let k = 0; k < segments; k++) {
      const k2 = (k + 1) % segments, q = [P[i][k], P[i][k2], P[i + 1][k2], P[i + 1][k]], n = unit(q[0][0] + q[2][0], q[0][1] + q[2][1], q[0][2] + q[2][2]);
      const base = rgb[Math.min(rgb.length - 1, Math.floor(i / rows * rgb.length))], k0 = shade(n);
      const ids = q.map(([x, y, z]) => pushVert(geo, x * r, y * r, z * r));
      face(geo, ids.reverse(), base.map((v) => Math.min(255, Math.round(v * k0))), { emissive: 1 });
    }
    const parts = [geo];
    if (rings) {
      const [r0, r1, colours] = rings, ring = geometry(), n = colours.length, lit = 0.35 + 0.65 * Math.abs(sy);
      for (let b = 0; b < n; b++) for (let k = 0; k < 48; k++) {
        const ra = r0 + (r1 - r0) * b / n, rb = r0 + (r1 - r0) * (b + 0.85) / n, a0 = k / 48 * TAU, a1 = (k + 1) / 48 * TAU;
        const pts = [[ra, a0], [rb, a0], [rb, a1], [ra, a1]].map(([rr, a]) => [Math.cos(a) * rr, 0, Math.sin(a) * rr]);
        const col = hexToRgb(colours[b]).map((v) => Math.round(v * lit)), ids = pts.map(([x, y, z]) => pushVert(ring, x, y, z)), back = pts.map(([x, y, z]) => pushVert(ring, x, y, z));
        face(ring, ids, col, { emissive: 1 });
        face(ring, back.reverse(), col, { emissive: 1 });
      }
      parts.push(ring);
    }
    const out = merge(...parts);
    if (tilt) turnedZ(out, tilt);
    return noShadow(out);
  };
  const sky = variants((sparse) => {
    const rand = mulberry32(2140 + sparse), R = SKY.r, stars = geometry(), band = geometry();
    // Stars, thicker toward the zenith the dome frames; a few big and coloured.
    for (let i = 0; i < (sparse ? 260 : 1100); i++) {
      const y = 0.1 + 0.9 * Math.sqrt(rand()), a = rand() * TAU, s = Math.sqrt(1 - y * y), big = rand() < 0.06, size = big ? 1.4 + rand() * 1.2 : 0.45 + rand() * 0.6;
      const tone = rand(), color = tone < 0.6 ? "#f4f6ff" : tone < 0.8 ? "#bcd4ff" : tone < 0.93 ? "#ffe6b0" : "#ffb8a0";
      facingIn(stars, [Math.cos(a) * s, y, Math.sin(a) * s], R, size, size, rand() * TAU, color, 1);
    }
    // The galaxy's band: a great circle across the sky tipped toward the dome, soft puffs along it.
    const [nx, ny, nz] = unit(...SKY.band), ex = unit(ny, -nx, 0), fx = [ny * ex[2] - nz * ex[1], nz * ex[0] - nx * ex[2], nx * ex[1] - ny * ex[0]];
    const hazes = ["#3a1f6e", "#5a2a86", "#20507a", "#2a6a8a", "#6a3a9a"];
    for (let i = 0; i < (sparse ? 40 : 150); i++) {
      const a = rand() * TAU, off = (rand() - 0.5) * 0.42 * (0.5 + rand());
      const d = unit(ex[0] * Math.cos(a) + fx[0] * Math.sin(a) + nx * off, ex[1] * Math.cos(a) + fx[1] * Math.sin(a) + ny * off, ex[2] * Math.cos(a) + fx[2] * Math.sin(a) + nz * off);
      if (d[1] < 0.05) continue;
      const w = 30 + rand() * 50;
      facingIn(band, d, R * 1.02, w, w * (0.5 + rand() * 0.5), rand() * TAU, hazes[Math.floor(rand() * hazes.length)], 0.7);
    }
    band.glass = 0.16;
    // Bright knots and a dust of stars in the band.
    for (let i = 0; i < (sparse ? 60 : 320); i++) {
      const a = rand() * TAU, off = (rand() - 0.5) * 0.18;
      const d = unit(ex[0] * Math.cos(a) + fx[0] * Math.sin(a) + nx * off, ex[1] * Math.cos(a) + fx[1] * Math.sin(a) + ny * off, ex[2] * Math.cos(a) + fx[2] * Math.sin(a) + nz * off);
      if (d[1] < 0.05) continue;
      const size = 0.35 + rand() * 0.7;
      facingIn(stars, d, R * 0.99, size, size, rand() * TAU, rand() < 0.5 ? "#e8ddff" : "#c8f0ff", 1);
    }
    const at = (x, y, z, r) => { const d = unit(x, y, z); return { x: d[0] * r, y: d[1] * r, z: d[2] * r }; };
    const planets = [
      // A ringed giant in amber and cream, high over the far side of the dome.
      { at: at(0.35, 0.72, -0.62, 250), geometry: planet({ r: 26, tilt: 0.38, bands: ["#8a5a2e", "#c9955a", "#e8cf9a", "#b8783e", "#f0dcae", "#a8703a", "#d9b27a", "#7a4a26"], rings: [36, 60, ["#c8a878", "#e6d2a8", "#9a8060", "#dcc294", "#b89a70"]] }) },
      // A small red world.
      { at: at(-0.55, 0.5, -0.67, 280), geometry: planet({ r: 8, bands: ["#6a2a1e", "#a8432a", "#c8603a", "#a8432a", "#7a301e"], rows: 10, segments: 16 }) },
      // An ice world with a moon of its own.
      { at: at(-0.18, 0.84, 0.5, 300), geometry: planet({ r: 12, bands: ["#9ad4e8", "#c8ecf8", "#7ab8d8", "#e8f8ff", "#8ac4e0"], rows: 10, segments: 18 }) },
      { at: at(-0.08, 0.86, 0.5, 300), geometry: planet({ r: 3, bands: ["#9a9aa8", "#c8c8d4", "#8a8a98"], rows: 6, segments: 10 }) }
    ];
    // Shooting stars: a bright head trailing a thinning tail, each laid along its own way across the upper sky.
    const meteors = [];
    for (let i = 0; i < 6; i++) {
      const a = rand() * TAU, y = 0.45 + rand() * 0.4, s = Math.sqrt(1 - y * y), d = [Math.cos(a) * s, y, Math.sin(a) * s];
      const dir = unit(-d[2] + (rand() - 0.5) * 0.3, -0.35 - rand() * 0.3, d[0] + (rand() - 0.5) * 0.3), geo = geometry(), len = 26 + rand() * 18, r = SKY.r * 0.95;
      for (let k = 0; k < 8; k++) {
        const t0 = k / 8, t1 = (k + 1) / 8, w0 = 0.9 * (1 - t0) + 0.05, w1 = 0.9 * (1 - t1) + 0.05;
        const p0 = [d[0] * r - dir[0] * len * t0, d[1] * r - dir[1] * len * t0, d[2] * r - dir[2] * len * t0], p1 = [d[0] * r - dir[0] * len * t1, d[1] * r - dir[1] * len * t1, d[2] * r - dir[2] * len * t1];
        const side = unit(dir[1] * d[2] - dir[2] * d[1], dir[2] * d[0] - dir[0] * d[2], dir[0] * d[1] - dir[1] * d[0]);
        const col = k < 2 ? "#ffffff" : k < 5 ? "#cfe4ff" : "#7aa8ff";
        facing(geo, [[p0[0] - side[0] * w0, p0[1] - side[1] * w0, p0[2] - side[2] * w0], [p0[0] + side[0] * w0, p0[1] + side[1] * w0, p0[2] + side[2] * w0], [p1[0] + side[0] * w1, p1[1] + side[1] * w1, p1[2] + side[2] * w1], [p1[0] - side[0] * w1, p1[1] - side[1] * w1, p1[2] - side[2] * w1]], col, 1 - t0 * 0.6, 0, 0, 0);
      }
      meteors.push({ geometry: noShadow(geo), dir, len: len * 1.6 });
    }
    return { stars: noShadow(stars), band: noShadow(band), planets, meteors };
  });

  // ---- the furniture ------------------------------------------------------------------------------------

  // The court's lamp posts round the dais, as the concept rings it, clear of the ways to the windows and the tunnel;
  // benches of timber round the middle of the hall facing in; and stone planters of bushes flanking each window. The
  // scene stands a bush on each planter and on each pilaster's capital.
  const COURT = [25, 70, 135, 180, -135, -70, -25].map((d) => d * Math.PI / 180), COURT_R = 3.8;
  const BENCHES = [75, 135, -135, -75].map((d) => d * Math.PI / 180), BENCH_R = 7.4;
  const PLANTERS = SLOTS.flatMap((b) => [b - 0.32, b + 0.32]), PLANTER_R = 11, PLANTER_TOP = 0.62;
  const courtPosts = cached(() => merge(...COURT.flatMap((a) => {
    const x = Math.sin(a) * COURT_R, z = Math.cos(a) * COURT_R;
    return [
      bevelBox({ w: 0.36, h: 0.14, d: 0.36, color: STONE_DK, bevel: 0.04, offset: { x, y: 0.07, z } }),
      bevelBox({ w: 0.2, h: 0.92, d: 0.2, color: TIMBER_DK, bevel: 0.04, offset: { x, y: 0.58, z } }),
      bevelBox({ w: 0.3, h: 0.08, d: 0.3, color: BRONZE_DK, bevel: 0.02, offset: { x, y: 1.02, z } })
    ];
  })));
  const bench = cached(() => merge(
    bevelBox({ w: 1.9, h: 0.1, d: 0.26, color: TIMBER, bevel: 0.03, offset: { y: 0.5, z: -0.14 } }),
    bevelBox({ w: 1.9, h: 0.1, d: 0.26, color: TIMBER, bevel: 0.03, offset: { y: 0.5, z: 0.14 } }),
    bevelBox({ w: 0.13, h: 0.46, d: 0.5, color: TIMBER_DK, bevel: 0.03, offset: { x: -0.72, y: 0.23 } }),
    bevelBox({ w: 0.13, h: 0.46, d: 0.5, color: TIMBER_DK, bevel: 0.03, offset: { x: 0.72, y: 0.23 } }),
    bevelBox({ w: 1.44, h: 0.08, d: 0.08, color: TIMBER_DK, bevel: 0.02, offset: { y: 0.16 } })
  ));
  const planter = cached(() => merge(
    bevelBox({ w: 1.1, h: 0.56, d: 1.1, color: STONE[2], bevel: 0.07, offset: { y: 0.28 } }),
    bevelBox({ w: 1.2, h: 0.09, d: 1.2, color: BRONZE, bevel: 0.03, offset: { y: 0.57 } }),
    box({ w: 0.94, h: 0.05, d: 0.94, color: "#3a2a1e", offset: { y: 0.6 } })
  ));

  // Lanterns in the factory's style: on posts before the pilasters, on the court's posts, hung in the tunnel, and two
  // from arms beside the name; `lights` is where each glows.
  const lighting = cached(() => {
    const lamps = [], plaque = name().letters.width / 2 + 0.55 + 0.55, arm = HALL.r - NAME.out;
    for (const b of PILLARS) lamps.push(["post", Math.sin(b) * POST_R, 0, Math.cos(b) * POST_R, b + Math.PI / 2]);
    for (const a of COURT) lamps.push(["rail", Math.sin(a) * COURT_R, 0, Math.cos(a) * COURT_R]);
    for (const z of [HALL.r + 2.55, HALL.r + 4.85]) for (const x of [-1.25, 1.25]) lamps.push(["hang", x, ENTRY.spring + 1.55, z]);
    for (const x of [-plaque, plaque]) lamps.push(["hang", x, NAME.y + NAME.height + 0.9, arm]);
    const lit = FM.lanterns(lamps, []);
    const arms = [-plaque, plaque].map((x) => FM.beam(x, NAME.y + NAME.height + 0.9, HALL.r - 0.1, x, NAME.y + NAME.height + 0.9, arm - 0.08, 0.1, BRONZE_DK));
    return { ...lit, frame: merge(lit.frame, ...arms) };
  });

  // Set dressing from the shared kit: stores and rune stones either side of the way in, vines over it. `DRESS` is also
  // what the walkers step round: [kind, x, z, turns, variant, radius].
  const DRESS = [
    ["runeStone", -3.4, HALL.r - 1.6, 0, 0, 0.6], ["runeStone", 3.4, HALL.r - 1.6, 0, 1, 0.6],
    ["crate", -6.2, 10.2, 1, 0, 0.6], ["barrel", -7.2, 9.4, 0, 1, 0.45], ["crate", 6.4, 10, 0, 1, 0.6]
  ];
  const dressing = cached(() => {
    const set = BL.dressing.set();
    for (const [kind, x, z, turns, variant] of DRESS) set.put(kind, x, 0, z, turns, variant);
    set.put("vine", -2.6, 5.5, HALL.r - 0.55, 2, 0);
    set.put("vine", 2.4, 5.2, HALL.r - 0.55, 2, 1);
    return set.build();
  });

  // ---- where the walkers go ----------------------------------------------------------------------------

  // The floor is flat but for the dais's two steps; past the wall's line there is floor only in the tunnel and in a
  // window's opening.
  const [[STEP_R0, STEP_Y0], [STEP_R1, STEP_Y1]] = CORE.steps;
  const supportAt = (x, z) => {
    const r = Math.hypot(x, z);
    return r < STEP_R1 ? STEP_Y1 : r < STEP_R0 ? STEP_Y0 : 0;
  };
  // Obstacles as circles [x, z, radius]: the lantern posts, the court's posts, the benches (two circles each), the
  // planters, the fronts of the windows' frames either side, and the dressing.
  const BLOCKS = new Float32Array([
    ...PILLARS.flatMap((b) => [Math.sin(b) * POST_R, Math.cos(b) * POST_R, 0.25]),
    ...COURT.flatMap((a) => [Math.sin(a) * COURT_R, Math.cos(a) * COURT_R, 0.22]),
    ...BENCHES.flatMap((a) => [-0.55, 0.55].flatMap((t) => [Math.sin(a) * BENCH_R + Math.cos(a) * t, Math.cos(a) * BENCH_R - Math.sin(a) * t, 0.5])),
    ...PLANTERS.flatMap((a) => [Math.sin(a) * PLANTER_R, Math.cos(a) * PLANTER_R, 0.72]),
    ...SLOTS.flatMap((b) => [-1, 1].flatMap((s) => {
      const r = HALL.r - FRAME.front + 0.3, x = WINDOW.halfW + FRAME.band / 2;
      return [Math.sin(b) * r + Math.cos(b) * s * x, Math.cos(b) * r - Math.sin(b) * s * x, 0.55];
    })),
    ...DRESS.flatMap(([, x, z, , , r]) => [x, z, r])
  ]);
  // How far past the wall's face a walker's body may reach in each window: a traveller walks on through the field
  // while the scene fades; a linked mirror allows the body's centre across the
  // glass before the scene carries that step out of its destination mirror.
  const reachOf = (kind) => (kind === "travel" ? WINDOW.plane : MIRROR_Z) + WINDOW.recess;
  // Each window's bearing turned once, for the walk checks.
  const SLOT_SIN = SLOTS.map((b) => Math.sin(b)), SLOT_COS = SLOTS.map((b) => Math.cos(b));
  const clearAt = (x, z, radius, kinds) => {
    const r = Math.hypot(x, z);
    if (r < CORE.plinth + radius) return false;
    for (let i = 0; i < BLOCKS.length; i += 3) {
      const dx = x - BLOCKS[i], dz = z - BLOCKS[i + 1], d = BLOCKS[i + 2] + radius;
      if (dx * dx + dz * dz < d * d) return false;
    }
    if (r <= HALL.r - 0.9 - radius) return true;
    // Through the way in, as far as just past the field.
    if (z > 0 && Math.abs(x) <= ENTRY.halfW - 0.1 - radius) return z <= ENTRY.field + ENTRY.beyond;
    // Into a window's opening, as far as its kind allows, from wherever the hall's ring leaves off for this walker.
    for (let i = 0; i < SLOTS.length; i++) {
      const sr = SLOT_SIN[i], cr = SLOT_COS[i], along = x * sr + z * cr - HALL.r, across = x * cr - z * sr;
      if (Math.abs(across) <= WINDOW.halfW - 0.1 - radius && along > -1.5 - radius && along <= reachOf(kinds[i]) - radius) return true;
    }
    return false;
  };
  // Whether a walker of `radius` can step from (ax, az) to (bx, bz), clear all the way; `kinds` is each window's kind
  // as the scene resolved it.
  const walkable = (ax, az, bx, bz, radius, kinds) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
    for (let i = 1; i <= steps; i++) if (!clearAt(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, radius, kinds)) return false;
    return true;
  };

  // ---- the chamber through the island's gate -------------------------------------------------------------

  // The chamber as the island sees it through the field in the gatehouse's portal: the island's window
  // (`bifrost-window.js`) pulls every point of this stand-in along its own sight line into a band just behind the
  // field, so it is built at full size in the chamber's frame from the chamber's own tables, and kept light. Every face
  // glows with the chamber's light at rest baked into its colour, so the island's sun and clock never touch it, and
  // stone stays dark, so the island's bloom picks out only the lights. Every sight line through the field runs down the
  // tunnel between its walls, so past the tunnel only the fan they reach is built: the floor there, the far arc of the
  // wall with its four windows, the pilasters and the dome over it, the court and the mechanism. Floor, wall and dome
  // share one grid of bearings, so no seam opens between them; inlays are cut into what they lie in rather than laid
  // over it, and lit details stand a tenth of a metre proud, so the window's squeeze never folds them together.
  //
  // `front` is the tunnel's last half metre before the field at true size, where an Ooga walks through, with the
  // field's emitters; `hall` is everything else that stands still, cut off where `front` begins (`GATE_CUT`). The window
  // turns the `glyph` and the three `rings` (each already tipped as the scene tips it) about the mechanism's axis at
  // their own heights, runs bands up the `beam`'s drums (its `rows`, stopped at the crown) and breathes the open world's
  // `rim`, which is null while no world is open.
  const GATE_CUT = ENTRY.field - 0.5;
  // The chamber's light at rest, as `scene-bifrost.js` sets it: the moon's cool light through the open dome over an
  // ambient floor, and no fog. Stone is dimmed by `dim` for the bloom it feeds, then eased from `knee` to under `cap`.
  const BIFROST_MOOD = {
    sky: [0.3, 0.3, 0.38], ground: [0.13, 0.11, 0.1], floor: 0.3, sun: [-0.45, 0.72, 0.53], direct: [0.42, 0.5, 0.68], strength: 0.32, fill: [0.05, 0.04, 0.11],
    fog: [0, 0, 0], near: 1e6, far: 2e6, eye: [0, 1.6, ENTRY.field + 10], dim: 0.7, knee: 0.08, cap: 0.22
  };
  // How the scene tips the mechanism's three rings, about x then z.
  const RING_TILT = [[Math.PI / 2, 0], [1.1, 0.5], [0.4, -0.9]];
  // The ₿ as `FM.smoothBitcoin` cuts it, coarser, in its unit metrics (-1 to 1 with the ticks): the stem, the three
  // bars, the four ticks, and each bowl in three pieces.
  const BTC_PLATES = (() => {
    const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const out = [
      rect(-0.55, -0.75, -0.3, 0.75), rect(-0.3, 0.5, 0.05, 0.75), rect(-0.3, -0.12, 0.1, 0.12), rect(-0.3, -0.75, 0.1, -0.5),
      rect(-0.45, 0.75, -0.3, 1), rect(-0.12, 0.75, 0.03, 1), rect(-0.45, -1, -0.3, -0.75), rect(-0.12, -1, 0.03, -0.75)
    ];
    for (const [cx, cy] of [[0.05, 0.315], [0.1, -0.315]]) for (let k = 0; k < 3; k++) {
      const a0 = -Math.PI / 2 + Math.PI * k / 3, a1 = a0 + Math.PI / 3;
      out.push([[cx + Math.cos(a0) * 0.185, cy + Math.sin(a0) * 0.185], [cx + Math.cos(a0) * 0.435, cy + Math.sin(a0) * 0.435], [cx + Math.cos(a1) * 0.435, cy + Math.sin(a1) * 0.435], [cx + Math.cos(a1) * 0.185, cy + Math.sin(a1) * 0.185]]);
    }
    return out;
  })();
  // The ₿ as flat plates facing +z at z, `height` tall with its ticks, centred on (cx, cy) and leant as the logo leans.
  const btcPlates = (geo, height, cx, cy, z, color, emissive) => {
    const k = height / 2, c = Math.cos(0.24), s = Math.sin(0.24);
    for (const piece of BTC_PLATES) facing(geo, piece.map(([x, y]) => [cx + (x * c + y * s) * k, cy + (-x * s + y * c) * k, z]), color, emissive, cx, cy, z + 1);
  };
  const gateWindow = cached(() => {
    const { halfW, spring, field: F } = ENTRY, R = HALL.r, T0 = R - 0.4, END = F - 0.02, Y = 0.02, VR = halfW + 0.3, FAN = 2 * halfW / (F - T0);
    const still = geometry(), frontGeo = geometry(), parts = [], fronts = [], rims = [];
    // Whether anything at (x, z), `pad` metres across, can be seen through the field: in the tunnel, or in the fan past
    // its inner end that sight lines between its walls reach.
    const seen = (x, z, pad) => z >= T0 || Math.abs(x) <= halfW + (T0 - z) * FAN + pad;

    // The chamber's lights at rest, as `lightUp` sets them: the mechanism, the crown, the field at the way out, each
    // window in its open world's colour or else the field's, then each lantern's pool at the nine tenths of its glow its
    // flicker hovers about. The lanterns stand as `lighting` hangs them, [kind, x, y, z, turn].
    const looks = WINDOWS.map((row) => row.kind === "travel" && BL.scenes[row.scene] ? lookOf(row) : null);
    const lights = [[0, CORE.glyphY, 0, 13, 0.85, 0.55, 0.22], [0, HALL.apex - 2.5, 0, 12, 1, 0.85, 0.55], [0, 2.2, F - 1.2, 8, 0.35, 0.6, 1]];
    WINDOWS.forEach((row, i) => {
      const f = frameOf(i);
      lights.push([f.x - Math.sin(f.bearing) * 1.6, 2.4, f.z - Math.cos(f.bearing) * 1.6, 7, ...(looks[i] ? hexToRgb(looks[i].tint).map((k) => k / 255 * 0.7) : [0.2, 0.325, 0.5])]);
    });
    const plaque = name().letters.width / 2 + 1.1, lamps = [], POOL = [1.17, 0.72, 0.32], IRON = "#2c2e33", LANTERN = "#ffc860";
    for (const b of PILLARS) lamps.push(["post", Math.sin(b) * POST_R, 0, Math.cos(b) * POST_R, b + Math.PI / 2]);
    for (const a of COURT) lamps.push(["rail", Math.sin(a) * COURT_R, 0, Math.cos(a) * COURT_R, 0]);
    for (const z of [R + 2.55, R + 4.85]) for (const x of [-1.25, 1.25]) lamps.push(["hang", x, spring + 1.55, z, 0]);
    for (const x of [-plaque, plaque]) lamps.push(["hang", x, NAME.y + NAME.height + 0.9, R - NAME.out, 0]);
    // A lantern `s` times the size of one 0.84 m tall with its foot at (x, y, z): its lit glass on an iron foot, under an
    // iron cap.
    const lantern = (s, x, y, z) => parts.push(
      box({ w: 0.42 * s, h: 0.07 * s, d: 0.42 * s, color: IRON, offset: { x, y: y + 0.035 * s, z } }),
      box({ w: 0.34 * s, h: 0.44 * s, d: 0.34 * s, color: LANTERN, emissive: 1, offset: { x, y: y + 0.3 * s, z } }),
      moved(turnedY(lathe({ profile: [[0.3 * s, 0.52 * s], [0.14 * s, 0.72 * s], [0, 0.77 * s]], segments: 4, color: IRON }), Math.PI / 4), x, y, z)
    );
    for (const [kind, x, y, z, turn] of lamps) {
      if (kind === "post") {
        const ax = Math.cos(turn), az = -Math.sin(turn), tx = x + ax * 0.8, tz = z + az * 0.8;
        lights.push([tx, y + 1.8, tz, 7.5, ...POOL]);
        if (!seen(x, z, 1.5)) continue;
        parts.push(
          box({ w: 0.22, h: 2.95, d: 0.22, color: TIMBER_DK, offset: { x, y: y + 1.475, z } }),
          FM.beam(x - ax * 0.1, y + 2.82, z - az * 0.1, x + ax * 0.95, y + 2.82, z + az * 0.95, 0.14, TIMBER_DK),
          FM.beam(x, y + 2.25, z, x + ax * 0.55, y + 2.78, z + az * 0.55, 0.09, TIMBER), FM.beam(tx, y + 2.78, tz, tx, y + 2.44, tz, 0.05, IRON)
        );
        lantern(1.3, tx, y + 1.36, tz);
      } else if (kind === "rail") {
        lights.push([x, y + 1.4, z, 7.5, ...POOL]);
        if (!seen(x, z, 1)) continue;
        parts.push(box({ w: 0.36, h: 0.14, d: 0.36, color: STONE_DK, offset: { x, y: 0.07, z } }), box({ w: 0.2, h: 0.92, d: 0.2, color: TIMBER_DK, offset: { x, y: 0.58, z } }), box({ w: 0.3, h: 0.08, d: 0.3, color: BRONZE_DK, offset: { x, y: 1.02, z } }));
        lantern(0.85, x, y + 1.06, z);
      } else {
        lights.push([x, y - 0.75, z, 7.5, ...POOL]);
        // Only the tunnel's hang where a sight line reaches; the pair beside the name face the hall.
        if (z < T0) continue;
        parts.push(FM.beam(x, y - 0.32, z, x, spring + Math.sqrt(VR * VR - x * x) + 0.05, z, 0.05, IRON));
        lantern(1.05, x, y - 0.3 - 0.84 * 1.05, z);
      }
    }

    // A banner as `banner` hangs it, lighter, facing +z with its rod at the origin: the rod, the cloth's face in its two
    // halves, and a tenth of a metre proud of it, the gold edging, the chevron and the ₿.
    const flag = (() => {
      const { w, h, tail } = BANNER, y0 = -0.1, i = 0.07, z = 0.1, geo = geometry();
      for (const half of [[[-w / 2, y0], [0, y0], [0, y0 - h + tail], [-w / 2, y0 - h]], [[0, y0], [w / 2, y0], [w / 2, y0 - h], [0, y0 - h + tail]]]) facing(geo, half.map(([x, y]) => [x, y, 0]), CLOTH, 0, 0, -h / 2, 5);
      const trim = (p, q) => {
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]), nx = -(q[1] - p[1]) / l * 0.025, ny = (q[0] - p[0]) / l * 0.025;
        facing(geo, [[p[0] - nx, p[1] - ny, z], [q[0] - nx, q[1] - ny, z], [q[0] + nx, q[1] + ny, z], [p[0] + nx, p[1] + ny, z]], GOLD, 0.25, 0, -h / 2, 5);
      };
      const edge = [[-w / 2 + i, y0 - i], [w / 2 - i, y0 - i], [w / 2 - i, y0 - h + i * 1.6], [0, y0 - h + tail + i * 1.2], [-w / 2 + i, y0 - h + i * 1.6]];
      edge.forEach((p, k) => trim(p, edge[(k + 1) % edge.length]));
      trim([-0.26, y0 - 0.2], [0, y0 - 0.34]);
      trim([0, y0 - 0.34], [0.26, y0 - 0.2]);
      btcPlates(geo, BANNER.mark / 0.75, 0, y0 - 1.72 + BANNER.mark / 2, z, GOLD, 0.3);
      return merge(geo, box({ w: w + 0.3, h: 0.09, d: 0.09, color: BRONZE_DK }));
    })();

    // The tunnel: its floor in flags with the field's two strips let in flush, its walls in courses up to the arch's
    // spring and the shelf on them, and the vault in its long stones, all in the chamber's blocks 1.2 m along from the
    // tunnel's inner end; the part from GATE_CUT on is `front`.
    const XS = [-halfW, -1.26, -1.14, 0, 1.14, 1.26, halfW];
    const run = (geo, z0, z1) => {
      const n = Math.max(1, Math.round((z1 - z0) / 0.6));
      for (let k = 0; k < n; k++) {
        const za = z0 + (z1 - z0) * k / n, zb = z0 + (z1 - z0) * (k + 1) / n;
        for (let c = 0; c < XS.length - 1; c++) {
          const strip = c === 1 || c === 4;
          facing(geo, [[XS[c], Y, za], [XS[c + 1], Y, za], [XS[c + 1], Y, zb], [XS[c], Y, zb]], strip ? FIELD : STONE[3], strip ? 0.9 : 0, 0, 9, (za + zb) / 2);
        }
      }
      for (let za = z0; za < z1 - 1e-6;) {
        const k = Math.floor((za - T0) / 1.2 + 1e-6), zb = Math.min(z1, T0 + 1.2 * (k + 1)), zm = (za + zb) / 2, course = Math.round((T0 + 1.2 * k) / 1.2);
        for (const s of [-1, 1]) {
          const x = s * halfW;
          for (let row = 0; row < 4; row++) facing(geo, [[x, spring * row / 4, za], [x, spring * (row + 1) / 4, za], [x, spring * (row + 1) / 4, zb], [x, spring * row / 4, zb]], (row + course) % 2 ? STONE[0] : STONE[2], 0, 0, spring / 2, zm);
          facing(geo, [[x, spring, za], [s * VR, spring, za], [s * VR, spring, zb], [x, spring, zb]], STONE[2], 0, x, spring + 5, zm);
        }
        const at = (a, z) => [Math.cos(a) * VR, spring + Math.sin(a) * VR, z];
        for (let v = 0; v < 12; v++) {
          const a0 = Math.max(0, (v - 0.5) * Math.PI / 11), a1 = Math.min(Math.PI, (v + 0.5) * Math.PI / 11);
          facing(geo, [at(a0, za), at(a1, za), at(a1, zb), at(a0, zb)], v % 2 ? STONE[1] : STONE[3], 0, 0, spring, zm);
        }
        za = zb;
      }
    };
    run(still, T0, GATE_CUT);
    run(frontGeo, GATE_CUT, END);
    // The three ribs, the part of each below the vault, with their blue studs; the banners between them, turned to face
    // across the tunnel; and the field's emitters, bronze posts ringed in light, in `front`.
    for (const z of [R + 1.4, R + 3.7, F - 1.6]) {
      const r0 = halfW + 0.1, zf = z + 0.25, at = (r, a, zz) => [Math.cos(a) * r, spring + Math.sin(a) * r, zz];
      for (let k = 0; k < 9; k++) {
        const a0 = Math.PI * k / 9, a1 = Math.PI * (k + 1) / 9, tone = k % 2 ? STONE[3] : STONE[1];
        facing(still, [at(r0, a0, zf), at(VR, a0, zf), at(VR, a1, zf), at(r0, a1, zf)], tone, 0, 0, spring, zf + 5);
        facing(still, [at(r0, a0, z - 0.25), at(r0, a0, zf), at(r0, a1, zf), at(r0, a1, z - 0.25)], tone, 0, 0, spring, z);
      }
      for (let k = 1; k < 6; k++) {
        const [x, y] = at(r0 + 0.1, Math.PI * k / 6, 0);
        parts.push(box({ w: 0.12, h: 0.12, d: 0.16, color: FIELD, emissive: 1, offset: { x, y, z: zf + 0.02 } }));
      }
    }
    for (const z of [R + 2.55, R + 4.55]) for (const s of [-1, 1]) parts.push(moved(turnedY(merge(flag), -s * Math.PI / 2), s * (halfW - 0.12), 3.75, z));
    for (const s of [-1, 1]) {
      fronts.push(box({ w: 0.36, h: spring + 0.6, d: 0.33, color: BRONZE_DK, offset: { x: s * (halfW - 0.05), y: (spring + 0.6) / 2, z: GATE_CUT + 0.165 } }));
      for (let y = 0.5; y < spring + 0.3; y += 0.45) fronts.push(box({ w: 0.44, h: 0.1, d: 0.37, color: FIELD_LT, emissive: 0.95, offset: { x: s * (halfW - 0.05), y, z: GATE_CUT + 0.185 } }));
    }

    // The floor as the concept lays it, in rings round the dais on a grid of bearings: each course's flags in its stone,
    // the bronze and brass bands between courses, the bronze spokes across the middle courses as narrow columns of the
    // grid, and at each spoke's bearing a gilt tile in the dark course, where the concept cuts its ₿. It runs on under
    // the wall, so a window's sill has floor, and where the tunnel opens the rings stop at its mouth.
    const SPOKE = 0.04 / 7.75, COLS = [], spoke = [];
    for (let k = 0; k < 72; k++) {
      const a = k / 72 * TAU;
      if (k % 6 === 3) COLS.push(a - SPOKE, a + SPOKE);
      else COLS.push(a);
    }
    COLS.push(TAU);
    for (let j = 0; j < COLS.length - 1; j++) spoke.push(COLS[j + 1] - COLS[j] < 3 * SPOKE);
    const gilt = (j) => spoke[j] || spoke[(j + 1) % spoke.length] || spoke[(j - 1 + spoke.length) % spoke.length];
    const RINGS = [...COURSES.map(([r0, r1, , tones], c) => ({ r0: c ? r0 : r0 - 0.1, r1, c, tones })), ...BANDS.map(([r0, r1, color]) => ({ r0, r1, c: -1, color }))].sort((p, q) => p.r0 - q.r0);
    const P = (a, r, y = Y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    const cell = (a0, a1, r0, r1, color, emissive) => {
      const am = (a0 + a1) / 2, rm = (r0 + r1) / 2;
      if (!seen(Math.sin(am) * rm, Math.cos(am) * rm, (r1 - r0) / 2 + (a1 - a0) * r1 / 2 + 0.3)) return;
      const o0 = Math.cos(a0) > 0 ? Math.min(r1, T0 / Math.cos(a0)) : r1, o1 = Math.cos(a1) > 0 ? Math.min(r1, T0 / Math.cos(a1)) : r1;
      facing(still, [P(a0, r0), P(a0, o0), P(a1, o1), P(a1, r0)], color, emissive, Math.sin(am) * rm, 9, Math.cos(am) * rm);
    };
    for (const rg of RINGS) for (let j = 0; j < COLS.length - 1; j++) {
      const a0 = COLS[j], a1 = COLS[j + 1];
      if (rg.c < 0) cell(a0, a1, rg.r0, rg.r1, rg.color, 0.12);
      else if (spoke[j] && (rg.c === 2 || rg.c === 3)) cell(a0, a1, rg.r0, rg.r1, BRONZE, 0.12);
      else {
        const tone = rg.tones[(j * 7 + rg.c * 3 + (j * j) % 5) % rg.tones.length];
        if (rg.c === 1 && gilt(j)) {
          cell(a0, a1, rg.r0, 4.9, tone, 0);
          cell(a0, a1, 4.9, 5.5, "#e0923a", 0.4);
          cell(a0, a1, 5.5, rg.r1, tone, 0);
        } else cell(a0, a1, rg.r0, rg.r1, tone, 0);
      }
    }
    // The wall's face on the same grid, in courses of dressed stone with a darker plinth course at its foot and a pale
    // string course at its head, cut round each window's arch a little wider than it, so the frame covers the cut; the
    // dome over it closed in the night's colours, with a scatter of stars and its bronze ribs.
    const ROWS = Math.round(HALL.wall / HALL.unit), shown = (a) => seen(Math.sin(a) * R, Math.cos(a) * R, 1.5);
    const DOME = [[R, HALL.wall], [R * 0.82, HALL.wall + 2.7], [R * 0.5, HALL.apex - 1.1], [1.4, HALL.apex]], NIGHT = ["#15123a", "#0c0c2a", "#07081c"];
    for (let j = 0; j < COLS.length - 1; j++) {
      const a0 = COLS[j], a1 = COLS[j + 1], am = (a0 + a1) / 2, arc = Math.floor((am > Math.PI ? am - TAU : am) * R / 1.5);
      if (!shown(am)) continue;
      for (let row = 0; row < ROWS; row++) {
        const y0 = HALL.wall * row / ROWS, y1 = HALL.wall * (row + 1) / ROWS, ym = (y0 + y1) / 2;
        if (SLOTS.some((b) => Math.cos(am - b) > 0 && inArch(R * Math.sin(am - b), ym, WINDOW.halfW + 0.7, WINDOW.spring))) continue;
        facing(still, [P(a0, R, y0), P(a1, R, y0), P(a1, R, y1), P(a0, R, y1)], row === 0 ? STONE_DK : row === ROWS - 1 ? STONE_LT : STONE[(arc + row * 3) & 3], 0, 0, ym, 0);
      }
      for (let k = 0; k < 3; k++) facing(still, [P(a0, ...DOME[k]), P(a1, ...DOME[k]), P(a1, ...DOME[k + 1]), P(a0, ...DOME[k + 1])], NIGHT[k], 1, 0, 3, 0);
    }
    const rand = mulberry32(2143);
    for (let k = 0; k < 28; k++) {
      const b = Math.PI + (rand() * 2 - 1) * 1.1, u = (0.1 + rand() * 0.8) * 3, s = Math.floor(u), t = u - s;
      const r = DOME[s][0] + (DOME[s + 1][0] - DOME[s][0]) * t, y = DOME[s][1] + (DOME[s + 1][1] - DOME[s][1]) * t, l = Math.hypot(r, y), size = 0.12 + rand() * 0.16, tone = rand();
      facingIn(still, [Math.sin(b) * r / l, y / l, Math.cos(b) * r / l], l - 0.15, size, size, rand() * TAU, tone < 0.6 ? "#f4f6ff" : tone < 0.85 ? "#bcd4ff" : "#ffe6b0", 1);
    }
    for (let s = 0; s < 12; s++) {
      const a = (s + 0.5) / 12 * TAU;
      if (!shown(a)) continue;
      for (let k = 0; k < 3; k++) {
        const [ra, ya] = DOME[k], [rb, yb] = DOME[k + 1];
        parts.push(FM.beam(Math.sin(a) * (ra - 0.22), ya - 0.15, Math.cos(a) * (ra - 0.22), Math.sin(a) * (rb - 0.22), yb - 0.15, Math.cos(a) * (rb - 0.22), 0.2, k === 2 ? BRASS : BRONZE));
      }
    }

    // The pilasters, each with its banner and a bush on its capital; the lanterns' posts before them are hung above.
    // Then the benches, and the planters with their bushes.
    const bush = (r) => lathe({ profile: [[r * 0.9, 0], [r, r * 0.4], [r * 0.7, r * 0.85], [0, r]], segments: 6, color: (t) => t < 0.5 ? "#35602a" : "#4a7d34" });
    for (const b of PILLARS) {
      if (!seen(Math.sin(b) * PILLAR_R, Math.cos(b) * PILLAR_R, 1.5)) continue;
      const g = [
        box({ w: 1.55, h: 0.5, d: 1.1, color: STONE_DK, offset: { y: 0.25 } }), box({ w: 1.62, h: 0.4, d: 1.15, color: STONE_LT, offset: { y: HALL.wall - 0.2 } }),
        moved(merge(flag), 0, 7.35, 0.57), moved(bush(0.62), 0, HALL.wall, 0)
      ];
      for (const y of [0.58, HALL.wall - 0.5]) g.push(box({ w: 1.5, h: 0.16, d: 1.05, color: BRONZE, offset: { y } }));
      for (let k = 0; k < 4; k++) g.push(box({ w: 1.3, h: (HALL.wall - 0.9) / 4, d: 0.9, color: STONE[2], offset: { y: 0.5 + (HALL.wall - 0.9) * (k + 0.5) / 4 } }));
      parts.push(moved(turnedY(merge(...g), b + Math.PI), Math.sin(b) * PILLAR_R, 0, Math.cos(b) * PILLAR_R));
    }
    for (const a of BENCHES) {
      const x = Math.sin(a) * BENCH_R, z = Math.cos(a) * BENCH_R;
      if (!seen(x, z, 1.2)) continue;
      parts.push(moved(turnedY(merge(
        box({ w: 1.9, h: 0.1, d: 0.54, color: TIMBER, offset: { y: 0.5 } }),
        box({ w: 0.13, h: 0.46, d: 0.5, color: TIMBER_DK, offset: { x: -0.72, y: 0.23 } }), box({ w: 0.13, h: 0.46, d: 0.5, color: TIMBER_DK, offset: { x: 0.72, y: 0.23 } })
      ), a), x, 0, z));
    }
    for (const a of PLANTERS) {
      const x = Math.sin(a) * PLANTER_R, z = Math.cos(a) * PLANTER_R;
      if (!seen(x, z, 1)) continue;
      parts.push(moved(turnedY(merge(
        box({ w: 1.1, h: 0.56, d: 1.1, color: STONE[2], offset: { y: 0.28 } }), box({ w: 1.2, h: 0.09, d: 1.2, color: BRONZE, offset: { y: 0.57 } }),
        moved(bush(0.5), 0, PLANTER_TOP - 0.02, 0)
      ), a), x, 0, z));
    }
    // The mechanism's dais and plinth, turned lighter, with the blue lamps on the upper step and the gold ring on top.
    {
      const [[r0, y0], [r1, y1]] = CORE.steps, p = CORE.plinth;
      parts.push(
        lathe({ profile: [[r0, 0], [r0, y0], [r1, y0], [r1, y1], [p + 0.3, y1], [p + 0.3, y1 + 0.02], [p - 0.05, y1 + 0.02]], segments: 24, color: (t) => t < 0.4 ? STONE[2] : STONE[1] }),
        lathe({ profile: [[p, y1], [p, y1 + 0.25], [p - 0.25, y1 + 0.35], [p - 0.45, y1 + 1.5], [p - 0.2, y1 + 1.65], [p - 0.2, y1 + 1.8], [0.6, y1 + 1.9], [0, y1 + 1.92]], segments: 16, color: (t) => t < 0.2 || t > 0.6 ? BRASS : BRONZE_DK }),
        ring({ r: p - 0.35, thickness: 0.06, y: y1 + 1.99, segments: 16, color: GOLD, emissive: 1 })
      );
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU;
        parts.push(box({ w: 0.22, h: 0.1, d: 0.22, color: FIELD, emissive: 1, offset: { x: Math.sin(a) * (r1 - 0.25), y: y1 + 0.05, z: Math.cos(a) * (r1 - 0.25) } }));
      }
    }

    // The windows, each as `archStone` frames it, lighter, built in its own frame (+z into the hall) and stood at its
    // bearing: the deep ring's face in voussoirs between brass edges and down both jambs, its soffit and its outer
    // step; the stepped course behind with its brass edge, its side run back to the wall; the plinths, caps and
    // imposts; the keystone's bronze medallion ringed in gold with its gilt ₿; and inside, set back in the soffit, the
    // field's blue strip. An open world's window runs back down its passage, blue ribs and all, to the picture's
    // stand-in, and is marked out by its rim in the world's colour (`rims`); a mirror is its glass, dark silver
    // lightening upward.
    const { halfW: wh, spring: ws } = WINDOW, out = wh + FRAME.band, fz = FRAME.front, cz = FRAME.courseFront, N = 9;
    const on = (r, a, z) => [Math.cos(a) * r, ws + Math.sin(a) * r, z];
    // The face of an arched band from r0 to r1 at z, facing +z, in N voussoirs of `tone(k)`, and down both legs from
    // `foot` to the spring in `legs` courses of `tone(N + course)`.
    const archFace = (geo, r0, r1, z, tone, emissive, foot, legs) => {
      for (let k = 0; k < N; k++) facing(geo, [on(r0, Math.PI * k / N, z), on(r1, Math.PI * k / N, z), on(r1, Math.PI * (k + 1) / N, z), on(r0, Math.PI * (k + 1) / N, z)], tone(k), emissive, 0, ws, z + 5);
      for (const s of [-1, 1]) for (let row = 0; row < legs; row++) {
        const y0 = foot + (ws - foot) * row / legs, y1 = foot + (ws - foot) * (row + 1) / legs;
        facing(geo, [[s * r0, y0, z], [s * r1, y0, z], [s * r1, y1, z], [s * r0, y1, z]], tone(N + row), emissive, 0, ws, z + 5);
      }
    };
    // The curved side of an arched band at radius r from z0 to z1, facing into the opening or out, and down both legs
    // from `foot`.
    const archSide = (geo, r, z0, z1, color, emissive, foot, inward) => {
      const zm = (z0 + z1) / 2, reach = inward ? 0 : 2 * r;
      for (let k = 0; k < N; k++) {
        const a0 = Math.PI * k / N, a1 = Math.PI * (k + 1) / N, am = (a0 + a1) / 2;
        facing(geo, [on(r, a0, z0), on(r, a0, z1), on(r, a1, z1), on(r, a1, z0)], color, emissive, Math.cos(am) * reach, ws + Math.sin(am) * reach, zm);
      }
      for (const s of [-1, 1]) facing(geo, [[s * r, foot, z0], [s * r, foot, z1], [s * r, ws, z1], [s * r, ws, z0]], color, emissive, s * reach, (foot + ws) / 2, zm);
    };
    const brass = () => BRASS, stone = (k) => k === N >> 1 ? STONE_LT : k >= N ? STONE[k % 2 ? 0 : 2] : STONE[k % 2 ? 3 : 1], coursed = (k) => STONE[k % 2 ? 1 : 3];
    const SILVER = ["#2a323b", "#38424d", "#48535f", "#5b6875", "#76848f"], key = ws + wh + FRAME.band / 2, jamb = wh + FRAME.band / 2;
    const disc = (r, k) => [Math.cos(k / 8 * TAU) * r, key + Math.sin(k / 8 * TAU) * r];
    WINDOWS.forEach((row, i) => {
      const f = frameOf(i), place = (geo) => moved(turnedY(geo, f.ry), f.x, 0, f.z);
      if (!seen(f.x, f.z, 3.5)) return;
      const g = geometry(), bits = [];
      archFace(g, wh, wh + 0.09, fz, brass, 0, 0.8, 1);
      archFace(g, wh + 0.09, out - 0.09, fz, stone, 0, 0.8, 3);
      archFace(g, out - 0.09, out, fz, brass, 0, 0.8, 1);
      archSide(g, wh, FRAME.proud - FRAME.depth / 2, fz, STONE[1], 0, 0.7, true);
      archSide(g, out, cz, fz, STONE[3], 0, 0.8, false);
      archFace(g, out, out + FRAME.course - 0.08, cz, coursed, 0, 0, 3);
      archFace(g, out + FRAME.course - 0.08, out + FRAME.course, cz, brass, 0, 0, 1);
      archSide(g, out + FRAME.course, 0, cz, STONE[1], 0, 0, false);
      archFace(g, wh - 0.2, wh, fz - 0.35, () => FIELD_LT, 0.5, 0.8, 1);
      archSide(g, wh - 0.2, fz - 0.55, fz - 0.35, FIELD_LT, 0.5, 0.8, true);
      for (const s of [-1, 1]) bits.push(
        box({ w: FRAME.band + 0.3, h: 0.7, d: FRAME.depth + 0.3, color: STONE_DK, offset: { x: s * jamb, y: 0.35, z: FRAME.proud } }),
        box({ w: FRAME.band + 0.2, h: 0.12, d: FRAME.depth + 0.2, color: BRASS, offset: { x: s * jamb, y: 0.74, z: FRAME.proud } }),
        box({ w: FRAME.band + 0.26, h: 0.2, d: FRAME.depth + 0.22, color: BRASS, offset: { x: s * jamb, y: ws, z: FRAME.proud } })
      );
      facing(g, Array.from({ length: 8 }, (_, k) => [...disc(0.36, k), fz + 0.15]), BRONZE_DK, 0, 0, key, fz + 5);
      for (let k = 0; k < 8; k++) {
        const [x0, y0] = disc(0.36, k), [x1, y1] = disc(0.36, k + 1), [X0, Y0] = disc(0.44, k), [X1, Y1] = disc(0.44, k + 1), [xm, ym] = disc(0.9, k + 0.5);
        facing(g, [[x0, y0, fz + 0.15], [X0, Y0, fz + 0.15], [X1, Y1, fz + 0.15], [x1, y1, fz + 0.15]], GOLD, 0.3, 0, key, fz + 5);
        facing(g, [[X0, Y0, fz], [X1, Y1, fz], [X1, Y1, fz + 0.15], [X0, Y0, fz + 0.15]], BRONZE_DK, 0, xm, ym, fz + 0.075);
      }
      btcPlates(g, 0.56, 0, key, fz + 0.26, GOLD, 0.8);
      if (looks[i]) {
        const { depth, flare, rise } = WINDOW, n0 = wh + 0.05, n1 = wh + flare, h0 = ws + wh + 0.05, h1 = h0 + rise, lo = Y - 0.1;
        facing(g, [[-n0, lo, 0], [-n1, lo, -depth], [-n1, h1, -depth], [-n0, h0, 0]], PASSAGE, 0.3, 0, h0 / 2, -depth / 2);
        facing(g, [[n0, lo, 0], [n1, lo, -depth], [n1, h1, -depth], [n0, h0, 0]], PASSAGE, 0.3, 0, h0 / 2, -depth / 2);
        facing(g, [[-n0, h0, 0], [n0, h0, 0], [n1, h1, -depth], [-n1, h1, -depth]], PASSAGE, 0.3, 0, 0, -depth / 2);
        facing(g, [[-n1, lo, -depth], [n1, lo, -depth], [n0, lo, 0], [-n0, lo, 0]], "#3c3e52", 0.15, 0, 1, -depth / 2);
        for (const z of [-1.2, -2.4, -3.6]) {
          const t = -z / depth, w = n0 + (n1 - n0) * t - 0.12, h = h0 + (h1 - h0) * t - 0.12;
          bits.push(FM.beam(-w, lo, z, -w, h, z, 0.1, FIELD, 0.5), FM.beam(-w, h, z, w, h, z, 0.1, FIELD, 0.5), FM.beam(w, h, z, w, lo, z, 0.1, FIELD, 0.5));
        }
        // The picture's stand-in, its stars brought forward to stand proud of the night behind them.
        const picture = merge(standIn(looks[i].stand)), pz = passage().picture.z, v = picture.verts;
        for (let k = 2; k < v.length; k += 3) if (v[k] > pz + 0.03) v[k] = pz + 0.14;
        bits.push(picture);
        const rim = geometry(), color = looks[i].tint, tint = () => color;
        archFace(rim, out, out + 0.18, fz + 0.08, tint, 1, 0.8, 1);
        archSide(rim, out + 0.18, cz + 0.05, fz + 0.08, color, 1, 0.8, false);
        archFace(rim, out + FRAME.course, out + FRAME.course + 0.08, cz + 0.04, tint, 1, 0, 1);
        archSide(rim, out + FRAME.course + 0.08, 0.5, cz + 0.04, color, 1, 0, false);
        rims.push(place(rim));
      } else {
        for (let k = 0; k < SILVER.length; k++) {
          const y0 = WINDOW_TOP * k / SILVER.length, y1 = WINDOW_TOP * (k + 1) / SILVER.length;
          facing(g, [[-wh, y0, -MIRROR_Z], [wh, y0, -MIRROR_Z], [wh, y1, -MIRROR_Z], [-wh, y1, -MIRROR_Z]], SILVER[k], 0.3, 0, (y0 + y1) / 2, 5);
        }
      }
      parts.push(place(merge(g, ...bits)));
    });

    // The mechanism's moving parts, built at the origin: the ₿ and the rings as the chamber's, the rings lighter and
    // tipped, lit as standing at the ₿'s height; and the beam's drum.
    const light = FM.windowLights(lights), unlit = FM.windowLights([]), bake = (geo, set, at = [0, 0, 0]) => FM.bakeWindow(geo, set, at, BIFROST_MOOD);
    const rings = CORE.rings.map((r, i) => {
      const pieces = [ring({ r, thickness: 0.055 + i * 0.01, segments: 32, color: i === 1 ? BRASS : BRONZE })];
      for (let k = 0; k < 4; k++) {
        const a = k / 4 * TAU + i * 0.4;
        pieces.push(moved(lathe({ profile: [[0, -0.09], [0.09, 0], [0, 0.09]], segments: 6, color: GOLD, emissive: 0.6 }), Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      return bake(turnedX(turnedZ(merge(...pieces), RING_TILT[i][1]), RING_TILT[i][0]), light, [0, CORE.glyphY, 0]);
    });
    const beam = coreBeam();
    return {
      front: bake(merge(frontGeo, ...fronts), light), hall: bake(merge(still, ...parts), light), glyph: bake(merge(coreGlyph()), unlit), rings,
      beam: { geometry: bake(merge(beam.geometry), unlit), rows: beam.rows.filter((row) => row.y < HALL.apex).map(({ y, h, r }) => ({ y, h: Math.min(h, HALL.apex - y), r })) },
      rim: rims.length ? bake(merge(...rims), light) : null
    };
  });

  BL.bifrostModels = {
    HALL, ENTRY, WINDOW, WINDOW_TOP, FRAME, CORE, WINDOWS, SLOTS, PILLARS, PILLAR_R, NAME, MIRROR_Z, COURT, BENCHES, BENCH_R, PLANTERS, PLANTER_R, PLANTER_TOP,
    frameOf, inArch, lookOf, hall, pillars, tunnel, entryField, archStone, archGlow, RIM_STEPS, portalRim, hanger, passage, pictureQuad, standIn, mirror, name,
    SKY, sky, coreBase, coreGlyph, coreRings, coreBeam, shockwave, CHARGE_STEPS, charged, courtPosts, bench, planter, lighting, dressing, fieldSheet, fieldSparkles, archRing, banner,
    supportAt, clearAt, walkable, word, GLYPHS, gateWindow,
    PALETTE: { STONE, STONE_DK, STONE_LT, BRONZE, BRONZE_DK, BRASS, GOLD, GOLD_DK, TIMBER, TIMBER_DK, FIELD, FIELD_LT, FIELD_DK, PASSAGE, CLOTH },
    facing, archOutline, archEdge, archAt, archNeon, ball, disc, hoop, banners, blend
  };
})();
