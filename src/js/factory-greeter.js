// The factory's floating guide, Tess. One visit owns the rig, the on-screen tour menu and the feed subscription.
// Dialogue is data for later speech. The tour observes events; it never drives the node or the visitor.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, factoryModels: FM } = BL;
  const { quat, damp } = BL.math;
  const { cached, lathe, turn, shaded, torus, forwardLathe, moved, turnedZ, bevelBox, prism } = models;
  const { createNode, addChild, removeChild } = BL.scene;
  // Flink's head was seven voxels wide, centred three voxels above its pivot, at 16 voxels per metre of height.
  const DEMO = "obl.factory.demo.v1", HEIGHT = 1.05, BASE = HEIGHT * (5 / 16 + 0.5 + 3 / 16), TAU = Math.PI * 2;
  const NAME = "Tess";
  const LINES = {
    greeting: "Hi! I'm Tess, your factory guide. Want a look round?",
    greetingDemo: "Hi! I'm Tess. This node is a demo one today.",
    noOogaDemo: "Demo node today! Pick an Ooga on the island.",
    noOoga: "No Ooga, no tour! Pick one on the island.",
    menu: "Four tours! Pick one.",
    follow: "Follow me! Lines, the core, the switchboard.",
    channels: "Lines are channels to peers. A payment can hop node to node.",
    core: "The core is this node. It forwards payments; it mines nothing.",
    outcomes: "Settled means it went through. Failed means it did not — never why.",
    privacy: "Routes and fees stay private. We see outcomes, not journeys.",
    quiet: "Quiet shift — no forward came by. The machines explain themselves.",
    settled: "A forward just settled. Its route and fee stay private.",
    failed: "A forward just failed. The report never says why.",
    demoReport: "That report came from the demo node — practice, not real.",
    replayReport: "That was an old report replayed, not fresh news.",
    followChannels: "Come! Forge first, then the lines.",
    followRebalancing: "This way! The rebalancer waits.",
    followHealth: "Up we go! The watchtower sees far.",
    forge: "The forge ties lines to the chain. Opens and closes happen on-chain.",
    opening: "Opening parks funds in a channel. The carts show a size bucket, not an amount.",
    closing: "Closing settles back on-chain. The coin is our picture of it.",
    channelStatus: "Each station is one channel: opening, active, closing, closed.",
    slots: "Today's slots are temporary labels. They name no peer, no route.",
    fundsPrivate: "Public capacity is not spendable balance. Liquidity stays private.",
    channelQuiet: "No channel news this leg. The station explains itself anyway.",
    channelOpeningReport: "An opening was reported. That is not active yet.",
    channelActiveReport: "An active channel was reported. Balances stay private.",
    channelClosingReport: "A closing was reported. Not closed until closed arrives.",
    channelClosedReport: "A closed channel was reported. That is all it says.",
    channelDone: "Forge plus lines — that is the dance. Back to my post!",
    liquidity: "Channels need liquidity that moves. Capacity alone says little.",
    rebalancer: "The rebalancer shifts liquidity so lines keep working.",
    rebalanceHour: "Reports group by the hour. The spin is a picture, not a timestamp.",
    rebalancePrivate: "Reports name no channel and no balance. A fail gives no cause.",
    rebalanceQuiet: "No rebalance came by. No need to poke the machine.",
    rebalanceSucceededReport: "A rebalance worked. Which channels? Not said.",
    rebalanceFailedReport: "A rebalance failed. Why? The report does not say.",
    rebalanceDone: "That is rebalancing! Private balances stay private.",
    healthCore: "The core lights on starting or ready reports, dark on stopped.",
    unknownNode: "No node state reported. Missing news is not bad news.",
    startingNode: "Node says starting. A report, not a promise.",
    readyNode: "Node says ready. Not a guarantee every forward lands.",
    stoppedNode: "Node says stopped. A report — not the same as a quiet feed.",
    watchtower: "The beam follows feed activity. Signal, not diagnosis.",
    waitingSignal: "No event yet. We wait; health unknown.",
    silentSignal: "Feed quiet. The beam can sleep while the node is fine.",
    liveSignal: "Events arriving! An active feed, not a clean bill of health.",
    replaySignal: "Old events replaying. Signal yes, fresh health no.",
    summary: "Summaries describe activity. Not diagnosis, not balances.",
    noSummary: "No summary supplied. We invent no counts.",
    healthDone: "State and signal answer different questions. Tour done!",
    done: "That is forwarding! Wander free — I'll wait by the stairs.",
    warning: "Still coming? I'll hover here.",
    abandoned: "Lost my visitor! Back to post.",
    cancelled: "All good. I'll fly back!",
    blocked: "Path blocked. Back to post."
  };
  // The shared bubble is single-line. Bake short speech beats once, preserving full voice-ready lines.
  const SPEECH = {};
  for (const id in LINES) {
    const beats = [], words = LINES[id].split(" ");
    let beat = "";
    for (const word of words) {
      if (beat && beat.length + word.length + 1 > 44) { beats.push(beat); beat = ""; }
      beat += (beat ? " " : "") + word;
    }
    if (beat) beats.push(beat);
    SPEECH[id] = beats;
  }
  // Her post floats on the balcony's left at the head of the grand stairway, clear of its lantern post and the
  // arrival path, so the visitor walks up to her. Explicit waypoints use the broad arrival stairs and the left
  // pit-to-core stairs, not ladders. y is the expected support at the waypoint; the actual step uses the hall's
  // collision functions.
  const ROUTE = [
    [-2, 5, 23.6], [-0.8, 5, 22.9], [0, 5, 22], [0, 0, 13],
    [-4.8, 0, 9], [-6.5, 0, 8.5], [-4.8, 0, 9], [-4.8, 0, 7.5],
    [-4.8, 5, 1.3], [-4.8, 5, 0.1], [-4.8, 5, 1.3], [-4.8, 0, 7.5], [-7, 0, 8.5]
  ];
  const STOPS = { 5: ["channels"], 9: ["core", "privacy"], 12: ["outcomes", "observation", "source", "history", "done"] };
  // Tours share fixed approach points but own their stops. No runtime route building or event history.
  const CHANNEL_ROUTE = [
    ...ROUTE.slice(0, 4), [-4.8, 0, 9], [-4.8, 0, 5.8], [-4.8, 0, 7.5],
    [-4.8, 5, 1.3], [-4.8, 5, 0.1], [-5.6, 5, -1.6], [-6.1, 5, -3.9],
    [-6.4, 5, -4], [-8.5, 5, -2.5]
  ];
  const TOURS = {
    payments: { title: "PAYMENTS", follow: "follow", route: ROUTE,
      events: ["forward.settled", "forward.failed"], quiet: "quiet", stops: STOPS,
      look: { 5: [-12.4, 7, -2], 9: [0, 8, -4], 12: [-12, 4, 6] } },
    channels: { title: "CHANNELS", follow: "followChannels", route: CHANNEL_ROUTE,
      events: ["channel.opening", "channel.active", "channel.closing", "channel.closed"], quiet: "channelQuiet",
      stops: { 5: ["forge", "opening", "closing", "observation", "source", "history"],
        12: ["channelStatus", "slots", "fundsPrivate", "observation", "source", "history", "channelDone"] },
      look: { 5: [0, 3, 0.7], 12: [-12.4, 7, -2] } },
    rebalancing: { title: "REBALANCING", follow: "followRebalancing",
      route: [...ROUTE.slice(0, 4), [4.8, 0, 10], [8.5, 0, 9.5]],
      events: ["rebalance.succeeded", "rebalance.failed"], quiet: "rebalanceQuiet",
      stops: { 4: ["liquidity"], 5: ["rebalancer", "rebalanceHour", "rebalancePrivate", "observation", "source", "history", "rebalanceDone"] },
      look: { 4: [12.4, 7, -2], 5: [14, 4.5, 4.2] } },
    health: { title: "NODE HEALTH", follow: "followHealth",
      route: [...CHANNEL_ROUTE, [-8.9, 5, -3.5], [-9.2, 5, -4.4], [-9.2, 10, -9.6], [-9.2, 10, -10.1]],
      events: [], quiet: "unknownNode",
      stops: { 8: ["healthCore", "observation", "source", "history"],
        16: ["watchtower", "signal", "summary", "healthDone"] },
      look: { 8: [0, 8, -4], 16: [-16, 21, -14] } }
  };
  const TOUR_ORDER = ["payments", "channels", "rebalancing", "health"];
  const OBSERVATIONS = {
    "forward.settled": "settled", "forward.failed": "failed",
    "channel.opening": "channelOpeningReport", "channel.active": "channelActiveReport",
    "channel.closing": "channelClosingReport", "channel.closed": "channelClosedReport",
    "rebalance.succeeded": "rebalanceSucceededReport", "rebalance.failed": "rebalanceFailedReport"
  };
  const NODE_LINES = { unknown: "unknownNode", starting: "startingNode", ready: "readyNode", stopped: "stoppedNode" };
  // Tess uses the hall's smooth turned geometry, not a voxel rig. All meshes are cached; visits own only nodes.
  // The outer diameter matches the old head's seven-cell width. Nested radii keep the three gimbals clear of
  // one another throughout rotation, and the core and iris remain independent of their motion.
  const RINGS = [
    { radius: 0.158, x: 0.18, y: 0.2, speed: TAU * 2 / 53, orbit: TAU * 2 / 137, color: "#79482c" },
    { radius: 0.19, x: Math.PI / 2, y: 0.12, speed: -TAU * 2 / 71, orbit: -TAU * 2 / 173, color: "#b98852" },
    { radius: HEIGHT * 7 / 32 - 0.012, x: 0.32, y: 1.1, speed: TAU * 2 / 89, orbit: TAU * 2 / 211, color: "#ead0a0" }
  ];
  const COPPER = "#c68a4d", GRAPHITE = "#30353b", IVORY = "#eee3c9";
  // Simplified Natural Earth 110m country map (public domain), baked at 2.5 degrees.
  // Two bits per cell: dark ocean, orange land, darker orange country boundary; no runtime fetch.
  const EARTH_MAP =
    "555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555" +
    "555555555555555555555555555555555555555555555555555500000001555555555555555540000015555555555555555555555555555555555555550000000005555555555555" +
    "554000005405555555555555555555555555555555555555555400000105555555555555555500000000055555555555555555555555555555555555554000000000055555555555" +
    "554555000000001555555555555555555555555555555555555400000000000001000155000554000000000011555555555555541555555555555555555500000000000000000000" +
    "000010000000000000000000101555550155555555555555400000000000000000000000000004000000000000000000000014000000001010000000000000000000000000000000" +
    "000000400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "000240000000000000000000000000000000000000000000000000000000000000000000000a00400000000000000000000000000000000000000000000000000000000000000000" +
    "000a40000000000000000000000000000000000000000000000000000000000000000000000a40000000000000000000000000000000000000000000000100000000000000000000" +
    "000150000000000000000000000000000000000000000000000040000000000000000000000a50000000000000000000000000000000000000000004000010000000000000000000" +
    "000295000000000000000000000000000000000000000004000004000000000000000000000295400000000000000000000000000000000000000055000000000000000000000000" +
    "000295a80000000000000150000000000000000005500555400000000000000000000000000295a90000000000000255000000000000000005555555400000000000000000000000" +
    "0002956900000000000002958000000000000000055555554000000000000000000000000000a5aa40000000000006aa800000000000000015555555400000000000000000000000" +
    "0000aaa950000000000006aaa014000000000000155555550000000000000000000000000000aaa5550000000000169aa01400000000000005555555000000000000000000000000" +
    "000096a55500000000002aaaa00500000000000000155554000000000000000000000000000296955500000000002aaaa50500000000000000155410000000000000000000000000" +
    "00169a9555000000000015a9a901000000000000000050000000000000000000000000000016aa55554000000000156aaa0000000000000000000000000000000000000000000000" +
    "005aa55555500000000016aaa60000000000000001440040000000000000000000000000009a55555550000000002a96960000000000000400000294000000000000000000000000" +
    "00a69555554000000000a9569a0000000000001000400690000000000000000000000000006aa555500000000000aa56a980000000000060a4405000000000000000000000000000" +
    "00aaa9a9000000000000aa56aa900000000000a0a80000000000000000000000000000000015aaaa000000000000aaaaaaa400000000028028000000000000000000000000000000" +
    "00169a8000000000aa86aaaaa9a900000040008000000000000000000000000000000000011a550000000002aaa5aaaaa96a00000000020000040000000000000000000000000000" +
    "000440000000000aaaaaa9aaa98200000500022800000000000000000000000000000000a40000000000001aaaaaa9a55aa40000050002aa00500000000000000000000000000000" +
    "800000000000002aaaa969695a2a4000154002a800400000000000000000000000000016800140000000000569a969a9546aa40015500aa100000000000000000000000000000551" +
    "40000000000000196aaaaaaaa455a900555416a800000000000000000000000000000540000000000000000aaa56aa6aa155a802555aaaa954400000000000000000000000001540" +
    "010000000000000aa956956951550aa695aaaa55550000000000000000000000000055800100000000000000a9569569696859a9a6aaaa5555400000000000000000000000055a90" +
    "54000000000000006a5694684aaa55aa6aa569555540000000000000000000000022aa5555400000000000001a5a00000aa956a6aa9555555500100000000000000000000026a555" +
    "5550000000000000005a00001aaa5aaaaa555555550105000000000000000000015555555550000000000000a500048156aa0a6aa955555554080040000000000000000001555555" +
    "5694000000000000a68018aa14aa0aaaaa555aaa955a00400000000000000000055555555aaa00000000000002944aa800a86aa9aa95aaaaa956a010000000000000000005555555" +
    "a96aa00000000000015aaaaa12561a9555aaa5556a55a80000000000000000000955555aa5551054000000000aaaaaaa5a9a5a9555aaa96aaa56a50000000000000000000aaaaaaa" +
    "55555550000000000aa96aaaaa56aaa566aaaaaaaaaa5500000000000000000016aaaaa55455554000000000510269aaa555a6aaaa55569555a95500050000000000000055555555" +
    "4015540000000000040220aa955555aa995555555555540005400000004000029555555500154400000000000006942a555555555555555555555540004000000154002a55555554" +
    "00140000540000000005a42a95555555555555555555555554554000055556a55555555011015001550000400000a516955555555555555555555555555554000055569555555555" +
    "500554015550001000002aa69105555555555555555555555555555505555695555555554505400155554000000002aa540011544555555555555555555555001555569555511005" +
    "555400015555540000000000000014015155555555551555400000400010000001155014100000055555550000000000000014000015555540000040000000000000000005500005" +
    "000055555555550000000000000000540000015540000000000000000000000001044141555095555555550000001500000000000000005000000000000000000000000000010505" +
    "555581555555555400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
  const MESHES = cached(() => {
    const sphere = (r, color) => lathe({ profile: Array.from({ length: 25 }, (_, i) =>
      [Math.sin(i / 24 * Math.PI) * r, -Math.cos(i / 24 * Math.PI) * r]), segments: 48, color });
    const globe = lathe({ profile: Array.from({ length: 73 }, (_, i) =>
      [Math.sin(i / 72 * Math.PI) * 0.105, -Math.cos(i / 72 * Math.PI) * 0.105]),
      segments: 144, color: GRAPHITE });
    const earthColors = [BL.math.hexToRgb(GRAPHITE), BL.math.hexToRgb("#f7931a"), BL.math.hexToRgb("#b96110")];
    for (let i = 0; i < globe.faces.length; i++) {
      const cell = (parseInt(EARTH_MAP[i >> 1], 16) >> (i % 2 ? 0 : 2)) & 3;
      globe.faces[i].color = earthColors[cell];
      globe.faces[i].emissive = cell ? 0.3 : 0;
    }
    const core = shaded([globe, forwardLathe(torus(0.097, 0.003, COPPER, 0, 48, 8))]);
    const lens = shaded([moved(forwardLathe(turn([[0.069, 0], [0.072, 0.009], [0.065, 0.018],
      [0.047, 0.022], [0.043, 0.016], [0.043, 0], [0.069, 0]], 48, COPPER)), 0, 0, 0.083)]);
    const iris = shaded([moved(forwardLathe(turn([[0.044, 0], [0.04, 0.006], [0.026, 0.007],
      [0.026, 0], [0.044, 0]], 48, "#ffab35", 0.8)), 0, 0, 0.105)]);
    const pupil = shaded([moved(forwardLathe(turn([[0.026, 0], [0.023, 0.007], [0, 0.011]],
      48, "#171c23")), 0, 0, 0.108)]);
    const caps = [], capDetails = [], irisMarks = [], blades = [];
    // Oval, domed ceramic plates sit on dark gaskets with a rolled copper lip. Geometry is shaped before
    // shading, so averaged normals follow the finished shell rather than a scaled box.
    const plate = (color, lift) => {
      const g = turn([[0.033, 0], [0.04, 0.003], [0.041, 0.008], [0.038, 0.017],
        [0.029, 0.027], [0.014, 0.031], [0, 0.032]], 48, color);
      for (let i = 0; i < g.verts.length; i += 3) { g.verts[i] *= 1.25; g.verts[i + 2] *= 0.6; }
      return moved(g, 0, 0.075 + lift, 0.02);
    };
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3;
      caps.push(turnedZ(plate("#171c23", -0.005), a), turnedZ(plate(COPPER, -0.002), a),
        turnedZ(plate(IVORY, 0), a));
      for (const x of [-0.021, 0.021]) {
        caps.push(turnedZ(moved(sphere(0.003, COPPER), x, 0.103, 0.037), a));
        capDetails.push(turnedZ(bevelBox({ w: 0.003, h: 0.001, d: 0.001, bevel: 0.0002,
          color: GRAPHITE, offset: { x, y: 0.105, z: 0.039 } }), a));
      }
      for (let j = 0; j < 3; j++) capDetails.push(turnedZ(bevelBox({ w: 0.011, h: 0.0015, d: 0.002,
        bevel: 0.0005, color: GRAPHITE, offset: { x: (j - 1) * 0.014, y: 0.087, z: 0.044 } }), a));
      capDetails.push(turnedZ(bevelBox({ w: 0.027, h: 0.003, d: 0.002, bevel: 0.001,
        color: "#ffc16b", emissive: 0.35, offset: { y: 0.074, z: 0.047 } }), a));
    }
    for (let i = 0; i < 24; i++) irisMarks.push(turnedZ(bevelBox({ w: 0.0015, h: 0.013, d: 0.002,
      bevel: 0.0004, color: COPPER, offset: { y: 0.055, z: 0.106 } }), i * TAU / 24));
    // Overlapping tapered vanes resolve the iris as a mechanism, with dark seams between its warm blades.
    for (let i = 0; i < 18; i++) blades.push(moved(turnedZ(prism([
      [-0.002, 0.027], [0.004, 0.03], [0.008, 0.041], [-0.002, 0.043]
    ], 0.0015, i % 3 ? "#e5a34e" : "#ffe0a0", 0.3), i * TAU / 18), 0, 0, 0.115));
    const housing = shaded([
      moved(forwardLathe(torus(0.068, 0.002, "#171c23", 0, 64, 8)), 0, 0, 0.099),
      moved(forwardLathe(torus(0.05, 0.0015, "#efc48a", 0, 64, 8)), 0, 0, 0.11),
      forwardLathe(torus(0.103, 0.002, "#171c23", 0, 64, 8)),
      moved(forwardLathe(turn([[0.033, 0], [0.033, 0.006], [0.026, 0.01], [0.026, 0],
        [0.033, 0]], 64, GRAPHITE)), 0, 0, 0.112)
    ]);
    const glints = shaded([moved(sphere(0.0035, "#fff4ce"), -0.009, 0.009, 0.121),
      moved(sphere(0.0014, "#c3d9e7"), 0.01, -0.006, 0.12)]);

    const rings = RINGS.map((ring) => {
      const r = ring.radius, round = [], marks = [];
      const band = (inner, outer, depth, color, emissive = 0) => {
        const bevel = Math.min(0.0008, depth * 0.4, (outer - inner) * 0.2);
        return forwardLathe(turn([
        [inner + bevel, -depth], [outer - bevel, -depth], [outer, -depth + bevel],
        [outer, depth - bevel], [outer - bevel, depth], [inner + bevel, depth],
        [inner, depth - bevel], [inner, -depth + bevel], [inner + bevel, -depth]
      ], 96, color, emissive));
      };
      // Copper binds the inner edge; the outer rail glows Bitcoin orange. Four slots pierce the wood.
      round.push(band(r - 0.012, r - 0.008, 0.01, COPPER), band(r + 0.008, r + 0.012, 0.01, "#f7931a", 1));
      const wood = band(r - 0.008, r + 0.008, 0.008, ring.color);
      wood.faces = wood.faces.filter((f) => f.i[f.i.length - 1] % 96 % 24 >= 2);
      // Subtle baked grain varies around the annulus; thin dark grain lines follow both wooden faces.
      for (const f of wood.faces) {
        const grain = 0.97 + Math.sin((f.i[f.i.length - 1] % 96) * 1.7) * 0.03;
        f.color = f.color.map((c) => c * grain);
      }
      round.push(wood);
      for (const z of [-0.0082, 0.0082]) {
        const grainLine = band(r + 0.004, r + 0.0048, 0.0002, "#50311e");
        grainLine.faces = grainLine.faces.filter((f) => f.i[f.i.length - 1] % 96 % 24 >= 2);
        round.push(moved(grainLine, 0, 0, z));
      }
      for (let i = 0; i < 4; i++) for (const edge of [0, 2]) marks.push(turnedZ(bevelBox({
        w: 0.016, h: 0.001, d: 0.016, bevel: 0.0002, color: ring.color,
        offset: { x: r }
      }), (i * 24 + edge) * TAU / 96));
      // Radial ticks and linked blocks are baked into the mesh, never regenerated while the rings turn.
      for (let i = 0; i < 48; i++) {
        if (i % 12 === 0) continue;
        const a = i * TAU / 48;
        marks.push(turnedZ(bevelBox({ w: 0.001, h: i % 4 ? 0.005 : 0.008, d: 0.0008,
          bevel: 0.0002, color: "#523622", offset: { y: r, z: 0.0085 } }), a));
        if (i % 4 === 2) {
          for (const z of [-0.0085, 0.0085]) {
            marks.push(turnedZ(bevelBox({ w: 0.007, h: 0.006, d: 0.0008, bevel: 0.0005,
              color: "#50311e", offset: { y: r, z } }), a));
            marks.push(turnedZ(bevelBox({ w: 0.005, h: 0.004, d: 0.0008, bevel: 0.0005,
              color: COPPER, offset: { y: r, z: z * 1.08 } }), a));
          }
        }
        if (i % 12 === 6) round.push(turnedZ(moved(sphere(0.0018, COPPER), 0, r, 0.01), a));
      }
      return shaded(round, marks);
    });
    return { core, lens, iris, pupil, housing, glints, blades: shaded([], blades),
      armor: shaded(caps, capDetails), irisMarks: shaded([], irisMarks), rings };
  });
  const create = ({ parent, input, fx, feed, visitor, demoRunning, coarse }) => {
    const meshes = MESHES(), body = createNode(), hover = createNode(), head = createNode({ geometry: meshes.core });
    const iris = createNode({ geometry: meshes.iris }), pupil = createNode({ geometry: meshes.pupil });
    const optics = createNode(), blades = createNode({ geometry: meshes.blades });
    const figure = { root: body, parts: { head: hover } }, rings = [], pivots = [], orientations = [], orbit = quat.create();
    let floorY = ROUTE[0][1], flightY = floorY + BASE, greetingT = 0, speakingT = 0, yaw = 0;
    body.position.x = ROUTE[0][0]; body.position.y = flightY; body.position.z = ROUTE[0][2];
    addChild(body, hover); addChild(hover, head);
    addChild(head, createNode({ geometry: meshes.lens }), createNode({ geometry: meshes.housing }), optics,
      createNode({ geometry: meshes.armor }), createNode({ geometry: meshes.irisMarks }),
      createNode({ geometry: FM.forgeWave().gold, scale: { x: 0.045, y: 0.045, z: 0.045 }, position: { x: 0, y: 0, z: 0.108 } }));
    addChild(optics, iris, pupil, blades, createNode({ geometry: meshes.glints }));
    for (let i = 0; i < RINGS.length; i++) {
      const spec = RINGS[i], pivot = createNode({ quaternion: quat.fromEuler(quat.create(), spec.x, spec.y, 0) });
      const ring = createNode({ geometry: meshes.rings[i] });
      addChild(pivot, ring); addChild(hover, pivot); rings.push(ring); pivots.push(pivot);
      orientations.push(quat.copy(quat.create(), pivot.quaternion));
    }
    addChild(parent, body);
    input.add(head, { kind: "greeter" }, { radius: HEIGHT * 7 / 32 });
    // The tour menu lives on screen, in the HUD's wood, built for the visit and removed on leave.
    const panel = document.createElement("div");
    panel.className = "greeter-menu";
    panel.hidden = true;
    const heading = document.createElement("p");
    heading.className = "greeter-menu-title";
    heading.textContent = `${NAME}'s tours`;
    panel.append(heading);
    const options = [];
    for (let i = 0; i < TOUR_ORDER.length; i++) {
      const id = TOUR_ORDER[i], option = document.createElement("button");
      option.type = "button";
      option.className = "greeter-choice";
      option.textContent = TOURS[id].title;
      option.addEventListener("click", () => choose(id));
      option.addEventListener("pointerenter", () => { if (state.phase === "menu") select(i); });
      panel.append(option);
      options.push(option);
    }
    const help = document.createElement("p");
    help.className = "greeter-menu-help";
    help.textContent = coarse ? "Tap a tour" : "Arrows choose · Enter starts · Esc closes";
    panel.append(help);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "greeter-stop";
    stop.textContent = "End tour";
    stop.hidden = true;
    stop.addEventListener("click", () => endTour());
    document.body.append(panel, stop);
    let tour = TOURS.payments;
    const state = { tour: null, selection: 0, phase: "idle", waypoint: 0, line: 0, away: 0, blocked: 0, greeted: false, cooldown: 0,
      advance: 0, spoken: null, utterance: 0, lastEvent: null, replay: false, demo: false, observation: "quiet", snapshotDemo: false, snapshotReplay: false,
      node: feed.reading.node, nodeDemo: false, nodeReplay: false, nodeReported: false };
    const position = body.position;
    const near = (range = 3.5) => {
      const actor = visitor();
      if (!actor) return false;
      const p = actor.root.position;
      return Math.hypot(p.x - position.x, p.z - position.z, p.y - actor.baseY - floorY) <= range;
    };
    const show = (phase) => {
      state.phase = phase;
      panel.hidden = phase !== "menu";
      stop.hidden = phase !== "walk" && phase !== "talk";
    };
    const select = (index) => {
      state.selection = (index + options.length) % options.length;
      for (let i = 0; i < options.length; i++) options[i].classList.toggle("sel", i === state.selection);
    };
    // One anchored bubble replaces the previous line and follows the guide, including her return. Each spoken
    // beat also arms the tour's auto-advance: after a readable pause the next line comes on its own.
    const say = (id, repeat = false) => {
      if (!repeat || state.spoken !== id) state.utterance = 0;
      state.spoken = id;
      const beat = SPEECH[id][state.utterance];
      state.advance = 1.6 + beat.length * 0.06;
      speakingT = 1.2;
      fx.say(figure, beat, 8);
    };
    const greet = (interacting = true) => {
      if (state.phase === "return" || state.phase === "walk") return;
      if (state.phase === "talk") { say(state.spoken, true); return; }
      if (interacting && visitor() && !near()) return;
      state.greeted = true; greetingT = 1.4;
      if (!interacting) {
        show("greeting");
        say(demoRunning() ? "greetingDemo" : "greeting");
        return;
      }
      const actor = visitor();
      if (!actor) { say(demoRunning() ? "noOogaDemo" : "noOoga"); return; }
      // Talking turns the visitor's Ooga to face her, and the menu opens on screen.
      actor.root.rotation.y = Math.atan2(position.x - actor.root.position.x, position.z - actor.root.position.z);
      select(0);
      show("menu");
      say("menu");
    };
    const end = (line) => {
      show("return"); state.away = state.blocked = 0; if (line) say(line);
    };
    const resolveLine = (id) => {
      if (id === "observation") return state.observation;
      if (id === "source") return state.snapshotDemo ? "demoReport" : null;
      if (id === "history") return state.snapshotReplay ? "replayReport" : null;
      if (id === "signal") return feed.signal === "waiting" ? "waitingSignal" : feed.signal === "silent" ? "silentSignal"
        : feed.reading.stream === "replay" ? "replaySignal" : "liveSignal";
      if (id === "summary") return feed.reading.summary ? "summary" : "noSummary";
      return id;
    };
    const talk = () => {
      state.line = 0;
      const nodeMetadata = state.nodeReported && state.node === feed.reading.node;
      state.observation = state.tour === "health" ? NODE_LINES[feed.reading.node] : OBSERVATIONS[state.lastEvent] || tour.quiet;
      state.snapshotDemo = state.tour === "health" ? nodeMetadata && state.nodeDemo : !!state.lastEvent && state.demo;
      state.snapshotReplay = state.tour === "health" ? nodeMetadata && state.nodeReplay : !!state.lastEvent && state.replay;
      show("talk"); say(tour.stops[state.waypoint][0]);
    };
    // One beat further, then one line, then the leg: NEXT on the act button and the readable pause both come here.
    const next = () => {
      if (state.phase !== "talk") return;
      if (state.utterance + 1 < SPEECH[state.spoken].length) {
        state.utterance++; say(state.spoken, true); return;
      }
      const lines = tour.stops[state.waypoint];
      while (++state.line < lines.length) {
        const line = resolveLine(lines[state.line]);
        if (line) { say(line); return; }
      }
      if (state.waypoint === tour.route.length - 1) end();
      else show("walk");
    };
    const choose = (id) => {
      if (!Object.hasOwn(TOURS, id) || state.phase !== "menu" || !near()) return;
      tour = TOURS[id]; state.tour = id;
      state.waypoint = 0; state.away = state.blocked = 0; state.lastEvent = null;
      show("walk"); say(tour.follow);
    };
    const endTour = () => {
      if (state.phase === "talk" || state.phase === "walk") end("cancelled");
    };
    // An open menu swallows Escape first; the cave's own Escape leaves only when no menu is up.
    const escape = () => {
      if (state.phase !== "menu") return false;
      show("idle");
      return true;
    };
    const unsubscribe = feed.subscribe((e) => {
      if (e.type === "node.started" || e.type === "node.ready" || e.type === "node.stopped") {
        state.node = e.type === "node.started" ? "starting" : e.type === "node.ready" ? "ready" : "stopped";
        state.nodeReplay = e.stream === "replay"; state.nodeDemo = e.schema === DEMO; state.nodeReported = true;
      }
      if (state.phase !== "walk" && state.phase !== "talk") return;
      if (!tour.events.includes(e.type)) return;
      state.lastEvent = e.type; state.replay = e.stream === "replay"; state.demo = e.schema === DEMO;
    });
    const move = (dt, returning) => {
      const index = returning ? state.waypoint : state.waypoint + 1, to = tour.route[index];
      const dx = to[0] - position.x, dz = to[2] - position.z, distance = Math.hypot(dx, dz);
      if (distance < 0.025) {
        if (returning) {
          if (index === 0) { show("idle"); state.tour = null; state.greeted = false; state.cooldown = 12; }
          else state.waypoint--;
        } else {
          state.waypoint = index;
          if (tour.stops[index]) talk();
        }
        return false;
      }
      const step = Math.min(distance, dt * (returning ? 3.6 : 1.65));
      let x = position.x + dx / distance * step, z = position.z + dz / distance * step;
      const feet = floorY, actor = visitor();
      if (actor && Math.abs(actor.root.position.y - actor.baseY - feet) < 1.5) {
        const p = actor.root.position, clearance = 0.45 + (actor.bodyRadius || 0.35);
        if (Math.hypot(p.x - x, p.z - z) < clearance) {
          // Give way sideways if the floor permits it; a narrow stair waits instead of stepping off it.
          const side = (position.x - p.x) * -dz + (position.z - p.z) * dx >= 0 ? 1 : -1;
          x = position.x - dz / distance * step * side;
          z = position.z + dx / distance * step * side;
          if (Math.hypot(p.x - x, p.z - z) <= Math.hypot(p.x - position.x, p.z - position.z)) return false;
        }
      }
      if (!FM.walkable(position.x, position.z, x, z, feet, 0.3, 1.8)) {
        state.blocked += dt;
        if (!returning && state.blocked > 5) end("blocked");
        return false;
      }
      const floor = FM.supportAt(x, z, feet);
      yaw = Math.atan2(x - position.x, z - position.z);
      position.x = x; position.z = z; floorY = floor; state.blocked = 0;
      return true;
    };
    const update = (dt, elapsed) => {
      state.cooldown = Math.max(0, state.cooldown - dt);
      const actor = visitor();
      if (state.phase === "idle" && !state.greeted && !state.cooldown && near(4)) greet(false);
      if (state.phase === "greeting" || state.phase === "menu") {
        if (!actor || !near()) show("idle");
      }
      if (state.phase === "talk") {
        state.advance -= dt;
        if (state.advance <= 0) next();
      }
      const touring = state.phase === "walk" || state.phase === "talk";
      if (touring) {
        if (!actor) end("abandoned");
        else if (!near(6)) {
          const before = state.away; state.away += dt;
          if (before < 4 && state.away >= 4) fx.say(figure, LINES.warning, 8);
          if (state.away >= 12) end("abandoned");
        } else state.away = 0;
      }
      let walking = false;
      if (state.phase === "return" || state.phase === "walk" && near(6)) {
        // Small steps let supportAt follow every stair tread even after a slow frame.
        let left = Math.min(dt, 0.5);
        while (left > 0 && (state.phase === "walk" || state.phase === "return")) {
          const step = Math.min(left, 0.04); left -= step;
          walking = move(step, state.phase === "return") || walking;
        }
      }
      flightY = damp(flightY, floorY + BASE, 9, dt);
      position.y = flightY;
      hover.position.y = Math.sin(elapsed * 1.7) * 0.018;
      greetingT = Math.max(0, greetingT - dt); speakingT = Math.max(0, speakingT - dt);
      // Each ring spins in its own plane while its gimbal slowly precesses about the eye. Quaternions keep
      // three-axis turns stable; absolute scene time gives the same pose at every frame rate, without drift.
      for (let i = 0; i < rings.length; i++) {
        rings[i].rotation.z = (elapsed * RINGS[i].speed) % TAU;
        quat.fromAxisAngle(orbit, 0, 1, 0, (elapsed * RINGS[i].orbit) % TAU);
        quat.multiply(pivots[i].quaternion, orbit, orientations[i]);
      }
      const look = state.phase === "talk" ? tour.look[state.waypoint] : null;
      let pitch = walking ? 0.08 : 0;
      if (!walking && look) {
        yaw = Math.atan2(look[0] - position.x, look[2] - position.z);
        pitch = -Math.min(0.6, Math.max(-0.4, Math.atan2(look[1] - position.y,
          Math.hypot(look[0] - position.x, look[2] - position.z))));
      } else if (!walking && actor) {
        const p = actor.root.position;
        yaw = Math.atan2(p.x - position.x, p.z - position.z);
        pitch = -Math.min(0.4, Math.max(-0.4, Math.atan2(p.y - actor.baseY + 1.1 - position.y,
          Math.hypot(p.x - position.x, p.z - position.z))));
      }
      const turnBy = Math.atan2(Math.sin(yaw - body.rotation.y), Math.cos(yaw - body.rotation.y));
      body.rotation.y = (body.rotation.y + damp(0, turnBy, 8, dt)) % TAU;
      head.rotation.x = damp(head.rotation.x, pitch + Math.sin(greetingT * 9) * greetingT * 0.05, 8, dt);
      head.rotation.z = damp(head.rotation.z, Math.sin(greetingT * 7) * greetingT * 0.06
        - (walking ? Math.max(-0.1, Math.min(0.1, turnBy * 0.12)) : 0), 6, dt);
      optics.position.x = damp(optics.position.x, Math.sin(turnBy) * 0.004, 9, dt);
      optics.position.y = damp(optics.position.y, -Math.sin(pitch) * 0.004, 9, dt);
      blades.rotation.z = Math.sin(elapsed * 0.4) * 0.05;
      iris.glow = 1 + Math.sin(speakingT * 18) * speakingT * 0.15;
      const blink = Math.pow(Math.max(0, Math.cos(elapsed * TAU / 7.3)), 80);
      pupil.scale.y = 1 - blink * 0.85;
    };
    const act = () => {
      if (state.phase === "walk" || state.phase === "return") return false;
      if (state.phase === "talk") {
        if (!near(6)) return false;
        next();
        return true;
      }
      if (!near()) return false;
      if (state.phase === "menu") choose(TOUR_ORDER[state.selection]);
      else greet();
      return true;
    };
    // What the act button offers right now, the hub's ENTER ARCADE pattern: a label only while the act works.
    const actLabel = () => {
      if (!visitor()) return null;
      if (state.phase === "talk") return near(6) ? "NEXT" : null;
      if (state.phase === "menu") return "START TOUR";
      if (state.phase === "walk" || state.phase === "return") return null;
      return near() ? `TALK TO ${NAME.toUpperCase()}` : null;
    };
    const menuKey = (e) => {
      if (state.phase !== "menu" || e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return false;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat && near()) {
        if (e.key === "Enter") choose(TOUR_ORDER[state.selection]);
        else select(state.selection + (e.key === "ArrowDown" ? 1 : -1));
      }
      return true;
    };
    // Capture repeats too: the director ignores repeated keydowns, but movement controls still read them.
    const captureMenuKey = (e) => {
      const target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
        || target.closest && target.closest("dialog"))) return;
      menuKey(e);
    };
    window.addEventListener("keydown", captureMenuKey, true);
    const dispose = () => {
      window.removeEventListener("keydown", captureMenuKey, true);
      unsubscribe();
      input.remove(head);
      removeChild(parent, body);
      panel.remove(); stop.remove();
      state.lastEvent = null;
    };
    return { root: body, state, update, greet, act, actLabel, escape, dispose,
      // The light follows the eye without reading a world matrix from the previous rendered frame.
      light(out, offset) {
        const yaw = body.rotation.y;
        out[offset] = body.position.x + Math.sin(yaw) * 0.2;
        out[offset + 1] = body.position.y + hover.position.y + 0.06;
        out[offset + 2] = body.position.z + Math.cos(yaw) * 0.2;
        out[offset + 3] = 0.85;
        out[offset + 4] = 0.55 * iris.glow; out[offset + 5] = 0.32 * iris.glow; out[offset + 6] = 0.12 * iris.glow;
        out[offset + 7] = 0;
      } };
  };
  BL.factoryGreeter = { create, LINES, TOURS, NAME };
})();
