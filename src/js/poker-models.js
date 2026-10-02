// Ten tables in two banks, with a central promenade and circulation outside every seat.
(() => {
  "use strict";
  const BL = window.BL, M = BL.models, S = BL.scene;
  const EXIT_Z = 35.2 + BL.bifrostModels.MIRROR_Z;
  const TABLES = Array.from({ length: 10 }, (_, i) => ({ x: i % 2 ? 11 : -11, z: 24 - Math.floor(i / 2) * 12 }));
  const SEATS = Array.from({ length: 9 }, (_, i) => {
    const a = -Math.PI / 2 + 0.55 + i * (Math.PI * 2 - 1.1) / 8;
    const x = Math.cos(a) * 6, z = Math.sin(a) * 4.2;
    return { x, z, yaw: Math.atan2(-x, -z) };
  });
  const box = (w, h, d, color, x = 0, y = 0, z = 0) => M.bevelBox({ w, h, d, color, offset: { x, y, z } });
  const disk = (radius, bottom, top, color) => M.lathe({ segments: 48, profile: [[0, bottom], [radius, bottom], [radius, top], [0, top]], color });
  const node = (geo, x = 0, y = 0, z = 0) => S.createNode({ geometry: geo, position: { x, y, z } });
  const GOLD = "#c8a45f", EMERALD = "#245749";
  // Brass strips form the room's architectural fanlights. These are cached wall
  // finishes, kept outside the walkable floor rather than freestanding obstacles.
  const strip = (ax, ay, bx, by, width, color = GOLD, z = 0.17) => {
    const length = Math.hypot(bx - ax, by - ay), cs = (by - ay) / length, sn = (ax - bx) / length;
    const g = box(width, length, 0.05, color);
    for (let i = 0; i < g.verts.length; i += 3) {
      const x = g.verts[i], y = g.verts[i + 1];
      g.verts[i] = x * cs - y * sn + (ax + bx) / 2;
      g.verts[i + 1] = x * sn + y * cs + (ay + by) / 2;
      g.verts[i + 2] += z;
    }
    return g;
  };
  const fanlight = () => {
    const parts = [box(3.4, 4.3, 0.18, EMERALD, 0, 2.15)];
    for (const x of [-1.66, 1.66]) parts.push(box(0.055, 4.3, 0.06, GOLD, x, 2.15, 0.13));
    for (const y of [0.07, 4.23]) parts.push(box(3.32, 0.055, 0.06, GOLD, 0, y, 0.13));
    for (let i = 0; i <= 12; i++) {
      const a = i * Math.PI / 12;
      parts.push(strip(Math.cos(a) * 0.3, 1.7 + Math.sin(a) * 0.3, Math.cos(a) * 1.48, 1.7 + Math.sin(a) * 1.48, 0.042));
    }
    for (const [width, height] of [[2.4, 0.45], [1.6, 0.72], [0.8, 1]]) {
      parts.push(strip(-width / 2, 0.35, -width / 2, height, 0.055), strip(width / 2, 0.35, width / 2, height, 0.055), strip(-width / 2, height, width / 2, height, 0.055));
    }
    return M.merge(...parts);
  };
  // Geological wall finishes sit beyond x=23.4; the spectator boundary is x=23.
  // Like the mine's chamber walls, these are architecture, baked into two meshes.
  const caveWalls = theme => {
    const stone = [], veins = [], rand = BL.math.mulberry32(712);
    const crystal = theme.id === "crystal", ember = theme.id === "ember", jungle = theme.id === "jungle";
    for (const side of [-1, 1]) for (let z = -33; z <= 33; z += 6) {
      for (let band = 0; band < 5; band++) {
        const depth = 0.5 + rand() * 0.25, height = 1.6 + rand() * 0.4;
        stone.push(box(depth, height, 5.8, theme.stone[band % 3], side * 24.05, 0.9 + band * 1.8, z + (band % 2 ? 0.2 : -0.2)));
      }
      const length = 0.6 + rand() * 0.7;
      const drip = M.lathe({ segments: 6, profile: [[0.65, 0], [0.4, -length * 0.45], [0, -length]], color: theme.stone[2] });
      for (let i = 0; i < drip.verts.length; i += 3) { drip.verts[i] += side * 24.1; drip.verts[i + 1] += 9.1; drip.verts[i + 2] += z; }
      stone.push(drip);
      if (crystal) for (let k = 0; k < 3; k++) {
        const height = 1.4 + rand() * 1.7;
        const shard = M.lathe({ segments: 6, profile: [[0, 0], [0.46, 0.25], [0.37, height * 0.72], [0, height]], color: k === 1 ? theme.mineral : theme.accent, emissive: 0.38 });
        for (let i = 0; i < shard.verts.length; i += 3) {
          shard.verts[i] = side * 23.85 + shard.verts[i] * 0.45;
          shard.verts[i + 2] += z + (k - 1) * 0.9 + shard.verts[i + 1] * (k - 1) * 0.13;
          shard.verts[i + 1] += 2 + (k % 2) * 0.5;
        }
        veins.push(shard);
      }
      if (ember) for (let k = 0; k < 7; k++) {
        const seam = box(0.07, 0.72, 0.11, k % 2 ? theme.accent : theme.mineral, side * 23.62, 1 + k * 0.62, z + (k % 3) * 0.18);
        for (const f of seam.faces) f.emissive = 0.6;
        veins.push(seam);
      }
      if (jungle) for (let k = 0; k < 4; k++) stone.push(box(0.08, 0.13, 0.9 + rand(), theme.runner, side * 23.62, 1.8 + k * 1.8, z + (k & 1 ? -0.8 : 0.8)));
      if (theme.id === "moonstone") for (let k = 0; k < 5; k++) {
        const inlay = box(0.06, 0.07, 2.2 + rand(), theme.mineral, side * 23.62, 2.8 + k * 0.55, z);
        for (const f of inlay.faces) f.emissive = 0.35;
        veins.push(inlay);
      }
    }
    // Shallow mineral bands in the far wall repeat the room's geological palette.
    for (let k = 0; k < 7; k++) stone.push(box(48, 0.4, 0.22, theme.stone[k % 3], 0, 0.8 + k * 1.25, -36.35));
    const glow = veins.length ? M.merge(...veins) : null;
    if (glow) glow.castShadow = false;
    return { stone: M.merge(...stone), veins: glow };
  };
  const cache = new Map();
  const geometry = (id = "gatsby") => {
    const theme = BL.pokerThemes.get(id), cave = theme.id !== "gatsby";
    if (cache.has(theme.id)) return cache.get(theme.id);
    const shell = [], dressed = BL.dressing.set();
    // The same floor footprint supports either the club or geological wall
    // finishes; kit lanterns and foliage follow the chosen cave palette.
    for (let row = 0; row < 19; row++) for (let col = 0; col < 13; col++)
      shell.push(box(3.98, 0.35, 3.98, (col + row) % 3 ? theme.stone[0] : theme.stone[1], (col - 6) * 4, -0.19, (row - 9) * 4));
    for (let side = -1; side <= 1; side += 2) {
      shell.push(box(1.2, 10, 76, theme.stone[2], side * 25, 4.8));
      shell.push(box(0.1, 2.1, 73, theme.panel, side * 24.34, 1.05));
      shell.push(box(0.12, 0.08, 73, theme.accent, side * 24.27, 2.12));
      for (let z = -34; z <= 34; z += 8.5) {
        shell.push(box(0.9, 8.8, 1, theme.wood, side * 23.8, 4.4, z));
        shell.push(box(1.1, 0.3, 1.2, theme.accent, side * 23.8, 1.3, z));
        shell.push(box(1.1, 0.3, 1.2, theme.accent, side * 23.8, 7.6, z));
        if (!cave || theme.id === "jungle") for (let k = 0; k < (cave ? 6 : 3); k++)
          dressed.put("vine", side * 23.85, 6.1 + k * 0.24, z - 0.9 + k * 0.38, side > 0 ? 3 : 1, k % 3);
        if (theme.id === "jungle") dressed.put("runeStone", side * 24, 2.4, z, side > 0 ? 3 : 1);
      }
    }
    shell.push(box(50, 10, 1, theme.stone[3], 0, 4.8, -37));
    shell.push(box(50, 10, 1, theme.stone[3], 0, 4.8, 37));
    shell.push(box(50, 0.8, 76, theme.stone[4], 0, 9.5));
    for (let z = -30; z <= 30; z += 12) {
      shell.push(box(48, 0.65, 0.8, theme.wood, 0, 8.9, z));
      shell.push(box(48, 0.06, 0.86, theme.accent, 0, 8.54, z));
    }
    // The central promenade is a flat inlay, leaving its whole width walkable.
    shell.push(box(6.7, 0.012, 68, theme.runner, 0, 0.001));
    for (const x of [-3.6, -3.36, 3.36, 3.6]) shell.push(box(0.085, 0.02, 70, theme.accent, x, 0.012));
    for (let z = -30; z <= 30; z += 12) {
      const tile = box(2.4, 0.01, 2.4, theme.mineral, 0, 0.012);
      for (let j = 0; j < tile.verts.length; j += 3) {
        const x = tile.verts[j], zz = tile.verts[j + 2];
        tile.verts[j] = (x - zz) * Math.SQRT1_2; tile.verts[j + 2] = (x + zz) * Math.SQRT1_2 + z;
      }
      shell.push(tile);
    }
    for (const p of TABLES) {
      dressed.cable(p.x, 8.8, p.z - 1.8, p.x, 8.8, p.z + 1.8, 3.1, [0.25, 0.5, 0.75], "hanging", theme.lamp);
      if (!cave || theme.id === "jungle") for (const dx of [-3.6, 3.6]) dressed.put("vine", p.x + dx, 8.5, p.z - 4.8, 0, dx > 0 ? 1 : 2);
    }
    // Three brass chandeliers use the existing hanging lanterns and cable kit.
    if (!cave) for (const z of [-24, 0, 24]) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, x = Math.cos(a) * 1.65, zz = z + Math.sin(a) * 1.65;
      dressed.cable(0, 8.8, z, x, 6.65, zz, 0, [1]);
    }
    if (cave) for (const z of [-24, 0, 24])
      dressed.cable(-2, 8.9, z, 2, 8.9, z, 2.2, [0.25, 0.5, 0.75], "hanging", theme.lamp);
    const rock = cave ? caveWalls(theme) : null;
    if (rock) shell.push(rock.stone);
    const chair = M.merge(box(0.95, 0.22, 0.9, theme.panel, 0, 0.57), box(1.0, 1.1, 0.18, theme.wood, 0, 1, -0.4),
      box(0.79, 0.78, 0.12, theme.felt, 0, 1.03, -0.26), box(0.96, 0.06, 0.2, theme.accent, 0, 1.54, -0.4),
      box(0.18, 0.5, 0.18, "#373a35", -0.33, 0.25, 0.28), box(0.18, 0.5, 0.18, "#373a35", 0.33, 0.25, 0.28),
      box(0.18, 0.5, 0.18, "#373a35", -0.33, 0.25, -0.28), box(0.18, 0.5, 0.18, "#373a35", 0.33, 0.25, -0.28));
    const jacket = M.merge(box(0.92, 0.96, 0.66, "#292f33", 0, 0.49),
      box(0.31, 0.66, 0.08, "#e6e1ce", 0, 0.62, 0.36),
      box(0.1, 0.48, 0.09, "#e6b634", 0, 0.52, 0.42),
      box(0.18, 0.14, 0.1, "#f7d052", 0, 0.84, 0.42));
    const built = {
      shell: M.merge(...shell), veins: rock?.veins || null, dressing: dressed.build(), chair, jacket, fanlight: fanlight(),
      chandelier: M.lathe({ segments: 48, profile: [[1.71, 6.55], [1.71, 6.72], [1.59, 6.72], [1.59, 6.55], [1.71, 6.55]], color: theme.accent }),
      sleeve: box(0.4, 0.78, 0.43, "#292f33", 0, -0.29, 0.025),
      cuff: box(0.41, 0.12, 0.44, "#e6e1ce", 0, -0.73, 0.025),
      base: M.merge(box(1.5, 1, 1.3, theme.stone[1], -2.5, 0.5), box(1.5, 1, 1.3, theme.stone[1], 2.5, 0.5)),
      stone: disk(1, 1.02, 1.32, theme.stone[5]), rim: disk(1, 1.32, 1.36, theme.accent), felt: disk(1, 1.36, 1.38, theme.felt),
      pinstripe: M.lathe({ segments: 64, profile: [[1, 1.384], [0.995, 1.384]], color: theme.accent }),
      back: BL.pokerCards.geometry(null), chip: disk(0.17, 0, 0.055, "#e2b43c"),
      button: disk(0.16, 0, 0.055, "#ece3c7"),
      title: BL.poolModels.carve("BANANA POKER", { cell: 0.24, color: theme.accent }),
      welcome: BL.poolModels.carve(cave ? theme.name.toUpperCase() : "GOOD HANDS GOOD COMPANY", { cell: 0.1, color: theme.mineral, emissive: 0.1 })
    };
    cache.set(theme.id, built); return built;
  };
  const card = c => BL.pokerCards.geometry(c);
  const build = (id = "gatsby") => {
    const theme = BL.pokerThemes.get(id), g = geometry(theme.id), root = S.createNode(), environment = S.createNode(), tables = [];
    S.addChild(root, environment);
    for (let i = 0; i < 10; i++) {
      const p = TABLES[i], group = S.createNode({ position: { x: p.x, y: 0, z: p.z } });
      const top = node(g.stone); top.scale.x = 4.75; top.scale.z = 3.15;
      const rim = node(g.rim); rim.scale.x = 4.5; rim.scale.z = 2.92;
      const felt = node(g.felt); felt.scale.x = 4.38; felt.scale.z = 2.8;
      const pinstripe = node(g.pinstripe); pinstripe.scale.x = 4.02; pinstripe.scale.z = 2.44;
      const base = node(g.base);
      S.addChild(group, base, top, rim, felt, pinstripe);
      const chairs = [], chips = [], backs = [];
      for (const s of SEATS) {
        const chair = node(g.chair, s.x, 0, s.z); chair.rotation.y = s.yaw; chairs.push(chair); S.addChild(group, chair);
        const pile = node(g.chip, s.x * 0.65, 1.39, s.z * 0.59); pile.visible = false; chips.push(pile); S.addChild(group, pile);
        const cards = S.createNode({ position: { x: s.x * 0.57, y: 1.4, z: s.z * 0.57 }, rotation: { x: 0, y: s.yaw, z: 0 } });
        S.addChild(cards, node(g.back, -0.26), node(g.back, 0.26, 0.015)); cards.visible = false; backs.push(cards); S.addChild(group, cards);
      }
      const board = Array.from({ length: 5 }, (_, j) => { const n = node(g.back, (j - 2) * 0.72, 1.41); n.visible = false; S.addChild(group, n); return n; });
      const button = node(g.button); S.addChild(group, button); button.visible = false;
      const label = BL.poolModels.carve(String(i + 1).padStart(2, "0"), { cell: 0.14, color: "#e5c984" });
      S.addChild(group, node(label.geometry, -label.width / 2, 1.17, 3.18));
      const agent = BL.agent.create({ groundAt: () => 0, x: 0, z: -3.6, managed: true, scale: 1.16 });
      agent.poseManaged(1, 0, 0, -3.6, 0, 0, false, true);
      S.addChild(agent.parts.torso, node(g.jacket));
      for (const arm of [agent.parts.armL, agent.parts.armR]) S.addChild(arm, node(g.sleeve), node(g.cuff));
      S.addChild(group, agent.root);
      const dealCard = node(g.back, 0, 1.5, -2.4); dealCard.visible = false; S.addChild(group, dealCard);
      S.addChild(root, group);
      tables.push({ root: group, base, top, rim, felt, pinstripe, chairs, chips, backs, board, button, agent, dealCard, actors: new Array(SEATS.length).fill(null), version: -1, pulse: 0 });
    }
    let current = null;
    const setTheme = id => {
      const next = BL.pokerThemes.get(id); if (current === next.id) return;
      const geo = geometry(next.id);
      while (environment.children.length) S.removeChild(environment, environment.children[environment.children.length - 1]);
      S.addChild(environment, node(geo.shell), ...BL.dressing.nodes(geo.dressing, { glow: 1 }));
      if (geo.veins) { const n = node(geo.veins); n.glow = 1; S.addChild(environment, n); }
      if (next.id === "gatsby") {
        for (const side of [-1, 1]) for (const z of [-29.75, -12.75, 4.25, 21.25]) {
          const panel = node(geo.fanlight, side * 24.27, 2.65, z);
          panel.rotation.y = -side * Math.PI / 2; S.addChild(environment, panel);
        }
        for (const x of [-16, -8, 8, 16]) S.addChild(environment, node(geo.fanlight, x, 2.1, -36.35));
        for (const z of [-24, 0, 24]) S.addChild(environment, node(geo.chandelier, 0, 0, z));
      }
      const title = geo.title;
      S.addChild(environment, node(title.geometry, -title.width / 2, 6.4, -36.15));
      const welcome = geo.welcome;
      S.addChild(environment, node(welcome.geometry, -welcome.width / 2, 5.2, -36.15));
      for (const table of tables) {
        table.base.geometry = geo.base; table.top.geometry = geo.stone;
        table.rim.geometry = geo.rim; table.felt.geometry = geo.felt; table.pinstripe.geometry = geo.pinstripe;
        for (const chair of table.chairs) chair.geometry = geo.chair;
      }
      current = next.id;
    };
    setTheme(theme.id);
    return { root, tables, setTheme, get theme() { return current; } };
  };
  const walkable = (ax, az, bx, bz, y, height, actor) => {
    const r = actor?.bodyRadius || 0.4;
    const rear = Math.abs(bx) < BL.bifrostModels.WINDOW.halfW - r ? EXIT_Z + 1.05 - r : 35.5 - r;
    if (Math.abs(bx) > 23 - r || bz < -35.5 + r || bz > rear) return false;
    // A swept ellipse catches a fast step through a table, not just its endpoint.
    for (const t of TABLES) {
      const rx = 4.85 + r, rz = 3.25 + r, x = (ax - t.x) / rx, z = (az - t.z) / rz;
      const dx = (bx - ax) / rx, dz = (bz - az) / rz, d = dx * dx + dz * dz;
      const u = d ? Math.max(0, Math.min(1, -(x * dx + z * dz) / d)) : 0;
      if ((x + u * dx) ** 2 + (z + u * dz) ** 2 < 1) return false;
      for (const s of SEATS) {
        const sx = t.x + s.x, sz = t.z + s.z, vx = bx - ax, vz = bz - az, dd = vx * vx + vz * vz;
        const k = dd ? Math.max(0, Math.min(1, ((sx - ax) * vx + (sz - az) * vz) / dd)) : 0;
        if ((ax + k * vx - sx) ** 2 + (az + k * vz - sz) ** 2 < (r + 0.53) ** 2) return false;
      }
    }
    return true;
  };
  BL.pokerModels = { TABLES, SEATS, EXIT_Z, geometry, card, build, walkable };
})();
