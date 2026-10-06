// The Lightning Factory: a Lightning node at work, shown as a factory in a tiered cavern behind the 2 o'clock
// mouth, run by gorillas in hard hats. Everything that moves is driven by the node's event stream through
// `factory-feed.js`; until a real node publishes, `factory-mock.js` plays a demo node, and the entrance says so.
//
// What each station shows, and what it may not (Foundry's consumer rules, docs/lightning-factory.md):
// - The node core glows while the node runs and goes dark when it says it stopped.
// - Four featured lines stand on the main and high levels, each with two capacitors: blue lights on a settled
//   forward, orange sputters on a failed one. A forward's sats ride inside the glass conduits: in along the line it
//   came in on, through the core, and out along the line it left by, when the event names that line (the demo
//   contract's `out`; Foundry's public events name one line only, and then the sats only go in). A failed forward's
//   sats reach the core and come back, glowing red, and the line they were bound for sputters. A large forward is a
//   stream of sats and a surge through the node: the chamber flares white, rings of light climb it and the Tesla
//   coils arc to it.
// - The on-chain forge fires when a line is opened or closed; its bay's lantern turns red while it is taken down. An
//   opening sends carts of sats up the left shaft from the chain for the forge to consume; a close has it mint a coin
//   that rolls back down the right shaft. The carts count the opening's bucketed size, never an amount.
// - The switchboard's screens light with every forward; its board carries the node's own counts and
//   Foundry's hourly summary, which is labelled as Foundry's.
// - The rebalancer spins for a rebalance, and never touches a line.
// - The treasury's gold is the node's public capacity; its belt carries each of the demo node's fees to the crate.
// - The watchtower's beam sweeps while the feed is live and goes dark when it falls silent: that is "no
//   signal", which is not the same as the node stopping.
// - The galleries under the vault hold the lines past the featured four; the study hall is locked for now.
//
// The first view stands on the entrance balcony and looks across at the core, the way the concept frames it.
// Escape, the Leave button and the tunnel behind the balcony all go back to the island.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, game: gameMod, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod } = BL;
  const FM = BL.factoryModels;
  const { clamp, mat4 } = math;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible } = BL.scene;
  const { LAYOUT, LEVEL, HALL, CONDUIT_SAMPLES } = FM;

  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const PITCH = [-0.2, 1.3], DIST = [4, 30];
  const FOLLOW = { y: 0.9, min: 3, max: 7, pitch: [0.25, 0.8] };
  const FLY = { speed: 6, perDist: 0.4, climb: 4, yMax: HALL.h - 3 };
  // The shield across the way out, as wide as the mouth's opening, as on the hub's side; and how far past where the
  // hub took its picture of the island the picture hangs.
  const GATE_OPENING = { minX: -2.5, maxX: 2.5, floorY: 0, ceilingY: 3 }, OUTSIDE_DISTANCE = 34;
  // Paired peer mirrors share their arch coordinates. A half turn carries an
  // incoming walk out of the other face, retaining height and distance crossed.
  const PEER_OPENING = { minX: -2.1, maxX: 2.1, floorY: 0.1, ceilingY: 4.65 }, PEER_PLANE = 0.45, PEER_TINT = [0.3, 0.72, 1];
  const view = (x, y, z, yaw, pitch, dist) => ({ yaw, pitch, dist, target: { x, y, z } });
  const bay = (i, dist = 11) => { const b = LAYOUT.bays[i]; return view(b.x * 0.9, b.y + 2, b.z, b.x < 0 ? 0.55 : -0.55, 0.22, dist); };
  // Where whoever walked in stands: a step inside the gate, facing the core (yaw 0 turns the Ooga to PI), seen over
  // its shoulder looking horizontally across the hall.
  const ARRIVAL = { yaw: 0, pitch: 0, dist: FOLLOW.max, position: { x: 0, y: LAYOUT.entrance.y, z: LAYOUT.entrance.z + 1 } };
  // `entrance` is the balcony's view across the core; the rest frame one station each.
  const PRESETS = {
    entrance: view(0, 9, -6, 0, 0, 33),
    core: view(0, 8, -4, 0.35, 0.12, 15),
    lines: view(0, 8.5, -8, 0, 0.18, 20),
    lineA: bay(0), lineB: bay(1), lineC: bay(2), lineD: bay(3),
    forge: view(0, 2.2, 1.5, 0.75, 0.22, 10),
    switchboard: view(-12, 4, 6, 0.55, 0.22, 9),
    rebalancer: view(14, 4.6, 4.2, -0.8, 0.3, 10),
    treasury: view(13.5, 5, 20, -0.3, 0.25, 10),
    lookout: view(-16, 19, -14, 0.7, 0.15, 14),
    study: view(19, 8.6, 12, -Math.PI / 2 + 0.2, 0.2, 11),
    galleries: view(4, 17, -16, 0, 0.14, 17)
  };
  const RENDER_OPTS = {
    clear: [0.07, 0.05, 0.04], sky: [0.42, 0.3, 0.2], ground: [0.16, 0.11, 0.08],
    direct: [0.6, 0.45, 0.32], directStrength: 0.35, ambientFloor: 0.34,
    sun: { x: 0.25, y: 0.9, z: 0.3 }, shadowCenter: { x: 0, y: 6, z: -4 }, shadowExtent: 30,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, bloomStrength: 0.85,
    // Spotlight: origin/range, unit direction/outer cosine, colour/inner cosine.
    spotLight: new Float32Array(12),
    fog: [0.1, 0.07, 0.05], fogNear: 40, fogFar: 110
  };
  // Seconds a flash, a sputter, the forge's heat and the rebalancer's run last.
  const FLASH = 0.35, SPUTTER = 0.9, HEAT = 7, SPIN = 7;
  // The forge's lines: how many carts an opening sends by its bucketed size, how many can be out at once and how far
  // apart they leave, how many metres a cart takes to go into the fire, and how long the forge spins its sign to mint.
  const CARTS_FOR = { dust: 1, small: 1, medium: 1, large: 2, very_large: 3 }, CART_POOL = 4, CART_GAP = 1.1, CONSUME = 1.4, MINT_SPIN = 1.2;
  const FIRE = { x: LAYOUT.forge.x, y: 0.7, z: LAYOUT.forge.z + 0.4 }, AT = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const SPARKS = ["#ffc83a", "#ff8a1f", "#fff2b8"].map((c) => models.particleGeometry(c, 0.1, 1));
  const SPARKS_CYAN = ["#7fe0ff", "#e8fbff", "#ffe07a"].map((c) => models.particleGeometry(c, 0.1, 1));
  const SURGE_SPARKS = ["#fff2c0", "#ffd27a", "#dffaff"].map((c) => models.particleGeometry(c, 0.1, 1));
  // A point `d` metres along one of the forge's lines, from the bottom of its shaft, into `out`: no allocation.
  const lineAt = (line, d, out) => {
    const f = Math.max(0, Math.min(line.n - 1.001, d / FM.LINE_STEP)), i = Math.floor(f), k = f - i, P = line.pts, a = i * 5, b = a + 5;
    out.x = P[a] + (P[b] - P[a]) * k;
    out.y = P[a + 1] + (P[b + 1] - P[a + 1]) * k;
    out.z = P[a + 2] + (P[b + 2] - P[a + 2]) * k;
    out.yaw = P[a + 3];
    out.pitch = P[a + 4];
    return out;
  };
  // The treasury's belt: how many nuggets ride it at once, and the seconds one takes up it.
  const BELT_CAP = 6, BELT_TIME = 1.8, BELT = FM.TRE.belt;
  // A rebalance's bucketed size, as its board reads it.
  const SIZES = { dust: "Dust", small: "Small", medium: "Medium", large: "Large", very_large: "Very large" };
  const NODE_STATES = { starting: "Starting", ready: "Ready", stopped: "Stopped" };
  const SAT_CAP = 160, GALLERY_N = LAYOUT.galleries.reduce((n, g) => n + g.stations, 0);
  // How many sats a forward sends through its conduits, by its bucketed size, and a sat's flags: part of a large
  // forward's stream, of a very large one's, of a failed forward, and the lead sat, whose arrival sets off the surge.
  const SATS_FOR = { dust: 1, small: 1, medium: 2, large: 10, very_large: 18 };
  const BIG = 1, HUGE = 2, FAILED = 4, LEAD = 8;
  const TIPS = {
    core: ["Node core · this Lightning node", "The node core is the Lightning node itself: lit while it runs, dark when it stops."],
    line: ["Line · a Lightning channel", "Each line is a channel to one peer. Blue flashes when a payment passes through it, orange when one fails."],
    forge: ["On-chain forge · open and close", "Channels are opened and closed with Bitcoin transactions. Opening one feeds the forge carts of sats from the chain; closing one mints a coin that goes back down to it."],
    shaftIn: ["From the chain · opening channels", "Sats come up this shaft from the Bitcoin chain. Each channel the node opens sends carts of them into the forge, more for a bigger channel."],
    shaftOut: ["To the chain · closing channels", "When a channel closes, its sats go back to the Bitcoin chain: the forge mints them into a coin that rolls down this shaft."],
    switchboard: ["Switchboard · routing", "Every payment the node passes on for someone else is a forward. The screens light as they go through."],
    rebalancer: ["Rebalancer · moving liquidity", "Rebalancing moves sats between channels so lines keep working. It is shown by the hour, never for one line."],
    treasury: ["Treasury · routing fees", "The gold under the glass is the node's public capacity, visible to anyone on the Lightning network. Each forward that earns the demo node a fee sends a nugget up the belt into the crate."],
    lookout: ["Watchtower · the node's signal", "The beam sweeps while the node's events are arriving. Dark means no signal: the node may be fine, but nothing is getting through."],
    study: ["Study Hall · locked", "Bananas first! The study hall opens in a later update."],
    tunnel: ["Peer tunnel", "Through here lives the peer at the other end of a line."],
    galleries: ["More channels", "Every line past the featured four stands up in the galleries."],
    exit: ["The way out", "Back to the island."]
  };

  let renderer, game, world, go, root, camera, hud, hooks, input, pilot, fx, agentPlay = null;
  // The page's one factory node (`world.factoryNode`), and its feed and demo node.
  let shared = null, feed = null, mock = null, unsubscribe = null, leaving = false, dust = null;
  // The Ooga the visitor walked in as: one playable actor from the shared crew, and the world it carries.
  let people = null, avatar = null, playerWorld = null;
  let scene = null, greeter = null, greeterPrompt = false;
  const targets = [];
  const SAT_POS = { x: 0, y: 0, z: 0 }, SAT_ROT = { x: 0, y: 0, z: 0 }, SAT_SCALE = { x: 1, y: 1, z: 1 };
  const SAT_M = mat4.create();
  const PEER_ROTATION = math.quat.create();

  // The dressing: crates and coal by the forge, a gauge by the switchboard, and vines over the way
  // out. One set, built once for the page.
  const dressing = models.cached(() => {
    const set = BL.dressing.set(), L = LAYOUT;
    const [c0, c1, c2, c3] = FM.FORGE_STORES;
    set.put("coalCrate", c0[0], 0, c0[1], 1, 1); set.put("coalCrate", c1[0], 0, c1[1], 0, 2);
    set.put("crate", c2[0], 0, c2[1], 0, 0); set.put("crate", c2[0], 0.75, c2[1], 1, 1); set.put("barrel", c3[0], 0, c3[1], 0, 1);
    set.put("gauge", L.switchboard.x + 3.1, L.switchboard.y, L.switchboard.z - 0.4, 0, 0);
    const my = L.entrance.y, mz = FM.EXIT_Z;
    set.put("vine", -3.0, my + 3.5, mz + 1.06, 0, 0);
    set.put("vine", 2.6, my + 3.5, mz + 1.06, 0, 1);
    return set.build();
  });
  // The lanterns, hung as the concept hangs them: big ones on posts at the head of the stairway and lamps on arms
  // at its foot and by the stations, small ones on the rails of the lines, the balcony, the walkway, the core's
  // walkway and the porches, strings of them across the hall and over the way out, and a few on long chains
  // from the vault. A rail lantern stands on one of its rail's posts.
  const lighting = models.cached(() => {
    const L = LAYOUT, e = L.entrance, lamps = [];
    const onRail = (x0, z0, x1, z1, y, fractions) => {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.4) + 1);
      for (const f of fractions) { const k = Math.round(f * (n - 1)) / (n - 1); lamps.push(["rail", x0 + (x1 - x0) * k, y, z0 + (z1 - z0) * k]); }
    };
    const [sx, , foot, , , head, sw] = L.stairway;
    lamps.push(["top", -2.3, e.y, head + 0.5], ["top", 2.3, e.y, head + 0.5], ["post", -2.4, 0, foot - 0.7, 0], ["post", 2.4, 0, foot - 0.7, Math.PI]);
    // Down the stairway's rails, on their posts.
    for (let z = foot + 0.1 + 3; z < head - 1; z += 3) for (const s of [-1, 1]) lamps.push(["rail", sx + s * (sw / 2 + 0.1), e.y * (z - foot) / (head - foot), z]);
    // A lantern from each arm of every line's frame, two from the forge's header, two from each tunnel's.
    for (const b of L.bays) for (const s of [-1, 1]) lamps.push(["hang", FM.stationX(b) + s * 3.05, b.y + 3.88, FM.stationZ(b) - 0.6]);
    for (const s of [-1, 1]) lamps.push(["hang", L.forge.x + s * 3.05, 4.05, L.forge.z + 1.2]);
    for (const t of L.tunnels) for (const s of [-1, 1]) {
      const lx = s * 3.3, lz = 0.8, c = Math.cos(t.turn), sn = Math.sin(t.turn);
      lamps.push(["hang", t.x + lx * c + lz * sn, t.y + 5.9, t.z - lx * sn + lz * c]);
    }
    // Two from the study hall's header, which faces -x.
    for (const [lx, ly, lz] of FM.STUDY.lamps) lamps.push(["hang", L.study.x - lz, L.study.y + ly, L.study.z + lx]);
    lamps.push(["post", L.switchboard.x + 3.1, L.switchboard.y, L.switchboard.z - 1.9, Math.PI]);
    // Two from the arms at the ends of each forge shaft's header.
    for (const [x, z] of FM.SHAFTS) for (const s of [-1, 1]) lamps.push(["hang", x + s * 1.7, 2.76, z - 0.2]);
    // Two from each of the rebalancer's and the treasury's signs.
    for (const [d, spots] of [[L.rebalancer, FM.REB.lamps], [L.treasury, FM.TRE.lamps]]) for (const [x, y, z] of spots) lamps.push(["hang", d.x + x, d.y + y, d.z + z]);
    const [[w0, w1, a0], [s0, , s1]] = L.walk;
    onRail(w0, a0 + 0.1, w1, a0 + 0.1, e.y, [0.2, 0.5, 0.8]);
    onRail(s0 + 0.1, a0, s0 + 0.1, s1, e.y, [0.1, 0.3, 0.5, 0.7, 0.9]);
    onRail(-e.w / 2 + 0.1, e.z - e.d / 2 + 0.1, -e.w / 2 + 0.1, e.z + e.d / 2 - 0.1, e.y, [0.5]);
    const r = L.ring;
    for (const i of [5, 9, 16, 19, 23, 26]) { const a = i / 28 * Math.PI * 2; lamps.push(["rail", r.x + Math.cos(a) * (r.outer - 0.15), r.y - 0.05, r.z + Math.sin(a) * (r.outer - 0.15)]); }
    for (const t of L.tunnels) {
      const [x0, x1, z0, z1] = FM.porchOf(t);
      if (t.turn) onRail(x0, z0 + 0.1, x1, z0 + 0.1, t.y, [0.5]);
      else onRail(x0 + 0.1, z0, x0 + 0.1, z1, t.y, [0.5]);
    }
    for (const s of [-1, 1]) lamps.push(["chain", s * 6, 12.5, 8], ["chain", s * 13, 16.5, 3]);
    const my = e.y, mz = FM.EXIT_Z;
    return FM.lanterns(lamps, [
      [-14, 16, -12, 14, 16, -12, 1.6, [0.2, 0.4, 0.6, 0.8]], [-18, 13.5, -8, 18, 13.5, -8, 1.4, [0.2, 0.35, 0.65, 0.8]],
      [-20, 9, 8, -13, 9, 12, 0.6, [0.5]], [20, 9.5, 5, 13.5, 9, 7, 0.6, [0.5]],
      // Just past the rim, the mouth's own string of lamps, hung where the hub hangs it.
      [-3.05, my + 3.42, mz + 1.1, 3.05, my + 3.42, mz + 1.1, 0.3, [0.3, 0.7]]
    ]);
  });

  // Where a line stands: one of the four featured bays, a gallery stand, or nowhere shown (the overflow count). The
  // shared node places every line (`BL.factoryFeed.node`); this is the hall's bay or stand for one of its places,
  // taking up the line the node has just put there.
  const placeIn = (s, place) => {
    if (!place) return null;
    const mine = place.bay ? s.bays[place.index] : s.gallery[place.index];
    if (!place.line || mine.line === place.line) return mine;
    if (place.bay) return claimBay(s, place.index, place.line);
    if (mine.line) s.placeOf.delete(mine.line);
    mine.line = place.line;
    s.placeOf.set(place.line, mine);
    return mine;
  };
  // A bay takes a line and its labels name the line's peer; with no line they name the bay.
  const claimBay = (s, i, id) => {
    const b = s.bays[i];
    if (b.line) s.placeOf.delete(b.line);
    b.line = id;
    if (id) s.placeOf.set(id, b);
    const channel = mock && mock.snapshot.channels.find((c) => c.id === id);
    setBoard(b.label, `CHANNEL ${b.letter}`, channel ? `Peer: ${channel.peer}` : `Line ${b.letter}`, true);
    setBoard(s.tunnels[i].label, "PEER TUNNEL", channel ? channel.peer : `Line ${b.letter}`, true);
    return b;
  };

  const onEvent = (e) => {
    const s = scene, replay = e.stream === "replay", p = e.payload || {};
    const place = placeIn(s, shared.at);
    switch (e.type) {
      case "channel.opening":
        s.forgeHeat = HEAT;
        if (!replay) s.inQueue += CARTS_FOR[p.scale] || 1;
        if (place && place.bay) {
          place.state = "building";
          place.build = 0;
          nudge(s, place.gorilla);
        }
        nudge(s, s.forgeCrew);
        break;
      case "channel.active":
        if (place && place.bay) {
          place.state = "active";
          if (replay) place.build = 1;
          place.flashL = FLASH * 2;
        }
        break;
      case "channel.closing":
        s.forgeHeat = HEAT;
        if (place && place.bay) { place.state = "dismantling"; nudge(s, place.gorilla); }
        nudge(s, s.forgeCrew);
        break;
      case "channel.closed":
        if (!replay) s.outQueue++;
        if (place) {
          if (place.bay) { place.state = "empty"; place.build = 0; }
          s.placeOf.delete(place.line);
          place.line = null;
        }
        break;
      case "forward.settled":
        if (replay) break;
        s.switchBusy = FLASH;
        if (p.fee) dropNugget(s);
        forward(s, place, p.out ? placeIn(s, shared.indexOf(p.out)) : null, p.scale, false);
        break;
      case "forward.failed":
        if (replay) break;
        forward(s, place, p.out ? placeIn(s, shared.indexOf(p.out)) : null, p.scale, true);
        break;
      case "rebalance.succeeded":
        s.rebScale = p.scale || null;
        s.rebHour = e.bucket.slice(11, 16);
        if (replay) break;
        s.spin = SPIN;
        nudge(s, s.rebalanceCrew);
        break;
      case "rebalance.failed":
        s.rebFailed += p.count || 1;
        break;
    }
    s.dirty = true;
  };
  // A fee's nugget sets off up the treasury's belt; with the belt full, it lands in the crate at once.
  const dropNugget = (s) => {
    for (let i = 0; i < BELT_CAP; i++) {
      if (s.nuggetT[i] >= 0) continue;
      s.nuggetT[i] = 0;
      s.nuggets[i].visible = true;
      return;
    }
    s.hopper = Math.min(1, s.hopper + 0.05);
  };
  // A worker reacts to its station's event with a chest beat, if it is not already busy.
  const nudge = (s, g) => { if (g && !g.agent.driven) g.agent.poke(); };
  // A forward from the line it came in on (`from`) to the line it left by (`to`, or null when the event does not say):
  // its sats ride in along `from`'s conduit to the core and on out along `to`'s, or for a failed forward back out
  // along `from`'s, flashing each featured line as they leave and arrive. A line off the featured four flashes at once
  // in its gallery; with neither featured, the overflow count flashes. A large forward's stream packs its sats close.
  const forward = (s, from, to, scale, failed) => {
    const n = SATS_FOR[scale] || 1, big = scale === "large" || scale === "very_large", gap = big ? 0.06 : 0.18;
    const flags = (big ? BIG : 0) | (scale === "very_large" ? HUGE : 0) | (failed ? FAILED : 0);
    const inBay = from && from.bay ? from.index : -1, outBay = to && to.bay ? to.index : -1;
    if (from) from.flashL = FLASH;
    if (to && !to.bay) to[failed ? "sputter" : "flashL"] = failed ? SPUTTER : FLASH;
    if (!from && !to) s.overflowFlash = FLASH;
    if (inBay >= 0) for (let k = 0; k < n; k++) launchSat(s, inBay, 1, k * gap, failed ? inBay : outBay, flags | (k ? 0 : LEAD), failed ? outBay : -1);
    else if (outBay >= 0 && !failed) {
      for (let k = 0; k < n; k++) launchSat(s, outBay, -1, k * gap, -1, flags, -1);
      if (big) surge(s, flags);
    }
  };
  // A sat set on a conduit, `dir` 1 in toward the core or -1 out from it, `delay` in the conduit's length before it
  // starts; `next` the conduit it goes on out by from the core (-1 none), and `aim` the line a failed forward was
  // bound for, which sputters as the sat reaches the core.
  const launchSat = (s, bayIndex, dir, delay, next, flags, aim) => {
    const q = s.sats;
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
  // A big forward reaching the core: the surge starts, stronger for a very large one, with sparks off the crown.
  const surge = (s, flags) => {
    s.surge = flags & HUGE ? 1.5 : 1;
    s.surgeT = 0;
    const c = LAYOUT.core;
    fx.burst(c.x, c.chamber[1] + 4.4, c.z, flags & HUGE ? 26 : 16, SURGE_SPARKS, 3);
  };

  // A label hung at (x, y, z) under `parent`: the lettered face and the board behind it, which `setBoard` fills.
  const labelNode = (parent, x, y, z, turn = 0) => {
    const node = createNode({ position: { x, y, z }, rotation: { x: 0, y: turn, z: 0 } });
    node.face = createNode();
    node.back = createNode();
    addChild(node, node.back, node.face);
    addChild(parent, node);
    return node;
  };
  // The boards that read the stream: refreshed once a second, and only when their text changes. A board whose
  // reading moves (`keep` false) owns its label and releases it when the next one replaces it.
  const setBoard = (node, title, sub, keep, opts) => {
    const key = `${title}|${sub}`;
    if (node.printed === key) return;
    node.printed = key;
    if (node.owned) {
      renderer.releaseGeometry(node.face.geometry);
      renderer.releaseGeometry(node.back.geometry);
    }
    const l = FM.label(title, sub, { ...opts, keep });
    node.face.geometry = l.face;
    node.back.geometry = l.back;
    node.owned = !keep;
  };
  // A board of numbers, reprinted only when a row changes; it owns its picture and releases the one it replaces.
  const setData = (node, title, rows, width) => {
    const key = title + rows.join("|");
    if (node.printed === key) return;
    node.printed = key;
    if (node.owned) {
      renderer.releaseGeometry(node.face.geometry);
      renderer.releaseGeometry(node.back.geometry);
    }
    const d = FM.dataBoard(title, rows, { width, keep: false });
    node.face.geometry = d.face;
    node.back.geometry = d.back;
    node.owned = true;
  };
  const sats = (n) => n.toLocaleString("en-US");
  const refreshBoards = (s) => {
    const r = feed.reading, signal = feed.signal;
    setBoard(s.lookoutLabel, "WATCHTOWER\nOUTPOST", signal === "live" ? (r.stream === "replay" ? "(Catching Up)" : "(Signal: Live)") : signal === "silent" ? "(No Signal)" : "(Waiting)", true);
    const snap = mock.snapshot;
    // The rebalancer's boards never name a line: a rebalance says only its size and its hour.
    setData(s.rebBoards[0], "LAST REBALANCE", [["Size", s.rebScale ? SIZES[s.rebScale] : "None yet", "count"], ["Hour", s.rebHour ? `${s.rebHour} UTC` : "None yet", "count"], ["Lines", "Private", "plain"]], 1.6);
    setData(s.rebBoards[1], "REBALANCES", [["Done", r.rebalances, "ok"], ["Failed", s.rebFailed, "count"], ["Shown", "By the hour", "plain"]], 1.6);
    let low = Infinity, high = 0;
    for (const c of snap.channels) if (c.active) { low = Math.min(low, c.feePpm); high = Math.max(high, c.feePpm); }
    setData(s.feeBoard, "ROUTING FEES (PUBLIC)", [["Forwards settled", sats(r.settled), "count"], ["Earned a fee", sats(r.fees), "sats"], ["Hour's success", r.summary ? `${Math.round(r.summary.ratio * 100)}%` : "None yet", "ok"]], 1.9);
    setData(s.statsBoard, "NODE STATS (PUBLIC)", [["Channels", r.channels ?? snap.channelCount, "count"], ["Peers", r.peers ?? snap.peerCount, "count"], ["Total capacity", `${sats(snap.capacity)} sats`, "sats"], ["Fee policy", `${low} / ${high} ppm`, "plain"], ["Node", NODE_STATES[r.node] || "Unknown", "ok"]], 1.9);
    const summary = r.summary ? `Foundry hour: ${r.summary.count} fwd, ${Math.round(r.summary.ratio * 100)}% ok` : "(Routing & Forwarding)";
    setBoard(s.switchLabel, "SWITCHBOARD", summary, false);
    const shown = s.placeOf.size, total = r.channels ?? snap.channelCount;
    setBoard(s.galleryLabel, "MORE CHANNELS", `${Math.max(0, total - 4)} lines, ${Math.max(0, total - shown)} not shown`, false);
    // The core names what it is: a demo node on simulated events, until a real node publishes.
    setBoard(s.coreLabel, "NODE CORE", r.node === "stopped" ? "(Node Stopped)" : r.contract === BL.factoryFeed.DEMO ? "(Demo Node, Simulated)" : "(Your LN Node)", true, { height: 1.6 });
  };

  const leaveCave = () => {
    if (leaving) return;
    leaving = true;
    go("hub");
  };
  const onKey = (e) => {
    if ((e.key === "x" || e.key === "X") && !e.repeat && pilot.modeAction("mode-toggle")) return true;
    if ((e.key === "1" || e.key === "2") && pilot.weaponMode(Number(e.key))) return true;
    if (e.key === "g" || e.key === "G") return pilot.weaponAction("weapon-toggle");
    if (e.key === "v" || e.key === "V") return pilot.weaponAction("weapon-fire");
    if (e.key === "Escape") {
      // The guide's open menu swallows Escape first; only with none up does Escape leave the cave.
      if (greeter && greeter.escape()) return true;
      leaveCave();
      return true;
    }
    return false;
  };
  const onDonation = () => {};
  const onLootCleared = () => {};

  const build = () => {
    const L = LAYOUT, s = {
      bays: [], gallery: [], tunnels: [], placeOf: new Map(), crew: [], sats: null,
      forgeHeat: 0, switchBusy: 0, spin: 0, hopper: 0, glow: 0, overflowFlash: 0, beam: 0, dirty: true, refreshAt: 0,
      forgeCrew: null, rebalanceCrew: null, rebScale: null, rebHour: null, rebFailed: 0,
      nuggets: [], nuggetT: new Float32Array(BELT_CAP).fill(-1),
      // The forge's lines: carts waiting to come up and out on the line, coins waiting to be minted and the one rolling,
      // the flash and its rings, the sign's spin, and each shaft's glow.
      carts: [], inQueue: 0, inGap: 0, outQueue: 0, mintT: -1, coinD: -1, coinV: 0, trail: 0,
      flash: 0, flashKind: 0, waveT: -1, signTurn: 0, signPulse: 0, shaftGlow: [0, 0], shafts: [],
      // A big forward's surge through the node, and how long since it began (-1 idle).
      surge: 0, surgeT: -1
    };
    const hall = FM.hall(), cond = FM.conduits();
    s.ceiling = createNode({ geometry: hall.ceiling });
    s.walls = createNode({ geometry: hall.walls });
    addChild(root, s.ceiling, createNode({ geometry: hall.rock }), s.walls, createNode({ geometry: hall.glow, sightHidden: true }), createNode({ geometry: FM.scaffold() }),
      createNode({ geometry: FM.coreBody() }), createNode({ geometry: cond.pipe }), createNode({ geometry: cond.glass, sightHidden: true }), createNode({ geometry: cond.glow }), createNode({ geometry: FM.forge() }));
    // The surge's rings round the chamber and the coils' arcs, hidden until a big forward comes through.
    s.coreRings = [0, 1, 2].map(() => createNode({ position: { x: L.core.x, y: 0, z: L.core.z }, geometry: FM.coreRing(), visible: false, sightHidden: true }));
    s.arcs = FM.teslaArcs().map((shapes) => createNode({ geometry: shapes[0], visible: false, sightHidden: true }));
    addChild(root, ...s.coreRings, ...s.arcs);
    const peer = FM.peerPipes();
    addChild(root, createNode({ geometry: peer.pipe }), createNode({ geometry: peer.glow, sightHidden: true }));
    // Banners of the bolt hung either side of the core from the high lines' decks, as the concept hangs them.
    for (const x of [-12.5, 12.5]) addChild(root, createNode({ position: { x, y: LEVEL.high - 0.45, z: L.bays[0].z + L.bays[0].d / 2 + 0.1 }, geometry: FM.banner(2.2) }));
    s.chamber = createNode({ geometry: FM.coreChamber().lit });
    s.forgeFire = createNode({ geometry: FM.forgeFire().warm });
    s.forgeSign = createNode({ position: { x: L.forge.x, y: FM.FORGE_CY, z: L.forge.z + 0.14 }, geometry: FM.forgeSign().warm });
    s.waves = [0, 1].map(() => createNode({ position: { x: L.forge.x, y: FM.FORGE_CY, z: L.forge.z + 0.6 }, geometry: FM.forgeWave().gold, visible: false, sightHidden: true }));
    for (const [x, z] of FM.COILS) addChild(root, createNode({ position: { x, y: LEVEL.main, z }, geometry: FM.teslaCoil() }));
    addChild(root, s.chamber, s.forgeFire, s.forgeSign, ...s.waves, createNode({ geometry: FM.forgeTrack() }));
    // The forge's shafts, each with its sign, its glow and a target; the carts that come up the left and the coin that
    // goes down the right.
    FM.forgeShafts().forEach((sh, i) => {
      const [x, z] = FM.SHAFTS[i], rock = createNode({ geometry: sh.rock }), glow = createNode({ geometry: sh.glow.dim, sightHidden: true });
      addChild(root, rock, glow, createNode({ geometry: sh.crystals, sightHidden: true }));
      setBoard(labelNode(root, x, 3.62, z - 0.4, Math.PI), i ? "TO THE CHAIN" : "FROM THE CHAIN", i ? "(Closing Channels)" : "(Opening Channels)", true, { height: 0.95 });
      s.shafts.push({ rock, glow });
    });
    for (let i = 0; i < CART_POOL; i++) {
      const node = createNode({ geometry: FM.cart(), visible: false });
      addChild(root, node);
      s.carts.push({ node, active: false, d: 0, v: 0 });
    }
    s.coin = createNode({ geometry: FM.mintCoin(), visible: false });
    addChild(root, s.coin);
    s.coreLabel = labelNode(root, L.core.x, L.core.chamber[1] + 1.1, L.core.z + 3.3);
    setBoard(labelNode(root, L.forge.x, 4.5, L.ring.z + L.ring.outer + 0.8), "ON-CHAIN FORGE", "(Open / Close)", true);
    // Featured bays: frame, two capacitors and a label on a group at the deck's centre.
    const caps = FM.capacitor();
    L.bays.forEach((b, index) => {
      const node = createNode({ position: { x: FM.stationX(b), y: b.y, z: FM.stationZ(b) } });
      const frame = createNode({ geometry: FM.stationFrame() });
      // The blue tank, the peer's side, stands toward the line's tunnel; the orange one, the node's, toward the core.
      const out = Math.sign(b.x);
      const capL = createNode({ position: { x: out * 1.2, y: 0, z: 0 }, geometry: caps.blue.dim });
      const capR = createNode({ position: { x: -out * 1.2, y: 0, z: 0 }, geometry: caps.orange.dim });
      addChild(node, frame, capL, capR);
      const lbl = labelNode(node, 0, 5.1, -0.55);
      // The line's status lantern, under the frame's beam between the tanks.
      const status = createNode({ position: { x: 0, y: 4.0, z: -0.3 }, geometry: FM.statusLantern().alert });
      addChild(node, status);
      addChild(root, node);
      s.bays.push({ bay: true, index, letter: b.letter, node, frame, capL, capR, status, label: lbl, line: null, state: "empty", build: 0, flashL: 0, sputter: 0, gorilla: null });
    });
    // Peer tunnels, each behind its line.
    const tunnels = FM.tunnels();
    L.tunnels.forEach((t, i) => {
      const node = createNode({ position: { x: t.x, y: t.y, z: t.z }, rotation: { x: 0, y: t.turn, z: 0 } });
      const stone = createNode({ geometry: tunnels[i].stone });
      addChild(node, stone, createNode({ geometry: tunnels[i].glow, sightHidden: true }));
      const lbl = labelNode(node, 0, FM.TUNNEL_SIGN.y, FM.TUNNEL_SIGN.z);
      addChild(node, createNode({ position: { x: -(FM.TUNNEL_POST + 0.75), y: 5.9, z: 0.6 }, geometry: FM.banner(2.2) }));
      addChild(root, node);
      // The OBL mirror's exact mesh-section contact atlas highlights the limbs
      // touching this glass, over the peer's own blue reflection.
      const face = createNode({ geometry: FM.peerMirrors()[i], position: { x: 0, y: 0, z: PEER_PLANE }, rippleTint: PEER_TINT, sightHidden: true });
      addChild(node, face);
      const ripples = BL.mirrorRipples.create(face), body = BL.mirrorBody.create(face, new Map());
      const other = L.tunnels[i ^ 1], yaw = other.turn - t.turn + Math.PI, c = Math.cos(yaw), sn = Math.sin(yaw);
      const sx = t.x + Math.sin(t.turn) * PEER_PLANE, sz = t.z + Math.cos(t.turn) * PEER_PLANE;
      const transform = mat4.create();
      transform[0] = transform[10] = c; transform[2] = -sn; transform[8] = sn;
      transform[12] = other.x + Math.sin(other.turn) * PEER_PLANE - sx * c - sz * sn;
      transform[13] = other.y - t.y;
      transform[14] = other.z + Math.cos(other.turn) * PEER_PLANE + sx * sn - sz * c;
      s.tunnels.push({ at: t, node, stone, label: lbl, face, ripples, body, transform, yaw, crossings: 0, hum: Math.random() * 0.3 });
    });
    // Gallery stands along the top decks.
    const gcaps = FM.galleryCaps();
    for (const g of L.galleries) {
      for (let i = 0; i < g.stations; i++) {
        const node = createNode({ position: { x: g.x - g.w / 2 + (i + 0.5) * g.w / g.stations, y: g.y, z: g.z - 0.3 } });
        const caps2 = createNode({ geometry: gcaps.dim }), stand = createNode({ geometry: FM.galleryStation() });
        addChild(node, stand, caps2);
        addChild(root, node);
        s.gallery.push({ bay: false, index: s.gallery.length, node, stand, caps: caps2, line: null, flashL: 0, sputter: 0 });
      }
    }
    s.galleryLabel = labelNode(root, 0, L.LEVEL.top + 4.5, L.HALL.back + 4.9);
    // The switchboard, the rebalancer and the treasury on their decks.
    const sw = L.switchboard, rb = L.rebalancer, tr = L.treasury, lk = L.lookout, st = L.study;
    const switchNode = createNode({ position: { x: sw.x, y: sw.y, z: sw.z } });
    s.screens = createNode({ geometry: FM.switchScreens().calm });
    const switchBody = createNode({ geometry: FM.switchboard() });
    addChild(switchNode, switchBody, s.screens);
    s.switchLabel = labelNode(switchNode, 0, 4.55, -2.1);
    // The rebalancer: its rings spin and its arrows light while a rebalance runs.
    const REB = FM.REB, rebGeo = FM.rebalancerBase(), rebNode = createNode({ position: { x: rb.x, y: rb.y, z: rb.z } });
    s.ring = createNode({ position: { x: 0, y: 0.56, z: REB.cz }, geometry: FM.rebalancerRing().off });
    s.flow = createNode({ geometry: FM.rebalancerFlow().off });
    const rebBody = createNode({ geometry: rebGeo.body });
    addChild(rebNode, rebBody, createNode({ geometry: rebGeo.glow }), s.ring, s.flow);
    for (const [x, z] of REB.crates) addChild(rebNode, createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: x * 0.06, z: 0 }, geometry: FM.goldCrate() }));
    const [rsx, rsy, rsz] = REB.sign, [rbl, rbm, rbr] = REB.boards;
    setBoard(labelNode(rebNode, rsx, rsy, rsz), "REBALANCER", "(Move Liquidity)", true, { height: 1.15 });
    s.rebBoards = [labelNode(rebNode, rbl[0], rbl[1], rbl[2]), labelNode(rebNode, rbr[0], rbr[1], rbr[2])];
    const move = FM.moveBoard(), moveNode = labelNode(rebNode, rbm[0], rbm[1], rbm[2]);
    moveNode.face.geometry = move.face;
    moveNode.back.geometry = move.back;
    // The treasury: the gold under the glass, the crate the belt fills, a cart and a crate of gold, and the belt's
    // nuggets, each hidden until a fee sets it off.
    const TRE = FM.TRE, trGeo = FM.treasuryBody(), trNode = createNode({ position: { x: tr.x, y: tr.y, z: tr.z } });
    s.pile = createNode({ position: { x: 0, y: TRE.top, z: TRE.vz }, geometry: FM.goldPile() });
    s.fill = createNode({ position: { x: TRE.crate[0], y: 0.1, z: TRE.crate[1] }, geometry: FM.hopperFill() });
    const trBody = createNode({ geometry: trGeo.body });
    addChild(trNode, trBody, createNode({ geometry: trGeo.glow }), s.pile, s.fill);
    addChild(trNode, createNode({ position: { x: TRE.cart[0], y: -0.14, z: TRE.cart[1] }, rotation: { x: 0, y: 0.35, z: 0 }, geometry: FM.cart() }));
    for (const [x, z] of TRE.crates) addChild(trNode, createNode({ position: { x, y: 0, z }, geometry: FM.goldCrate() }));
    for (let i = 0; i < BELT_CAP; i++) {
      const n = createNode({ geometry: FM.beltNugget(), position: { x: BELT[0][0], y: BELT[0][1], z: BELT[0][2] }, visible: false });
      s.nuggets.push(n);
      addChild(trNode, n);
    }
    const [tsx, tsy, tsz] = TRE.sign, [tbl, tbr] = TRE.boards;
    setBoard(labelNode(trNode, tsx, tsy, tsz), "TREASURY", "(Routing Fees)", true, { height: 1.15 });
    s.feeBoard = labelNode(trNode, tbl[0], tbl[1], tbl[2]);
    s.statsBoard = labelNode(trNode, tbr[0], tbr[1], tbr[2]);
    // The watchtower on the top deck: tower, lamp and the beam that sweeps round it.
    const lkNode = createNode({ position: { x: lk.x, y: lk.y, z: lk.z } });
    s.lamp = createNode({ position: { x: 0, y: lk.tower + 1, z: 0 }, rotation: { x: 0, y: 0, z: FM.LOOKOUT_BEAM.pitch }, geometry: FM.lookoutLamp().on });
    s.beam = createNode({ geometry: FM.lookoutBeam(), sightHidden: true });
    const optics = FM.lookoutOptics();
    addChild(s.lamp, createNode({ geometry: optics.frame }), createNode({ geometry: optics.lens }), s.beam);
    const lkBody = createNode({ geometry: FM.lookoutTower() });
    addChild(lkNode, lkBody, s.lamp);
    s.lookoutLabel = labelNode(lkNode, 0, 2.6, 2.3);
    // The study hall in the right wall, facing into the hall: locked for now.
    const stNode = createNode({ position: { x: st.x, y: st.y, z: st.z }, rotation: { x: 0, y: -Math.PI / 2, z: 0 } });
    const hallGeo = FM.studyHall();
    const stBody = createNode({ geometry: hallGeo.stone });
    addChild(stNode, stBody, createNode({ geometry: hallGeo.glow }));
    const [sgx, sgy, sgz] = FM.STUDY.sign, [nx, ny, nz, nLean] = FM.STUDY.note, [bx, by, bz, bLean] = FM.STUDY.board;
    setBoard(labelNode(stNode, sgx, sgy, sgz), "STUDY HALL", "", true, { style: "gold", height: 1.6 });
    const note = FM.studyNote(), noteNode = createNode({ position: { x: nx, y: ny, z: nz }, rotation: { x: 0, y: 0, z: nLean } });
    addChild(noteNode, createNode({ geometry: note.back }), createNode({ geometry: note.face }));
    const lesson = FM.studyBoard(), lessonNode = createNode({ position: { x: bx, y: by, z: bz }, rotation: { x: bLean, y: 0, z: 0 } });
    addChild(lessonNode, createNode({ geometry: lesson.back }), createNode({ geometry: lesson.face }));
    addChild(stNode, noteNode, lessonNode);
    addChild(root, switchNode, rebNode, trNode, lkNode, stNode);
    // Sats riding the conduits: one instanced batch of fixed capacity.
    // Two batches: gold sats, and red ones for a failed forward's sats coming back.
    const satGeo = { ...FM.sat() }, redGeo = { ...FM.satFailed() };
    s.satNode = createNode({ geometry: satGeo, instanceData: new Float32Array(SAT_CAP * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true, sightHidden: true });
    s.redNode = createNode({ geometry: redGeo, instanceData: new Float32Array(SAT_CAP * 20), instanceCount: 0, instanceVersion: 0, fixedInstanceCapacity: true, sightHidden: true });
    s.satGeo = satGeo;
    s.redGeo = redGeo;
    addChild(root, s.satNode, s.redNode);
    s.sats = {
      bay: new Int8Array(SAT_CAP).fill(-1), dir: new Int8Array(SAT_CAP), next: new Int8Array(SAT_CAP), aim: new Int8Array(SAT_CAP), flags: new Uint8Array(SAT_CAP),
      t: new Float32Array(SAT_CAP), speed: new Float32Array(SAT_CAP), spin: new Float32Array(SAT_CAP)
    };
    s.paths = cond.paths;
    // Station targets, for tooltips and taps: each on a node that has geometry, since picking needs its bounds.
    const target = (node, kind, preset, radius, extra = {}) => {
      input.add(node, { kind, preset, ...extra }, { radius });
      targets.push(node);
    };
    target(s.chamber, "core", "core", 3.5);
    s.bays.forEach((b, i) => target(b.frame, "line", ["lineA", "lineB", "lineC", "lineD"][i], 3, { place: b }));
    target(s.forgeFire, "forge", "forge", 2.6);
    s.shafts.forEach((sh, i) => target(sh.rock, i ? "shaftOut" : "shaftIn", "forge", 2.6));
    target(switchBody, "switchboard", "switchboard", 3);
    target(rebBody, "rebalancer", "rebalancer", 2.8);
    target(trBody, "treasury", "treasury", 3);
    target(lkBody, "lookout", "lookout", 3.5);
    target(stBody, "study", "study", 3.2);
    s.tunnels.forEach((t, i) => target(t.stone, "tunnel", ["lineA", "lineB", "lineC", "lineD"][i], 3, { place: s.bays[i] }));
    for (const g of s.gallery) target(g.stand, "galleries", "galleries", 1.2);
    // The way out: behind the balcony the tunnel runs on to the rim, the same tunnel the hub dresses its mouth
    // with, and the shield hangs across it at the balcony's back edge, the lab's phase plane humming as the one
    // outside does. Past the rim hangs the picture of the island the hub took on the way in, or with no visit
    // from the hub, the island drawn simply.
    const e = LAYOUT.entrance, tunnel = FM.exitTunnel(), view = world.factoryView;
    const mouth = createNode({ position: { x: 0, y: e.y, z: FM.EXIT_Z } }), exit = createNode({ geometry: tunnel.timber });
    addChild(root, mouth);
    addChild(mouth, createNode({ geometry: tunnel.rock }), exit, createNode({ geometry: tunnel.glow, sightHidden: true }), view
      ? createNode({ geometry: FM.outsideView(view, OUTSIDE_DISTANCE), position: { x: 0, y: 0, z: view.from + OUTSIDE_DISTANCE }, rotation: { x: 0, y: Math.PI, z: 0 }, sightHidden: true })
      : createNode({ geometry: tunnel.outside, sightHidden: true }));
    target(exit, "exit", null, 2.5);
    const gz = HALL.front - 0.6, gateGroup = createNode({ position: { x: 0, y: e.y, z: gz } });
    addChild(root, gateGroup);
    s.gate = { hum: 0, phase: BL.labPhase.create(gateGroup, { x: 0, z: gz, ry: 0, floorY: e.y, room: { w: 5, h: 4, from: 0, to: 6 } }, GATE_OPENING, 0) };
    return s;
  };

  // Gorillas in hard hats, each working its own deck: they pace near their station and beat their chests when
  // something happens there.
  const hireCrew = (s) => {
    const L = LAYOUT, hat = FM.hardHat();
    const worker = (x, y, z, radius, w, d, heading = 0) => {
      const cx = x, cz = z;
      const walkable = (fx, fz, nx, nz) => Math.abs(nx - cx) < w / 2 - 0.5 && Math.abs(nz - cz) < d / 2 - 0.5;
      const agent = BL.agent.create({ groundAt: () => y, walkable, form: "ape", x, z, heading, scale: 0.72 });
      addChild(agent.parts.head, createNode({ position: { x: 0, y: 0.6, z: 0.05 }, geometry: hat }));
      agent.pace(x, z, radius);
      addChild(root, agent.root);
      const g = { agent };
      s.crew.push(g);
      return g;
    };
    s.forgeCrew = worker(-2.4, 0, 4, 1.4, 6, 6, Math.PI);
    worker(2.6, 0, 5, 1.4, 6, 6, Math.PI);
    s.bays.forEach((b, i) => {
      const d = L.bays[i];
      b.gorilla = worker(FM.stationX(d) + (d.x < 0 ? 1.8 : -1.8), d.y, FM.stationZ(d) + 2.1, 0.6, d.w, d.d);
    });
    worker(L.switchboard.x, L.switchboard.y, L.switchboard.z + 0.9, 0.8, L.switchboard.w, L.switchboard.d, Math.PI);
    s.rebalanceCrew = worker(L.rebalancer.x + FM.REB.operator[0], L.rebalancer.y, L.rebalancer.z + FM.REB.operator[1], 0.25, L.rebalancer.w, L.rebalancer.d, Math.PI);
    worker(L.treasury.x + FM.TRE.operator[0], L.treasury.y, L.treasury.z + FM.TRE.operator[1], 0.6, L.treasury.w, L.treasury.d);
    worker(L.lookout.x + 1.8, L.lookout.y, L.lookout.z + 1.6, 0.8, L.lookout.w, L.lookout.d);
  };

  // Point lights, most important first so the lowest tier keeps them: the core, the forge, the four lines, the
  // switchboard, rebalancer, treasury and watchtower. Every other light shares the rest of the slots by nearness to
  // the view (`glowNear`), as the mine shares its lamps: the study, the tunnels, the balcony, the galleries and the
  // daylight at the rim, and every lantern, which throws a wide, soft, warm pool and flickers like a flame.
  const LIGHT = { core: 0, forge: 1, bay: 2, switchboard: 6, rebalancer: 7, treasury: 8, lookout: 9, tess: 10 }, FIXED = 11;
  const lamp = (i, x, y, z, radius, r, g, b) => {
    const o = i * 8, l = RENDER_OPTS.lights;
    l[o] = x; l[o + 1] = y; l[o + 2] = z; l[o + 3] = radius; l[o + 4] = r; l[o + 5] = g; l[o + 6] = b; l[o + 7] = 0;
  };
  const lightUp = () => {
    const L = LAYOUT;
    lamp(LIGHT.core, L.core.x, 8.3, L.core.z + 3.4, 26, 1, 0.62, 0.25);
    lamp(LIGHT.forge, L.forge.x, 1.9, L.forge.z + 1.6, 12, 1, 0.45, 0.15);
    L.bays.forEach((b, i) => lamp(LIGHT.bay + i, FM.stationX(b), b.y + 2.2, b.z + 1.6, 9, 0.55, 0.75, 1));
    lamp(LIGHT.switchboard, L.switchboard.x, L.switchboard.y + 2.2, L.switchboard.z + 0.8, 9, 0.35, 0.6, 1);
    lamp(LIGHT.rebalancer, L.rebalancer.x, L.rebalancer.y + 1.6, L.rebalancer.z + 0.6, 9, 0.35, 0.9, 1);
    lamp(LIGHT.treasury, L.treasury.x, L.treasury.y + 2, L.treasury.z + 1, 9, 1, 0.8, 0.35);
    lamp(LIGHT.lookout, L.lookout.x, L.lookout.y + L.lookout.tower + 1, L.lookout.z, 3, 1, 0.82, 0.45);
    lamp(LIGHT.tess, 0, 0, 0, 0, 0, 0, 0);
    const spot = RENDER_OPTS.spotLight, beam = FM.LOOKOUT_BEAM;
    spot[0] = L.lookout.x; spot[1] = L.lookout.y + L.lookout.tower + 1; spot[2] = L.lookout.z; spot[3] = 0;
    spot[4] = Math.cos(beam.pitch); spot[5] = Math.sin(beam.pitch); spot[6] = 0; spot[7] = Math.cos(beam.outer);
    spot[8] = 12; spot[9] = 9.84; spot[10] = 5.4; spot[11] = Math.cos(beam.inner);
    RENDER_OPTS.lightCount = Math.min(BL.glRenderer.POINT_LIGHT_CAPACITY, FIXED + lightPool().length / 8);
  };
  // The shared lights, [x, y, z, radius, r, g, b, flicker] each: flicker 0 is steady, otherwise the flame's phase.
  const LANTERN_GLOW = [1.3, 0.8, 0.36], LANTERN_REACH = 7.5;
  const lightPool = models.cached(() => {
    const L = LAYOUT, e = L.entrance, out = [];
    out.push(L.study.x + 1, L.study.y + 2.8, L.study.z, 6, 1, 0.75, 0.4, 0);
    L.tunnels.forEach((t, i) => {
      const rgb = math.hexToRgb(FM.TUNNEL_THEMES[i].ring);
      out.push(t.x + Math.sin(t.turn) * 2, t.y + 2.4, t.z + Math.cos(t.turn) * 2, 8, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 0);
    });
    out.push(0, e.y + 2.2, e.z - 4, 12, 1, 0.66, 0.3, 0);
    for (const g of L.galleries) out.push(g.x, g.y + 2, g.z + 1, 10, 1, 0.66, 0.3, 0);
    // Daylight falling in at the rim, so the tunnel's far end is lit the way the island lights it.
    out.push(0, e.y + 2.2, FM.EXIT_Z - 0.6, 9, 1.15, 1.1, 1, 0);
    for (const hung of [lighting().lights, dressing().lights]) {
      for (let i = 0; i < hung.length; i += 4) out.push(hung[i], hung[i + 1], hung[i + 2], LANTERN_REACH, ...LANTERN_GLOW, 1 + (i * 0.37) % 6);
    }
    return new Float32Array(out);
  });
  let poolScore = null;
  // The shared slots go to the lights nearest the view, nearest first, by repeated minimum: no sort, no list.
  const glowNear = (elapsed) => {
    const P = lightPool(), n = P.length / 8, t = pilot.orbit.target, Lt = RENDER_OPTS.lights;
    if (!poolScore) poolScore = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 8, dx = P[o] - t.x, dy = P[o + 1] - t.y, dz = P[o + 2] - t.z;
      poolScore[i] = dx * dx + dy * dy * 2 + dz * dz;
    }
    for (let slot = FIXED; slot < RENDER_OPTS.lightCount; slot++) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < n; i++) if (poolScore[i] < bestD) { bestD = poolScore[i]; best = i; }
      poolScore[best] = Infinity;
      const o = best * 8, f = P[o + 7], k = f ? 0.9 + Math.sin(elapsed * 9.3 + f) * 0.06 + Math.sin(elapsed * 23.7 + f * 3.1) * 0.04 : 1, w = slot * 8;
      Lt[w] = P[o]; Lt[w + 1] = P[o + 1]; Lt[w + 2] = P[o + 2]; Lt[w + 3] = P[o + 3];
      Lt[w + 4] = P[o + 4] * k; Lt[w + 5] = P[o + 5] * k; Lt[w + 6] = P[o + 6] * k; Lt[w + 7] = 0;
    }
  };
  const LIGHT_BASE = new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8);

  // The crew's support and step test on the hall's floor: the highest surface within a step of the feet, clear of
  // what stands there, and never off an edge.
  const groundFor = (x, z, feet) => FM.supportAt(x, z, feet);
  // There is no banana pile in the hall. Space must jump even when the rifle needs ammunition.
  const reloadPolicy = { near: () => false, available: () => false };
  const walkableFor = (ax, az, bx, bz, y, height, actor) => FM.walkable(ax, az, bx, bz, y, actor.bodyRadius || 0.35, height);
  const ceilingFor = (x, z, feet, actor) => FM.stairCeilingAt(x, z, feet, actor.bodyRadius || 0.35);
  // In the air, keep the same obstacle clearance without requiring the floor to be within a step.
  const flyableFor = (ax, az, bx, bz, y, height, actor) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2)), radius = actor.bodyRadius || 0.35;
    for (let i = 1; i <= steps; i++) {
      if (!FM.clearAt(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, y, radius, height,
        ax + (bx - ax) * (i - 1) / steps, az + (bz - az) * (i - 1) / steps)) return false;
    }
    return true;
  };
  const resolveLanding = (actor, x, y, z) => {
    if (actor.ladder && actor.ladder.plane) return;
    const p = actor.root.position, feet = p.y - actor.baseY;
    if (!FM.resolveFall(p, x, z, y - actor.baseY, feet, actor.bodyRadius || 0.35)) return;
    const floor = FM.supportAt(p.x, p.z, feet);
    p.y = actor.baseY + Math.max(feet, floor);
    actor.hop = Math.max(0, feet - floor);
    if (actor.hop === 0 && actor.hopV < 0) actor.hopV = 0;
  };
  // Clip against the nearest shield before scenery behind it, then emit at the actual banana crossing.
  // Both paths reuse the mirrors' cached transforms and fixed ripple pools.
  const clipProjectileTarget = (from, to) => {
    let clipped = scene.gate.phase.ripples.absorb(from.x, from.y, from.z, to);
    for (const t of scene.tunnels) if (t.ripples.absorb(from.x, from.y, from.z, to)) clipped = true;
    return clipped;
  };
  const absorbProjectile = (ax, ay, az, point, dt) => {
    const gate = scene.gate.phase.ripples, bx = point.x, by = point.y, bz = point.z;
    let hit = gate.absorb(ax, ay, az, point) ? gate : null;
    for (const t of scene.tunnels) {
      if (t.ripples.absorb(ax, ay, az, point)) hit = t.ripples;
    }
    return !!hit && hit.cross(ax, ay, az, bx, by, bz, dt);
  };
  const feetOf = () => avatar ? avatar.root.position.y - avatar.baseY : 0;
  const peerPassage = (p) => {
    for (const t of LAYOUT.tunnels) {
      const dx = p.x - t.x, dz = p.z - t.z, c = Math.cos(t.turn), sn = Math.sin(t.turn);
      const across = dx * c - dz * sn, along = dx * sn + dz * c;
      if (Math.abs(across) < PEER_OPENING.maxX && along >= -0.5 && along <= 2.5
        && p.y >= t.y && p.y <= t.y + PEER_OPENING.ceilingY) return true;
    }
    return false;
  };

  const enter = (ctx) => {
    ({ renderer, game, world, go, agentPlay } = ctx);
    camera = createCamera({ fov: 55, near: 0.3, far: 150 });
    root = createNode();
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: ctx.lootEnabled });
    hud.setAreaLabel("LF");
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    const clampTarget = (p) => {
      if (peerPassage(p)) return;
      p.x = clamp(p.x, -HALL.halfW + 3, HALL.halfW - 3);
      p.y = clamp(p.y, 0.5, HALL.h - 3);
      p.z = clamp(p.z, HALL.back + 2.5, HALL.front - 2);
    };
    // Out of the walls, which lean in as they rise; only the tunnel out lets the eye nearer the front.
    const clampCamera = (p) => {
      if (peerPassage(p)) return;
      p.y = clamp(p.y, 0.6, HALL.h - 2);
      const lean = p.y / HALL.h * FM.WALL_LEAN;
      p.x = clamp(p.x, -HALL.halfW + 2 + lean, HALL.halfW - 2 - lean);
      p.z = clamp(p.z, HALL.back + 2 + lean, HALL.front - (Math.abs(p.x) < 6 ? 1.2 : 2 + lean));
    };
    pilot = pilotMod.create({
      renderer, canvas: ctx.canvas, camera, hud, presets: PRESETS, landing: "entrance", pitch: PITCH, dist: DIST,
      follow: FOLLOW, fly: FLY, clampTarget, clampCamera, ceilingAt: () => HALL.h - 2, coarse: COARSE,
      close: { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 4, orbitDist: 5, maxStep: 0.6, groundAt: (x, z) => FM.supportAt(x, z, feetOf()) }
    });
    const tipFor = (hit) => {
      const o = hit.owner, tip = TIPS[o.kind];
      if (o.kind === "greeter") return COARSE ? `${BL.factoryGreeter.NAME} the guide · tap to talk` : `${BL.factoryGreeter.NAME} the guide · Space to talk`;
      if (o.kind === "line" || o.kind === "tunnel") {
        const b = o.place, c = b.line && mock.snapshot.channels.find((ch) => ch.id === b.line);
        return o.kind === "line" ? `Channel ${b.letter}${c ? ` · peer ${c.peer}` : ""}` : `Peer tunnel${c ? ` · ${c.peer}` : ""}`;
      }
      return tip ? tip[0] : "";
    };
    Object.assign(hooks, {
      onHover: (hit, p) => {
        if (hit) hud.tooltip.show(tipFor(hit), p.x, p.y);
        else hud.tooltip.hide();
      },
      onHoverMove: (hit, p) => hud.tooltip.show(tipFor(hit), p.x, p.y),
      onTap: (hit) => {
        if (!hit) return;
        const o = hit.owner;
        if (o.kind === "exit") return leaveCave();
        if (o.kind === "greeter") return greeter.greet();
        if (o.preset) pilot.goPreset(o.preset);
        const tip = TIPS[o.kind];
        if (tip) hud.toast(tip[1]);
      },
      ...pilot.hooks
    });
    hud.onPreset(pilot.goPreset);
    hud.onAction((action) => {
      if (action === "leave") leaveCave();
      else if (action === "reset-view") pilot.goPreset("entrance");
      else if (action === "act") { if (!greeter || !greeter.act()) pilot.action(); }
      else if (action.startsWith("mode-")) pilot.modeAction(action);
      else if (action.startsWith("weapon-") || action === "magazine-swap") pilot.weaponAction(action);
    });
    fx = fxMod.create({ root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: { x: 0, y: 14, z: -4 } });
    dust = BL.dressing.motes({ count: 240, span: 22, low: 0.5, high: 16 });
    addChild(root, dust.node);
    const dressed = dressing(), lit = lighting();
    addChild(root, ...BL.dressing.nodes(dressed, { glow: 1 }), createNode({ geometry: lit.frame }), createNode({ geometry: lit.glass, sightHidden: true }));
    scene = build();
    hireCrew(scene);
    // Whoever walked in stays themselves: their Ooga stands on the balcony facing the core, under the visitor's
    // control. A page that opens here takes `character=` instead, as the island does. With nobody, the view stays
    // free.
    const asked = ctx.from === null ? new URLSearchParams(location.search).get("character")?.trim().toLowerCase() : null;
    const named = asked ? contributors.roster.find((c) => c.name.toLowerCase() === asked) : null;
    const playerName = named ? named.name : world.pilot && contributors.roster.some((c) => c.name === world.pilot) ? world.pilot : null;
    world.pilot = null;
    if (playerName) {
      // Keep the visitor's weapons and magazines across the doorway. The
      // factory has no banana pile, so its private pile level stays zero.
      playerWorld = { level: 0, weapons: world.weapons, magazine: world.magazine };
      const shared = { root, input, hud, game, world: playerWorld, playerName, fx, viewYaw: 0, groundAt: groundFor, walkable: walkableFor, flyable: flyableFor, ceilingAt: ceilingFor, ladders: LAYOUT.ladders, onBodyMove: resolveLanding, clipProjectileTarget, absorbProjectile, reloadPolicy, useNear: (x, z, reach) => {
        // Space talks to the guide only within arm's reach; further away it stays a jump.
        const p = greeter && greeter.root.position;
        return !!p && Math.hypot(x - p.x, z - p.z) <= reach ? greeter.act() : false;
      } };
      shared.onModelChange = () => {
        if (!avatar) return;
        scene.gate.phase.body.refresh(avatar.root);
        for (const t of scene.tunnels) t.body.refresh(avatar.root);
      };
      people = shared.crew = BL.crew.create(shared);
      world.weapons = playerWorld.weapons;
      world.magazine = playerWorld.magazine;
      pilot.bind(shared);
      avatar = people.cavemen.get(playerName);
      pilot.possess(avatar);
      people.selectWeapon(avatar.weapon.selectedSlot, avatar);
      // An arrival, as on the island: the Ooga stands a step inside the gate facing the core and the view starts
      // settled over its shoulder, never sweeping in from wherever the new camera began.
      pilot.navigate(ARRIVAL);
      scene.gate.phase.body.track(avatar.root, avatar.traits.height * 2, Math.max(avatar.headOpen.verts.length, avatar.headClosed.verts.length));
      for (const t of scene.tunnels) t.body.track(avatar.root, avatar.traits.height * 2, Math.max(avatar.headOpen.verts.length, avatar.headClosed.verts.length));
    }
    lightUp();
    LIGHT_BASE.set(RENDER_OPTS.lights);

    // The page's one factory node: the show the island's window was showing goes on in here, with every line
    // standing where the node has placed it.
    shared = BL.factoryFeed.node(world);
    feed = shared.feed;
    mock = shared.mock;
    shared.bays.forEach((p, i) => {
      const b = claimBay(scene, i, p.line);
      b.state = p.state;
      b.build = p.state === "active" || p.state === "dismantling" ? 1 : 0;
    });
    shared.stands.forEach((p) => placeIn(scene, p));
    unsubscribe = feed.subscribe(onEvent);
    refreshBoards(scene);
    leaving = false;
    greeterPrompt = false;
    greeter = BL.factoryGreeter.create({ parent: root, input, fx, feed,
      visitor: () => people && people.player === avatar ? avatar : null,
      demoRunning: () => feed.reading.contract === "obl.factory.demo.v1" || feed.reading.contract === null && !!shared.mock, coarse: COARSE, camera, quality: () => renderer.quality });
    // With no Ooga the visitor cannot talk to the guide: a hint points them to the island to pick one.
    if (!avatar) hud.hint(`${BL.factoryGreeter.NAME} the guide gives tours here — pick an Ooga on the island first`);

    factoryScene.root = root;
    factoryScene.camera = camera;
    factoryScene.input = input;
    factoryScene.debug = {
      hud, camera, controls: pilot.controls, pilot, crew: people, cavemen: people ? people.cavemen : null,
      factory: { node: shared, feed, mock, greeter, get scene() { return scene; }, simulate(seconds, dt = 1 / 30) { for (let t = 0; t < seconds; t += dt) shared.tick(dt); } }
    };
  };

  // Cross only the actual glass plane, using the movement segment so a long
  // step retains its overshoot. Emerging points face out and cannot bounce back
  // until the player turns and physically crosses the destination again.
  const peerPortal = (s, previousX, previousY, previousZ) => {
    if (people.player !== avatar) return;
    const p = avatar.root.position;
    for (let i = 0; i < s.tunnels.length; i++) {
      const t = s.tunnels[i], at = t.at, c = Math.cos(at.turn), sn = Math.sin(at.turn), dx = p.x - at.x, dz = p.z - at.z;
      const px = previousX - at.x, pz = previousZ - at.z;
      const from = px * sn + pz * c - PEER_PLANE, to = dx * sn + dz * c - PEER_PLANE;
      if (from < -1e-7 || to > 0 || from - to < 1e-8) continue;
      const fraction = from / (from - to), across = (px + (dx - px) * fraction) * c - (pz + (dz - pz) * fraction) * sn;
      const feet = previousY + (p.y - previousY) * fraction - avatar.baseY - at.y;
      if (across < PEER_OPENING.minX || across > PEER_OPENING.maxX || feet < PEER_OPENING.floorY - 0.12 || feet + avatar.bodyHeight > PEER_OPENING.ceilingY) continue;
      const m = t.transform, x = p.x, z = p.z, vx = avatar.leap.vx, vz = avatar.leap.vz;
      p.x = m[0] * x + m[8] * z + m[12]; p.y += m[13]; p.z = m[2] * x + m[10] * z + m[14];
      avatar.root.rotation.y += t.yaw;
      if (avatar.root.quaternion) {
        math.quat.fromEuler(PEER_ROTATION, 0, t.yaw, 0);
        math.quat.multiply(avatar.root.quaternion, PEER_ROTATION, avatar.root.quaternion);
      }
      avatar.leap.vx = m[0] * vx + m[8] * vz; avatar.leap.vz = m[2] * vx + m[10] * vz;
      pilot.transformView(m, t.yaw);
      t.crossings++;
      return;
    }
  };

  // Per frame, allocation-free: the stream, then every animated part eased toward what it last heard.
  // The forge's lines, a frame at a time. A queued cart comes up the left shaft once the last is clear of it, rolls
  // out and down the track, slows at the forge and goes into the fire, shrinking as it goes; the forge takes it with
  // a flash: its sign turns once, white, the light flares and two gold rings run out over the arch in a spray of
  // sparks. A queued coin is minted first: the sign spins three times, then the coin rolls out of the fire on a cyan
  // flash and away down the right line, trailing sparks, into its shaft, which lights as it goes.
  const forgeLines = (s, dt) => {
    const [inLine, outLine] = FM.forgeLines(), waves = FM.forgeWave();
    s.inGap -= dt;
    for (let i = 0; i < s.carts.length && s.inQueue > 0 && s.inGap <= 0; i++) {
      const c = s.carts[i];
      if (c.active) continue;
      c.active = true;
      c.d = 0;
      c.v = 0.6;
      c.node.visible = true;
      s.inQueue--;
      s.inGap = CART_GAP;
      s.shaftGlow[0] = 1;
    }
    for (let i = 0; i < s.carts.length; i++) {
      const c = s.carts[i];
      if (!c.active) continue;
      const left = inLine.length - c.d;
      c.v += Math.max(-2 * dt, Math.min(2 * dt, (left < 3 ? 1.3 : 2.4) - c.v));
      c.d += c.v * dt;
      if (c.d >= inLine.length) {
        c.active = false;
        c.node.visible = false;
        forgeFlash(s, 0, waves.gold, SPARKS);
        continue;
      }
      lineAt(inLine, c.d, AT);
      const k = Math.min(1, (inLine.length - c.d) / CONSUME), e = k * k * (3 - 2 * k), n = c.node;
      n.position.x = FIRE.x + (AT.x - FIRE.x) * e;
      n.position.y = FIRE.y + (AT.y - FIRE.y) * e;
      n.position.z = FIRE.z + (AT.z - FIRE.z) * e;
      n.rotation.y = AT.yaw;
      n.rotation.x = -AT.pitch;
      n.scale.x = n.scale.y = n.scale.z = 0.1 + 0.9 * e;
    }
    if (s.outQueue > 0 && s.mintT < 0 && s.coinD < 0) {
      s.outQueue--;
      s.mintT = 0;
      s.signTurn += Math.PI * 6;
      s.signPulse = 1;
    }
    if (s.mintT >= 0 && (s.mintT += dt) >= MINT_SPIN) {
      s.mintT = -1;
      s.coinD = 0;
      s.coinV = 0.3;
      s.coin.visible = true;
      forgeFlash(s, 1, waves.cyan, SPARKS_CYAN);
    }
    if (s.coinD >= 0) {
      s.coinV = Math.min(2.1, s.coinV + 1.6 * dt);
      s.coinD += s.coinV * dt;
      const d = outLine.length - s.coinD, c = s.coin;
      if (d <= 0) {
        s.coinD = -1;
        c.visible = false;
      } else {
        lineAt(outLine, d, AT);
        const k = Math.min(1, 0.2 + s.coinD / 0.9);
        c.position.x = AT.x;
        c.position.y = AT.y + (FM.COIN_R + 0.14) * k;
        c.position.z = AT.z;
        c.rotation.y = AT.yaw + Math.PI;
        c.rotation.x += s.coinV * dt / FM.COIN_R;
        c.scale.x = c.scale.y = c.scale.z = k;
        if (d < 4) s.shaftGlow[1] = 1;
        if ((s.trail -= dt) <= 0 && AT.y > -0.3) {
          s.trail = 0.06;
          fx.spawnParticle(SPARKS[s.coinD * 7 % 3 | 0], AT.x, 0.2, AT.z, (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6, 0.7, 5, 2.5);
        }
      }
    }
    // The sign turns off what it owes, fastest at the start, and swells with a flash.
    const sign = s.forgeSign, fs = FM.forgeSign(), turn = Math.min(s.signTurn, dt * (3 + s.signTurn * 2.2));
    s.signTurn -= turn;
    sign.rotation.y = (sign.rotation.y + turn) % (Math.PI * 2);
    s.signPulse = Math.max(0, s.signPulse - dt * 1.5);
    sign.scale.x = sign.scale.y = sign.scale.z = 1 + 0.3 * Math.sin(s.signPulse * Math.PI);
    const signGeo = s.flash > 0.25 || s.mintT >= 0 ? fs.white : s.forgeHeat > 0 ? fs.hot : fs.warm;
    if (sign.geometry !== signGeo) sign.geometry = signGeo;
    if (s.waveT >= 0) {
      s.waveT += dt;
      for (let i = 0; i < s.waves.length; i++) {
        const p = (s.waveT - i * 0.16) / 0.6, w = s.waves[i];
        w.visible = p > 0 && p < 1;
        if (!w.visible) continue;
        const r = 1.95 + 1.25 * (1 - (1 - p) * (1 - p));
        w.scale.x = w.scale.y = r;
        w.scale.z = 1 - p * 0.6;
      }
      if (s.waveT > 0.8) s.waveT = -1;
    }
    s.flash = Math.max(0, s.flash - dt * 1.3);
    for (let i = 0; i < s.shafts.length; i++) {
      s.shaftGlow[i] = Math.max(0, s.shaftGlow[i] - dt * 0.8);
      const sh = FM.forgeShafts()[i].glow, geo = s.shaftGlow[i] > 0.2 ? sh.bright : sh.dim;
      if (s.shafts[i].glow.geometry !== geo) s.shafts[i].glow.geometry = geo;
    }
  };
  // The surge, a frame at a time: three rings of light climb the chamber one after another, swelling as they go, and
  // each coil's arc flickers between its shapes, while the surge fades.
  const surgeFrame = (s, dt) => {
    if (s.surgeT < 0) return;
    s.surgeT += dt;
    s.surge = Math.max(0, s.surge - dt * 0.9);
    const [lo, hi] = LAYOUT.core.chamber;
    for (let i = 0; i < s.coreRings.length; i++) {
      const p = (s.surgeT - i * 0.2) / 0.9, r = s.coreRings[i];
      r.visible = p > 0 && p < 1;
      if (!r.visible) continue;
      r.position.y = lo - 0.2 + (hi - lo + 0.8) * p * (2 - p);
      r.scale.x = r.scale.z = 1 + 0.12 * Math.sin(p * Math.PI);
      r.scale.y = 1 + 0.6 * (1 - p);
    }
    const arcs = FM.teslaArcs(), live = s.surgeT < (s.surge > 1 ? 1.5 : 1.1);
    for (let i = 0; i < s.arcs.length; i++) {
      const a = s.arcs[i], k = Math.floor(s.surgeT / 0.06 + i) % 3;
      a.visible = live && k !== 2;
      if (a.geometry !== arcs[i][k]) a.geometry = arcs[i][k];
    }
    if (s.surgeT > 1.6) {
      s.surgeT = -1;
      for (let i = 0; i < s.arcs.length; i++) s.arcs[i].visible = false;
    }
  };
  // The forge taking a cart (kind 0, gold) or minting a coin (kind 1, cyan).
  const forgeFlash = (s, kind, wave, sparks) => {
    s.flash = 1;
    s.flashKind = kind;
    s.waveT = 0;
    s.signPulse = 1;
    if (!kind) s.signTurn += Math.PI * 2;
    for (let i = 0; i < s.waves.length; i++) s.waves[i].geometry = wave;
    fx.burst(FIRE.x, 1.3, LAYOUT.forge.z + 1.2, 18, sparks, 3.2);
  };

  const update = (dt, elapsed) => {
    const s = scene;
    const previousX = avatar ? avatar.root.position.x : 0, previousY = avatar ? avatar.root.position.y : 0, previousZ = avatar ? avatar.root.position.z : 0;
    pilot.readInput(dt);
    if (people) people.update(dt, elapsed);
    pilot.update(dt);
    // Cut the vault and inward-leaning walls away so the outer decks stay visible.
    // Restore them only after the birdseye blend fully returns, including reversals.
    s.ceiling.visible = s.walls.visible = !pilot.birdsEye && pilot.birdsEyeMix === 0;
    // The gate's shield hums, and shows the outline of whoever walks through it.
    const g = s.gate;
    g.phase.update(dt, elapsed);
    g.phase.body.update(dt);
    g.phase.body.time = g.phase.ripples.time;
    g.hum -= dt;
    if (g.hum <= 0) {
      g.hum = 0.1 + Math.random() * 0.22;
      g.phase.ripples.pulse(GATE_OPENING.minX + Math.random() * (GATE_OPENING.maxX - GATE_OPENING.minX), Math.random() * GATE_OPENING.ceilingY, 0);
    }
    // The peer tunnels' shields hum in their blue.
    for (let i = 0; i < s.tunnels.length; i++) {
      const t = s.tunnels[i];
      t.ripples.update(dt, elapsed);
      t.body.update(dt);
      t.body.time = t.ripples.time;
      t.hum -= dt;
      if (t.hum <= 0) {
        t.hum = 0.16 + Math.random() * 0.3;
        t.ripples.pulse(PEER_OPENING.minX + Math.random() * (PEER_OPENING.maxX - PEER_OPENING.minX), PEER_OPENING.floorY + Math.random() * (PEER_OPENING.ceilingY - PEER_OPENING.floorY), 0);
      }
    }
    shared.tick(dt);
    dust.update(elapsed, pilot.orbit.target.x, pilot.orbit.target.z);
    for (let i = 0; i < s.crew.length; i++) s.crew[i].agent.update(dt);
    // Out through the gate: walked into it, or flown into it with the free view.
    if (!leaving) {
      const p = avatar ? avatar.root.position : camera.position, y = p.y - (avatar ? avatar.baseY : 0) - LAYOUT.entrance.y;
      const inOpening = p.x >= GATE_OPENING.minX && p.x <= GATE_OPENING.maxX && y >= GATE_OPENING.floorY - 0.12 && y < GATE_OPENING.ceilingY;
      if (avatar) {
        if (inOpening && p.z > HALL.front - 1.3) leaveCave();
        else peerPortal(s, previousX, previousY, previousZ);
      } else {
        const a = pilot.controls.read();
        if (inOpening && Math.hypot(a.x, a.y) > 0.05 && p.z > HALL.front - 2.2) leaveCave();
      }
    }
    const node = feed.reading.node, signal = feed.signal, running = node === "ready" || node === "starting";
    // The core: eased toward lit while the node runs, flickering as it starts, dark when it has stopped.
    const want = node === "ready" ? 1 : node === "starting" ? 0.45 + Math.sin(elapsed * 23) * 0.25 : 0;
    s.glow += (want - s.glow) * Math.min(1, dt * 3);
    const cc = FM.coreChamber(), chamberGeo = s.glow > 0.35 ? s.surge > 0.45 ? cc.surge : cc.lit : cc.dark;
    if (s.chamber.geometry !== chamberGeo) s.chamber.geometry = chamberGeo;
    surgeFrame(s, dt);
    glowNear(elapsed);
    const L = RENDER_OPTS.lights, B = LIGHT_BASE;
    const pulse = 0.85 + Math.sin(elapsed * 2.1) * 0.08, co = LIGHT.core * 8, white = Math.min(1, s.surge);
    for (let k = 4; k < 7; k++) L[co + k] = (B[co + k] * (1 - white * 0.5) + white * 0.5) * (0.12 + s.glow * pulse + s.surge * 2.2);
    // The forge: hot while a line is opened or closed; carts come up to it and coins go down from it.
    s.forgeHeat = Math.max(0, s.forgeHeat - dt);
    const ff = FM.forgeFire(), fire = s.forgeHeat > 0 || s.flash > 0 ? ff.hot : ff.warm;
    if (s.forgeFire.geometry !== fire) s.forgeFire.geometry = fire;
    forgeLines(s, dt);
    const fo = LIGHT.forge * 8, cool = s.flashKind === 1 ? s.flash : 0, heat = (s.forgeHeat > 0 ? 1.4 + Math.sin(elapsed * 17) * 0.2 : 0.7) + 2.6 * s.flash;
    L[fo + 4] = (B[fo + 4] * (1 - cool) + 0.4 * cool) * heat;
    L[fo + 5] = (B[fo + 5] * (1 - cool) + 0.85 * cool) * heat;
    L[fo + 6] = (B[fo + 6] * (1 - cool) + cool) * heat;
    // The featured lines: their stations always stand; a line being built or taken down shows in its status lantern and
    // its light, and its capacitors flash and sputter.
    const caps = FM.capacitor(), statusLit = FM.statusLantern();
    for (let i = 0; i < s.bays.length; i++) {
      const b = s.bays[i];
      if (b.state === "building") b.build = Math.min(1, b.build + dt / 12);
      else if (b.state === "dismantling") b.build = Math.max(0.15, b.build - dt / 12);
      else if (b.state === "active") b.build = Math.min(1, b.build + dt);
      else b.build = Math.max(0, b.build - dt);
      const k = b.build;
      b.flashL = Math.max(0, b.flashL - dt);
      b.sputter = Math.max(0, b.sputter - dt);
      const blue = b.flashL > 0 && running ? caps.blue.lit : caps.blue.dim;
      const orange = b.sputter > 0 && Math.sin(b.sputter * 40) > 0 ? caps.orange.lit : caps.orange.dim;
      if (b.capL.geometry !== blue) b.capL.geometry = blue;
      if (b.capR.geometry !== orange) b.capR.geometry = orange;
      const status = b.state === "active" || b.state === "building" ? statusLit.ok : statusLit.alert;
      if (b.status.geometry !== status) b.status.geometry = status;
      const o = (LIGHT.bay + i) * 8, boost = (b.flashL > 0 ? 1.6 : 0.6) * (0.2 + 0.8 * k);
      for (let c = 4; c < 7; c++) L[o + c] = B[o + c] * boost;
    }
    const gc = FM.galleryCaps();
    for (let i = 0; i < s.gallery.length; i++) {
      const g = s.gallery[i];
      g.flashL = Math.max(0, g.flashL - dt);
      const geo = g.flashL > 0 ? gc.lit : gc.dim;
      if (g.caps.geometry !== geo) g.caps.geometry = geo;
      g.node.visible = !!g.line;
    }
    // The switchboard, the rebalancer and the treasury.
    s.switchBusy = Math.max(0, s.switchBusy - dt);
    const sc = FM.switchScreens(), screens = s.switchBusy > 0 ? sc.busy : sc.calm;
    if (s.screens.geometry !== screens) s.screens.geometry = screens;
    s.spin = Math.max(0, s.spin - dt);
    const rr = FM.rebalancerRing(), ring = s.spin > 0 ? rr.on : rr.off, rf = FM.rebalancerFlow(), flow = s.spin > 0 ? rf.on : rf.off;
    if (s.ring.geometry !== ring) s.ring.geometry = ring;
    if (s.flow.geometry !== flow) s.flow.geometry = flow;
    s.ring.rotation.y += dt * (s.spin > 0 ? 5 : 0.4);
    for (let k = 4; k < 7; k++) L[LIGHT.rebalancer * 8 + k] = B[LIGHT.rebalancer * 8 + k] * (s.spin > 0 ? 1.5 : 0.5);
    // The belt lifts each nugget from the chute to over the crate, where it drops in and the crate's gold rises.
    for (let i = 0; i < BELT_CAP; i++) {
      const t = s.nuggetT[i];
      if (t < 0) continue;
      const n = s.nuggets[i], next = t + dt / BELT_TIME;
      if (next >= 1) {
        s.nuggetT[i] = -1;
        n.visible = false;
        s.hopper = Math.min(1, s.hopper + 0.05);
        continue;
      }
      s.nuggetT[i] = next;
      n.position.y = BELT[0][1] + (BELT[1][1] - BELT[0][1]) * next + 0.1;
      n.position.z = BELT[0][2] + (BELT[1][2] - BELT[0][2]) * next;
      n.rotation.y = next * 2.4;
    }
    if (s.hopper >= 1) s.hopper = 0;
    s.fill.position.y = 0.1 + s.hopper * 0.55;
    // The heap under the glass grows with the public capacity, as far as the glass allows.
    const capacityScale = Math.min(0.9, (0.6 + Math.log10(Math.max(1e6, mock.snapshot.capacity) / 1e6) * 0.35) * 0.8);
    s.pile.scale.x = s.pile.scale.z = capacityScale;
    s.pile.scale.y = capacityScale * 0.9;
    // The watchtower: the beam sweeps while the feed is live; silent, the lamp goes out.
    const live = signal === "live";
    const ll = FM.lookoutLamp(), lampGeo = live ? ll.on : ll.off;
    if (s.lamp.geometry !== lampGeo) s.lamp.geometry = lampGeo;
    s.beam.visible = live;
    s.lamp.rotation.y += dt * 0.9;
    const spot = RENDER_OPTS.spotLight, beam = FM.LOOKOUT_BEAM, horizontal = Math.cos(beam.pitch);
    spot[3] = live ? beam.range : 0;
    spot[4] = Math.cos(s.lamp.rotation.y) * horizontal;
    spot[5] = Math.sin(beam.pitch);
    spot[6] = -Math.sin(s.lamp.rotation.y) * horizontal;
    for (let k = 4; k < 7; k++) L[LIGHT.lookout * 8 + k] = B[LIGHT.lookout * 8 + k] * (live ? 1 : 0.08);
    // Sats: in along a conduit to the core, then out along another to the line the forward left by, or back.
    const q = s.sats, data = s.satNode.instanceData, red = s.redNode.instanceData;
    let count = 0, reds = 0;
    for (let i = 0; i < SAT_CAP; i++) {
      if (q.bay[i] < 0) continue;
      q.t[i] += dt * q.speed[i] * q.dir[i];
      if (q.dir[i] > 0 && q.t[i] >= 1) {
        if ((q.flags[i] & (BIG | LEAD)) === (BIG | LEAD)) surge(s, q.flags[i]);
        if (q.aim[i] >= 0) s.bays[q.aim[i]].sputter = SPUTTER;
        if (q.next[i] < 0) { q.bay[i] = -1; continue; }
        q.bay[i] = q.next[i];
        q.dir[i] = -1;
        q.t[i] = 1;
      } else if (q.dir[i] < 0 && q.t[i] <= 0) {
        const b = s.bays[q.bay[i]];
        if (q.flags[i] & FAILED) b.sputter = SPUTTER;
        else b.flashL = FLASH;
        q.bay[i] = -1;
        continue;
      }
      if (q.t[i] < 0 || q.t[i] > 1) continue;
      const bi = q.bay[i], path = s.paths[bi], u = q.t[i] * CONDUIT_SAMPLES, j = Math.min(CONDUIT_SAMPLES - 1, Math.floor(u)), f = u - j, a = j * 3;
      SAT_POS.x = path[a] + (path[a + 3] - path[a]) * f;
      SAT_POS.y = path[a + 1] + (path[a + 4] - path[a + 1]) * f;
      SAT_POS.z = path[a + 2] + (path[a + 5] - path[a + 2]) * f;
      SAT_ROT.y = q.spin[i] + elapsed * 3;
      const size = (q.flags[i] & BIG ? 1.12 : 1) + Math.sin(q.t[i] * Math.PI) * 0.2;
      SAT_SCALE.x = SAT_SCALE.y = SAT_SCALE.z = size;
      mat4.fromTRS(SAT_M, SAT_POS, SAT_ROT, SAT_SCALE);
      const back = q.flags[i] & FAILED && q.dir[i] < 0, out = back ? red : data, at = (back ? reds++ : count++) * 20;
      out.set(SAT_M, at);
      out[at + 16] = 1; out[at + 17] = 0.4; out[at + 18] = 0; out[at + 19] = 0;
    }
    s.satNode.instanceCount = count;
    s.satNode.visible = count > 0;
    s.satNode.instanceVersion++;
    s.redNode.instanceCount = reds;
    s.redNode.visible = reds > 0;
    s.redNode.instanceVersion++;
    s.refreshAt -= dt;
    if (s.refreshAt <= 0) {
      s.refreshAt = 1;
      refreshBoards(s);
    }
    greeter.update(dt, elapsed);
    greeter.light(RENDER_OPTS.lights, LIGHT.tess * 8);
    // The act button talks to the guide in reach, starts the picked tour or skips a line ahead, the way the
    // hub shows ENTER ARCADE by its door; the pilot's own label returns once the offer is gone.
    const actLabel = avatar && greeter.actLabel();
    if (actLabel) { hud.setAct(actLabel); greeterPrompt = true; }
    else if (greeterPrompt) { greeterPrompt = false; pilot.showAct(); }
    stepTweens(dt);
    fx.update(dt, elapsed);
  };
  const drawExtra = () => {};
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  const leave = () => {
    // Whoever walked in walks back out as themselves: the island takes the same Ooga back at this mouth.
    if (avatar) world.pilot = avatar.traits.name;
    greeter.dispose();
    greeter = null;
    unsubscribe();
    unsubscribe = null;
    for (const node of [scene.switchLabel]) if (node.owned) {
      renderer.releaseGeometry(node.face.geometry);
      renderer.releaseGeometry(node.back.geometry);
    }
    for (const g of scene.crew) g.agent.dispose();
    scene.gate.phase.dispose();
    for (const t of scene.tunnels) { t.ripples.dispose(); t.body.dispose(); }
    // Save the carry/combat choice while the controlled actor still exists.
    pilot.dispose();
    if (people) people.dispose();
    fx.dispose();
    for (const node of targets) input.remove(node);
    targets.length = 0;
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    const count = input.targetCount;
    input.dispose();
    hud.dispose();
    scene = shared = feed = mock = hud = hooks = input = pilot = fx = agentPlay = dust = people = avatar = playerWorld = null;
    factoryScene.input = factoryScene.debug = null;
    return { targets: count };
  };
  // Geometry kept off the graph but swapped in when something flashes, so it stays on the GPU.
  const liveGeometry = (set) => {
    for (const pair of [FM.coreChamber(), FM.forgeFire(), FM.forgeSign(), FM.forgeWave(), FM.switchScreens(), FM.rebalancerRing(), FM.rebalancerFlow(), FM.lookoutLamp(), FM.galleryCaps(), FM.capacitor().blue, FM.capacitor().orange]) {
      for (const k in pair) set.add(pair[k]);
    }
    for (const sh of FM.forgeShafts()) set.add(sh.glow.dim).add(sh.glow.bright);
    for (const shapes of FM.teslaArcs()) for (const g of shapes) set.add(g);
    if (scene) {
      for (const g of scene.crew) g.agent.liveGeometry(set);
      scene.gate.phase.liveGeometry(set);
    }
    if (avatar) set.add(avatar.headOpen).add(avatar.headClosed);
    if (greeter) greeter.liveGeometry(set);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), feed: feed ? { ...feed.counts } : null };
  };

  const factoryScene = {
    id: "factory", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null, agent: null, agentView: null, agentControls: null, agentHandoff: null,
    get inMotion() {
      return !!scene;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.factory = factoryScene;
})();
