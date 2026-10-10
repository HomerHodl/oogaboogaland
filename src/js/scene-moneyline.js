// The Money Line: a stroll through the history of money, ridden by handcar from Jekyll Island's station back to the
// beginning. A coastal railway runs down -z with a station diorama on its +x side at each stop: so far shells and
// beads, the stones of Yap and the first coins (docs/money-line.md holds the history every relic tells, and the
// stations still to come). Still being built, so the scene is `wip` and the director keeps it closed unless the page
// opts in (`?wip=moneyline`); Jekyll Island's station only stands while it is open.
//
// The visitor's Ooga comes in as itself (`world.pilot`, else `character=`, else the roster's first) in a one-player
// crew, as DSB Land does, and goes back to Jekyll Island the same way. It boards the handcar with Space (the car's
// seat is a bench, so the crew sits it and stands it up), rides to the next stop and is stood up beside the car;
// moving or Space hops off anywhere. At the last stop the next ride runs all the way back. Relics answer a tap with
// their history, in turn, from `LORE`; each station has one thing to do (dig cowries, carry a stone, strike a coin),
// which earns its coin, and one golden banana hidden somewhere. Coins and bananas are kept on `world.moneyline` for
// the page's life.
//
// The sky is the island's clock (`daylight.sample`, as Ooga Drop does), over a sea at `SEA`. Everything per frame
// writes in place: the car, the seat, the rider, the prompt, the area label, the furnace and the bananas' spin.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { math, models, contributors, daylight, hud: hudMod, interact: interactMod, pilot: pilotMod, fx: fxMod, moneylineModels: M, jekyllIsle } = BL;
  const { clamp } = math;
  const { createNode, addChild, removeChild, createCamera, addTween, stepTweens, tweenCount, traverseVisible } = BL.scene;

  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const timeParam = DEBUG ? params.get("time") : null;
  const hourParam = DEBUG ? parseFloat(params.get("hour")) : NaN;
  const daylenParam = DEBUG ? parseFloat(params.get("daylen")) : NaN;
  const dayParam = DEBUG ? parseFloat(params.get("day")) : NaN;
  const latitudeParam = DEBUG ? parseFloat(params.get("latitude")) : NaN;
  const LATITUDE = Number.isFinite(latitudeParam) ? Math.max(-90, Math.min(90, latitudeParam)) : daylight.ISLAND_LATITUDE_DEG;

  const H = jekyllIsle.HANDCAR, RAIL_TOP = M.RAIL_TOP, STOPS = M.STOPS, WEST = M.WEST;
  // How far Space reaches for the car, a dig, the pole or the anvil, and the coins a full line will hold.
  const REACH = 2, COINS_ON_LINE = 12, BANANAS_ON_ROUTE = 14;
  const DUST = models.particleGeometry("#d4bd88", 0.1, 0), SPARK = models.particleGeometry("#ffb13b", 0.08, 1), SPRAY = models.particleGeometry("#cfe8ee", 0.08, 0.3);
  // Sky, light and haze from the island's clock every frame; the haze closes in well before the line's ends.
  const RENDER_OPTS = {
    clear: new Float32Array(3), horizon: new Float32Array(3), zenith: new Float32Array(3), sky: new Float32Array(3), ground: new Float32Array(3), sun: new Float32Array(3), direct: new Float32Array(3),
    light: { x: 0.55, y: 0.78, z: -0.25 }, sunDirection: { x: 0, y: 1, z: 0 }, moon: { x: 0, y: 1, z: 0 }, moonSun: { x: 0, y: -1, z: 0 }, starMatrix: new Float32Array(9),
    stars: 0, torch: 0, day: 1, twilight: 0, lampFactor: 0, directStrength: 1, sunStrength: 1, moonStrength: 0, ambientFloor: 0.2, diffuseFloor: 0, shadowStrength: 1, shadowFloor: 0, shadowBias: 0.002,
    time: 0, bloomStrength: 0.5, lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, shadowCenter: { x: 0, y: 0, z: 0 }, shadowExtent: 40, fog: null, fogNear: 90, fogFar: 320
  };
  RENDER_OPTS.starMatrix[0] = RENDER_OPTS.starMatrix[4] = RENDER_OPTS.starMatrix[8] = 1;
  RENDER_OPTS.fog = RENDER_OPTS.horizon;
  RENDER_OPTS.clouds = 0.35;
  RENDER_OPTS.sea = M.SEA;

  // The camera's places: the platform looking down the line, and each station seen from the track.
  const station = (s) => ({ yaw: WEST, pitch: 0.32, dist: 16, target: { x: s.center[0], y: 1, z: s.center[1] } });
  const PRESETS = { start: { yaw: 0, pitch: 0.3, dist: 12, target: { x: 0, y: 1, z: -4 } } };
  for (const s of M.STATIONS) PRESETS[s.id] = station(s);
  // The camera while the Ooga rides: off to the stations' side, up, behind the car, and where it looks ahead.
  const RIDE_VIEW = { side: 1.6, up: 3.4, back: 6.5, look: 1.2, ahead: 9 };
  // Where the Ooga stands on arrival: beside the car on the platform, facing down the line.
  const ARRIVAL = { yaw: 0, pitch: 0.28, dist: 6, target: { x: 1.6, y: 1.2, z: 2.5 }, position: { x: 1.6, y: 0, z: 2.5 } };

  // What every relic says: its tooltip, then what a poke says, in turn. `coin` names the coin its moment earns.
  const LORE = {
    handcar: { tip: "Handcar · press Space beside it to ride to the next stop", say: ["Pump, Ooga, pump. The line runs back to the beginning of money."] },
    exit: { tip: "Jekyll Island, 1910 · the way back", say: [] },
    endline: { tip: "The end of the line · for now", say: ["Mesopotamia, Rome, paper money, tally sticks, banks and the gold standard are still being built.", "Ooga is laying track as fast as Ooga can."] },
    shellsign: { tip: "Shells and Beads · about 1200 BCE", say: ["Before coins, people used things that were small, pretty and hard to fake. Shells were all three."] },
    shelldate: { tip: "1200 BCE · cowries in Shang China", say: ["Cowries were valued, strung and buried in Shang-dynasty China, around 1200 BCE."] },
    cowries: { tip: "Cowrie strings · small, shiny, hard to fake", say: [
      "Cowrie shells were valued, strung and buried in Shang-dynasty China; copies in bone and stone were made when real shells ran short.",
      "The old Chinese character for cowrie, 貝, sits inside the characters for wealth, goods, costly and poor.",
      "Cowries served as money across Africa and Asia for centuries."
    ] },
    wampum: { tip: "Wampum belt · shell beads of the American coast", say: [
      "Wampum beads were woven by peoples of the northeastern coast. Colonists started using them as money.",
      "Massachusetts made wampum legal tender in 1637: six white beads to the penny, for small sums only.",
      "Over-production and counterfeits followed, and the law was repealed in 1661. Inflation, in beads.",
      "A shell company."
    ] },
    dig: { tip: "A mound of sand · press Space to dig", coin: "cowrie", say: [] },
    moneta: { tip: "A cowrie in the shallows", say: ["Its scientific name, given by Linnaeus in 1758, is Monetaria moneta. Money money."] },
    yapsign: { tip: "Stones of Yap · stone money", say: ["On Yap, the money was carved stone, some of it taller than an Ooga."] },
    rai: { tip: "Rai · stone money of Yap", say: [
      "Limestone quarried on Palau, about 400 km away, and carried home by canoe and raft.",
      "The biggest are over 3.5 m across. Many never move: when one changes hands, everyone knows, and the island's shared memory is the record.",
      "Its worth depended on its size, its workmanship and its story, including how hard it was to bring home."
    ] },
    sunk: { tip: "The stone in the lagoon · lost at sea, still counted", say: [
      "William Furness, writing in 1910, told of a stone lost overboard on the way home. Its owners were still rich: everyone agreed it existed.",
      "Milton Friedman later compared it to gold that never leaves a central bank's vault.",
      "A ledger everybody keeps. Ooga has heard of one of those."
    ] },
    okeefe: { tip: "Iron-tool rai · worth less", say: [
      "From 1872 the trader David O'Keefe shipped Yapese quarriers to Palau with iron tools, paid in copra.",
      "Stones came easily, so they were valued less than the old ones cut by hand. Easy money buys less."
    ] },
    carry: { tip: "A stone on its carrying pole · press Space to help carry it", coin: "rai", say: [] },
    yapflag: { tip: "Yap's flag", say: ["The ring on Yap's state flag stands for rai, round a canoe and a star."] },
    ottawa: { tip: "A stone marked OTTAWA", say: ["The largest rai outside Yap stands at the Bank of Canada Museum in Ottawa, by the stairs down. A central bank's doormat."] },
    coinsign: { tip: "The First Coins · about 600 BCE", say: ["Somebody had the idea of stamping a lump of metal so nobody had to weigh it again."] },
    coindate: { tip: "600 BCE · Lydia's first coins", say: ["The first coins were struck in Lydia, in western Turkey, in the late 600s BCE."] },
    lion: { tip: "Lydian electrum · the first coins", say: [
      "The first coins were struck in Lydia, in western Turkey, in the late 600s BCE, from electrum, a natural mix of gold and silver.",
      "A die with a lion's head sat on the anvil; a punch struck the back. Odd shapes, but strict weights.",
      "Herodotus said the Lydians made the first gold and silver coins. Close: they were electrum."
    ] },
    owlcoin: { tip: "The owl · Athens' silver", say: [
      "Athens struck its silver four-drachma coins with an owl, from its own mines at Laurion.",
      "Sound money had a face. It was an owl."
    ] },
    anvil: { tip: "The anvil · press Space to strike a coin", coin: "lion", say: [] },
    shellstall: { tip: "Fish stall · fish for a shell, wampum traded", moment: true, say: [] },
    coinstall: { tip: "Bread stall · bread for a coin", moment: true, say: [] },
    conductor: { tip: "The Conductor · tap for a fact", say: [] },
    owl: { tip: "An owl on the roof", say: ["\"Owls to Athens\": Aristophanes' joke about taking something where there's plenty already. Athens had owls on every coin."] },
    phanes: { tip: "A little coin in a crack", say: ["\"I am the badge of Phanes\", in Greek that runs backwards. The oldest coins with words on them, about 625 to 600 BCE. Nobody knows who Phanes was."] },
    goldbanana: { tip: "A golden banana", say: [] }
  };
  const COIN_NAMES = { cowrie: "a cowrie", rai: "a little rai", lion: "a lion stamp" };

  // The Conductor, who pumps the handcar and talks: a leg's lines in turn as it rolls (`@repeal` is the moment wampum
  // stops being money, said only to a visitor holding some), a stop's welcome and hint on arrival, and now and then a
  // tip while it waits. Facts from docs/money-line.md; the memes are the Conductor's own.
  const LINES = {
    legs: {
      "0>1": [
        "All aboard the Money Line! Next stop: Shells and Beads, about 1200 BCE.",
        "Before coins, money had to be scarce, easy to carry and hard to fake. Shells from warm seas were all three.",
        "Many money cowries are thought to have come from the Maldives, across the Indian Ocean by the boatload.",
        "Rule one of the Money Line: not your shells, not your money."
      ],
      "1>2": [
        "Next stop: the stones of Yap. Mind the money, the big ones weigh as much as a car.",
        "@repeal",
        "The Yapese quarried their stones on Palau, about 400 km away, and brought them home by canoe and raft.",
        "On Yap the big stones hardly ever move. Everybody just remembers whose they are.",
        "A ledger everybody keeps, that nobody can fake? Ooga has heard of one of those."
      ],
      "2>3": [
        "Next stop: the First Coins, Lydia, about 600 BCE.",
        "Somebody had a bright idea: stamp a lump of metal, so nobody ever has to weigh it again.",
        "Lydia's metal was electrum: gold and silver, mixed by nature in the river sands.",
        "Later, King Croesus struck coins of pure gold and pure silver. Hence: rich as Croesus.",
        "A stamp is a promise about what's inside. Hold that thought. Promises are where it all goes wrong."
      ],
      "3>4": [
        "Next stop: the end of the line, for now.",
        "Rome, paper money, banks and bubbles are still being laid. Ooga's track crew is paid in bananas.",
        "Fair warning: the next stretch is where coins start losing their silver. Hold on to your purse."
      ],
      "4>0": [
        "Express back to the platform! Jekyll Island is through the arch: 1910, and paper all the way down.",
        "If you kept your coins, hold them tight. History says they won't stay this good."
      ]
    },
    repeal: "1661: Massachusetts repealed wampum as legal tender. The beads in your purse are just beads now.",
    arrive: [
      "Platform! Through the arch is Jekyll Island, 1910. Or press Space by the handcar for another ride.",
      "Shells and Beads! Dig the three mounds for cowries and spend them at the stall. Watch the shallows: one shell there has a very greedy name.",
      "Stones of Yap! Help carry the stone on the pole. Look out along the jetty, and behind the big house: the stones get around.",
      "The First Coins! Strike a coin at the mint and buy bread with it. Look up at the roof, and round the mint's back wall.",
      "End of the line, for now! Hop back on and I'll take you home the long way."
    ],
    idle: [
      ["The Money Line runs back to the beginning of money. Hop on!", "Through the arch is Jekyll Island. That's where this line ends up, in 1910."],
      [
        "Cowries were still money in parts of West Africa into the 1900s.",
        "In 14th-century Mali, Ibn Battuta saw 1,150 cowries sold for one gold dinar.",
        "In the 1800s traders shipped thousands of tons of cheaper Zanzibar cowries into West Africa. Shell inflation!",
        "The money cowrie's scientific name is Monetaria moneta. Linnaeus named it in 1758. Money money.",
        "Massachusetts took wampum as legal tender from 1637. Ask the stall for the going rate."
      ],
      [
        "At one of the Yapese quarries on Palau, digging only started around 1700, once they had iron tools.",
        "A stone lost at sea still counted. Everyone agreed it was down there, so it was still money.",
        "Some stones were worth more for their story than their size. Ooga respects a good story."
      ],
      [
        "The first coins had a picture on one side and just a punch mark on the other.",
        "Herodotus said the Lydians made the first gold and silver coins. Close: electrum.",
        "Owls to Athens: old Greek for taking something where there's plenty already.",
        "Croesus's gold coins showed a lion facing a bull. Ooga's would show a banana facing a banana."
      ],
      ["Rome goes here. The denarius started out nearly pure silver. Don't get attached.", "The barrier is temporary. Like most price controls."]
    ],
    general: [
      "Proof of work: Ooga pumps this lever all day.",
      "The fare on the Money Line is free. Enjoy it: it's the last free thing in this history.",
      "Stack shells. Stay humble.",
      "Few understand. You will by the end of the line."
    ],
    dig: "Money, straight out of the ground. Proof of dig.",
    carry: "Heave! Congratulations: you now own a share of a stone you'll never move.",
    coin: "Freshly struck! Don't bite it. Electrum is half silver."
  };

  // The purse: each era's money the visitor carries, at most `cap`, and what became of it (`dead` once it stopped being
  // money). Kept on `world.moneyline` for the page, with the coins and bananas.
  const PURSE = [
    { id: "cowrie", label: "Cowrie shells", note: "Money from China to West Africa", cap: 9 },
    { id: "wampum", label: "Wampum beads", note: "Six to the penny, Massachusetts 1637", dead: "Repealed in 1661: just beads now", cap: 36 },
    { id: "rai", label: "Share of a rai stone", note: "Never moves. Everyone remembers it's yours", cap: 1 },
    { id: "coin", label: "Lydian electrum coins", note: "Stamped, so nobody weighs them", cap: 9 }
  ];

  let renderer, game, world, go, root, camera, hud, input, pilot, fx, crew, avatar, clock, playerWorld, saved, car, mint, hammer, struckCoin, carriedNode;
  let exiting = false, lastContext = "", lastArea = "", sheetHidden = false, sheetOpen = "true", now = 0, purseList = null;
  const targets = [], mounds = [], bananas = [], owners = [];
  // The Conductor's body (a caveman in a cap on the handcar), what they're saying and until when, the leg's lines still
  // to come, and when they last spoke.
  const conductor = { cave: null, phrases: null, captions: null, ends: null, until: 0, queue: null, next: 0, said: 0, arrive: -1 };
  const SPEECH = { x: 0, y: 0, z: 0 };

  // ---- where a walker may stand -----------------------------------------------------------------------------

  const inRect = (r, x, z, pad) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
  const YAP = M.STATIONS[1];
  // The jetty runs out over the lagoon, which is otherwise water a walker keeps out of.
  const onJetty = (x, z) => x > YAP.jetty[0] && x < YAP.jetty[1] && Math.abs(z - YAP.jetty[2]) < 0.7;
  const clearAt = (x, z, radius) => {
    let land = false;
    for (const r of M.REGIONS) if (x > r.x0 + radius && x < r.x1 - radius && z > r.z0 + radius && z < r.z1 - radius) { land = true; break; }
    if (!land) return false;
    for (const r of M.BLOCKS.rects) if (inRect(r, x, z, radius) && !(r.water && onJetty(x, z))) return false;
    for (const c of M.BLOCKS.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + radius) ** 2) return false;
    return true;
  };
  const walkable = (ax, az, bx, bz, y, height, actor) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
    for (let i = 1; i <= steps; i++) if (!clearAt(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, actor.bodyRadius)) return false;
    return true;
  };
  const reloadPolicy = { near: () => true, available: () => true, consume: () => {} };

  // ---- the handcar -------------------------------------------------------------------------------------------

  // The seat goes with the car: on its bench, facing the way it is going (or will go next), `walkAt` beside it on the
  // causeway's station side.
  const nextStop = () => (car.stop + 1) % STOPS.length;
  const placeSeat = () => {
    const seat = car.seat, ahead = car.to !== car.z ? car.to : STOPS[nextStop()];
    seat.x = 0;
    seat.z = car.z - 0.75;
    seat.y = RAIL_TOP + H.deck + H.seat;
    seat.ry = ahead < car.z ? Math.PI : 0;
    seat.floor = 0;
    seat.walkAt.x = H.step + 0.45;
    seat.walkAt.z = car.z;
  };
  const depart = () => {
    if (car.to !== car.z) return false;
    const from = car.stop;
    car.stop = nextStop();
    car.to = STOPS[car.stop];
    car.wait = 0;
    conductor.queue = LINES.legs[`${from}>${car.stop}`];
    conductor.next = 0;
    conductor.arrive = -1;
    speakNext();
    return true;
  };

  // ---- the Conductor ------------------------------------------------------------------------------------------

  // A bubble is one line, so a long line is shown as phrases of at most `PHRASE` characters, one after another, each
  // for as long as it takes to read. `ends` are when each phrase gives way to the next.
  const PHRASE = 46, CAPTION_TOP = 120, CAPTION_NEAR = 4, CAPTION_LIFT = 150;
  const talk = (text, hold = 0) => {
    const phrases = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line && line.length + 1 + word.length > PHRASE) { phrases.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    phrases.push(line);
    let t = now;
    conductor.ends = phrases.map((p) => (t += 1.4 + p.length * 0.055));
    conductor.phrases = phrases;
    conductor.captions = phrases.map((p) => `Conductor: ${p}`);
    conductor.until = Math.max(t, now + hold);
    conductor.said = now;
  };
  // The leg's next line; `@repeal` is spoken (and done) only to a visitor holding wampum that is still money.
  const speakNext = () => {
    const q = conductor.queue;
    while (q && conductor.next < q.length) {
      const line = q[conductor.next++];
      if (line !== "@repeal") return talk(line);
      if (saved.purse.wampum > 0 && !saved.dead.has("wampum")) {
        saved.dead.add("wampum");
        refreshPurse();
        return talk(LINES.repeal);
      }
    }
  };
  const pick = (list) => list[(Math.random() * list.length) | 0];
  // The leg's lines run on in turn, past the stop if the ride was short, then the stop's welcome; while the car stands
  // after that, a tip now and then if the visitor is about.
  const chatter = () => {
    const gap = now > conductor.until + 0.6;
    if (conductor.queue && conductor.next < conductor.queue.length) {
      if (gap) speakNext();
      return;
    }
    if (conductor.arrive >= 0) {
      if (gap) {
        talk(LINES.arrive[conductor.arrive]);
        conductor.arrive = -1;
        conductor.queue = null;
      }
      return;
    }
    if (car.to !== car.z || now - conductor.said < 16) return;
    const p = avatar.root.position;
    if (Math.hypot(p.x, p.z - car.z) > 14) return;
    talk(Math.random() < 0.6 ? pick(LINES.idle[car.stop]) : pick(LINES.general));
  };
  // Hands on the lever, rocking with it; facing the lever from the car's +z end.
  const poseConductor = () => {
    const c = conductor.cave, swing = Math.sin(car.phase) * 0.35 * Math.min(1, car.v);
    c.parts.armR.rotation.x = c.parts.armL.rotation.x = -1.25 + swing;
    c.root.rotation.y = Math.PI;
  };

  // ---- the purse ----------------------------------------------------------------------------------------------

  const refreshPurse = () => {
    const rows = [];
    for (const item of PURSE) {
      const n = saved.purse[item.id];
      if (!n) continue;
      const li = document.createElement("li"), name = document.createElement("span"), count = document.createElement("b"), note = document.createElement("small");
      const dead = saved.dead.has(item.id);
      li.dataset.state = dead ? "dead" : "ok";
      name.textContent = item.label;
      count.textContent = String(n);
      note.textContent = dead ? item.dead : item.note;
      li.append(name, count, note);
      rows.push(li);
    }
    if (!rows.length) {
      const li = document.createElement("li");
      li.dataset.empty = "";
      li.textContent = "Empty. Dig, carry or strike to earn each era's money.";
      rows.push(li);
    }
    purseList.replaceChildren(...rows);
  };
  const give = (id, n) => {
    const item = PURSE.find((p) => p.id === id);
    saved.purse[id] = Math.min(item.cap, saved.purse[id] + n);
    refreshPurse();
  };
  const spend = (id, n) => {
    saved.purse[id] -= n;
    refreshPurse();
  };
  // The beach stall: no shells, no deal; the first time, a cowrie buys six white beads at the Massachusetts rate;
  // after that, a cowrie buys a fish.
  const shellStall = () => {
    if (!saved.purse.cowrie) return toast("No shells, no fish. Dig the mounds for cowries first.");
    if (!saved.purse.wampum && !saved.dead.has("wampum")) {
      spend("cowrie", 1);
      give("wampum", 6);
      return toast("Traded one cowrie for six white wampum beads: the Massachusetts rate in 1637. Hang on to them... or don't.");
    }
    spend("cowrie", 1);
    toast("Grilled fish, paid in shells. The fisher will spend them tomorrow. That's what makes them money.");
  };
  const coinStall = () => {
    if (!saved.purse.coin) return toast("No coin, no bread. Strike one at the mint.");
    spend("coin", 1);
    toast("A loaf for one coin. Nobody weighed it: the stamp already did. That's the whole trick.");
  };
  // A rider sat on a standing car sets it off after a moment; it speeds up, rolls and brakes into the next stop, where
  // it holds until its rider has got off.
  const roll = (dt) => {
    car.arrived = false;
    if (car.to === car.z) {
      if (!car.seat.sitter) car.hold = false;
      car.wait = car.seat.sitter && !car.hold ? car.wait + dt : 0;
      if (car.wait >= H.wait) depart();
    }
    if (car.to !== car.z) {
      const left = Math.abs(car.to - car.z);
      car.v = Math.min(H.speed * 1.6, car.v + H.accel * dt, Math.sqrt(2 * H.accel * left) + 0.05);
      if (car.v * dt >= left) {
        car.z = car.to;
        car.v = 0;
        car.arrived = car.hold = true;
      } else car.z += Math.sign(car.to - car.z) * car.v * dt;
      car.phase = (car.phase + car.v * dt * 2.2) % (Math.PI * 2);
    }
    car.node.position.z = car.z;
    car.pump.rotation.x = Math.sin(car.phase) * 0.32 * Math.min(1, car.v);
    placeSeat();
  };
  // Only a standing Ooga boards, as on Jekyll Island's handcar: a direction still held would stand it straight back up.
  const nearCar = (x, z, reach) => !pilot.moving && car.to === car.z && !car.seat.sitter && !car.hold && Math.hypot(x, z - car.z) < H.half + reach;

  // ---- the stations' moments ---------------------------------------------------------------------------------

  const toast = (text) => hud.toast(text);
  const award = (id) => {
    if (saved.coins.has(id)) return;
    saved.coins.add(id);
    toast(`Coin found: ${COIN_NAMES[id]} · ${saved.coins.size} of ${COINS_ON_LINE} on the line`);
  };
  const dig = (m) => {
    if (m.dug) { toast("Already dug. Sand, and more sand."); return; }
    m.dug = true;
    const p = m.node.position;
    fx.burst(p.x, 0.3, p.z, 10, [DUST], 1.4);
    addTween({ dur: 0.5, update: (k) => { m.node.scale.y = 1 - 0.8 * k; m.shell.position.y = 0.05 + 0.35 * Math.sin(k * Math.PI) + 0.1 * k; } });
    m.shell.visible = true;
    give("cowrie", 1);
    const found = mounds.filter((n) => n.dug).length;
    if (found === 1) talk(LINES.dig);
    toast(found < mounds.length ? `A cowrie! ${found} of ${mounds.length}.` : "A cowrie! That's all three: shells enough to buy something small.");
    if (found === mounds.length) award("cowrie");
  };
  const carry = () => {
    if (carriedNode.busy) return;
    carriedNode.busy = true;
    const x0 = carriedNode.position.x, y0 = carriedNode.position.y;
    toast("Heave! A stone this size takes a crowd to move, and the whole village sees it go.");
    addTween({
      dur: 4, update: (k) => {
        const out = Math.sin(k * Math.PI);
        carriedNode.position.x = x0 + 3 * out;
        carriedNode.position.y = y0 + 0.5 * Math.min(1, out * 3);
      }, done: () => {
        carriedNode.position.x = x0;
        carriedNode.position.y = y0;
        carriedNode.busy = false;
        toast("Set down where it started. Its owner changed; the stone didn't move an inch for good.");
        give("rai", 1);
        talk(LINES.carry);
        award("rai");
      }
    });
  };
  const strike = () => {
    if (hammer.busy) return;
    hammer.busy = true;
    addTween({
      dur: 0.7, update: (k) => { hammer.rotation.x = k < 0.6 ? 1.1 * Math.sin(k / 0.6 * Math.PI / 2) : 1.1 - 1.2 * (k - 0.6) / 0.4; }, done: () => {
        hammer.rotation.x = 0;
        hammer.busy = false;
        const w = mint.position;
        fx.burst(w.x, 0.85, w.z, 12, [SPARK], 1.6);
        struckCoin.visible = true;
        if (saved.purse.coin >= 9) toast("Your purse holds nine coins. Spend some on bread first.");
        else {
          if (!saved.coins.has("lion")) talk(LINES.coin);
          give("coin", 1);
          toast("Struck: a lion's head on one side, the punch's mark on the other. No need to weigh it again.");
        }
        award("lion");
      }
    });
  };
  const collect = (b) => {
    if (saved.bananas.has(b.id)) return;
    saved.bananas.add(b.id);
    b.node.visible = false;
    fx.burst(b.node.position.x, 0.6, b.node.position.z, 14, [SPARK], 1.5);
    toast(`A golden banana! ${saved.bananas.size} of ${BANANAS_ON_ROUTE} along the whole route.`);
  };

  // A tap or a Space at something: its moment if it has one, else the next thing it says.
  const poke = (owner) => {
    if (owner.kind === "goldbanana") return collect(owner.banana);
    if (owner.kind === "exit") return leaveLine();
    if (owner.kind === "dig") return dig(owner.mound);
    if (owner.kind === "carry") return carry();
    if (owner.kind === "anvil") return strike();
    if (owner.kind === "shellstall") return shellStall();
    if (owner.kind === "coinstall") return coinStall();
    if (owner.kind === "conductor") return talk(Math.random() < 0.5 ? pick(LINES.idle[car.stop]) : pick(LINES.general));
    if (owner.kind === "handcar") {
      if (!pilot.player) toast(depart() ? "The handcar trundles off on its own." : LORE.handcar.say[0]);
      else toast("Walk your Ooga up beside the handcar and press Space to ride.");
      return;
    }
    const lore = LORE[owner.kind];
    if (!lore.say.length) return;
    owner.said = owner.said === undefined ? 0 : (owner.said + 1) % lore.say.length;
    toast(lore.say[owner.said]);
  };
  // Space with the Ooga: the car, the way home, then the nearest moment within reach.
  const useNear = (x, z, reach) => {
    if (nearCar(x, z, reach)) return crew.sitPlayer(car.seat);
    if (z > M.EXIT.z - 1.6 && Math.abs(x - M.EXIT.x) < M.EXIT.half) { leaveLine(); return true; }
    let best = null, d2 = REACH * REACH;
    for (const o of owners) {
      if (!o.moment) continue;
      const p = o.at, d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < d2) { best = o; d2 = d; }
    }
    if (!best) return false;
    poke(best);
    return true;
  };
  // What Space would do here, for the prompt.
  const contextAt = () => {
    const p = avatar.root.position;
    if (!pilot.player) return "";
    if (avatar.camp.seat) return "seated";
    if (nearCar(p.x, p.z, REACH)) return "board";
    if (p.z > M.EXIT.z - 1.6 && Math.abs(p.x - M.EXIT.x) < M.EXIT.half) return "exit";
    for (const o of owners) if (o.moment && (p.x - o.at.x) ** 2 + (p.z - o.at.z) ** 2 < REACH * REACH) return o.kind;
    return "";
  };
  const PROMPTS = {
    "": ["", "USE"], seated: ["Move or press Space to hop off", "HOP OFF"], board: ["Press Space to ride to the next stop", "RIDE"],
    exit: ["Press Space to go back to Jekyll Island", "TO JEKYLL"], dig: ["Press Space to dig for cowries", "DIG"],
    shellstall: ["Press Space to trade at the stall", "TRADE"], coinstall: ["Press Space to buy bread for a coin", "BUY"],
    carry: ["Press Space to help carry the stone", "CARRY"], anvil: ["Press Space to strike a coin", "STRIKE"]
  };
  const syncContext = () => {
    const now = contextAt();
    if (now === lastContext) return;
    lastContext = now;
    const [hint, act] = PROMPTS[now];
    if (hint) hud.hint(COARSE ? hint.replace("Press Space", `Tap ${act}`) : hint);
    else hud.hideHint();
    hud.setAct(act);
  };
  const syncArea = () => {
    const z = avatar.root.position.z;
    let area = z > -20 ? "PLATFORM" : z < -142 ? "END OF THE LINE" : "MONEY LINE";
    for (const s of M.STATIONS) if (Math.abs(z - s.center[1]) < 20) area = s.label;
    if (area === lastArea) return;
    lastArea = area;
    hud.setAreaLabel(area);
  };

  const leaveLine = () => {
    if (exiting) return;
    exiting = true;
    world.pilot = avatar.traits.name;
    pilot.controls.reset();
    input.reset();
    go("hub");
  };

  // ---- the visit -----------------------------------------------------------------------------------------------

  const register = (node, kind, radius, extra = {}) => {
    const owner = { kind, label: LORE[kind].tip, node, at: node.position, moment: !!(LORE[kind].coin || LORE[kind].moment), ...extra };
    input.add(node, owner, { radius });
    targets.push(node);
    owners.push(owner);
    return owner;
  };
  const place = (geometry, x, z, ry = WEST, y = 0, extra = {}) => {
    const node = createNode({ geometry, position: { x, y, z }, rotation: { x: 0, y: ry, z: 0 }, ...extra });
    addChild(root, node);
    return node;
  };
  const build = () => {
    const [shells, yap, coins] = M.STATIONS;
    addChild(root, createNode({ geometry: M.ground() }), createNode({ geometry: M.track() }));
    register(place(M.arch(), 0, 0, 0), "exit", 2.6);
    register(place(M.barrier(), 0, 0, 0), "endline", 2.4);
    for (const s of M.STATIONS) {
      register(place(BL.hubModels.postSign(s.name, 0.55, 0.9), s.sign[0], s.sign[1]), `${s.id === "shells" ? "shell" : s.id === "yap" ? "yap" : "coin"}sign`, 1.4);
    }
    register(place(M.dateStone(0), shells.dateAt[0], shells.dateAt[1]), "shelldate", 1);
    register(place(M.dateStone(1), coins.dateAt[0], coins.dateAt[1]), "coindate", 1);
    // Shells and beads.
    register(place(M.cowrieRack(), shells.rack[0], shells.rack[1]), "cowries", 1.4);
    register(place(M.wampum(), shells.belt[0], shells.belt[1], 0), "wampum", 1.8);
    for (const [x, z] of shells.dig) {
      const node = place(M.mound(), x, z, 0, 0, { scale: { x: 1, y: 1, z: 1 } });
      const shell = place(M.cowrie(), x, z, 0, 0.05, { visible: false });
      const m = { node, shell, dug: false };
      mounds.push(m);
      register(node, "dig", 0.9, { mound: m });
    }
    place(M.pool(), shells.pool[0], shells.pool[1], 0);
    register(place(M.cowrie(), shells.pool[0] + 0.6, shells.pool[1] - 0.4, 0.7, 0.08), "moneta", 0.5);
    shells.palms.forEach(([x, z, v]) => place(BL.dressing.palm(v), x, z, v * 1.3));
    // The stones of Yap.
    place(M.house(), yap.house[0], yap.house[1], 0);
    for (const [x, z, size] of yap.leaning) register(place(M.rai(size), x, z, Math.PI / 2, size, { rotation: { x: 0, y: Math.PI / 2, z: 0.12 } }), "rai", size + 0.3);
    carriedNode = place(M.carried(), yap.carry[0], yap.carry[1], Math.PI / 2, 1.15);
    register(carriedNode, "carry", 1.6);
    place(M.lagoon(), (yap.lagoon.x0 + yap.lagoon.x1) / 2, (yap.lagoon.z0 + yap.lagoon.z1) / 2, 0);
    register(place(M.rai(1.3), yap.sunk[0], yap.sunk[1], Math.PI / 2, 0.4, { rotation: { x: 0, y: Math.PI / 2, z: 0.35 } }), "sunk", 1.6);
    place(M.jetty(), yap.jetty[0], yap.jetty[2], 0);
    register(place(M.okeefe(), yap.okeefe[0], yap.okeefe[1], 0.4), "okeefe", 1.3);
    register(place(M.flag(), yap.flag[0], yap.flag[1], 0), "yapflag", 1);
    register(place(M.ottawa(), yap.ottawa[0], yap.ottawa[1]), "ottawa", 1.1);
    // The first coins.
    place(M.hill(), coins.hill[0], coins.hill[1], 0);
    mint = place(M.mint(), coins.mint[0], coins.mint[1], 0);
    // The hammer pivots at its handle's end, its head over the anvil at rest.
    hammer = createNode({ geometry: M.hammer(), position: { x: 0, y: 0.92, z: 0.85 } });
    struckCoin = createNode({ geometry: M.struck(), position: { x: 0, y: 0.78, z: 0 }, visible: false });
    addChild(mint, hammer, struckCoin);
    register(mint, "anvil", 1.4);
    register(place(M.bigCoin(0), coins.lion[0], coins.lion[1]), "lion", 1);
    register(place(M.bigCoin(1), coins.owlCoin[0], coins.owlCoin[1]), "owlcoin", 1);
    register(place(M.owl(), coins.mint[0] + 0.6, coins.mint[1] + 0.8, WEST, 2.9), "owl", 0.5);
    register(place(M.phanes(), coins.mint[0] + 2.25, coins.mint[1] + 1.2, Math.PI / 2, 1.4), "phanes", 0.35);
    // One golden banana hidden at each station.
    for (const s of M.STATIONS) {
      const node = place(M.goldenBanana(), s.banana[0], s.banana[1], 0.6, 0.12, { scale: { x: 1.4, y: 1.4, z: 1.4 }, visible: !saved.bananas.has(s.id) });
      const banana = { id: s.id, node };
      bananas.push(banana);
      register(node, "goldbanana", 0.7, { banana });
    }
    // The handcar waits at the platform.
    const carNode = createNode({ geometry: jekyllIsle.handcar(), position: { x: 0, y: RAIL_TOP, z: STOPS[0] } });
    const pump = createNode({ geometry: jekyllIsle.lever(), position: { x: 0, y: H.deck + 0.88, z: 0 } });
    addChild(carNode, pump);
    addChild(root, carNode);
    car = {
      node: carNode, pump, z: STOPS[0], to: STOPS[0], stop: 0, v: 0, phase: 0, wait: 0, arrived: false, hold: false,
      seat: { kind: "bench", handcar: true, x: 0, y: 0, z: 0, floor: 0, ry: 0, sitter: null, walkAt: { x: 0, z: 0 } }
    };
    register(carNode, "handcar", 1.4);
    placeSeat();
    // The Conductor stands at the car's +z end, at the lever, in a cap sized to their head.
    const cave = models.caveman(contributors.traitsFor("The Conductor"));
    cave.root.position.z = 1.0;
    cave.root.position.y += H.deck;
    const head = cave.parts.head, b = BL.scene.boundsOf(head.geometry), width = b.max[0] - b.min[0];
    addChild(head, createNode({ geometry: M.cap(), position: { x: (b.min[0] + b.max[0]) / 2, y: b.max[1] - 0.02 * width, z: (b.min[2] + b.max[2]) / 2 }, scale: { x: width / 0.3, y: width / 0.3, z: width / 0.3 } }));
    addChild(carNode, cave.root);
    conductor.cave = cave;
    register(cave.parts.torso, "conductor", 0.7);
    // The stalls: fish (and wampum) on the beach, bread in Lydia.
    register(place(M.stall(0), shells.stall[0], shells.stall[1]), "shellstall", 1.2);
    register(place(M.stall(1), coins.stall[0], coins.stall[1]), "coinstall", 1.2);
    // The mint's furnace, and a lamp on the platform.
    const L = RENDER_OPTS.lights;
    L.set([coins.mint[0] + 1.2, 0.9, coins.mint[1] - 1.2, 7, 1, 0.55, 0.2, 0, M.EXIT.x, 3.6, M.EXIT.z - 0.6, 9, 1, 0.75, 0.4, 0]);
    RENDER_OPTS.lightCount = 2;
  };

  const onTap = (hit) => {
    if (exiting || !hit) return;
    poke(hit.owner);
  };
  const action = (name) => {
    if (name === "leave") leaveLine();
    else if (name === "act") pilot.action();
    else if (name === "reset-view") { if (pilot.player) { pilot.navigate(ARRIVAL); } else pilot.goPreset("start"); }
    else if (name.startsWith("weapon-") || name === "magazine-swap") pilot.weaponAction(name);
  };
  const onKey = (e) => {
    if (exiting) return;
    if (e.key === "Escape") leaveLine();
    else if (e.key === "0") action("reset-view");
    else if (e.key === "1" || e.key === "2") pilot.weaponMode(Number(e.key));
  };

  const enter = (ctx) => {
    ({ renderer, game, world, go } = ctx);
    exiting = false;
    lastContext = "init";
    lastArea = "";
    saved = world.moneyline || (world.moneyline = { coins: new Set(), bananas: new Set(), purse: { cowrie: 0, wampum: 0, rai: 0, coin: 0 }, dead: new Set() });
    now = 0;
    conductor.until = conductor.said = conductor.next = 0;
    conductor.arrive = -1;
    conductor.queue = conductor.phrases = conductor.captions = conductor.ends = null;
    purseList = document.getElementById("ml-purse-list");
    root = createNode();
    camera = createCamera({ fov: 55, near: 0.1, far: 400 });
    clock = daylight.createClock({ hour: hourParam, daylen: daylenParam, day: dayParam, time: timeParam, now: new Date() });
    hud = hudMod.create({ roster: contributors.roster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: false });
    sheetHidden = hud.el.sheet.hidden;
    sheetOpen = hud.el.sheet.dataset.open;
    hud.el.sheet.hidden = true;
    hud.el.sheet.dataset.open = "false";
    hud.setJetpack(false, false, 1);
    const hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    const clampTarget = (p) => {
      p.x = clamp(p.x, -14, 46);
      p.z = clamp(p.z, -168, 14);
      if (!pilot?.player) p.y = clamp(p.y, 0.5, 24);
    };
    const clampCamera = (p) => { p.y = clamp(p.y, 0.4, 70); };
    pilot = pilotMod.create({
      renderer, canvas: ctx.canvas, camera, hud, presets: PRESETS, landing: "start", pitch: [-0.5, 1.2], dist: [3, 40],
      follow: { y: 1, min: 3, max: 8, pitch: [0.1, 0.8] }, fly: { speed: 6, perDist: 0.1, climb: 4, yMax: 30 }, clampTarget, clampCamera, coarse: COARSE,
      close: { eyeHeight: 1.7, eyeRatio: 0.8, eyeForward: 0, maxStep: 0.6, pitch: [-1.2, 1.2], orbitDist: 12, trailingDist: 5, groundAt: () => 0 }
    });
    fx = fxMod.create({ root, renderer, camera, overlay: ctx.overlay, hud, tickerAt: { x: 0, y: 2, z: 0 } });
    // Whoever rode in from Jekyll Island stays themselves; a page that opens here takes `character=`, else the
    // roster's first. Their weapons and magazines come along; the line has no pile of its own.
    const asked = ctx.from === null ? params.get("character")?.trim().toLowerCase() : null;
    const named = asked ? contributors.roster.find((c) => c.name.toLowerCase() === asked) : null;
    const playerName = named ? named.name : world.pilot && contributors.roster.some((c) => c.name === world.pilot) ? world.pilot : contributors.roster[0].name;
    world.pilot = null;
    playerWorld = { level: 0, weapons: world.weapons, magazine: world.magazine };
    const shared = { root, input, hud, game, world: playerWorld, playerName, fx, viewYaw: 0, groundAt: () => 0, walkable, reloadPolicy, useNear };
    crew = BL.crew.create(shared);
    shared.crew = crew;
    pilot.bind(shared);
    avatar = crew.cavemen.get(playerName);
    Object.assign(hooks, pilot.hooks, {
      onTap,
      onHover: (hit, p) => { if (hit && !exiting) hud.tooltip.show(hit.owner.label, p.x, p.y); else hud.tooltip.hide(); },
      onHoverMove: (hit, p) => { if (hit && !exiting) hud.tooltip.show(hit.owner.label, p.x, p.y); }
    });
    hud.onAction(action);
    hud.onPreset((name) => pilot.goPreset(name));
    build();
    pilot.possess(avatar);
    pilot.navigate(ARRIVAL);
    hud.el.act.hidden = false;
    refreshPurse();
    talk("Welcome aboard the Money Line! Hop on the handcar with Space and I'll take you back to the beginning of money.");
    Object.assign(moneyline, {
      root, camera, input, debug: {
        camera, pilot, crew, hud, controls: pilot.controls, avatar,
        line: { get car() { return car; }, get saved() { return saved; }, mounds, bananas, owners, poke, useNear, depart, clearAt, LORE, LINES, conductor, talk, give }
      }
    });
  };

  const update = (dt, time) => {
    if (exiting) return;
    now = time;
    daylight.sample(clock.read(), RENDER_OPTS, clock.dayOfYear, LATITUDE, clock.continuousDay, clock.utcMs);
    RENDER_OPTS.time = time;
    RENDER_OPTS.shadowCenter.x = avatar.root.position.x;
    RENDER_OPTS.shadowCenter.z = avatar.root.position.z;
    pilot.readInput(dt);
    // The car moves before the crew does, so its rider sits where the car now is.
    roll(dt);
    const rider = car.seat.sitter;
    if (rider) {
      const p = rider.root.position;
      p.x = car.seat.x; p.y = car.seat.y + rider.traits.height * 0.08; p.z = car.seat.z;
      rider.root.rotation.y = car.seat.ry;
      if (car.arrived) crew.standPlayer(rider);
    }
    if (car.arrived) conductor.arrive = car.stop;
    chatter();
    poseConductor();
    crew.update(dt, time);
    pilot.update(dt);
    // Riding, the camera rides too: behind and above the car on the stations' side, looking down the line, as DSB
    // Land's rides do. The pilot takes it back the moment the Ooga hops off.
    if (avatar.camp.seat === car.seat) {
      const ahead = car.seat.ry === Math.PI ? -1 : 1;
      camera.position.x = RIDE_VIEW.side; camera.position.y = RIDE_VIEW.up; camera.position.z = car.z - ahead * RIDE_VIEW.back;
      camera.target.x = 0; camera.target.y = RIDE_VIEW.look; camera.target.z = car.z + ahead * RIDE_VIEW.ahead;
    }
    stepTweens(dt);
    fx.update(dt);
    mint.glow = 0.85 + 0.15 * Math.sin(time * 9) * Math.sin(time * 5.3);
    for (let i = 0; i < bananas.length; i++) bananas[i].node.rotation.y = time * 1.4 + i;
    syncContext();
    syncArea();
  };
  // The Conductor's bubble rides with the car, over their cap; when their head would land under the top HUD, off the
  // screen or right at the camera (riding beside them), it becomes a caption over the act button instead.
  const drawConductor = (ctx, project, drawSpeech) => {
    if (exiting || now >= conductor.until) return;
    SPEECH.x = 0;
    SPEECH.y = RAIL_TOP + H.deck + conductor.cave.traits.height * 1.15;
    SPEECH.z = car.z + 1.0;
    const screen = project(SPEECH.x, SPEECH.y, SPEECH.z), c = camera.position;
    let i = 0;
    while (i < conductor.ends.length - 1 && now >= conductor.ends[i]) i++;
    const alpha = Math.min(1, (conductor.until - now) * 2, (now - conductor.said) * 5);
    if (screen && screen.y > CAPTION_TOP && (c.x - SPEECH.x) ** 2 + (c.y - SPEECH.y) ** 2 + (c.z - SPEECH.z) ** 2 > CAPTION_NEAR ** 2) drawSpeech(ctx, conductor.phrases[i], screen.x, screen.y, alpha);
    else drawSpeech(ctx, conductor.captions[i], window.innerWidth / 2, window.innerHeight - CAPTION_LIFT, alpha);
  };
  const overlay = (dt) => fx.drawOverlay(dt, drawConductor);

  const leave = () => {
    exiting = true;
    pilot.dispose();
    crew.dispose();
    fx.dispose();
    for (const node of targets) input.remove(node);
    targets.length = mounds.length = bananas.length = owners.length = 0;
    const count = input.targetCount;
    input.dispose();
    hud.el.sheet.hidden = sheetHidden;
    hud.el.sheet.dataset.open = sheetOpen;
    hud.dispose();
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    RENDER_OPTS.lightCount = 0;
    conductor.cave = conductor.queue = null;
    purseList = null;
    renderer = game = world = go = camera = hud = input = pilot = fx = crew = avatar = clock = playerWorld = saved = car = mint = hammer = struckCoin = carriedNode = null;
    moneyline.input = moneyline.debug = null;
    return { targets: count };
  };
  const stats = () => {
    let visibleNodes = 0, allNodes = 0;
    traverseVisible(root, () => visibleNodes++);
    const visit = (node) => { allNodes++; for (const child of node.children) visit(child); };
    visit(root);
    return { visibleNodes, allNodes, targets: input.targetCount, tweens: tweenCount(), ...fx.stats() };
  };

  const moneyline = {
    id: "moneyline", wip: true, enter, update, overlay, onKey, leave, stats, renderOpts: RENDER_OPTS,
    root: null, camera: null, input: null, debug: null, agent: null, agentView: null, agentControls: null, agentHandoff: null,
    onDonation: (donation) => { game.recordDonation(donation); world.level = Math.min(BL.pile.MAX_BANANAS, world.level + BL.game.bananasFor(donation.sats)); },
    onLootCleared: () => {},
    liveGeometry: (set) => { set.add(avatar.headOpen).add(avatar.headClosed); },
    get inMotion() { return !!fx && fx.inMotion; }
  };
  BL.scenes = BL.scenes || {};
  BL.scenes.moneyline = moneyline;
})();
