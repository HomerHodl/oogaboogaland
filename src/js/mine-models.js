// Ooga Mine's cave and everything that stands in it. Every builder returns one cached geometry shared
// by every copy, so a hall of racks is still one draw call per part, and the Thunder Boxes themselves
// are one instanced batch the scene writes.
//
// `LAYOUT` is the single source for where things stand: the three chambers, the tunnels between them,
// and every spot the sim's tables name (bench, shelves, pads, power nooks, trophies). The walls are
// built from it here and the scene places units from it, so the two can never disagree.
//
// `LAYOUT` also carries a breaker per chamber, `COOL_AT` (four fan spots on each chamber's back wall),
// `BUSBAR_AT` (a riser per busbar up the breaker's wall), the props including the Den's crystal cell, the
// lamps, `SAFETY_AT` (the hooks for each kind of safety gear per chamber: Fire Stoppers and the spare
// breaker on the breaker's wall, the smoke alarm on the ceiling), `TIMBER_Z` (where each chamber's timber
// sets stand, built to the chamber's own size with posts flush to the walls) and `ROCKS` (the crackable
// boulders along every wall, kept off every spot anything stands on). It is checked against the
// catalog's counts at load. `bayLocal` places a bay; the cave is built at full extent with a rubble
// `seal` in each tunnel.
//
// Cached geometry: the Pebble Box, Shiny Rocks, the five ASIC looks (`asic(i)`, each drawn by the hundred
// as one instanced batch), rack, Cold Pool, pad, the three generators and the Crystal Bank, sky hole,
// workbench, shelves, breaker and lever, the Fan Wall and Box Fan with their blades mounted by
// `FAN_MOUNT`, the busbar riser, the crystal cell, pool board, trader's stall and price board, banana
// rock, trophy shelf and the eight trophies, drop marker, lamp, flame and crystal, and `hubCart`, the cart of
// glowing ore that stands by the Lightning Factory's switchboard.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { box, bevelBox, lathe, ring, merge, cached, variants, noShadow, moved, turnedX, turnedY } = BL.models;
  // The mine's props take the island's cartoon chamfer: every box a bevelled one, except what glows (screens,
  // lights, marks) and anything under 3 cm, which a chamfer would eat. A bevelled box keeps the plain box's outer
  // faces, so whatever sits flush on one still does.
  const bx = (o) => o.emissive || Math.min(o.w ?? 1, o.h ?? 1, o.d ?? 1) < 0.03 ? box(o) : bevelBox(o);
  const { createNode, addChild } = BL.scene;
  const R = BL.mineRigs;

  const STONE = "#3d3730", STONE_DARK = "#37322c", STONE_LIGHT = "#4d463d";
  const TIMBER = "#6b4a2b", TIMBER_DARK = "#4a331e", METAL = "#4a4f55", METAL_DARK = "#33373c";
  const GREEN = "#6de08a", AMBER = "#f0a83c", COPPER = "#8a5a2b", OIL = "#2f6f8a", BANANA = "#f5c542";

  // Pitch about x, then yaw about y.
  const turn = (geo, yaw, pitch = 0) => turnedY(turnedX(geo, pitch), yaw);

  // Chambers run down -z from the mouth at +z. Each dig opens the next one through the far wall of the
  // last; a tunnel is a gap in that wall `TUNNEL.w` wide.
  const CHAMBERS = [
    { name: "Den", x0: -8, x1: 8, z0: 0, z1: 14, h: 5.2 },
    { name: "Rack Hall", x0: -10, x1: 10, z0: -20, z1: 0, h: 5.6 },
    { name: "Big Cave", x0: -15, x1: 15, z0: -48, z1: -20, h: 8 }
  ];
  const TUNNEL = { w: 3.6, h: 3.4 };
  const HALF_PI = Math.PI / 2;

  // Spots, in the sim's order. Units face +z unless turned; `ry` turns the thing standing there.
  const BENCH = [7.4, 8.4, 9.4, 10.4].map((z) => ({ x: -6.95, y: 0.92, z, ry: HALF_PI }));
  const SHELF = [];
  for (const y of [0.98, 1.98]) for (const z of [6.9, 8.2, 9.5, 10.8]) SHELF.push({ x: 7.2, y, z, ry: -HALF_PI });
  const PADS = [
    // The Den: two rows of two, the middle aisle left clear.
    { x: -2.8, z: 4.6, ry: 0 }, { x: 2.8, z: 4.6, ry: 0 }, { x: -2.8, z: 8, ry: 0 }, { x: 2.8, z: 8, ry: 0 },
    // The hall: two rows down the aisle, facing it.
    ...[-4, -8.5, -13, -17.5].flatMap((z) => [{ x: -4.2, z, ry: HALF_PI }, { x: 4.2, z, ry: -HALF_PI }]),
    // The big cave: a grid facing the tunnel, leaving the aisle out of it clear.
    ...[-26, -32, -38, -44].flatMap((z) => [-10.5, -4.2, 4.2, 10.5].filter((x) => !(z === -26 && Math.abs(x) < 5)).map((x) => ({ x, z, ry: 0 })))
  ];
  const POWER_AT = [
    { x: -6.3, z: 1.7, ry: 0 }, { x: -3.9, z: 1.7, ry: 0 },
    { x: -8.6, z: -6, ry: HALF_PI }, { x: -8.6, z: -11, ry: HALF_PI }, { x: -8.6, z: -16, ry: HALF_PI },
    { x: 13.5, z: -27, ry: -HALF_PI }, { x: 13.5, z: -33, ry: -HALF_PI }, { x: 13.5, z: -39, ry: -HALF_PI }, { x: 13.5, z: -45, ry: -HALF_PI }
  ];
  const TROPHY_AT = [];
  for (let i = 0; i < R.TROPHIES.length; i++) TROPHY_AT.push({ x: 2.9 + (i % 4) * 1.05, y: i < 4 ? 1.02 : 1.92, z: 13.45, ry: Math.PI });
  const PROP_AT = {
    // Every chamber has its own breaker and its own cooling plant.
    breakers: [{ x: 7.72, y: 0, z: 12.2, ry: -HALF_PI }, { x: 9.72, y: 0, z: -2.2, ry: -HALF_PI }, { x: 14.72, y: 0, z: -22.2, ry: -HALF_PI }],
    // The Den's crystal cell: the battery every operation has, glowing with its charge.
    battery: { x: -7.5, y: 0, z: 6.25, ry: HALF_PI },
    board: { x: -7.72, y: 0, z: 4.6, ry: HALF_PI },
    trader: { x: -4.6, y: 0, z: 12.6, ry: Math.PI },
    crack: { x: -3.6, y: 0, z: 10.8, ry: 0.4 },
    workbench: { x: -6.95, y: 0, z: 8.9, ry: HALF_PI },
    shelves: { x: 7.45, y: 0, z: 8.85, ry: -HALF_PI },
    trophyShelf: { x: 4.47, y: 0, z: 13.72, ry: Math.PI },
    shaft: { x: -5.1, z: 1.7 }
  };
  // Lamps each chamber hangs; the scene keeps the nearest ten lit.
  const LAMPS = [
    { x: 0, y: 4.6, z: 8, chamber: 0 }, { x: -5, y: 4.6, z: 3, chamber: 0 }, { x: 5, y: 4.6, z: 11, chamber: 0 },
    // Hall and big-cave lamps hang over the rows, not the aisle, so they are never between the camera
    // and the view down it.
    { x: -6.5, y: 5.1, z: -6, chamber: 1 }, { x: 6.5, y: 5.1, z: -11, chamber: 1 }, { x: -6.5, y: 5.1, z: -16, chamber: 1 },
    { x: -7, y: 7.4, z: -29, chamber: 2 }, { x: 7, y: 7.4, z: -29, chamber: 2 }, { x: -7, y: 7.4, z: -41, chamber: 2 }, { x: 7, y: 7.4, z: -41, chamber: 2 }, { x: 0, y: 7.4, z: -47, chamber: 2 }
  ];
  // Each chamber's fan spots, along its back wall on the side away from its generators, facing into the
  // room: chamber c's are COOL_AT[c * COOL_SPOTS ...]. A Box Fan or a Fan Wall stands on any of them.
  const COOL_AT = [
    ...[3.0, 4.25, 5.5, 6.75].map((x) => ({ x, y: 0, z: 0.45, ry: 0 })),
    ...[3.2, 4.6, 6.0, 7.4].map((x) => ({ x, y: 0, z: -19.5, ry: 0 })),
    ...[9, 10.5, 12, 13.5].map((x) => ({ x, y: 0, z: -47.5, ry: 0 }))
  ];
  if (COOL_AT.length !== CHAMBERS.length * R.COOL_SPOTS) throw new Error("mine fan spots do not match the catalog");
  // A busbar is a copper riser up the breaker's wall to the cable tray, one for each bought.
  const BUSBAR_AT = CHAMBERS.flatMap((c, i) => Array.from({ length: R.BUSBAR.levels }, (_, n) => ({ x: c.x1 - 0.1, z: PROP_AT.breakers[i].z - 0.6 - n * 0.16, chamber: i })));
  // Where each chamber's safety gear hangs, one list per kind in R.SAFETY's order: chamber c's are
  // `SAFETY_AT[k][c * per ...]`, hung in that order. Fire Stoppers low on the breaker's wall between it
  // and the near wall, the spare breaker above them, the smoke alarm on the ceiling over the side row,
  // clear of the timber sets and the lamps.
  const hooks = (k, at) => CHAMBERS.flatMap((c) => Array.from({ length: R.SAFETY[k].per }, (_, n) => at(c, n)));
  const SAFETY_AT = [
    hooks(0, (c, n) => ({ x: c.x1 - 0.14, y: 0.7, z: c.z1 - 0.35 - n * 0.3, ry: -HALF_PI })),
    hooks(1, (c, n) => ({ x: c.x1 - 0.08, y: 1.75, z: c.z1 - 0.5 - n * 0.4, ry: -HALF_PI })),
    hooks(2, (c, n) => ({ x: c.x1 - 2.5 - n, y: c.h, z: (c.z0 + c.z1) / 2, ry: 0 }))
  ];
  // Where each chamber's timber sets stand: only where both wall strips are clear of everything that
  // stands against a wall (generators, breakers, benches, shelves, the board).
  const TIMBER_Z = [[3.1, 13.0], [-3.8, -8.5, -13.5, -18.5], [-24.3, -30, -36, -42]];
  // Ground that something stands on, as circles: the wall boulders keep off all of it.
  const KEEP = [];
  const keep = (x, z, r) => KEEP.push({ x, z, r });
  for (const at of POWER_AT) keep(at.x, at.z, 1.4);
  for (const at of PADS) keep(at.x, at.z, 1.6);
  for (const at of [...BENCH, ...SHELF]) keep(at.x, at.z, 0.7);
  for (const at of PROP_AT.breakers) keep(at.x, at.z, 0.9);
  for (const at of SAFETY_AT[0]) keep(at.x, at.z, 0.4);
  for (const at of COOL_AT) keep(at.x, at.z, 0.9);
  keep(PROP_AT.battery.x, PROP_AT.battery.z, 0.6);
  keep(PROP_AT.board.x, PROP_AT.board.z, 1.3);
  keep(PROP_AT.trader.x, PROP_AT.trader.z, 1.5);
  keep(PROP_AT.crack.x, PROP_AT.crack.z, 1.3);
  for (const dz of [-1.8, 0, 1.8]) {
    keep(PROP_AT.workbench.x, PROP_AT.workbench.z + dz, 0.9);
    keep(PROP_AT.shelves.x, PROP_AT.shelves.z + dz * 1.2, 0.9);
  }
  for (const dx of [-1.6, 0, 1.6]) keep(PROP_AT.trophyShelf.x + dx, PROP_AT.trophyShelf.z, 0.8);
  CHAMBERS.forEach((c, i) => {
    for (const z of TIMBER_Z[i]) {
      keep(c.x0 + 0.15, z, 0.45);
      keep(c.x1 - 0.15, z, 0.45);
    }
  });
  const clearGround = (x, z, r) => {
    for (const k of KEEP) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return false;
    return true;
  };
  const LAYOUT = { CHAMBERS, TUNNEL, BENCH, SHELF, PADS, POWER_AT, TROPHY_AT, PROP_AT, LAMPS, TIMBER_Z, SAFETY_AT, COOL_AT, BUSBAR_AT, ROCKS: null };
  if (PADS.length !== R.PADS || POWER_AT.length !== R.POWER_SPOTS || BENCH.length !== R.BENCH || SHELF.length !== R.SHELF || TROPHY_AT.length !== R.TROPHIES.length) {
    throw new Error("mine layout does not match the catalog");
  }

  // Where bay b of a holder sits, in the holder's own frame. A rack stacks its eight up the front; a
  // tank stands its twelve on edge in the oil like books, thin side along the tank, two rows of six,
  // their tops standing proud of the surface.
  const bayLocal = (holder, b, out) => {
    if (holder === 1) {
      out.x = 0;
      out.y = 0.34 + b * 0.27;
      out.z = 0.02;
      out.rx = 0;
      out.ry = 0;
    } else {
      out.x = -0.95 + (b % 6) * 0.38;
      out.y = 0.62;
      out.z = b < 6 ? -0.42 : 0.42;
      out.rx = -HALF_PI;
      out.ry = HALF_PI;
    }
    return out;
  };

  // ---- the cave ----

  // The rock round each chamber is carved voxels on the island's own grid mesher: a floor of trodden dirt, and
  // walls and ceiling of banded stone that only ever pocket outward, so nothing standing against a wall meets it.
  // A chamber's far wall is thinner, so its rock sits no deeper than half a metre into the next chamber; an
  // earlier chamber's room is never filled. Tunnels are cut through. Crystal cells glow in the stone.
  const ROCK_UNIT = 0.25;
  const ROCK_PALETTE = [null, "#6b5d50", "#605447", "#76675a", "#86673f", "#5a4a3a", "#4f4133", "#63513e", "#7fe0ff", "#b58cff", "#8a7a68"].map((c) => c && BL.math.hexToRgb(c));
  const cellHash = (x, y, z, k) => {
    let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(k, 2654435761);
    h = Math.imul(h ^ h >>> 15, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  };
  const smoothNoise = (x, y, z, k) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    let out = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      out += cellHash(ix + dx, iy + dy, iz + dz, k) * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
    }
    return out;
  };
  const rockShell = variants((i) => {
    const c = CHAMBERS[i], u = ROCK_UNIT, last = i === CHAMBERS.length - 1;
    const side = 1, back = last ? 1 : 0.5, cx = (c.x0 + c.x1) / 2;
    const ox = c.x0 - side, oy = -0.5, oz = c.z0 - back;
    const sx = Math.round((c.x1 - c.x0 + side * 2) / u), sy = Math.round((c.h + 0.5 + side) / u), sz = Math.round((c.z1 - c.z0 + side + back) / u);
    const grid = BL.terrain.makeGrid(sx, sy, sz);
    const walls = last ? [c.z1] : [c.z1, c.z0];
    for (let gx = 0; gx < sx; gx++) for (let gy = 0; gy < sy; gy++) for (let gz = 0; gz < sz; gz++) {
      const px = ox + (gx + 0.5) * u, py = oy + (gy + 0.5) * u, pz = oz + (gz + 0.5) * u;
      if (px > c.x0 && px < c.x1 && py > 0 && py < c.h && pz > c.z0 && pz < c.z1) continue;
      let open = false;
      for (let k = 0; k < i && !open; k++) {
        const e = CHAMBERS[k];
        open = px > e.x0 && px < e.x1 && py > 0 && py < e.h && pz > e.z0 && pz < e.z1;
      }
      for (const z of walls) if (Math.abs(pz - z) < side + 0.01 && Math.abs(px - cx) < TUNNEL.w / 2 && py > 0 && py < TUNNEL.h) open = true;
      if (open) continue;
      if (py < 0) {
        grid.set(gx, gy, gz, cellHash(gx, gy, gz, i) < 0.3 ? 6 : cellHash(gx, gy, gz, 9) < 0.2 ? 7 : 5);
        continue;
      }
      const out = Math.max(c.x0 - px, px - c.x1, py - c.h, c.z0 - pz, pz - c.z1);
      const pocket = Math.max(0, smoothNoise(px * 0.9, py * 1.1, pz * 0.9, i) - 0.42) * (pz < c.z0 && !last ? 0.8 : 2);
      if (out < pocket) continue;
      const band = Math.floor(py * 1.6 + smoothNoise(px * 0.4, py * 0.3, pz * 0.4, 7 + i) * 3);
      const crystal = out < 0.5 && cellHash(gx, gy, gz, 31) < 0.006;
      grid.set(gx, gy, gz, crystal ? (cellHash(gx, gy, gz, 5) < 0.6 ? 8 : 9) : band % 7 === 0 ? 4 : 1 + (((band % 3) + 3) % 3 + (cellHash(gx, gy, gz, 3) < 0.06 ? 1 : 0)) % 3);
    }
    const geo = BL.terrain.gridGeometry(grid, { unit: u, palette: ROCK_PALETTE, origin: { x: ox, y: oy, z: oz } });
    for (const f of geo.faces) if (f.color === ROCK_PALETTE[8] || f.color === ROCK_PALETTE[9]) f.emissive = 0.7;
    // The scene's light is overhead and the rock encloses it: a casting shell would shadow the whole room.
    geo.castShadow = false;
    return geo;
  });

  // A timber prop set: two posts and a cap beam, the thing that holds a mine up. The tunnel's frames
  // it; a chamber's are built to its own size, posts flush to both walls and the cap under the ceiling,
  // so nothing standing in the room ever meets one (see TIMBER_Z).
  // Chunky bevelled timber: two posts at x = ±px under a cap `capW` wide at height `top`, an iron band and a rope
  // lashing where each post meets the cap, and a knee brace from each post up to the cap.
  const TIMBER_ROPE = "#b89760";
  const timberSet = (px, post, top, capW) => {
    const parts = [];
    for (const side of [-1, 1]) {
      parts.push(bevelBox({ w: 0.32, h: post, d: 0.32, color: TIMBER, bevel: 0.06, offset: { x: side * px, y: post / 2 } }));
      parts.push(bevelBox({ w: 0.36, h: 0.08, d: 0.36, color: METAL_DARK, bevel: 0.02, offset: { x: side * px, y: 0.3 } }));
      parts.push(bevelBox({ w: 0.36, h: 0.1, d: 0.36, color: TIMBER_ROPE, bevel: 0.03, offset: { x: side * px, y: post - 0.2 } }));
      // The knee: a beam 0.9 long leaning 45 degrees in toward the middle, from the post to the cap's underside.
      parts.push(moved(turn(bevelBox({ w: 0.18, h: 0.9, d: 0.18, color: TIMBER_DARK, bevel: 0.04 }), side * HALF_PI, -Math.PI / 4), side * (px - 0.16 - 0.32), post - 0.33, 0));
    }
    parts.push(bevelBox({ w: capW, h: 0.34, d: 0.38, color: TIMBER_DARK, bevel: 0.07, offset: { y: top } }));
    return merge(...parts);
  };
  const tunnelFrame = cached(() => {
    const w = TUNNEL.w + 0.5, h = TUNNEL.h + 0.2;
    return timberSet(w / 2, h, h, w + 0.6);
  });
  const chamberTimber = variants((i) => {
    const c = CHAMBERS[i], w = c.x1 - c.x0, post = c.h - 0.32;
    return timberSet(w / 2 - 0.15, post, c.h - 0.16, w);
  });

  // A copy of a built geometry moved into place: the faces are shared, only the corners are new, and
  // `merge` copies both into the one chamber mesh anyway.
  const placedCopy = (geo, x, y, z, scale, yaw) => {
    const v = geo.verts, out = new Array(v.length), c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < v.length; i += 3) {
      const px = v[i] * scale, py = v[i + 1] * scale, pz = v[i + 2] * scale;
      out[i] = x + px * c + pz * sn;
      out[i + 1] = y + py;
      out[i + 2] = z + pz * c - px * sn;
    }
    return { verts: out, faces: geo.faces, lines: geo.lines };
  };
  // The boulders at the foot of every wall, half sunk into the rock. They are their own nodes rather
  // than part of the decor mesh, because every one of them can be cracked for bananas; they share the
  // hub's two rock geometries, so a chamber's worth is still two draws. One fixed table, built once.
  const ROCKS = [];
  CHAMBERS.forEach((c, i) => {
    const rand = BL.math.mulberry32(401 + i * 17);
    const along = (from, to, step, at) => {
      for (let p = from + step * 0.5; p < to; p += step * (0.7 + rand() * 0.6)) at(p);
    };
    along(c.z0, c.z1, 2.2, (z) => {
      for (const side of [-1, 1]) {
        const rock = { chamber: i, variant: rand() < 0.5 ? 0 : 1, x: side < 0 ? c.x0 + 0.25 : c.x1 - 0.25, z, scale: 0.28 + rand() * 0.34, ry: rand() * 6.28 };
        if (clearGround(rock.x, rock.z, rock.scale * 1.3)) ROCKS.push(rock);
      }
    });
    along(c.x0, c.x1, 2.4, (x) => {
      if (Math.abs(x) < TUNNEL.w / 2 + 0.6 && i < CHAMBERS.length - 1) return;
      const rock = { chamber: i, variant: rand() < 0.5 ? 0 : 1, x, z: c.z0 + 0.3, scale: 0.3 + rand() * 0.3, ry: rand() * 6.28 };
      if (clearGround(rock.x, rock.z, rock.scale * 1.3)) ROCKS.push(rock);
    });
  });
  // Everything else that makes a chamber read as dug rock rather than a box: stalactites, veins of
  // crystal that catch the lamps, cable trays at the top of the walls and a plank walkway down the
  // middle aisle. One merged mesh per chamber, built once, one draw.
  const chamberDecor = variants((i) => {
    const c = CHAMBERS[i], rand = BL.math.mulberry32(907 + i * 23), parts = [];
    // Stalactites, hung where nothing tall stands: over the side aisles near the walls.
    const drips = 6 + i * 6;
    for (let k = 0; k < drips; k++) {
      const x = c.x0 + 0.8 + rand() * (c.x1 - c.x0 - 1.6), z = c.z0 + 0.8 + rand() * (c.z1 - c.z0 - 1.6);
      if (Math.abs(x) < 1.6) continue;
      const len = 0.35 + rand() * (0.5 + i * 0.35), r = 0.1 + rand() * 0.14;
      const cone = lathe({ profile: [[r, 0], [r * 0.7, -len * 0.45], [r * 0.3, -len * 0.85], [0, -len]], segments: 6, color: rand() < 0.5 ? STONE : STONE_LIGHT });
      parts.push(placedCopy(cone, x, c.h, z, 1, 0));
    }
    // Cable trays run the length of the side walls just under the ceiling.
    for (const side of [-1, 1]) {
      const x = side < 0 ? c.x0 + 0.2 : c.x1 - 0.2, len = c.z1 - c.z0 - 0.6;
      parts.push(bx({ w: 0.26, h: 0.06, d: len, color: METAL_DARK, offset: { x, y: c.h - 0.55, z: (c.z0 + c.z1) / 2 } }));
      parts.push(bx({ w: 0.08, h: 0.08, d: len, color: "#1b1b1b", offset: { x: x - side * 0.05, y: c.h - 0.48, z: (c.z0 + c.z1) / 2 } }));
      parts.push(bx({ w: 0.06, h: 0.06, d: len, color: COPPER, emissive: 0.08, offset: { x: x + side * 0.05, y: c.h - 0.48, z: (c.z0 + c.z1) / 2 } }));
    }
    // A plank walkway down the middle aisle, from the mouth (or the tunnel) to the far wall.
    for (let z = c.z1 - 0.3; z > c.z0 + 0.3; z -= 0.55) {
      parts.push(bx({ w: 1.4, h: 0.04, d: 0.48, color: rand() < 0.5 ? TIMBER : "#5e4125", offset: { x: (rand() - 0.5) * 0.06, y: 0.02, z } }));
    }
    const geo = merge(...parts);
    geo.castShadow = false;
    return geo;
  });

  // Where each chamber's crates, ore and barrels stand, as plain numbers the scene also walks round:
  // against the walls, clear of every spot the sim places, the boulders and the tunnels.
  const DRESS_AT = [];
  CHAMBERS.forEach((c, i) => {
    const KINDS = ["crate", "coalCrate", "barrel", "crate", "coalCrate", "crate"], spots = [];
    for (const [x, turns] of [[c.x0 + 0.62, 1], [c.x1 - 0.62, 3]]) for (let z = c.z1 - 1; z > c.z0 + 1; z -= 1.15) spots.push(x, z, turns);
    for (const [z, turns] of [[c.z0 + 0.62, 0], [c.z1 - 0.62, 2]]) for (let x = c.x0 + 1; x < c.x1 - 1; x += 1.15) if (Math.abs(x) > TUNNEL.w / 2 + 0.8) spots.push(x, z, turns);
    let placed = 0;
    for (let n = 0; n < spots.length; n += 3) {
      const x = spots[n], z = spots[n + 1], turns = spots[n + 2];
      if (placed >= 10 + i * 6 || cellHash(Math.round(x * 4), Math.round(z * 4), i, 13) < 0.3) continue;
      if (!clearGround(x, z, 0.55) || ROCKS.some((r) => r.chamber === i && Math.hypot(r.x - x, r.z - z) < 0.95)) continue;
      const variant = Math.floor(cellHash(Math.round(x * 4), Math.round(z * 4), i, 17) * KINDS.length);
      DRESS_AT.push({ chamber: i, kind: KINDS[variant], x, z, turns, variant, stacked: variant === 0 && cellHash(1, Math.round(z * 4), i, 19) < 0.5 });
      placed++;
    }
  });
  LAYOUT.DRESS_AT = DRESS_AT;
  // Each chamber dressed from the shared kit: a lantern garland under every timber cap (lanterns over the side
  // rows, the aisle left clear), bulb festoons along both walls, and crates, ore and barrels against the
  // walls wherever nothing the sim places and no boulder stands. Three draws a chamber.
  const chamberDressing = variants((i) => {
    const c = CHAMBERS[i], set = BL.dressing.set(), y = c.h - 0.45;
    for (const z of TIMBER_Z[i]) set.cable(c.x0 + 0.35, y, z + 0.28, c.x1 - 0.35, y, z + 0.28, 0.35, [0.22, 0.78]);
    const zs = [c.z1 - 0.4, ...TIMBER_Z[i], c.z0 + 0.4];
    for (let k = 0; k + 1 < zs.length; k++) for (const x of [c.x0 + 0.4, c.x1 - 0.4]) {
      const len = Math.abs(zs[k] - zs[k + 1]), bulbs = [];
      for (let t = 0.6 / len; t < 1; t += 1.3 / len) bulbs.push(t);
      set.cable(x, y - 0.3, zs[k], x, y - 0.3, zs[k + 1], 0.3, bulbs, "bulb");
    }
    for (const d of DRESS_AT) if (d.chamber === i) {
      set.put(d.kind, d.x, 0, d.z, d.turns, d.variant);
      if (d.stacked) set.put("crate", d.x, 0.75, d.z, d.turns + 1, 1);
    }
    return set.build();
  });

  // The rubble plug in a tunnel mouth that a dig breaks out: tumbled voxel boulders packed to the tunnel's
  // size.
  const seal = cached(() => {
    const u = ROCK_UNIT, sx = Math.round((TUNNEL.w + 0.5) / u), sy = Math.round((TUNNEL.h + 0.3) / u), sz = 4;
    const grid = BL.terrain.makeGrid(sx, sy, sz), ox = -sx * u / 2;
    for (let gx = 0; gx < sx; gx++) for (let gy = 0; gy < sy; gy++) for (let gz = 0; gz < sz; gz++) {
      // Each cell belongs to the boulder of its jittered 3x3 block; the seams between boulders stand back.
      const bx = Math.floor((gx + cellHash(0, gy >> 2, 0, 3) * 3) / 3.5), by = Math.floor(gy / 3.2);
      const seam = (gx + cellHash(0, gy >> 2, 0, 3) * 3) % 3.5 < 0.6 || gy % 3.2 < 0.4;
      if (gz === 0 && (seam || cellHash(bx, by, 0, 11) < 0.25)) continue;
      const k = cellHash(bx, by, 0, 7);
      grid.set(gx, gy, gz, seam ? 6 : k < 0.3 ? 3 : k < 0.6 ? 1 : k < 0.85 ? 2 : 10);
    }
    return BL.terrain.gridGeometry(grid, { unit: u, palette: ROCK_PALETTE, origin: { x: ox, y: 0, z: 0 } });
  });

  // The whole cave at full extent: three chambers, their walls and ceilings, the tunnels, and a seal in
  // each tunnel. The scene shows a chamber once it is dug and drops its seal; nothing is rebuilt.
  const cave = () => {
    const root = createNode();
    const chambers = [], seals = [];
    CHAMBERS.forEach((c, i) => {
      const node = createNode({ visible: i === 0 });
      const cx = (c.x0 + c.x1) / 2;
      addChild(node, createNode({ geometry: rockShell(i), depthBias: 1.2 }));
      // Timber sets down the chamber, so it reads as dug rather than built.
      for (const z of TIMBER_Z[i]) addChild(node, createNode({ position: { x: cx, y: 0, z }, geometry: chamberTimber(i) }));
      addChild(node, createNode({ position: { x: cx, y: 0, z: c.z1 }, geometry: tunnelFrame() }));
      addChild(node, createNode({ geometry: chamberDecor(i), depthBias: 0.4 }));
      const dressing = chamberDressing(i);
      addChild(node, ...BL.dressing.nodes(dressing, { glow: 1 }));
      addChild(root, node);
      chambers.push(node);
      if (i < CHAMBERS.length - 1) {
        const plug = createNode({ position: { x: cx, y: 0, z: c.z0 + 0.3 }, rotation: { x: 0, y: Math.PI, z: 0 }, geometry: seal() });
        addChild(root, plug);
        seals.push(plug);
      }
    });
    return { root, chambers, seals };
  };

  // ---- the miners ----

  // The box you inherited: a carved stone case with a slate screen and a pebble keyboard.
  const pebbleBox = cached(() => merge(
    bx({ w: 0.34, h: 0.46, d: 0.42, color: "#5a534b", offset: { x: -0.22, y: 0.23 } }),
    bx({ w: 0.04, h: 0.05, d: 0.02, color: GREEN, emissive: 1.1, offset: { x: -0.22, y: 0.38, z: 0.22 } }),
    bx({ w: 0.44, h: 0.32, d: 0.06, color: "#2a2622", offset: { x: 0.2, y: 0.36 } }),
    bx({ w: 0.38, h: 0.24, d: 0.02, color: "#1c3b2c", emissive: 0.8, offset: { x: 0.2, y: 0.37, z: 0.035 } }),
    bx({ w: 0.06, h: 0.2, d: 0.06, color: "#2a2622", offset: { x: 0.2, y: 0.1 } }),
    bx({ w: 0.36, h: 0.04, d: 0.16, color: "#6b625a", offset: { x: 0.16, y: 0.02, z: 0.2 } })
  ));

  // Six shiny rocks on a plank: cards on edge, each with its fan ring, and a spaghetti of cable.
  const shinyRocks = cached(() => {
    const parts = [
      bx({ w: 1.1, h: 0.05, d: 0.5, color: TIMBER, offset: { y: 0.03 } }),
      bx({ w: 0.05, h: 0.36, d: 0.05, color: METAL, offset: { x: -0.5, y: 0.2, z: -0.2 } }),
      bx({ w: 0.05, h: 0.36, d: 0.05, color: METAL, offset: { x: 0.5, y: 0.2, z: -0.2 } }),
      bx({ w: 1.05, h: 0.04, d: 0.04, color: METAL, offset: { y: 0.38, z: -0.2 } })
    ];
    for (let i = 0; i < 6; i++) {
      const x = -0.42 + i * 0.168;
      parts.push(bx({ w: 0.05, h: 0.3, d: 0.42, color: i % 2 ? "#2b2f36" : "#323740", offset: { x, y: 0.21 } }));
      parts.push(bx({ w: 0.055, h: 0.03, d: 0.03, color: i % 2 ? GREEN : AMBER, emissive: 1, offset: { x, y: 0.34, z: 0.2 } }));
      parts.push(moved(turn(ring({ r: 0.09, thickness: 0.02, segments: 8, color: "#15171b" }), HALF_PI, HALF_PI), x + 0.03, 0.2, 0));
    }
    parts.push(bx({ w: 0.9, h: 0.03, d: 0.03, color: "#1a1a1a", offset: { y: 0.05, z: -0.22 } }));
    return merge(...parts);
  });

  // The ASICs, one look per model in the catalog's order from the first ASIC on: the grey Thunder Box,
  // the banded Thunder Box II, the blue Storm Box, the white Sky Splitter and the black Deep Storm. They
  // are the geometry drawn by the hundred, one instanced batch each, so every one is a few boxes.
  const ASIC_LOOKS = [
    { body: METAL, face: "#15171b", led: GREEN, band: null },
    { body: "#5a5f66", face: "#15171b", led: GREEN, band: AMBER },
    { body: "#2f4f7a", face: "#101a2a", led: "#7fe0ff", band: "#7fe0ff" },
    { body: "#d8d8d2", face: "#2a2c30", led: "#7fe0ff", band: "#f5c542" },
    { body: "#1b1d22", face: "#0c0d10", led: "#b58cff", band: "#b58cff" }
  ];
  const asic = variants((i) => {
    const look = ASIC_LOOKS[i];
    const parts = [
      bx({ w: 0.72, h: 0.22, d: 0.5, color: look.body }),
      bx({ w: 0.2, h: 0.18, d: 0.02, color: look.face, offset: { x: -0.2, z: 0.25 } }),
      bx({ w: 0.2, h: 0.18, d: 0.02, color: look.face, offset: { x: 0.08, z: 0.25 } }),
      bx({ w: 0.07, h: 0.04, d: 0.02, color: look.led, emissive: 1.2, offset: { x: 0.28, y: 0.05, z: 0.255 } }),
      bx({ w: 0.05, h: 0.04, d: 0.02, color: AMBER, emissive: 0.9, offset: { x: 0.28, y: -0.04, z: 0.255 } })
    ];
    if (look.band) parts.push(bx({ w: 0.74, h: 0.03, d: 0.52, color: look.band, emissive: 0.35, offset: { y: 0.1 } }));
    // Two fan grilles at the back and a row of heatsink fins on top.
    for (const x of [-0.18, 0.18]) parts.push(moved(turn(ring({ r: 0.085, thickness: 0.018, segments: 8, color: "#101114" }), 0, HALF_PI), x, 0, -0.255));
    for (let f = 0; f < 5; f++) parts.push(bx({ w: 0.02, h: 0.03, d: 0.4, color: look.face, offset: { x: -0.24 + f * 0.12, y: 0.125 } }));
    return merge(...parts);
  });
  const thunderBox = () => asic(0);

  // ---- the holders ----

  const rackFrame = cached(() => {
    const parts = [
      bx({ w: 0.92, h: 0.08, d: 0.66, color: METAL_DARK, offset: { y: 0.04 } }),
      bx({ w: 0.92, h: 0.06, d: 0.66, color: METAL_DARK, offset: { y: 2.52 } })
    ];
    for (const x of [-0.43, 0.43]) for (const z of [-0.3, 0.3]) parts.push(bx({ w: 0.06, h: 2.5, d: 0.06, color: METAL, offset: { x, y: 1.27, z } }));
    for (let b = 0; b < 9; b++) parts.push(bx({ w: 0.8, h: 0.02, d: 0.6, color: "#2a2d31", offset: { y: 0.2 + b * 0.27 } }));
    // The fan wall at the back, a status strip along the top and a cable bundle down one side.
    parts.push(bx({ w: 0.86, h: 2.3, d: 0.04, color: "#1b1d20", offset: { y: 1.3, z: -0.32 } }));
    parts.push(bx({ w: 0.7, h: 0.035, d: 0.02, color: GREEN, emissive: 0.9, offset: { y: 2.46, z: 0.34 } }));
    parts.push(bx({ w: 0.07, h: 2.2, d: 0.07, color: "#15161a", offset: { x: 0.4, y: 1.2, z: -0.26 } }));
    parts.push(bx({ w: 0.05, h: 2.2, d: 0.05, color: AMBER, emissive: 0.15, offset: { x: 0.36, y: 1.2, z: -0.22 } }));
    return merge(...parts);
  });

  // Deep enough for two rows of units on edge (see `bayLocal`).
  const coldPool = cached(() => merge(
    // Body, oil and rails each at their own height, so no two faces share a plane and fight.
    bx({ w: 2.5, h: 0.64, d: 1.9, color: "#2e3238", offset: { y: 0.32 } }),
    bx({ w: 2.36, h: 0.05, d: 1.76, color: OIL, emissive: 0.5, offset: { y: 0.675 } }),
    // Bubbles rising through the oil, caught on the surface between the rows.
    ...[[-0.9, -0.05], [-0.5, 0.05], [-0.1, 0], [0.3, -0.04], [0.7, 0.04], [1.0, 0], [-0.7, 0.82], [0.5, -0.82]].map(([x, z]) => bx({ w: 0.05, h: 0.02, d: 0.05, color: "#bff4ff", emissive: 0.9, offset: { x, y: 0.71, z } })),
    bx({ w: 2.52, h: 0.05, d: 0.06, color: "#7fe0ff", emissive: 0.6, offset: { y: 0.6, z: 0.95 } }),
    // The rim: four rails round the top, open over the oil.
    bx({ w: 2.6, h: 0.08, d: 0.1, color: METAL_DARK, offset: { y: 0.72, z: 0.95 } }),
    bx({ w: 2.6, h: 0.08, d: 0.1, color: METAL_DARK, offset: { y: 0.72, z: -0.95 } }),
    bx({ w: 0.1, h: 0.08, d: 2.0, color: METAL_DARK, offset: { x: 1.25, y: 0.72 } }),
    bx({ w: 0.1, h: 0.08, d: 2.0, color: METAL_DARK, offset: { x: -1.25, y: 0.72 } }),
    bx({ w: 0.2, h: 0.5, d: 0.2, color: COPPER, offset: { x: 1.4, y: 0.25 } })
  ));

  // The pad a holder stands on: a slab with bolts, lit yellow when it is a place to drop something.
  const pad = cached(() => merge(
    bx({ w: 1.5, h: 0.05, d: 1.2, color: "#3a3631", offset: { y: 0.025 } }),
    ...[[-0.6, -0.45], [0.6, -0.45], [-0.6, 0.45], [0.6, 0.45]].map(([x, z]) => bx({ w: 0.08, h: 0.03, d: 0.08, color: METAL, offset: { x, y: 0.06, z } }))
  ));

  // ---- power ----

  const waterWheel = cached(() => {
    const wheel = [ring({ r: 1.0, thickness: 0.1, segments: 16, color: TIMBER })];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      wheel.push(bx({ w: 0.46, h: 0.08, d: 0.34, color: "#7d5730", offset: { x: Math.cos(a) * 0.76, y: Math.sin(a) * 0.76 } }));
    }
    return merge(moved(turn(merge(...wheel), 0, HALF_PI), 0, 1.15, 0),
      bx({ w: 1.4, h: 0.3, d: 0.5, color: "#3a3631", offset: { y: 0.15 } }),
      bx({ w: 1.1, h: 0.04, d: 0.36, color: OIL, emissive: 0.35, offset: { y: 0.31 } }),
      bx({ w: 0.12, h: 1.2, d: 0.12, color: TIMBER_DARK, offset: { x: -0.6, y: 0.6 } }),
      bx({ w: 0.12, h: 1.2, d: 0.12, color: TIMBER_DARK, offset: { x: 0.6, y: 0.6 } }));
  });
  const sunLeaves = cached(() => merge(
    moved(turn(merge(
      bx({ w: 1.5, h: 0.05, d: 1.0, color: "#22402c", emissive: 0.15 }),
      ...[-0.5, 0, 0.5].map((x) => bx({ w: 0.02, h: 0.06, d: 0.98, color: "#6de08a", emissive: 0.4, offset: { x } }))
    ), 0, -0.5), 0, 1.2, 0),
    bx({ w: 0.1, h: 1.2, d: 0.1, color: "#4a4128", offset: { y: 0.6, z: -0.2 } })
  ));
  const steamVent = cached(() => merge(
    lathe({ profile: [[0.7, 0], [0.62, 0.5], [0.5, 1.1], [0.54, 1.3]], segments: 10, color: "#4a453c" }),
    ring({ r: 0.52, thickness: 0.08, y: 1.32, segments: 10, color: "#6a4630", emissive: 0.3 }),
    bx({ w: 0.2, h: 0.2, d: 0.8, color: COPPER, offset: { y: 0.4, z: 0.6 } })
  ));
  // A crystal bank: a crate of charge crystals wired to the circuit.
  const crystalBank = cached(() => merge(
    bx({ w: 1.2, h: 0.7, d: 0.8, color: TIMBER, offset: { y: 0.35 } }),
    ...[-0.35, 0, 0.35].map((x) => moved(lathe({ profile: [[0, 0], [0.12, 0.1], [0.08, 0.42], [0, 0.52]], segments: 6, color: "#7fe0ff", emissive: 0.8 }), x, 0.68, 0)),
    bx({ w: 0.1, h: 0.1, d: 0.6, color: COPPER, offset: { x: 0.65, y: 0.3 } })
  ));
  const POWER_BUILDERS = [waterWheel, sunLeaves, steamVent, crystalBank];
  // The light shaft over the Den's power nook: a hole in the rock with the sky in it.
  const skyHole = cached(() => noShadow(merge(
    bx({ w: 1.6, h: 0.04, d: 1.6, color: "#fff3c4", emissive: 1 }),
    ring({ r: 1.1, thickness: 0.18, y: -0.05, segments: 10, color: STONE_DARK })
  )));

  // ---- props ----

  const workbench = cached(() => merge(
    bx({ w: 4.2, h: 0.1, d: 0.9, color: TIMBER, offset: { y: 0.87 } }),
    ...[-1.9, 1.9].flatMap((x) => [-0.35, 0.35].map((z) => bx({ w: 0.12, h: 0.84, d: 0.12, color: TIMBER_DARK, offset: { x, y: 0.42, z } })))
  ));
  const shelves = cached(() => merge(
    bx({ w: 5.4, h: 0.08, d: 0.6, color: TIMBER, offset: { y: 0.94 } }),
    bx({ w: 5.4, h: 0.08, d: 0.6, color: TIMBER, offset: { y: 1.94 } }),
    ...[-2.6, 0, 2.6].map((x) => bx({ w: 0.1, h: 2.4, d: 0.1, color: TIMBER_DARK, offset: { x, y: 1.2, z: -0.22 } }))
  ));
  // The breaker panel: the handle is a separate node so it can be thrown.
  const breakerPanel = cached(() => merge(
    bx({ w: 0.9, h: 1.2, d: 0.22, color: "#3d434a", offset: { y: 1.2 } }),
    bx({ w: 0.74, h: 0.96, d: 0.04, color: "#22262b", offset: { y: 1.2, z: 0.12 } }),
    bx({ w: 0.1, h: 0.05, d: 0.03, color: AMBER, emissive: 1.2, offset: { x: 0.3, y: 1.64, z: 0.14 } }),
    bx({ w: 0.08, h: 1.4, d: 0.08, color: COPPER, offset: { x: -0.3, y: 2.2 } })
  ));
  const breakerLever = cached(() => bx({ w: 0.12, h: 0.34, d: 0.1, color: "#c4562f", emissive: 0.25, offset: { y: 0.14 } }));
  // The cooling plant: a big fan in a stone housing. The blade is its own node so it can stop.
  // The fans, each drawn with its blades as a separate node the scene spins (see FAN_MOUNT): a Fan
  // Wall cabinet, narrow enough for four along a back wall, and a Box Fan on a pole in a wire cage.
  const fanWall = cached(() => merge(
    bx({ w: 1.15, h: 2.2, d: 0.45, color: "#3b4046", offset: { y: 1.1 } }),
    bx({ w: 1.0, h: 1.0, d: 0.04, color: "#15171b", offset: { y: 1.2, z: 0.23 } }),
    moved(turn(ring({ r: 0.5, thickness: 0.05, segments: 16, color: METAL }), 0, HALF_PI), 0, 1.2, 0.26),
    bx({ w: 0.12, h: 0.08, d: 0.02, color: GREEN, emissive: 1, offset: { x: 0.42, y: 2.05, z: 0.235 } })
  ));
  const boxFan = cached(() => merge(
    lathe({ profile: [[0, 0], [0.24, 0], [0.24, 0.04], [0, 0.06]], segments: 10, color: "#33373c" }),
    bx({ w: 0.05, h: 0.8, d: 0.05, color: METAL, offset: { y: 0.44 } }),
    moved(turn(ring({ r: 0.33, thickness: 0.04, segments: 14, color: "#8a9099" }), 0, HALF_PI), 0, 1.0, 0),
    moved(turn(ring({ r: 0.33, thickness: 0.02, segments: 14, color: "#8a9099" }), 0, HALF_PI), 0, 1.0, 0.1),
    bx({ w: 0.12, h: 0.14, d: 0.14, color: "#33373c", offset: { y: 1.0, z: -0.08 } })
  ));
  // Where each fan's blades sit in its own frame, and how big they are against fanBlade.
  const FAN_MOUNT = [{ y: 1.0, z: 0.05, scale: 0.5 }, { y: 1.2, z: 0.28, scale: 0.78 }];
  const busbarRiser = variants((i) => {
    const len = CHAMBERS[i].h - 0.55 - 2.6;
    return merge(
      bx({ w: 0.08, h: len, d: 0.08, color: COPPER, emissive: 0.25, offset: { y: 2.6 + len / 2 } }),
      bx({ w: 0.12, h: 0.05, d: 0.12, color: METAL_DARK, offset: { y: 2.62 } }),
      bx({ w: 0.12, h: 0.05, d: 0.12, color: METAL_DARK, offset: { y: 2.6 + len - 0.02 } })
    );
  });
  // The Den's battery: a timber cradle of crystals the scene lights with the charge.
  const crystalCell = cached(() => merge(
    bx({ w: 0.7, h: 0.08, d: 0.45, color: TIMBER_DARK, offset: { y: 0.04 } }),
    bx({ w: 0.06, h: 0.7, d: 0.06, color: TIMBER, offset: { x: -0.32, y: 0.39, z: -0.19 } }),
    bx({ w: 0.06, h: 0.7, d: 0.06, color: TIMBER, offset: { x: 0.32, y: 0.39, z: -0.19 } }),
    moved(lathe({ profile: [[0, 0], [0.14, 0.12], [0.1, 0.44], [0, 0.56]], segments: 6, color: "#7fe0ff", emissive: 0.8 }), -0.15, 0.08, 0),
    moved(lathe({ profile: [[0, 0], [0.12, 0.1], [0.08, 0.36], [0, 0.46]], segments: 6, color: "#b58cff", emissive: 0.7 }), 0.1, 0.08, 0.05),
    moved(lathe({ profile: [[0, 0], [0.1, 0.08], [0.07, 0.3], [0, 0.4]], segments: 6, color: "#7fe0ff", emissive: 0.8 }), 0.2, 0.08, -0.1)
  ));
  const fanHub = () => moved(turn(ring({ r: 0.12, thickness: 0.05, segments: 10, color: METAL_DARK }), 0, HALF_PI), 0, 0, 0.02);
  const fanBlade = cached(() => {
    const parts = [fanHub()];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      parts.push(bx({ w: 0.56, h: 0.14, d: 0.02, color: "#5a6068", offset: { x: Math.cos(a) * 0.32, y: Math.sin(a) * 0.32 } }));
    }
    return merge(...parts);
  });
  // The same fan at speed: blades too fast to see read as a grey disc with a few streaks in it. A
  // real fan at twenty turns a second strobes backwards on a sixty-frame screen, so the scene swaps
  // to this above a few turns a second, the way films and games do.
  const fanBlur = cached(() => {
    const parts = [fanHub(), moved(turn(lathe({ profile: [[0.14, -0.012], [0.62, -0.012], [0.62, 0.012], [0.14, 0.012], [0.14, -0.012]], segments: 16, color: "#474c53" }), 0, HALF_PI), 0, 0, -0.005)];
    // Three streaks, none alike, so the disc has no symmetry to alias: turned fast it still reads as
    // turning forward instead of standing still or running backwards.
    [[0.38, 0.4, "#9aa1ab"], [0.26, 0.3, "#7b818a"], [0.18, 0.48, "#5f656d"]].forEach(([w, r, color], i) => {
      const a = i / 3 * Math.PI * 2;
      parts.push(bx({ w, h: 0.05, d: 0.012, color, offset: { x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0.02 } }));
    });
    return merge(...parts);
  });
  // The pool's board, a slab of slate with a glowing face; the scene dims it when the pool runs off.
  const poolBoard = cached(() => merge(
    bx({ w: 2.0, h: 1.3, d: 0.12, color: "#2a2e34", offset: { y: 1.7 } }),
    bx({ w: 1.8, h: 1.1, d: 0.03, color: "#0c1a20", emissive: 0.35, offset: { y: 1.7, z: 0.07 } }),
    // A baseline and faint grid for the hash chart the scene draws on it.
    bx({ w: POOL_CHART.x1 - POOL_CHART.x0, h: 0.012, d: 0.005, color: "#7fe0ff", emissive: 0.4, offset: { x: (POOL_CHART.x0 + POOL_CHART.x1) / 2, y: POOL_CHART.y0 - 0.01, z: POOL_CHART.z - 0.012 } }),
    bx({ w: 0.012, h: POOL_CHART.y1 - POOL_CHART.y0, d: 0.005, color: "#7fe0ff", emissive: 0.4, offset: { x: POOL_CHART.x1 + 0.02, y: (POOL_CHART.y0 + POOL_CHART.y1) / 2, z: POOL_CHART.z - 0.012 } }),
    ...[1, 2, 3].map((k) => bx({ w: POOL_CHART.x1 - POOL_CHART.x0, h: 0.006, d: 0.005, color: "#1c3a44", emissive: 0.35, offset: { x: (POOL_CHART.x0 + POOL_CHART.x1) / 2, y: POOL_CHART.y0 + k * (POOL_CHART.y1 - POOL_CHART.y0) / 3, z: POOL_CHART.z - 0.012 } })),
    bx({ w: 0.14, h: 1.1, d: 0.14, color: TIMBER_DARK, offset: { x: -0.8, y: 0.55 } }),
    bx({ w: 0.14, h: 1.1, d: 0.14, color: TIMBER_DARK, offset: { x: 0.8, y: 0.55 } })
  ));
  // The trader: a stall of crates under a sign. The price board is its own node so it can go red.
  const traderStall = cached(() => merge(
    bx({ w: 2.2, h: 0.1, d: 0.9, color: TIMBER, offset: { y: 0.95 } }),
    bx({ w: 0.8, h: 0.8, d: 0.8, color: "#7a5a33", offset: { x: -0.6, y: 0.4 } }),
    bx({ w: 0.7, h: 0.6, d: 0.7, color: "#6b4a2b", offset: { x: 0.55, y: 0.3 } }),
    bx({ w: 0.12, h: 2.4, d: 0.12, color: TIMBER_DARK, offset: { x: -1.0, y: 1.2, z: -0.35 } }),
    bx({ w: 0.12, h: 2.4, d: 0.12, color: TIMBER_DARK, offset: { x: 1.0, y: 1.2, z: -0.35 } })
  ));
  const priceBoard = variants((i) => merge(
    bx({ w: 1.9, h: 0.5, d: 0.06, color: "#3a2a18", offset: { y: 2.1, z: -0.35 } }),
    bx({ w: 1.7, h: 0.34, d: 0.02, color: i ? "#c4402f" : "#e8d9a8", emissive: i ? 0.9 : 0.35, offset: { y: 2.1, z: -0.31 } })
  ));
  // The trader's chart screen, hung on the stall's posts above the price sign: a dark slate in a timber
  // frame with faint grid lines. `CHART` is the plot area in the stall's own frame; the candles are
  // instanced unit boxes the scene scales into it.
  // The plot sits left of a price scale and under a title row; the scene sets both in type over it.
  const CHART = { x0: -1.04, x1: 0.5, y0: 2.47, y1: 3.18, z: -0.24, labelX: -1.1, labelY: 2.37, labelW: 200, labelH: 91 };
  // The pool board's hash chart, in the board's own frame on its glowing face.
  const POOL_CHART = { x0: -0.84, x1: 0.3, y0: 1.24, y1: 1.98, z: 0.1, labelX: -0.9, labelY: 1.15, labelW: 164, labelH: 100 };
  // Its marks: cyan bars for your hash, amber squares for the difficulty.
  const chartMark = variants((i) => noShadow(bx({ color: ["#5cc8e8", "#f5c542"][i], emissive: [0.5, 0.85][i] })));
  const chartScreen = cached(() => {
    const parts = [
      bx({ w: 2.3, h: 1.1, d: 0.06, color: "#0d1116", emissive: 0.15, offset: { y: 2.9, z: -0.3 } }),
      bx({ w: 2.44, h: 0.08, d: 0.1, color: TIMBER_DARK, offset: { y: 3.47, z: -0.3 } }),
      bx({ w: 2.44, h: 0.08, d: 0.1, color: TIMBER_DARK, offset: { y: 2.33, z: -0.3 } }),
      bx({ w: 0.1, h: 1.2, d: 0.12, color: TIMBER_DARK, offset: { x: -1.19, y: 2.9, z: -0.32 } }),
      bx({ w: 0.1, h: 1.2, d: 0.12, color: TIMBER_DARK, offset: { x: 1.19, y: 2.9, z: -0.32 } })
    ];
    // Grid lines across the plot and the price scale's spine down its right edge.
    for (let k = 0; k < 4; k++) parts.push(bx({ w: CHART.x1 - CHART.x0, h: 0.008, d: 0.005, color: "#1f2a33", emissive: 0.35, offset: { x: (CHART.x0 + CHART.x1) / 2, y: CHART.y0 + k * (CHART.y1 - CHART.y0) / 3, z: -0.265 } }));
    parts.push(bx({ w: 0.01, h: CHART.y1 - CHART.y0 + 0.02, d: 0.005, color: "#3b4a57", emissive: 0.4, offset: { x: CHART.x1 + 0.03, y: (CHART.y0 + CHART.y1) / 2, z: -0.265 } }));
    const geo = merge(...parts);
    geo.castShadow = false;
    return geo;
  });
  // A candle is a unit box scaled into place: green when it closed up, red when it closed down, and a
  // thin pale wick for its high and low.
  const candle = variants((i) => noShadow(bx({ color: ["#22c55e", "#e5533d", "#c9c2b0"][i], emissive: [0.9, 0.9, 0.55][i] })));

  // The rock you crack by hand for bananas: a boulder with yellow veins.
  const crackRock = cached(() => {
    const rock = BL.hubModels.voxelRock(1);
    const veins = [];
    for (const [x, y, z, w, h] of [[0.2, 0.7, 0.9, 0.5, 0.06], [-0.3, 0.45, 0.95, 0.06, 0.4], [0.5, 0.3, 0.8, 0.3, 0.05]]) {
      veins.push(bx({ w, h, d: 0.04, color: BANANA, emissive: 0.8, offset: { x, y, z } }));
    }
    return merge(rock, ...veins);
  });
  const trophyShelf = cached(() => merge(
    bx({ w: 4.4, h: 0.08, d: 0.5, color: TIMBER, offset: { y: 0.94 } }),
    bx({ w: 4.4, h: 0.08, d: 0.5, color: TIMBER, offset: { y: 1.84 } }),
    ...[-2.1, 2.1].map((x) => bx({ w: 0.1, h: 2.2, d: 0.1, color: TIMBER_DARK, offset: { x, y: 1.1 } }))
  ));
  // The trophies, one little thing each, in the catalog's order: the hoodie, the tablets, the power
  // deal's plaque, the crew's three heads, the frosted stone, the glow box, the shaman's charm and the
  // hut on its cloud.
  const TROPHY_BUILDERS = [
    () => merge(bx({ w: 0.44, h: 0.4, d: 0.2, color: "#d8892b", offset: { y: 0.24 } }), bx({ w: 0.2, h: 0.12, d: 0.22, color: "#b36f1f", offset: { y: 0.5 } }), bx({ w: 0.14, h: 0.14, d: 0.02, color: BANANA, emissive: 0.3, offset: { y: 0.26, z: 0.11 } })),
    () => merge(bx({ w: 0.3, h: 0.42, d: 0.06, color: "#8a8178", offset: { x: -0.1, y: 0.21 } }), bx({ w: 0.3, h: 0.36, d: 0.06, color: "#9a9188", offset: { x: 0.12, y: 0.18, z: 0.06 } })),
    () => merge(bx({ w: 0.5, h: 0.5, d: 0.08, color: METAL_DARK, offset: { y: 0.25 } }), ring({ r: 0.18, thickness: 0.03, y: 0.25, segments: 10, color: METAL })),
    () => merge(...[-0.16, 0, 0.16].map((x) => moved(lathe({ profile: [[0.1, 0], [0.1, 0.08], [0.07, 0.14], [0, 0.16]], segments: 7, color: AMBER }), x, 0, 0))),
    () => merge(bx({ w: 0.42, h: 0.16, d: 0.3, color: "#8fa6b8", offset: { y: 0.08 } }), bx({ w: 0.3, h: 0.06, d: 0.2, color: "#dfeef7", emissive: 0.25, offset: { y: 0.19 } })),
    () => merge(bx({ w: 0.36, h: 0.32, d: 0.3, color: "#4a4f55", offset: { y: 0.16 } }), bx({ w: 0.2, h: 0.14, d: 0.02, color: "#7fe0ff", emissive: 0.9, offset: { y: 0.17, z: 0.16 } }), bx({ w: 0.38, h: 0.03, d: 0.32, color: METAL_DARK, offset: { y: 0.33 } })),
    () => merge(bx({ w: 0.05, h: 0.5, d: 0.05, color: TIMBER_DARK, offset: { y: 0.25 } }), bx({ w: 0.16, h: 0.16, d: 0.04, color: "#e0d6c8", offset: { y: 0.5 } }), bx({ w: 0.08, h: 0.2, d: 0.03, color: "#c8262b", offset: { x: 0.1, y: 0.34 } }), bx({ w: 0.08, h: 0.2, d: 0.03, color: "#2458a6", offset: { x: -0.1, y: 0.34 } })),
    () => merge(bx({ w: 0.44, h: 0.1, d: 0.3, color: "#eef3f7", offset: { y: 0.05 } }), bx({ w: 0.26, h: 0.18, d: 0.2, color: TIMBER, offset: { y: 0.19 } }), bx({ w: 0.34, h: 0.08, d: 0.26, color: TIMBER_DARK, offset: { y: 0.32 } }), bx({ w: 0.06, h: 0.06, d: 0.02, color: BANANA, emissive: 0.6, offset: { y: 0.18, z: 0.11 } }))
  ];
  if (TROPHY_BUILDERS.length !== R.TROPHIES.length) throw new Error("mine trophies do not match the catalog");
  const trophy = variants((i) => TROPHY_BUILDERS[i]());

  // A drop target: a flat ring of light where the dragged thing can go. The scene tints it through
  // `highlight` when it is the one the pointer is over.
  const marker = cached(() => noShadow(merge(
    ring({ r: 0.55, thickness: 0.06, y: 0.04, segments: 16, color: BANANA, emissive: 1 }),
    bx({ w: 0.12, h: 0.02, d: 0.12, color: BANANA, emissive: 1, offset: { y: 0.04 } })
  )));
  // A lamp hanging from the ceiling on a chain.
  const lamp = cached(() => noShadow(merge(
    bx({ w: 0.04, h: 0.6, d: 0.04, color: "#2b2521", offset: { y: 0.3 } }),
    bx({ w: 0.34, h: 0.06, d: 0.34, color: "#2b2521" }),
    bx({ w: 0.2, h: 0.2, d: 0.2, color: "#ffd27a", emissive: 1, offset: { y: -0.13 } })
  )));
  // A busbar run overhead in the hall, copper that glows faintly when there is power in it.
  LAYOUT.ROCKS = ROCKS;

  // ---- the ore cart ----
  // A mine cart of glowing ore on four wheels, its origin on the ground under its middle; one stands by the
  // Lightning Factory's switchboard.
  const hubCart = cached(() => merge(
    bx({ w: 1.1, h: 0.62, d: 1.3, color: "#4a4f55", offset: { y: 0.55 } }),
    bx({ w: 1.16, h: 0.06, d: 1.36, color: METAL_DARK, offset: { y: 0.88 } }),
    ...[[-0.42, -0.45], [0.42, -0.45], [-0.42, 0.45], [0.42, 0.45]].map(([x, z]) => moved(turn(ring({ r: 0.16, thickness: 0.05, segments: 10, color: "#2b2d31" }), HALF_PI, HALF_PI), x, 0.2, z)),
    // Ore heaped over the rim, some of it glowing.
    ...[[-0.25, -0.3, "#7fe0ff", 0.7], [0.2, -0.2, STONE_LIGHT, 0], [-0.1, 0.2, "#b58cff", 0.7], [0.3, 0.3, STONE, 0], [0, 0, "#f5c542", 0.7]].map(([x, z, color, emissive]) =>
      bx({ w: 0.36, h: 0.28, d: 0.36, color, emissive, offset: { x, y: 0.98, z } }))
  ));
  const flame = cached(() => BL.hubModels.fireFlame());
  // A charge crystal, the panic power the trader sells by the bag.
  const crystal = cached(() => merge(
    lathe({ profile: [[0, 0], [0.14, 0.12], [0.1, 0.44], [0, 0.56]], segments: 6, color: "#7fe0ff", emissive: 0.8 }),
    moved(lathe({ profile: [[0, 0], [0.09, 0.08], [0.06, 0.3], [0, 0.38]], segments: 6, color: "#b58cff", emissive: 0.7 }), 0.18, 0, 0.05)
  ));

  // A Fire Stopper: a red canister on a wall bracket, its hose looped to the nozzle, facing +z.
  const extinguisher = cached(() => merge(
    bx({ w: 0.14, h: 0.04, d: 0.08, color: METAL_DARK, offset: { y: 0.3, z: -0.06 } }),
    lathe({ profile: [[0, 0], [0.085, 0], [0.09, 0.04], [0.09, 0.4], [0.07, 0.45], [0.03, 0.48], [0, 0.48]], segments: 10, color: "#c8262b" }),
    bx({ w: 0.19, h: 0.05, d: 0.05, color: "#eeeae0", offset: { y: 0.22, z: 0.085 } }),
    bx({ w: 0.05, h: 0.06, d: 0.05, color: "#1b1b1b", offset: { y: 0.5 } }),
    bx({ w: 0.14, h: 0.025, d: 0.03, color: "#1b1b1b", offset: { x: 0.05, y: 0.53 } }),
    bx({ w: 0.03, h: 0.32, d: 0.03, color: "#1b1b1b", offset: { x: 0.11, y: 0.36, z: 0.04 } })
  ));

  // A spare breaker: a small grey box on the wall with its own green lever, facing +z.
  const spareBreaker = cached(() => merge(
    bx({ w: 0.3, h: 0.38, d: 0.1, color: "#5a5f66", offset: { z: -0.03 } }),
    bx({ w: 0.22, h: 0.06, d: 0.02, color: "#eeeae0", offset: { y: 0.12, z: 0.03 } }),
    bx({ w: 0.05, h: 0.14, d: 0.06, color: GREEN, emissive: 0.6, offset: { y: -0.04, z: 0.05 } })
  ));
  // A smoke alarm: a white disc under the ceiling with a red light that the scene blinks.
  const smokeAlarm = cached(() => merge(
    lathe({ profile: [[0, 0], [0.13, 0], [0.13, -0.04], [0.1, -0.07], [0, -0.07]], segments: 12, color: "#e9e6de" }),
    bx({ w: 0.03, h: 0.02, d: 0.03, color: "#ff3b30", emissive: 1.4, offset: { x: 0.05, y: -0.075 } })
  ));

  // The pickaxe an Ooga swings at a rock, gripped at the origin: the haft runs on down the arm (-y) and
  // the two-pointed head crosses its end, so either way round it strikes with a point.
  const pickaxe = cached(() => merge(
    bx({ w: 0.05, h: 0.62, d: 0.05, color: TIMBER, offset: { y: -0.26 } }),
    bx({ w: 0.07, h: 0.08, d: 0.5, color: METAL, offset: { y: -0.57 } }),
    bx({ w: 0.05, h: 0.05, d: 0.12, color: METAL_DARK, offset: { y: -0.57, z: 0.3 } }),
    bx({ w: 0.05, h: 0.05, d: 0.12, color: METAL_DARK, offset: { y: -0.57, z: -0.3 } })
  ));

  // The dressing lanterns of every chamber as x, y, z, chamber quads, for the scene's nearest-lamp choice.
  const dressingLights = cached(() => {
    const out = [];
    CHAMBERS.forEach((c, i) => {
      const l = chamberDressing(i).lights;
      for (let k = 0; k < l.length; k += 4) out.push(l[k], l[k + 1], l[k + 2], i);
    });
    return Float32Array.from(out);
  });
  BL.mineModels = {
    dressingLights,
    LAYOUT, CHART, POOL_CHART, pickaxe, extinguisher, spareBreaker, smokeAlarm, chamberTimber, tunnelFrame, hubCart, chartScreen, candle, chartMark, bayLocal, cave, pebbleBox, shinyRocks, thunderBox, asic, ASIC_LOOKS, rackFrame, coldPool, pad, waterWheel, sunLeaves, steamVent,
    POWER_BUILDERS, skyHole, workbench, shelves, breakerPanel, breakerLever, fanWall, boxFan, FAN_MOUNT, busbarRiser, crystalCell, fanBlade, fanBlur, poolBoard, traderStall,
    priceBoard, crackRock, trophyShelf, trophy, marker, lamp, flame, crystal, seal, chamberDecor
  };
})();
