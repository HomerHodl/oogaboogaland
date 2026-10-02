// The island's window into the Lightning Factory. At the 2 o'clock mouth the shield shows the hall behind it with
// true parallax: `hubWindow`, a light stand-in of the whole hall built once at full size in the hall's frame, is
// pulled every frame along each point's own sight line from the viewer's eye into the DEPTH metres just behind the
// shield (`relief`, one central collineation on that eye). Moving a point along its sight line never moves it on
// screen, so the window draws exactly what a window into the full hall would, in the ordinary pass, and the island's
// own depth masks it. Only the balcony's last half metre before the shield, where an Ooga walks through, stands at
// true size (`front`). The drawn relief is held to the chamber behind the shield (`clipMinY`, `clipMaxY`, `clipSlab`);
// what would land outside it lies in rock and would be hidden anyway.
//
// What moves in it is driven by the page's one factory node (`world.factoryNode`, `BL.factoryFeed.node`), so walking
// in carries on the show the window was showing: sats riding the conduits in along the line a forward came in on and
// out along the one it left by, red ones coming back from a failed forward, the core's surge, the tanks' flashes and
// sputters, the forge's heat, each line where the node has placed it. A live node later feeds that same node.
// WebGL only: the canvas renderer's painter's sort cannot mask it, and the tunnel's dark wall stays its view.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mat4, hexToRgb } = BL.math;
  const { createNode, addChild, removeChild } = BL.scene;
  const FM = BL.factoryModels;
  const { SHIELD_Z, EXIT_Z, LAYOUT, CONDUIT_SAMPLES } = FM;

  // The relief's axis plane in the mouth's frame, half a metre behind the shield where `front` ends, and how far
  // behind it the hall at infinity lands: in front of the tunnel's lamps and dark wall, which stay its backdrop.
  const AXIS = SHIELD_Z - 0.5, DEPTH = 0.8;
  // The shield's glyph crests in the emitters' cyan, the factory's CYAN.
  const TINT = hexToRgb("#5fe3ff").map((k) => k / 255);
  // The window shows while the eye stands in front of the shield, and no farther from the middle of it than FAR.
  const NEAR = 0.05, FAR = 60, MIDDLE = 1.5;
  // How far past the chamber's walls, into the rock either side, the drawn relief may reach.
  const MARGIN = 0.75;
  // As the factory times them: a tank's flash and sputter, the forge's heat; and the coin's flare on a close.
  const FLASH = 0.35, SPUTTER = 0.9, HEAT = 7, FLARE = 0.6;
  // How many sats a forward sends by its bucketed size, as in the hall, and their flags: part of a large forward's
  // stream, of a very large one's, of a failed forward, and the lead sat, whose arrival sets off the surge.
  const SATS_FOR = { dust: 1, small: 1, medium: 2, large: 10, very_large: 18 };
  const BIG = 1, HUGE = 2, FAILED = 4, LEAD = 8;
  // The window's sats at once, and how much larger than the hall's they are drawn, to read at a distance.
  const SAT_CAP = 48, SAT_SIZE = 1.4;
  // How dark a line's tanks go while it is not built.
  const UNBUILT = 0.75;
  const NONE = {};

  // Scratch for the frame: the eye in the mouth's frame, the relief, the hall to the world through it, and one part.
  const EYE = new Float64Array(3);
  const RELIEF = mat4.create(), TMP = mat4.create(), W = mat4.create(), PART = mat4.create(), PLACED = mat4.create();
  const SAT_POS = { x: 0, y: 0, z: 0 }, SAT_ROT = { x: 0, y: 0, z: 0 }, SAT_SCALE = { x: 1, y: 1, z: 1 };
  // Every batch's instance version, counted for the page, so a batch made on a later visit never repeats one its
  // geometry's record has already uploaded.
  let version = 0;

  // The mouth-frame central collineation centred on the eye (ex, ey, ez): the axis plane z = AXIS stays put and the
  // plane at infinity comes to z = AXIS - DEPTH, so every point behind the axis moves along its own sight line into
  // that band, never past the eye. Column-major; its last row is not (0, 0, 0, 1), so what it draws is `projective`.
  const relief = (out, ex, ey, ez) => {
    const c = 1 / (ez - AXIS + DEPTH);
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = -ex * c; out[9] = -ey * c; out[10] = 1 - ez * c; out[11] = -c;
    out[12] = ex * AXIS * c; out[13] = ey * AXIS * c; out[14] = ez * AXIS * c; out[15] = 1 + AXIS * c;
    return out;
  };

  // The stand-in's relieved pieces as one mouth draws them: projective, and clipped to its chamber, from its floor to
  // its roof and across its width with MARGIN into the rock. Made once for the page, so every visit draws the same
  // geometries and one clip slab.
  let clipped = null;
  const clippedFor = (mouth) => {
    if (clipped && clipped.mouth === mouth) return clipped;
    const w = FM.hubWindow(), sr = Math.sin(mouth.ry), cr = Math.cos(mouth.ry), half = mouth.room.w / 2 + MARGIN;
    const clipSlab = new Float32Array([cr / half, 0, -sr / half, -(cr * mouth.x - sr * mouth.z) / half]);
    const clip = (geo) => ({ ...geo, projective: true, clipMinY: mouth.floorY - 0.05, clipMaxY: mouth.floorY + mouth.room.h, clipSlab });
    clipped = {
      mouth, hall: clip(w.hall), chamber: clip(w.chamber), fire: clip(w.fire), sat: clip(w.sat), satRed: clip(w.satRed),
      blueDim: clip(w.tank.blueDim), blueLit: clip(w.tank.blueLit), orangeDim: clip(w.tank.orangeDim), orangeLit: clip(w.tank.orangeLit)
    };
    return clipped;
  };

  // W, the hall's frame to the world through the relief, moved to (x, y, z) in the hall and written at `at`.
  const placeAt = (out, at, x, y, z) => {
    for (let r = 0; r < 4; r++) {
      out[at + r] = W[r];
      out[at + 4 + r] = W[4 + r];
      out[at + 8 + r] = W[8 + r];
      out[at + 12 + r] = W[r] * x + W[4 + r] * y + W[8 + r] * z + W[12 + r];
    }
  };

  // The window at one mouth: `group` is the mouth's group, standing under the island's root, so its own placement is
  // the mouth's frame in the world; `node` is the page's factory node.
  const create = ({ group, mouth, node }) => {
    const stand = FM.hubWindow(), geo = clippedFor(mouth), e = LAYOUT.entrance, paths = stand.paths, tanks = stand.tanks;
    const MOUTH = mat4.fromTRS(mat4.create(), group.position, group.rotation, group.scale), TO_MOUTH = mat4.invert(mat4.create(), MOUTH);
    // The hall's frame to the mouth's: the balcony's floor on the mouth's, its back edge at the shield.
    const HALL = mat4.create();
    HALL[13] = -e.y;
    HALL[14] = -EXIT_Z;
    // Every batch culls as the clip box, the only place any of it draws, which a mirror's capture tests too.
    const sr = Math.sin(mouth.ry), cr = Math.cos(mouth.ry), half = mouth.room.w / 2 + MARGIN, mid = AXIS - DEPTH / 2;
    const sphere = [mouth.x + sr * mid, mouth.floorY + mouth.room.h / 2, mouth.z + cr * mid, Math.hypot(half, mouth.room.h / 2 + 0.05, DEPTH / 2) + 0.1];
    // Every instance glows fully in its baked colours and keeps its own palette in the Matrix (mode 5); the sats are
    // highlighted as the hall's are.
    const batch = (geometry, capacity, highlight = 0) => {
      const data = new Float32Array(capacity * 20);
      for (let i = 0; i < capacity; i++) {
        data[i * 20 + 16] = 1;
        data[i * 20 + 17] = highlight;
        data[i * 20 + 18] = 5;
      }
      return createNode({ geometry, instanceData: data, instanceCount: 0, instanceVersion: version, fixedInstanceCapacity: true, cullSphere: sphere, visible: false });
    };
    const root = createNode({ sightHidden: true, matrixExterior: true, matrixNative: true, visible: false });
    const front = createNode({ geometry: stand.front, position: { x: 0, y: -e.y, z: -EXIT_Z } });
    // A line has one tank of each colour, dim or lit.
    const lines = LAYOUT.bays.length, chamber = batch(geo.chamber, 1), fire = batch(geo.fire, 1), hall = batch(geo.hall, 1);
    const blueLit = batch(geo.blueLit, lines), blueDim = batch(geo.blueDim, lines), orangeLit = batch(geo.orangeLit, lines), orangeDim = batch(geo.orangeDim, lines);
    const gold = batch(geo.sat, SAT_CAP, 0.4), red = batch(geo.satRed, SAT_CAP, 0.4);
    const batches = [chamber, blueLit, blueDim, orangeLit, orangeDim, gold, red, fire, hall];
    // Nearest first, so the hall behind fails the depth test early.
    addChild(root, front, ...batches);
    addChild(group, root);

    // Each featured line's tanks: how built it is, as the hall eases it, and its flash and sputter.
    const bays = node.bays.map((p) => ({ build: p.state === "active" || p.state === "dismantling" ? 1 : 0, flash: 0, sputter: 0 }));
    // The sats on the conduits, as the hall keeps them: `bay` -1 is a free slot, `dir` 1 in toward the core and -1
    // out, `next` the conduit a sat goes on out by, `aim` the line a failed forward was bound for.
    const q = {
      bay: new Int8Array(SAT_CAP).fill(-1), dir: new Int8Array(SAT_CAP), next: new Int8Array(SAT_CAP), aim: new Int8Array(SAT_CAP), flags: new Uint8Array(SAT_CAP),
      t: new Float32Array(SAT_CAP), speed: new Float32Array(SAT_CAP), spin: new Float32Array(SAT_CAP)
    };
    let glow = node.feed.reading.node === "ready" ? 1 : 0, surge = 0, heat = 0, flare = 0, time = 0;

    const launch = (bayIndex, dir, delay, next, flags, aim) => {
      for (let i = 0; i < SAT_CAP; i++) {
        if (q.bay[i] >= 0) continue;
        q.bay[i] = bayIndex;
        q.dir[i] = dir;
        q.t[i] = dir > 0 ? -delay : 1 + delay;
        q.next[i] = next;
        q.aim[i] = aim;
        q.flags[i] = flags;
        q.speed[i] = (flags & BIG ? 0.42 : 0.32) + Math.random() * 0.12;
        q.spin[i] = Math.random() * 6.28;
        return;
      }
    };
    // A forward from the place its line holds (`from`) to the place of the line it left by (`to`, or null), as the
    // hall sends it: in along `from`'s conduit and on out along `to`'s, or back out along `from`'s when it failed;
    // with only `to` featured, out along it at once, a big one surging the core as it goes.
    const forward = (from, to, scale, failed) => {
      const n = SATS_FOR[scale] || 1, big = scale === "large" || scale === "very_large", gap = big ? 0.06 : 0.18;
      const flags = (big ? BIG : 0) | (scale === "very_large" ? HUGE : 0) | (failed ? FAILED : 0);
      const inBay = from && from.bay ? from.index : -1, outBay = to && to.bay ? to.index : -1;
      if (inBay >= 0) {
        bays[inBay].flash = FLASH;
        for (let k = 0; k < n; k++) launch(inBay, 1, k * gap, failed ? inBay : outBay, flags | (k ? 0 : LEAD), failed ? outBay : -1);
      } else if (outBay >= 0 && !failed) {
        for (let k = 0; k < n; k++) launch(outBay, -1, k * gap, -1, flags, -1);
        if (big) surge = flags & HUGE ? 1.5 : 1;
      }
    };
    // Placement is the node's: its listener has already moved it when this one hears the event.
    const onEvent = (ev) => {
      const p = ev.payload || NONE, place = node.at;
      switch (ev.type) {
        case "channel.opening": case "channel.closing": heat = HEAT; break;
        case "channel.active": if (place && place.bay) bays[place.index].flash = FLASH * 2; break;
        case "channel.closed": flare = FLARE; break;
        case "forward.settled": case "forward.failed":
          if (ev.stream !== "replay") forward(place, p.out ? node.indexOf(p.out) : null, p.scale, ev.type === "forward.failed");
          break;
      }
    };
    const unsubscribe = node.feed.subscribe(onEvent);

    // The show runs whether or not the window shows it, a frame at a time, as the hall runs it.
    const step = (dt) => {
      time += dt;
      const state = node.feed.reading.node, want = state === "ready" ? 1 : state === "starting" ? 0.45 + Math.sin(time * 23) * 0.25 : 0;
      glow += (want - glow) * Math.min(1, dt * 3);
      surge = Math.max(0, surge - dt * 0.9);
      heat = Math.max(0, heat - dt);
      flare = Math.max(0, flare - dt);
      for (let i = 0; i < bays.length; i++) {
        const b = bays[i], s = node.bays[i].state;
        if (s === "building") b.build = Math.min(1, b.build + dt / 12);
        else if (s === "dismantling") b.build = Math.max(0.15, b.build - dt / 12);
        else if (s === "active") b.build = Math.min(1, b.build + dt);
        else b.build = Math.max(0, b.build - dt);
        b.flash = Math.max(0, b.flash - dt);
        b.sputter = Math.max(0, b.sputter - dt);
      }
      for (let i = 0; i < SAT_CAP; i++) {
        if (q.bay[i] < 0) continue;
        q.t[i] += dt * q.speed[i] * q.dir[i];
        if (q.dir[i] > 0 && q.t[i] >= 1) {
          if ((q.flags[i] & (BIG | LEAD)) === (BIG | LEAD)) surge = q.flags[i] & HUGE ? 1.5 : 1;
          if (q.aim[i] >= 0) bays[q.aim[i]].sputter = SPUTTER;
          if (q.next[i] < 0) { q.bay[i] = -1; continue; }
          q.bay[i] = q.next[i];
          q.dir[i] = -1;
          q.t[i] = 1;
        } else if (q.dir[i] < 0 && q.t[i] <= 0) {
          const b = bays[q.bay[i]];
          if (q.flags[i] & FAILED) b.sputter = SPUTTER;
          else b.flash = FLASH;
          q.bay[i] = -1;
        }
      }
    };

    // Called once the camera is final for the frame. The projection centre is the eye, set back along the view by the
    // perspective blend's offset when there is one. The window hides with the eye behind or at the shield, past FAR,
    // looking straight down, or with the bird's-eye cutaway or the underground slice showing.
    const update = (dt, camera, opts) => {
      step(dt);
      const P = camera.position, mix = camera.orthoHeight > 0 ? Math.max(0, Math.min(1, camera.orthoMix || 0)) : 0;
      let x = P.x, y = P.y, z = P.z;
      if (mix > 0 && mix <= 0.99) {
        const T = camera.target, fx = T.x - x, fy = T.y - y, fz = T.z - z, back = mix * camera.orthoHeight * 0.5 / Math.tan(camera.fov / 2) / (1 - mix) / (Math.hypot(fx, fy, fz) || 1);
        x -= fx * back; y -= fy * back; z -= fz * back;
      }
      mat4.transformPoint(EYE, TO_MOUTH, x, y, z);
      const ex = EYE[0], ey = EYE[1], ez = EYE[2];
      const shown = mix <= 0.99 && ez - SHIELD_Z > NEAR && Math.hypot(ex, ey - MIDDLE, ez - SHIELD_Z) < FAR && opts.cutawayFade < 1 && opts.cutawayMaxY >= 1e5;
      root.visible = shown;
      if (!shown) return;
      mat4.multiply(TMP, relief(RELIEF, ex, ey, ez), HALL);
      mat4.multiply(W, MOUTH, TMP);
      const running = node.feed.reading.node === "ready" || node.feed.reading.node === "starting";
      hall.instanceData.set(W, 0);
      hall.instanceCount = 1;
      // The core whitens with a surge and goes dark as the node stops; the fire glows while the forge works.
      chamber.instanceData.set(W, 0);
      chamber.instanceData[17] = Math.min(1, surge) - (1 - glow);
      chamber.instanceCount = 1;
      fire.instanceData.set(W, 0);
      fire.instanceData[17] = (heat > 0 ? 0.3 + Math.sin(time * 17) * 0.08 : 0) + flare / FLARE * 0.6;
      fire.instanceCount = 1;
      blueLit.instanceCount = blueDim.instanceCount = orangeLit.instanceCount = orangeDim.instanceCount = 0;
      for (let k = 0; k < tanks.length; k++) {
        const t = tanks[k], b = bays[t.bay];
        const lit = t.blue ? b.flash > 0 && running : b.sputter > 0 && Math.sin(b.sputter * 40) > 0;
        const n = t.blue ? lit ? blueLit : blueDim : lit ? orangeLit : orangeDim, data = n.instanceData, at = n.instanceCount++ * 20;
        placeAt(data, at, t.x, t.y, t.z);
        data[at + 17] = -(1 - b.build) * UNBUILT;
      }
      gold.instanceCount = red.instanceCount = 0;
      for (let i = 0; i < SAT_CAP; i++) {
        if (q.bay[i] < 0 || q.t[i] < 0 || q.t[i] > 1) continue;
        const path = paths[q.bay[i]], u = q.t[i] * CONDUIT_SAMPLES, j = Math.min(CONDUIT_SAMPLES - 1, Math.floor(u)), f = u - j, a = j * 3;
        SAT_POS.x = path[a] + (path[a + 3] - path[a]) * f;
        SAT_POS.y = path[a + 1] + (path[a + 4] - path[a + 1]) * f;
        SAT_POS.z = path[a + 2] + (path[a + 5] - path[a + 2]) * f;
        SAT_ROT.y = q.spin[i] + time * 3;
        SAT_SCALE.x = SAT_SCALE.y = SAT_SCALE.z = ((q.flags[i] & BIG ? 1.12 : 1) + Math.sin(q.t[i] * Math.PI) * 0.2) * SAT_SIZE;
        mat4.multiply(PLACED, W, mat4.fromTRS(PART, SAT_POS, SAT_ROT, SAT_SCALE));
        const n = q.flags[i] & FAILED && q.dir[i] < 0 ? red : gold;
        n.instanceData.set(PLACED, n.instanceCount++ * 20);
      }
      version++;
      for (let i = 0; i < batches.length; i++) {
        const n = batches[i];
        n.instanceVersion = version;
        n.visible = n.instanceCount > 0;
      }
    };

    const dispose = () => {
      unsubscribe();
      root.visible = false;
      removeChild(group, root);
    };
    const debug = {
      node, feed: node.feed, mock: node.mock, bays,
      get shown() { return root.visible; },
      get sats() {
        let n = 0;
        for (let i = 0; i < SAT_CAP; i++) if (q.bay[i] >= 0) n++;
        return n;
      },
      batches: { hall, chamber, fire, blueLit, blueDim, orangeLit, orangeDim, sat: gold, satRed: red }
    };
    return { root, update, dispose, debug };
  };

  BL.factoryWindow = { create, relief, AXIS, DEPTH, TINT };
})();
