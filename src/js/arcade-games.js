// Ooga Arcade's carnival games: skee-ball, hoop shot and the coconut shy. Each is a small state machine over nodes it
// builds once under its machine's group (`host.node`, the machine's own frame: the player at the origin facing -z).
// The arcade builds them to show each machine at rest; the carnival scene (`scene-carnival.js`) plays them. Every
// press of act advances a game; `update` runs per frame and allocates nothing; balls and coconuts are fixed pools
// that rest where the machine keeps them; the scoreboards swap cached digit geometries.
//
// host: { node, glow, best, onEnd(score), burst(lx, ly, lz, count), popup(text, big), cue(name), shake(k),
// crack(lx, ly, lz, big), flop() } where `glow` is the machine's lit node (flashed on a score) and `burst` takes a
// point in the machine's frame; the last five are optional, for the scene's HUD, sound, camera and juice: `crack`
// splits a coconut at a point on a big moment (husk chips fly on an ordinary score) and `flop` is a miss or a near
// thing the watchers groan at. The popups speak as the Oogas do.
// Each game returns { kind, name, help, verbs, stars, tickets(score), status, playing, start(), act(), stop(),
// update(dt), attract(dt, k), tease() }. `status` is one object written in place for the HUD: score, left (balls,
// seconds or throws) and its label, round, target, meter (0..1, or -1 when none shows) with its green window, streak,
// fire and the action button's verb. `attract` and `tease` are the arcade hall's show while nobody plays the machine,
// called after `update` and never during a game: `attract` runs its idle motion at `k` (0 to 1) and `tease` starts
// its showpiece, both over the game's own nodes, scoring nothing; `attract(dt, 0)` puts the machine back at rest, and
// the hall calls it before an Ooga starts a game there.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const AM = BL.arcadeModels;
  const { createNode, addChild } = BL.scene;
  const noop = () => {};
  // A triangle wave 0..1..0 over one period of 1.
  const tri = (t) => { const f = t - Math.floor(t); return f < 0.5 ? f * 2 : 2 - f * 2; };
  const ease = (k) => k * k * (3 - 2 * k);
  const place = (n, x, y, z) => { n.position.x = x; n.position.y = y; n.position.z = z; };
  const hooks = (host) => ({ popup: host.popup || noop, cue: host.cue || noop, shake: host.shake || noop, crack: host.crack || noop, flop: host.flop || noop });
  const makeStatus = (label) => ({ score: 0, left: 0, label, round: 1, target: 0, meter: -1, window0: 0.63, window1: 0.77, streak: 0, fire: false, verb: "" });

  // A scoreboard hung at `at` in the machine's frame, crowned with a lashed bamboo pole and feathers (`bulbFrame`)
  // when it heads the machine: `show(value)` sets its digits, leading zeros dark.
  const scoreboard = (parent, title, digits, trim, at, header = false) => {
    const b = AM.board(title, digits, trim), node = createNode({ position: at, geometry: b.geo, sightHidden: true });
    const cells = b.slots.map(([x, y]) => createNode({ position: { x, y, z: 0.05 }, geometry: AM.digit(0), sightHidden: true, depthBias: -0.1 }));
    addChild(node, ...cells);
    if (header) addChild(node, createNode({ position: { x: 0, y: 0, z: 0.05 }, geometry: AM.bulbFrame(b.w + 0.1, b.h + 0.1), sightHidden: true }));
    addChild(parent, node);
    const show = (value) => {
      let v = Math.max(0, Math.floor(value));
      for (let i = cells.length - 1; i >= 0; i--) {
        cells[i].visible = i === cells.length - 1 || v > 0;
        cells[i].geometry = AM.digit(v % 10);
        v = Math.floor(v / 10);
      }
    };
    return { node, show };
  };
  // A post under a free-standing scoreboard whose middle is at `y`, from the floor to its frame.
  const standOn = (parent, x, y, z) => addChild(parent, createNode({ position: { x, y: 0, z }, scale: { x: 1, y: Math.max(0.05, y - 0.31), z: 1 }, geometry: AM.boardPost() }));
  // The machine's lights flash on a score and settle back.
  const flasher = (host) => {
    let f = 0;
    return {
      hit: (k) => { f = Math.max(f, k); },
      update: (dt) => { if (!host.glow || !f) return; f = Math.max(0, f - dt * 2.5); host.glow.glow = 1 + f; }
    };
  };

  // ---- skee-ball ----------------------------------------------------------------------------------------
  // Nine coconuts in three rounds of three; the last round's are golden, and wait at the front of the basket. The aim
  // sweeps across the lane, a trail of chalk beads laid up the alley along the roll: act sets it, and a wide one banks
  // off the bamboo guard. The meter swings, faster each coconut, with the arrow over the board where the coconut would
  // land and the green on the best cup in its line: act sets the power and rolls it. It spins up the alley (clacking
  // off the guard on a bank), hops the hump and lands where aim and power put it: the 100 cups, the 50 cup, then the
  // rings from 40 out to 10; over the top it drops back into the 10. Doubles add up: the hot cup (it burns, a new one
  // each coconut) and a golden coconut each pay the cup once more. A trick shot, banked across the lane into the far
  // 100 (the beads swell and light up when the aim is on it), pays 50 on top; but a coconut coming in off the guard drops only
  // dead centre (`SKEE_TRICK_R`, the green narrowing to match): off it, it rattles out into the 10.
  // Popups built once per value and kept, so a score builds no string in play.
  const worded = (pre) => { const said = []; return (n) => said[n] || (said[n] = `${pre}${n}`); };
  const SKEE_HOT = [40, 50, 100, 50, 100, 40, 100, 40, 50];
  const SKEE_AIM = [0.42, 0.5, 0.58], SKEE_TRICK = 50, SKEE_TRICK_R = 0.045;
  // Where along its sweep each coconut's aim starts, and which way it runs: between the cups' lines, never twice the
  // same, so the beads are read and not a beat learned.
  const SKEE_START = [0.29, 0.79, 0.11, 0.61, 0.21, 0.89, 0.39, 0.71, 0.07];
  const SKEE_SAY = {
    ooga: worded("OOGA! +"), goldOoga: worded("Golden OOGA! +"), trick: worded("Trick shot! +"), cup: worded("Coconut in hole! +"), goldCup: worded("Golden cup! +"),
    hot: worded("Hot cup! +"), close: worded("So close! +"), plus: worded("+"), far: worded("Too far! +"), rattle: worded("Rattled out! +")
  };
  const skeeball = (host) => {
    // `WALL` is how far across the coconut's middle goes before it banks; the aim sweeps a run of `REACH` either way,
    // a little past a bank into the far 100, so that one is a shot to time and not a rest at the sweep's end.
    const S = AM.SKEE, g = host.node, R = 0.075, BALLS = 9, WALL = 0.31, REACH = 1.05, DOTS = 7, out = hooks(host);
    const POINT = { x: 0, y: 0, z: 0 }, FROM = { x: 0, y: 0, z: 0 }, AT = { x: 0, y: 0, z: 0 };
    // How far along its sideways run a coconut is at `z`: none at the foul line, all of it at the rings' middle.
    const END = S.at(0, 0, AT).z, lat = (z) => (z - S.foul) / (END - S.foul);
    // A sideways run folded between the guards: where a coconut sent `x` across ends up, and how often it banked.
    const fold = (x) => { const p = ((x + WALL) % (4 * WALL) + 4 * WALL) % (4 * WALL); return p < 2 * WALL ? p - WALL : 3 * WALL - p; };
    const banks = (x) => Math.floor((Math.abs(x) + WALL) / (2 * WALL));
    // The coconut in hand, husk or golden; the aim's beads; the arrow over the landing; the hot cup's flames; the
    // basket, its first three (the last to roll) golden.
    const husk = createNode({ geometry: AM.balls(1), visible: false, sightHidden: true });
    const gold = createNode({ geometry: AM.coconutBall("golden", R), visible: false, sightHidden: true });
    const aim = createNode({ geometry: AM.arrow(), scale: { x: 1.6, y: 1.6, z: 1.6 }, visible: false, sightHidden: true });
    const dots = [], hot = [];
    for (let i = 0; i < DOTS; i++) dots.push(createNode({ geometry: AM.skeeDot(), visible: false, sightHidden: true }));
    for (let i = 0; i < 2; i++) hot.push(createNode({ geometry: AM.hoop().fire, rotation: { x: S.tilt, y: 0, z: 0 }, visible: false, sightHidden: true }));
    const tray = S.tray.map(([x, z], i) => createNode({ geometry: i < 3 ? gold.geometry : AM.balls(1), position: { x, y: S.trayY + R, z }, sightHidden: true }));
    addChild(g, husk, gold, aim, ...dots, ...hot, ...tray);
    const at = AM.skeeLane().boardAt, board = scoreboard(g, "THRO-BALL", 4, "#ffb347", at, true);
    const left = scoreboard(g, "COCONUTS", 1, "#f3e6c8", { x: at.x, y: at.y - 0.72, z: at.z });
    const flash = flasher(host), status = makeStatus("Coconuts");
    board.show(host.best);
    left.show(0);
    // `across` when the aim banks across into the far side, `rattled` when such a coconut came in off centre.
    let phase = "idle", t = 0, cur = husk, sweep = 0, run = 0, lastRun = 0, lap = 0, power = 0, u = 0, v = 0, balls = 0, lastZ = 0, hotCup = 50, golden = false, across = false, rattled = false;
    const acrossOf = (x) => banks(x) > 0 && (fold(x) < 0) !== (x < 0);
    const scoreAt = (pu, pv) => {
      if (pv > S.top) return 10;
      if (Math.hypot(Math.abs(pu) - S.hundred.u, pv - S.hundred.v) < S.hundred.r) return 100;
      if (Math.hypot(pu, pv - S.fifty.v) < S.fifty.r) return 50;
      const r = Math.hypot(pu, pv);
      for (let i = 0; i < S.rings.length; i++) if (r < S.rings[i]) return S.values[i];
      return 10;
    };
    // Just off the 50's or a 100's lip.
    const lipped = (pu, pv) => {
      const a = Math.hypot(Math.abs(pu) - S.hundred.u, pv - S.hundred.v) - S.hundred.r, b = Math.hypot(pu, pv - S.fifty.v) - S.fifty.r;
      return a > 0 && a < 0.035 || b > 0 && b < 0.035;
    };
    // The meter's green: the power that lands in the best cup (or ring) in line with where the coconut lands across; a
    // 100 taken off the guard only dead centre.
    const band = (pu) => {
      const a = Math.abs(pu), off = a - S.hundred.u, r = across ? SKEE_TRICK_R : S.hundred.r;
      let mid = 0, half = 0;
      if (Math.abs(off) < r * 0.8) { mid = S.hundred.v; half = Math.sqrt(r * r - off * off); }
      else if (a < S.fifty.r * 0.8) { mid = S.fifty.v; half = Math.sqrt(S.fifty.r * S.fifty.r - a * a); }
      else { const r = a < S.rings[0] * 0.9 ? S.rings[0] : S.rings[1]; half = Math.sqrt(Math.max(0.0025, r * r - a * a)); }
      status.window0 = (mid - half + 0.85) / 1.75; status.window1 = (mid + half + 0.85) / 1.75;
    };
    const fillTray = (n) => { for (let i = 0; i < tray.length; i++) tray[i].visible = i < n; };
    const showDots = (on) => { for (let i = 0; i < DOTS; i++) dots[i].visible = on; };
    // The beads up the alley along the roll the aim would give, swollen and lit while it is on a trick shot.
    const layDots = () => {
      const lit = acrossOf(sweep) && Math.abs(Math.abs(fold(sweep)) - S.hundred.u) < SKEE_TRICK_R;
      for (let i = 0; i < DOTS; i++) {
        const d = dots[i], z = S.foul + (S.hump - S.foul) * (i + 0.7) / DOTS;
        place(d, fold(sweep * lat(z)), S.alleyY(z) + 0.012, z);
        d.glow = lit ? 2.6 : 1; d.scale.x = d.scale.y = d.scale.z = lit ? 1.9 : 1;
      }
    };
    // The aim `t` seconds into the coconut's sweep.
    const sweepAt = (t) => (tri(t * SKEE_AIM[status.round - 1] + SKEE_START[BALLS - balls]) * 2 - 1) * REACH;
    // Flames round the hot cup: both 100s, the 50, or the 40 ring.
    const burn = () => {
      const two = hotCup === 100;
      for (let i = 0; i < 2; i++) {
        const n = hot[i], s = two ? 0.5 : hotCup === 50 ? 0.6 : 1;
        n.visible = i === 0 || two;
        S.at(two ? (i ? S.hundred.u : -S.hundred.u) : 0, two ? S.hundred.v : hotCup === 50 ? S.fifty.v : 0, AT);
        place(n, AT.x, AT.y + 0.01, AT.z);
        n.scale.x = n.scale.y = n.scale.z = s;
      }
    };
    // A bank off the guard clacks and throws a chip of bamboo.
    const clack = (x) => {
      const n = banks(x);
      if (n === lap) return;
      lap = n;
      out.cue("clack");
      host.burst(cur.position.x, cur.position.y, cur.position.z, 5);
    };
    const nextBall = () => {
      const k = BALLS - balls;
      phase = "aim"; t = 0; hotCup = SKEE_HOT[k]; golden = k >= 6;
      cur = golden ? gold : husk;
      husk.visible = !golden; gold.visible = golden; aim.visible = false;
      cur.scale.x = cur.scale.y = cur.scale.z = 1;
      cur.rotation.z = 0;
      place(cur, 0, S.alleyY(S.foul) + R, S.foul);
      showDots(true);
      burn();
      fillTray(balls - 1);
      left.show(balls);
      status.left = balls; status.round = Math.floor(k / 3) + 1; status.meter = -1; status.verb = "Aim";
      sweep = sweepAt(0);
      layDots();
      if (k === 3) { out.popup("Round 2", true); out.cue("round"); }
      else if (k === 6) { out.popup("Golden coconuts! Double!", true); out.cue("fire"); }
    };
    // The coconut lands: the score goes up at once, then it sinks into its cup.
    const land = () => {
      phase = "sink"; t = 0;
      rattled = across && v <= S.top && Math.hypot(Math.abs(u) - S.hundred.u, v - S.hundred.v) >= SKEE_TRICK_R && scoreAt(u, v) === 100;
      const cup = rattled ? 10 : scoreAt(u, v), isHot = cup === hotCup, trick = cup === 100 && across, times = 1 + (isHot ? 1 : 0) + (golden && cup >= 50 ? 1 : 0);
      const value = cup * times + (trick ? SKEE_TRICK : 0), big = cup >= 50 || times > 1;
      status.score += value;
      board.show(status.score);
      flash.hit(cup >= 100 ? 3 : cup >= 50 ? 2 : times > 1 ? 1.4 : 0.8);
      host.burst(POINT.x, POINT.y + 0.1, POINT.z, cup >= 100 ? 28 : cup >= 50 ? 18 : 8);
      out.cue(big ? "big" : "thunk");
      if (big) out.shake(times > 2 ? 0.75 : times > 1 ? 0.55 : 0.35);
      // The cups and every double crack a coconut; over the top it drops back into the 10, and a near thing on a
      // cup's lip, and the watchers groan.
      if (v > S.top) { out.flop(); out.popup(SKEE_SAY.far(value), false); return; }
      if (rattled) { out.cue("clang"); out.flop(); out.popup(SKEE_SAY.rattle(value), false); return; }
      out.crack(POINT.x, POINT.y + 0.1, POINT.z, big);
      if (cup >= 100) out.popup(trick ? SKEE_SAY.trick(value) : golden ? SKEE_SAY.goldOoga(value) : SKEE_SAY.ooga(value), true);
      else if (cup >= 50) out.popup(golden ? SKEE_SAY.goldCup(value) : SKEE_SAY.cup(value), true);
      else if (isHot) out.popup(SKEE_SAY.hot(value), true);
      else if (lipped(u, v)) { out.flop(); out.popup(SKEE_SAY.close(value), false); }
      else out.popup(SKEE_SAY.plus(value), false);
    };
    const hide = () => { husk.visible = gold.visible = aim.visible = hot[0].visible = hot[1].visible = false; showDots(false); fillTray(tray.length); left.show(0); status.meter = -1; };
    // The hall's show while nobody plays: now and then (`tease`) a lone coconut leaves the basket, rolls up the alley,
    // hops the hump and drops into a cup (the 100s, the 50, the rings in turn), scoring nothing.
    const SHOW = [[S.hundred.u, S.hundred.v], [0, S.fifty.v], [-S.hundred.u, S.hundred.v], [0.1, 0.12]];
    const I = { t: -1, n: 0, u: 0, x: 0, y: 0, z: 0, pz: 0, roll: 0 };
    const attract = (dt, k) => {
      if (I.t < 0) return;
      if (k <= 0) { I.t = -1; husk.visible = false; husk.scale.x = husk.scale.y = husk.scale.z = 1; fillTray(tray.length); return; }
      const was = I.t, fly = I.roll + 0.38;
      I.t += dt;
      if (I.t < I.roll) {
        const z = S.foul + (S.hump - S.foul) * ease(I.t / I.roll);
        place(husk, I.u * lat(z), S.alleyY(z) + R, z);
        husk.rotation.x += (z - I.z) / R;
        I.z = z;
      } else if (I.t < fly) {
        const f = (I.t - I.roll) / 0.38, x0 = I.u * lat(S.hump), y0 = S.alleyY(S.hump) + R + 0.08;
        place(husk, x0 + (I.x - x0) * f, y0 + (I.y - y0) * f + 1.4 * f * (1 - f), S.hump + (I.pz - S.hump) * f);
        husk.rotation.x -= dt * 14;
      } else {
        if (was < fly) out.cue("thunk");
        const f = Math.min(1, (I.t - fly) / 0.25);
        husk.scale.x = husk.scale.y = husk.scale.z = 1 - f;
        if (f >= 1) attract(0, 0);
      }
    };
    const tease = () => {
      if (I.t >= 0) return;
      const s = SHOW[I.n++ % SHOW.length];
      S.at(s[0], s[1], AT);
      I.t = 0; I.u = s[0]; I.x = AT.x; I.y = AT.y + R * 0.6; I.pz = AT.z; I.z = S.foul; I.roll = 0.5 + (1 - (s[1] + 0.85) / 1.75) * 0.35;
      place(husk, 0, S.alleyY(S.foul) + R, S.foul);
      husk.visible = true; husk.rotation.z = 0; husk.scale.x = husk.scale.y = husk.scale.z = 1;
      fillTray(tray.length - 1);
      out.cue("roll");
    };
    return {
      kind: "skee", name: "Thro-ball", help: "Space or tap sets the aim, then the power. Bank across into the far 100 for a trick shot.",
      stars: [150, 330, 700], tickets: (score) => Math.floor(score / 16), status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => { status.score = 0; balls = BALLS; board.show(0); nextBall(); },
      stop: () => { phase = "idle"; hide(); board.show(host.best); status.round = 1; },
      act: () => {
        if (phase === "aim") {
          phase = "power"; t = 0; status.verb = "Roll!";
          u = fold(sweep); across = acrossOf(sweep);
          band(u);
          aim.visible = true;
          out.cue("lock");
        } else if (phase === "power") {
          phase = "roll"; t = 0; lastZ = S.foul; lap = 0; status.meter = -1; status.verb = "";
          v = -0.85 + power * 1.75;
          aim.visible = false;
          showDots(false);
          S.at(u, v, POINT);
          POINT.y += R * 0.6;
          out.cue("roll");
        }
      },
      update: (dt) => {
        flash.update(dt);
        if (phase === "idle") return;
        t += dt;
        if (phase === "aim") {
          sweep = sweepAt(t);
          layDots();
        } else if (phase === "power") {
          power = tri(t * (0.6 + (BALLS - balls) * 0.07));
          status.meter = power;
          S.at(u, -0.85 + power * 1.75, AT);
          place(aim, AT.x, AT.y + 0.03, AT.z);
        } else if (phase === "roll") {
          const k = Math.min(1, t / (0.5 + (1 - power) * 0.35)), z = S.foul + (S.hump - S.foul) * ease(k);
          run = sweep * lat(z);
          place(cur, fold(run), S.alleyY(z) + R, z);
          cur.rotation.x += (z - lastZ) / R;
          cur.rotation.z = Math.sin(z * 11) * 0.12;
          lastZ = z;
          clack(run);
          if (k >= 1) { phase = "fly"; t = 0; lastRun = run; FROM.y = cur.position.y + 0.08; FROM.z = z; }
        } else if (phase === "fly") {
          // On across the board to where it lands, still banking between the guards' lianas.
          const k = Math.min(1, t / 0.38);
          run = lastRun + (sweep - lastRun) * k;
          place(cur, fold(run), FROM.y + (POINT.y - FROM.y) * k + 4 * 0.35 * k * (1 - k), FROM.z + (POINT.z - FROM.z) * k);
          cur.rotation.x -= dt * 14;
          clack(run);
          if (k >= 1) land();
        } else if (phase === "sink") {
          // A rattle round the cup's lip before it drops out.
          const k = Math.min(1, t / (rattled ? 0.4 : 0.25));
          if (rattled) cur.position.x = POINT.x + Math.sin(t * 55) * 0.03 * (1 - k);
          cur.scale.x = cur.scale.y = cur.scale.z = 1 - k;
          if (k >= 1) {
            if (--balls > 0) nextBall();
            else { phase = "idle"; hide(); status.left = 0; host.onEnd(status.score); }
          }
        }
      }
    };
  };

  // ---- hoop shot ----------------------------------------------------------------------------------------
  // Five rounds against the clock, as the arcade machines run them: reach the round's target before time runs out and
  // the next round starts, harder; fall short and the game is over; make the fifth's and it is won. The meter swings:
  // act throws at the hoop where it hangs as the coconut leaves the hand, and one stopped in the green flies true; the
  // green's bright middle is a clean dunk and a bonus point. From round two the hoop moves, sliding, then stopping and
  // going, and a true throw scores only if the hoop is still there when the coconut arrives: the shooter's square
  // over the rim lights while a throw would, and a resting hoop trembles once it will be gone before a coconut gets
  // there. Three baskets in a row set the rim on fire: every basket after is worth one more until a miss. The last
  // seconds of every round are the money rack: the coconuts turn golden and every basket pays double. Reaching the
  // round's target rings the bell.
  // Makes swish the net, drop through and come straight back; misses clang off the rim or the board, or drop past
  // where the hoop was, and roll home slowly. The button waits while no coconut is on the rack.
  // `move`: 0 still, 1 sliding (`slide` radians a second), 2 stopping and going (`hold` s at each stop, `glide` s
  // between them).
  const HOOP_ROUNDS = [
    { time: 20, target: 20, w0: 0.6, w1: 0.8, speed: 1, move: 0 },
    { time: 20, target: 50, w0: 0.62, w1: 0.78, speed: 1.15, move: 1, slide: 1.1 },
    { time: 20, target: 90, w0: 0.635, w1: 0.765, speed: 1.3, move: 2, hold: 1.3, glide: 0.45 },
    { time: 20, target: 130, w0: 0.65, w1: 0.75, speed: 1.45, move: 2, hold: 1.2, glide: 0.35 },
    { time: 20, target: 170, w0: 0.655, w1: 0.745, speed: 1.6, move: 2, hold: 1.1, glide: 0.3 }
  ];
  // Where the stop-and-go hoop rests, in turn; and the popups, built once.
  const HOOP_STOPS = [0, 0.32, 0, -0.32];
  const HOOP_SAY = {
    plus: worded("+"), dunk: worded("Clean dunk! +"), fire: worded("Fire dunk! +"), gold: worded("Golden dunk! +"),
    round: HOOP_ROUNDS.map((r, i) => `Round ${i + 1} · need ${r.target}`), ahead: HOOP_ROUNDS.map((_, i) => `Round ${i + 1} · target made!`),
    made: ["Target! Round 2 next", "Target! Round 3 next", "Target! Round 4 next", "Target! Last round next", "Target! Ooga champion!"]
  };
  const hoopShot = (host) => {
    // A make is back on the rack `BACK` s after it lands, a miss `MISS` s; the hoop eases from where a round found it
    // to the new round's pattern over `EASE_IN` s.
    const H = AM.HOOP, g = host.node, FLIGHT = 0.7, BACK = 0.85, MISS = 2, CATCH = 0.11, MONEY = 6, EASE_IN = 0.35, out = hooks(host);
    const parts = AM.hoop(), rim = createNode({ geometry: parts.rim, position: { x: 0, y: H.y, z: H.z }, sightHidden: true });
    const net = createNode({ geometry: parts.net, position: { x: 0, y: H.y, z: H.z }, sightHidden: true });
    const fire = createNode({ geometry: parts.fire, visible: false, sightHidden: true }), halo = createNode({ geometry: parts.halo, visible: false, sightHidden: true });
    addChild(rim, fire, halo);
    addChild(g, rim, net);
    const at = AM.hoopMachine().boardAt, board = scoreboard(g, "HOOP", 3, "#ffd23a", { x: at.x - 0.47, y: at.y, z: at.z }, true);
    const clock = scoreboard(g, "TIME", 2, "#f3e6c8", { x: at.x + 0.47, y: at.y, z: at.z }, true);
    const flash = flasher(host), status = makeStatus("Time");
    board.show(host.best);
    clock.show(0);
    // Each coconut on the rack is a husk and a golden one in the same place, the money rack showing the golden.
    const GOLD = AM.coconutBall("golden", 0.12);
    const shots = H.rack.map(([x, y, z]) => {
      const node = createNode({ geometry: AM.balls(0), position: { x, y, z }, sightHidden: true }), gold = createNode({ geometry: GOLD, position: { x, y, z }, visible: false, sightHidden: true });
      addChild(g, node, gold);
      return { node, gold, cur: node, home: { x, y, z }, t: -1, x: 0, y: 0, z: 0, make: false, moved: false, short: false, swish: false, golden: false, points: 0 };
    });
    let phase = "idle", left = 0, shown = -1, meterT = 0, cool = 0, hoopX = 0, swish = 0, round = 0, slideT = 0, money = false, rules = HOOP_ROUNDS[0];
    // `fromX` is where the hoop hung as the round began and `easeT` how far it has eased from there; `reached` marks
    // the round's target made, and `hailT` counts down to the bell's callout, after the basket's own.
    let fromX = 0, easeT = 1, reached = false, hailT = 0;
    const R = () => rules;
    const hoopAt = (t) => {
      const r = R();
      if (r.move === 1) return Math.sin(t * r.slide) * 0.3;
      if (r.move !== 2) return 0;
      const leg = r.hold + r.glide, n = Math.floor(t / leg), u = t - n * leg, a = HOOP_STOPS[n % 4], b = HOOP_STOPS[(n + 1) % 4];
      return u < r.hold ? a : a + (b - a) * ease((u - r.hold) / r.glide);
    };
    // Whether a coconut thrown now finds the hoop where it hangs.
    const holds = () => Math.abs(hoopAt(slideT + FLIGHT) - hoopX) < CATCH;
    // How much longer a stopped hoop rests (0 while it moves, or for good while it never does).
    const restLeft = (t) => {
      const r = R();
      if (r.move !== 2) return r.move ? 0 : Infinity;
      const u = t % (r.hold + r.glide);
      return u < r.hold ? r.hold - u : 0;
    };
    const gild = (s, on) => { s.golden = on; s.node.visible = !on; s.gold.visible = on; s.cur = on ? s.gold : s.node; };
    const settle = () => {
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i], h = s.home;
        s.t = -1; place(s.node, h.x, h.y, h.z); place(s.gold, h.x, h.y, h.z); gild(s, false);
      }
    };
    // A round's pattern starts at the rest nearest where the hoop hangs, and the hoop eases over to it; a target already
    // passed is made.
    const startRound = (r) => {
      round = r; rules = HOOP_ROUNDS[r]; left = rules.time; shown = -1; money = false; hailT = 0;
      slideT = rules.move === 2 ? (hoopX > 0.16 ? 1 : hoopX < -0.16 ? 3 : 0) * (rules.hold + rules.glide) : 0;
      fromX = hoopX; easeT = r ? 0 : 1;
      status.round = r + 1; status.target = rules.target; status.window0 = R().w0; status.window1 = R().w1;
      reached = status.score >= rules.target;
      if (r) { out.popup(reached ? HOOP_SAY.ahead[r] : HOOP_SAY.round[r], true); out.cue("round"); }
    };
    // The HUD between games shows the first round's.
    const ready = () => { status.round = 1; status.target = HOOP_ROUNDS[0].target; status.left = HOOP_ROUNDS[0].time; };
    ready();
    // The hall's show while nobody plays: the hoop slides on round two's pattern (`hoopX` stays put), and now and then
    // (`tease`) a coconut off the rack swishes through it and rolls home, scoring nothing.
    const I = { t: 0, s: -1, x: 0 };
    const attract = (dt, k) => {
      const s = shots[0], h = s.home, n = s.node;
      if (k <= 0) { I.t = 0; rim.position.x = net.position.x = 0; if (I.s >= 0) { I.s = -1; place(n, h.x, h.y, h.z); } return; }
      I.t += dt;
      rim.position.x = net.position.x = Math.sin(I.t * HOOP_ROUNDS[1].slide) * 0.3 * k;
      if (I.s < 0) return;
      I.s += dt;
      const F = H.from;
      if (I.s < FLIGHT) {
        const f = I.s / FLIGHT;
        place(n, F.x + (I.x - F.x) * f, F.y + (H.y - F.y) * f + 4.4 * f * (1 - f), F.z + (H.z - F.z) * f);
        n.rotation.x -= dt * 9;
        return;
      }
      if (I.s - dt < FLIGHT) { swish = 1; out.cue("swish"); }
      const e = I.s - FLIGHT, f0 = BACK / 3, fall = Math.min(1, e / f0), roll = ease(Math.max(0, (e - f0) / (BACK - f0))), y0 = H.y - 1.4 * fall;
      place(n, I.x + (h.x - I.x) * roll, y0 + (h.y - y0) * roll, H.z + (h.z - H.z) * roll);
      if (e >= BACK) { I.s = -1; place(n, h.x, h.y, h.z); }
    };
    const tease = () => {
      if (I.s >= 0 || shots[0].t >= 0) return;
      I.s = 0; I.x = Math.sin((I.t + FLIGHT) * HOOP_ROUNDS[1].slide) * 0.3;
      out.cue("throw");
    };
    return {
      kind: "hoops", name: "Hoop Shot", help: "Space or tap throws: stop the meter in the green while the hoop's square glows. Reach the target to play on.",
      stars: [20, 45, 140], tickets: (score) => score, status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => { phase = "play"; status.score = status.streak = 0; status.fire = false; cool = meterT = 0; board.show(0); status.verb = "Shoot!"; startRound(0); },
      stop: () => {
        phase = "idle"; rim.position.x = net.position.x = hoopX = rim.rotation.z = net.rotation.z = 0; status.streak = 0; status.fire = fire.visible = money = false;
        halo.visible = false; hailT = 0;
        clock.show(0); board.show(host.best); settle(); status.meter = -1; status.verb = "";
        ready();
      },
      act: () => {
        if (phase !== "play" || cool > 0 || left <= 0) return;
        let s = null;
        for (let i = 0; i < shots.length; i++) if (shots[i].t < 0) { s = shots[i]; break; }
        if (!s) return;
        // Long enough to keep a doubled press from throwing two, short enough to take the meter's way back down.
        cool = 0.15;
        const r = R(), m = tri(meterT), aimed = m >= r.w0 && m <= r.w1, stays = holds();
        s.make = aimed && stays;
        s.moved = aimed && !stays;
        s.short = m < r.w0;
        status.streak = s.make ? status.streak + 1 : 0;
        s.swish = s.make && Math.abs(m - (r.w0 + r.w1) / 2) < (r.w1 - r.w0) * 0.15;
        s.points = s.make ? ((r.move ? 3 : 2) + (status.streak > 3 ? 1 : 0) + (s.swish ? 1 : 0)) * (s.golden ? 2 : 1) : 0;
        s.x = hoopX;
        s.y = aimed ? H.y : s.short ? H.y - 0.02 : H.y + 0.45;
        s.z = aimed ? H.z : s.short ? H.z + H.r : H.z - 0.22;
        s.t = 0;
        out.cue("throw");
      },
      update: (dt) => {
        flash.update(dt);
        swish = Math.max(0, swish - dt * 3);
        net.scale.y = 1 + swish * 0.35;
        const burning = status.streak >= 3;
        if (burning !== status.fire) {
          status.fire = fire.visible = burning;
          if (burning) { out.cue("fire"); out.popup("Coconut on fire! +1 each", true); }
        }
        let home = 0;
        for (let i = 0; i < shots.length; i++) {
          const s = shots[i];
          if (s.t < 0) { home++; if (s.golden !== money) gild(s, money); continue; }
          s.t += dt;
          const F = H.from, h = s.home, n = s.cur;
          if (s.t < FLIGHT) {
            const k = s.t / FLIGHT;
            place(n, F.x + (s.x - F.x) * k, F.y + (s.y - F.y) * k + 4 * 1.1 * k * (1 - k), F.z + (s.z - F.z) * k);
            n.rotation.x -= dt * 9;
            continue;
          }
          if (s.t - dt < FLIGHT) {
            if (s.make) {
              const big = s.swish || s.golden || s.points > 3;
              status.score += s.points;
              board.show(status.score);
              if (!reached && status.score >= status.target) { reached = true; hailT = 0.5; flash.hit(3); }
              swish = 1;
              flash.hit(big ? 2.4 : 1.2);
              host.burst(s.x, H.y, H.z, big ? 22 : 12);
              out.cue(s.swish ? "swish" : "score");
              // A swish, a golden or a fire basket cracks a coconut under the net.
              out.crack(s.x, H.y - 0.2, H.z, big);
              out.popup(s.golden ? HOOP_SAY.gold(s.points) : s.swish ? HOOP_SAY.dunk(s.points) : s.points > 3 ? HOOP_SAY.fire(s.points) : HOOP_SAY.plus(s.points), big);
              if (big) out.shake(s.golden ? 0.55 : 0.4);
            } else if (s.moved) { out.cue("thunk"); out.flop(); out.popup("Hoop moved!", false); }
            else { out.cue("clang"); out.shake(0.2); out.flop(); out.popup(s.short ? "Short!" : "Long!", false); }
          }
          // A make is quick home down the ramp; a miss rolls the long way round.
          const e = s.t - FLIGHT, back = s.make ? BACK : MISS;
          if (s.make || s.moved) {
            // Down through the net, or past where the hoop was, then along the ramp home.
            const f0 = BACK / 3, fall = Math.min(1, e / f0), roll = ease(Math.max(0, (e - f0) / (back - f0))), y0 = s.y - 1.4 * fall;
            place(n, s.x + (h.x - s.x) * roll, y0 + (h.y - y0) * roll, s.z + (h.z - s.z) * roll);
          } else {
            // Off the rim and back toward the player, then home.
            const b0 = BACK / 2, b = Math.min(1, e / b0), roll = ease(Math.max(0, (e - b0) / (back - b0))), y0 = s.y + 0.5 * Math.sin(Math.PI * b) - 1.2 * b, z0 = s.z + 1.2 * b;
            place(n, s.x + (h.x - s.x) * roll, y0 + (h.y - y0) * roll, z0 + (h.z - z0) * roll);
          }
          if (e >= back) { s.t = -1; place(n, h.x, h.y, h.z); }
        }
        if (phase !== "play") return;
        left -= dt;
        slideT += dt;
        cool = Math.max(0, cool - dt);
        meterT += dt * R().speed;
        status.meter = tri(meterT);
        easeT = Math.min(1, easeT + dt / EASE_IN);
        hoopX = easeT < 1 ? fromX + (hoopAt(slideT) - fromX) * ease(easeT) : hoopAt(slideT);
        rim.position.x = net.position.x = hoopX;
        // The hoop's light shows while a throw would find it still there; a resting hoop trembles once it would not,
        // harder as it is about to go. The button waits while no coconut is on the rack.
        const lit = holds(), rest = restLeft(slideT);
        halo.visible = lit;
        rim.rotation.z = net.rotation.z = rest > 0 && !lit ? Math.sin(slideT * 60) * (0.03 + 0.05 * Math.max(0, 1 - rest / FLIGHT)) : 0;
        if (hailT > 0 && (hailT -= dt) <= 0) { out.popup(HOOP_SAY.made[round], true); out.cue("bell"); }
        status.verb = left > 0 && home ? "Shoot!" : "";
        const secs = Math.max(0, Math.ceil(left));
        if (secs !== shown) {
          shown = secs;
          clock.show(secs);
          status.left = secs;
          if (secs <= 5 && secs > 0) out.cue("tick");
        }
        if (!money && left <= MONEY && left > 0) { money = true; out.popup("Money rack! Double!", true); out.cue("fire"); }
        let flying = 0;
        for (let i = 0; i < shots.length; i++) if (shots[i].t >= 0 && shots[i].t < FLIGHT) flying++;
        if (left <= 0 && !flying) {
          const made = status.score >= status.target;
          if (made && round < HOOP_ROUNDS.length - 1) startRound(round + 1);
          else {
            phase = "idle"; status.meter = -1; status.streak = 0; status.fire = fire.visible = money = false; status.verb = "";
            halo.visible = false; rim.rotation.z = net.rotation.z = 0;
            if (made) { out.popup("Five rounds! Ooga champion!", true); out.cue("win"); }
            else out.cue("buzzer");
            host.onEnd(status.score);
          }
        }
      }
    };
  };

  // ---- the coconut shy ------------------------------------------------------------------------------------
  // Twenty-five throws for five racks of five coconuts on the posts, the throws left carried from rack to rack. The
  // marker swings along the posts without stopping, faster each rack, and glows over a coconut dead on: act throws at
  // it, and the next throw can follow while one is still in the air. Dead on, a coconut tumbles off its cup; a
  // glancing hit only rocks it, and a second one brings it down (a throw at one already going down flies past it into
  // the screen). Coconuts knocked off throw after throw are a combo: from the third each is worth one more, from the
  // sixth two more, until a throw only rocks one or hits nothing. A golden coconut on a post is worth three; the fifth
  // rack is all golden. From the second rack a golden coconut swings on a vine in front of the posts: throw as the
  // marker crosses it (it lights up) for five points and two throws back, the only way to spare a miss and still clear
  // all five. Clear the posts for a rack bonus (two for each rack so far) and the next rack; clear the fifth and the
  // game is won, a point for each throw left. Run out of throws with coconuts standing and it is over. A miss thuds
  // into the reed screen and drops.
  const SHY_POOL = 25, SHY_SPEED = [1.15, 1.35, 1.55, 1.75, 1.95], SHY_COMBO = [0, 0, 0, 1, 1, 1, 2], SHY_SWING = 5;
  const SHY_SAY = { bonk: worded("Bonk! +"), big: worded("Big bonk! +"), combo: worded("Combo! +"), clear: worded("All coconut down! +"), won: worded("Five racks! Ooga champion! +") };
  const coconutShy = (host) => {
    const Y = AM.SHY, W = Y.swing, g = host.node, FLIGHT = 0.45, DIRECT = 0.1, GLANCE = 0.22, CATCH = 0.16, SWING = 0.44, OMEGA = 2.05, REACH = W.len + 0.12, RACKS = SHY_SPEED.length, out = hooks(host);
    const nuts = Y.posts.map((x) => {
      const node = createNode({ geometry: AM.coconut(0), position: { x, y: Y.cup + 0.06, z: Y.z }, sightHidden: true });
      addChild(g, node);
      return { node, x, up: true, fall: -1, hits: 0, wobble: 0, golden: false, doomed: false };
    });
    // The thrown coconuts, three so a throw never waits on the last one's flight: where each was aimed (`x`), what it
    // flies at (`nut`, which it `knock`s off or only rocks, or the swinging coconut, `bob`, met at `end`) and how far
    // along its flight it is (`t`, -1 in hand).
    const balls = [];
    for (let i = 0; i < 3; i++) balls.push({ node: createNode({ geometry: AM.balls(2), visible: false, sightHidden: true }), t: -1, x: 0, nut: null, knock: false, bob: false, end: { x: 0, y: 0, d: 0 } });
    // The marker points up at the coconuts from just under their cups, in front of the posts, below the callouts.
    const marker = createNode({ geometry: AM.arrow(), position: { x: 0, y: Y.cup - 0.03, z: Y.z + 0.14 }, rotation: { x: 0, y: 0, z: Math.PI }, scale: { x: 1.6, y: 1.6, z: 1.6 }, visible: false, sightHidden: true });
    // The bonus: its vine swinging from its knot under the roof, and the golden coconut at its foot, apart so it can
    // fall when it is hit.
    const vine = createNode({ geometry: AM.shyVine(), position: { x: 0, y: W.y, z: W.z }, visible: false, sightHidden: true });
    const bob = createNode({ geometry: AM.coconut(1), visible: false, sightHidden: true });
    addChild(g, marker, vine, bob);
    for (let i = 0; i < balls.length; i++) addChild(g, balls[i].node);
    const board = scoreboard(g, "POINTS", 3, "#ffd23a", { x: -0.9, y: 2.5, z: -1.6 });
    const left = scoreboard(g, "THROWS", 2, "#f3e6c8", { x: 0.9, y: 2.5, z: -1.6 });
    const flash = flasher(host), status = makeStatus("Throws"), BOB = { x: 0, y: 0, d: 0 }, FALL = { x: 0, y: 0 };
    board.show(host.best);
    left.show(0);
    // `swing` is 0 with no bonus, 1 while it swings, 3 while a throw is on its way to it and 2 while it falls once
    // hit; `popT` times the coconuts popping onto their cups at a rack's start; `flying` counts the throws in the air.
    let phase = "idle", t = 0, markT = 0, markX = 0, throws = 0, round = 0, rounds = 0, combo = 0, flying = 0;
    let swing = 0, swingT = 0, fallT = 0, popT = 1;
    // Where the bonus coconut's middle is `s` seconds into its swing, and how far above its hang it still is (`d`):
    // it drops in from under the roof, then swings. Returns the vine's angle.
    const pendulum = (s, out) => {
      const a = SWING * Math.cos(s * OMEGA), k = Math.max(0, 1 - s / 0.6);
      out.d = k * k * 1.6; out.x = Math.sin(a) * REACH; out.y = W.y + out.d - Math.cos(a) * REACH;
      return a;
    };
    const setUp = () => {
      const g1 = (rounds * 2) % nuts.length, g2 = round >= 2 ? (g1 + 2) % nuts.length : -1, all = round === RACKS - 1;
      for (let i = 0; i < nuts.length; i++) {
        const n = nuts[i];
        n.up = true; n.fall = -1; n.hits = 0; n.wobble = 0; n.doomed = false; n.golden = all || i === g1 || i === g2;
        n.node.geometry = AM.coconut(n.golden ? 1 : 0);
        n.node.visible = true; n.node.rotation.x = n.node.rotation.z = 0;
        n.node.scale.x = n.node.scale.y = n.node.scale.z = 1;
        place(n.node, n.x, Y.cup + 0.06, Y.z);
      }
    };
    const unswing = () => { swing = 0; vine.visible = bob.visible = false; bob.glow = 1; };
    // Whether a throw now takes the swinging coconut: the marker on it once it has dropped in.
    const onSwing = () => swing === 1 && swingT > 0.6 && Math.abs(BOB.x - markX) < CATCH;
    const land = () => { for (let i = 0; i < balls.length; i++) { balls[i].t = -1; balls[i].node.visible = false; } flying = 0; };
    const startRound = (r) => {
      round = r; phase = "aim"; t = 0; rounds++; popT = 0;
      setUp();
      left.show(throws);
      status.left = throws; status.round = r + 1; status.target = 0; status.verb = "Throw!";
      if (r) {
        swing = 1; swingT = fallT = 0; vine.visible = bob.visible = true; bob.rotation.x = 0;
        out.cue("round");
      }
      if (r === RACKS - 1) out.popup("Golden rack! Every coconut 3", true);
    };
    // The combo, and the fire it lights at three in a row.
    const chain = (n) => {
      combo = n; status.streak = n;
      if ((n >= 3) !== status.fire) { status.fire = n >= 3; if (status.fire) out.cue("fire"); }
    };
    const standing = () => { let n = 0; for (let i = 0; i < nuts.length; i++) if (nuts[i].up) n++; return n; };
    // A throw lands: on the swinging coconut, on a post's coconut, or into the screen. Once a rack is cleared the
    // throws still in the air only land.
    const resolve = (b) => {
      b.t = -1; b.node.visible = false; flying--;
      if (b.bob) {
        chain(combo + 1);
        swing = 2; fallT = 0; FALL.x = b.end.x; FALL.y = b.end.y;
        // Two throws back: two points once the last rack is down, where a throw left is a point.
        throws += 2; left.show(throws); status.left = throws;
        if (phase === "aim") status.verb = "Throw!";
        status.score += SHY_SWING + (phase === "clear" && round === RACKS - 1 ? 2 : 0); board.show(status.score);
        flash.hit(3);
        host.burst(FALL.x, FALL.y, W.z, 30);
        out.cue("big");
        out.crack(FALL.x, FALL.y, W.z, true);
        out.popup("Golden swing! +5 and 2 throws", true);
        out.shake(0.6);
      } else if (phase !== "aim") return;
      else if (b.nut) {
        const n = b.nut;
        if (b.knock) {
          n.up = false; n.fall = 0; n.wobble = 0;
          chain(combo + 1);
          const points = (n.golden ? 3 : 1) + SHY_COMBO[Math.min(combo, SHY_COMBO.length - 1)], big = n.golden || combo >= 3;
          status.score += points;
          board.show(status.score);
          flash.hit(big ? 2.5 : 1.2);
          host.burst(n.x, Y.cup + 0.2, Y.z, big ? 24 : 12);
          out.cue("bonk");
          out.crack(n.x, Y.cup + 0.2, Y.z, big);
          out.popup(n.golden ? SHY_SAY.big(points) : combo >= 3 ? SHY_SAY.combo(points) : SHY_SAY.bonk(points), big);
          out.shake(big ? 0.5 : 0.25);
        } else { chain(0); n.wobble = 0.8; out.cue("thunk"); out.flop(); out.popup("Coconut wobble...", false); }
      } else { chain(0); host.burst(b.x, Y.cup + 0.2, Y.back + 0.1, 4); out.cue("miss"); out.flop(); out.popup("Whoa...", false); }
      if (phase !== "aim") return;
      if (!standing()) {
        const bonus = 2 * (round + 1) + (round === RACKS - 1 ? throws : 0);
        status.score += bonus;
        board.show(status.score);
        out.crack(0, Y.cup + 0.45, Y.z, true);
        out.popup(round === RACKS - 1 ? SHY_SAY.won(bonus) : SHY_SAY.clear(bonus), true);
        out.cue("win");
        phase = "clear"; t = 0; status.verb = "";
      } else if (!throws && !flying) { phase = "idle"; status.verb = ""; marker.visible = false; unswing(); out.cue("buzzer"); host.onEnd(status.score); }
    };
    setUp();
    status.left = SHY_POOL;
    // The hall's show while nobody plays: the golden coconut drops in on its vine and swings, the marker sweeps the
    // posts, and now and then (`tease`) a coconut flies at the one under the marker and rocks it on its cup.
    const I = { t: 0, b: -1, n: nuts[0] };
    const attract = (dt, k) => {
      const ball = balls[0].node;
      if (k <= 0) { I.t = 0; I.b = -1; vine.visible = bob.visible = marker.visible = ball.visible = false; marker.glow = 1; return; }
      I.t += dt;
      const a = pendulum(I.t, BOB), mx = Math.sin(I.t * 0.8) * 1.5;
      vine.visible = bob.visible = marker.visible = true;
      vine.rotation.z = bob.rotation.z = a; vine.position.y = W.y + BOB.d;
      place(bob, BOB.x, BOB.y - 0.1, W.z);
      marker.position.x = mx;
      let on = false;
      for (let i = 0; i < nuts.length; i++) if (Math.abs(nuts[i].x - mx) < DIRECT) on = true;
      marker.glow = on ? 2.2 : 1;
      if (I.b < 0) return;
      I.b += dt;
      const f = Math.min(1, I.b / FLIGHT), F = Y.from;
      place(ball, F.x + (I.n.x - F.x) * f, F.y + (Y.cup + 0.18 - F.y) * f + 2 * f * (1 - f), F.z + (Y.z - F.z) * f);
      if (f >= 1) { I.b = -1; ball.visible = false; I.n.wobble = 0.8; out.cue("thunk"); }
    };
    const tease = () => {
      if (I.b >= 0) return;
      const mx = marker.position.x;
      I.n = nuts[0];
      for (let i = 1; i < nuts.length; i++) if (Math.abs(nuts[i].x - mx) < Math.abs(I.n.x - mx)) I.n = nuts[i];
      I.b = 0; balls[0].node.visible = true;
      out.cue("throw");
    };
    return {
      kind: "shy", name: "Coconut Toss", help: "Space or tap throws at the marker. Knock them off in a row for a combo; clear five racks to win.",
      stars: [15, 45, 115], tickets: (score) => Math.floor(score / 2.5), status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => { status.score = 0; chain(0); board.show(0); markT = 0; marker.visible = true; land(); throws = SHY_POOL; startRound(0); },
      stop: () => { phase = "idle"; marker.visible = false; land(); unswing(); chain(0); round = 0; setUp(); popT = 1; left.show(0); board.show(host.best); status.verb = ""; status.round = 1; status.left = SHY_POOL; },
      act: () => {
        if (phase !== "aim" || !throws) return;
        let b = null;
        for (let i = 0; i < balls.length; i++) if (balls[i].t < 0) { b = balls[i]; break; }
        if (!b) return;
        b.t = 0; b.x = markX; b.nut = null; b.knock = b.bob = false; b.node.visible = true;
        flying++;
        // The swinging coconut hangs in front of the posts: the throw takes it if the marker is on it, and flies to
        // where it will be. Otherwise it takes the first coconut standing under the marker that is not already on
        // its way down, and knocks it off dead on or on its second hit.
        b.bob = onSwing();
        if (b.bob) { pendulum(swingT + FLIGHT, b.end); swing = 3; }
        else {
          for (let i = 0; i < nuts.length; i++) {
            const n = nuts[i];
            if (!n.up || n.doomed || Math.abs(n.x - markX) >= GLANCE) continue;
            b.nut = n; b.knock = n.doomed = Math.abs(n.x - markX) < DIRECT || n.hits > 0;
            n.hits++;
            break;
          }
        }
        throws--;
        left.show(throws);
        status.left = throws;
        if (!throws) status.verb = "";
        out.cue("throw");
      },
      update: (dt) => {
        flash.update(dt);
        popT += dt;
        for (let i = 0; i < nuts.length; i++) {
          const n = nuts[i];
          // Popping onto its cup one after another at a rack's start, a little past full size and back.
          if (popT < 0.7) { const k = Math.min(1, Math.max(0, (popT - i * 0.07) / 0.25)), s = ease(k) * (1 + 0.3 * Math.sin(k * Math.PI)); n.node.scale.x = n.node.scale.y = n.node.scale.z = Math.max(0.01, s); }
          if (n.wobble > 0) {
            n.wobble = Math.max(0, n.wobble - dt);
            n.node.rotation.z = Math.sin(n.wobble * 28) * n.wobble * 0.5;
          }
          if (n.fall < 0) continue;
          n.fall += dt;
          const k = Math.min(1, n.fall / 0.6);
          n.node.rotation.x = -k * 2.2;
          place(n.node, n.x, Y.cup + 0.06 - k * k * 1.2, Y.z - k * 0.5);
          if (k >= 1) { n.fall = -1; n.node.visible = false; }
        }
        if (swing) {
          // The bonus swings (on while a throw is on its way to it); once hit, the coconut drops tumbling and the
          // empty vine swings down to rest.
          swingT += dt;
          const a = pendulum(swingT, BOB);
          vine.rotation.z = swing !== 2 ? a : a * Math.exp(-fallT * 1.5);
          vine.position.y = W.y + BOB.d;
          if (swing !== 2) { place(bob, BOB.x, BOB.y - 0.1, W.z); bob.rotation.z = a; }
          else {
            fallT += dt;
            place(bob, FALL.x, FALL.y - 0.1 - 4.9 * fallT * fallT, W.z + fallT * 0.8);
            bob.rotation.x = -fallT * 7;
            if (fallT > 0.9) bob.visible = false;
          }
        }
        // The throws in the air: a hit stops at its coconut, a miss flies on into the screen.
        for (let i = 0; i < balls.length; i++) {
          const b = balls[i];
          if (b.t < 0) continue;
          b.t += dt;
          const k = Math.min(1, b.t / FLIGHT), F = Y.from, x = b.bob ? b.end.x : b.x, y = b.bob ? b.end.y : Y.cup + 0.18, z = b.bob ? W.z : b.nut ? Y.z : Y.back + 0.06;
          place(b.node, F.x + (x - F.x) * k, F.y + (y - F.y) * k + 4 * 0.5 * k * (1 - k), F.z + (z - F.z) * k);
          if (k >= 1) resolve(b);
        }
        if (phase === "idle") return;
        t += dt;
        markT += dt * SHY_SPEED[round];
        markX = Math.sin(markT) * 1.5;
        marker.position.x = markX;
        // The marker glows over a standing coconut dead on; the swinging coconut lights up while a throw would take it.
        let on = false;
        for (let i = 0; i < nuts.length; i++) if (nuts[i].up && !nuts[i].doomed && Math.abs(nuts[i].x - markX) < DIRECT) on = true;
        const swingOn = phase === "aim" && onSwing();
        marker.glow = on || swingOn ? 2.2 : 1;
        bob.glow = swingOn ? 3 : 1;
        if (phase === "clear" && t >= 0.5 && !flying) {
          unswing();
          if (round < RACKS - 1 && throws) startRound(round + 1);
          else { phase = "idle"; marker.visible = false; if (round < RACKS - 1) out.cue("buzzer"); host.onEnd(status.score); }
        }
      }
    };
  };

  // ---- the claw machine --------------------------------------------------------------------------------
  // Three rounds of three tries; between rounds the heap is restocked in a new lay (`CLAW_LAYS`, turning each game),
  // and the claw sweeps quicker each try and each round. The claw sweeps across the case: act stops it; then it sweeps
  // front to back from where it stopped: act stops it and it drops. Under it a ring of embers (`clawMark`) rides over
  // the heap, glowing where the claw would close on a prize and flaring gold where it would hold one. Over a prize in
  // reach the meter runs down its fall: act in the green, just before it lands, nudges it up to `NUDGE` onto the
  // prize's middle; outside the green it lurches off. Where it lands it closes on the nearest prize: dead centre
  // (within `HOLD`) it holds and carries the prize to the chute; nearer than `GRAB` but off centre, and always with the
  // golden coconut, the prize shakes as the claw lifts and the grip meter runs once: act in its window grips it, too
  // soon, too late or not at all and it slips back onto the heap. The window narrows the further off centre the grab.
  // A gorilla idol pays 20, a banana 12, a coconut 8 and the golden coconut the jackpot, `CLAW_POT` and `CLAW_GROW`
  // more for every prize won before it; a grab on the dot (`CLEAN`) adds 5, each prize in a row after the first 2 more
  // (to 10), and a round with all three tries won 15. The best run there is (two idols a round, then the golden
  // coconut, every grab dead centre) makes 390, under the save's 400.
  const CLAW_PAYS = [20, 12, 8], CLAW_POT = 25, CLAW_GROW = 3, CLAW_ROUNDS = 3, CLAW_TRIES = 3, CLAW_SWEEP = 15;
  // Each lay: the spot in `CLAW.prizes` each prize stands on, the golden coconut first.
  const CLAW_LAYS = [[0, 1, 2, 3, 4, 5, 6, 7], [3, 6, 5, 0, 7, 2, 1, 4], [4, 7, 0, 6, 2, 1, 3, 5]];
  const CLAW_SAY = { won: ["Idol! +", "Nana! +", "Coconut! +"].map((w) => worded(w)), jackpot: worded("JACKPOT! +"), clean: worded("Dead centre! +"), streak: worded("Streak! +"), sweep: worded("Clean sweep! +"), round: ["", "Round 2!", "Last round!"] };
  const clawGame = (host) => {
    const C = AM.CLAW, g = host.node, B = -C.back, HOLD = 0.065, GRAB = 0.12, CLEAN = 0.03, NUDGE = 0.045, SLIDE = 0.08, GRIP = 0.7, DROP = 0.55, LIFT = 0.75, out = hooks(host);
    const claw = createNode({ geometry: AM.claw(), position: { x: 0, y: C.y, z: B }, sightHidden: true });
    const cable = createNode({ geometry: AM.chainLink(), position: { x: 0, y: C.y + 0.15, z: B }, scale: { x: 1, y: 0.3, z: 1 }, sightHidden: true });
    const mark = createNode({ geometry: AM.clawMark(), position: { x: 0, y: C.floor + 0.25, z: B }, visible: false, sightHidden: true });
    const prizes = C.prizes.map(([x, z, k]) => ({ x, z, k, node: createNode({ geometry: AM.clawPrize(k), position: { x, y: C.floor + 0.08, z: z + B }, sightHidden: true }) }));
    addChild(g, claw, cable, mark, ...prizes.map((p) => p.node));
    // The boards stand low beside the case, in the corner of the game's view.
    const board = scoreboard(g, "CLAW", 3, "#ffd98a", { x: -1, y: 1.75, z: B + 0.08 });
    standOn(g, -1, 0.95, B + 0.04);
    const left = scoreboard(g, "TRIES", 1, "#f3e6c8", { x: -1, y: 0.95, z: B + 0.08 });
    const flash = flasher(host), status = makeStatus("Tries");
    board.show(host.best);
    left.show(0);
    // `target` is the prize the claw drops toward (the nearest in a nudge's reach), then the one it closes on where it
    // lands; `held` rides the claw once it closes and `slip` falls back from where it slipped (`SLIP`) to its place on
    // the heap. `lost` marks a try that slipped, `nudged` a drop whose nudge is spent; `won` counts the game's prizes
    // (the jackpot grows with them), `wins` the round's, `games` the games played, which turns the lays.
    const SLIP = { x: 0, y: 0, z: 0 };
    // The numbers a frame moves, on one object so a write changes them in place (a double in a closure's `let` is
    // boxed afresh on every write, and so is one handed to a call the compiler does not inline, so the per-frame
    // helpers read these rather than take them): `t` the phase's clock, the claw at (`cx`, `cz`) `d` down and how far
    // it has `close`d, the sweep's phase `ph` and `speed`, how deep it `drop`s, how far off a prize's middle `under`
    // found it (`off`) and where it closed (`grabOff`), where the carry to the chute set off from (`gx`, `gz`),
    // `slipT` into a slip (-1 none), and a nudge sliding it to (`nx`, `nz`) over `nt` seconds more (-1 none).
    const N = { t: 0, cx: 0, cz: 0, d: 0, close: 0, ph: 0, speed: 1, drop: 0, off: 0, grabOff: 0, gx: 0, gz: 0, slipT: -1, nx: 0, nz: 0, nt: -1 };
    let phase = "idle", tries = 0, round = 0, clean = false, lost = false, nudged = false, streak = 0, won = 0, wins = 0, games = 0;
    let target = null, held = null, slip = null;
    // The claw, its cable and anything it holds at (`N.cx`, `N.cz`), `N.d` down.
    const at = () => {
      const x = N.cx, z = N.cz + B, d = N.d;
      claw.position.x = cable.position.x = x;
      claw.position.z = cable.position.z = z;
      claw.position.y = C.y - d;
      cable.position.y = C.y + 0.3 - (d + 0.3) / 2;
      cable.scale.y = d + 0.3;
      claw.scale.x = claw.scale.z = 1 - 0.3 * N.close;
      if (held) { held.node.position.x = x; held.node.position.z = z; held.node.position.y = C.y - d - 0.28; }
    };
    // The nearest standing prize to the claw within `reach`, its distance in `N.off`.
    const under = (reach) => {
      let best = null;
      N.off = reach;
      for (let i = 0; i < prizes.length; i++) {
        const p = prizes[i];
        if (!p.node.visible || p === slip) continue;
        const du = p.x - N.cx, dz = p.z - N.cz, d = Math.sqrt(du * du + dz * dz);
        if (d < N.off) { N.off = d; best = p; }
      }
      return best;
    };
    // The ring under the claw: dim over nothing, glowing over a prize, gold and a size up where it would hold.
    const aimMark = () => {
      const p = under(GRAB), hold = p !== null && N.off <= HOLD;
      mark.position.x = N.cx; mark.position.z = N.cz + B;
      mark.glow = hold ? 2.4 : p ? 1.3 : 0.4;
      mark.highlight = hold ? 1 : 0;
      mark.scale.x = mark.scale.z = hold ? 1.2 : 1;
    };
    // A sweep carries on from where the claw is, heading toward -x (or -z) first: the falling half of the wave.
    const from = (v, range) => 1 - (Math.max(-range, Math.min(range, v)) / range + 1) / 4;
    // Every prize on its spot in lay `n`, standing.
    const lay = (n) => {
      const L = CLAW_LAYS[n % CLAW_LAYS.length];
      for (let i = 0; i < prizes.length; i++) {
        const p = prizes[i], s = C.prizes[L[i]];
        p.x = s[0]; p.z = s[1]; p.node.visible = true; p.node.rotation.z = 0; place(p.node, p.x, C.floor + 0.08, p.z + B);
      }
    };
    const grow = (s) => { for (let i = 0; i < prizes.length; i++) { const n = prizes[i].node; n.scale.x = n.scale.y = n.scale.z = s; } };
    const reset = () => { lay(0); grow(1); target = held = slip = null; N.slipT = N.nt = -1; N.close = N.cx = N.cz = N.d = 0; at(); };
    const nextTry = () => {
      phase = "x"; N.t = 0; N.close = 0; N.nt = -1; lost = nudged = false; N.ph = from(N.cx, C.x); N.speed = 1 + 0.25 * round + 0.14 * (CLAW_TRIES - tries);
      status.verb = "Stop"; status.meter = -1; status.left = tries; left.show(tries);
      mark.visible = true; aimMark();
      if (tries === 1 && round === CLAW_ROUNDS - 1) out.popup("Last try!", true);
    };
    // A round: the first starts at once; the next restock the heap in their own lay first.
    const startRound = (r) => {
      round = r; status.round = r + 1; tries = CLAW_TRIES; wins = 0;
      if (!r) { nextTry(); return; }
      phase = "restock"; N.t = 0; status.verb = ""; status.meter = -1; status.left = tries; left.show(tries); mark.visible = false;
      lay(games + r); grow(0.01); out.cue("whirr");
    };
    const finish = () => { phase = "idle"; status.verb = ""; status.meter = -1; mark.visible = false; out.cue("buzzer"); host.onEnd(status.score); };
    // A try spent, counted off at once (the last shows 0 on the results): the next, or the round's end (all three won
    // pays the sweep), then the next round or the end.
    const spent = () => {
      tries--; status.left = tries; left.show(tries);
      if (tries) { nextTry(); return; }
      if (wins === CLAW_TRIES) { status.score += CLAW_SWEEP; board.show(status.score); out.popup(CLAW_SAY.sweep(CLAW_SWEEP), true); out.cue("win"); flash.hit(2.5); }
      if (round + 1 < CLAW_ROUNDS) startRound(round + 1); else finish();
    };
    // The prize slips out of the claw and falls back to its place; the streak is broken.
    const slipOut = (words) => {
      slip = held; held = null; N.slipT = 0; lost = true;
      SLIP.x = slip.node.position.x; SLIP.y = slip.node.position.y; SLIP.z = slip.node.position.z;
      status.meter = -1; status.verb = ""; streak = status.streak = 0; status.fire = false;
      out.flop(); out.popup(words, false); out.cue("miss");
    };
    // The hall's show while nobody plays: the crane drifts over its heap, and now and then (`tease`) dips to it and
    // closes on nothing; the next game's `reset` sets it where a game starts.
    const I = { t: 0, dip: -1 };
    const attract = (dt, k) => {
      if (k <= 0) I.dip = -1;
      I.t += dt;
      const e = Math.min(1, dt * 1.5);
      N.cx += (Math.sin(I.t * 0.37) * C.x * 0.8 * k - N.cx) * e;
      N.cz += (Math.sin(I.t * 0.53 + 1) * C.z * 0.8 * k - N.cz) * e;
      N.d = N.close = 0;
      if (I.dip >= 0) {
        I.dip += dt;
        const f = Math.min(1, I.dip / 1.8);
        N.d = Math.sin(f * Math.PI) * (C.y - C.floor - 0.4);
        N.close = Math.max(0, 1 - Math.abs(f - 0.6) * 5);
        if (I.dip - dt < 0.9 && I.dip >= 0.9) out.cue("clack");
        if (f >= 1) I.dip = -1;
      }
      at();
    };
    const tease = () => { if (I.dip < 0) { I.dip = 0; out.cue("whirr"); } };
    return {
      kind: "claw", name: "Claw Machine", help: "Space or tap stops the claw across, then front to back, and it drops: tap in the green to nudge it on. Gold ring holds; grip in the green.",
      stars: [70, 180, 320], tickets: (score) => Math.floor(score / 7), status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => { games++; reset(); lay(games); status.score = 0; streak = status.streak = won = 0; status.fire = false; board.show(0); startRound(0); },
      stop: () => { phase = "idle"; reset(); mark.visible = false; status.meter = -1; status.verb = ""; streak = status.streak = 0; status.fire = false; left.show(0); board.show(host.best); },
      act: () => {
        if (phase === "x") { phase = "z"; N.t = 0; N.ph = from(N.cz, C.z); status.verb = "Drop!"; out.cue("lock"); }
        else if (phase === "z") {
          // It drops as deep as the prize it may be nudged onto; over one, the meter runs its fall for the nudge.
          phase = "drop"; N.t = 0; out.cue("whirr");
          target = under(GRAB + NUDGE);
          N.drop = target ? C.y - (C.floor + 0.08) - 0.28 : 0.72;
          status.verb = target ? "Nudge!" : ""; status.meter = target ? 0 : -1; status.window0 = 0.68; status.window1 = 0.9;
        } else if (phase === "drop" && target && !nudged) {
          // In the green the claw slides onto the prize's middle; outside it, it lurches off it. Either way it slides
          // there over `SLIDE` seconds, and is there before it lands.
          const m = status.meter, dx = target.x - N.cx, dz = target.z - N.cz, d = Math.sqrt(dx * dx + dz * dz);
          nudged = true; status.verb = ""; status.meter = -1; N.nt = Math.max(0, Math.min(SLIDE, DROP - N.t));
          if (m >= status.window0 && m <= status.window1) {
            const k = d > NUDGE ? NUDGE / d : 1;
            N.nx = N.cx + dx * k; N.nz = N.cz + dz * k; out.cue("lock"); out.popup("Nudge!", false); flash.hit(0.8);
          } else {
            const k = d > 1e-4 ? -0.03 / d : 0;
            N.nx = Math.max(-C.x, Math.min(C.x, N.cx + dx * k)); N.nz = Math.max(-C.z, Math.min(C.z, N.cz + dz * k)); out.cue("clang"); out.popup("Clumsy!", false);
          }
        } else if (phase === "lift" && held && status.meter >= 0) {
          const m = status.meter;
          if (m >= status.window0 && m <= status.window1) { status.meter = -1; status.verb = ""; held.node.rotation.z = 0; flash.hit(1); out.cue("lock"); out.popup("Ooga grip!", false); }
          else slipOut(m < status.window0 ? "Too soon! Slip..." : "Too late! Slip...");
        }
      },
      update: (dt) => {
        flash.update(dt);
        if (N.slipT >= 0) {
          // The slipped prize tumbles back down onto its place on the heap.
          N.slipT += dt;
          const k = Math.min(1, N.slipT / 0.4), q = slip.node.position;
          q.x = SLIP.x + (slip.x - SLIP.x) * k; q.y = SLIP.y + (C.floor + 0.08 - SLIP.y) * k * k; q.z = SLIP.z + (slip.z + B - SLIP.z) * k;
          slip.node.rotation.z = (1 - k) * 0.9;
          if (k >= 1) { slip = null; N.slipT = -1; out.cue("thunk"); }
        }
        if (phase === "idle") return;
        N.t += dt;
        if (phase === "x" || phase === "z") {
          // The sweep, a triangle wave from -1 to 1 across the case (or front to back).
          const w = N.ph + N.t * 0.45 * N.speed, f = w - Math.floor(w), s = f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
          if (phase === "x") N.cx = s * C.x; else N.cz = s * C.z;
          N.d = 0; at(); aimMark();
        } else if (phase === "restock") {
          // The heap restocked in the round's lay, each prize popping up in turn, the round called as it fills.
          for (let i = 0; i < prizes.length; i++) {
            const k = Math.min(1, Math.max(0, (N.t - 0.2 - i * 0.05) / 0.25)), n = prizes[i].node;
            n.scale.x = n.scale.y = n.scale.z = Math.max(0.01, k * k * (3 - 2 * k) * (1 + 0.3 * Math.sin(k * Math.PI)));
          }
          if (N.t - dt < 0.55 && N.t >= 0.55) { out.popup(CLAW_SAY.round[round], true); out.cue("round"); }
          if (N.t >= 1.1) { grow(1); nextTry(); }
        } else if (phase === "drop") {
          const k = Math.min(1, N.t / DROP);
          if (status.meter >= 0) status.meter = k;
          if (N.nt >= 0) {
            // A nudge sliding the claw over, the ring riding with it: all the way there by the time it lands.
            const f = N.nt > dt && k < 1 ? dt / N.nt : 1;
            N.cx += (N.nx - N.cx) * f; N.cz += (N.nz - N.cz) * f; N.nt = f < 1 ? N.nt - dt : -1;
            aimMark();
          }
          N.d = k * k * (3 - 2 * k) * N.drop; at();
          if (k >= 1) {
            // Where it lands decides: the prize it closes on, how far off its middle, and whether dead on.
            phase = "grab"; N.t = 0; status.verb = ""; status.meter = -1; out.cue("clack");
            target = under(GRAB); N.grabOff = N.off; clean = target !== null && N.off <= CLEAN;
          }
        } else if (phase === "grab") {
          // The prongs close; a grab off centre, or on the golden coconut, runs the grip meter as it lifts.
          N.close = Math.min(1, N.t / 0.15);
          N.d = N.drop; at();
          if (N.t >= 0.15) {
            phase = "lift"; N.t = 0; mark.visible = false; held = target; target = null;
            if (held && (N.grabOff > HOLD || held.k === 3)) {
              const w = (held.k === 3 ? 0.08 : 0.12) - 0.06 * Math.max(0, Math.min(1, (N.grabOff - HOLD) / (GRAB - HOLD)));
              status.meter = 0; status.window0 = 0.66 - w; status.window1 = 0.66 + w; status.verb = "Grip!"; out.cue("tick");
            }
          }
        } else if (phase === "lift") {
          const k = Math.min(1, N.t / LIFT);
          if (!held) N.close = Math.max(0, 1 - k * 2);
          N.d = (1 - k * k * (3 - 2 * k)) * N.drop; at();
          if (held && status.meter >= 0) {
            status.meter = Math.min(1, N.t / GRIP);
            held.node.rotation.z = Math.sin(N.t * 38) * 0.3;
            if (status.meter >= 1) slipOut("Slip! Whoa...");
          }
          if (k >= 1) {
            if (held) { phase = "carry"; N.t = 0; N.gx = N.cx; N.gz = N.cz; }
            else {
              if (!lost) { streak = status.streak = 0; status.fire = false; out.flop(); out.popup("Whoa... nothing", false); out.cue("miss"); }
              spent();
            }
          }
        } else if (phase === "carry") {
          const u = Math.min(1, N.t / 0.5), k = u * u * (3 - 2 * u);
          N.cx = N.gx + (C.chute.x - N.gx) * k; N.cz = N.gz + (C.chute.z - N.gz) * k; N.d = 0; at();
          if (N.t >= 0.5) {
            const p = held, jackpot = p.k === 3, value = (jackpot ? CLAW_POT + CLAW_GROW * won : CLAW_PAYS[p.k]) + (clean ? 5 : 0) + 2 * Math.min(5, streak), big = jackpot || clean || streak >= 2;
            held = null; p.node.visible = false;
            won++; wins++; streak++; status.streak = streak; status.fire = streak >= 3;
            status.score += value; board.show(status.score); flash.hit(big ? 2.5 : 1.4);
            host.burst(C.chute.x, C.floor, C.chute.z + B, big ? 24 : 12);
            // Out of the chute, in front of the glass: the jackpot, a grab on the dot or a streak of three cracks a
            // coconut; anything else throws husk chips.
            out.crack(C.chute.x, C.floor + 0.12, B + C.z + 0.3, big);
            out.cue(big ? "big" : "score");
            out.popup(jackpot ? CLAW_SAY.jackpot(value) : clean ? CLAW_SAY.clean(value) : streak >= 3 ? CLAW_SAY.streak(value) : CLAW_SAY.won[p.k](value), big);
            out.shake(big ? 0.5 : 0.25);
            N.cx = C.chute.x; N.cz = C.chute.z; N.close = 0; at();
            spent();
          }
        }
      }
    };
  };

  // ---- air hockey ---------------------------------------------------------------------------------------
  // Against an Ooga, first to seven, or ahead when the sand runs out (`HOCKEY_SAND` seconds, so no match of two walls
  // goes on for ever; level is a draw). The table runs away from the player along -z in the machine's frame (`HOCKEY`
  // long, its near goal `NEAR` in front of the player). The player's mallet follows the aim across the table
  // (`host.aim.x`, -1 to 1: drag, arrows or A and D), comes up behind a loose coconut in its half, and act lunges
  // it forward for a smash. While the coconut comes at the mallet the meter runs down its approach and an ember ring
  // on the ice marks where it will cross the mallet's line: a smash in the green is a power smash, and the coconut
  // flies off burning; one try an approach, so mashing never finds the green. A coconut left sitting `STILL` seconds
  // goes to the other side. The sand left shows in the HUD's third box (`status.target`). The Ooga plays three ways, one a
  // round, the round turning at `HOCKEY_TURN` goals between you (`HOCKEY_STYLES`): the Wall keeps to its goal and reads
  // only the straight line (bank it off a rail), the Basher charges out and hits hard (catch it out of its goal), and
  // the Wild reads the rails, charges and banks its own hits. It eases off ahead and presses behind. A goal is 10, 5
  // more burning and 5 more off a rail; a win adds 20 and 5 a goal of the margin. Allocation-free fixed steps.
  const HOCKEY_TO = 7, HOCKEY_TURN = [3, 6], HOCKEY_SAND = 180;
  // How a match ends: at seven (won, lost), or when the sand runs out (won, lost, level); and the sand's last calls.
  const HOCKEY_END = ["You win! OOGA!", "Ooga win...", "", "Sand out! You win!", "Sand out! Ooga win", "Sand out! A draw"];
  const HOCKEY_SAND_SAY = ["", "1", "2", "3", "4", "5"];
  // The sand left as the HUD shows it (`status.target`), each whole second's words built once.
  const HOCKEY_CLOCK = Array.from({ length: HOCKEY_SAND + 1 }, (_, s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  // Each way: its speed (m/s), how often it looks (s), how far out of its goal it comes to hit, how hard it hits,
  // whether it reads the coconut's line off the rails, how fast a coconut coming at its goal it still goes out to,
  // and where it aims (0 straight back, 1 the open side of the goal, 2 off the rail on that side).
  const HOCKEY_STYLES = [
    { speed: 1.2, react: 0.24, out: 0.3, mass: 0.8, reads: false, charge: 0.9, aim: 0 },
    { speed: 1.25, react: 0.3, out: 1, mass: 1.4, reads: false, charge: 2.6, aim: 1 },
    { speed: 1.45, react: 0.18, out: 0.7, mass: 1.15, reads: true, charge: 1.8, aim: 2 }
  ];
  // Each way's name, called big as its round starts, and the tip that follows it.
  const HOCKEY_SAY = [["Wall Ooga!", "Bank it off a rail"], ["Basher Ooga!", "Catch it out of goal"], ["Wild Ooga!", "Watch the rails"]];
  const HOCKEY_GOAL = ["OOGA GOAL! +10", "FIRE GOAL! +15", "Bank shot! +15", "Fire bank! +20"];
  const airHockey = (host) => {
    const AH = AM.HOCKEY, g = host.node, L = AH.w, W = AH.d, NEAR = 0.65, Y = AH.y + 0.005, out = hooks(host), aim = host.aim || { x: 0 };
    const PR = 0.05, MR = 0.07, GOAL = 0.19, EDGE = W / 2 - PR, REST = 0.2, LUNGE = 0.28, ASSIST = 0.05, SMASH = 0.18, APPROACH = 0.6, STILL = 3, STILL_V = 0.15, LOOSE_V = 0.6, BURN = 1.4, RALLY = 5, pieces = AM.hockeyPieces();
    const puck = createNode({ geometry: pieces.puck, sightHidden: true }), mine = createNode({ geometry: pieces.mallet, sightHidden: true }), theirs = createNode({ geometry: pieces.mallet, sightHidden: true });
    const mark = createNode({ geometry: AM.clawMark(), position: { x: 0, y: Y + 0.003, z: 0 }, visible: false, sightHidden: true });
    addChild(g, puck, mine, theirs, mark);
    const board = scoreboard(g, "YOU", 1, "#f3e6c8", { x: -0.75, y: 1.6, z: -NEAR - L - 0.3 }), them = scoreboard(g, "OOGA", 1, "#ffb347",{ x: 0.75, y: 1.6, z: -NEAR - L - 0.3 });
    for (const sx of [-1, 1]) standOn(g, sx * 0.75, 1.6, -NEAR - L - 0.34);
    const flash = flasher(host), status = makeStatus("Ooga");
    // Table coordinates: u across (-W/2..W/2), v along from the player's goal (0) to the Ooga's (L).
    // A mallet carries how hard it hits (`mass`) and the fastest it sends the coconut (`cap`), set before each hit.
    const P = { u: 0, v: 0, du: 0, dv: 0 }, M = { u: 0, v: REST, du: 0, dv: 0, mass: 0.9, cap: 6 }, A = { u: 0, v: L - 0.2, du: 0, dv: 0, mass: 0.8, cap: 6 }, SEEN = { u: 0, v: 0, du: 0, dv: 0, age: 0, t: 0 };
    // The seconds a frame moves, on one object so a write changes them in place (a double in a closure's `let` is
    // boxed afresh on every write): `smash` counts a lunge down, `serve` the wait before a coconut is put in play,
    // `acc` the time not yet stepped, `rivalArm` the Ooga's swing, `burn` how long the coconut stays alight and
    // `trailT` to its next ember, `still` how long it has sat, `sayT` and `tipT` the waits to announce the Ooga's new
    // way and its tip, `sand` the seconds left, and `fu` the point `fold` works on.
    const N = { smash: 0, serve: 0, acc: 0, rivalArm: 0, burn: 0, trailT: 0, still: 0, sayT: 0, tipT: 0, sand: 0, fu: 0 };
    // `power` arms a smash made in the green and `tried` spends the approach's one try at it; `by` is who hit the
    // coconut last (1 the player, 2 the Ooga), `banked` whether it came off a side rail since the player hit it, `round`
    // the Ooga's way (0 to 2), `streak` the player's goals in a row, `rally` the Ooga's hits since the coconut was last
    // put down.
    let phase = "idle", mineGoals = 0, theirGoals = 0, power = false, tried = false, by = 0, banked = false, round = 0, streak = 0, rally = 0;
    const put = (n, o) => { n.position.x = o.u; n.position.y = Y; n.position.z = -NEAR - o.v; };
    const reset = (towards) => { P.u = 0; P.v = towards > 0 ? L * 0.3 : L * 0.7; P.du = P.dv = 0; N.serve = 0.8; N.still = N.burn = 0; by = rally = 0; banked = tried = false; };
    const hit = (m) => {
      const du = P.u - m.u, dv = P.v - m.v, d = Math.sqrt(du * du + dv * dv), min = PR + MR;
      if (d >= min || d < 1e-6) return false;
      const nu = du / d, nv = dv / d;
      P.u = m.u + nu * min; P.v = m.v + nv * min;
      const rel = (P.du - m.du) * nu + (P.dv - m.dv) * nv;
      if (rel < 0) { P.du -= (1 + 0.9) * rel * nu; P.dv -= (1 + 0.9) * rel * nv; }
      // A mallet only drives the coconut when it moves into it: one drawn back never drags it along into its goal.
      if (m.du * nu + m.dv * nv > 0) { P.du += m.du * m.mass; P.dv += m.dv * m.mass; }
      const sp = Math.sqrt(P.du * P.du + P.dv * P.dv);
      if (sp > m.cap) { P.du *= m.cap / sp; P.dv *= m.cap / sp; }
      return true;
    };
    // `N.fu`, a point across the table as the coconut travels, folded back off the rails in place (so no number is
    // boxed crossing the call).
    const fold = () => { const p = ((N.fu + EDGE) % (4 * EDGE) + 4 * EDGE) % (4 * EDGE); N.fu = p < 2 * EDGE ? p - EDGE : 3 * EDGE - p; };
    // The match over, at seven or (`sand` 1) when the sand runs out: ahead wins, level is a draw.
    const end = (sand) => {
      const won = mineGoals > theirGoals;
      if (won) status.score += 20 + 5 * (mineGoals - theirGoals);
      phase = "idle"; status.verb = ""; status.meter = -1; mark.visible = false;
      out.popup(HOCKEY_END[(sand > 0 ? 3 : 0) + (won ? 0 : mineGoals < theirGoals ? 1 : 2)], true);
      if (sand > 0) out.cue("buzzer");
      host.onEnd(status.score);
    };
    const goal = (player) => {
      if (player) {
        const k = (N.burn > 0 ? 1 : 0) + (banked ? 2 : 0);
        mineGoals++; streak++; status.streak = streak; status.fire = streak >= 3;
        status.score += 10 + (N.burn > 0 ? 5 : 0) + (banked ? 5 : 0);
        board.show(mineGoals); flash.hit(k ? 2.6 : 1.8); out.popup(HOCKEY_GOAL[k], true); out.cue(k ? "fire" : "big"); out.shake(k ? 0.55 : 0.4);
        host.burst(0, Y + 0.2, -NEAR - L, k ? 28 : 18); out.crack(0, Y + 0.2, -NEAR - L, true);
      } else { theirGoals++; streak = status.streak = 0; status.fire = false; them.show(theirGoals); out.popup("Whoa... Ooga score", false); out.cue("buzzer"); out.flop(); }
      status.left = theirGoals;
      if (mineGoals >= HOCKEY_TO || theirGoals >= HOCKEY_TO) { end(-1); return; }
      reset(player ? -1 : 1);
      // A new round: the Ooga changes its way, said once the goal's call has had its moment.
      const total = mineGoals + theirGoals, r = total >= HOCKEY_TURN[1] ? 2 : total >= HOCKEY_TURN[0] ? 1 : 0;
      if (r !== round) { round = r; status.round = r + 1; N.serve = 1.7; N.sayT = 0.75; }
    };
    const step = (h) => {
      // A coconut slower than `STILL_V` m/s is sitting, and the time it sits counts; one in the player's half going
      // slower than `LOOSE_V` and not coming at the mallet (so no meter runs for it) is loose, and the mallet comes up
      // behind it. One coming at the mallet, however slowly, it waits for.
      const S = HOCKEY_STYLES[round], sp2 = P.du * P.du + P.dv * P.dv, moving = sp2 > STILL_V * STILL_V, loose = P.v < L / 2 && P.dv > -0.15 && sp2 < LOOSE_V * LOOSE_V;
      // The player's mallet: across to the aim, up behind a loose coconut, a lunge further on a smash. A lunge reaches
      // up to `ASSIST` across for the coconut.
      const across = aim.x * (W / 2 - MR), want = N.smash > 0 ? across + Math.max(-ASSIST, Math.min(ASSIST, P.u - across)) : across, mu = M.u, mv = M.v;
      const rest = loose ? Math.max(REST, Math.min(L / 2 - MR - LUNGE, P.v - 0.25)) : REST;
      M.u += Math.max(-4 * h, Math.min(4 * h, want - M.u));
      M.v += Math.max(-6 * h, Math.min(6 * h, (N.smash > 0 ? rest + LUNGE : rest) - M.v));
      M.du = (M.u - mu) / h; M.dv = (M.v - mv) / h;
      // The Ooga: out to a coconut in its reach that is not flying at its goal, round it if it is on the wrong side,
      // then behind it on the line to its aim (the open side of the goal, or off the rail that side) and through;
      // otherwise home, on the line the coconut is coming along (off the rails only if it reads them).
      // It sees the coconut every `react` seconds and plays on where it saw it heading, so a sharp turn (a hit, or a
      // rail it does not read) beats it for a moment.
      const lead = Math.max(-3, Math.min(3, mineGoals - theirGoals)), speed = S.speed + 0.12 * lead, home = L - 0.2, au = A.u, av = A.v;
      if ((SEEN.t -= h) <= 0) { SEEN.t = S.react; SEEN.u = P.u; SEEN.v = P.v; SEEN.du = P.du; SEEN.dv = P.dv; SEEN.age = 0; } else SEEN.age += h;
      N.fu = SEEN.u + SEEN.du * SEEN.age;
      if (S.reads) fold();
      const pu = N.fu, pv = SEEN.v + SEEN.dv * SEEN.age, pdv = SEEN.dv;
      let tu = pu * 0.5, tv = home;
      if (pv > L / 2 && pv > home - S.out && pdv < S.charge) {
        if (A.v < pv + 0.02) { tu = pu + (A.u > pu ? 1 : -1) * (PR + MR + 0.06); tv = pv + 0.1; }
        else {
          // A long rally tries it bolder: a way further every `RALLY` of its hits, so no rally goes on for ever; with
          // the mallet in the middle it picks a side by turns.
          const side = M.u > 0.03 ? -1 : M.u < -0.03 ? 1 : rally % 2 ? 1 : -1, bold = Math.min(2, S.aim + Math.floor(rally / RALLY));
          const gu = bold === 2 ? side * (2 * EDGE + 0.14) : bold * side * 0.15;
          let du = gu - pu, dv = -pv;
          const d = Math.sqrt(du * du + dv * dv), r = PR + MR + 0.015;
          du /= d; dv /= d;
          const bu = pu - du * r, bv = pv - dv * r, lined = (A.u - bu) * (A.u - bu) + (A.v - bv) * (A.v - bv) < 0.0025;
          tu = lined ? pu + du * 0.12 : bu; tv = lined ? pv + dv * 0.12 : bv;
        }
      } else {
        if (pdv > 0.05) { N.fu = pu + SEEN.du * (home - pv) / pdv; if (S.reads) fold(); tu = N.fu; }
        tu = Math.max(-GOAL - 0.1, Math.min(GOAL + 0.1, tu));
      }
      A.u += Math.max(-speed * h, Math.min(speed * h, tu - A.u));
      A.v += Math.max(-speed * h, Math.min(speed * h, tv - A.v));
      A.u = Math.max(MR - W / 2, Math.min(W / 2 - MR, A.u));
      A.v = Math.max(L / 2 + MR, Math.min(L - MR, A.v));
      A.du = (A.u - au) / h; A.dv = (A.v - av) / h;
      if (N.serve > 0) return;
      P.u += P.du * h; P.v += P.dv * h;
      const drag = Math.max(0, 1 - 0.25 * h);
      P.du *= drag; P.dv *= drag;
      if (P.u < -EDGE || P.u > EDGE) { P.u = P.u < 0 ? -EDGE : EDGE; P.du = -P.du * 0.92; out.cue("clack"); if (by === 1) banked = true; }
      if (P.v < PR) { if (Math.abs(P.u) < GOAL) { if (P.v < -0.03) { goal(false); return; } } else { P.v = PR; P.dv = -P.dv * 0.92; out.cue("clack"); } }
      if (P.v > L - PR) { if (Math.abs(P.u) < GOAL) { if (P.v > L + 0.03) { goal(true); return; } } else { P.v = L - PR; P.dv = -P.dv * 0.92; out.cue("clack"); } }
      // A lunge hits harder; one made in the green sets the coconut burning, fast.
      const lunge = N.smash > 0 && M.dv > 2;
      M.mass = lunge ? 1.3 : 0.9; M.cap = lunge && power ? 7.5 : 6; A.mass = S.mass;
      if (hit(M)) {
        out.cue("clack"); by = 1; banked = false;
        if (lunge && power) {
          power = false; N.burn = BURN; N.trailT = 0;
          const sp = Math.sqrt(P.du * P.du + P.dv * P.dv);
          if (sp < 5) { P.du *= 5 / sp; P.dv *= 5 / sp; }
          out.cue("fire"); out.shake(0.3); flash.hit(1.5); out.popup("Power smash!", false);
        } else if (lunge) out.shake(0.15);
      }
      if (hit(A)) { out.cue("clack"); if (by !== 2) rally++; N.rivalArm = 0.4; by = 2; banked = false; N.burn = 0; }
      // A coconut left sitting goes to the other side.
      if (moving) N.still = 0;
      else if ((N.still += h) > STILL) { const mineSide = P.v < L / 2; out.popup(mineSide ? "Too slow! Ooga's coconut" : "Your coconut!", false); out.cue("whirr"); reset(mineSide ? -1 : 1); }
    };
    const place3 = () => { put(puck, P); put(mine, M); put(theirs, A); };
    reset(1); place3();
    board.show(0); them.show(0);
    // The hall's show while nobody plays: the coconut drifts off the rails and the two mallets play it lazily end to
    // end, and now and then (`tease`) one smashes it up the table; k 0 sets the table at rest, and a game's `start`
    // lays it again.
    const I = { du: 0.23, dv: 0.34, boost: 0 };
    const attract = (dt, k) => {
      if (k <= 0) { P.u = M.u = A.u = 0; P.v = L * 0.3; M.v = REST; A.v = L - 0.2; I.boost = 0; place3(); return; }
      I.boost = Math.max(0, I.boost - dt * 0.9);
      const s = k * (1 + I.boost * 3), near = REST + PR + MR, far = L - 0.2 - PR - MR;
      P.u += I.du * s * dt; P.v += I.dv * s * dt;
      if (P.u < -EDGE || P.u > EDGE) { P.u = P.u < 0 ? -EDGE : EDGE; I.du = -I.du; }
      if ((P.v < near && I.dv < 0) || (P.v > far && I.dv > 0)) { P.v = P.v < near ? near : far; I.dv = -I.dv; }
      M.u += Math.max(-0.6 * dt, Math.min(0.6 * dt, P.u - M.u)); M.v = REST;
      A.u += Math.max(-0.6 * dt, Math.min(0.6 * dt, P.u - A.u)); A.v = L - 0.2;
      place3();
    };
    const tease = () => { I.boost = 1; I.dv = P.v < L / 2 ? Math.abs(I.dv) : -Math.abs(I.dv); out.cue("clack"); };
    return {
      kind: "hockey", name: "Air Hockey", help: "Drag, arrows or A and D slide your mallet; Space or tap smashes, in the green for fire. First to seven before the sand runs out.",
      stars: [40, 90, 150], tickets: (score) => Math.floor(score / 5), status, aims: true, attract, tease,
      get playing() { return phase !== "idle"; },
      get rivalArm() { return N.rivalArm; },
      get rivalU() { return A.u; },
      get puckU() { return P.u / (W / 2); },
      start: () => {
        mineGoals = theirGoals = streak = round = 0; N.sand = HOCKEY_SAND; board.show(0); them.show(0);
        status.score = status.left = status.streak = 0; status.round = 1; status.target = HOCKEY_CLOCK[HOCKEY_SAND]; status.fire = false; status.verb = "Smash!"; status.meter = -1; status.window0 = 0.7; status.window1 = 0.93;
        M.u = 0; M.v = REST; A.u = 0; A.v = L - 0.2; N.smash = N.tipT = 0; N.sayT = 1.1; power = false; reset(1); N.serve = 1.9; phase = "play";
      },
      stop: () => { phase = "idle"; status.verb = ""; status.meter = -1; status.target = 0; mark.visible = false; puck.ember = 0; reset(1); place3(); },
      act: () => {
        if (phase !== "play" || N.smash > 0) return;
        // One try an approach: a smash while the meter runs spends it, in the green or not.
        N.smash = SMASH; power = status.meter >= status.window0 && status.meter <= status.window1;
        if (status.meter >= 0) tried = true;
        out.cue("throw");
      },
      update: (dt) => {
        flash.update(dt);
        N.rivalArm = Math.max(0, N.rivalArm - dt);
        if (phase === "idle") return;
        N.smash = Math.max(0, N.smash - dt);
        if (N.smash <= 0) power = false;
        N.burn = Math.max(0, N.burn - dt);
        puck.ember = Math.min(1, N.burn * 1.5);
        if (N.burn > 0 && (N.trailT -= dt) <= 0) { N.trailT = 0.06; host.burst(P.u, Y + 0.03, -NEAR - P.v, 2); }
        if (N.sayT > 0 && (N.sayT -= dt) <= 0) { out.popup(HOCKEY_SAY[round][0], true); out.cue("round"); N.tipT = 1.1; }
        if (N.tipT > 0 && (N.tipT -= dt) <= 0) out.popup(HOCKEY_SAY[round][1], false);
        // The sand, shown by the second: a call with 30 and 10 seconds left and each of the last five, then the match
        // is over.
        const before = Math.ceil(N.sand);
        N.sand -= dt;
        const now = Math.ceil(N.sand);
        if (now !== before) {
          if (now >= 0) status.target = HOCKEY_CLOCK[now];
          if (now === 30 || now === 10) { out.popup(now === 30 ? "30 seconds of sand!" : "10 seconds!", false); out.cue("tick"); }
          else if (now > 0 && now <= 5) { out.popup(HOCKEY_SAND_SAY[now], true); out.cue("count"); }
          else if (now <= 0) { end(1); return; }
        }
        if (N.serve > 0) { N.serve -= dt; if (N.serve <= 0) { P.dv = P.v < L / 2 ? 0.6 : -0.6; P.du = (tri(M.u * 3 + A.u * 5) - 0.5) * 0.6; } }
        N.acc += Math.min(dt, 0.05);
        while (N.acc >= 1 / 240) { N.acc -= 1 / 240; if (phase === "play") step(1 / 240); }
        if (phase === "idle") return;
        // The meter runs down the coconut's approach to the mallet, the ring where it will cross the mallet's line.
        // Once the approach's try is spent the meter goes and the ring stays, dim.
        const gap = P.v - M.v - PR - MR, reach = -P.dv * APPROACH;
        if (N.serve <= 0 && P.dv < -0.15 && gap > 0 && gap < reach) {
          const m = 1 - gap / reach, hot = !tried && m >= status.window0 && m <= status.window1;
          status.meter = tried ? -1 : m;
          N.fu = P.u + P.du * gap / -P.dv; fold();
          mark.visible = true; mark.position.x = N.fu; mark.position.z = -NEAR - M.v;
          mark.glow = hot ? 2.4 : 1.2; mark.highlight = hot ? 1 : 0; mark.scale.x = mark.scale.z = hot ? 1.2 : 1;
        } else { status.meter = -1; mark.visible = false; tried = false; }
        place3();
      }
    };
  };

  // ---- pool ---------------------------------------------------------------------------------------------
  // Clear the table in ten shots. The cue swings round the cue coconut: act sets the aim; the meter swings: act
  // sets the power and strikes. The guide reads the shot as the table will play it: beads to the first coconut the
  // cue coconut meets and a ghost where they touch, the struck coconut's path to a pocket or off one cushion and on,
  // and a few beads where the cue coconut glances away. When that path drops the coconut its pocket lights gold,
  // and the swing slows over every stretch that does; the meter's green is then the stroke that sinks it clean
  // (softer stops short, harder rattles out of the pocket or runs the cue coconut in after it). Coconuts roll, slow,
  // bounce off the cushions and each other (backed up to the moment they touch, so they part along the line the
  // guide drew) and drop in the pockets. A coconut is 10 and the black (charred) one 30 when it goes last. A shot
  // that sinks one off a cushion or off another coconut, or two at once, is a trick shot (+10); otherwise from the
  // third potting shot in a row each is on fire (+5), and a pure stroke, the green's middle, pays 5 more. The black
  // before the rest is a foul (-20, back on its spot) and so is the cue coconut in a pocket (-10, back on the head
  // spot); either ends the run. Clearing the table pays 5 for each shot left, so a game stays within 200. Fixed
  // steps, typed arrays, no allocation.
  const POOL_SHOTS = 10, POOL_FR = 1, POOL_SP0 = 0.45, POOL_SPK = 3.1, POOL_JAW = 2.5, POOL_RANGE = 0.9, POOL_SWING = 1.05, POOL_SLOW = 0.25, POOL_SCAN = 1440;
  // The swing eases down over the last `POOL_EASE` rad before a stretch that sinks and crawls across it at no more
  // than `POOL_SLOW` of its speed, slower still over a thin one so every stretch stays lit `POOL_HOLD` s or more (one
  // thinner than `POOL_THIN` rad is a knife edge and never lights). The green is the stroke that brings the coconut
  // to its pocket between `POOL_SOFT` and `POOL_FIRM` m/s, and a stroke within `POOL_PURE` of its middle is pure (+5).
  const POOL_EASE = 0.05, POOL_HOLD = 0.1, POOL_THIN = 0.0012, POOL_SOFT = 0.2, POOL_FIRM = POOL_JAW * 0.85, POOL_PURE = 0.035;
  const POOL_SAY = {
    pot: "Coconut in hole! +10", black: "OOGA! Black coconut! +30", early: "Black too soon! Foul -20", scratch: "Scratch! Cue coconut sunk -10",
    rattle: "Rattle! Too hard", bank: "Bank shot! +10", combo: "Combo! +10", two: "Two in one! +10", fire: "On fire! +5", pure: "Pure stroke! +5", pureFire: "Pure fire! +10", whiff: "Whoa... hit nothing",
    clear: Array.from({ length: POOL_SHOTS + 1 }, (_, n) => `Table clear! OOGA! +${n * 5}`)
  };
  const poolGame = (host) => {
    const T = AM.POOL, g = host.node, D = -1.35, N = 9, R = T.r, out = hooks(host), NP = T.pockets.length, TAU = Math.PI * 2;
    const x = new Float64Array(N), z = new Float64Array(N), vx = new Float64Array(N), vz = new Float64Array(N), down = new Uint8Array(N), sink = new Float64Array(N);
    // This shot: which coconut first struck each (-1 none, 0 the cue coconut) and whether it has met a cushion since.
    const by = new Int8Array(N), rail = new Uint8Array(N);
    const PX = new Float64Array(NP), PZ = new Float64Array(NP);
    for (let p = 0; p < NP; p++) { PX[p] = T.pockets[p][0]; PZ[p] = T.pockets[p][1]; }
    // The rack, laid once: the cue coconut on the head spot, the triangle at the foot spot with the charred black
    // coconut in its middle.
    const RACK_X = new Float64Array(N), RACK_Z = new Float64Array(N), HEAD = -T.L / 4, FOOT = T.L / 4;
    RACK_X[0] = HEAD;
    [[0, 0, 1], [1, -1, 2], [1, 1, 3], [2, -2, 8], [2, 0, 4], [2, 2, 5], [3, -3, 6], [3, -1, 7]].forEach(([r, c, b]) => { RACK_X[b] = FOOT + r * R * 1.75; RACK_Z[b] = c * R * 1.02; });
    const balls = [], guide = [];
    for (let k = 0; k < N; k++) { const n = createNode({ geometry: AM.poolBall(k), sightHidden: true }); balls.push(n); addChild(g, n); }
    for (let k = 0; k < 30; k++) { const n = createNode({ geometry: AM.poolDot(), scale: { x: 1.5, y: 1.5, z: 1.5 }, visible: false, sightHidden: true }); guide.push(n); addChild(g, n); }
    const ghost = createNode({ geometry: AM.poolBall(0), scale: { x: 0.95, y: 0.3, z: 0.95 }, visible: false, sightHidden: true });
    const ring = createNode({ geometry: AM.poolRing(), visible: false, sightHidden: true });
    const cue = createNode({ geometry: AM.poolCue(), visible: false, sightHidden: true });
    addChild(g, ghost, ring, cue);
    // The boards stand low past the far rail, where the player's view sees them whole over the table.
    const board = scoreboard(g, "POOL", 3, "#ffd98a", { x: 0.55, y: 1.17, z: D - 0.9 }), left = scoreboard(g, "SHOTS", 2, "#f3e6c8",{ x: -0.55, y: 1.17, z: D - 0.9 });
    for (const sx of [-1, 1]) standOn(g, sx * 0.55, 1.17, D - 0.94);
    const flash = flasher(host), status = makeStatus("Shots");
    board.show(host.best); left.show(0);
    let phase = "idle", dir = 1, shots = 0, potted = 0, run = 0, gold = false, golds = 0;
    // The running values, fields of one object so that writing one each frame never boxes a number: the phase's
    // clock, the swing's middle (`base`) and the aim's offset from it (`rel`), the power, the fixed step's store, and
    // the two aims (`e0` sinks, `e1` not) a stretch's edge lies between.
    const V = { t: 0, base: 0, rel: 0, power: 0, acc: 0, e0: 0, e1: 0 };
    // This shot's tally: coconuts sunk, the first coconut the cue coconut met, tricks and fouls, and a pure stroke.
    let sunk = 0, first = -1, banked = false, combo = false, scratch = false, foul = false, pure = false;
    const rack = () => {
      down.fill(0); sink.fill(0); vx.fill(0); vz.fill(0);
      for (let k = 0; k < N; k++) { x[k] = RACK_X[k]; z[k] = RACK_Z[k]; }
    };
    const place = () => {
      for (let k = 0; k < N; k++) {
        const n = balls[k];
        n.visible = !down[k] || sink[k] < 0.4;
        n.position.x = x[k]; n.position.y = T.y + R - (down[k] ? sink[k] * 0.25 : 0); n.position.z = D + z[k];
      }
    };
    const standing = () => { let n = 0; for (let b = 1; b < N; b++) if (b !== 8 && !down[b]) n++; return n; };
    // Back on the table at (sx, 0), or the first spot along x from it that no coconut covers.
    const respot = (k, sx, step) => {
      down[k] = 0; vx[k] = vz[k] = 0; z[k] = 0; x[k] = sx;
      for (let tries = 0; tries < 20; tries++) {
        let clear = true;
        for (let b = 0; b < N; b++) if (b !== k && !down[b] && (x[b] - x[k]) * (x[b] - x[k]) + (z[b] - z[k]) * (z[b] - z[k]) < 4.2025 * R * R) { clear = false; break; }
        if (clear) return;
        x[k] += step;
      }
    };
    const moving = () => { for (let k = 0; k < N; k++) if (!down[k] && (Math.abs(vx[k]) + Math.abs(vz[k])) > 0.02) return true; return false; };
    const step = (h) => {
      for (let k = 0; k < N; k++) {
        if (down[k]) continue;
        const sp = Math.sqrt(vx[k] * vx[k] + vz[k] * vz[k]);
        if (sp === 0) continue;
        x[k] += vx[k] * h; z[k] += vz[k] * h;
        const s2 = Math.max(0, sp - POOL_FR * h) / sp;
        vx[k] *= s2; vz[k] *= s2;
        if (sp * s2 < 0.01) vx[k] = vz[k] = 0;
        // Pockets first: in a pocket's mouth a coconut runs past the cushion's line and drops, unless it comes in
        // too hard and rattles back out. Then the cushions.
        let mouth = false;
        for (let p = 0; p < NP; p++) {
          const dx = x[k] - PX[p], dz = z[k] - PZ[p], d = Math.sqrt(dx * dx + dz * dz);
          if (d < T.pocket) {
            if (sp > POOL_JAW && d > 1e-6) {
              const nx = dx / d, nz = dz / d, into = vx[k] * nx + vz[k] * nz;
              if (into < 0) { vx[k] = (vx[k] - 2 * into * nx) * 0.45; vz[k] = (vz[k] - 2 * into * nz) * 0.45; out.cue("clack"); out.popup(POOL_SAY.rattle, false); }
              mouth = true;
              break;
            }
            down[k] = 1; sink[k] = 0; vx[k] = vz[k] = 0; x[k] = PX[p]; z[k] = PZ[p]; pot(k);
            break;
          }
          if (d < T.pocket + R * 2.2) mouth = true;
        }
        if (down[k] || mouth) continue;
        const ex = T.L / 2 - R, ez = T.W / 2 - R;
        if (x[k] < -ex) { x[k] = -ex; vx[k] = -vx[k] * 0.8; rail[k] = 1; } else if (x[k] > ex) { x[k] = ex; vx[k] = -vx[k] * 0.8; rail[k] = 1; }
        if (z[k] < -ez) { z[k] = -ez; vz[k] = -vz[k] * 0.8; rail[k] = 1; } else if (z[k] > ez) { z[k] = ez; vz[k] = -vz[k] * 0.8; rail[k] = 1; }
      }
      for (let a = 0; a < N; a++) {
        if (down[a]) continue;
        for (let b = a + 1; b < N; b++) {
          if (down[b]) continue;
          const dx = x[b] - x[a], dz = z[b] - z[a], d2 = dx * dx + dz * dz;
          if (d2 >= 4 * R * R) continue;
          // Back both to the moment they touched, part them along the line of centres there, and run them on for
          // the time taken back.
          const rvx = vx[b] - vx[a], rvz = vz[b] - vz[a], rv2 = rvx * rvx + rvz * rvz, bb = dx * rvx + dz * rvz;
          const back = rv2 > 1e-12 ? Math.min(h, (bb + Math.sqrt(Math.max(0, bb * bb - rv2 * (d2 - 4 * R * R)))) / rv2) : 0;
          x[a] -= vx[a] * back; z[a] -= vz[a] * back; x[b] -= vx[b] * back; z[b] -= vz[b] * back;
          const ex = x[b] - x[a], ez = z[b] - z[a], l = Math.sqrt(ex * ex + ez * ez) || 1, nx = ex / l, nz = ez / l;
          const rel = (vx[a] - vx[b]) * nx + (vz[a] - vz[b]) * nz;
          if (rel > 0) {
            const fa = Math.abs(vx[a]) + Math.abs(vz[a]), fb = Math.abs(vx[b]) + Math.abs(vz[b]);
            if (by[b] < 0 && fa >= fb) by[b] = a;
            if (by[a] < 0 && fb > fa) by[a] = b;
            if (a === 0 && first < 0) first = b;
            vx[a] -= rel * nx; vz[a] -= rel * nz; vx[b] += rel * nx; vz[b] += rel * nz;
            if (rel > 0.3) out.cue("clack");
          }
          x[a] += vx[a] * back; z[a] += vz[a] * back; x[b] += vx[b] * back; z[b] += vz[b] * back;
          const fx = x[b] - x[a], fz = z[b] - z[a], gap = 2 * R - Math.sqrt(fx * fx + fz * fz);
          if (gap > 0) { x[a] -= nx * gap / 2; z[a] -= nz * gap / 2; x[b] += nx * gap / 2; z[b] += nz * gap / 2; }
        }
      }
    };
    const pot = (k) => {
      out.cue("thunk");
      if (k === 0) { scratch = true; status.score = Math.max(0, status.score - 10); out.flop(); out.popup(POOL_SAY.scratch, false); }
      else if (k === 8 && standing() > 0) { foul = true; status.score = Math.max(0, status.score - 20); out.flop(); out.popup(POOL_SAY.early, false); respot(8, FOOT, R * 2.1); }
      else {
        potted++; sunk++;
        if (rail[k] && by[k] >= 0) banked = true;
        if (by[k] > 0) combo = true;
        status.score += k === 8 ? 30 : 10;
        out.popup(k === 8 ? POOL_SAY.black : POOL_SAY.pot, k === 8); flash.hit(k === 8 ? 2.5 : 1.3);
        host.burst(x[k], T.y + 0.1, D + z[k], k === 8 ? 24 : 10); out.crack(x[k], T.y + 0.1, D + z[k], k === 8);
        if (k === 8) out.cue("big");
      }
      board.show(status.score);
    };

    // ---- the guide --------------------------------------------------------------------------------------
    // `AIM` is where a stroke along the angle `a` goes: the coconut it meets (`hit`) after `reach`, the ghost where
    // they touch, the struck coconut's line (`nx`, `nz`) out `len1` to a pocket or a cushion at (`bx`, `bz`) and on
    // along (`rx`, `rz`) for `len2`, keeping `keep` of its speed off the cushion; the pocket it drops in (-1 none),
    // the cut's cosine, the cue coconut's glance (`ux`, `uz`, its length the share of speed it keeps) and the
    // strokes on the meter that sink it clean (`w0` to `w1`). `a` is also the aim the cue lies along.
    const AIM = { a: 0, hit: -1, reach: 0, gx: 0, gz: 0, nx: 0, nz: 0, cos: 0, len1: 0, bx: 0, bz: 0, rx: 0, rz: 0, len2: 0, keep: 1, pocket: -1, ux: 0, uz: 0, w0: 0, w1: 0 };
    const EX = T.L / 2 - R, EZ = T.W / 2 - R, CAP = T.pocket * 0.8, MOUTH = T.pocket + R * 2.2;
    // The roll the helpers below read, from (`ox`, `oz`) along (`dx`, `dz`) out to `lim`, and what they measure (`s`):
    // one object, so no number crosses a call boxed.
    const Q = { ox: 0, oz: 0, dx: 0, dz: 0, lim: 0, s: 0 };
    // How far the roll runs to the cushions' line, in `Q.s`.
    const toRail = () => {
      const ox = Q.ox, oz = Q.oz, dx = Q.dx, dz = Q.dz;
      let s = 1e9;
      if (dx > 1e-9) s = (EX - ox) / dx; else if (dx < -1e-9) s = (-EX - ox) / dx;
      if (dz > 1e-9) s = Math.min(s, (EZ - oz) / dz); else if (dz < -1e-9) s = Math.min(s, (-EZ - oz) / dz);
      Q.s = Math.max(0, s);
    };
    // The pocket the roll drops in, its distance in `Q.s`; -1 for none. Past the cushions' line at `Q.lim` it only
    // drops if it met that line inside the pocket's mouth (else the cushion turns it, as a middle pocket turns a
    // shallow roll).
    const pocketOn = () => {
      const ox = Q.ox, oz = Q.oz, dx = Q.dx, dz = Q.dz, limit = Q.lim;
      let best = -1, found = 1e9;
      for (let p = 0; p < NP; p++) {
        const rx = PX[p] - ox, rz = PZ[p] - oz, s = rx * dx + rz * dz, off = Math.abs(rx * dz - rz * dx);
        if (s <= 0 || s > limit + MOUTH || s >= found || off >= CAP) continue;
        const ex = ox + dx * limit - PX[p], ez = oz + dz * limit - PZ[p];
        if (s - Math.sqrt(CAP * CAP - off * off) > limit && ex * ex + ez * ez > MOUTH * MOUTH * 0.81) continue;
        found = s; best = p;
      }
      Q.s = found;
      return best;
    };
    // Whether a coconut other than the cue coconut and `self` stands within a coconut's width of the roll before
    // `Q.lim`; how far it gets in `Q.s`.
    const blocked = (self) => {
      const ox = Q.ox, oz = Q.oz, dx = Q.dx, dz = Q.dz, limit = Q.lim;
      let found = limit;
      for (let b = 1; b < N; b++) {
        if (b === self || down[b]) continue;
        const rx = x[b] - ox, rz = z[b] - oz, s = rx * dx + rz * dz;
        if (s <= 0 || s >= limit) continue;
        if (Math.abs(rx * dz - rz * dx) < 2 * R) found = Math.min(found, s);
      }
      Q.s = found;
      return found < limit;
    };
    // Whether the roll's start is in a pocket's mouth.
    const nearPocket = () => { for (let p = 0; p < NP; p++) if ((Q.ox - PX[p]) * (Q.ox - PX[p]) + (Q.oz - PZ[p]) * (Q.oz - PZ[p]) < MOUTH * MOUTH) return true; return false; };
    // Whether the struck coconut, back off its cushion along `AIM`'s second leg, runs into the cue coconut on its
    // glance (a kiss): the two rolls cross, or an end of one comes within 2.2 coconut radii of the other.
    const kiss = () => {
      const ax = AIM.bx, az = AIM.bz, ux = AIM.rx, uz = AIM.rz, la = AIM.len2, ul = Math.sqrt(AIM.ux * AIM.ux + AIM.uz * AIM.uz);
      const bx = AIM.gx, bz = AIM.gz, wx = ul > 1e-6 ? AIM.ux / ul : 0, wz = ul > 1e-6 ? AIM.uz / ul : 0, lb = Math.min(1.2, 0.2 + 6 * ul * ul);
      const cr = ux * wz - uz * wx, near = 2.2 * R;
      if (Math.abs(cr) > 1e-9) {
        const s = ((bx - ax) * wz - (bz - az) * wx) / cr, q = ((bx - ax) * uz - (bz - az) * ux) / cr;
        if (s >= 0 && s <= la && q >= 0 && q <= lb) return true;
      }
      for (let k = 0; k < 4; k++) {
        // The start or end of one roll (px, pz) against the other roll, from (ox, oz) along (vx, vz) for `l`.
        const a = k < 2, far = k & 1, px = a ? ax + ux * la * far : bx + wx * lb * far, pz = a ? az + uz * la * far : bz + wz * lb * far;
        const ox = a ? bx : ax, oz = a ? bz : az, vx = a ? wx : ux, vz = a ? wz : uz, l = a ? lb : la;
        const s = Math.max(0, Math.min(l, (px - ox) * vx + (pz - oz) * vz)), fx = px - ox - vx * s, fz = pz - oz - vz * s;
        if (fx * fx + fz * fz < near * near) return true;
      }
      return false;
    };
    // The stroke (0 to 1 on the meter) that brings the struck coconut to its pocket at `Q.s` m/s, left in `Q.s`.
    const strokeFor = () => {
      const arrive = Q.s;
      let v = Math.sqrt(arrive * arrive + 2 * POOL_FR * AIM.len2);
      if (AIM.len2 > 0) v = Math.sqrt((v / AIM.keep) * (v / AIM.keep) + 2 * POOL_FR * AIM.len1);
      else v = Math.sqrt(arrive * arrive + 2 * POOL_FR * AIM.len1);
      const c = v / Math.max(0.05, AIM.cos);
      Q.s = (Math.sqrt(c * c + 2 * POOL_FR * AIM.reach) - POOL_SP0) / POOL_SPK;
    };
    // Traces a stroke along `AIM.a` into `AIM`: true when it sinks a coconut the player may sink, clean, at a stroke
    // on the meter.
    const trace = () => {
      const dx = Math.cos(AIM.a), dz = Math.sin(AIM.a);
      Q.ox = x[0]; Q.oz = z[0]; Q.dx = dx; Q.dz = dz; toRail();
      let t0 = Q.s;
      AIM.hit = AIM.pocket = -1; AIM.len1 = AIM.len2 = 0; AIM.reach = t0;
      for (let b = 1; b < N; b++) {
        if (down[b]) continue;
        const rx = x[b] - x[0], rz = z[b] - z[0], along = rx * dx + rz * dz;
        if (along <= 0) continue;
        const off = Math.abs(rx * dz - rz * dx);
        if (off >= 2 * R) continue;
        const s = along - Math.sqrt(4 * R * R - off * off);
        if (s < t0) { t0 = s; AIM.hit = b; }
      }
      if (AIM.hit < 0) return false;
      const h = AIM.hit, gx = x[0] + dx * t0, gz = z[0] + dz * t0, nx = (x[h] - gx) / (2 * R), nz = (z[h] - gz) / (2 * R);
      AIM.reach = t0; AIM.gx = gx; AIM.gz = gz; AIM.nx = nx; AIM.nz = nz; AIM.cos = dx * nx + dz * nz;
      AIM.ux = dx - nx * AIM.cos; AIM.uz = dz - nz * AIM.cos;
      Q.ox = x[h]; Q.oz = z[h]; Q.dx = nx; Q.dz = nz; toRail();
      const lim1 = Q.lim = Q.s;
      let p = pocketOn();
      AIM.len1 = Q.lim = p >= 0 ? Q.s : lim1;
      if (blocked(h)) { AIM.len1 = Q.s; return false; }
      if (p < 0) {
        // Off the cushion: it keeps its run along the cushion and a fifth less of its run into it.
        const bx = Q.ox = x[h] + nx * lim1, bz = Q.oz = z[h] + nz * lim1;
        if (nearPocket()) return false;
        let rx = nx, rz = nz;
        if (Math.abs(Math.abs(bx) - EX) < 1e-6) rx = -nx * 0.8; else rz = -nz * 0.8;
        const keep = Math.sqrt(rx * rx + rz * rz);
        rx /= keep; rz /= keep;
        AIM.bx = bx; AIM.bz = bz; AIM.rx = rx; AIM.rz = rz; AIM.keep = keep;
        Q.dx = rx; Q.dz = rz; toRail();
        const lim2 = Q.lim = Q.s;
        p = pocketOn();
        AIM.len2 = Q.lim = p >= 0 ? Q.s : Math.min(lim2, 0.5);
        if (blocked(h)) { AIM.len2 = Q.s; return false; }
        if (p < 0 || kiss()) return false;
      }
      if (h === 8 && standing() > 0) return false;
      AIM.pocket = p;
      Q.s = POOL_SOFT; strokeFor(); AIM.w0 = Q.s;
      Q.s = POOL_FIRM; strokeFor(); AIM.w1 = Q.s;
      // The cue coconut glances off with `ul` of its speed: the green stops short of the stroke that would roll it
      // into a pocket on its line (a scratch), and a green thinner than 0.04 lights nothing.
      const ul = Math.sqrt(AIM.ux * AIM.ux + AIM.uz * AIM.uz);
      if (ul > 0.05) {
        const ex = AIM.ux / ul, ez = AIM.uz / ul;
        Q.ox = gx; Q.oz = gz; Q.dx = ex; Q.dz = ez; toRail();
        const lim = Q.s + MOUTH;
        let safe = 1e9;
        for (let q = 0; q < NP; q++) {
          const qx = PX[q] - gx, qz = PZ[q] - gz, s = qx * ex + qz * ez, off = Math.abs(qx * ez - qz * ex);
          if (s > 0 && off < T.pocket) safe = Math.min(safe, Math.max(0, s - Math.sqrt(T.pocket * T.pocket - off * off)));
        }
        if (safe < lim) {
          const v = Math.sqrt(2 * POOL_FR * safe * 0.8) / ul;
          AIM.w1 = Math.min(AIM.w1, (Math.sqrt(v * v + 2 * POOL_FR * t0) - POOL_SP0) / POOL_SPK);
        }
      }
      return AIM.w0 <= 1 && AIM.w1 - AIM.w0 >= 0.04;
    };
    // Every stretch of the swing that sinks something, found by turning the aim once round the cue coconut and
    // halving to each edge between its steps: `GOLD` holds each as a pair of angles from `base`, which sits in the
    // middle of the widest (or points at the nearest coconut in play when nothing drops), and `CRAWL` the share of the
    // swing's speed that holds it lit `POOL_HOLD` s.
    const GOLD = new Float64Array(64), CRAWL = new Float64Array(32);
    // Halves between `V.e0`, an aim that sinks, and `V.e1`, one that does not, leaving the edge in `V.e0`.
    const edge = () => { for (let k = 0; k < 6; k++) { AIM.a = (V.e0 + V.e1) / 2; if (trace()) V.e0 = AIM.a; else V.e1 = AIM.a; } };
    const plan = () => {
      const step = TAU / POOL_SCAN, speed = POOL_SWING * (1 + (POOL_SHOTS - shots) * 0.04);
      let from = 0;
      for (let i = 0; i < POOL_SCAN; i++) { AIM.a = i * step; if (!trace()) { from = i; break; } }
      let open = -1, bestW = 0;
      golds = 0; V.base = 0;
      for (let i = 1; i <= POOL_SCAN; i++) {
        AIM.a = (from + i) * step;
        const on = i < POOL_SCAN && trace();
        if (on && open < 0) open = i;
        else if (!on && open >= 0) {
          V.e0 = (from + open) * step; V.e1 = V.e0 - step; edge();
          const a0 = V.e0;
          V.e0 = (from + i - 1) * step; V.e1 = V.e0 + step; edge();
          const w = V.e0 - a0;
          if (w >= POOL_THIN && golds < GOLD.length) {
            CRAWL[golds >> 1] = Math.min(POOL_SLOW, w / (POOL_HOLD * speed));
            GOLD[golds++] = a0; GOLD[golds++] = a0 + w;
            if (w >= bestW) { bestW = w; V.base = a0 + w / 2; }
          }
          open = -1;
        }
      }
      if (!golds) {
        let best = 1e9;
        for (let b = 1; b < N; b++) { if (down[b] || (b === 8 && standing() > 0)) continue; const d = (x[b] - x[0]) * (x[b] - x[0]) + (z[b] - z[0]) * (z[b] - z[0]); if (d < best) { best = d; V.base = Math.atan2(z[b] - z[0], x[b] - x[0]); } }
      }
      // The stretches as angles from `base`, wrapped to within half a turn of it.
      for (let i = 0; i < golds; i++) { const r = GOLD[i] - V.base; GOLD[i] = r - Math.round(r / TAU) * TAU; }
    };
    // How fast the swing runs at `V.rel` from `base`: at its stretch's crawl over a stretch that sinks, easing down as
    // it nears one.
    const swingAt = () => {
      let k = 1;
      for (let i = 0; i < golds; i += 2) {
        const r = V.rel, d = r < GOLD[i] ? GOLD[i] - r : r > GOLD[i + 1] ? r - GOLD[i + 1] : 0, c = CRAWL[i >> 1];
        if (d < POOL_EASE) k = Math.min(k, c + (1 - c) * d / POOL_EASE);
      }
      return k;
    };
    // Whether the aim is on a stretch that lights.
    const onGold = () => { for (let i = 0; i < golds; i += 2) if (V.rel >= GOLD[i] && V.rel <= GOLD[i + 1]) return true; return false; };
    // Beads along the polyline from (ox, oz) out `l1` along (d1x, d1z), then `l2` along (d2x, d2z), `count` of them
    // from guide bead `at`.
    const beads = (at, count, ox, oz, d1x, d1z, l1, d2x, d2z, l2, on) => {
      const total = l1 + l2, n = on ? Math.min(count, Math.ceil(total / 0.05)) : 0, gap = n ? total / n : 0;
      for (let k = 0; k < count; k++) {
        const b = guide[at + k];
        b.visible = k < n;
        if (k >= n) continue;
        const s = (k + 0.6) * gap;
        if (s <= l1) { b.position.x = ox + d1x * s; b.position.z = D + oz + d1z * s; }
        else { b.position.x = ox + d1x * l1 + d2x * (s - l1); b.position.z = D + oz + d1z * l1 + d2z * (s - l1); }
        b.position.y = T.y + R;
      }
    };
    // The guide for the aim at `AIM.a` (traced into AIM), the lit pocket, and the cue lying along the aim with its
    // tip behind the cue coconut, drawn back as the power builds.
    const showAim = (on) => {
      const cs = Math.cos(AIM.a), sn = Math.sin(AIM.a), hit = on && AIM.hit >= 0;
      beads(0, 10, x[0], z[0], cs, sn, Math.max(0, AIM.reach - 0.03), 0, 0, 0, on);
      beads(10, 16, hit ? x[AIM.hit] : 0, hit ? z[AIM.hit] : 0, AIM.nx, AIM.nz, AIM.len1, AIM.rx, AIM.rz, AIM.len2, hit);
      const ul = Math.sqrt(AIM.ux * AIM.ux + AIM.uz * AIM.uz), glance = 0.05 + ul * 0.22;
      beads(26, 4, AIM.gx, AIM.gz, ul > 1e-6 ? AIM.ux / ul : 0, ul > 1e-6 ? AIM.uz / ul : 0, glance, 0, 0, 0, hit && ul > 0.05);
      ghost.visible = hit;
      ghost.position.x = AIM.gx; ghost.position.y = T.y + 0.004; ghost.position.z = D + AIM.gz;
      ring.visible = on && gold;
      if (gold) { ring.position.x = PX[AIM.pocket]; ring.position.y = T.y + 0.09 + Math.sin(V.t * 6) * 0.008; ring.position.z = D + PZ[AIM.pocket]; }
      cue.visible = on;
      const back = 0.06 + (phase === "power" ? V.power * 0.25 : 0) + 1.46;
      cue.position.x = x[0] - cs * back; cue.position.y = T.y + R + 0.02; cue.position.z = D + z[0] - sn * back;
      cue.rotation.y = Math.atan2(cs, sn);
    };
    const nextShot = () => {
      if (shots <= 0 || potted >= 8) {
        phase = "idle"; showAim(false); status.verb = ""; status.meter = -1;
        if (potted >= 8) { status.score += shots * 5; board.show(status.score); out.popup(POOL_SAY.clear[shots], true); out.crack(0, T.y + 0.25, D, true); out.cue("win"); }
        host.onEnd(status.score);
        return;
      }
      phase = "aim"; V.t = 0; status.verb = "Aim"; status.meter = -1;
      plan();
      V.rel = dir * -POOL_RANGE;
      AIM.a = V.base + V.rel; gold = trace() && onGold();
    };
    // The shot has stopped rolling: fouls put their coconut back and end the run; a potting shot adds to the run and
    // pays its trick, or its fire and its pure stroke (never more than 10 a shot, so a game stays within 200).
    const endShot = () => {
      if (scratch) respot(0, HEAD, -R * 2.1);
      if (scratch || foul) run = 0;
      else if (sunk) {
        run++;
        const trick = banked || combo || sunk > 1, fire = run >= 3, bonus = trick ? 10 : (fire ? 5 : 0) + (pure ? 5 : 0);
        if (bonus) {
          status.score += bonus; board.show(status.score); flash.hit(2);
          out.popup(banked ? POOL_SAY.bank : combo ? POOL_SAY.combo : sunk > 1 ? POOL_SAY.two : pure ? (fire ? POOL_SAY.pureFire : POOL_SAY.pure) : POOL_SAY.fire, true);
          out.cue(trick ? "big" : "fire"); out.shake(trick ? 0.4 : 0.2);
          if (trick) out.crack(0, T.y + 0.25, D, true);
        }
      } else {
        run = 0;
        if (first < 0) { out.popup(POOL_SAY.whiff, false); out.flop(); }
      }
      status.streak = run; status.fire = run >= 3;
      dir = -dir;
      nextShot();
    };
    rack(); place();
    // The hall's show while nobody plays: a cue lies behind the cue coconut, swinging slowly over the rack and drawn
    // back and forth, and now and then (`tease`) a practice stroke up to the coconut; k 0 puts the cue away.
    const I = { t: 0, s: -1 };
    const attract = (dt, k) => {
      if (k <= 0) { I.s = -1; cue.visible = false; return; }
      I.t += dt;
      let back = 1.56 + (0.5 + 0.5 * Math.sin(I.t * 1.3)) * 0.08;
      if (I.s >= 0) {
        I.s += dt;
        const f = Math.min(1, I.s / 0.9);
        back += f < 0.6 ? 0.16 * ease(f / 0.6) : f < 0.8 ? 0.16 - 0.19 * ease((f - 0.6) / 0.2) : -0.03 * (1 - ease((f - 0.8) / 0.2));
        if (f >= 1) I.s = -1;
      }
      const a = Math.sin(I.t * 0.35) * 0.3 * k, cs = Math.cos(a), sn = Math.sin(a);
      cue.visible = true;
      cue.position.x = x[0] - cs * back; cue.position.y = T.y + R + 0.02; cue.position.z = D + z[0] - sn * back;
      cue.rotation.y = Math.atan2(cs, sn);
    };
    const tease = () => { if (I.s < 0) I.s = 0; };
    return {
      kind: "billiards", name: "Pool", help: "Space or tap stops the swinging cue, on a gold pocket if you can, then the power in the green.",
      stars: [30, 60, 95], tickets: (score) => Math.floor(score / 4), status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => {
        rack(); shots = POOL_SHOTS; potted = 0; run = 0; dir = 1;
        status.score = status.streak = 0; status.fire = false; board.show(0); left.show(shots); status.left = shots;
        nextShot();
      },
      stop: () => { phase = "idle"; gold = false; showAim(false); rack(); place(); left.show(0); board.show(host.best); status.meter = -1; status.verb = ""; },
      act: () => {
        if (phase === "aim") {
          phase = "power"; V.t = 0; status.verb = "Shoot!"; out.cue("lock");
          // The green is the stroke that sinks it; with nothing to sink, a firm one.
          status.window0 = gold ? Math.max(0, AIM.w0) : 0.35; status.window1 = gold ? Math.min(1, AIM.w1) : 0.6;
        } else if (phase === "power") {
          const sp = POOL_SP0 + V.power * POOL_SPK;
          vx[0] = Math.cos(AIM.a) * sp; vz[0] = Math.sin(AIM.a) * sp;
          by.fill(-1); rail.fill(0); sunk = 0; first = -1; banked = combo = scratch = foul = false;
          pure = gold && Math.abs(V.power - (status.window0 + status.window1) / 2) <= POOL_PURE;
          phase = "roll"; showAim(false); status.verb = ""; status.meter = -1;
          shots--; left.show(shots); status.left = shots; out.cue("clack");
        }
      },
      update: (dt) => {
        flash.update(dt);
        for (let k = 0; k < N; k++) if (down[k] && sink[k] < 1) sink[k] += dt * 2;
        if (phase === "idle") { place(); return; }
        V.t += dt;
        if (phase === "aim") {
          // The swing runs `POOL_RANGE` either side of `base`, quicker with each shot taken.
          V.rel += dir * POOL_SWING * (1 + (POOL_SHOTS - shots) * 0.04) * swingAt() * dt;
          if (V.rel > POOL_RANGE) { V.rel = POOL_RANGE; dir = -1; } else if (V.rel < -POOL_RANGE) { V.rel = -POOL_RANGE; dir = 1; }
          AIM.a = V.base + V.rel;
          gold = trace() && onGold();
          showAim(true);
        } else if (phase === "power") { V.power = tri(V.t * 0.6); status.meter = V.power; showAim(true); }
        else if (phase === "roll") {
          V.acc += Math.min(dt, 0.05);
          while (V.acc >= 1 / 240) { V.acc -= 1 / 240; step(1 / 240); }
          if (!moving()) { for (let k = 0; k < N; k++) vx[k] = vz[k] = 0; endShot(); }
        }
        place();
      }
    };
  };

  // ---- darts --------------------------------------------------------------------------------------------
  // Three visits of three darts, each a round of its own, its target ringed on the board. A dart is aimed in two
  // taps: a line sweeps across the board and act stops it, then a line sweeps up it and act throws where the two
  // cross. Visit one hunts the treble 20 (its number lit in gold): every bed scores as marked, the thin inner ring
  // trebles, the outer doubles, the outer bull is 10 and the bull 25. Visit two is the bull round: the bull is 50 and
  // one straight after another bull 60, the outer bull 25, and every other bed scores its number once. Visit three is
  // the checkout: the double by the gold number pays 60 and lights the next, the bulls pay 25 and 10 again and the
  // rest their number once. The third target in a row sets the fire, +10 once; so a game of all targets makes the
  // board's 540 and nothing more. After a round's call the lines wait `DART_CALL` s so the call never hides the board;
  // the bull round sweeps fastest, and the checkout no faster than a 30 fps frame steps over a painted double. A dart
  // lands in the bed the board shows it in (`DART.hand`), and the darts stay in the board until the visit ends.
  const DART_SWEEP = 0.26, DART_SPEED = [0.3, 0.35, 0.3], DART_CALL = 1.2, DART_OUTS = [16, 20, 8, 10, 12, 18, 4, 14, 6, 2, 3, 19, 7, 11, 13, 15, 17, 9, 5, 1];
  // Every line a dart says, built once: each bed with its score, each round's call and each visit's total.
  const DART_SAY = {
    single: Array.from({ length: 21 }, (_, n) => `Single ${n} +${n}`), double: Array.from({ length: 21 }, (_, n) => `Double ${n}! +${n * 2}`),
    treble: Array.from({ length: 21 }, (_, n) => n === 20 ? "OOGA! Treble 20! +60" : `Treble ${n}! +${n * 3}`),
    bull: "OOGA! Bull! +50", bulls: "Bull streak! OOGA! +60", outer: "Outer bull +25", bull25: "Bull +25", outer10: "Outer bull +10", out: "Checkout! OOGA! +60", miss: "Whoa... off the board",
    fire: { treble: "ON FIRE! Treble 20! +70", bull: "ON FIRE! Bull! +60", bulls: "ON FIRE! Bull streak! +70", out: "ON FIRE! Checkout! +70" },
    round: ["", "Bull round!", "Checkout!"],
    visit: Array.from({ length: 181 }, (_, s) => s === 180 ? "ONE HUNDRED EIGHTY! OOGA!" : `Visit ${s}`)
  };
  const dartsGame = (host) => {
    const B = AM.DART, g = host.node, DZ = -B.oche, out = hooks(host), SIGHT = AM.dartSight(), TAU = Math.PI * 2;
    const darts = [0, 1, 2].map(() => createNode({ geometry: AM.dart(), visible: false, sightHidden: true }));
    // The sights: the line sweeping across (stood upright), the one sweeping up, the ring where they cross, the lit
    // number and the ring on the round's target (the same ring, so one draw).
    const across = createNode({ geometry: SIGHT.line, rotation: { x: 0, y: 0, z: Math.PI / 2 }, visible: false, sightHidden: true });
    const up = createNode({ geometry: SIGHT.line, visible: false, sightHidden: true });
    const cross = createNode({ geometry: SIGHT.ring, scale: { x: 0.45, y: 0.45, z: 0.45 }, visible: false, sightHidden: true });
    const lit = createNode({ geometry: SIGHT.lit, position: { x: 0, y: B.y, z: DZ + 0.017 }, visible: false, sightHidden: true });
    const mark = createNode({ geometry: SIGHT.ring, position: { x: 0, y: B.y, z: DZ + 0.017 }, visible: false, sightHidden: true });
    addChild(g, ...darts, across, up, cross, lit, mark);
    const board = scoreboard(g, "DARTS", 3, "#ffd98a", { x: -0.5, y: B.y + 0.8, z: DZ + 0.08 }), left = scoreboard(g, "LEFT", 1, "#f3e6c8",{ x: 0.5, y: B.y + 0.8, z: DZ + 0.08 });
    const flash = flasher(host), status = makeStatus("Darts");
    board.show(host.best); left.show(0);
    let phase = "idle", visit = 0, thrown = 0, bed = 0, num = 0, visitSum = 0, lastBull = false, checkout = 20, outs = 0, games = 0;
    // The running values, fields of one object so that writing one each frame never boxes a number: the phase's
    // clock, the line's place, where the first tap stopped it, where the dart flies and how far it has come.
    const V = { t: 0, sweep: 0, lockX: 0, tx: 0, ty: 0, fly: 0 };
    // Where the dart at (`V.tx`, `V.ty`) from the bull lands, by the rings as painted: its number, and its bed (0 off
    // the board, 1 single, 2 double, 3 treble, 4 outer bull, 5 bull).
    const land = () => {
      const px = V.tx, py = V.ty, d = Math.sqrt(px * px + py * py);
      let a = Math.atan2(px, py);
      if (a < 0) a += TAU;
      num = B.order[Math.round(a / (TAU / 20)) % 20];
      bed = d < B.hand(a, B.bull) ? 5 : d < B.hand(a, B.outer) ? 4 : d > B.hand(a, B.dOut) ? 0 : d >= B.hand(a, B.dIn) ? 2 : d >= B.hand(a, B.tIn) && d <= B.hand(a, B.tOut) ? 3 : 1;
    };
    // The line's place in `V.sweep`: `DART_SWEEP` either side of the bull at the visit's speed, from the left or the
    // bottom (`from` 0) or the right (0.5).
    const sweepAt = (from) => { V.sweep = (tri(from + V.t * DART_SPEED[visit] / (4 * DART_SWEEP)) * 2 - 1) * DART_SWEEP; };
    // Lights number `n` in gold and rings the middle of its bed, painted between the rings `r0` and `r1`.
    const light = (n, r0, r1) => {
      const a = B.order.indexOf(n) / 20 * TAU, r = (B.hand(a, r0) + B.hand(a, r1)) / 2;
      lit.rotation.z = -a; lit.visible = true;
      place(mark, Math.sin(a) * r, B.y + Math.cos(a) * r, DZ + 0.017);
      mark.scale.x = mark.scale.y = mark.scale.z = 0.62; mark.visible = true;
    };
    const aim = () => { phase = "x"; V.t = 0; across.visible = true; up.visible = cross.visible = false; status.verb = "Aim"; };
    const startVisit = () => {
      thrown = 0; visitSum = 0; lastBull = false;
      for (const d of darts) d.visible = false;
      lit.visible = mark.visible = false;
      if (visit === 0) light(20, B.tIn, B.tOut);
      else if (visit === 1) { place(mark, 0, B.y, DZ + 0.017); mark.scale.x = mark.scale.y = mark.scale.z = 1; mark.visible = true; }
      else { checkout = DART_OUTS[(games * 3 + outs) % DART_OUTS.length]; light(checkout, B.dIn, B.dOut); }
      left.show(3); status.left = 3; status.round = visit + 1;
      if (visit) { phase = "call"; V.t = 0; status.verb = ""; } else aim();
    };
    // The hall's show while nobody plays: the treble 20's number lit, breathing, and now and then (`tease`) a dart
    // flies into its bed and stays a moment; k 0 clears the board.
    const I = { t: 0, on: false, d: -1, tx: 0, ty: 0 };
    const attract = (dt, k) => {
      const d = darts[0];
      if (k <= 0) { I.on = false; I.d = -1; lit.visible = mark.visible = d.visible = false; lit.glow = 1; return; }
      if (!I.on) { I.on = true; light(20, B.tIn, B.tOut); mark.visible = false; }
      I.t += dt;
      lit.glow = 1 + 1.5 * Math.max(0, Math.sin(I.t * 2.2)) * k;
      if (I.d < 0) return;
      const was = I.d;
      I.d += dt;
      if (was < 0.3) {
        const f = Math.min(1, I.d / 0.3);
        place(d, 0.22 + (I.tx - 0.22) * f, 1.55 + (B.y + I.ty - 1.55) * f + Math.sin(f * Math.PI) * 0.12, -0.3 + (DZ + 0.005 + 0.3) * f);
        if (f >= 1) out.cue("knock");
      } else if (I.d > 1.9) { I.d = -1; d.visible = false; }
    };
    const tease = () => {
      if (I.d >= 0) return;
      const a = B.order.indexOf(20) / 20 * TAU, r = (B.hand(a, B.tIn) + B.hand(a, B.tOut)) / 2;
      I.d = 0; I.tx = Math.sin(a) * r + (Math.random() - 0.5) * 0.02; I.ty = Math.cos(a) * r + (Math.random() - 0.5) * 0.015;
      darts[0].visible = true;
      out.cue("throw");
    };
    return {
      kind: "darts", name: "Darts", help: "Space or tap stops the line across, then the line up: the dart flies where they cross.",
      stars: [100, 160, 260], tickets: (score) => Math.floor(score / 9), status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => { visit = 0; outs = 0; games++; status.score = status.streak = 0; status.fire = false; board.show(0); startVisit(); },
      stop: () => { phase = "idle"; status.verb = ""; across.visible = up.visible = cross.visible = lit.visible = mark.visible = false; for (const d of darts) d.visible = false; left.show(0); board.show(host.best); },
      act: () => {
        if (phase === "x") { V.lockX = V.sweep; phase = "y"; V.t = 0; up.visible = cross.visible = true; status.verb = "Throw!"; out.cue("lock"); }
        else if (phase === "y") {
          phase = "fly"; V.fly = 0; V.tx = V.lockX; V.ty = V.sweep; status.verb = "";
          across.visible = up.visible = cross.visible = false;
          darts[thrown].visible = true; out.cue("throw");
        }
      },
      update: (dt) => {
        flash.update(dt);
        if (phase === "idle") return;
        V.t += dt;
        if (phase === "x") {
          sweepAt(thrown & 1 ? 0.5 : 0);
          place(across, V.sweep, B.y, DZ + 0.022);
        } else if (phase === "y") {
          sweepAt(0);
          place(up, 0, B.y + V.sweep, DZ + 0.024);
          place(cross, V.lockX, B.y + V.sweep, DZ + 0.026);
        } else if (phase === "fly") {
          V.fly += dt / 0.3;
          const d = darts[thrown], k = Math.min(1, V.fly), tx = V.tx, ty = V.ty;
          // The dart flies point first and its point sinks just into the board's face.
          place(d, 0.22 + (tx - 0.22) * k, 1.55 + (B.y + ty - 1.55) * k + Math.sin(k * Math.PI) * 0.12, -0.3 + (DZ + 0.005 + 0.3) * k);
          if (k >= 1) {
            land();
            // What it pays in this round, and whether it hit the round's target.
            let value = 0, word = DART_SAY.miss, target = false;
            if (bed === 5 && visit === 1) { value = lastBull ? 60 : 50; word = lastBull ? DART_SAY.bulls : DART_SAY.bull; target = true; }
            else if (bed === 5) { value = 25; word = DART_SAY.bull25; }
            else if (bed === 4) { value = visit === 1 ? 25 : 10; word = visit === 1 ? DART_SAY.outer : DART_SAY.outer10; }
            else if (bed === 2 && visit === 2 && num === checkout) { value = 60; word = DART_SAY.out; target = true; }
            else if (bed && visit === 0) { value = num * (bed === 3 ? 3 : bed === 2 ? 2 : 1); word = bed === 3 ? DART_SAY.treble[num] : bed === 2 ? DART_SAY.double[num] : DART_SAY.single[num]; target = bed === 3 && num === 20; }
            else if (bed) { value = num; word = DART_SAY.single[num]; }
            lastBull = bed === 5;
            status.streak = target ? status.streak + 1 : 0;
            status.fire = status.streak >= 3;
            // The third on target in a row sets the fire: +10, said with the dart.
            const lights = status.streak === 3;
            if (lights) word = visit === 0 ? DART_SAY.fire.treble : visit === 2 ? DART_SAY.fire.out : value === 60 ? DART_SAY.fire.bulls : DART_SAY.fire.bull;
            status.score += lights ? value + 10 : value; visitSum += value; board.show(status.score);
            out.cue(lights ? "fire" : value >= 50 ? "big" : value ? "knock" : "miss");
            out.popup(word, value >= 50);
            if (value >= 50) { flash.hit(2); host.burst(tx, B.y + ty, DZ + 0.1, 16); out.shake(0.3); }
            // A 50 or 60 cracks a coconut on the board; any other hit throws husk chips off it.
            if (value) out.crack(tx, B.y + ty, DZ + 0.1, value >= 50); else out.flop();
            if (value === 60 && visit === 2) { outs++; checkout = DART_OUTS[(games * 3 + outs) % DART_OUTS.length]; light(checkout, B.dIn, B.dOut); }
            thrown++; left.show(3 - thrown); status.left = 3 - thrown;
            if (thrown < 3) aim(); else { phase = "pull"; V.t = 0; }
          }
        } else if (phase === "pull" && V.t > 0.5) {
          // The last dart's call has had its moment: the visit's total, then the next round.
          phase = "total"; V.t = 0; out.popup(DART_SAY.visit[visitSum], visitSum >= 100); if (visitSum >= 100) out.cue("win");
        } else if (phase === "total" && V.t > 0.9) {
          visit++;
          if (visit < 3) { out.popup(DART_SAY.round[visit], true); out.cue("round"); startVisit(); }
          else { phase = "idle"; lit.visible = mark.visible = false; for (const d of darts) d.visible = false; host.onEnd(status.score); }
        } else if (phase === "call" && V.t > DART_CALL) aim();
      }
    };
  };

  // ---- pinball ------------------------------------------------------------------------------------------
  // Three coconuts. While one waits in the shooter lane the plunger's meter swings: act lets it go, harder the
  // higher the meter, and a pull stopped in the window is a skill shot: the coconut arcs over into the blinking top
  // lane for 1000 (lighting no other on its way over). Then act flips both flippers. A coconut on a flipper as it
  // swings up flies off the flipper's face once a flip, harder and further across the nearer the tip it sits, so the
  // moment of the flip aims it: a late flip crosses, the left flipper to the mammoth ramp's mouth on the right and the
  // right one to the teeth on the left; a flip pressed again too soon is weak. The coconut rolls on the tilted playfield (`PIN`), off the walls, the slopes to the flippers, the three
  // bumpers (100 and a kick) and the mammoth's teeth, three bone drop targets down the left side (500 each, knocked by
  // a firm hit): knock all three down for mammoth multiball, a second coconut out of the shooter lane and every score
  // doubled until one drains, when the teeth stand again. A coconut going up the ramp fast enough rides the tusk round
  // the top and down to the left flipper (`PIN.ramp`), 750 and, within `PIN_COMBO` seconds of the last, a combo worth
  // once more each (x2 to x5); in multiball the ramp is the jackpot, 5000 and 2500 more each time. The top lanes light
  // as a coconut rolls through them (250 each); all three pay 1000 and raise the multiplier on everything, up to x3
  // for the coconut in play. A coconut that drains counts its bonus up: every bumper, tooth, lane and ramp it hit,
  // times its multiplier. One lost in its first `SAVE` seconds is saved, once a coconut. Each coconut after the first
  // rolls faster (`grav`) with a shorter save. Between the flippers' tips and below them it drains; one that sits
  // still is shaken loose. Circle-against-
  // segment collisions in fixed steps over preallocated walls; nothing allocates in play but a call's words the first
  // time they are said.
  const PIN_RAMP = 750, PIN_JACKPOT = 5000, PIN_COMBO = 5, PIN_STAMPEDE = 5, PIN_BONUS = { bumps: 25, teeth: 150, lanes: 100, ramps: 300 };
  // The calls, kept once made as `worded` keeps them, but pinball's values run wide (a coconut's bonus, a jackpot
  // growing through a multiball), so only the first `PIN_WORDS` of each are kept and the table's memory stays flat.
  const PIN_WORDS = 64;
  const kept = (pre) => { const said = new Map(); return (n) => { let s = said.get(n); if (s === undefined) { s = `${pre}${n}`; if (said.size < PIN_WORDS) said.set(n, s); } return s; }; };
  const PIN_SAY = {
    skill: kept("Skill shot! +"), tooth: kept("Mammoth tooth! +"), ramp: kept("Mammoth ramp! +"), jackpot: kept("JACKPOT! +"), bonus: kept("Ball bonus +"),
    combo: [2, 3, 4].map((n) => kept(`Ramp x${n}! +`)), stampede: kept("STAMPEDE! +"), lanes: [2, 3].map((n) => kept(`All lanes x${n}! +`))
  };
  const pinballGame = (host) => {
    const T = AM.PIN, g = host.node, D = -1.05, HW = T.w / 2 - 0.03, HL = T.l / 2 - 0.03, R = 0.02, G = 2.4, SAVE = 3, out = hooks(host);
    // A flipper's shot: its speed off the face at the pivot, what the tip adds, and how far toward the far side a
    // strike at the tip turns it (radians) against one at the pivot. A flip pressed before the flipper has lain down
    // `RECHARGE` seconds is weak: it swings up at half speed and shoots at `WEAK` of the speed, so a steady beat of
    // presses cannot stand in for timing them.
    const SHOT = 2.6, SHOT_TIP = 1.2, SHOT_TURN = 0.3, RECHARGE = 0.2, WEAK = 0.5;
    // The ramp: its mouth across from `RAMP_U0` to `RAMP_U1` where the field's `v` passes `RAMP_V`, the slowest a coconut
    // going up it gets over its lip, and the length along its path to each point (`RAMP_AT`).
    const RAMP = T.ramp, RAMP_U0 = 0.125, RAMP_U1 = 0.225, RAMP_V = -0.02, RAMP_MIN = 1.3, RAMP_AT = new Float64Array(RAMP.length);
    for (let i = 1; i < RAMP.length; i++) RAMP_AT[i] = RAMP_AT[i - 1] + Math.hypot(RAMP[i][0] - RAMP[i - 1][0], RAMP[i][1] - RAMP[i - 1][1], RAMP[i][2] - RAMP[i - 1][2]);
    const RAMP_LEN = RAMP_AT[RAMP.length - 1], LIT = [AM.pinLight(0), AM.pinLight(1)];
    // The two coconuts: the one in play and multiball's second, `on` the table, `launched` off the plunger, `fresh`
    // until it leaves the shooter lane, `arc` while a skill shot carries it to its lane, `kick` the flip that last
    // struck it, and `ramp` how far along the ramp it rides (-1 off it) at `rs` m/s, `eu` and `ev` how far off the
    // channel's middle it came into the mouth; `stuck` is how long it has sat within a centimetre of (`su`, `sv`).
    const STUCK = 2;
    const balls = [0, 1].map(() => ({ u: 0, v: 0, lift: R, du: 0, dv: 0, su: 0, sv: 0, stuck: 0, on: false, launched: false, fresh: false, arc: false, kick: -1, ramp: -1, rs: 0, eu: 0, ev: 0, node: createNode({ geometry: AM.coconutBall("cue", R), visible: false, sightHidden: true }) }));
    const flippers = [-1, 1].map(() => createNode({ geometry: AM.pinFlipper(), sightHidden: true }));
    const lanes = [-0.14, 0, 0.14].map((u) => ({ u, lit: false, node: createNode({ geometry: LIT[0], sightHidden: true }) }));
    // The mammoth's teeth stand off the left wall at `TEETH_U`, each reaching `TOOTH` either side of its middle up the
    // slope (`seg`, its face); `drop` eases 0 (standing) to 1 (down) as one falls or rises again, sinking it `lift`.
    const TEETH_U = -0.235, TOOTH = 0.028;
    const teeth = [0.02, -0.055, -0.13].map((v) => ({ u: TEETH_U, v, lift: 0, up: true, drop: 0, seg: Float64Array.of(TEETH_U, v - TOOTH, TEETH_U, v + TOOTH), node: createNode({ geometry: AM.pinTooth(), sightHidden: true }) }));
    // The ramp, and the ember before its mouth: slow while it waits, quick while a combo is on, burning in multiball.
    const ramp = createNode({ geometry: AM.pinRamp(), position: { x: 0, y: 0, z: D }, sightHidden: true }), arrow = createNode({ geometry: LIT[0], sightHidden: true });
    addChild(g, ...balls.map((b) => b.node), ...flippers, ...lanes.map((l) => l.node), ...teeth.map((k) => k.node), ramp, arrow);
    const board = scoreboard(g, "PINBALL", 5, "#ffd98a", { x: 0, y: 2.05, z: D - T.l / 2 - 0.05 });
    const flash = flasher(host), status = makeStatus("Coconuts");
    board.show(host.best);
    // Walls as segments [u0, v0, u1, v1]: the sides, the top, the shooter lane's wall, the slopes down to the
    // flippers' pivots. `GATE` slants over the lane's top from its wall up to the side: one way, so a launch passes up
    // through it and a coconut falling on it from the field slides off into the field, never onto the lane.
    // Each a `Float64Array` [u0, v0, u1, v1], so a collision reads its ends where they lie.
    const WALLS = [[-HW, -0.4, -HW, HL], [HW, -0.62, HW, HL], [-HW, HL, HW - 0.08, HL], [HW - 0.08, HL, HW, HL - 0.08],
      [HW - 0.06, -0.62, HW - 0.06, 0.36], [-HW, -0.4, -0.11, -0.52], [HW - 0.06, -0.4, 0.11, -0.52]].map((w) => Float64Array.from(w)), GATE = Float64Array.of(HW - 0.06, 0.36, HW, 0.44);
    // At rest the flippers' tips stand wide enough apart for a coconut to drain between them untouched. `FLIP` is the
    // face of the flipper being tested, laid each substep as it stands.
    const BUMPERS = [[-0.12, 0.28], [0.12, 0.28], [0, 0.12]], BR = 0.05, FL = T.flip, PIV = [[-0.11, -0.52], [0.11, -0.52]], FLIP = new Float64Array(4);
    const HIT = { x: 0, y: 0, z: 0 }, SEG = { k: 0, nu: 0, nv: 0 };
    // What the coconut in play has hit, for its bonus when it drains.
    const tally = { bumps: 0, teeth: 0, lanes: 0, ramps: 0 };
    // The numbers a frame or a substep moves, on one object so a write changes them in place (a double in a closure's
    // `let` is boxed afresh on every write, and so is one handed to a call the compiler does not inline, so the
    // collisions take their segment's array and read the coconut and `SEG` rather than numbers): `flip` the flip's
    // time left, `flipA` the flippers' swing (0 down, 1 up) and `downT` how long they have lain down, `acc` the time
    // not yet stepped, `impact` the coconut's speed into the last thing it hit, `saveT` its ball save's time left,
    // `skillT` how long a skill shot's arc may still reach its lane, `meterT` and `blink` the plunger's and the lights'
    // clocks, `teethT` the wait to stand the teeth again, `clickT` the walls' clicks kept from piling up, `grav` the
    // table's slope pull, `ballT` how long the coconut in play has been up and `rampT` how long the next ramp still
    // combos.
    const N = { flip: 0, flipA: 0, downT: 9, acc: 0, impact: 0, saveT: 0, skillT: 0, meterT: 0, blink: 0, teethT: 0, clickT: 0, grav: G, ballT: 0, rampT: 0 };
    // `B` is the coconut being stepped. `mult` multiplies every score for the coconut in play, `skill` is the lane a
    // skill shot aims at. `flips` counts the flips and `weak` marks the last one weak, `combo` the ramps in a row, `lit`
    // whether the ramp's combo is lit, `jack` whether its jackpot is (`bonks` bumpers relight it), `jackpots` this
    // multiball's.
    let B = balls[0];
    let phase = "idle", coconuts = 0, flips = 0, weak = false, mult = 1, multi = false, canSave = true;
    let skill = 0, launches = 0, combo = 0, jackpots = 0, bonks = 0, lit = true, jack = true;
    // Husk chips fly off the playfield at (u, v) when something there scores; a big moment cracks a coconut there.
    const chip = (u, v, big = false) => { AM.pinAt(u, v, HIT); out.crack(HIT.x, HIT.y + 0.04, HIT.z + D, big); };
    const toLocal = (n, u, v, lift) => { const p = AM.pinAt(u, v, n.position); p.z += D; p.y += lift; return p; };
    // A node that moves every frame onto the playfield at `o.u`, `o.v`, `o.lift` over it, as `AM.pinAt` lays it, the
    // numbers read where they lie. `RIDE` is where a coconut rides the ramp.
    const SIN = Math.sin(T.tilt), COS = Math.cos(T.tilt), FIELD_Y = T.y + 0.03, RIDE = { u: 0, v: 0, lift: 0 };
    const seat = (n, o) => { n.position.x = o.u; n.position.y = FIELD_Y + o.v * SIN + o.lift; n.position.z = D - o.v * COS; };
    // Whether the lights' triangle wave at `rate` a second stands above `over`.
    const blinking = (rate, over) => { const w = N.blink * rate, f = w - Math.floor(w); return (f < 0.5 ? f * 2 : 2 - f * 2) > over; };
    // Points as they stand; most scale with the multiplier and double in multiball (`add`).
    const score = (v) => { status.score += v; board.show(status.score); return v; };
    const add = (points) => score(points * mult * (multi ? 2 : 1));
    // The coconut off whatever `SEG` says it was pushed from: `rest` of its speed into it comes back, plus a `kick`.
    const bounce = (rest, kick) => {
      const nu = SEG.nu, nv = SEG.nv, dot = B.du * nu + B.dv * nv;
      N.impact = dot < 0 ? -dot : 0;
      if (dot < 0) { B.du -= (1 + rest) * dot * nu; B.dv -= (1 + rest) * dot * nv; }
      if (kick) { B.du += nu * kick; B.dv += nv * kick; }
    };
    // The coconut off a segment `s`: `SEG` keeps where along it (0 to 1) and which way it was pushed.
    const segment = (s, rest) => {
      const u0 = s[0], v0 = s[1], su = s[2] - u0, sv = s[3] - v0, l2 = su * su + sv * sv, k = Math.max(0, Math.min(1, ((B.u - u0) * su + (B.v - v0) * sv) / l2));
      const cu = u0 + su * k, cv = v0 + sv * k, du = B.u - cu, dv = B.v - cv, d = Math.sqrt(du * du + dv * dv);
      if (d >= R + 0.012 || d < 1e-7) return false;
      const nu = du / d, nv = dv / d;
      B.u = cu + nu * (R + 0.012); B.v = cv + nv * (R + 0.012);
      SEG.k = k; SEG.nu = nu; SEG.nv = nv;
      bounce(rest, 0);
      return true;
    };
    // A coconut into the shooter lane; `serve` waits there for the plunger, its meter swinging and the skill lane (the
    // next one not lit) blinking.
    const toLane = (b) => { b.u = b.su = HW - 0.03; b.v = b.sv = -0.55; b.du = b.dv = b.stuck = 0; b.on = true; b.launched = b.fresh = b.arc = false; b.ramp = -1; };
    const serve = (b) => {
      toLane(b);
      for (let i = 0; i < lanes.length; i++) if (!lanes[i].lit) lanes[i].node.geometry = LIT[0];
      skill = launches % 3;
      while (lanes[skill].lit) skill = (skill + 1) % 3;
      N.meterT = 0; status.meter = 0; status.window0 = 0.72; status.window1 = 0.86; status.verb = "Launch!";
    };
    // The plunger lets go as hard as the meter stood; in its window, the coconut is armed for the skill shot.
    const launch = (b) => {
      const p = status.meter;
      b.launched = true; b.fresh = true; b.dv = 2.9 + 1.2 * p; launches++;
      N.skillT = p >= status.window0 && p <= status.window1 ? 1.2 : 0;
      N.saveT = canSave ? SAVE - 0.5 * (status.round - 1) : 0;
      status.verb = "Flip!"; status.meter = -1;
      out.cue(N.skillT ? "lock" : "whirr");
    };
    const allLanes = () => {
      const v = add(1000);
      tally.lanes++; relight();
      for (let j = 0; j < lanes.length; j++) { lanes[j].lit = false; lanes[j].node.geometry = LIT[0]; }
      mult = Math.min(3, mult + 1); status.mult = mult; status.fire = true;
      out.popup(PIN_SAY.lanes[mult - 2](v), true); out.cue("big"); flash.hit(2.5);
      host.burst(0, T.y + 0.3, D - 0.4, 20); out.crack(0, T.y + 0.3, D - 0.4, true);
    };
    // A second coconut out of the shooter lane, every score doubled until one of the two drains, the ramp lit for the
    // jackpot.
    const startMulti = () => {
      multi = true; status.fire = true; jackpots = bonks = 0; jack = true;
      const b = balls[0].on ? balls[1] : balls[0];
      toLane(b); b.launched = true; b.fresh = true; b.dv = 3.6;
      out.popup("MAMMOTH MULTIBALL!", true); out.cue("fire"); out.shake(0.5); flash.hit(3);
      host.burst(0, T.y + 0.3, D, 24); chip(0, 0.2, true);
    };
    const knock = (k) => {
      k.up = false; tally.teeth++; relight();
      const v = add(500);
      out.cue("knock"); flash.hit(1.2);
      let standing = 0;
      for (let i = 0; i < teeth.length; i++) if (teeth[i].up) standing++;
      if (standing) { chip(TEETH_U, k.v); out.popup(PIN_SAY.tooth(v), false); }
      else startMulti();
    };
    // Up the ramp: while lit, 750 a ramp in the combo, and the fifth in a row is the stampede, which puts it out; in
    // multiball the lit jackpot. Unlit it pays 250.
    const rampIn = (sp) => {
      B.ramp = 0; B.rs = Math.max(1.4, Math.min(2.2, sp * 0.75)); B.fresh = false; B.eu = B.u - RAMP[0][0]; B.ev = B.v - RAMP[0][1]; tally.ramps++;
      if (multi && jack) {
        const v = score((PIN_JACKPOT + 2500 * jackpots) * mult);
        jackpots++; jack = false; bonks = 0;
        out.popup(PIN_SAY.jackpot(v), true); out.cue("fire"); out.shake(0.45); flash.hit(3); chip(RAMP[3][0], RAMP[3][1], true);
      } else if (!multi && lit) {
        combo = N.rampT > 0 ? combo + 1 : 1; status.streak = combo;
        if (combo >= PIN_STAMPEDE) {
          const v = add(PIN_RAMP * combo) + score(PIN_JACKPOT * mult);
          lit = false; combo = status.streak = 0;
          out.popup(PIN_SAY.stampede(v), true); out.cue("fire"); out.shake(0.5); flash.hit(3); chip(RAMP[3][0], RAMP[3][1], true);
        } else {
          const v = add(PIN_RAMP * combo);
          out.popup(combo > 1 ? PIN_SAY.combo[combo - 2](v) : PIN_SAY.ramp(v), combo > 1); out.cue(combo > 1 ? "big" : "whirr");
          flash.hit(combo > 1 ? 2.2 : 1.4); chip(RAMP[2][0], RAMP[2][1], combo > 2);
        }
      } else { add(250); out.cue("whirr"); chip(RAMP[2][0], RAMP[2][1]); }
      N.rampT = 0;
    };
    // A knocked tooth or a set of lanes lights the ramp again after a stampede.
    const relight = () => { if (!lit) { lit = true; out.cue("chirp"); } };
    const drain = (b) => {
      b.on = false;
      if (multi) { multi = false; N.teethT = 1.5; status.fire = mult > 2; out.cue("thunk"); out.popup("Multiball over", false); return; }
      if (N.saveT > 0) { N.saveT = 0; canSave = false; serve(b); out.popup("Ooga save! Go again", true); out.cue("chirp"); return; }
      // The coconut's bonus, counted up by the multiplier it earned.
      const bonus = score((tally.bumps * PIN_BONUS.bumps + tally.teeth * PIN_BONUS.teeth + tally.lanes * PIN_BONUS.lanes + tally.ramps * PIN_BONUS.ramps) * mult);
      tally.bumps = tally.teeth = tally.lanes = tally.ramps = 0;
      coconuts--; mult = 1; canSave = true; N.ballT = 0; combo = 0; N.rampT = 0; lit = true;
      status.left = coconuts; status.streak = 0; status.mult = 1; status.fire = false;
      out.cue(bonus ? "tally" : "buzzer"); out.flop();
      out.popup(PIN_SAY.bonus(bonus), bonus >= 3000);
      if (coconuts > 0) { status.round = 4 - coconuts; serve(b); }
      else { phase = "idle"; status.verb = ""; status.meter = -1; host.onEnd(status.score); }
    };
    // One coconut's substep.
    const roll = (h) => {
      if (B.ramp >= 0) {
        // Round the tusk at its own pace, then out onto the left inlane, the combo's clock running.
        B.ramp += B.rs * h;
        if (B.ramp >= RAMP_LEN) { const e = RAMP[RAMP.length - 1]; B.ramp = -1; B.u = e[0]; B.v = e[1]; B.du = 0.15 + 0.1 * B.rs; B.dv = -0.25 - 0.2 * B.rs; N.rampT = PIN_COMBO; out.cue("thunk"); }
        return;
      }
      B.dv -= N.grav * h;
      B.u += B.du * h; B.v += B.dv * h;
      const sp = Math.sqrt(B.du * B.du + B.dv * B.dv);
      if (sp > 5) { B.du *= 5 / sp; B.dv *= 5 / sp; }
      // Out of the shooter lane over the top, into the field; an armed skill shot arcs up to crest in its lane, and
      // on its way over lights no other.
      if (B.arc && B.dv <= 0) B.arc = false;
      if (B.u > HW - 0.06 && B.v > 0.4 && B.dv > 0 && !B.arc) {
        if (B.fresh && N.skillT > 0) { const up = Math.sqrt(2 * N.grav * Math.max(0.01, HL - 0.07 - B.v)); B.du = (lanes[skill].u - B.u) * N.grav / up; B.dv = up; B.arc = true; }
        else { B.du = -Math.abs(B.dv) * 0.8; B.dv = -0.2; }
        B.fresh = false;
      }
      for (let i = 0; i < WALLS.length; i++) if (segment(WALLS[i], 0.55) && N.impact > 0.35 && N.clickT <= 0) { out.cue("click"); N.clickT = 0.06; }
      if ((B.v - GATE[1]) * (GATE[2] - GATE[0]) > (B.u - GATE[0]) * (GATE[3] - GATE[1])) segment(GATE, 0.3);
      // Up into the ramp's mouth: fast enough and it rides the tusk; too slow and it rolls back out.
      if (B.dv > 0 && B.u > RAMP_U0 && B.u < RAMP_U1 && B.v > RAMP_V && B.v - B.dv * h <= RAMP_V) {
        const up = Math.sqrt(B.du * B.du + B.dv * B.dv);
        if (up >= RAMP_MIN) { rampIn(up); return; }
        B.dv = -B.dv * 0.4;
        if (N.clickT <= 0) { out.cue("click"); N.clickT = 0.06; }
      }
      for (let i = 0; i < BUMPERS.length; i++) {
        const bu = BUMPERS[i][0], bv = BUMPERS[i][1], du = B.u - bu, dv = B.v - bv, d = Math.sqrt(du * du + dv * dv);
        if (d < BR + R && d > 1e-6) {
          const nu = du / d, nv = dv / d;
          B.u = bu + nu * (BR + R); B.v = bv + nv * (BR + R);
          SEG.nu = nu; SEG.nv = nv;
          bounce(0.6, 1.2);
          add(100); tally.bumps++; flash.hit(1); out.cue("ding"); chip(bu, bv);
          if (multi && !jack && ++bonks >= 2) { jack = true; out.cue("chirp"); }
        }
      }
      for (let i = 0; i < teeth.length; i++) { const k = teeth[i]; if (k.up && segment(k.seg, 0.45) && N.impact > 0.4) knock(k); }
      for (let i = 0; i < 2; i++) {
        const s = i ? -1 : 1, pu = PIV[i][0], pv = PIV[i][1], a = -0.5 + N.flipA * 0.95, ca = Math.cos(a), sa = Math.sin(a);
        FLIP[0] = pu; FLIP[1] = pv; FLIP[2] = pu + s * ca * FL; FLIP[3] = pv + sa * FL;
        if (!segment(FLIP, 0.3)) continue;
        // Struck from above as the flipper swings up, once a flip: off its face as it stands (`-a` from straight up
        // toward the far side), harder and turned further across the nearer the tip; a weak flip, softer.
        if (N.flip > 0 && N.flipA < 1 && B.kick !== flips && SEG.nv * ca - SEG.nu * s * sa > 0.5) {
          const turn = -a + SHOT_TURN * (SEG.k - 0.4), speed = (SHOT + SHOT_TIP * SEG.k) * (weak ? WEAK : 1);
          B.kick = flips; B.du = s * Math.sin(turn) * speed; B.dv = Math.cos(turn) * speed;
        }
        if (N.flip > 0 && N.clickT <= 0) { out.cue("clack"); N.clickT = 0.06; }
      }
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes[i];
        if (l.lit || (B.arc && i !== skill) || Math.abs(B.u - l.u) >= 0.03 || B.v <= HL - 0.12 || B.v >= HL - 0.04) continue;
        l.lit = true; l.node.geometry = LIT[1]; tally.lanes++;
        if (i === skill && N.skillT > 0) { N.skillT = 0; const v = add(1000); flash.hit(2); out.cue("big"); out.popup(PIN_SAY.skill(v), true); chip(l.u, HL - 0.08, true); }
        else { add(250); out.cue("score"); chip(l.u, HL - 0.08); }
        if (lanes[0].lit && lanes[1].lit && lanes[2].lit) allLanes();
      }
      // A coconut sitting still `STUCK` seconds (wedged on a tooth's end, or held on a flipper kept up) is shaken
      // loose, out toward the middle, so no game can stall.
      const su = B.u - B.su, sv = B.v - B.sv;
      if (su * su + sv * sv > 0.0001) { B.su = B.u; B.sv = B.v; B.stuck = 0; }
      else if ((B.stuck += h) > STUCK) { B.stuck = 0; B.du = B.u < 0 ? 0.8 : -0.8; B.dv = 1.2; out.cue("thunk"); out.shake(0.2); out.popup("Ooga shake!", false); }
      if (B.v < -HL - 0.02) drain(B);
    };
    const step = (h) => {
      for (let i = 0; i < balls.length && phase === "play"; i++) { B = balls[i]; if (B.on && B.launched) roll(h); }
      // Two coconuts on the field knock off each other, equal masses.
      const a = balls[0], b = balls[1];
      if (!(a.on && b.on && a.launched && b.launched) || a.ramp >= 0 || b.ramp >= 0) return;
      const du = b.u - a.u, dv = b.v - a.v, d = Math.sqrt(du * du + dv * dv);
      if (d >= 2 * R || d < 1e-6) return;
      const nu = du / d, nv = dv / d, push = (2 * R - d) / 2, rel = (a.du - b.du) * nu + (a.dv - b.dv) * nv;
      a.u -= nu * push; a.v -= nv * push; b.u += nu * push; b.v += nv * push;
      if (rel > 0) { a.du -= rel * nu; a.dv -= rel * nv; b.du += rel * nu; b.dv += rel * nv; }
    };
    // Where along the ramp's path a riding coconut is: straight between its points.
    const onRamp = (b) => {
      let i = 0;
      while (i < RAMP.length - 2 && RAMP_AT[i + 1] < b.ramp) i++;
      const p = RAMP[i], q = RAMP[i + 1], k = Math.min(1, (b.ramp - RAMP_AT[i]) / (RAMP_AT[i + 1] - RAMP_AT[i]));
      // Where it came in across the flared mouth eases onto the channel's middle over its first stretch.
      const e = Math.max(0, 1 - b.ramp / 0.12);
      RIDE.u = p[0] + (q[0] - p[0]) * k + b.eu * e; RIDE.v = p[1] + (q[1] - p[1]) * k + b.ev * e; RIDE.lift = R + 0.012 + p[2] + (q[2] - p[2]) * k;
      seat(b.node, RIDE);
    };
    // Per frame: the coconuts, the flippers' swing and the teeth sinking or standing; the rest never moves.
    const pose = () => {
      for (let i = 0; i < balls.length; i++) { const b = balls[i]; b.node.visible = b.on; if (b.on) { if (b.ramp >= 0) onRamp(b); else seat(b.node, b); } }
      const a = -0.5 + N.flipA * 0.95;
      flippers[0].rotation.y = a; flippers[1].rotation.y = Math.PI - a;
      for (let i = 0; i < teeth.length; i++) { const k = teeth[i]; k.lift = -0.045 * k.drop; seat(k.node, k); k.node.visible = k.drop < 1; }
    };
    // At rest: the teeth standing, the lanes cold, the ramp waiting, no coconut out.
    const rest = () => {
      for (let i = 0; i < lanes.length; i++) { lanes[i].lit = false; lanes[i].node.geometry = LIT[0]; }
      for (let i = 0; i < teeth.length; i++) { teeth[i].up = true; teeth[i].drop = 0; }
      mult = 1; multi = weak = false; N.skillT = N.saveT = N.teethT = N.ballT = N.rampT = N.flip = N.flipA = 0; N.downT = 9; combo = jackpots = bonks = launches = 0; canSave = true; N.grav = G; lit = jack = true;
      tally.bumps = tally.teeth = tally.lanes = tally.ramps = 0;
      toLane(balls[0]); balls[0].on = balls[1].on = false; balls[1].ramp = -1;
      arrow.geometry = LIT[0];
      status.streak = 0; status.mult = 1; status.fire = false; status.meter = -1; status.verb = "";
    };
    // The flippers, the lanes, the teeth's tilt and the ramp's ember are laid once.
    for (let i = 0; i < 2; i++) { toLocal(flippers[i], PIV[i][0], PIV[i][1], 0.012); flippers[i].rotation.x = T.tilt; }
    for (let i = 0; i < lanes.length; i++) toLocal(lanes[i].node, lanes[i].u, HL - 0.08, 0.004);
    for (let i = 0; i < teeth.length; i++) teeth[i].node.rotation.x = T.tilt;
    rest(); pose();
    toLocal(arrow, (RAMP_U0 + RAMP_U1) / 2 - 0.01, RAMP_V - 0.06, 0.004);
    // The hall's show while nobody plays: the top lanes chase, the ramp's ember blinks, a flipper twitches now and then,
    // and a `tease` flips both with every lane lit; k 0 lays the table at rest.
    const I = { t: 0, l: 9, r: 9, next: 1.5, all: 0 };
    const twitch = (s) => s < 0.07 ? s / 0.07 : Math.max(0, 1 - (s - 0.07) * 7);
    const attract = (dt, k) => {
      if (k <= 0) {
        I.l = I.r = 9; I.all = 0; flippers[0].rotation.y = -0.5; flippers[1].rotation.y = Math.PI + 0.5; arrow.geometry = LIT[0];
        for (let i = 0; i < lanes.length; i++) lanes[i].node.geometry = LIT[lanes[i].lit ? 1 : 0];
        return;
      }
      I.t += dt; I.l += dt; I.r += dt; I.all = Math.max(0, I.all - dt);
      if ((I.next -= dt) <= 0) { I.next = 1.2 + Math.random() * 2.5; if (Math.random() < 0.5) I.l = 0; else I.r = 0; }
      const on = Math.floor(I.t * 2.5) % 3, w = I.t * 0.9, f = w - Math.floor(w);
      for (let i = 0; i < lanes.length; i++) lanes[i].node.geometry = LIT[I.all > 0 || i === on ? 1 : 0];
      arrow.geometry = LIT[(f < 0.5 ? f * 2 : 2 - f * 2) > 0.65 ? 1 : 0];
      flippers[0].rotation.y = -0.5 + twitch(I.l) * 0.95 * k;
      flippers[1].rotation.y = Math.PI + 0.5 - twitch(I.r) * 0.95 * k;
    };
    const tease = () => { I.l = I.r = 0; I.all = 0.9; out.cue("flip"); };
    return {
      kind: "pinball", name: "Pinball", help: "Space or tap launches, green for a skill shot, then flips: flip late to shoot across. Ramps in a row combo; teeth start multiball.",
      stars: [20000, 40000, 130000], tickets: (score) => Math.min(60, Math.floor(score / 2500)), status, attract, tease,
      get playing() { return phase !== "idle"; },
      start: () => { rest(); coconuts = 3; status.score = 0; status.left = 3; status.round = 1; status.target = 0; board.show(0); phase = "play"; serve(balls[0]); },
      stop: () => { phase = "idle"; rest(); board.show(host.best); pose(); },
      act: () => {
        if (phase !== "play") return;
        for (let i = 0; i < balls.length; i++) if (balls[i].on && !balls[i].launched) { launch(balls[i]); return; }
        if (N.flip <= 0) { flips++; weak = N.downT < RECHARGE; }
        N.flip = 0.25; out.cue(weak ? "click" : "flip");
      },
      update: (dt) => {
        flash.update(dt);
        if (phase === "idle") return;
        N.clickT -= dt; N.blink += dt; N.skillT = Math.max(0, N.skillT - dt); N.saveT = Math.max(0, N.saveT - dt);
        N.flip = Math.max(0, N.flip - dt);
        N.flipA = N.flip > 0 ? Math.min(1, N.flipA + dt * (weak ? 7 : 14)) : Math.max(0, N.flipA - dt * 8);
        N.downT = N.flipA > 0 ? 0 : N.downT + dt;
        let waiting = false;
        for (let i = 0; i < balls.length; i++) if (balls[i].on && !balls[i].launched) waiting = true;
        if (waiting) { N.meterT += dt; const w = N.meterT * 0.8, f = w - Math.floor(w); status.meter = f < 0.5 ? f * 2 : 2 - f * 2; }
        // The table quickens: 12% a coconut, and a little more the longer one stays up.
        else N.ballT += dt;
        N.grav = G * (1 + 0.12 * (status.round - 1) + 0.004 * N.ballT);
        const lane = lanes[skill];
        if (!lane.lit) lane.node.geometry = LIT[(waiting || N.skillT > 0) && blinking(3, 0.5) ? 1 : 0];
        // The combo's clock, and the ember at the ramp's mouth that shows it.
        if (N.rampT > 0 && (N.rampT -= dt) <= 0) { combo = 0; status.streak = 0; }
        arrow.geometry = LIT[(multi ? jack : lit && (N.rampT > 0 ? blinking(4, 0.5) : blinking(0.9, 0.65))) ? 1 : 0];
        N.acc += Math.min(dt, 0.05);
        while (N.acc >= 1 / 240) { N.acc -= 1 / 240; if (phase === "play") step(1 / 240); }
        // Knocked teeth sink; they stand again together once the field beside them is clear.
        if (N.teethT > 0 && (N.teethT -= dt) <= 0) {
          let clear = true;
          for (let i = 0; i < balls.length; i++) { const b = balls[i]; if (b.on && b.u < TEETH_U + 0.07 && b.v > -0.2 && b.v < 0.09) clear = false; }
          if (clear) { for (let i = 0; i < teeth.length; i++) teeth[i].up = true; out.cue("clack"); } else N.teethT = 0.2;
        }
        for (let i = 0; i < teeth.length; i++) { const k = teeth[i]; k.drop = k.up ? Math.max(0, k.drop - dt * 6) : Math.min(1, k.drop + dt * 9); }
        pose();
      }
    };
  };

  // ---- the beast rides ------------------------------------------------------------------------------------
  // Ride to the beast's own drum. The song is five phrases of two bars, eight steps a bar with a note on some of
  // them, each phrase busier than the last and a little quicker: the silverback thumps slow and heavy on the beat,
  // the monkey dashes quick and off it, the dino stomps in pairs, the baby mammoth marches left, right on the hand
  // drum's two skins. A bamboo beat pole drops in front of the ride as it
  // starts, a golden coconut in a cup for each note of the bar, the next one swelling as its moment comes; the meter
  // is the same bar, its green on the next note. The beast rears up before every note and slams down on it, and
  // sounds it. Act on a note: dead on is perfect (3), near it good (1), and the ride bucks; a tap with no note
  // under it, or a note let pass, breaks the streak, and a tap up to `RIDE_EARLY` s too soon spends its note as a
  // miss, so tapping all the time pays nothing (taps in the lead-in before the first note are let be). Eight in a row
  // doubles each note, sixteen triples it and sets the beast on fire, twenty-four quadruples it; a phrase without a
  // miss is a roar bonus. The rocker is the game's own node (`rocker`, which a host may seat a rider on); the pole
  // shows only while a ride is on.
  const RIDE_PERFECT = 0.045, RIDE_GOOD = 0.1, RIDE_EARLY = 0.25, RIDE_LEAD = 5, RIDE_PHRASES = 5, RIDE_BARS = RIDE_PHRASES * 2, RIDE_NOTES = RIDE_BARS * 8;
  // Each beast: its name, tempo (beats a minute, two steps a beat) and its climb a phrase, the sound it makes on a
  // note, and a bar for each phrase ("x" a note).
  const RIDE_BEASTS = [
    { name: "Silverback Thump", bpm: 94, climb: 5, voice: "knock", bars: ["x...x...", "x...x.x.", "x.x.x.x.", "x.x.xxx.", "xx.xx.xx"] },
    { name: "Monkey Dash", bpm: 118, climb: 5, voice: "bonk", bars: ["x.x.x.x.", "x..x..x.", ".x.x.x.x", "x.xx.xx.", "xx.x.xxx"] },
    { name: "Dino Stomp", bpm: 104, climb: 5, voice: "thunk", bars: ["x...x...", "xx..xx..", "x..xx..x", "xx.xxx..", "x.xxx.xx"] },
    { name: "Mammoth March", bpm: 100, climb: 5, voice: "tap", bars: ["x.x.x...", "x.x.x.x.", "x.x.xx..", "x.xx.xx.", "xx.xxx.x"] }
  ].map((b) => ({ ...b, masks: b.bars.map((s) => [...s].reduce((m, c, k) => c === "x" ? m | 1 << k : m, 0)) }));
  // What the ride says, built once: a hit at each multiplier, the streak's steps, each phrase's roar and start.
  const RIDE_SAY = {
    perfect: [0, 1, 2, 3, 4].map((m) => `Perfect! +${3 * m}`), good: [0, 1, 2, 3, 4].map((m) => `Good +${m}`),
    streak: ["", "Streak! Double!", "On fire! Triple!", "OOGA! Quadruple!"], off: "Off the beat!", missed: "Whoa... missed",
    roar: Array.from({ length: RIDE_PHRASES }, (_, p) => `Clean phrase! ROAR +${10 + p * 5}`),
    phrase: Array.from({ length: RIDE_PHRASES }, (_, p) => p === RIDE_PHRASES - 1 ? "Last phrase! Go wild!" : `Phrase ${p + 1} · faster!`)
  };
  const rideGame = (host) => {
    const i = host.index || 0, g = host.node, out = hooks(host), BEAST = RIDE_BEASTS[i], S = AM.RIDE_BEAT.step, POLE = { y: 1.74, z: 1.6 }, PIP = 0.72;
    const rocker = createNode({ position: { x: 0, y: AM.RIDE_Y, z: 0 }, geometry: AM.ride(i).body });
    // The pole's cups run from the rider's left to right: the view looks along +z, so that is +x to -x.
    const pole = createNode({ position: { x: 0, y: POLE.y, z: POLE.z }, geometry: AM.rideBeat(), visible: false, sightHidden: true });
    const pips = [], pop = new Float32Array(8), mark = new Int8Array(8);
    for (let k = 0; k < 8; k++) pips.push(createNode({ position: { x: (3.5 - k) * S, y: -0.02, z: 0 }, geometry: AM.coconut(1), scale: { x: PIP, y: PIP, z: PIP }, visible: false, sightHidden: true }));
    addChild(pole, ...pips);
    addChild(g, rocker, pole);
    const flash = flasher(host), status = makeStatus("Notes");
    // The song, laid once for the beast: each note's time, bar and step; each bar's start and step length; the first
    // note of each phrase after it.
    const noteT = new Float64Array(RIDE_NOTES), noteBar = new Uint8Array(RIDE_NOTES), noteStep = new Uint8Array(RIDE_NOTES);
    const barT = new Float64Array(RIDE_BARS + 1), barStep = new Float64Array(RIDE_BARS), phraseEnd = new Uint16Array(RIDE_PHRASES);
    let count = 0;
    for (let b = 0, at = 0; b < RIDE_BARS; b++) {
      const p = b >> 1, step = 30 / (BEAST.bpm + p * BEAST.climb), mask = BEAST.masks[p];
      barT[b] = at; barStep[b] = step;
      for (let k = 0; k < 8; k++) if (mask >> k & 1) { noteT[count] = at + k * step; noteBar[count] = b; noteStep[count] = k; count++; }
      at += step * 8;
      barT[b + 1] = at;
      if (b & 1) phraseEnd[p] = count;
    }
    let phase = "idle", next = 0, voiced = 0, bar = -1, streak = 0, phrase = 0, clean = true, side = 1;
    // The running values, fields of one object so that writing one each frame never boxes a number: the song's clock,
    // the last note sounded, the pole's drop, the buck of your hits, the idle rock's clock, and the pose's rear and slam.
    const V = { t: 0, lastNote: -9, poleT: 1, buck: 0, idleT: 0, rear: 0, slam: 0 };
    // The bar on the pole: a coconut in each note's cup. A new phrase is called small, so the pole stays readable.
    const showBar = (b) => {
      bar = b; status.round = (b >> 1) + 1;
      const mask = BEAST.masks[b >> 1];
      for (let k = 0; k < 8; k++) { const p = pips[k]; p.visible = (mask >> k & 1) === 1; p.position.y = -0.02; p.scale.x = p.scale.y = p.scale.z = PIP; mark[k] = 0; pop[k] = 0; }
      if (b > 0 && !(b & 1)) { out.popup(RIDE_SAY.phrase[b >> 1], false); out.cue("round"); }
    };
    // A note judged: 2 perfect, 1 good, -1 missed; its golden coconut pops and is gone, or shrinks into its cup.
    const judge = (n, how) => {
      if (noteBar[n] === bar) { const k = noteStep[n]; mark[k] = how; pop[k] = 1; }
      next = n + 1;
      status.left = count - next;
      // A phrase whose notes are all judged: clean pays its roar.
      while (phrase < RIDE_PHRASES && next >= phraseEnd[phrase]) {
        if (clean) {
          const bonus = 10 + phrase * 5;
          status.score += bonus; flash.hit(2.4); out.cue("big"); out.shake(0.45); out.popup(RIDE_SAY.roar[phrase], true);
          out.crack(0, 1.45, 1.15, true);
        }
        phrase++; clean = true;
      }
    };
    const broke = () => { streak = 0; status.streak = 0; status.fire = false; clean = false; };
    // The beast's body on the beat: it rears as a note comes (`V.rear`, 0 to 1 over the lead-in) and slams on it
    // (`V.slam`, 1 on the note, dying away), each in its own way; your hits buck it on top.
    const pose = () => {
      const rear = V.rear, slam = V.slam, buck = V.buck, t = V.t, kick = buck * Math.sin(t * 31) * 0.05;
      if (i === 0) {
        rocker.rotation.x = -rear * 0.13 + slam * 0.2 + kick; rocker.rotation.z = Math.sin(t * 1.7) * 0.02 + buck * 0.03;
        rocker.position.y = AM.RIDE_Y + rear * 0.035 - slam * 0.02;
      } else if (i === 1) {
        rocker.rotation.z = side * (rear * 0.09 - slam * 0.13) + kick; rocker.rotation.x = slam * 0.07 - rear * 0.03;
        rocker.position.y = AM.RIDE_Y + rear * 0.07 - slam * 0.02;
      } else {
        rocker.rotation.x = -rear * 0.07 + slam * 0.11 + kick; rocker.rotation.z = Math.sin(t * 1.1) * 0.03;
        rocker.position.y = AM.RIDE_Y + rear * 0.09 - slam * 0.055;
      }
    };
    // The hall's show while nobody plays, over the idle rock: now and then (`tease`) the beast dances a bar of its third
    // phrase to its own drum, rearing before each note and slamming down on it; k 0 stops it.
    const I = { t: -1, n: 0, last: -9 };
    const attract = (dt, k) => {
      if (I.t < 0) return;
      if (k <= 0) { I.t = -1; return; }
      const step = barStep[4], mask = BEAST.masks[2];
      I.t += dt;
      while (I.n < 8 && I.t >= I.n * step) { if (mask >> I.n & 1) { I.last = I.n * step; side = -side; out.cue(BEAST.voice); } I.n++; }
      let next = 9;
      for (let s = I.n; s < 8; s++) if (mask >> s & 1) { next = s * step; break; }
      V.t = I.t; V.rear = ease(Math.max(0, Math.min(1, 1 - (next - I.t) / Math.min(0.32, step * 1.5)))); V.slam = Math.exp(-(I.t - I.last) * 9);
      pose();
      if (I.t > 8 * step + 0.3) I.t = -1;
    };
    const tease = () => { if (I.t < 0) { I.t = 0; I.n = 0; I.last = -9; } };
    return {
      kind: "ride", name: BEAST.name, help: "Space or tap as the bone crosses a coconut, in the green. Keep the streak going.",
      stars: [60, 160, 340], tickets: (score) => Math.floor(score / 10), status, attract, tease, rocker,
      get playing() { return phase !== "idle"; },
      start: () => {
        phase = "play"; V.t = -RIDE_LEAD * barStep[0]; next = voiced = 0; bar = -1; streak = 0; phrase = 0; clean = true; V.lastNote = -9; V.buck = 0;
        status.score = 0; status.streak = 0; status.fire = false; status.left = count; status.round = 1; status.target = 0; status.verb = "Bump!";
        pole.visible = true; V.poleT = 0; pole.position.y = POLE.y + 1.6;
        showBar(0);
      },
      stop: () => { phase = "idle"; status.meter = -1; status.verb = ""; pole.visible = false; rocker.rotation.x = rocker.rotation.z = 0; rocker.position.y = AM.RIDE_Y; },
      act: () => {
        if (phase !== "play" || next >= count) return;
        const e = V.t - noteT[next];
        if (next === 0 && e < -RIDE_EARLY) return;
        if (Math.abs(e) > RIDE_GOOD) {
          broke(); out.cue("miss"); out.flop(); out.popup(RIDE_SAY.off, false);
          if (e < 0 && e > -RIDE_EARLY) judge(next, -1);
          return;
        }
        const perfect = Math.abs(e) <= RIDE_PERFECT;
        streak++; status.streak = streak; status.fire = streak >= 16;
        const mult = 1 + Math.min(3, Math.floor(streak / 8)), pts = (perfect ? 3 : 1) * mult;
        status.score += pts;
        V.buck = Math.min(1, V.buck + (perfect ? 0.55 : 0.3)); flash.hit(perfect ? 1.6 : 0.8);
        out.cue(perfect ? "score" : "click");
        // Each eighth in a row steps the multiplier and cracks a coconut on the beast's nose; a perfect throws husk.
        if (streak % 8 === 0 && streak <= 24) { out.popup(RIDE_SAY.streak[streak / 8], true); out.cue(streak === 16 ? "fire" : "big"); out.crack(0, 1.45, 1.15, true); }
        else { out.popup(perfect ? RIDE_SAY.perfect[mult] : RIDE_SAY.good[mult], false); if (perfect) out.crack(0, 1.45, 1.15, false); }
        judge(next, perfect ? 2 : 1);
      },
      update: (dt) => {
        flash.update(dt);
        V.buck = Math.max(0, V.buck - dt * 1.8);
        if (phase === "idle") {
          V.idleT += dt;
          rocker.rotation.x = Math.sin(V.idleT * 3) * 0.04; rocker.rotation.z = 0; rocker.position.y = AM.RIDE_Y;
          return;
        }
        const t = V.t += dt;
        // The pole drops in on its lianas.
        if (V.poleT < 1) { V.poleT = Math.min(1, V.poleT + dt / 0.5); pole.position.y = POLE.y + (1 - ease(V.poleT)) * 1.6; }
        // The beast sounds each note as it comes; a note let pass is a miss.
        while (voiced < count && t >= noteT[voiced]) { V.lastNote = noteT[voiced]; side = -side; out.cue(BEAST.voice); voiced++; }
        while (next < count && t > noteT[next] + RIDE_GOOD) { broke(); out.flop(); out.popup(RIDE_SAY.missed, false); judge(next, -1); }
        // The bar shown, each step's cell centred on its note so a note's green never runs off the bar's ends.
        let b = Math.max(0, bar);
        while (b < RIDE_BARS - 1 && t >= barT[b + 1] - barStep[b + 1] / 2) b++;
        if (b !== bar) showBar(b);
        const step = barStep[bar], p = ((t - barT[bar]) / step + 0.5) / 8, m = p < 0 ? Math.max(0, p + 1) : Math.min(1, p);
        status.meter = m;
        if (next < count) {
          const c = (noteStep[next] + 0.5) / 8, w = RIDE_GOOD / barStep[noteBar[next]] / 8;
          status.window0 = c - w; status.window1 = c + w;
        }
        for (let k = 0; k < 8; k++) {
          if (!mark[k]) continue;
          const pip = pips[k];
          pop[k] = Math.max(0, pop[k] - dt * 3.5);
          const f = pop[k], s = mark[k] > 0 ? PIP * (f > 0.5 ? 1 + (1 - f) * (mark[k] > 1 ? 1.2 : 0.7) : f * 2 * (mark[k] > 1 ? 1.6 : 1.35)) : PIP * (0.5 + f * 0.5);
          pip.scale.x = pip.scale.y = pip.scale.z = s;
          pip.visible = mark[k] < 0 || f > 0;
          if (mark[k] < 0) pip.position.y = -0.02 - (1 - f) * 0.035;
        }
        // The next note's coconut swells as its moment comes.
        if (next < count && noteBar[next] === bar) {
          const pip = pips[noteStep[next]], near = 1 - Math.min(1, Math.max(0, (noteT[next] - t) / 0.45));
          pip.scale.x = pip.scale.y = pip.scale.z = PIP * (1 + near * near * 0.45);
        }
        const lead = Math.min(0.32, barStep[bar] * 1.5), toNext = voiced < count ? noteT[voiced] - t : 9;
        V.rear = ease(Math.max(0, Math.min(1, 1 - toNext / lead))); V.slam = Math.exp(-(t - V.lastNote) * 9);
        pose();
        if (next >= count && t > barT[RIDE_BARS]) { phase = "idle"; status.meter = -1; status.verb = ""; host.onEnd(status.score); }
      }
    };
  };

  BL.arcadeGames = { skeeball, hoopShot, coconutShy, clawGame, airHockey, poolGame, dartsGame, pinballGame, rideGame, scoreboard };
})();
