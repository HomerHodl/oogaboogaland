(() => {
  "use strict";
  const BL = window.BL;
  const { geometry, pushVert, face, box, lathe, tube, merge, forward, cached, noShadow } = BL.models;
  const { createNode, addChild } = BL.scene;
  const { hexToRgb } = BL.math;
  // A rounded rectangle's outline, counter-clockwise from the front: quarter-arc corners of three
  // points each, which keeps any cap within the canvas fallback's sixteen-vertex face.
  const roundedOutline = (hw, hh, rr) => {
    const out = [];
    for (let c = 0; c < 4; c++) {
      const cx = c === 0 || c === 3 ? hw - rr : rr - hw, cy = c < 2 ? hh - rr : rr - hh;
      for (let j = 0; j <= 2; j++) {
        const a = (c + j / 2) * Math.PI / 2;
        out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
    }
    return out;
  };
  // Side walls between two outlines of equal length, the first behind the second.
  const walls = (geo, a, b, rgb) => {
    for (let i = 0; i < a.length; i++) face(geo, [a[i], a[(i + 1) % a.length], b[(i + 1) % a.length], b[i]], rgb);
  };
  // A slab facing +z with rounded corners and bevelled front and back edges.
  const slab = ({ w, h, d, r, bevel = 0, color, offset }) => {
    const geo = geometry(), rgb = hexToRgb(color);
    const ring = (inset, z) => roundedOutline(w / 2 - inset, h / 2 - inset, r - inset).map(([x, y]) => pushVert(geo, offset.x + x, offset.y + y, offset.z + z));
    const rings = bevel ? [ring(bevel, -d / 2), ring(0, bevel - d / 2), ring(0, d / 2 - bevel), ring(bevel, d / 2)] : [ring(0, -d / 2), ring(0, d / 2)];
    for (let p = 0; p < rings.length - 1; p++) walls(geo, rings[p], rings[p + 1], rgb);
    face(geo, rings[rings.length - 1], rgb);
    face(geo, rings[0].slice().reverse(), rgb);
    return geo;
  };
  // A convex outline, counter-clockwise from the front, extruded from z0 forward to z1.
  const prism = (points, z0, z1, color) => {
    const geo = geometry(), rgb = hexToRgb(color);
    const back = points.map(([x, y]) => pushVert(geo, x, y, z0)), front = points.map(([x, y]) => pushVert(geo, x, y, z1));
    walls(geo, back, front, rgb);
    face(geo, front, rgb);
    face(geo, back.slice().reverse(), rgb);
    return geo;
  };
  // A ring between an outer and an inner outline of equal length, from z0 forward to z1: its outer
  // walls, the walls facing into the opening, and the rim across its front.
  const frame = (outer, inner, z0, z1, color) => {
    const geo = geometry(), rgb = hexToRgb(color);
    const at = (points, z) => points.map(([x, y]) => pushVert(geo, x, y, z));
    const outBack = at(outer, z0), outFront = at(outer, z1), inBack = at(inner, z0), inFront = at(inner, z1);
    walls(geo, outBack, outFront, rgb);
    walls(geo, inFront, inBack, rgb);
    walls(geo, outFront, inFront, rgb);
    return geo;
  };
  const MEDKIT = { shell: "#f4f1ea", seam: "#2e2e30", cross: "#f7931a", grip: "#2e2e30", brass: "#f2b81c" };
  const GOLD_MEDKIT = { shell: "#e0b53a", seam: "#6b5416", cross: "#f0c95a", grip: "#6b5416", brass: "#c99a2e" };
  const medkitCache = new Map();
  // A clamshell case standing on the fist: a dark seam round its middle, a raised cross on both lids,
  // latches on the ends, and the stethoscope's dark grip and brass on top.
  const medkitGeometry = (h, pal) => {
    const key = `${h}:${pal === MEDKIT ? "kit" : "gold"}`;
    let geo = medkitCache.get(key);
    if (!geo) {
      const W = 0.42, H = 0.32, D = 0.17, R = 0.06, X = 0.03, Y = 0.235, TOP = Y + H / 2;
      const at = (x, y, z) => ({ x: x * h, y: y * h, z: z * h });
      const part = (w, hh, d, color, x, y, z) => box({ w: w * h, h: hh * h, d: d * h, color, offset: at(x, y, z) });
      const cross = (side) => merge(part(0.2, 0.064, 0.014, pal.cross, X, Y, side * (D / 2 + 0.004)), part(0.064, 0.2, 0.014, pal.cross, X, Y, side * (D / 2 + 0.004)));
      const grip = tube({
        rings: 12,
        segments: 6,
        path: (t) => at(X - 0.1 * Math.cos(Math.PI * t), TOP + 0.012 + 0.07 * Math.sin(Math.PI * t), 0),
        radius: () => 0.019 * h,
        colorFn: () => pal.grip
      });
      geo = merge(
        slab({ w: W * h, h: H * h, d: D * h, r: R * h, bevel: 0.018 * h, color: pal.shell, offset: at(X, Y, 0) }),
        slab({ w: (W + 0.014) * h, h: (H + 0.014) * h, d: 0.028 * h, r: (R + 0.007) * h, color: pal.seam, offset: at(X, Y, 0) }),
        cross(1), cross(-1), grip,
        part(0.05, 0.03, 0.05, pal.brass, X - 0.1, TOP + 0.012, 0),
        part(0.05, 0.03, 0.05, pal.brass, X + 0.1, TOP + 0.012, 0),
        part(0.02, 0.07, 0.05, pal.brass, X - W / 2 - 0.009, Y, 0),
        part(0.02, 0.07, 0.05, pal.brass, X + W / 2 + 0.009, Y, 0)
      );
      medkitCache.set(key, geo);
    }
    return geo;
  };
  const stethoscopeCache = new Map();
  // One tube: bell at one end, forked earpieces at the other, nothing converging (it would read as a chain).
  // The bell sits clear of the arm that carries the kit; brass collars tie the hardware together.
  const stethoscopeGeometry = (h) => {
    let geo = stethoscopeCache.get(h);
    if (!geo) {
      const DARK = "#2e2e30", GOLD = "#f2b81c", INSET = "#3a2a12";
      const BELL = { x: 0.17, y: 0.125, z: 0.23 }, EAR = { x: -0.16, y: 0.21, z: 0.22 };
      const path = (t) => ({ x: 0.16 * Math.cos(Math.PI * t) * h, y: (0.14 + 0.36 * Math.sin(Math.PI * t) + 0.06 * t) * h, z: (0.22 - 0.28 * Math.sin(Math.PI * t)) * h });
      const slung = tube({ rings: 20, segments: 6, path, radius: () => 0.023 * h, colorFn: () => DARK });
      const collar = (t) => box({ w: 0.052 * h, h: 0.052 * h, d: 0.052 * h, color: GOLD, offset: path(t) });
      const prong = (side) => tube({
        rings: 6,
        segments: 5,
        path: (u) => ({ x: (EAR.x + side * 0.045 * u) * h, y: (EAR.y - 0.105 * u) * h, z: (EAR.z + 0.012 * u) * h }),
        radius: () => 0.016 * h,
        colorFn: () => DARK
      });
      const tip = (side) => box({ w: 0.042 * h, h: 0.042 * h, d: 0.042 * h, color: GOLD, offset: { x: (EAR.x + side * 0.045) * h, y: (EAR.y - 0.115) * h, z: (EAR.z + 0.012) * h } });
      const face = (w, hh, x, y) => box({ w: w * h, h: hh * h, d: 0.01 * h, color: GOLD, offset: { x: (BELL.x + x) * h, y: (BELL.y + y) * h, z: (BELL.z + 0.03) * h } });
      const disc = (r, d, color) => forward(lathe({ profile: [[0, 0], [r * h, 0], [r * h, d * h], [0, d * h]], segments: 18, color }), { x: BELL.x * h, y: BELL.y * h, z: BELL.z * h });
      geo = merge(
        slung, collar(0.16), collar(0.34), collar(0.66), collar(0.86),
        prong(-1), prong(1), tip(-1), tip(1),
        disc(0.072, 0.018, GOLD),
        disc(0.052, 0.026, INSET),
        face(0.011, 0.058, -0.013, 0),
        face(0.03, 0.011, 0.002, 0.021),
        face(0.03, 0.011, 0.002, 0),
        face(0.03, 0.011, 0.002, -0.021),
        face(0.011, 0.014, 0.016, 0.011),
        face(0.011, 0.014, 0.016, -0.011),
        face(0.009, 0.014, -0.002, 0.034),
        face(0.009, 0.014, -0.002, -0.034)
      );
      stethoscopeCache.set(h, geo);
    }
    return geo;
  };
  // A mouth piece after the concept, in head space at unit height (the muzzle's face is at z 0.25,
  // between y 0 and 0.125): a thick rounded lip frame standing proud of the muzzle round a dark
  // cavity with the tongue on its floor, and chunky teeth set just behind the lips, square incisors,
  // short side teeth and pointed fangs above and two stubs below. Each tooth is [left, right,
  // bottom, top] with a fang's tip last; the ends hidden behind the lips anchor it.
  const TEETH = [
    [-0.031, -0.001, 0.064, 0.1], [0.001, 0.031, 0.064, 0.1],
    [-0.058, -0.037, 0.078, 0.1], [0.037, 0.058, 0.078, 0.1],
    [-0.09, -0.066, 0.064, 0.1, 0.05], [0.066, 0.09, 0.064, 0.1, 0.05],
    [-0.047, -0.027, 0.024, 0.05], [0.027, 0.047, 0.024, 0.05]
  ];
  const biteGeometry = cached(() => {
    const Y = 0.062, BACK = 0.255, opening = roundedOutline(0.1, 0.034, 0.018).map(([x, y]) => [x, y + Y]);
    const plate = (points, z, color) => {
      const geo = geometry();
      face(geo, points.map(([x, y]) => pushVert(geo, x, y, z)), hexToRgb(color));
      return geo;
    };
    const tooth = ([x0, x1, y0, y1, tip]) => prism(tip === undefined ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[(x0 + x1) / 2, tip], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], BACK, 0.28, "#f6f1e4");
    return noShadow(merge(
      frame(roundedOutline(0.13, 0.0575, 0.035).map(([x, y]) => [x, y + Y]), opening, 0.245, 0.285, "#4a3226"),
      plate(opening, BACK, "#1c0b09"),
      plate(roundedOutline(0.075, 0.009, 0.008).map(([x, y]) => [x, y + 0.036]), BACK + 0.002, "#8e2a26"),
      ...TEETH.map(tooth)
    ));
  });
  // The mane's tufts: a root [x, y, z] on the cap or outside a side, the step each voxel takes as the
  // tuft grows [dx, dy, dz], and its length. Tops rise and lean out; sides jut out and lift.
  const TUFTS = [
    [-1, 9, 6, -0.6, 1, 0.6, 3], [3, 9, 6, 0, 1, 0.7, 3], [7, 9, 6, 0.6, 1, 0.6, 3],
    [-1, 9, 2, -0.7, 1, 0, 4], [3, 9, 2, 0, 1, 0.2, 4], [7, 9, 2, 0.7, 1, 0, 4],
    [-1, 9, -1, -0.6, 1, -0.6, 3], [3, 9, -1, 0, 1, -0.7, 3], [7, 9, -1, 0.6, 1, -0.6, 3],
    [-3, 6, 1, -1, 0.5, 0, 2], [-3, 2, 2, -1, 0.3, 0, 2], [-3, -1, 0, -1, -0.4, 0, 2],
    [9, 6, 1, 1, 0.5, 0, 2], [9, 2, 2, 1, 0.3, 0, 2], [9, -1, 0, 1, -0.4, 0, 2]
  ];
  BL.characters.add({
    handle: "DrNeski",
    // GitHub login behind the handle, for activity and the jumbotron
    github: "drneski",
    joined: 1789692980,
    lastCommit: 1788219000,
    // Laser eyes: lit orange, open or closed, with no pupils; clean shaven under the mane
    look: { portrait: { min: [-1, -3, -1], max: [7, 8, 8] }, eyeColor: "#f7931a", eyeGlow: 1, noPupils: true, cleanShaven: true, hair: "#f2ece0" },
    voice: {
      poke: "You've got 10 seconds!",
      idle: ["You are fired!", "Where is Kortik??", "Go rebalance your Node!", "Get laid on the 1st date", "What's your question for DrNeski?", "I sold my neighbor ex's cat for sats"]
    },
    dress: {
      // The kit stands upright in the grip, rolled slightly.
      club: (k) => ({ default: medkitGeometry(k.h, MEDKIT), gold: medkitGeometry(k.h, GOLD_MEDKIT), rest: { x: 0.2, z: 0.1 } }),
      gear(k) {
        addChild(k.root, createNode({ geometry: stethoscopeGeometry(k.h) }));
      },
      // A wild pale mane: a cap over the crown, full sides down past the jaw, and chunky tufts that
      // lean out as they rise, each two voxels thick at the root and one at the tip
      crown(k, v) {
        const P = k.P, rand = k.rand, hair = () => rand() < 0.3 ? P.hairDk : P.hair;
        v.fill(-1, 7, 6, 8, -1, 6, k.hairJ);
        v.fill(-2, -1, -1, 8, -2, 4, (x, y) => y === -1 && rand() < 0.4 ? null : hair());
        v.fill(7, 8, -1, 8, -2, 4, (x, y) => y === -1 && rand() < 0.4 ? null : hair());
        for (const [x, y, z, dx, dy, dz, n] of TUFTS) {
          const sx = Math.sign(3 - x), sz = Math.sign(2.5 - z), rises = Math.abs(dy) >= Math.abs(dx);
          for (let i = 0, len = n - (rand() < 0.3 ? 1 : 0); i < len; i++) {
            const px = x + Math.round(dx * i), py = y + Math.round(dy * i), pz = z + Math.round(dz * i), w = i < 2 ? 1 : 0;
            for (let a = 0; a <= w; a++) for (let b = 0; b <= w; b++) {
              if (rises) v.set(px + a * sx, py, pz + b * sz, hair());
              else v.set(px, py + a, pz + b * sz, hair());
            }
          }
        }
        // The band sits proud of the hair it holds back
        v.fill(-1, 7, 4, 5, -1, 6, k.jit(k.color("#c8342a"), k.color("#8f231b"), 0.25));
      },
      // A white-hot core in each laser eye
      mark(k, v) {
        const core = k.color("#fff0b0");
        v.set(1, 3, 5, core);
        v.set(5, 3, 5, core);
        k.headEmissive[core] = 1;
      },
      headgear(k) {
        addChild(k.parts.head, createNode({ scale: { x: k.h, y: k.h, z: k.h }, geometry: biteGeometry() }));
      }
    }
  });
})();
