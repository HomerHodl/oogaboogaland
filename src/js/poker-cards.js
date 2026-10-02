// One bounded vector deck for the HUD and both 3D renderers. No textures, fonts,
// downloads or per-frame painting; every back is the same, regardless of its card.
(() => {
  "use strict";
  const BL = window.BL, M = BL.models, NS = "http://www.w3.org/2000/svg";
  const PAPER = "#fffdf6", RED = "#b72e3c", INK = "#202c36", GOLD = "#c6993e", BLUE = "#294e68";
  const designs = new Array(53), meshes = new Array(53);
  const GLYPHS = {
    "2": [[[0, 2], [1, 0], [6, 0], [8, 2], [8, 4], [0, 12], [8, 12]]],
    "3": [[[0, 0], [7, 0], [8, 2], [8, 4], [6, 6], [3, 6]], [[6, 6], [8, 8], [8, 10], [6, 12], [0, 12]]],
    "4": [[[6, 12], [6, 0], [0, 8], [8, 8]]],
    "5": [[[8, 0], [0, 0], [0, 6], [6, 6], [8, 8], [8, 10], [6, 12], [0, 12]]],
    "6": [[[8, 0], [3, 0], [0, 3], [0, 10], [2, 12], [6, 12], [8, 10], [8, 7], [6, 5], [0, 5]]],
    "7": [[[0, 0], [8, 0], [2, 12]]],
    "8": [[[2, 0], [6, 0], [8, 2], [8, 4], [6, 6], [2, 6], [0, 4], [0, 2], [2, 0]], [[2, 6], [0, 8], [0, 10], [2, 12], [6, 12], [8, 10], [8, 8], [6, 6]]],
    "9": [[[8, 7], [2, 7], [0, 5], [0, 2], [2, 0], [6, 0], [8, 2], [8, 9], [5, 12], [0, 12]]],
    "1": [[[1, 3], [4, 0], [4, 12]], [[1, 12], [7, 12]]],
    "0": [[[2, 0], [6, 0], [8, 2], [8, 10], [6, 12], [2, 12], [0, 10], [0, 2], [2, 0]]],
    J: [[[1, 0], [8, 0]], [[6, 0], [6, 9], [4, 12], [1, 12], [0, 9]]],
    Q: [[[2, 0], [6, 0], [8, 2], [8, 9], [6, 11], [2, 11], [0, 9], [0, 2], [2, 0]], [[4, 8], [9, 13]]],
    K: [[[0, 0], [0, 12]], [[8, 0], [0, 7], [8, 12]]],
    A: [[[0, 12], [4, 0], [8, 12]], [[2, 7], [6, 7]]]
  };
  const design = c => {
    const key = c === null ? 52 : c;
    if (designs[key]) return designs[key];
    const shapes = [];
    const poly = (points, color) => shapes.push({ points, color });
    const rect = (x, y, w, h, color) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color);
    const oval = (x, y, rx, ry, color) => poly(Array.from({ length: 20 }, (_, i) => { const a = i * Math.PI / 10; return [x + Math.cos(a) * rx, y + Math.sin(a) * ry]; }), color);
    const line = (points, width, color) => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const x = (b[1] - a[1]) / d * width / 2, y = (a[0] - b[0]) / d * width / 2;
        poly([[a[0] + x, a[1] + y], [b[0] + x, b[1] + y], [b[0] - x, b[1] - y], [a[0] - x, a[1] - y]], color);
      }
    };
    const rotateFrom = start => { for (let i = start; i < shapes.length; i++) shapes[i].points = shapes[i].points.map(p => [100 - p[0], 140 - p[1]]); };
    const suit = (type, x, y, r, color, flip = false) => {
      const start = shapes.length;
      const heart = (sy) => {
        oval(x - r * 0.27, y - sy * r * 0.18, r * 0.3, r * 0.31, color);
        oval(x + r * 0.27, y - sy * r * 0.18, r * 0.3, r * 0.31, color);
        poly([[x - r * 0.55, y - sy * r * 0.07], [x + r * 0.55, y - sy * r * 0.07], [x, y + sy * r * 0.68]], color);
      };
      const stem = () => {
        rect(x - r * 0.09, y + r * 0.1, r * 0.18, r * 0.45, color);
        poly([[x, y + r * 0.32], [x + r * 0.29, y + r * 0.62], [x - r * 0.29, y + r * 0.62]], color);
      };
      if (type === 1) poly([[x, y - r * 0.66], [x + r * 0.49, y], [x, y + r * 0.66], [x - r * 0.49, y]], color);
      else if (type === 2) heart(1);
      else if (type === 3) { heart(-1); stem(); }
      else { oval(x, y - r * 0.3, r * 0.29, r * 0.29, color); oval(x - r * 0.29, y + r * 0.09, r * 0.3, r * 0.3, color); oval(x + r * 0.29, y + r * 0.09, r * 0.3, r * 0.3, color); stem(); }
      if (flip) for (let i = start; i < shapes.length; i++) shapes[i].points = shapes[i].points.map(p => [2 * x - p[0], 2 * y - p[1]]);
    };
    if (c === null) {
      rect(5, 5, 90, 130, BLUE); rect(8, 8, 84, 124, "#e9d9ac"); rect(10, 10, 80, 120, BLUE);
      // Two-way woven diamonds, with a banana medallion at the centre.
      for (let row = 0; row < 10; row++) for (let col = 0; col < 6; col++) {
        const x = 16 + col * 13.5, y = 15 + row * 12;
        line([[x, y - 4], [x + 4, y], [x, y + 4], [x - 4, y], [x, y - 4]], 0.65, "#729aa3");
      }
      oval(50, 70, 22, 27, GOLD); oval(50, 70, 20.5, 25.5, "#f4e8bf"); oval(50, 70, 18.5, 23.5, BLUE);
      for (let half = 0; half < 2; half++) {
        const first = shapes.length;
        line([[43, 68], [49, 66], [54, 62], [56, 55]], 5, "#efc94e");
        line([[43, 68], [49, 68], [55, 65], [58, 61]], 2, "#bd8f36");
        rect(54, 53, 3, 3, "#89a765");
        if (half) rotateFrom(first);
      }
    } else {
      const value = c % 13 + 2, type = Math.floor(c / 13), color = type === 1 || type === 2 ? RED : INK;
      const rank = value < 10 ? String(value) : value === 10 ? "10" : "JQKA"[value - 11];
      for (let half = 0; half < 2; half++) {
        const first = shapes.length, scale = rank === "10" ? 0.82 : 1.25;
        for (let j = 0; j < rank.length; j++) for (const stroke of GLYPHS[rank[j]]) line(stroke.map(p => [7 + (p[0] + j * 10) * scale, 9 + p[1] * 1.25]), 1.45, color);
        suit(type, 12.5, 33, 7.5, color);
        if (half) rotateFrom(first);
      }
      if (value > 10 && value < 14) {
        rect(25, 28, 50, 84, GOLD); rect(26, 29, 48, 82, "#f6edd7");
        for (let half = 0; half < 2; half++) {
          const first = shapes.length;
          // Original double-ended court artwork: a jacket, sash, crown/cap and
          // portrait. Printed shapes are shared verbatim by the mesh and SVG.
          poly([[28, 69], [29, 60], [41, 54], [59, 54], [71, 60], [72, 69]], BLUE);
          poly([[31, 69], [34, 59], [40, 57], [57, 69]], RED);
          line([[37, 57], [60, 69]], 3, GOLD);
          rect(46, 49, 8, 10, "#e5b38a");
          oval(50, 43, 12, 15, INK); oval(50, 44, 8.5, 12, "#f3cf9e");
          line([[46, 45], [48, 45]], 1.1, INK); line([[53, 45], [55, 45]], 1.1, INK);
          line([[50, 45], [49, 49], [51, 49]], 0.8, "#ba805c");
          line([[47, 52], [52, 52]], 0.9, RED);
          if (value === 13) {
            poly([[43, 50], [50, 54], [50, 61], [46, 58]], "#5b3a2c");
            poly([[50, 54], [57, 50], [55, 57], [50, 61]], "#5b3a2c");
          }
          if (value === 11) { poly([[39, 36], [39, 30], [55, 29], [62, 34], [60, 37]], RED); line([[41, 36], [60, 36]], 2, GOLD); }
          else {
            // Separate triangles keep every printed face convex for both renderers.
            rect(40, 33, 20, 4, GOLD);
            for (let i = 0; i < 3; i++) { const x = 40 + i * 7; poly([[x, 34], [x + 3, i === 1 ? 25 : 28], [x + 6, 34]], GOLD); }
            oval(50, 34.5, 1.5, 1.3, RED);
          }
          line([[66, 42], [66, 65]], 1.7, GOLD);
          suit(type, 66, 42, 5, color);
          for (let x = 32; x < 72; x += 6) suit(type, x, 65, 2.5, "#f3d786");
          if (half) rotateFrom(first);
        }
        line([[27, 70], [73, 70]], 1, GOLD);
      } else if (value === 14) suit(type, 50, 70, 32, color);
      else {
        const pips = [];
        if (value <= 3) { pips.push([50, 43], [50, 97]); if (value === 3) pips.push([50, 70]); }
        else {
          const rows = value < 6 ? [43, 97] : value < 9 ? [39, 70, 101] : [34, 58, 82, 106];
          for (const x of [34, 66]) for (const y of rows) pips.push([x, y]);
          if (value === 5 || value === 9) pips.push([50, 70]);
          if (value === 7) pips.push([50, 54]);
          if (value === 8) pips.push([50, 54], [50, 86]);
          if (value === 10) pips.push([50, 46], [50, 94]);
        }
        for (const p of pips) suit(type, p[0], p[1], 13, color, p[1] > 70);
      }
    }
    return designs[key] = shapes;
  };
  const geometry = c => {
    const key = c === null ? 52 : c;
    if (meshes[key]) return meshes[key];
    const print = M.geometry(); let y = 0.013;
    for (const shape of design(c)) {
      const indices = shape.points.map(p => M.pushVert(print, (p[0] - 50) * 0.006, y, (p[1] - 70) * 0.006));
      let area = 0;
      for (let i = 0; i < shape.points.length; i++) { const a = shape.points[i], b = shape.points[(i + 1) % shape.points.length]; area += a[0] * b[1] - a[1] * b[0]; }
      if (area > 0) indices.reverse();
      M.face(print, indices, BL.math.hexToRgb(shape.color)); y += 0.000015;
    }
    const paper = M.geometry(), top = [], bottom = [], rgb = BL.math.hexToRgb(PAPER);
    for (let corner = 0; corner < 4; corner++) {
      const x = corner === 0 || corner === 3 ? 0.266 : -0.266, z = corner < 2 ? 0.386 : -0.386;
      for (let step = 0; step <= 4; step++) {
        const a = corner * Math.PI / 2 + step * Math.PI / 8;
        const px = x + Math.cos(a) * 0.034, pz = z + Math.sin(a) * 0.034;
        bottom.push(M.pushVert(paper, px, -0.009, pz)); top.push(M.pushVert(paper, px, 0.009, pz));
      }
    }
    M.face(paper, top.slice().reverse(), rgb); M.face(paper, bottom, rgb);
    for (let i = 0; i < top.length; i++) { const j = (i + 1) % top.length; M.face(paper, [bottom[i], top[i], top[j], bottom[j]], rgb); }
    return meshes[key] = M.merge(paper, print);
  };
  const svg = c => {
    const root = document.createElementNS(NS, "svg");
    root.setAttribute("viewBox", "0 0 100 140"); root.setAttribute("aria-hidden", "true"); root.setAttribute("focusable", "false");
    const paper = document.createElementNS(NS, "rect");
    for (const [k, v] of Object.entries({ x: 0.6, y: 0.6, width: 98.8, height: 138.8, rx: 7, fill: PAPER, stroke: "#d8cdb9", "stroke-width": 1.2 })) paper.setAttribute(k, String(v));
    root.appendChild(paper);
    for (const shape of design(c)) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", "M" + shape.points.map(p => p.map(v => v.toFixed(2)).join(",")).join("L") + "Z");
      path.setAttribute("fill", shape.color); root.appendChild(path);
    }
    return root;
  };
  const label = c => c === null ? "Face-down card" : ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"][c % 13] + " of " + ["clubs", "diamonds", "hearts", "spades"][Math.floor(c / 13)];
  BL.pokerCards = { geometry, svg, label };
})();
