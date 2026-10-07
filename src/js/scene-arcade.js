// Ooga Arcade: the cave behind the 3 o'clock mouth. The four Ooga games stand on a round stage in the middle of the
// hall facing the doorway, playing their attract loops with the visitor's best under them, spotlit, with the jackpot
// wheel turning behind them, which the visitor spins for tickets from the stage's front. Eight more cabinets line the
// mezzanine along the back wall, each looping its Ooga retro game (`retro-games.js`, played in `scene-carnival.js`),
// with claw machines, pinball and dart boards under it; pool and air hockey in the back room before it. Sports on the right (two skee-ball lanes, air hockey and
// two hoop shots), the coconut shy, the food court and the snack bar on the left, each carnival machine opening a
// game of its own (`scene-carnival.js`); a prize counter by the doorway where the tickets they pay buy prizes; the
// game-room gorillas, the arcade's uniformed staff, going from job to job round the hall; and Oogas from the roster
// playing everything the visitor is not.
//
// Walking up to a cabinet or a carnival machine and pressing act (or tapping it) opens that game, and the game's exit
// comes back to it as the same Ooga (`lastPlayer`). The carnival games are scenes of their own (`scene-carnival.js`);
// here their machines stand at rest, showing their coconuts and the visitor's best. Escape, the Leave button and the
// doorway go back to the island.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod } = BL;
  const AM = BL.arcadeModels, AG = BL.arcadeGames;
  const { clamp } = math;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible, boundsOf } = BL.scene;
  const { HALL, STAGE, MEZZ, GAMES, LAYOUT, CAB, SCREEN, FRAMES, FPS } = AM;

  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const PITCH = [-0.2, 1.3], DIST = [3, 27];
  const FOLLOW = { y: 0.9, min: 3, max: 7, pitch: [0.25, 0.8] };
  const FLY = { speed: 5, perDist: 0.4, climb: 3, yMax: HALL.h - 1.5 };
  const view = (x, y, z, yaw, pitch, dist) => ({ yaw, pitch, dist, target: { x, y, z } });
  const live = LAYOUT.cabinets.filter((c) => c.game >= 0);
  const PRESETS = {
    entrance: view(0, 2, -8, 0.3, 0.22, 14),
    cabinets: view(0, 2.6, -8.2, 0, 0.1, 8.2),
    hoops: view(15.36, 2, 3.8, -Math.PI / 2 - 0.35, 0.2, 6.5),
    skee: view(10.9, 1.5, -6.2, -0.25, 0.3, 7),
    shy: view(-15.31, 1.6, -6.8, Math.PI / 2 + 0.3, 0.2, 6.5),
    snacks: view(-14.9, 1.6, 4.6, Math.PI - 0.35, 0.2, 7)
  };
  for (const c of live) PRESETS[GAMES[c.game].id] = view(c.x, c.y + 1.4, c.z + 0.4, 0, 0.1, 4.2);
  // A portrait screen sees a third of the hall's width at the same distance, so there these views step back and turn
  // square to their subject: all four stage cabinets, both hoops, and the snack bar's and the coconut toss's signs
  // clear the screen's edges and sit under the nav. `views` hands the pilot whichever framing the screen wants when a
  // view is asked for; the rest frame the same either way.
  const TALL = {
    cabinets: view(0, 2.2, -7.8, 0, 0.48, 14.5),
    hoops: view(15.6, 2.4, 3.8, -Math.PI / 2 - 0.09, 0.28, 9.4),
    shy: view(-15.3, 2.5, -6.8, Math.PI / 2 - 0.12, 0.22, 9.3),
    snacks: view(-14.9, 2.5, 4.6, Math.PI, 0.2, 10)
  };
  const views = {};
  for (const name in PRESETS) Object.defineProperty(views, name, { get: () => TALL[name] && renderer.size.width < renderer.size.height ? TALL[name] : PRESETS[name] });
  // Firelit and darker than the other caves: a neutral dark-brown dusk, so paint, bone and timber keep their own
  // colours, and the warmth comes from the fires and the machines' screens.
  const RENDER_OPTS = {
    clear: [0.045, 0.035, 0.03], sky: [0.4, 0.35, 0.3], ground: [0.2, 0.16, 0.12],
    direct: [0.56, 0.48, 0.4], directStrength: 0.28, ambientFloor: 0.27,
    sun: { x: 0.2, y: 0.9, z: 0.4 }, shadowCenter: { x: 0, y: 2, z: -9 }, shadowExtent: 17,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, bloomStrength: 1.15,
    fog: [0.06, 0.045, 0.035], fogNear: 20, fogFar: 42
  };
  // How near a play spot counts as standing at it, and where walking out leaves.
  const REACH = 1.1, EXIT_Z = HALL.front - 0.2;
  // The jackpot wheel's top prize, and the pitch of the level view of it a spin swings the camera to.
  const WHEEL_JACKPOT = Math.max(...AM.WHEEL_VALUES), WHEEL_PITCH = -0.06;
  // What the Oogas say about the room, in their own words: [tooltip, what a tap tells you].
  const TIPS = {
    sign: ["Ooga Arcade", "Every Ooga game live in this cave. More coming! Walk up to one, press act. Ooga play!"],
    snack: ["Snack bar", "Ooga crunch!"],
    wheel: ["Jackpot wheel", `Spin wheel, ${AM.WHEEL_COST} tickets. Stand front of stage, face wheel, press act. Jackpot ${WHEEL_JACKPOT}!`],
    changer: ["Token totem", "Banana in, token out. Good trade."],
    muncher: ["Ticket muncher", "Muncher eat paper tickets. Yours safe on board. Muncher sad."],
    door: ["Back room", "Big door. Locked tight. No poker here! (maybe somewhere else?)"],
    fame: ["Hall of fame", "Best Oogas up there. Beat them, you go up too!"],
    disco: ["Spirit rattle", "Gourds clack, shells clink. Oogas dance."]
  };
  const ORDERS = ["Banana split! Ooga slurp slurp.", "Coconut milk, fresh from coconut. Ahh.", "Grub on stick. Ooga crunch!", "Lava pop. Hot hot hot. Good!"];

  let renderer, game, world, go, root, camera, hud, hooks, input, pilot, fx, agentPlay = null;
  let leaving = false, people = null, avatar = null, playerWorld = null, screens = null, shownFrame = -1, prompt = null;
  let stations = null, blocks = null, carnival = null, staff = null, orders = 0, ticketBoard = null, prizeUi = null;
  let crowd = null, spin = null;
  let audio = null, bots = null, walkers = null, motes = null, power = null, disco = null, fame = null, shelf = null, lit = null;
  let ambientT = 0, wheelTick = 0, cheerT = 0, powerT = 99;
  // Who walked in, kept across a game so they come back out as themselves, and the ticket balance at the last visit,
  // so the wheel knows when to celebrate.
  let lastPlayer = null, lastTickets = null, unsubscribeAccount = null, remotes = null;
  const NO_ACTORS = [];
  // An Ooga a signed-in player drives here is not also in the crowd or out strolling.
  const hideCrowd = (name, on) => {
    for (const list of [crowd, walkers]) if (list) for (const m of list) if (m.cave.traits.name === name) m.cave.root.visible = !on;
  };
  // On the Worker's page the island's driving rules hold in here too, and the Ooga driven is reported to the
  // room every frame, so signed-in players in the hall hear each other (voice needs a driven Ooga).
  const mayPossess = (cave) => BL.net.mayDrive(cave.traits.name, contributors.stateFor(cave.contributor) === "working");
  const mayPick = (c) => !BL.net.mayDrive(c.name, contributors.stateFor(c) === "working");
  const accountChanged = () => {
    if (!avatar) return;
    const released = BL.net.state.released;
    const denied = mayPossess(avatar) || (released && released.name === avatar.traits.name ? "That Ooga is no longer yours to drive" : null);
    BL.net.state.released = null;
    if (denied && people.player === avatar) {
      pilot.release(true);
      hud.toast(denied);
    }
  };
  const targets = [];

  // A point in a frame stood at (x, z) turned by `turn`, into the hall: the transform every placed frame uses.
  const toHall = (p, lx, lz, out) => {
    const c = Math.cos(p.turn), s = Math.sin(p.turn);
    out.x = p.x + c * lx + s * lz;
    out.z = p.z - s * lx + c * lz;
    return out;
  };
  // A rectangle in a frame, as the hall-space box that holds all four of its corners, with the range of feet heights
  // it stands in the way of: [x0, x1, z0, z1, from, to]. Floor pieces block feet on the floor and the stage.
  const FLOOR_FEET = [-1, 2], DECK_FEET = [MEZZ.y - 0.5, MEZZ.y + 2];
  const blockOf = (p, x0, x1, z0, z1, feet = FLOOR_FEET) => {
    const out = [Infinity, -Infinity, Infinity, -Infinity, feet[0], feet[1]], c = {};
    for (const [lx, lz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      toHall(p, lx, lz, c);
      out[0] = Math.min(out[0], c.x); out[1] = Math.max(out[1], c.x); out[2] = Math.min(out[2], c.z); out[3] = Math.max(out[3], c.z);
    }
    return out;
  };
  const framed = (p) => createNode({ position: { x: p.x, y: p.y || 0, z: p.z }, rotation: { x: 0, y: p.turn || 0, z: 0 } });

  // The dressing: a barrel under each stair's high end (the firewood and the coconut basket are the hall's stores,
  // `LAYOUT.stores`, in the prize ropes' geometry). The light is the hall's fires; the walls carry the Oogas'
  // paintings. One set, built once for the page.
  const dressing = models.cached(() => {
    const set = BL.dressing.set();
    set.put("barrel", 16.9, 0, -17.6, 0, 0); set.put("barrel", -16.6, 0, -17.5, 0, 1);
    return set.build();
  });

  const leaveCave = () => {
    if (leaving) return;
    leaving = true;
    go("hub");
  };
  // Into a game; a carnival machine names which of its kind (`place`), and the game comes back to it.
  const open = (id, place = null) => {
    if (leaving) return;
    leaving = true;
    go(id, place);
  };
  const play = (i) => open(GAMES[i].id);

  // The line under each loop: the visitor's best in that game, or a call to play. A retro game's best is an arcade one.
  const bestOf = (id) => {
    const s = game.state;
    if (id === "race") return s.race.cup ? `${s.race.cup.medal.toUpperCase()} CUP` : "PLAY!";
    if (id in s.arcade) return s.arcade[id] ? `HI ${s.arcade[id]}` : "PLAY!";
    const best = s[id].best;
    return best ? `HI ${best.score}` : "PLAY!";
  };
  // A carved sign scaled to `width` metres, as a node at (x, y, z) in its parent.
  const signNode = (text, icon, width, x, y, z) => {
    const geo = BL.hubModels.caveSign(text, icon), b = boundsOf(geo), k = width / (b.max[0] - b.min[0]);
    return createNode({ position: { x, y, z }, scale: { x: k, y: k, z: k }, geometry: geo });
  };
  const target = (node, owner, radius) => {
    input.add(node, owner, { radius });
    targets.push(node);
  };
  const square = (x, z, r, feet = FLOOR_FEET) => blocks.push([x - r, x + r, z - r, z + r, feet[0], feet[1]]);
  // The dressing's pieces that stand on a floor in a walker's way, blocked round their pick spheres.
  const STANDING = new Set(["barrel"]);
  // The stump's roots and ferns over the floor round its sides and back (never its front, where the visitor steps
  // up): two boxes across the stump, [half-width, reach behind its middle], one wide and one deep, both to
  // `ROOTS_FRONT` m in front of its middle, so a walker slides round them. They are in the way of feet on the floor
  // only: an Ooga on the stage may step down over the roots and walk out, but none walks in over them.
  const ROOTS = [[5.29, 3.22], [3.22, 5.29]], ROOTS_FRONT = 2.53, ROOT_FEET = [-1, STAGE.low / 2];

  // Oogas from the roster at play, each in a pose the scene animates with part rotations only: at a claw machine,
  // pinball, air hockey, skee-ball lane 2 and hoop shot 2, at the food court's tables, queueing at the snack bar and
  // cheering the cabinets from the ring's front-left, off the doorway's view of their screens. [x, z, facing, pose];
  // seated ones sit on a stool of the table they face, the air hockey pair at the two ends of their table, along its
  // `turn`.
  const H0 = LAYOUT.hockeys[0], H0X = Math.sin(H0.turn) * 1.45, H0Z = Math.cos(H0.turn) * 1.45;
  const CROWD = [
    [LAYOUT.skee[1].x, LAYOUT.skee[1].z, Math.PI, "skee"], [LAYOUT.hoops[1].x, LAYOUT.hoops[1].z, Math.PI / 2, "shoot"],
    [H0.x + H0X, H0.z + H0Z, H0.turn + Math.PI, "hockey"], [H0.x - H0X, H0.z - H0Z, H0.turn, "hockey"],
    [LAYOUT.pinball[0][0], LAYOUT.pinball[0][1] + 1.05, Math.PI, "pinball"], [LAYOUT.claws[0][0], LAYOUT.claws[0][1] + 0.95, Math.PI, "claw"],
    [LAYOUT.tables[0][0], LAYOUT.tables[0][1] + 0.85, Math.PI, "sit"], [LAYOUT.tables[1][0], LAYOUT.tables[1][1] + 0.85, Math.PI, "sit"],
    [-16.6, 2.3, 0, "queue"], [STAGE.x - 3.4, STAGE.z + 3.8, 2.41, "cheer"]
  ];
  // A sitter's hips rest on the stool's top; a standing Ooga's arms hang this far out from its middle.
  const SEAT_Y = 0.6, CROWD_REACH = 0.55;
  const build = () => {
    const hall = AM.hall(), frame = AM.signFrame(), S = LAYOUT.sign;
    addChild(root, createNode({ geometry: hall.floor }), createNode({ geometry: hall.rock }), createNode({ geometry: hall.timber }),
      createNode({ geometry: hall.outside, sightHidden: true }));
    // The fires, and the ceiling with the mammoth hung under it: each flame its own node on the one flame geometry,
    // so each flickers on its own clock; the tikis and fire bowls standing on a floor or the deck stand in the way.
    const lamps = AM.lanterns(), lampGlass = createNode({ geometry: lamps.glass, sightHidden: true });
    addChild(root, createNode({ geometry: lamps.frame }), lampGlass, createNode({ geometry: AM.ceiling() }));
    const flames = lamps.flames.map(([x, y, z, size]) => {
      const node = createNode({ position: { x, y, z }, scale: { x: size, y: size, z: size }, geometry: AM.blaze(), sightHidden: true });
      addChild(root, node);
      return { node, size };
    });
    blocks = [];
    stations = [];
    for (const [x, z, r, y] of lamps.footprints) square(x, z, r, y >= MEZZ.y ? DECK_FEET : FLOOR_FEET);
    // The stage, the fire baskets' lianas, the mezzanine and its stair.
    const st = AM.stage(), mz = AM.mezzanine(), stageNode = framed(STAGE);
    lit = { stage: createNode({ geometry: st.lit, sightHidden: true }), lanterns: lampGlass, flames };
    addChild(stageNode, createNode({ geometry: st.body }), lit.stage);
    addChild(root, stageNode);
    addChild(root, createNode({ geometry: AM.spotRods() }), createNode({ geometry: mz.body }));
    // The fire baskets over the stage, each hung where its vine ends with a flame in it that flickers with the rest.
    for (const [x, z] of AM.SPOTS) {
      const node = createNode({ position: { x, y: AM.SPOT_Y - AM.SPOT_FIRE, z }, geometry: AM.blaze(), sightHidden: true });
      addChild(root, createNode({ position: { x, y: AM.SPOT_Y, z }, geometry: AM.spotCan() }), node);
      flames.push({ node, size: 1 });
    }
    // The mezzanine's posts (their logs; the boulders at their feet reach no further than a walker's feet do), the
    // stump's roots, the dressing's barrels and the stores where they stand.
    for (const [x, z] of AM.MEZZ_POSTS) square(x, z, 0.24);
    // The back row of columns' faces, which the door and the dart boards on the back wall between them are flush with.
    const columnFace = Math.min(...AM.MEZZ_POSTS.map(([, z]) => z)) + 0.24;
    for (const [w, back] of ROOTS) blocks.push([STAGE.x - w, STAGE.x + w, STAGE.z - back, STAGE.z + ROOTS_FRONT, ...ROOT_FEET]);
    const picks = dressing().picks;
    for (let i = 0; i < picks.length; i += 6) if (STANDING.has(picks[i])) square(picks[i + 2], picks[i + 4], picks[i + 5] + 0.06, picks[i + 3] > MEZZ.y - 0.5 ? DECK_FEET : FLOOR_FEET);
    for (const [x, y, z, , , reach] of LAYOUT.stores) square(x, z, reach + 0.06, y ? DECK_FEET : FLOOR_FEET);
    // The zones' painted names and the game posters on the walls, each game painted on its hide.
    for (const [text, color, x, y, z, turn] of LAYOUT.zones) addChild(root, createNode({ position: { x, y, z }, rotation: { x: 0, y: turn, z: 0 }, geometry: AM.zoneSign(text, color), sightHidden: true }));
    for (const [x, y, z, turn, game] of LAYOUT.posters) {
      const node = createNode({ position: { x, y, z }, rotation: { x: 0, y: turn, z: 0 }, geometry: AM.posterFrame() });
      addChild(node, createNode({ position: { x: 0, y: 0, z: -0.006 }, geometry: AM.posterArt(game), sightHidden: true }));
      addChild(root, node);
    }
    const sign = signNode(AM.SIGN_FRAME.name, AM.SIGN_FRAME.icon, AM.SIGN_FRAME.w - 0.9, S.x, S.y, S.z + 0.08);
    lit.sign = createNode({ position: { x: S.x, y: S.y, z: S.z }, geometry: frame.bulbs, sightHidden: true });
    addChild(root, createNode({ position: { x: S.x, y: S.y, z: S.z }, geometry: frame.frame }), lit.sign, sign);
    target(sign, { kind: "sign" }, 3);
    // The jackpot wheel behind the live games: its face spins, its seed pods chase through a spin and flash when it
    // pays or the room celebrates.
    const W = LAYOUT.wheel, wh = AM.wheel(), wheelNode = createNode({ position: { x: W.x, y: W.y, z: W.z } });
    const face = createNode({ geometry: wh.face }), pods = wh.bulbs.map((geometry) => createNode({ geometry, sightHidden: true })), wheelFrame = createNode({ geometry: wh.frame });
    addChild(wheelNode, face, wheelFrame, ...pods);
    addChild(root, wheelNode);
    target(wheelFrame, { kind: "wheel" }, 2);
    // Its totem's plinth and ferns, down to the floor behind the stage.
    blocks.push([W.x - 0.82, W.x + 0.82, W.z - 0.9, W.z + 0.42, ...FLOOR_FEET]);
    // A spin runs `t` s of `dur` (-1 between spins) from the turn `from` to `to` and pays `value`; `hold` keeps its
    // result under the clapper a while before the face idles on; `party` is the room's celebration and `flash` the
    // pods' alone, in seconds. Its station is on the stage's front (`LAYOUT.wheel.play`).
    spin = { face, bulbs: pods, speed: 0.25, party: 0, flash: 0, t: -1, dur: 0, from: 0, to: 0, value: 0, hold: 0 };
    stations.push({ kind: "wheel", play: W.play, label: "the jackpot wheel" });
    // The cabinets: each loops its game with the best under it, then blinks PRESS START; the stage's open the Ooga
    // games, the mezzanine's their retro games (`retro`, a station on the deck at `MEZZ.y`).
    screens = [];
    // What powers up on arrival, each with its delay: the machines light in a wave from the doorway inward.
    power = [];
    const wave = (node, x, z) => power.push({ node, delay: 0.15 + Math.max(0, HALL.front - 1 - z) * 0.09 + Math.abs(x) * 0.02 });
    for (const c of LAYOUT.cabinets) {
      const on = c.game >= 0, named = on ? GAMES[c.game] : AM.RETRO[c.retro], MQ = AM.MARQUEE;
      const frames = on ? AM.attractFrames(c.game) : AM.retroFrames(c.retro), node = framed(c), body = createNode({ geometry: AM.cabinet(c.index) });
      const screen = createNode({ position: { x: 0, y: SCREEN.y, z: SCREEN.z }, rotation: { x: SCREEN.lean, y: 0, z: 0 }, geometry: frames[0], sightHidden: true, depthBias: -0.1 });
      const best = createNode({ geometry: on ? AM.bestLine(c.game, bestOf(named.id)) : AM.retroLine(c.retro, bestOf(named.id)), sightHidden: true, depthBias: -0.12 });
      addChild(screen, best);
      screens.push({ node: screen, best, frames, start: on ? AM.attractStart(c.game) : AM.retroStart(c.retro) });
      addChild(node, body, signNode(named.title, named.icon, MQ.w, 0, MQ.y, MQ.z), screen);
      addChild(root, node);
      wave(body, c.x, c.z); wave(screen, c.x, c.z);
      target(body, on ? { kind: "cabinet", game: c.game } : { kind: "retro", retro: c.retro }, 1.3);
      blocks.push(blockOf(c, -CAB.w / 2, CAB.w / 2, -CAB.d / 2, CAB.d / 2, on ? FLOOR_FEET : DECK_FEET));
      stations.push(on ? { kind: "cabinet", game: c.game, play: c.play, label: named.name } : { kind: "retro", retro: c.retro, id: named.id, play: c.play, y: c.y, label: named.name });
    }
    // Every game in the hall: each machine in its frame with its game over nodes under it, and a station in front of
    // it that opens that game at that machine. Oogas from the roster play some of them for real (`bot`), and when
    // the visitor takes one over they step aside for as long as the game lasts.
    carnival = [];
    bots = [];
    life = [];
    const machine = (p, parts, make, kind, box, index, bot, slot) => {
      // A machine whose geometry stands off its player's spot sits on a child node `dz` along, `dy` up, turned by `turn`.
      const node = framed(p), body = createNode({ geometry: parts.body }), glow = createNode({ geometry: parts.glow, sightHidden: true });
      const holder = parts.dz || parts.dy || parts.turn ? createNode({ position: { x: 0, y: parts.dy || 0, z: parts.dz || 0 }, rotation: { x: 0, y: parts.turn || 0, z: 0 } }) : node;
      addChild(holder, body, glow);
      if (parts.glass) addChild(holder, createNode({ geometry: parts.glass, sightHidden: true }));
      if (parts.lamp) addChild(holder, createNode({ geometry: parts.lamp }));
      if (holder !== node) addChild(node, holder);
      if (parts.oche) addChild(node, createNode({ geometry: AM.dartOche() }));
      addChild(root, node);
      const mid = box ? (box[2] + box[3]) / 2 : (parts.dz || 0), at = toHall(p, 0, mid, {});
      const b = bot ? { p, at, cool: 2 + bots.length * 1.5, wait: 0, spool: -1, strip: null, member: null, aim: { x: 0 } } : null;
      wave(glow, at.x, at.z);
      const s = liven(kind, glow, body, at, p.play, b);
      s.node = node;
      const host = {
        node, glow, index,
        get best() { return game.state.arcade[kind]; },
        onEnd: () => { if (b) botDone(b); },
        burst: (lx, ly, lz, count) => { const w = toHall(p, lx, lz, BURST_AT); fx.burst(w.x, ly, w.z, count, SPARKS, 2.4); },
        cue: (name) => hear(at.x, at.z, name, 0.8),
        aim: b ? b.aim : { x: 0 },
        // An Ooga's big moment at the machine: it flashes and the Oogas round it cheer.
        crack: b ? (lx, ly, lz, big) => { if (big) cheerAround(s); } : undefined
      };
      const g = make(host);
      s.g = g;
      carnival.push(g);
      if (box) blocks.push(blockOf(p, ...box));
      if (b) {
        b.g = g;
        // Its tickets spool out of the slot at `slot` in the machine's frame.
        if (slot) {
          b.strip = createNode({ position: { x: slot[0], y: slot[1], z: slot[2] }, geometry: AM.ticketStrip(), scale: { x: 1, y: 0.01, z: 1 }, visible: false, sightHidden: true });
          addChild(node, b.strip);
        }
        bots.push(b);
      }
      const station = { kind: "machine", game: g, index, bot: !!b, play: p.play, turn: p.turn, label: g.name };
      stations.push(station);
      s.station = station;
      target(body, { kind: "machine", station }, 2.2);
      return station;
    };
    const F = LAYOUT.frames;
    LAYOUT.hoops.forEach((p, i) => machine(p, AM.hoopMachine(), AG.hoopShot, "hoops", [-0.82, 0.82, -3.75, -0.15], i, i === 1, [0.62, 0.78, -0.13]));
    LAYOUT.skee.forEach((p, i) => machine(p, AM.skeeLane(), AG.skeeball, "skee", [-0.62, 0.62, -6.5, -0.09], i, i === 1, [0.42, 0.72, -0.12]));
    machine(LAYOUT.shy, AM.coconutShy(), AG.coconutShy, "shy", [-1.9, 1.9, -4.3, -0.35], 0, false);
    // The claws' blocks reach half-way to the posts either side of their bays, so the narrow gaps between the booths,
    // their scoreboards and the posts are closed rather than squeezed into. The air hockey table's scoreboards stand on
    // posts beyond its far end, wider than the table, and the pool tables' behind theirs: a block of their own.
    F.claw.forEach((p, i) => machine(p, AM.clawBooth(i), AG.clawGame, "claw", [-1.4, 1.4, -1.52, -0.28], i, i === 0));
    F.pinball.forEach((p, i) => { const t = AM.pinball(i); machine(p, { body: t.body, glow: t.lit, glass: t.glass, dz: -1.05 }, AG.pinballGame, "pinball", [-0.43, 0.43, -1.84, -0.2], i, i === 0); });
    F.hockey.forEach((p, i) => { const a = AM.airHockey(); machine(p, { body: a.body, glow: a.lit, dz: -1.75, turn: Math.PI / 2 }, AG.airHockey, "hockey", [-0.65, 0.65, -2.95, -0.55], i, i === 0); blocks.push(blockOf(p, -1.1, 1.15, -3.25, -3.06)); });
    F.pool.forEach((p, i) => { const t = AM.poolTable(i); machine(p, { body: t.body, glow: t.glow, lamp: t.lamp, dz: -1.35 }, AG.poolGame, "billiards", [-1.35, 1.35, -2.08, -0.62], i, false); blocks.push(blockOf(p, -1.03, 1.0, -2.35, -2.08)); });
    F.darts.forEach((p, i) => machine(p, { body: AM.dartBoard(), dz: -AM.DART.oche, dy: AM.DART.y, oche: true }, AG.dartsGame, "darts", null, i, false));
    // Each board hangs at a walker's height on the back wall between two columns: in the way across its hide from the
    // rock to the columns' faces, so nobody walks into it and a walker sliding along the columns catches on none.
    const boardBox = boundsOf(AM.dartBoard());
    for (const p of F.darts) blocks.push([p.x + boardBox.min[0], p.x + boardBox.max[0], HALL.back, columnFace, ...FLOOR_FEET]);
    F.ride.forEach((p, i) => machine(p, { body: AM.ride(i).base }, AG.rideGame, "ride", [-0.7, 0.7, -0.88, 0.98], i, false));
    // The doorway's token changer and ticket muncher (each in the way as far as it stands, the muncher shallower),
    // and the prize queue's ropes.
    LAYOUT.changers.forEach((p, i) => {
      const ch = AM.changer(i), node = framed(p), body = createNode({ geometry: ch.body }), lamp = createNode({ geometry: ch.lit, sightHidden: true });
      addChild(node, body, lamp);
      liven(i ? "muncher" : "totem", lamp, body, p, toHall(p, 0, 1, {}), null);
      addChild(root, node);
      target(body, { kind: i ? "muncher" : "changer" }, 1);
      blocks.push(i ? blockOf(p, -0.47, 0.47, -0.28, 0.36) : blockOf(p, -0.45, 0.45, -0.31, 0.53));
    });
    addChild(root, createNode({ geometry: AM.ropes() }));
    for (const [x0, z0, x1, z1] of LAYOUT.ropes) blocks.push([Math.min(x0, x1) - 0.08, Math.max(x0, x1) + 0.08, Math.min(z0, z1) - 0.08, Math.max(z0, z1) + 0.08, -1, 2]);
    // The snack bar and its vendor.
    const sb = AM.snackBar(), snack = framed(LAYOUT.snack), snackBody = createNode({ geometry: sb.body }), snackLit = createNode({ geometry: sb.lit, sightHidden: true });
    addChild(snack, snackBody, snackLit, createNode({ geometry: sb.glass, sightHidden: true }), signNode("Snacks", "banana", 1.8, 1.1, 5, -1.5));
    // The food court's tables, and planters of jungle in the corners, along the walls and up on the mezzanine: palms
    // and bushes from the island's kit in log stumps, the deck's palms smaller so their crowns stay under the back
    // wall's paintings.
    for (const [x, z] of LAYOUT.tables) {
      addChild(root, createNode({ position: { x, y: 0, z }, geometry: AM.table() }));
      blocks.push([x - 0.95, x + 0.95, z - 0.65, z + 1.07, ...FLOOR_FEET]);
    }
    for (const [x, z, i, y = 0, turn = 0] of LAYOUT.planters) {
      const pot = createNode({ position: { x, y, z }, rotation: { x: 0, y: turn, z: 0 }, geometry: AM.planterPot() });
      const palm = i % 2 === 0, k = palm ? (y ? 0.42 : 0.55) : 1.5;
      addChild(pot, createNode({ position: { x: 0, y: 0.58, z: 0 }, scale: { x: k, y: k, z: k }, geometry: palm ? BL.dressing.palm(i) : BL.hubModels.bush(i % 3), sightHidden: true }));
      addChild(root, pot);
      // A palm stands in the way by its stump, a bush by the round of its leaves at a walker's height.
      square(x, z, palm ? 0.5 : 0.9, y ? DECK_FEET : FLOOR_FEET);
    }
    addChild(root, snack);
    target(snackBody, { kind: "snack" }, 2.2);
    blocks.push(blockOf(LAYOUT.snack, -2.24, 2.24, -1.7, 1.22));
    const snackAt = { kind: "snack", play: toHall(LAYOUT.snack, 0, 1.6, { facing: LAYOUT.snack.turn + Math.PI }), label: "the snack bar" };
    stations.push(snackAt);
    liven("snack", snackLit, snackBody, LAYOUT.snack, snackAt.play, null).station = snackAt;
    // The prize counter by the doorway: the case of prizes, the sign and the ticket balance on a board.
    const pc = AM.prizeCounter(), prizes = framed(LAYOUT.prizes), prizeBody = createNode({ geometry: pc.body }), prizeLit = createNode({ geometry: pc.lit, sightHidden: true });
    addChild(prizes, prizeBody, createNode({ geometry: pc.glass, sightHidden: true }), prizeLit, signNode("Prizes", "banana", 1.8, 0, 4.1, -1));
    ticketBoard = AG.scoreboard(prizes, "TICKETS", 5, "#ffb347", { x: 1.2, y: 2.55, z: 0.1 }, true);
    ticketBoard.show(game.state.arcade.tickets);
    addChild(root, prizes);
    target(prizeBody, { kind: "prizes" }, 2.2);
    blocks.push(blockOf(LAYOUT.prizes, -2.3, 2.3, -1.42, 0.52));
    const prizesAt = { kind: "prizes", play: toHall(LAYOUT.prizes, 0, 1.3, { facing: LAYOUT.prizes.turn + Math.PI }), label: "the prize counter" };
    stations.push(prizesAt);
    liven("prizes", prizeLit, prizeBody, LAYOUT.prizes, prizesAt.play, null).station = prizesAt;
    // The top third: feather bunting, talking drums high on the side walls and the spirit rattle hung on a liana over
    // the stage.
    const db = AM.discoBall(), D = LAYOUT.disco;
    disco = createNode({ geometry: db.ball });
    const discoHang = createNode({ position: { x: D.x, y: D.y, z: D.z } });
    addChild(discoHang, disco, createNode({ geometry: db.chain }));
    addChild(root, createNode({ geometry: AM.pennants() }), createNode({ geometry: AM.speakers() }), discoHang);
    target(disco, { kind: "disco" }, 1);
    // The clutter of a hall in use: the tables' cups and baskets, bins, a ticket bucket, the directory by the
    // doorway and scuffed ground before the machines people play most, laid on the stage's top or the floor's mats.
    LAYOUT.tables.forEach(([x, z], i) => addChild(root, createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: i * 1.9, z: 0 }, geometry: AM.tableProps(i % 2) })));
    for (const [x, z] of LAYOUT.bins) { addChild(root, createNode({ position: { x, y: 0, z }, rotation: { x: 0, y: x, z: 0 }, geometry: AM.trashBin() })); square(x, z, 0.32); }
    for (const [x, z] of LAYOUT.buckets) { addChild(root, createNode({ position: { x, y: 0, z }, geometry: AM.ticketBucket() })); square(x, z, 0.18); }
    const BD = LAYOUT.backDoor, door = createNode({ position: { x: BD.x, y: 0, z: BD.z }, geometry: AM.backDoor() }), doorBox = boundsOf(door.geometry);
    addChild(root, door);
    target(door, { kind: "door" }, 1.4);
    // The door and its frame stand out of the back wall's rock; the block stops a few cm short of the frame's face (a
    // walker's torso stops short of its square), flush with the columns' blocks either side, so a walker sliding along
    // the wall past the door and the columns catches on neither.
    blocks.push([BD.x + doorBox.min[0], BD.x + doorBox.max[0], BD.z + doorBox.min[2], columnFace, ...FLOOR_FEET]);
    const Dr = LAYOUT.directory;
    addChild(root, createNode({ position: { x: Dr.x, y: Dr.y, z: Dr.z }, rotation: { x: 0, y: Dr.turn, z: 0 }, geometry: AM.directory(), sightHidden: true }));
    for (const p of [...live.map((c) => c.play), LAYOUT.skee[0].play, LAYOUT.hoops[0].play, LAYOUT.frames.claw[1].play, LAYOUT.shy.play, ...LAYOUT.frames.darts.map((p) => p.play)]) addChild(root, createNode({ position: { x: p.x, y: supportAt(p.x, p.z, 1) || AM.MAT_Y, z: p.z }, geometry: AM.wornPatch(), sightHidden: true }));
    // The prize shelf: every prize, shown once it is won.
    const Sh = LAYOUT.shelf, shelfNode = createNode({ position: { x: Sh.x, y: Sh.y, z: Sh.z }, rotation: { x: 0, y: Sh.turn, z: 0 }, geometry: AM.prizeShelf() });
    shelf = AM.PRIZES.map((pz, i) => createNode({ position: { x: (i - (AM.PRIZES.length - 1) / 2) * AM.PRIZE_SHELF, y: 0.035 - boundsOf(AM.prize(i)).min[1], z: 0 }, geometry: AM.prize(i) }));
    addChild(shelfNode, ...shelf);
    addChild(root, shelfNode);
    // Embers in the firelight: a fixed pool drifting up over the stage, the celebrations' sparks at half their size.
    motes = [];
    for (let i = 0; i < MOTES; i++) { const n = createNode({ geometry: AM.spark(0), scale: { x: 0.5, y: 0.5, z: 0.5 }, sightHidden: true }); addChild(root, n); motes.push({ node: n, a: 0.2 + (i * 0.37) % 0.4, b: 0.15 + (i * 0.53) % 0.3, p: i * 2.39 }); }
  };
  const MOTES = 36;
  // The Oogas at play: the roster's own, never the visitor, in turn round the spots.
  const seatCrowd = (playerName) => {
    crowd = [];
    walkers = [];
    const names = contributors.activeRoster.map((c) => c.name).filter((n) => n !== playerName);
    if (!names.length) return;
    CROWD.forEach(([x, z, facing, pose], i) => {
      const cave = models.caveman(contributors.traitsFor(names[i % names.length])), feet = supportAt(x, z, 1);
      if (cave.parts.gun) cave.parts.gun.visible = false;
      const base = pose === "sit" ? SEAT_Y : cave.root.position.y + feet;
      Object.assign(cave.root.position, { x, y: base, z });
      cave.root.rotation.y = facing;
      if (pose === "sit") cave.parts.legR.rotation.x = cave.parts.legL.rotation.x = -1.45;
      addChild(root, cave.root);
      crowd.push({ cave, pose, facing, t: i * 1.37, x, z, y: base, wave: 0, greet: 0, swing: 0, cheer: 0 });
      // Each is in the way as far as its hanging arms reach, a sitter by its stool's side of the table.
      square(x, z, pose === "sit" ? 0.45 : CROWD_REACH, [feet - 1, feet + 2]);
    });
    // Each played machine's Ooga, so it swings when the game takes its shot and cheers at the end.
    for (const b of bots) b.member = crowd.find((m) => Math.hypot(m.x - b.p.x, m.z - b.p.z) < 0.1) || null;
    // Walkers: a few more Oogas strolling a loop round the stage, stopping to watch the claws and the lanes.
    for (let i = 0; i < WALKERS; i++) {
      const cave = models.caveman(contributors.traitsFor(names[(CROWD.length + i) % names.length]));
      if (cave.parts.gun) cave.parts.gun.visible = false;
      addChild(root, cave.root);
      walkers.push({ cave, s: i * LOOP_LEN / WALKERS, dir: i % 2 ? -1 : 1, pause: 0, leg: i, base: cave.root.position.y, x: 0, z: 0, wave: 0, greet: 0, cheer: 0 });
    }
  };
  // The walkers' loop, clear of everything on the floor, and where they stop: [x, z, seconds].
  const LOOP = [[-1.4, 3.2, 0], [-2.8, -1.4, 0], [-7, -3.4, 0], [-7.6, -9.4, 2.5], [-4.6, -13.9, 0], [-2.2, -16.6, 3], [2.2, -16.6, 0], [4.6, -13.9, 0], [7.2, -10.4, 2.5], [7.3, -4.4, 0], [3, -2.6, 0], [1.4, 3.2, 0]];
  const LOOP_AT = [0];
  for (let i = 1; i <= LOOP.length; i++) { const a = LOOP[i - 1], b = LOOP[i % LOOP.length]; LOOP_AT.push(LOOP_AT[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const LOOP_LEN = LOOP_AT[LOOP.length], WALKERS = 3, WALK_SPEED = 1.05;
  // The hall of fame: each game's best as the roster would have it (a score hashed from each Ooga's name, so it is
  // the same every visit), beaten by the visitor's own best where theirs is higher, under their Ooga's initials.
  const FAME_GAMES = [["THRO", "skee", 120, 420, 10], ["HOOP", "hoops", 18, 70, 1], ["TOSS", "shy", 5, 20, 1], ["CLAW", "claw", 25, 110, 5]];
  const initials = (name) => (name.toUpperCase().replace(/[^A-Z0-9]/g, "") + "OOG").slice(0, 3);
  const hangFame = (playerName) => {
    const names = contributors.activeRoster.map((c) => c.name).filter((n) => n !== playerName), rows = [];
    for (const [label, kind, lo, hi, step] of FAME_GAMES) {
      let who = "OOG", best = 0;
      for (const n of names) {
        const v = Math.round((lo + (math.fnv1a(n + kind) % 1000) / 1000 * (hi - lo)) / step) * step;
        if (v > best) { best = v; who = initials(n); }
      }
      const mine = game.state.arcade[kind];
      rows.push(playerName && mine >= best && mine > 0 ? [label, initials(playerName), mine, true] : [label, who, best, false]);
    }
    const F = LAYOUT.fame, frame = AM.fameFrame();
    fame = createNode({ position: { x: F.x, y: F.y, z: F.z }, rotation: { x: 0, y: F.turn, z: 0 } });
    addChild(fame, createNode({ geometry: frame.frame }), createNode({ geometry: frame.bulbs, sightHidden: true }), createNode({ position: { x: 0, y: 0, z: 0.01 }, geometry: AM.fameBoard(rows), sightHidden: true }));
    addChild(root, fame);
    target(fame.children[0], { kind: "fame" }, 2);
  };
  const showShelf = () => { const owned = game.state.arcade.prizes; for (let i = 0; i < shelf.length; i++) shelf[i].visible = owned.includes(AM.PRIZES[i].id); };
  // Every score, win and the jackpot throws embers, as a fire does.
  const BURST_AT = { x: 0, z: 0 }, SPARKS = [0, 1, 2].map((i) => AM.spark(i));

  const useStation = (s) => {
    if (s.kind === "cabinet") play(s.game);
    else if (s.kind === "retro") open(s.id, 0);
    else if (s.kind === "machine") open(s.game.kind, s.index);
    else if (s.kind === "prizes") openPrizes();
    else if (s.kind === "wheel") spinWheel();
    else order();
  };
  // The prize counter's dialog: the balance and each prize, redeemable when it is not won yet and the tickets cover it;
  // and the TICKETS board. Both show the balance without a turning spin's win (`shownTickets`).
  const renderPrizes = () => {
    const a = game.state.arcade, tickets = shownTickets();
    prizeUi.tickets.textContent = String(tickets);
    for (const li of prizeUi.items) {
      const id = li.dataset.prize, cost = Number(li.querySelector(".prize-buy").dataset.cost), owned = a.prizes.includes(id), btn = li.querySelector(".prize-buy");
      li.dataset.owned = String(owned);
      btn.textContent = owned ? "Yours!" : "Trade";
      btn.disabled = owned || tickets < cost;
    }
    ticketBoard.show(tickets);
  };
  const openPrizes = () => {
    if (!prizeUi.panel.hidden) return;
    renderPrizes();
    prizeUi.panel.hidden = false;
    pilot.setActive(false);
    staff.clerk.poke();
  };
  const closePrizes = () => {
    if (prizeUi.panel.hidden) return;
    prizeUi.panel.hidden = true;
    pilot.setActive(true);
  };
  const onPrizeClick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    b.blur();
    if (b.classList.contains("prize-close")) return closePrizes();
    const id = b.dataset.prize, prize = AM.PRIZES.find((p) => p.id === id);
    if (!prize || !game.redeem(id, prize.cost)) return;
    renderPrizes();
    hud.toast(`${prize.name}! Yours now. Ooga proud!`);
    const w = toHall(LAYOUT.prizes, 0, 0, {});
    fx.burst(w.x, 2.2, w.z, 36, SPARKS, 2.6);
    staff.clerk.poke();
    hear(w.x, w.z, "bell");
    showShelf();
  };
  const order = () => {
    staff.vendor.poke();
    hud.toast(ORDERS[orders++ % ORDERS.length]);
    const w = toHall(LAYOUT.snack, 0, 0, {});
    hear(w.x, w.z, "crunch");
  };

  // ---- the jackpot wheel -----------------------------------------------------------------------------------
  // A spin costs `WHEEL_COST` tickets (`game.spendTickets`, which spends nothing when they fall short) and pays the
  // wedge the clapper stops on. The wedge is drawn with the crypto `randomInt` before the face moves (where in the
  // wedge it stops and how long it runs are cosmetic) and its tickets are saved with the charge, so a page lost
  // mid-spin loses none; the boards show them only at the stop (`shownTickets`). Then the face is launched hard and eased out on a cubic over 4.6 to 5.6 s to
  // rest with the clapper on that wedge (`AM.wheelStop`, `WHEEL_TURNS` whole turns and a part), the clapper ticking
  // at each peg, higher as it slows, and the pods chasing (`update`). The visitor turns to it and the view swings in
  // behind them, level, as a game's camera dollies in on its start (first person keeps its own view: the station's
  // spot is where the whole wheel shows over the cabinets' crowns). One spin at a time; a visitor who leaves while
  // one turns hears of its win on the way back in, with the room's welcome for more tickets (`leave`, `enter`).
  const WHEEL_TURNS = 3;
  const WHEEL_SORRY = ["Aww. Wheel stingy. Spin again?", "Small tickets. Big one next time!", "Wheel tease you. Ooga try again!"];
  let sorry = 0;
  const shownTickets = () => game.state.arcade.tickets - (spin.t >= 0 ? spin.value : 0);
  const spinWheel = () => {
    if (spin.t >= 0) return;
    const W = LAYOUT.wheel, p = avatar.root.position, o = pilot.orbit;
    if (!game.spendTickets(AM.WHEEL_COST)) return hud.toast(`Need ${AM.WHEEL_COST} tickets to spin`);
    const wedge = math.randomInt(AM.WHEEL_VALUES.length);
    spin.value = AM.WHEEL_VALUES[wedge];
    spin.from = spin.face.rotation.z;
    spin.to = AM.wheelStop(spin.from, wedge, 0.2 + Math.random() * 0.6, WHEEL_TURNS);
    spin.dur = 4.6 + Math.random();
    spin.t = spin.hold = 0;
    game.addTickets(spin.value);
    renderPrizes();
    const h = Math.atan2(W.x - p.x, W.z - p.z);
    avatar.root.rotation.y = h;
    // Not through the Ooga's own eyes (the camera at its head), where the view is the visitor's alone.
    if (Math.hypot(camera.position.x - p.x, camera.position.z - p.z) > 1) {
      o.tYaw = o.yaw + Math.atan2(Math.sin(h + Math.PI - o.yaw), Math.cos(h + Math.PI - o.yaw));
      o.tPitch = WHEEL_PITCH;
    }
    hear(p.x, p.z, "coin");
    hear(W.x, W.z, "swish", 1.2);
    crewSays(staff[0], "Round and round! Where stop?");
  };
  // Where it stopped: its tickets (saved at the draw) on the boards, the toast, and a party as big as the win. The
  // pods flash for any; at or over the cost the room lights up, embers fly from the wheel and the room cheers with the
  // gamemaster, the jackpot longest and biggest with the chant; under it the gamemaster waves a kind word instead.
  const payWheel = () => {
    const v = spin.value, W = LAYOUT.wheel, jackpot = v === WHEEL_JACKPOT, big = v >= AM.WHEEL_COST;
    spin.t = -1;
    spin.hold = 4;
    spin.speed = 0;
    renderPrizes();
    hud.toast(`BIG SPIN: +${v} ticket${v === 1 ? "" : "s"}!${jackpot ? " JACKPOT!" : ""}`);
    hear(W.x, W.z, "spit", 1.2);
    spin.flash = jackpot ? 6 : big ? 3 : 1.5;
    if (!big) return hostSays(WHEEL_SORRY[sorry++ % WHEEL_SORRY.length], false);
    spin.party = spin.flash;
    fx.burst(W.x, W.y, W.z + 0.4, jackpot ? 70 : 30, SPARKS, jackpot ? 3.2 : 2.4);
    roomCheers();
    hostSays(jackpot ? "JACKPOT! Ooga rich!" : "Big spin! Good win, Ooga!", true);
    if (jackpot) hear(W.x, W.z + 3, "ooga", 1.2);
  };

  // ---- the hall's sound ----------------------------------------------------------------------------------
  // A sound at (x, z) in the hall, as the visitor hears it: quieter with distance and panned to the side it is on
  // from the camera's view, its tones `pitch` times as high. Allocation-free.
  const HEAR_RANGE = 16;
  const hear = (x, z, name, loud = 1, pitch = 1) => {
    if (!audio) return;
    const L = avatar ? avatar.root.position : pilot.orbit.target, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    const k = Math.max(0, 1 - d / HEAR_RANGE), fx0 = camera.target.x - camera.position.x, fz0 = camera.target.z - camera.position.z, fl = Math.hypot(fx0, fz0) || 1;
    const side = d > 0.2 ? clamp((dx * -fz0 + dz * fx0) / (fl * d), -1, 1) * 0.8 : 0;
    audio.cue(name, loud * k * k, side, pitch);
  };
  // The hall's chatter between the events, every second or so from somewhere: a machine at work, or an Ooga at the
  // tables, the snack bar or the shy grunting, laughing or cheering.
  const AMBIENT = [
    ...LAYOUT.changers.map((p) => [p.x, p.z, "coin", 0.6]), ...LAYOUT.hockeys.map((h) => [h.x, h.z, "clack", 0.7]), ...LAYOUT.pools.map((p) => [p.x, p.z, "clack", 0.5]),
    ...LAYOUT.pinball.map(([x, z]) => [x, z, "flip", 0.7]), ...AM.CABINETS.filter((c) => c.game >= 0).map((c) => [c.x, c.z, "ding", 0.5]),
    [LAYOUT.tables[0][0], LAYOUT.tables[0][1], "cheer", 0.35], [LAYOUT.claws[0][0], LAYOUT.claws[0][1], "whirr", 0.6],
    [LAYOUT.tables[1][0], LAYOUT.tables[1][1], "laugh", 0.5], [LAYOUT.tables[0][0], LAYOUT.tables[0][1], "grunt", 0.5],
    [LAYOUT.snack.x, LAYOUT.snack.z, "grunt", 0.45], [LAYOUT.shy.x, LAYOUT.shy.z, "laugh", 0.4]
  ];
  const ambience = (dt) => {
    ambientT -= dt;
    if (ambientT > 0) return;
    ambientT = 0.45 + Math.random() * 1.1;
    const [x, z, name, loud] = AMBIENT[Math.floor(Math.random() * AMBIENT.length)];
    hear(x, z, name, loud);
  };

  // ---- the Oogas who play for real ------------------------------------------------------------------------
  // A played machine's Ooga starts a game, then takes each shot when the game offers it: skee-ball's aim at once
  // and its roll with the meter near the green, a hoop shot with the meter near the green, so it scores like a good
  // player with the odd miss. At the end its tickets spool out, it cheers, and after a breather it plays again.
  const playBots = (dt) => {
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i], g = b.g, st = g.status;
      if (b.spool >= 0) {
        b.spool += dt;
        if (b.strip) b.strip.scale.y = Math.min(0.9, b.spool * 0.7) + 0.01;
        if (b.spool > 4.5) { b.spool = -1; if (b.strip) b.strip.visible = false; }
      }
      if (!g.playing) {
        b.cool -= dt;
        if (b.cool <= 0) { g.attract(0, 0); g.start(); b.wait = 0.8; hear(b.at.x, b.at.z, "coin", 0.7); }
        continue;
      }
      if (g.kind === "hockey") b.aim.x = Math.max(-1, Math.min(1, g.puckU * 1.1));
      b.wait -= dt;
      if (b.wait > 0 || !st.verb) continue;
      const slop = 0.06, inWindow = st.meter >= st.window0 - slop && st.meter <= st.window1 + slop;
      if (st.meter >= 0 && !inWindow) continue;
      g.act();
      b.wait = 0.5 + Math.random() * 0.9;
      if (b.member) b.member.swing = 1;
    }
  };
  const botDone = (b) => {
    b.cool = 5;
    b.spool = 0;
    if (b.strip) { b.strip.visible = true; b.strip.scale.y = 0.01; }
    hear(b.at.x, b.at.z, "spit", 0.9);
    if (b.member) b.member.wave = 2;
  };

  // ---- the walkers, greetings and cheers ---------------------------------------------------------------------
  const walk = (dt, elapsed) => {
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i], P = w.cave.parts, r = w.cave.root;
      if (w.pause > 0) w.pause -= dt;
      else {
        const before = w.s;
        w.s = (w.s + w.dir * WALK_SPEED * dt + LOOP_LEN) % LOOP_LEN;
        // A stop at a waypoint it just passed.
        for (let k = 0; k < LOOP.length; k++) if (LOOP[k][2] && ((w.dir > 0 && before < LOOP_AT[k] && w.s >= LOOP_AT[k]) || (w.dir < 0 && before > LOOP_AT[k] && w.s <= LOOP_AT[k]))) w.pause = LOOP[k][2];
      }
      let k = 0;
      while (k < LOOP.length - 1 && LOOP_AT[k + 1] <= w.s) k++;
      const a = LOOP[k], b = LOOP[(k + 1) % LOOP.length], t = (w.s - LOOP_AT[k]) / (LOOP_AT[k + 1] - LOOP_AT[k]);
      w.x = a[0] + (b[0] - a[0]) * t; w.z = a[1] + (b[1] - a[1]) * t;
      r.position.x = w.x; r.position.z = w.z; r.position.y = w.base;
      const moving = w.pause <= 0, stride = moving ? Math.sin(elapsed * 7 + w.leg) * 0.55 : 0;
      r.rotation.y = Math.atan2((b[0] - a[0]) * w.dir, (b[1] - a[1]) * w.dir);
      P.legR.rotation.x = stride; P.legL.rotation.x = -stride;
      P.armR.rotation.x = -stride * 0.6;
      P.armL.rotation.x = w.wave > 0 || w.cheer > 0 || cheerT > 0 ? -2.6 + Math.sin(elapsed * 12) * 0.3 : stride * 0.6;
      w.wave = Math.max(0, w.wave - dt);
      w.cheer = Math.max(0, w.cheer - dt);
    }
  };
  // Any Ooga the visitor walks up to waves and says hello, once in a while; every Ooga cheers when the room does.
  const HELLOS = ["Ooga!", "Ooga booga!", "Claw sneaky. You try!", "Me beat your score!", "Coconut go bonk!", "Fire warm. Games fun.", "Ooga ooga!", "Me want crown prize!", "Hoo hoo! Welcome!", "Spin wheel! Maybe jackpot!"];
  let hello = 0;
  // Ooga m at (x, y, z), dt on, with the visitor at p.
  const hail = (m, x, y, z, p, dt) => {
    m.greet = Math.max(0, m.greet - dt);
    if (m.greet > 0 || Math.abs(x - p.x) > 2.2 || Math.abs(z - p.z) > 2.2 || Math.hypot(x - p.x, z - p.z) > 2.2) return;
    m.greet = 14;
    m.wave = 1.6;
    fx.sayAt(x, y + 2.2, z, HELLOS[hello++ % HELLOS.length], 1.8);
    hear(x, z, "grunt", 0.7);
  };
  const greet = (dt) => {
    cheerT = Math.max(0, cheerT - dt);
    if (!avatar) return;
    const p = avatar.root.position;
    for (let i = 0; i < crowd.length; i++) { const m = crowd[i]; hail(m, m.x, m.y, m.z, p, dt); }
    for (let i = 0; i < walkers.length; i++) { const w = walkers[i]; hail(w, w.x, 0, w.z, p, dt); }
  };
  const roomCheers = () => {
    cheerT = 3;
    const W = LAYOUT.wheel;
    hear(W.x, W.z, "bell");
    hear(W.x, W.z + 3, "cheer");
  };

  // ---- light moments ---------------------------------------------------------------------------------------
  // Arriving from the island the room powers up: each machine flickers on in a wave from the doorway. The sign's
  // torches flicker and the stump's fungi breathe slowly, and the hall's flames and gourds flicker each on its own
  // clock; during a celebration the fungi flash, the torches flare, the fires leap and the spirit rattle over the
  // stage turns faster. Embers drift up over the stage all the time. Allocation-free.
  const lights = (dt, elapsed) => {
    if (powerT < 4) {
      powerT += dt;
      for (let i = 0; i < power.length; i++) {
        const q = power[i], t = powerT - q.delay;
        q.node.glow = powerT >= 4 ? 1 : t < 0 ? 0.08 : t < 0.35 ? (Math.floor(t * 28) & 1 ? 1 : 0.15) : 1;
      }
    }
    const party = spin.party > 0;
    lit.stage.glow = party ? (Math.floor(elapsed * 10) & 1 ? 1.5 : 0.4) : 0.9 + Math.sin(elapsed * 1.3) * 0.1;
    lit.sign.glow = (party ? 1.35 : 0.92) + Math.sin(elapsed * 11) * 0.05 + Math.sin(elapsed * 17.3) * 0.04;
    lit.lanterns.glow = (party ? 1.25 : 0.94) + Math.sin(elapsed * 7.3) * 0.05 + Math.sin(elapsed * 13.1) * 0.03;
    // Each flame licks up and settles on its own clock, brighter and taller while the room celebrates.
    for (let i = 0; i < lit.flames.length; i++) {
      const f = lit.flames[i], k = Math.sin(elapsed * 11 + i * 2.3) * 0.07 + Math.sin(elapsed * 17.3 + i * 1.1) * 0.05 + (party ? 0.15 : 0);
      f.node.scale.y = f.size * (1 + k);
      f.node.scale.x = f.node.scale.z = f.size * (1 - k * 0.4);
      f.node.glow = 1 + k * 1.5;
    }
    disco.rotation.y += dt * (party ? 0.8 : 0.3);
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i], n = m.node.position, t = elapsed * m.a + m.p;
      n.x = Math.sin(t) * 2.8 + Math.sin(t * 2.3) * 0.4;
      n.y = 1.2 + ((elapsed * m.b * 0.25 + m.p) % 1) * 6.5;
      n.z = STAGE.z + Math.cos(t * 0.8) * 2.4;
    }
  };

  // ---- the stations' life ----------------------------------------------------------------------------------
  // Every carnival machine, the snack bar, the prize counter and the doorway's totem and muncher, alive all the time.
  // Nobody at one: its lit parts breathe, the machines of a kind in a chase along their row, and an idle machine runs
  // its game's `attract` with its showpiece (`tease`) every so often. The visitor walking up to one (within `INVITE`
  // m of its play spot, as far as Space reaches, on the floor) lights it warm and the prompt names it, and the first
  // time in a while it plays its showpiece and a short call and the nearest Ooga or gorilla calls them over. A big
  // moment at a machine an Ooga plays (its game's `crack`) flashes it and the Oogas round it cheer; coming back from a
  // machine with more tickets flashes that one. Allocation-free.
  const INVITE = 2.2, CALL_GAP = 7, COOL = 20, CHEER_R = 6;
  const CALLS = {
    skee: "Thro-ball! Roll coconut up!", hoops: "Hoop! Coconut in basket!", shy: "Coconut Toss! Bonk them off!", claw: "Claw sneaky. Grab idol!",
    pinball: "Pinball! Flip coconut!", hockey: "Air hockey! Beat Ooga!", billiards: "Pool! Sink coconuts!", darts: "Darts! Hit bull, Ooga!",
    ride: "Ride beast! Bump to drum!", snack: "Hungry? Snack bar!", prizes: "Tickets buy prizes!"
  };
  let life = null, invited = null, callT = 0;
  // One of them: its kind, game (none for the counters, totem and muncher), lit node, body and frame, the Ooga playing
  // it if any, its middle and play spot, its place in its row, and the running numbers.
  const liven = (kind, glow, body, at, play, bot) => {
    const s = { kind, g: null, glow, body, node: body, bot, station: null, x: at.x, z: at.z, px: play.x, pz: play.z, row: 0, k: 0, hot: 0, flash: 0, cool: 0, cheer: 0, next: 0, wrote: -1 };
    for (let i = 0; i < life.length; i++) if (life[i].kind === kind) s.row++;
    s.next = 3 + s.row * 2.3 + Math.random() * 5;
    life.push(s);
    return s;
  };
  // A big moment at s: it flashes, and the Oogas within `CHEER_R` m (not the one playing it) cheer, a few seconds apart.
  const cheerAround = (s) => {
    s.flash = Math.max(s.flash, 1.2);
    if (s.cheer > 0) return;
    s.cheer = 4;
    const who = s.bot.member;
    for (let i = 0; i < crowd.length; i++) { const m = crowd[i]; if (m !== who && Math.abs(m.x - s.x) + Math.abs(m.z - s.z) < CHEER_R) m.cheer = 2; }
    for (let i = 0; i < walkers.length; i++) { const w = walkers[i]; if (Math.abs(w.x - s.x) + Math.abs(w.z - s.z) < CHEER_R) w.cheer = 2; }
    hear(s.x, s.z, "cheer", 0.5);
  };
  // The nearest Ooga at play or strolling (not one who has just said hello) or gorilla on the floor not already
  // speaking, within 8 m of s's play spot, calls the visitor over, and that counts as its hello. True if one did.
  const callOver = (s) => {
    let best = 64, m = null, g = null;
    for (let i = 0; i < crowd.length + walkers.length; i++) {
      const o = i < crowd.length ? crowd[i] : walkers[i - crowd.length], d = (o.x - s.px) * (o.x - s.px) + (o.z - s.pz) * (o.z - s.pz);
      if (d < best && o.greet < 11) { best = d; m = o; }
    }
    if (crewSay <= 0) for (let i = 0; i < staff.length; i++) {
      const o = staff[i], q = o.agent.root.position, d = (q.x - s.px) * (q.x - s.px) + (q.z - s.pz) * (q.z - s.pz);
      if (!o.deck && d < best) { best = d; g = o; }
    }
    if (g) { crewSays(g, CALLS[s.kind]); g.greetCool = Math.max(g.greetCool, 30); }
    else if (m) { m.wave = 1.6; m.greet = 14; fx.sayAt(m.x, (m.pose ? m.y : 0) + 2.2, m.z, CALLS[s.kind], 2); }
    return g !== null || m !== null;
  };
  const stationLife = (dt, elapsed) => {
    callT = Math.max(0, callT - dt);
    const q = avatar && !leaving && feetOf() < 1 ? avatar.root.position : null, near = q ? nearStation(q.x, q.z, INVITE) : null;
    let now = null;
    for (let i = 0; i < life.length; i++) {
      const s = life[i], g = s.g, playing = g !== null && g.playing;
      // Invited: its station is the nearest to the visitor, or the visitor stands by the totem or the muncher.
      const on = q !== null && (s.station !== null ? s.station === near : (q.x - s.px) * (q.x - s.px) + (q.z - s.pz) * (q.z - s.pz) < INVITE * INVITE);
      if (on && s.station !== null) now = s;
      s.hot += ((on ? 1 : 0) - s.hot) * Math.min(1, dt * 5);
      s.flash = Math.max(0, s.flash - dt); s.cool = Math.max(0, s.cool - dt); s.cheer = Math.max(0, s.cheer - dt);
      if (g !== null) {
        if (playing) s.k = 0;
        else {
          s.k = Math.min(1, s.k + dt * 0.8);
          g.attract(dt, s.k);
          if ((s.next -= dt) <= 0) { s.next = 8 + Math.random() * 10; g.tease(); if (s.bot) s.bot.cool = Math.max(s.bot.cool, 2); }
        }
      } else if ((s.next -= dt) <= 0) { s.next = 4 + Math.random() * 5; s.flash = Math.max(s.flash, 0.3); }
      if (powerT < 4) continue;
      // Its lights: steady while an Ooga plays it, else breathing along its row; warm and bright while invited, blinking
      // through a flash. A game's own flash on a score (a glow written since this wrote one) stands.
      const f = Math.min(1, s.flash), blink = f > 0 ? (Math.floor(elapsed * 12) & 1 ? 1 : 0.4) * f : 0;
      const glow = (playing ? 1 : 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(elapsed * 1.7 - s.row * 1.2))) + s.hot * 1.5 + blink * 2;
      const high = Math.max(s.hot * (0.6 + 0.15 * Math.sin(elapsed * 5)), blink * 0.9);
      if (s.glow.geometry) {
        const g0 = s.glow.glow;
        s.glow.glow = s.wrote = g0 !== s.wrote && g0 > glow ? g0 : glow;
        s.glow.highlight = high;
        s.body.highlight = high * 0.22;
      } else {
        // No lit parts (the dart boards, the rides): the machine and what its game stands in its frame (the beast) warm.
        s.body.highlight = high * 0.45;
        for (let c = 0; c < s.node.children.length; c++) s.node.children[c].highlight = high * 0.45;
      }
    }
    // A station the visitor has just walked up to: its showpiece, a short call and an Ooga calling them over, unless it
    // had them lately.
    if (now !== invited) {
      invited = now;
      if (now && now.cool <= 0) {
        now.cool = COOL;
        if (now.g !== null && !now.g.playing) { now.g.tease(); now.next = Math.max(now.next, 8); if (now.bot) now.bot.cool = Math.max(now.bot.cool, 2); }
        hear(now.px, now.pz, "star0", 0.6);
        if (callT <= 0 && callOver(now)) callT = CALL_GAP;
      }
    }
  };

  // The arcade plays like Ooga Mine: the Ooga walks empty-handed with the camera behind, so the weapon keys do
  // nothing here and a right-click never aims. Registered before the pilot's listeners, in the capture phase.
  const WEAPON_KEYS = new Set(["1", "2", "r"]);
  const armsKeys = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !WEAPON_KEYS.has(e.key.toLowerCase())) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const rightClick = (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  let canvasEl = null;
  const toggleMute = () => { const off = audio.setMuted(!audio.muted); hud.toast(off ? "Sound off" : "Sound on"); };
  const onKey = (e) => {
    if (e.key === "m" || e.key === "M") {
      toggleMute();
      return true;
    }
    if (e.key === "Escape" && !prizeUi.panel.hidden) {
      closePrizes();
      return true;
    }
    if (e.key === "Escape") {
      leaveCave();
      return true;
    }
    return false;
  };
  const onDonation = () => {};
  const onLootCleared = () => {};

  // Point lights, most important first so the lowest tier (ten) keeps them, warm lamp light first and the games'
  // colours small: the big sign, the fire baskets' glow on the stage, the four live screens, the wheel, the snack bar
  // and the shy; then (twenty) the prize counter, the lanes, the hoops, the machines under the mezzanine, the dark row and the
  // doorway, lit by its torches. The hall's fires share what is left by nearness to the view (`glowNear`), as the
  // Lightning Factory's lanterns do: [reach, r, g, b] for a torch, a fire bowl and a gourd (`lanterns().kinds`).
  const FIRE_GLOW = [[7.5, 1.45, 0.8, 0.36], [9, 1.6, 0.8, 0.32], [7.5, 1.3, 0.8, 0.4]];
  let fixedLights = 0, poolScore = null;
  const lightUp = () => {
    const l = RENDER_OPTS.lights;
    let n = 0;
    const lamp = (x, y, z, radius, r, g, b) => {
      const o = n++ * 8;
      l[o] = x; l[o + 1] = y; l[o + 2] = z; l[o + 3] = radius; l[o + 4] = r; l[o + 5] = g; l[o + 6] = b; l[o + 7] = 0;
    };
    const at = (p, lx, lz, y, radius, r, g, b) => { const w = toHall(p, lx, lz, {}); lamp(w.x, y, w.z, radius, r, g, b); };
    lamp(LAYOUT.sign.x, LAYOUT.sign.y, LAYOUT.sign.z + 2, 11, 1.3, 0.78, 0.45);
    lamp(-1.1, 4, -7, 9, 1.35, 0.98, 0.62);
    lamp(1.1, 4, -7, 9, 1.35, 0.98, 0.62);
    for (const c of live) { const [r, g, b] = GAMES[c.game].light; lamp(c.x, c.y + 1.5, c.z + 1.1, 3.2, r * 0.7, g * 0.7, b * 0.7); }
    lamp(LAYOUT.wheel.x, LAYOUT.wheel.y, LAYOUT.wheel.z + 1.3, 5.5, 1.2, 0.85, 0.5);
    at(LAYOUT.snack, 0, 0.6, 2.4, 7, 1.2, 0.85, 0.5);
    at(LAYOUT.shy, 0, -1.4, 2.6, 9.5, 1.4, 0.95, 0.6);
    at(LAYOUT.prizes, 0, 0.4, 2.6, 6.5, 1.2, 0.8, 0.6);
    for (const p of LAYOUT.skee) at(p, 0, -3.2, 2.4, 7.5, 1.2, 0.84, 0.6);
    for (const p of LAYOUT.hoops) at(p, 0, -2.4, 2.8, 6, 1.1, 0.7, 0.4);
    lamp(0, 1.9, -20.4, 7, 0.9, 0.7, 0.9);
    lamp(-7.8, 1.9, -16.5, 6, 1.1, 0.8, 0.5);
    lamp(7.8, 1.9, -16.5, 6, 0.7, 0.85, 1);
    lamp(-3.5, MEZZ.y + 2.2, -16.5, 6.5, 1.1, 0.8, 0.55);
    lamp(3.5, MEZZ.y + 2.2, -16.5, 6.5, 1.1, 0.8, 0.55);
    lamp(0, 2.8, HALL.front - 1, 6, 1.2, 0.68, 0.32);
    lamp(LAYOUT.backDoor.x, 2.4, LAYOUT.backDoor.z + 0.8, 4.5, 1.2, 0.85, 0.5);
    fixedLights = n;
    RENDER_OPTS.lightCount = Math.min(BL.glRenderer.POINT_LIGHT_CAPACITY, n + AM.lanterns().lights.length / 3);
  };
  // The shared slots go to the fires nearest the view, nearest first, by repeated minimum: no sort, no list. Each
  // flickers, its light's strength wavering on its own clock.
  const glowNear = (elapsed) => {
    const F = AM.lanterns(), P = F.lights, n = P.length / 3, t = pilot.orbit.target, L = RENDER_OPTS.lights;
    if (!poolScore) poolScore = new Float32Array(n);
    for (let i = 0; i < n; i++) { const o = i * 3, dx = P[o] - t.x, dz = P[o + 2] - t.z; poolScore[i] = dx * dx + dz * dz; }
    for (let slot = fixedLights; slot < RENDER_OPTS.lightCount; slot++) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < n; i++) if (poolScore[i] < bestD) { bestD = poolScore[i]; best = i; }
      poolScore[best] = Infinity;
      const o = best * 3, w = slot * 8, g = FIRE_GLOW[F.kinds[best]], k = 0.9 + Math.sin(elapsed * 9.3 + best * 1.7) * 0.07 + Math.sin(elapsed * 21.1 + best * 2.9) * 0.04;
      L[w] = P[o]; L[w + 1] = P[o + 1]; L[w + 2] = P[o + 2]; L[w + 3] = g[0];
      L[w + 4] = g[1] * k; L[w + 5] = g[2] * k; L[w + 6] = g[3] * k; L[w + 7] = 0;
    }
  };

  // A walker is held off things by its torso, not its arms: a square `BODY` m either side of its middle (all of it,
  // for one that reaches less), square to the hall like every box it meets, so the crew's step (whole, else its x
  // part, then its z part) slides it along any face and round any corner at any angle. The walls stop it at their
  // faces: the side walls' trunks, the front wall's palisade and its ropes, the back wall's rock where it juts
  // furthest and the doorway's timber jambs.
  const BODY = 0.4, SIDE_FACE = HALL.halfW - 0.49, FRONT_FACE = HALL.front - 0.27, BACK_FACE = HALL.back + 0.15, JAMB = HALL.door - 0.35;
  // How far a body of half-width r at (x, z) reaches through the walls, negative when it is clear of them: the front
  // wall stands either side of the doorway, whose jambs run on out through the rock.
  const wallDepth = (x, z, r) => Math.max(Math.abs(x) + r - SIDE_FACE, BACK_FACE + r - z, Math.min(z + r - FRONT_FACE, Math.abs(x) + r - JAMB));
  // The deck's rail between the stairs and each stair's handrail on the hall's side (the other runs along the side
  // wall, which keeps a walker off it already), boxes as `blocks` are ([x0, x1, z0, z1, and the feet from, to]), so a
  // walker keeps its body inside a stair and behind the rail, and off a stair's side from the floor. The deck rail's
  // box ends flush with the handrail's face on the stair's side, so one hugging the handrail never catches on it.
  const RAIL_END = MEZZ.stairs[1][0] - MEZZ.stairW / 2 + 0.06;
  const RAILS = [[-RAIL_END, RAIL_END, MEZZ.z1 - 0.23, MEZZ.z1 + 0.05, MEZZ.y - 0.5, MEZZ.y + 2], ...MEZZ.stairs.map(([x, foot, , head]) => {
    const c = x - Math.sign(x) * (MEZZ.stairW / 2 + 0.05);
    return [c - 0.11, c + 0.11, head, foot + 0.11, -1, MEZZ.y + 2];
  })];
  // The floors a walker stands on, the highest within a step of its feet: the cave floor, the stage's two rings, the
  // mezzanine's deck and the stair up to it (a ramp, running a little on past both ends). Allocation-free.
  const STEP = 0.6, STAIRS = MEZZ.stairs.map(([x, foot, , head]) => ({ x0: x - MEZZ.stairW / 2, x1: x + MEZZ.stairW / 2, foot, head, run: foot - head }));
  const supportAt = (x, z, feet) => {
    const reach = feet + STEP;
    let best = 0;
    const d = Math.hypot(x - STAGE.x, z - STAGE.z);
    if (d <= STAGE.inner && STAGE.high <= reach) best = STAGE.high;
    else if (d <= STAGE.r && STAGE.low <= reach) best = STAGE.low;
    if (z >= MEZZ.z0 && z <= MEZZ.z1 && MEZZ.y <= reach) best = MEZZ.y;
    for (let i = 0; i < STAIRS.length; i++) {
      const st = STAIRS[i];
      if (x < st.x0 || x > st.x1 || z > st.foot + 0.3 || z < st.head - 0.3) continue;
      const y = MEZZ.y * Math.min(1, Math.max(0, (st.foot - z) / st.run));
      if (y > best && y <= reach) best = y;
    }
    return best;
  };
  // How far a body of half-width r at (x, z) with its feet at `feet` reaches into box b if it stands on b's level,
  // negative when it is clear of it; and whether a step from (ax, az) to (bx, bz) takes it no further into b than it
  // already is. A body brushing b may slide along it, but one with its middle inside b (stepped down off the stage
  // among the roots) may only walk on away from b's middle, whichever way.
  const into = (b, x, z, r, feet) => feet < b[4] || feet > b[5] ? 0 : r - Math.max(b[0] - x, x - b[1], b[2] - z, z - b[3]);
  const clearOf = (b, ax, az, bx, bz, r, feet) => {
    const to = into(b, bx, bz, r, feet);
    if (to <= 1e-6) return true;
    const from = into(b, ax, az, r, feet);
    if (from <= r) return to <= from + 1e-6;
    const mx = (b[0] + b[1]) / 2, mz = (b[2] + b[3]) / 2;
    return (bx - mx) * (bx - mx) + (bz - mz) * (bz - mz) > (ax - mx) * (ax - mx) + (az - mz) * (az - mz);
  };
  const groundFor = (x, z, feet) => supportAt(x, z, feet);
  // Whether (x, z) is under the stair's treads, too high above the feet to step onto.
  const underStair = (x, z, feet) => {
    for (let i = 0; i < STAIRS.length; i++) {
      const st = STAIRS[i];
      if (x >= st.x0 && x <= st.x1 && z <= st.foot && z >= st.head && MEZZ.y * (st.foot - z) / st.run > feet + STEP) return true;
    }
    return false;
  };
  // A step may never drop off a ledge (the deck's edge), walk in under the stair or out past the doorway's tunnel,
  // nor take the body further into a wall, a rail or a machine than it already is, each on its own
  // (so being deep in one, as off the stage's side among the roots, is no way into the next): from wherever it
  // stands, even a play spot tucked close to its machine, the Ooga can always walk away or along, never into.
  const walkableFor = (ax, az, bx, bz, y, height, actor) => {
    const r = Math.min(actor.bodyRadius || BODY, BODY);
    if (bz > HALL.front + 2 || supportAt(bx, bz, y) < y - STEP || underStair(bx, bz, y)) return false;
    if (wallDepth(bx, bz, r) > Math.max(0, wallDepth(ax, az, r)) + 1e-6) return false;
    for (let i = 0; i < blocks.length; i++) if (!clearOf(blocks[i], ax, az, bx, bz, r, y)) return false;
    for (let i = 0; i < RAILS.length; i++) if (!clearOf(RAILS[i], ax, az, bx, bz, r, y)) return false;
    return true;
  };
  const feetOf = () => avatar ? avatar.root.position.y - avatar.baseY : 0;
  // The station nearest (x, z) on the walker's own level: the deck's cabinets stand over the claws and pinball.
  const nearStation = (x, z, reach) => {
    let found = null, best = reach * reach;
    const feet = feetOf();
    for (let i = 0; i < stations.length; i++) {
      const p = stations[i].play, d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
      if (d < best && Math.abs((stations[i].y || 0) - feet) < 1.2) { best = d; found = stations[i]; }
    }
    return found;
  };
  const useNear = (x, z, reach) => {
    const s = nearStation(x, z, Math.max(reach, REACH));
    if (!s) return false;
    useStation(s);
    return true;
  };

  // ---- the crew: the game-room gorillas at work -------------------------------------------------------------
  // Six gorillas run the hall, one crew in the staff's red and gold with each role's own piece (`AM.staffHat`,
  // `AM.staffVest`, and the `AM.staffProp` its jobs take in hand). Each works a routine of jobs picked at random
  // (cosmetic, so `Math.random`): it walks there on a route planned round everything in the hall (the deck's attendant
  // on the deck), turns to the work, does it for a few seconds with part rotations and its prop, now and then stops for
  // a word with an Ooga, and moves on. The nearest one greets the visitor walking up, and the gamemaster leads the room
  // when the wheel pays out. They give way to the visitor, the strolling Oogas and each other, and block nobody.
  // Each role: its hat, uniform and prop (-1 none) and the arm holding it, whether it walks upright (prop in hand) or
  // on its knuckles, whether it keeps to the deck, its jobs (one listed twice comes up twice as often), its greeting
  // for the visitor and its words with an Ooga.
  const ROLES = [
    { id: "gamemaster", hat: 0, vest: 0, prop: 0, hand: "armR", upright: true, deck: false, start: "host", jobs: ["host", "host", "wheel", "fame", "welcome", "call", "call"],
      hello: "Welcome, welcome! Step right up!", chat: ["You play good, Ooga!", "Big score coming. Me feel it!", "Spin wheel! Jackpot waiting!"] },
    { id: "attendant", hat: 1, vest: 1, prop: -1, hand: "armL", upright: false, deck: false, start: "totem", jobs: ["totem", "muncher", "tokens", "tokens", "whistle"],
      hello: "Need tokens? Me got tokens!", chat: ["More tokens? Me got!", "No bite tokens, Ooga.", "Play fair. Have fun!"] },
    { id: "mechanic", hat: 2, vest: 2, prop: 1, hand: "armL", upright: false, deck: false, start: "fix", jobs: ["fix", "fix", "fix", "tap"],
      hello: "All machines fixed. Go play!", chat: ["Machine sound funny? Tell me.", "No kick machine, Ooga!", "Me fix. Me smart."] },
    { id: "runner", hat: 3, vest: 3, prop: 2, hand: "armL", upright: true, deck: false, start: "fill", jobs: ["fill", "serve"],
      hello: "Coconut? Fresh off tree!", chat: ["Thirsty? Coconut coming!", "Slurp slurp, good!", "Grub on stick later!"] },
    { id: "clerk", hat: 1, vest: 4, prop: 3, hand: "armL", upright: false, deck: false, start: "stock", jobs: ["stock", "stock", "claw", "tickets", "tickets", "muncher", "bucket"],
      hello: "Tickets buy prizes! Come see!", chat: ["Many tickets! Prize soon!", "Crown prize shiny. You want?", "Count tickets. Me count good."] },
    { id: "keeper", hat: 1, vest: 4, prop: 4, hand: "armL", upright: false, deck: true, start: "dust", jobs: ["dust", "dust", "fan", "rail"],
      hello: "Hoo! Old games up here! Come play!", chat: ["Dust gone. Games shiny.", "Fire up here warm!", "Coconut Invaders! Me love."] }
  ];
  // Each job: the pose it is worked in, how long (s), whether the role's prop comes out, how often it speaks up and
  // what it says, a cue at the start and one repeated while it works ([name, every s, loudness]). Its spots are laid
  // each visit (`layJobs`): [x, z, facing], and the Ooga it is done for, if any.
  const JOBS = {
    host: { pose: "host", time: [6, 9], prop: true, talk: 0.8, cue: "grunt", tick: null, say: ["Step up! Step up!", "Ooga games! Best in cave!", "Who beat top Ooga today?", "Coconuts fly! Games on!"] },
    wheel: { pose: "wheel", time: [4, 5.5], prop: true, talk: 1, cue: "bell", tick: null, say: [`Spin the wheel! ${AM.WHEEL_COST} tickets!`, `Jackpot ${WHEEL_JACKPOT} tickets! Who spin?`] },
    fame: { pose: "point", time: [4, 6], prop: true, talk: 0.8, cue: null, tick: null, say: ["Best Oogas up there! You next?", "Beat score, go up on stones!"] },
    welcome: { pose: "bow", time: [4, 6], prop: true, talk: 0.8, cue: "grunt", tick: null, say: ["Welcome to Ooga Arcade!", "Come in! Games hot!"] },
    call: { pose: "call", time: [4, 6], prop: true, talk: 0.8, cue: null, tick: null, say: ["Thro-ball! Roll coconut, win big!", "Claw sneaky. Try claw!", "Hoop! Coconut in basket!", "Coconut Toss! Bonk bonk!"] },
    totem: { pose: "reach", time: [4, 6], prop: false, talk: 0.5, cue: null, tick: ["coin", 0.55, 0.6], say: ["Totem full. Tokens ready!", "Banana in, token out!"] },
    muncher: { pose: "reach", time: [4, 6], prop: false, talk: 0.5, cue: "spit", tick: ["crunch", 1.4, 0.4], say: ["Muncher empty. Crunch crunch!", "Muncher hungry again!"] },
    tokens: { pose: "hand", time: [3.5, 5], prop: false, talk: 0.7, cue: "coin", tick: null, say: ["Tokens! Play more!", "Fresh tokens, hot hot!"] },
    whistle: { pose: "whistle", time: [3, 4.5], prop: false, talk: 0.8, cue: "chirp", tick: null, say: ["Tweeet! One Ooga a ride!", "Tweeet! No climb mammoth!"] },
    fix: { pose: "fix", time: [6, 9], prop: true, talk: 0.4, cue: "knock", tick: ["clack", 0.5, 0.5], say: ["Bonk. Fixed!", "Machine good now.", "Loose peg. Tight now."] },
    tap: { pose: "tap", time: [3, 4], prop: false, talk: 0.4, cue: null, tick: ["knock", 0.62, 0.55], say: ["Tap tap. Sound good.", "Hmm. Solid."] },
    fill: { pose: "fill", time: [2.5, 3.5], prop: false, talk: 0.3, cue: "crunch", tick: null, say: ["Coconuts up!", "Tray full!"] },
    serve: { pose: "serve", time: [3, 4], prop: false, talk: 0.7, cue: null, tick: null, say: ["Coconut milk! Slurp!", "Drinks here!", "Crack! Fresh coconut!"] },
    stock: { pose: "stock", time: [5, 7], prop: false, talk: 0.5, cue: "ding", tick: null, say: ["Prizes shiny! Tickets buy!", "New prizes in!"] },
    claw: { pose: "claw", time: [4, 5.5], prop: false, talk: 0.6, cue: "whirr", tick: null, say: ["New prizes in claw!", "Claw full. Good luck!"] },
    bucket: { pose: "scoop", time: [4, 5.5], prop: false, talk: 0.5, cue: "spit", tick: null, say: ["Tickets in bucket! Me count.", "Bucket full of tickets!"] },
    tickets: { pose: "hand", time: [3.5, 5], prop: true, talk: 0.7, cue: "spit", tick: null, say: ["Tickets! Big score!", "Count them! Many tickets!"] },
    dust: { pose: "dust", time: [3.5, 5.5], prop: true, talk: 0.3, cue: null, tick: null, say: ["Dust off. Screen shiny!", "Shiny shiny."] },
    fan: { pose: "fan", time: [3, 4.5], prop: true, talk: 0.6, cue: "whirr", tick: null, say: ["Fire big! Fire warm!", "Whoosh! Burn bright!"] },
    rail: { pose: "rail", time: [3.5, 5], prop: false, talk: 0.8, cue: null, tick: null, say: ["Ooga! Games up here!", "Hoo hoo! Me see you!"] }
  };
  for (const id in JOBS) Object.assign(JOBS[id], { id, spots: [] });
  // What an Ooga says back.
  const REPLIES = ["Ooga!", "Hoo! Thanks!", "Me win big!", "Ooga booga!", "Slurp!", "Yes yes!"];
  const CREW_SCALE = 0.72, CREW_BODY = 0.38, CREW_AHEAD = 0.2, GIVE_WAY = 1, CREW_TOUCH = 0.75, ROUTE_CAP = 24, AVOID_R = 1.35;
  // Where each prop sits on its arm (the fist is at its end), whether it is held level whatever the arm does (the
  // tray, and the roll so its strip hangs), and otherwise its turn about x (out along the arm); the tray sits between
  // both fists.
  const PROP_GRIP = [[0, -1.1, 0.12, false, Math.PI / 2], [0, -1.1, 0.12, false, Math.PI / 2], [-0.516, -1.1, 0.14, true, 0], [0, -1.1, 0.1, true, 0], [0, -1.1, 0.12, false, Math.PI / 2]];

  // The crew's floor plan: which cells of a `GRID` m lattice over the hall a gorilla may stand in with `CLEAR` m to
  // spare round its feet, on the floor and the stage (`FLOOR`) or on the deck (`DECK`), laid once the room is. Routes
  // are found on it by A* (eight ways, no corner cut, round any avoided circles) and pulled taut into a few waypoints.
  // Its arrays are made once for the page and reused; a search allocates nothing.
  const GRID = 0.25, CLEAR = 0.75, FLOOR = 1, DECK = 2, GX0 = -HALL.halfW + 0.5, GZ0 = HALL.back + 0.5;
  const GW = Math.round((HALL.halfW - 0.5 - GX0) / GRID) + 1, GH = Math.round((HALL.front - 0.9 - GZ0) / GRID) + 1, GN = GW * GH;
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  let plan = null, heapN = 0;
  const cellX = (c) => GX0 + (c % GW) * GRID, cellZ = (c) => GZ0 + Math.floor(c / GW) * GRID;
  const cellAt = (x, z) => {
    const i = Math.round((x - GX0) / GRID), j = Math.round((z - GZ0) / GRID);
    return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i;
  };
  const onStair = (x, z) => {
    for (let i = 0; i < STAIRS.length; i++) { const st = STAIRS[i]; if (x >= st.x0 - 0.3 && x <= st.x1 + 0.3 && z <= st.foot + 0.3 && z >= st.head - 0.3) return true; }
    return false;
  };
  const standable = (x, z, deck) => {
    const feet = deck ? MEZZ.y : supportAt(x, z, 0.5);
    if (deck ? supportAt(x, z, MEZZ.y) !== MEZZ.y : feet > STAGE.high || onStair(x, z)) return false;
    if (wallDepth(x, z, CLEAR) > 0) return false;
    for (let i = 0; i < blocks.length; i++) if (into(blocks[i], x, z, CLEAR, feet) > 0) return false;
    for (let i = 0; i < RAILS.length; i++) if (into(RAILS[i], x, z, CLEAR, feet) > 0) return false;
    return true;
  };
  // The walls, rails and floors never move, so the lattice follows from the blocks alone, and they come out the same
  // on every visit with the same roster: it is laid again only when they differ from the ones it was last laid round
  // (`laid`, a copy of them).
  const layPlan = () => {
    if (!plan) plan = { open: new Uint8Array(GN), cost: new Float32Array(GN), from: new Int32Array(GN), seen: new Uint32Array(GN), done: new Uint32Array(GN), trail: new Int32Array(GN), heap: new Int32Array(GN * 3), f: new Float32Array(GN * 3), search: 0, avoid: new Float32Array(32), avoidN: 0, blocked: new Uint32Array(GN), stamp: 0, laid: null };
    let same = plan.laid !== null && plan.laid.length === blocks.length * 6;
    for (let i = 0; same && i < blocks.length; i++) for (let k = 0; same && k < 6; k++) same = Object.is(plan.laid[i * 6 + k], blocks[i][k]);
    if (same) return;
    for (let c = 0; c < GN; c++) { const x = cellX(c), z = cellZ(c); plan.open[c] = (standable(x, z, false) ? FLOOR : 0) | (z <= MEZZ.z1 && standable(x, z, true) ? DECK : 0); }
    plan.laid = new Float64Array(blocks.length * 6);
    for (let i = 0; i < blocks.length; i++) for (let k = 0; k < 6; k++) plan.laid[i * 6 + k] = blocks[i][k];
  };
  // The avoided circles stamped into `blocked` under a new `stamp` once per route, each over the cells round it by the
  // same test, so a search reads one cell instead of every circle.
  const stampAvoided = () => {
    const P = plan, A = P.avoid, id = ++P.stamp, reach = Math.ceil(AVOID_R / GRID) + 1;
    for (let k = 0; k < P.avoidN; k++) {
      const ax = A[k * 2], az = A[k * 2 + 1], i0 = Math.round((ax - GX0) / GRID), j0 = Math.round((az - GZ0) / GRID);
      for (let j = Math.max(0, j0 - reach); j <= Math.min(GH - 1, j0 + reach); j++) for (let i = Math.max(0, i0 - reach); i <= Math.min(GW - 1, i0 + reach); i++) {
        const c = j * GW + i, dx = cellX(c) - ax, dz = cellZ(c) - az;
        if (dx * dx + dz * dz < AVOID_R * AVOID_R) P.blocked[c] = id;
      }
    }
  };
  const openAt = (c, bit) => (plan.open[c] & bit) !== 0 && (plan.avoidN === 0 || plan.blocked[c] !== plan.stamp);
  // The open cell nearest (x, z) within two metres, or -1.
  const nearOpen = (x, z, bit) => {
    const c0 = cellAt(x, z);
    if (c0 >= 0 && openAt(c0, bit)) return c0;
    const i0 = Math.round((x - GX0) / GRID), j0 = Math.round((z - GZ0) / GRID);
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= 8 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = i0 + di, j = j0 + dj;
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || i < 0 || j < 0 || i >= GW || j >= GH || !openAt(j * GW + i, bit)) continue;
      const c = j * GW + i, d = (cellX(c) - x) * (cellX(c) - x) + (cellZ(c) - z) * (cellZ(c) - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  const heapPush = (c, f) => {
    const H = plan.heap, F = plan.f;
    let k = heapN++;
    while (k > 0) { const up = (k - 1) >> 1; if (F[up] <= f) break; H[k] = H[up]; F[k] = F[up]; k = up; }
    H[k] = c; F[k] = f;
  };
  const heapPop = () => {
    const H = plan.heap, F = plan.f, top = H[0], last = H[--heapN], lf = F[heapN];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= heapN) break;
      if (c + 1 < heapN && F[c + 1] < F[c]) c++;
      if (F[c] >= lf) break;
      H[k] = H[c]; F[k] = F[c]; k = c;
    }
    H[k] = last; F[k] = lf;
    return top;
  };
  // A* from cell s to cell t; `from` then leads back from t to s.
  const findPath = (s, t, bit) => {
    const P = plan, id = ++P.search, ti = t % GW, tj = Math.floor(t / GW), cap = P.heap.length - 8;
    heapN = 0;
    P.seen[s] = id; P.cost[s] = 0; P.from[s] = -1;
    heapPush(s, 0);
    while (heapN > 0) {
      const c = heapPop();
      if (P.done[c] === id) continue;
      P.done[c] = id;
      if (c === t) return true;
      const ci = c % GW, cj = Math.floor(c / GW);
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const nc = nj * GW + ni, g = P.cost[c] + DC[k];
        if (P.done[nc] === id || (P.seen[nc] === id && P.cost[nc] <= g) || !openAt(nc, bit)) continue;
        if (k >= 4 && (!openAt(cj * GW + ni, bit) || !openAt(nj * GW + ci, bit))) continue;
        P.seen[nc] = id; P.cost[nc] = g; P.from[nc] = c;
        const di = Math.abs(ni - ti), dj = Math.abs(nj - tj);
        if (heapN < cap) heapPush(nc, g + Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj));
      }
    }
    return false;
  };
  // Whether the straight walk from (ax, az) to (bx, bz) stays on open cells, sampled every half cell.
  const clearLine = (ax, az, bx, bz, bit) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (GRID * 0.5));
    for (let k = 1; k <= n; k++) { const c = cellAt(ax + (bx - ax) * k / n, az + (bz - az) * k / n); if (c < 0 || !openAt(c, bit)) return false; }
    return true;
  };
  // A route for g from its feet to (g.tx, g.tz), pulled taut: from each waypoint it heads for the furthest cell of
  // the path still in an open straight line, and the last leg runs on to the spot itself. Written into g's own
  // waypoints (`pts`, walked as `routes[n]`, the first n of them); `partial` when it ran out of them first.
  const findRoute = (g) => {
    const P = plan, bit = g.deck ? DECK : FLOOR, p = g.agent.root.position, pts = g.pts;
    const s = nearOpen(p.x, p.z, bit), t = nearOpen(g.tx, g.tz, bit);
    if (s < 0 || t < 0 || !findPath(s, t, bit)) return false;
    let n = 0;
    for (let c = t; c !== -1; c = P.from[c]) P.trail[n++] = c;
    let out = 0, at = n - 1, ax = p.x, az = p.z, len = 0;
    g.partial = false;
    while (at >= 0) {
      let far = -1;
      for (let m = at; m >= 0; m--) {
        if (clearLine(ax, az, cellX(P.trail[m]), cellZ(P.trail[m]), bit)) far = m;
        else if (far >= 0) break;
      }
      if (far < 0) far = at;
      if (out === ROUTE_CAP - 1) { g.partial = true; break; }
      const x = cellX(P.trail[far]), z = cellZ(P.trail[far]);
      pts[out].x = x; pts[out].z = z; out++;
      len += Math.hypot(x - ax, z - az); ax = x; az = z;
      if (far === 0) break;
      at = far - 1;
    }
    if (!g.partial) { pts[out].x = g.tx; pts[out].z = g.tz; out++; len += Math.hypot(g.tx - ax, g.tz - az); }
    g.n = out; g.routeLen = len;
    return true;
  };
  // The circles a route keeps out of: the other gorillas on its level standing at work, and when `crowded` (after
  // a refused step) every gorilla, the visitor and the strolling Oogas (not once it has waited half a second on those,
  // when it walks on regardless); never one round its spot. One round its own feet starts the route with a step out
  // of it, away from whoever it is.
  const avoidAdd = (g, x, z) => {
    const r2 = (AVOID_R + 0.15) * (AVOID_R + 0.15);
    if (plan.avoidN >= 16 || (x - g.tx) * (x - g.tx) + (z - g.tz) * (z - g.tz) < r2) return;
    plan.avoid[plan.avoidN * 2] = x; plan.avoid[plan.avoidN * 2 + 1] = z; plan.avoidN++;
  };
  const avoidFor = (g, crowded) => {
    plan.avoidN = 0;
    for (let i = 0; i < staff.length; i++) { const o = staff[i], q = o.agent.root.position; if (o !== g && o.deck === g.deck && (crowded || o.phase !== "walk")) avoidAdd(g, q.x, q.z); }
    if (!crowded) return;
    if (avatar && Math.abs(feetOf() - g.agent.root.position.y) < 1) avoidAdd(g, avatar.root.position.x, avatar.root.position.z);
    if (!g.deck && g.stuck < 0.5) for (let i = 0; i < walkers.length; i++) avoidAdd(g, walkers[i].x, walkers[i].z);
  };
  // Sets g walking its route to (g.tx, g.tz); false when there is none.
  const route = (g, crowded) => {
    avoidFor(g, crowded);
    stampAvoided();
    let found = findRoute(g);
    if (!found && plan.avoidN) { plan.avoidN = 0; found = findRoute(g); }
    plan.avoidN = 0;
    if (!found) return false;
    const a = g.agent;
    a.walk(g.routes[g.n], false);
    // Upright walkers keep to their feet: a gallop's walk is never re-rolled, and the gait is set upright over it.
    if (g.role.upright) { a.setGait("gallop"); a.setGait("upright"); }
    return true;
  };

  // A gorilla's step: its torso, a square `CREW_BODY` m either side of a middle `CREW_AHEAD` m out ahead of its feet,
  // held off walls, rails and blocks as an Ooga's is, on its own level (the floor and the stage, never the stairs, or
  // the deck and never off it), and giving way: it never walks on closer than `GIVE_WAY` m into the visitor, a
  // strolling Ooga, a gorilla standing at work or one walking ahead of it in the crew's order (so two walking never
  // both wait on each other from afar; any other only closer than `CREW_TOUCH`, where the one behind has already
  // stopped); routes keep `AVOID_R` m off them, wider, so a detour is never refused. A strolling Ooga
  // walks on regardless, so after half a second of waiting on one the gorilla goes on too; and after a second hemmed
  // in by the crew (one at work in a narrow way, two nose to nose) it squeezes past.
  const giveWay = (ax, az, bx, bz, ox, oz, r) => {
    const to = (bx - ox) * (bx - ox) + (bz - oz) * (bz - oz);
    return to >= r * r || to >= (ax - ox) * (ax - ox) + (az - oz) * (az - oz);
  };
  const crewStep = (g, ax, az, bx, bz, y) => {
    const ground = supportAt(bx, bz, y);
    if (bz > HALL.front - 0.8 || (g.deck ? ground !== MEZZ.y : ground < y - STEP || ground > STAGE.high || onStair(bx, bz))) return false;
    const h = g.agent.heading, ox = Math.sin(h) * CREW_AHEAD, oz = Math.cos(h) * CREW_AHEAD, x0 = ax + ox, z0 = az + oz, x1 = bx + ox, z1 = bz + oz;
    if (wallDepth(x1, z1, CREW_BODY) > Math.max(0, wallDepth(x0, z0, CREW_BODY)) + 1e-6) return false;
    for (let i = 0; i < blocks.length; i++) if (!clearOf(blocks[i], x0, z0, x1, z1, CREW_BODY, y)) return false;
    for (let i = 0; i < RAILS.length; i++) if (!clearOf(RAILS[i], x0, z0, x1, z1, CREW_BODY, y)) return false;
    if (avatar && Math.abs(feetOf() - y) < 1 && !giveWay(x0, z0, x1, z1, avatar.root.position.x, avatar.root.position.z, GIVE_WAY)) return false;
    if (!g.deck && g.stuck < 0.5) for (let i = 0; i < walkers.length; i++) if (!giveWay(x0, z0, x1, z1, walkers[i].x, walkers[i].z, GIVE_WAY)) return false;
    if (g.stuck < 1) for (let i = 0; i < staff.length; i++) { const o = staff[i]; if (o !== g && o.deck === g.deck && !giveWay(x0, z0, x1, z1, o.mx, o.mz, i < g.rank || o.phase !== "walk" ? GIVE_WAY : CREW_TOUCH)) return false; }
    return true;
  };

  // The jobs' spots for this visit, from the room as it is laid out: the gamemaster's at the stage's front and the
  // wheel, under the hall of fame, by the doorway and on the floor; the doorway's totem and muncher and the kiddie
  // rides; beside each Ooga at a machine; at every machine and cabinet no Ooga plays and each pool table's side; the
  // snack bar and the food court's tables; the prize counter's front, the claws and the ticket bucket; and on the deck,
  // the retro cabinets, the fire bowls and the rail.
  const layJobs = () => {
    for (const id in JOBS) JOBS[id].spots.length = 0;
    const spot = (id, x, z, facing, member = null, flame = -1) => JOBS[id].spots.push({ x, z, facing, job: JOBS[id], taken: null, member, flame });
    const toward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
    const S = STAGE, F = LAYOUT.fame, W = LAYOUT.wheel, at = {};
    // The host at the stage's front shoulders facing the doorway, and the wheel's beside its footing: none of them
    // on the doorway's view of the cabinets' screens, nor on the strollers' loop.
    for (const [dx, dz] of [[-5, 3.3], [6, 1.9]]) spot("host", S.x + dx, S.z + dz, toward(S.x + dx, S.z + dz, 0, HALL.front));
    spot("wheel", W.x + 1.7, W.z - 0.1, toward(W.x + 1.7, W.z - 0.1, W.x, W.z));
    spot("fame", F.x - 0.4, F.z + 3, toward(F.x - 0.4, F.z + 3, F.x, F.z));
    spot("welcome", 1.9, HALL.front - 1.6, toward(1.9, HALL.front - 1.6, 0, HALL.front));
    spot("call", 8.2, -1.2, Math.PI); spot("call", -7.2, 0.6, -Math.PI / 2);
    LAYOUT.changers.forEach((p, i) => { toHall(p, 0, 1.15, at); spot(i ? "muncher" : "totem", at.x, at.z, p.turn + Math.PI); });
    // The attendant keeps an eye on the kiddie rides from the entry avenue, by the silverback and by the baby mammoth.
    for (const [x, z, i] of [[3.1, 3.5, 0], [3.1, -0.1, 3]]) { const r = LAYOUT.rides[i]; spot("whistle", x, z, toward(x, z, r.x, r.z)); }
    // Beside an Ooga: at its side or a little behind, wherever the floor is open, facing it.
    const beside = (id, m) => {
      const f = m.facing, sx = Math.cos(f), sz = -Math.sin(f), fx0 = Math.sin(f), fz0 = Math.cos(f);
      for (const [side, back] of [[1.35, 0.45], [-1.35, 0.45], [0, 1.5], [1.55, -0.2], [-1.55, -0.2]]) {
        const x = m.x + sx * side - fx0 * back, z = m.z + sz * side - fz0 * back, c = cellAt(x, z);
        if (c >= 0 && plan.open[c] & FLOOR) return spot(id, x, z, toward(x, z, m.x, m.z), m);
      }
    };
    for (let i = 0; i < crowd.length; i++) {
      const m = crowd[i];
      if (m.pose === "skee" || m.pose === "shoot") { beside("tokens", m); beside("tickets", m); }
      else if (m.pose === "claw" || m.pose === "pinball" || m.pose === "hockey") beside("tokens", m);
      else if (m.pose === "cheer" || m.pose === "queue") beside("serve", m);
    }
    // Every machine and cabinet nobody plays, from its player's spot; the pool tables from each side too.
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i], p = st.play;
      if ((st.kind !== "machine" && st.kind !== "cabinet") || (st.game && st.game.kind === "darts") || crowd.some((m) => Math.abs(m.x - p.x) + Math.abs(m.z - p.z) < 1.2)) continue;
      spot("fix", p.x, p.z, p.facing);
      if (st.kind === "machine" && st.game.kind === "claw") spot("claw", p.x, p.z, p.facing);
    }
    for (const p of LAYOUT.pools) for (const s of [-1, 1]) spot("tap", p.x + s * 1.9, p.z, -s * Math.PI / 2);
    toHall(LAYOUT.snack, -1.1, 1.75, at); spot("fill", at.x, at.z, LAYOUT.snack.turn + Math.PI);
    // A table is served from its first open side with no one sitting there, and its sitter answers.
    for (const [x, z] of LAYOUT.tables) {
      const sitter = crowd.find((m) => m.pose === "sit" && Math.abs(m.x - x) < 1.6 && Math.abs(m.z - z) < 1.6) || null;
      for (const [dx, dz] of [[0, -1.45], [1.75, 0.2], [-1.75, 0.2], [0, 1.9]]) {
        const c = cellAt(x + dx, z + dz);
        if (c < 0 || !(plan.open[c] & FLOOR) || (sitter && Math.hypot(sitter.x - x - dx, sitter.z - z - dz) < 1)) continue;
        spot("serve", x + dx, z + dz, toward(x + dx, z + dz, x, z), sitter);
        break;
      }
    }
    for (const lx of [1.8, -1.8]) { toHall(LAYOUT.prizes, lx, 1.25, at); spot("stock", at.x, at.z, LAYOUT.prizes.turn + Math.PI); }
    for (const [x, z] of LAYOUT.buckets) spot("bucket", x - 0.95, z, Math.PI / 2);
    for (const c of LAYOUT.cabinets) if (c.game < 0) spot("dust", c.play.x, c.play.z, c.play.facing);
    // The deck's fire bowls, each with the flame the attendant fans.
    const L = AM.lanterns();
    for (const [x, z, r, y] of L.footprints) {
      if (y < MEZZ.y) continue;
      let flame = -1, best = Infinity;
      L.flames.forEach(([fx0, , fz0], k) => { const d = (fx0 - x) * (fx0 - x) + (fz0 - z) * (fz0 - z); if (d < best) { best = d; flame = k; } });
      spot("fan", x, z + r + 0.95, Math.PI, null, flame);
    }
    for (const x of [-8, -3.5, 3.5, 8]) spot("rail", x, MEZZ.z1 - 0.95, 0);
  };

  // Whether spot s is within 1.5 m of the visitor, on the level of feet at y: no gorilla starts or takes a job there
  // (back from a game, the visitor stands at that machine's play spot).
  const byVisitor = (s, y) => {
    if (!avatar || Math.abs(feetOf() - y) >= 1) return false;
    const q = avatar.root.position;
    return (s.x - q.x) * (s.x - q.x) + (s.z - q.z) * (s.z - q.z) < 2.25;
  };
  // Hires the crew for the visit, once the room, its Oogas and the visitor are in place: each gorilla starts at work
  // at its first job's first free spot clear of the visitor.
  const hireCrew = () => {
    layPlan();
    layJobs();
    crewSay = crewGreet = 0;
    staff = [];
    for (const role of ROLES) {
      const spots = JOBS[role.start].spots, level = role.deck ? MEZZ.y : 0;
      const s = spots.find((q) => !q.taken && !byVisitor(q, level)) || spots.find((q) => !q.taken), y = role.deck ? MEZZ.y : supportAt(s.x, s.z, 0.5);
      const pts = Array.from({ length: ROUTE_CAP }, () => ({ x: 0, z: 0 })), routes = [null];
      for (let n = 1; n <= ROUTE_CAP; n++) routes.push(pts.slice(0, n));
      const g = {
        role, rank: staff.length, deck: role.deck, agent: null, prop: null, pts, routes, n: 0, routeLen: 0, partial: false,
        phase: "work", t: 0, dur: 0, spot: s, last: null, job: s.job, face: s.facing, tx: s.x, tz: s.z,
        stuck: 0, skip: 0, ax: s.x, az: s.z, replan: 0, walkT: 0, walkMax: 0, blend: 1, carry: 0, carrying: false, greetCool: 0, resume: "", resumeT: 0, resumeDur: 0,
        said: false, tick: 0, spun: false, replied: false, chatted: false, with: null, mx: s.x, mz: s.z, walked: 0, done: 0
      };
      g.agent = BL.agent.create({ groundAt: (x, z) => supportAt(x, z, g.agent ? g.agent.root.position.y : y), walkable: (ax, az, bx, bz, feet) => crewStep(g, ax, az, bx, bz, feet), form: "ape", x: s.x, z: s.z, heading: s.facing, scale: CREW_SCALE });
      const P = g.agent.parts;
      addChild(P.head, createNode({ geometry: AM.staffHat(role.hat) }));
      addChild(P.torso, createNode({ geometry: AM.staffVest(role.vest) }));
      if (role.prop >= 0) {
        const [x, py, z, , turn] = PROP_GRIP[role.prop];
        g.prop = createNode({ position: { x, y: py, z }, rotation: { x: turn, y: 0, z: 0 }, geometry: AM.staffProp(role.prop), visible: false });
        addChild(P[role.hand], g.prop);
      }
      addChild(root, g.agent.root);
      s.taken = g;
      g.dur = s.job.time[0] + Math.random() * (s.job.time[1] - s.job.time[0]);
      g.t = Math.random() * g.dur * 0.5;
      staff.push(g);
      if (role.id === "runner") staff.vendor = g.agent;
      if (role.id === "clerk") staff.clerk = g.agent;
    }
  };

  // Picks g's next job: a free spot of one of its jobs (the runner fills its tray, then serves it), not the one it
  // just did, not within 2.2 m of another gorilla's nor by the visitor, three to nine metres off (a quarter of the time anywhere in the
  // hall, so it spends its time working as much as walking), else anywhere free; and walks there.
  const CAND = new Array(128).fill(null);
  const claimedNear = (g, s) => {
    for (let i = 0; i < staff.length; i++) { const o = staff[i].spot; if (staff[i] !== g && o && Math.abs(o.x - s.x) + Math.abs(o.z - s.z) < 2.2) return true; }
    return false;
  };
  const candidates = (g, near, far) => {
    const p = g.agent.root.position, jobs = g.role.jobs;
    let n = 0;
    for (let j = 0; j < jobs.length; j++) {
      const job = JOBS[jobs[j]];
      if (g.role.id === "runner" && (job === JOBS.serve) !== g.carrying) continue;
      for (let k = 0; k < job.spots.length && n < CAND.length; k++) {
        const s = job.spots[k], d = (s.x - p.x) * (s.x - p.x) + (s.z - p.z) * (s.z - p.z);
        if (s.taken || s === g.last || claimedNear(g, s) || d < near * near || d > far * far || byVisitor(s, p.y)) continue;
        CAND[n++] = s;
      }
    }
    return n;
  };
  const nextJob = (g) => {
    if (g.spot) g.spot.taken = null;
    g.last = g.spot;
    g.spot = null;
    let n = candidates(g, 3, Math.random() < 0.25 ? Infinity : 9) || candidates(g, 3, Infinity) || candidates(g, 0, Infinity);
    g.phase = "walk"; g.t = 0; g.walkT = 0;
    for (let tries = 0; tries < 4 && n > 0; tries++) {
      const k = Math.floor(Math.random() * n), s = CAND[k];
      CAND[k] = CAND[--n];
      g.tx = s.x; g.tz = s.z;
      if (!route(g, false)) continue;
      g.spot = s; s.taken = g; g.job = s.job; g.face = s.facing; g.walkMax = g.routeLen / 0.5 + 6;
      return;
    }
    g.phase = "wait"; g.dur = 0.8 + Math.random() * 0.8;
    g.agent.place(g.agent.root.position.x, g.agent.root.position.z, g.agent.heading);
  };
  const arrive = (g) => {
    const job = g.job, p = g.agent.root.position;
    g.agent.place(p.x, p.z, g.agent.heading);
    g.phase = "work"; g.t = 0; g.dur = job.time[0] + Math.random() * (job.time[1] - job.time[0]);
    g.said = g.spun = g.replied = false; g.tick = 0.3;
  };
  // A word with the nearest Ooga at play or strolling within 3.2 m (not on the deck), who waves and answers.
  const chat = (g) => {
    if (g.deck) return false;
    const p = g.agent.root.position;
    let near = null, best = 3.2 * 3.2;
    for (let i = 0; i < crowd.length + walkers.length; i++) {
      const m = i < crowd.length ? crowd[i] : walkers[i - crowd.length], q = m.cave.root.position, d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
      if (d < best) { best = d; near = m; }
    }
    if (!near) return false;
    g.phase = "chat"; g.t = 0; g.dur = 2.6; g.with = near; g.replied = false; g.chatted = true;
    crewSays(g, g.role.chat[Math.floor(Math.random() * g.role.chat.length)]);
    near.wave = 1.8;
    return true;
  };
  // The end of whatever g was doing: back to the work or walk a greeting broke into, a word after a job now and then,
  // else the next job.
  const finish = (g) => {
    if (g.phase === "greet" || g.phase === "cheer") {
      if (g.resume === "work" && g.spot) { g.phase = "work"; g.t = g.resumeT; g.dur = g.resumeDur; g.face = g.spot.facing; return; }
      if (g.resume === "walk" && g.spot) { g.phase = "walk"; g.t = 0; g.walkT = 0; g.stuck = 0; if (route(g, true)) return; }
      return nextJob(g);
    }
    if (g.phase === "work") {
      g.done++;
      if (g.job === JOBS.fill) g.carrying = true;
      if (g.job === JOBS.serve) g.carrying = false;
      if (!g.chatted && Math.random() < 0.3 && chat(g)) return;
    }
    g.chatted = g.phase === "chat";
    nextJob(g);
  };
  // A greeting or a cheer breaks into whatever g was doing, stopping it where it is.
  const interrupt = (g, phase, dur, face) => {
    const p = g.agent.root.position;
    if (g.phase !== "greet" && g.phase !== "cheer") { g.resume = g.phase; g.resumeT = g.t; g.resumeDur = g.dur; }
    g.phase = phase; g.t = 0; g.dur = dur; g.face = face;
    g.agent.place(p.x, p.z, g.agent.heading);
  };
  // One line at a time from the crew, and only from one near the visitor, over its head.
  let crewSay = 0, crewGreet = 0;
  const crewSays = (g, text, always = false) => {
    const p = g.agent.root.position, q = avatar ? avatar.root.position : pilot.orbit.target;
    if ((!always && crewSay > 0) || Math.abs(p.x - q.x) + Math.abs(p.z - q.z) > 16) return;
    crewSay = 2.4;
    fx.sayAt(p.x, p.y + 2, p.z, text, 1.9);
  };
  // The gamemaster takes up the wheel's moments with his line: a cheer toward it (a big win, the visitor back with
  // more tickets), or with `cheer` false a wave to the visitor (a small win).
  const hostSays = (text, cheer) => {
    const g = staff[0], p = g.agent.root.position, W = LAYOUT.wheel;
    interrupt(g, cheer ? "cheer" : "greet", cheer ? 3.5 : 2.4, Math.atan2(W.x - p.x, W.z - p.z));
    crewSays(g, text, true);
    hear(p.x, p.z, cheer ? "ooga" : "grunt", 0.8);
  };
  // While at work: its line and cue once it has settled, the cue repeated as it works, and what the job does to the
  // room: the wheel drifts on under a push (never a spin that stops on a value), the fanned fire flares, and the Ooga
  // it is done for waves and answers.
  const work = (g, dt) => {
    const job = g.job, s = g.spot, p = g.agent.root.position;
    if (!g.said && g.t > 0.5) {
      g.said = true;
      if (Math.random() < job.talk) crewSays(g, job.say[Math.floor(Math.random() * job.say.length)]);
      if (job.cue) hear(p.x, p.z, job.cue, 0.6);
    }
    if (job.tick && (g.tick -= dt) <= 0) { g.tick = job.tick[1] * (0.8 + Math.random() * 0.4); hear(p.x, p.z, job.tick[0], job.tick[2]); }
    if (job === JOBS.wheel && !g.spun && g.t > 0.9) { g.spun = true; if (spin.t < 0 && spin.hold <= 0) spin.speed = Math.max(spin.speed, 0.8); }
    if (job === JOBS.fill && g.t > g.dur * 0.55) g.carrying = true;
    if (job === JOBS.serve && g.t > g.dur * 0.55) g.carrying = false;
    if (s.flame >= 0) { const f = lit.flames[s.flame], k = 1.25 + Math.sin(g.t * 9) * 0.15; f.node.scale.x *= k; f.node.scale.y *= k; f.node.scale.z *= k; f.node.glow *= k; }
    if (s.member && !g.replied && g.t > 1.4) { g.replied = true; answer(s.member); }
  };
  const answer = (m) => {
    const q = m.cave.root.position;
    m.wave = 1.6;
    fx.sayAt(q.x, (m.pose ? m.y : 0) + 2.2, q.z, REPLIES[Math.floor(Math.random() * REPLIES.length)], 1.6);
  };

  // The pose g works in, as target angles into `POSE`: the chest's lean from upright, the thighs' swing (forward
  // negative; the hips sink to keep the feet down), each arm's raise from hanging straight down (a quarter turn
  // points it ahead, a half turn straight up) and its swing out to the side, the right forearm's twist, and the
  // head's nod (down positive) and turn. Allocation-free.
  const POSE = { pitch: 0, legs: 0, lx: 0, lz: 0, rx: 0, rz: 0, ry: 0, hx: 0, hy: 0 };
  const posture = (g, i) => {
    const Z = POSE, t = g.t, kind = g.phase === "work" ? g.job.pose : g.phase;
    Z.pitch = 0.1; Z.legs = 0; Z.lx = Z.rx = 0.15; Z.lz = Z.rz = Z.ry = 0; Z.hx = 0.05; Z.hy = 0;
    if (kind === "cheer" || (cheerT > 0 && kind !== "greet")) { Z.lx = Z.rx = 2.85 + Math.sin(t * 9 + i) * 0.15; Z.lz = -0.3; Z.rz = 0.3; Z.pitch = 0.05; Z.hx = -0.3; return; }
    switch (kind) {
      case "host": Z.pitch = 0.08; Z.lx = 1.7 + Math.sin(t * 3) * 0.12; Z.lz = -0.3; Z.rx = 1.1 + Math.sin(t * 1.7) * 0.5; Z.rz = 0.55; Z.hx = -0.1; Z.hy = Math.sin(t * 0.9) * 0.45; break;
      case "wheel": Z.pitch = 0.05; Z.lx = Z.rx = 2.65 + Math.sin(t * 4) * 0.1; Z.lz = -0.45; Z.rz = 0.45; Z.hx = -0.35; break;
      case "point": Z.pitch = 0.05; Z.rx = 2.45; Z.rz = 0.1; Z.lx = 0.9; Z.hx = -0.4; break;
      case "bow": { const b = Math.max(0, Math.sin(t * 1.6)) ** 2; Z.pitch = 0.1 + 0.55 * b; Z.rx = 1.2 + 0.4 * b; Z.rz = -0.35 * b; Z.lx = 0.5; Z.hx = 0.2 * b; break; }
      case "call": Z.pitch = 0.08; Z.lx = 1.6 + Math.sin(t * 2.5) * 0.1; Z.lz = 0.15; Z.rx = 0.6 + Math.max(0, Math.sin(t * 2)) * 0.9; Z.rz = 0.5; Z.hx = -0.15; break;
      case "reach": Z.pitch = 0.3; Z.lx = 1.35 + Math.sin(t * 7) * 0.1; Z.rx = 1.35 + Math.sin(t * 7 + 1.6) * 0.1; Z.lz = 0.1; Z.rz = -0.1; Z.hx = 0.35; break;
      // Held out to the Ooga, handed over, then a word and a nod.
      case "hand": { const out = t < 1.8 ? Math.min(1, t * 1.5) : Math.max(0, 1 - (t - 1.8) * 2); Z.pitch = 0.15; Z.rx = 0.3 + 1.2 * out + (t > 2.3 ? 0.6 + Math.sin(t * 4) * 0.3 : 0); Z.lx = 0.25; Z.hx = 0.15 + (t > 2.3 ? Math.max(0, Math.sin(t * 3)) * 0.2 : 0); break; }
      case "whistle": Z.pitch = 0.05; Z.rx = 2.5; Z.rz = -0.35; Z.lx = 1.5 + Math.sin(t * 3) * 0.3; Z.lz = -0.6; Z.hx = -0.1; break;
      case "fix": Z.pitch = 0.75; Z.legs = -0.9; Z.rx = 1.25 + Math.sin(t * 9) * 0.22; Z.ry = Math.sin(t * 9) * 0.45; Z.lx = 1.45; Z.hx = 0.45; break;
      case "tap": { const k = (t * 1.6) % 1; Z.pitch = 0.15; Z.rx = 1.35 + (k < 0.2 ? Math.sin(k / 0.2 * Math.PI) * 0.3 : 0); Z.lx = 0.3; Z.hx = 0.25; Z.hy = 0.3; break; }
      case "fill": Z.pitch = 0.2; Z.lx = Z.rx = 1.3 + Math.sin(t * 5) * 0.08; Z.lz = 0.1; Z.rz = -0.1; Z.hx = 0.3; break;
      case "serve": { const down = Math.min(1, t / 1.2); Z.pitch = 0.1 + 0.2 * down; Z.lx = Z.rx = g.carrying ? 1.35 - 0.35 * down : 0.35; Z.lz = 0.1; Z.rz = -0.1; Z.hx = 0.3; break; }
      case "stock": Z.pitch = 0.2; Z.rx = 1.55 + Math.sin(t * 4) * 0.35; Z.lx = 1.55 + Math.sin(t * 4 + Math.PI) * 0.35; Z.hx = 0.25; break;
      case "claw": Z.pitch = 0; Z.rx = 2.75 + Math.sin(t * 5) * 0.15; Z.lx = 2.6 + Math.sin(t * 5 + 1) * 0.15; Z.hx = -0.45; break;
      case "scoop": Z.pitch = 0.55; Z.legs = -0.4; Z.lx = 0.8 + Math.sin(t * 5) * 0.15; Z.rx = 0.8 + Math.sin(t * 5 + 2) * 0.15; Z.hx = 0.45; break;
      case "dust": Z.pitch = 0.12; Z.rx = 1.9 + Math.sin(t * 5) * 0.3; Z.rz = Math.sin(t * 5 + 1) * 0.45; Z.lx = 0.25; Z.hx = 0.1 + Math.sin(t * 5) * 0.1; Z.hy = Math.sin(t * 5 + 1) * 0.2; break;
      case "fan": Z.pitch = 0.3; Z.rx = 1.1 + Math.sin(t * 9) * 0.45; Z.lx = 0.3; Z.hx = 0.4; break;
      case "rail": { const wave = t > 1.5 && t < 3.5; Z.pitch = 0.45; Z.lx = 0.95; Z.rx = wave ? 2.6 : 0.95; Z.rz = wave ? 0.35 + Math.sin(t * 11) * 0.35 : 0; Z.hx = 0.35; break; }
      case "chat": Z.pitch = 0.1; Z.rx = 0.9 + Math.sin(t * 4) * 0.35; Z.lx = 0.3 + Math.sin(t * 3) * 0.15; Z.hy = Math.sin(t * 2) * 0.15; break;
      // A wave, or with the tray in both hands a nod.
      case "greet": Z.pitch = 0.1; Z.rx = 2.65; Z.rz = 0.35 + Math.sin(t * 11) * 0.35; Z.lx = 0.3; Z.hx = g.carrying ? 0.1 + Math.max(0, Math.sin(t * 5)) * 0.25 : -0.1; break;
    }
  };
  const mix = (a, b, k) => a + (b - a) * k;
  // Laid over the Agent's own pose by `k`, so a gorilla eases in and out of its work; the arms that hold something
  // are held out by `carry` (the gamemaster's megaphone walking, the runner's tray whenever it has one outside its
  // own filling and serving), and a level prop stays level.
  const pose = (g, i) => {
    const a = g.agent, P = a.parts, k = g.blend;
    if (k > 0.001) {
      posture(g, i);
      const Z = POSE, pitch = a.chest.rotation.x = mix(a.chest.rotation.x, Z.pitch, k);
      P.legR.rotation.x = mix(P.legR.rotation.x, Z.legs, k);
      P.legL.rotation.x = mix(P.legL.rotation.x, Z.legs, k);
      a.hips.position.y -= a.hips.position.y * (1 - Math.cos(Z.legs)) * k;
      P.armR.rotation.x = mix(P.armR.rotation.x, -pitch - Z.lx, k);
      P.armL.rotation.x = mix(P.armL.rotation.x, -pitch - Z.rx, k);
      P.armR.rotation.z = mix(P.armR.rotation.z, Z.lz, k);
      P.armL.rotation.z = mix(P.armL.rotation.z, Z.rz, k);
      P.head.rotation.x = mix(P.head.rotation.x, -pitch + Z.hx, k);
    }
    P.armL.rotation.y = k > 0.001 ? POSE.ry * k : 0;
    P.head.rotation.y = k > 0.001 ? POSE.hy * k : 0;
    const c = g.carry;
    if (c > 0.001) {
      const pitch = a.chest.rotation.x, tray = g.role.id === "runner";
      P[g.role.hand].rotation.x = mix(P[g.role.hand].rotation.x, -pitch - (tray ? 1.35 : 0.55), c);
      if (tray) { P.armR.rotation.x = mix(P.armR.rotation.x, -pitch - 1.35, c); P.armR.rotation.z = mix(P.armR.rotation.z, 0.1, c); P.armL.rotation.z = mix(P.armL.rotation.z, -0.1, c); }
    }
    if (g.prop) {
      const id = g.role.id, show = id === "gamemaster" || (id === "runner" ? g.carrying : g.phase === "work" && g.job.prop && g.blend > 0.5);
      g.prop.visible = show;
      if (show && PROP_GRIP[g.role.prop][3]) g.prop.rotation.x = -(a.chest.rotation.x + P[g.role.hand].rotation.x);
    }
  };

  // Per frame, allocation-free, after the room's fires: the gamemaster takes up the wheel's celebration, the nearest
  // gorilla greets a visitor walking up, and each one walks, works and poses. A gorilla whose step is refused plans
  // again round what is in its way after 0.3 s, and after 1.1 s (or a walk far longer than its route) goes on to its
  // next job instead, so none stands stuck.
  const crewUpdate = (dt) => {
    crewSay = Math.max(0, crewSay - dt);
    crewGreet = Math.max(0, crewGreet - dt);
    if (avatar && crewGreet <= 0) {
      const q = avatar.root.position, feet = feetOf();
      let near = null, best = 2.6 * 2.6;
      for (let i = 0; i < staff.length; i++) {
        const g = staff[i], p = g.agent.root.position, d = (p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z);
        if (g.greetCool <= 0 && g.phase !== "greet" && g.phase !== "cheer" && Math.abs(p.y - feet) < 1 && d < best) { best = d; near = g; }
      }
      if (near) {
        crewGreet = 4;
        near.greetCool = 30;
        interrupt(near, "greet", 2.4, 0);
        crewSays(near, near.role.hello, true);
        hear(q.x, q.z, "grunt", 0.7);
      }
    }
    for (let i = 0; i < staff.length; i++) {
      const g = staff[i], a = g.agent, p = a.root.position;
      g.t += dt;
      g.greetCool = Math.max(0, g.greetCool - dt);
      if (g.phase === "greet" && avatar) g.face = Math.atan2(avatar.root.position.x - p.x, avatar.root.position.z - p.z);
      if (g.phase === "chat") { const q = g.with.cave.root.position; g.face = Math.atan2(q.x - p.x, q.z - p.z); if (!g.replied && g.t > 1.1) { g.replied = true; answer(g.with); } }
      // Standing: turned toward its work and up on its feet; walking upright, kept upright.
      if (g.phase === "walk") { if (g.role.upright && a.walking && !a.beating) a.setGait("upright"); }
      else if (!a.beating) {
        const turn = Math.atan2(Math.sin(g.face - a.heading), Math.cos(g.face - a.heading));
        if (Math.abs(turn) > 0.004) a.place(p.x, p.z, a.heading + turn * (1 - Math.exp(-7 * dt)));
        a.setGait(g.phase === "wait" ? "idle" : "beat");
      }
      const x0 = p.x, z0 = p.z;
      a.update(dt);
      if (g.phase === "walk") {
        const moved = Math.hypot(p.x - x0, p.z - z0);
        g.walked += moved;
        g.walkT += dt;
        // Stuck is time since it last got 0.3 m on (a shuffle on the spot is no progress); it carries over a change of
        // job, so a gorilla hemmed in stops waiting on strolling Oogas and moves on through.
        if (a.beating || (p.x - g.ax) * (p.x - g.ax) + (p.z - g.az) * (p.z - g.az) > 0.09) { g.ax = p.x; g.az = p.z; g.stuck = g.skip = 0; }
        else g.stuck += dt;
        g.replan -= dt;
        // Arrived (its route ends within 0.3 m of the spot), or stopped within reach of it (a step refused at one tucked
        // close to its machine, or held up there for longer than any stride takes): to work from there.
        const off = Math.hypot(p.x - g.tx, p.z - g.tz);
        if (!a.beating && off < 0.9 && (!a.walking || g.stuck > 0.6)) arrive(g);
        else if (g.stuck - g.skip > 1.1 || g.walkT > g.walkMax) { g.skip = g.stuck; nextJob(g); }
        else if (!a.beating && !a.walking && (g.partial || (g.stuck > 0.3 && g.replan <= 0))) { g.replan = 0.35; if (!route(g, !g.partial)) { g.skip = g.stuck; nextJob(g); } }
      } else {
        g.stuck = g.skip = 0;
        g.ax = p.x; g.az = p.z;
        if (g.phase === "work") work(g, dt);
        if (g.t >= g.dur) finish(g);
      }
      const standing = g.phase !== "walk" && g.phase !== "wait" && !a.beating;
      g.blend += ((standing ? 1 : 0) - g.blend) * Math.min(1, dt * 7);
      const hold = g.role.id === "gamemaster" ? g.phase === "walk" : g.carrying && (g.phase !== "work" || cheerT > 0);
      g.carry += ((hold && !a.beating ? 1 : 0) - g.carry) * Math.min(1, dt * 7);
      pose(g, i);
      g.mx = p.x + Math.sin(a.heading) * CREW_AHEAD;
      g.mz = p.z + Math.cos(a.heading) * CREW_AHEAD;
    }
  };

  const enter = (ctx) => {
    ({ renderer, game, world, go, agentPlay } = ctx);
    canvasEl = ctx.canvas;
    window.addEventListener("keydown", armsKeys, true);
    canvasEl.addEventListener("pointerdown", rightClick, true);
    camera = createCamera({ fov: 55, near: 0.2, far: 60 });
    root = createNode();
    hud = hudMod.create({ roster: contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: ctx.lootEnabled });
    if (window.matchMedia("(max-width: 720px), (max-height: 500px)").matches) hud.el.sheet.dataset.open = "false";
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    const clampTarget = (p) => {
      p.x = clamp(p.x, -HALL.halfW + 2, HALL.halfW - 2);
      p.y = clamp(p.y, 0.5, HALL.h - 2);
      p.z = clamp(p.z, HALL.back + 2, HALL.front - 1);
    };
    // Under the mezzanine the camera keeps below the deck, easing down as the Ooga walks in, so the deck's edge
    // never fills the view.
    const clampCamera = (p) => {
      p.x = clamp(p.x, -HALL.halfW + 0.8, HALL.halfW - 0.8);
      const under = avatar && feetOf() < 1 ? clamp((MEZZ.z1 + 1 - avatar.root.position.z) / 1.2, 0, 1) : 0;
      p.y = clamp(p.y, 0.5, under ? MEZZ.y - 0.45 + (1 - under) * (HALL.h - MEZZ.y) : HALL.h - 0.8);
      p.z = clamp(p.z, HALL.back + 0.8, HALL.front + (Math.abs(p.x) < HALL.door - 0.5 ? 3 : -0.8));
    };
    pilot = pilotMod.create({
      renderer, canvas: ctx.canvas, camera, hud, presets: views, landing: "entrance", pitch: PITCH, dist: DIST,
      follow: FOLLOW, fly: FLY, clampTarget, clampCamera, ceilingAt: () => HALL.h - 1, coarse: COARSE, mayPossess,
      close: { eyeHeight: 1.1, eyeRatio: 0.95, eyeForward: 0.16, pitch: [-1.35, 1.35], trailingDist: 4, orbitDist: 5, maxStep: 0.6, groundAt: (x, z) => supportAt(x, z, feetOf()) }
    });
    const tipFor = (hit) => {
      const o = hit.owner;
      if (o.kind === "cabinet") return `${GAMES[o.game].name} · ${COARSE ? "tap" : "click"} to play`;
      if (o.kind === "machine") return `${o.station.label} · walk up and press ${COARSE ? "PLAY" : "Space"}`;
      if (o.kind === "prizes") return `Prize counter · ${shownTickets()} tickets`;
      if (o.kind === "wheel") return `Jackpot wheel · ${AM.WHEEL_COST} tickets a spin`;
      if (o.kind === "ride") return `${["Silverback", "Monkey cart", "Dino", "Baby mammoth"][o.index]} ride · tap to rock`;
      return TIPS[o.kind] ? TIPS[o.kind][0] : "";
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
        if (o.kind === "cabinet") return play(o.game);
        if (o.kind === "machine") return open(o.station.game.kind, o.station.index);
        if (o.kind === "snack") return order();
        if (o.kind === "prizes") return openPrizes();
        const sound = TAP_SOUNDS[o.kind];
        if (sound) { const at = hit.point || avatar?.root.position || pilot.orbit.target; hear(at.x, at.z, sound); }
        const tip = TIPS[o.kind];
        if (tip) hud.toast(tip[1]);
      },
      ...pilot.hooks
    });
    hud.onPreset(pilot.goPreset);
    hud.onAction((action) => {
      if (action === "leave") leaveCave();
      else if (action === "reset-view") pilot.goPreset("entrance");
      else if (action === "mode-retake") pilot.modeAction(action);
      else if (action === "arcade-mute") toggleMute();
    });
    fx = fxMod.create({ root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: { x: 0, y: 5, z: -6 } });
    const panel = document.getElementById("prize-panel");
    prizeUi = { panel, tickets: document.getElementById("prize-tickets"), items: [...panel.querySelectorAll(".prize")] };
    panel.hidden = true;
    panel.addEventListener("click", onPrizeClick);
    hud.dismissOutside(panel, closePrizes);
    addChild(root, ...BL.dressing.nodes(dressing(), { glow: 1 }));
    build();
    // Back from a game, the Ooga who played it stands at its cabinet (a retro one up on the deck) or its carnival
    // machine (on a page that opened on the game, the one it hands back as `world.pilot`); from the island, whoever
    // walked in comes through the doorway. A page that opens here takes `character=`
    // instead, as the island does. With nobody named, the roster's default pick walks in, so the arcade always has
    // someone to play it.
    const from = GAMES.findIndex((g) => g.id === ctx.from), machineFrom = stations.find((st) => st.kind === "machine" && st.game.kind === ctx.from && st.index === (ctx.place || 0));
    const retroFrom = stations.find((st) => st.kind === "retro" && st.id === ctx.from) || null;
    const asked = ctx.from === null ? new URLSearchParams(location.search).get("character")?.trim().toLowerCase() : null;
    const named = asked ? contributors.roster.find((c) => c.name.toLowerCase() === asked) : null;
    const wanted = named ? named.name : from >= 0 || machineFrom || retroFrom ? lastPlayer || world.pilot : world.pilot;
    const wantedEntry = wanted && contributors.roster.find((c) => c.name === wanted);
    const playerName = wantedEntry && mayPick(wantedEntry) ? wanted : contributors.activeRoster.find(mayPick)?.name || null;
    world.pilot = null;
    if (playerName) {
      playerWorld = { level: 0, weapons: new Map(), magazine: { owned: false, count: 0, ammo: 0, carrier: null } };
      const shared = { root, input, hud, game, world: playerWorld, playerName, fx, viewYaw: 0, outsideActors: () => remotes ? remotes.actors() : NO_ACTORS, outsideActorHeight: BL.remotePlayers.BODY_HEIGHT, groundAt: groundFor, walkable: walkableFor, useNear };
      people = shared.crew = BL.crew.create(shared);
      pilot.bind(shared);
      avatar = people.cavemen.get(playerName);
      // At a machine an Ooga plays, a step back from its spot, where that Ooga stands again.
      const at = from >= 0 ? live.find((c) => c.game === from).play : retroFrom ? retroFrom.play : machineFrom ? (machineFrom.bot ? toHall({ x: machineFrom.play.x, z: machineFrom.play.z, turn: machineFrom.turn }, 0, 1.3, { facing: machineFrom.play.facing }) : machineFrom.play) : { x: 0, z: HALL.front - 1.5, facing: Math.PI };
      Object.assign(avatar.root.position, { x: at.x, y: avatar.baseY + supportAt(at.x, at.z, retroFrom ? MEZZ.y : 1), z: at.z });
      avatar.root.rotation.y = at.facing;
      pilot.possess(avatar);
      // Empty-handed, as in Ooga Mine: no rifle on the back, no aiming, and the mine's words for the controls.
      avatar.weapon.secondaryOwned = false;
      people.selectWeapon(0, avatar);
      avatar.weapon.aiming = false;
      avatar.parts.gun.visible = false;
      hud.hint(COARSE ? "Stick walks · PLAY at a game" : "W A S D walk · mouse or Q E turn · Space plays what is next to you", 6000);
    } else if (from >= 0) pilot.goPreset(GAMES[from].id);
    lastPlayer = playerName;
    unsubscribeAccount = BL.net.subscribe(accountChanged);
    seatCrowd(playerName);
    // Other signed-in players in the hall, as the Oogas they drive (after the crowd, which they may stand in for).
    remotes = BL.remotePlayers.create({ root, crew: people, hide: hideCrowd });
    hireCrew();
    hangFame(playerName);
    showShelf();
    // The hall's sound, and from the island the room powers up.
    audio = BL.carnivalAudio.create();
    audio.room(true);
    powerT = from < 0 && !machineFrom && !retroFrom ? 0 : 99;
    if (powerT === 0) for (const q of power) q.node.glow = 0.08;
    ambientT = 1;
    // Back with more tickets than last time (a game's, or a spin's left turning): the wheel's pods and the room's lights
    // celebrate (the face only idles on: it stops on a value only for a spin paid for) and the room cheers with the
    // gamemaster.
    const tickets = game.state.arcade.tickets, won = lastTickets === null ? 0 : tickets - lastTickets;
    lastTickets = tickets;
    if (won > 0) {
      spin.party = 4;
      fx.burst(LAYOUT.wheel.x, LAYOUT.wheel.y, LAYOUT.wheel.z + 0.4, 40, SPARKS, 2.8);
      hud.toast(`+${won} tickets! ${tickets} on the board. Ooga rich!`);
      roomCheers();
      hostSays("More tickets! Ooga rich!", true);
    }
    // Back at a machine: it holds its call for a while, and flashes and throws embers if it paid tickets.
    invited = null;
    callT = 0;
    const back = machineFrom ? life.find((s) => s.station === machineFrom) : null;
    if (back) {
      back.cool = COOL;
      if (won > 0) { back.flash = 3; fx.burst(back.x, 1.8, back.z, 30, SPARKS, 2.4); }
    }
    lightUp();
    leaving = false;
    shownFrame = -1;
    prompt = null;
    orders = 0;

    arcadeScene.root = root;
    arcadeScene.camera = camera;
    arcadeScene.input = input;
    arcadeScene.debug = {
      hud, camera, controls: pilot.controls, pilot, crew: people, cavemen: people ? people.cavemen : null,
      arcade: { screens, crowd, walkers, bots, spin, play, open, stations, carnival, nearStation, supportAt, blocks, audio, staff, life, get frame() { return shownFrame; } }
    };
  };

  // The crowd, from part rotations alone: allocation-free. Each pose is a loop on the
  // Ooga's own clock `t`, so no two play in step.
  const tri = (p) => Math.abs(p - Math.floor(p + 0.5)) * 2;
  const animateCrowd = (dt, elapsed) => {
    for (let i = 0; i < crowd.length; i++) {
      const m = crowd[i], P = m.cave.parts, t = (m.t += dt);
      let armR = 0, armL = 0, head = 0, sway = 0;
      if (m.pose === "claw" || m.pose === "pinball") {
        armR = -1.05 + Math.sin(t * 8) * 0.07;
        armL = m.pose === "pinball" ? -1.05 - Math.max(0, Math.sin(t * 6.5)) * 0.25 : -1.1 + Math.sin(t * 5 + 1) * 0.12;
        head = 0.25 + Math.sin(t * 1.3) * 0.05;
      } else if (m.pose === "hockey") {
        armL = -0.85 + Math.sin(t * 4.6) * 0.3;
        armR = -0.3;
        head = 0.35;
        sway = Math.sin(t * 2.3) * 0.2;
      } else if (m.pose === "skee") {
        // Swung by its game: back, then through to the release, when the machine takes its roll.
        const k = m.swing;
        armL = k > 0.6 ? (1 - k) / 0.4 * 0.8 : k > 0 ? 0.8 - (0.6 - k) / 0.6 * 2.2 : -0.1;
        armR = -0.3;
        head = 0.1;
      } else if (m.pose === "shoot") {
        const up = m.swing > 0 ? Math.sin(m.swing * Math.PI) : 0;
        armR = armL = -0.6 - up * 2.1;
        head = -0.25 * up;
      } else if (m.pose === "sit") {
        armL = -1.2 - Math.max(0, Math.sin(t * 1.8)) * 0.9;
        armR = -0.9;
        head = 0.1 + Math.sin(t * 1.8) * 0.08;
      } else if (m.pose === "queue") {
        P.head.rotation.y = Math.sin(t * 0.6) * 0.5;
        armR = armL = Math.sin(t * 1.1) * 0.1;
      } else {
        const up = Math.max(0, Math.sin(t * 1.6)) ** 3;
        armR = armL = -2.8 * up;
        head = -0.3;
      }
      m.swing = Math.max(0, m.swing - dt * 1.6);
      m.wave = Math.max(0, m.wave - dt);
      m.cheer = Math.max(0, m.cheer - dt);
      if ((cheerT > 0 || m.cheer > 0) && m.pose !== "sit") armR = armL = -2.4 - Math.abs(Math.sin(t * 7)) * 0.4;
      else if (m.wave > 0) armL = -2.6 + Math.sin(t * 12) * 0.3;
      P.armR.rotation.x = armR;
      P.armL.rotation.x = armL;
      P.head.rotation.x = head;
      m.cave.root.rotation.y = m.facing + sway;
    }
  };

  // Per frame, allocation-free: the walker and camera, the screens' loops, the carnival, the staff, the prompt at a
  // station, the lamps nearest the view, and the way out.
  const update = (dt, elapsed) => {
    pilot.readInput(dt);
    if (people) people.update(dt, elapsed);
    pilot.update(dt);
    // The Ooga driven here goes to the room with where it stands and its health; other players here are shown.
    const drivenHere = people && people.player;
    BL.net.setBody(drivenHere ? drivenHere.traits.name : null);
    if (drivenHere) {
      const p = drivenHere.root.position;
      BL.net.sendPose(p.x, p.y - drivenHere.baseY, p.z, drivenHere.root.rotation.y);
      BL.net.setHealth(drivenHere.health.value, drivenHere.health.stunned);
    }
    remotes.update(dt);
    // The loop, then PRESS START blinking, then the loop again; the best line shows with the loop.
    const frame = Math.floor(elapsed * FPS) % (FRAMES + AM.START_FRAMES);
    if (frame !== shownFrame) {
      shownFrame = frame;
      const looping = frame < FRAMES;
      for (let i = 0; i < screens.length; i++) {
        const sc = screens[i];
        sc.node.geometry = looping ? sc.frames[frame] : sc.start[(frame - FRAMES) & 1];
        sc.best.visible = looping;
      }
    }
    for (let i = 0; i < carnival.length; i++) carnival[i].update(dt);
    stationLife(dt, elapsed);
    // The wheel: a spin eases out on its cubic to the drawn wedge and shows its win; its result holds under the
    // clapper a while; else the face idles round, a push from the gamemaster easing back.
    spin.party = Math.max(0, spin.party - dt);
    spin.flash = Math.max(0, spin.flash - dt);
    if (spin.t >= 0) {
      spin.t = Math.min(spin.dur, spin.t + dt);
      const k = 1 - spin.t / spin.dur;
      spin.face.rotation.z = spin.to + (spin.from - spin.to) * k * k * k;
      spin.speed = 3 * (spin.from - spin.to) / spin.dur * k * k;
      if (k === 0) payWheel();
    } else if (spin.hold > 0) spin.hold -= dt;
    else {
      spin.speed += (0.25 - spin.speed) * Math.min(1, dt * 0.6);
      spin.face.rotation.z -= spin.speed * dt;
    }
    // The clapper clicks each time a peg passes it, higher as a spin slows; through a spin the pods chase peg by peg,
    // through a win or a celebration they flash.
    const peg = Math.floor(-spin.face.rotation.z / (Math.PI * 2 / AM.WHEEL_VALUES.length)), spinning = spin.t >= 0, flashing = spin.party > 0 || spin.flash > 0;
    if (peg !== wheelTick) { wheelTick = peg; hear(LAYOUT.wheel.x, LAYOUT.wheel.z, "click", spinning ? 1.2 : spin.speed > 1 ? 0.8 : 0.35, spinning ? 1.45 - 0.75 * Math.min(1, spin.speed / 12) : 1); }
    for (let i = 0; i < spin.bulbs.length; i++) spin.bulbs[i].glow = spinning ? (wheelTick % 3 === i ? 1.8 : 0.3) : flashing ? (Math.floor(elapsed * 12) & 1 ? 1.4 : 0.35) : 1;
    animateCrowd(dt, elapsed);
    playBots(dt);
    walk(dt, elapsed);
    greet(dt);
    lights(dt, elapsed);
    crewUpdate(dt);
    ambience(dt);
    audio.tick(dt);
    if (avatar && !leaving) {
      const p = avatar.root.position, near = nearStation(p.x, p.z, INVITE);
      if (near !== prompt) {
        prompt = near;
        if (near) {
          const verb = near.kind === "snack" ? "order at " : near.kind === "prizes" ? "shop at " : "", act = near.kind === "snack" ? "ORDER" : near.kind === "prizes" ? "PRIZES" : near.kind === "wheel" ? "SPIN" : "PLAY";
          hud.hint(near.kind === "wheel" ? `${COARSE ? act : "Space: spin"} (${AM.WHEEL_COST} tickets)` : `${COARSE ? act : "Space"}: ${verb}${near.label}`);
          hud.setAct(act);
        } else pilot.showAct();
      }
      if (p.z > EXIT_Z + 1.2 && Math.abs(p.x) < HALL.door) leaveCave();
    }
    glowNear(elapsed);
    stepTweens(dt);
    fx.update(dt, elapsed);
  };
  const TAP_SOUNDS = { door: "knock", changer: "coin", muncher: "spit", wheel: "click", disco: "ding", fame: "ding", off: "ding", sign: "grunt" };
  const drawExtra = (ctx2d, project) => remotes.drawNames(ctx2d, project);
  const overlay = (dt) => fx.drawOverlay(dt, drawExtra);

  const leave = () => {
    // Whoever walked in goes on as themselves: into a game, or back out to the island at this mouth.
    if (avatar) world.pilot = avatar.traits.name;
    unsubscribeAccount();
    unsubscribeAccount = null;
    BL.net.setBody(null);
    prizeUi.panel.removeEventListener("click", onPrizeClick);
    prizeUi.panel.hidden = true;
    window.removeEventListener("keydown", armsKeys, true);
    canvasEl.removeEventListener("pointerdown", rightClick, true);
    canvasEl = null;
    for (const g of staff) g.agent.dispose();
    for (const id in JOBS) JOBS[id].spots.length = 0;
    CAND.fill(null);
    // A spin still turning has its win saved but not shown: left out here, it shows on the way back in (`enter`).
    lastTickets = shownTickets();
    audio.dispose();
    remotes.dispose();
    remotes = null;
    if (people) people.dispose();
    fx.dispose();
    pilot.dispose();
    for (const node of targets) input.remove(node);
    targets.length = 0;
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    const count = input.targetCount;
    input.dispose();
    hud.dispose();
    hud = hooks = input = pilot = fx = agentPlay = people = avatar = playerWorld = screens = stations = blocks = carnival = staff = prompt = prizeUi = ticketBoard = crowd = spin = null;
    audio = bots = walkers = motes = power = disco = fame = shelf = lit = life = invited = null;
    arcadeScene.input = arcadeScene.debug = null;
    return { targets: count };
  };
  // Swapped in and out, so kept on the GPU between swaps: the loops' frames, the scoreboards' digits, the shy's
  // golden coconut and the pinball lanes' lights.
  const liveGeometry = (set) => {
    for (let i = 0; i < GAMES.length; i++) {
      for (const frame of AM.attractFrames(i)) set.add(frame);
      for (const frame of AM.attractStart(i)) set.add(frame);
    }
    for (let r = 0; r < AM.RETRO.length; r++) {
      for (const frame of AM.retroFrames(r)) set.add(frame);
      for (const frame of AM.retroStart(r)) set.add(frame);
    }
    for (let d = 0; d < 10; d++) set.add(AM.digit(d));
    set.add(AM.coconut(0)).add(AM.coconut(1)).add(AM.pinLight(0)).add(AM.pinLight(1));
    if (staff) for (const g of staff) g.agent.liveGeometry(set);
    if (avatar) set.add(avatar.headOpen).add(avatar.headClosed);
    if (remotes) remotes.liveGeometry(set);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats(), ...(remotes ? remotes.stats() : {}) };
  };

  const arcadeScene = {
    // Voice zone: the Arcade group, which its mouth on the island shares (`arcade`).
    voiceZone: "arcade.hall",
    id: "arcade", enter, update, overlay, onDonation, onKey, onLootCleared, renderOpts: RENDER_OPTS, leave, stats, liveGeometry,
    root: null, camera: null, input: null, debug: null, agent: null, agentView: null, agentControls: null, agentHandoff: null,
    get inMotion() {
      return false;
    }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.arcade = arcadeScene;
})();
