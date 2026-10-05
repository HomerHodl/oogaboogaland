// Ooga Arcade's carnival games as games of their own: skee-ball (`skee`), hoop shot (`hoops`), the coconut shy
// (`shy`) and the claw machine (`claw`), each a scene reached from its machine in the arcade and leaving back to it. They share one presentation:
// the arcade hall around the machine, a camera that dollies in from wide to the player's eye through a 3-2-1
// countdown and shakes on the big moments, a mobile-first HUD (score and best, what is left and the round, the
// power meter with its green window, big callouts, one thumb-sized action button), a pause card on Escape, and a
// results card with stars, the best, and the tickets won for the prize counter.
//
// The rules live in `arcade-games.js`; this module stages them, reads their `status` for the HUD (written only
// when a value changes) and records bests and tickets at the end. The mezzanine's eight retro cabinets are staged
// the same way (`retro-games.js`): the machine is the cabinet, the game's own screen is drawn over its glass, and it
// sounds through the cabinet's chip, its cues by `CHIP_CUES` and its tune from Go until the game decides the run,
// halted on pause.
//
// The HUD around every game is the same: the score rolls up to each new value with a pop (down, with a shake, on a
// penalty); under it a goal bar fills toward the game's three star thresholds (`stars`) and lights each star as the
// score passes it; passing the best the run started with is its own moment (a NEW BEST ribbon, the tusk horn, the
// watchers cheering, and the Best box following the score); a streak of two or more shows as "N in a row", with the
// multiplier when a game sets an optional `status.mult`; the first run of each game in a page visit shows one
// coaching line under the meter; and the results tally the score up, lighting each star as it passes, with the
// optional `status.note` (a breakdown the game writes) under the total. A big moment (`crack` with `big`) is a
// hit-stop: the juice slows to near still and eases back over SLOW seconds, and the game with it only while its verb is
// empty, so a timing window the player is reading never slows. Act answers on the press itself (the key, the pointer
// going down on the canvas or the button). In a game whose press is an action rather than a stop on something
// moving (one steered by `aims`, or one that sets `buffers`), a press refused while the game still shows its action
// (a cooldown) is held for BUFFER seconds and taken the moment the game will, unless the action, the count or the
// round moves on first; everywhere else a press is timed against a sweep or a meter, so it is taken or dropped on its
// own frame, as holding it would move it off the moment the player chose and let a mashed key land on a sweep's first
// frame. A game takes a press when it plays a cue or changes its verb, which is how every act here answers.
//
// The juice is the Oogas' own and changes nothing a game scores: a hand drum rolls under the countdown; on a big
// moment a coconut cracks (two husk halves fly apart across the view and spill coconut milk), the camera punches in,
// and the watchers chant OOGA!; an ordinary score throws a puff of husk chips. Two or three Oogas from the roster
// watch at the edges of each game's view, leaning in while you aim, cheering, clutching their heads at a flop and
// dancing at three stars, and the results card says what they think.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, hud: hudMod, interact: interactMod, fx: fxMod } = BL;
  const AM = BL.arcadeModels, AG = BL.arcadeGames, RG = BL.retroGames;
  const { createNode, addChild, removeChild, createCamera, stepTweens, tweenCount, traverseVisible, boundsOf } = BL.scene;
  const { HALL, LAYOUT } = AM;

  // Each game: its rules, its machines in the arcade (the first is played, the rest stand at rest beside it), the
  // machine's parts, and the player's eye and aim point in the machine's frame. `crowd` is where the watchers stand,
  // [x, z] on the floor in the machine's frame, a list for each machine of the kind (the first for any not listed):
  // an audience at the play view's edges, small, clear of the play, the boards, the HUD's corners and the machines
  // beside it, or where the play view has no such room, just outside it so they show in the countdown's wide shot.
  // A portrait screen's narrow view is all machine, so they stay out of it, except at `tall`, the spots used while the
  // screen is taller than wide, where it leaves room. `coconut` sizes the coconut a big moment cracks, and its flecks, to
  // how far off the play is.
  // On a tall screen the HUD's cards stand over the view's top fifth, so thro-ball's view drops lower and looks level
  // to bring its boards down under them, and hoop shot's (its boards) and the claw's (the claw along the case's top)
  // tilt up a little to do the same.
  const KINDS = {
    skee: { make: AG.skeeball, spots: LAYOUT.skee, parts: () => AM.skeeLane(), eye: [0, 2.2, 2.3], look: [0, 1.3, -5], tallEye: [0, 1.6, 1.8], tallLook: [0, 1.65, -6.25], crowd: [[[-2.7, -4.6], [3.3, -4.6]], [[2.7, -4.6], [-3.3, -4.6]]], tall: [[[-1.2, -6.6], [-1.8, -9]], [[1.2, -6.6], [1.8, -9]]], coconut: 2.4 },
    hoops: { make: AG.hoopShot, spots: LAYOUT.hoops, parts: () => AM.hoopMachine(), eye: [0, 2, 1.9], look: [0, 2.35, -3.1], tallLook: [0, 2.6, -3.1], crowd: [[[-3.2, -3.3], [-2.4, -3]], [[-1.0, 2.2], [0.3, 2.8]]], coconut: 2 },
    shy: { make: AG.coconutShy, spots: [LAYOUT.shy], parts: () => ({ ...AM.coconutShy() }), eye: [0, 2, 2.8], look: [0, 1.5, -3.4], tallEye: [0, 2.6, 5.6], tallLook: [0, 2.45, -3.4], crowd: [[[-2.4, -2.75], [2.4, -3.2]]], coconut: 1.8 },
    // Under the mezzanine, so the countdown's wide view starts low and further back. Its boards and the machines
    // beside it fill the view, so its watchers stand behind the player, in the wide shot's lower corners.
    claw: { make: AG.clawGame, spots: LAYOUT.frames.claw, parts: (i) => AM.clawBooth(i), eye: [0, 1.85, 1.05], look: [0, 1.45, -1], tallLook: [0, 1.5, -1], wide: [0, 0.4, 3.2], crowd: [[[-1.6, 1.4], [2, 1.3]]], coconut: 0.9 },
    // The table runs away from the player, turned a quarter onto its length; an Ooga plays the far end.
    // Held keys sweep its mallet across at `steer` a second (a full sweep in a third of one, as quick as a drag), and
    // the HUD's third box shows the sand left under `need`. On a tall screen the view stands further back and higher,
    // so the whole table and the YOU and OOGA boards over its far end show below the HUD's cards.
    hockey: { make: AG.airHockey, spots: LAYOUT.frames.hockey, parts: () => { const a = AM.airHockey(); return { body: a.body, glow: a.lit, dz: -1.75, turn: Math.PI / 2 }; }, eye: [0, 1.7, 0.55], look: [0, 0.7, -2.1], tallEye: [0, 2.85, 1.5], tallLook: [0, 0.3, -3.65], wide: [0, 0.6, 3], rival: -3.4, crowd: [[[-2.4, -1.2], [-2.6, -4.6]], [[2.2, -2.0], [2.4, -3.6]], [[-2.2, -2.0], [-2.4, -3.6]]], coconut: 1.3, steer: 6, need: "Sand" },
    // On a tall screen the table stands on end: the view looks down its length from over its head end, behind the
    // cue coconut's spot, so the cue points away up the table.
    billiards: { make: AG.poolGame, spots: LAYOUT.frames.pool, parts: (i) => { const t = AM.poolTable(i); return { body: t.body, glow: t.glow, lamp: t.lamp, dz: -1.35 }; }, eye: [0, 2.45, 0.35], look: [0, 0.75, -1.45], tallEye: [-3.05, 3.55, -1.35], tallLook: [-0.05, 0.62, -1.35], wide: [0, 1, 3], crowd: [[[-4.2, -3.4], [4.2, -3.6]], [[4.2, -3.6], [-4.2, -3.4]]], coconut: 1 },
    // The board's hide fills this view and the pinball's and the pool table's are close and steep, so their watchers
    // stand just outside the play and show in the countdown's wide shot and round the results. On a tall screen the
    // darts view stands back far enough to show the whole board, the doubles at its sides and their numbers, and the
    // pinball view looks down on the table from over its front, so both walls, the flippers and the shooter lane fit
    // between the HUD's cards and the meter.
    darts: { make: AG.dartsGame, spots: LAYOUT.frames.darts, parts: () => ({ body: AM.dartBoard(), dz: -AM.DART.oche, dy: AM.DART.y, oche: true }), eye: [0.05, 1.72, -1.05], look: [0, 1.73, -2.37], tallEye: [0.03, 1.72, -0.68], tallLook: [0, 1.73, -2.37], wide: [0, 0.2, 2.2], crowd: [[[-1.5, -1.0], [1.5, -1.0]]], coconut: 0.55 },
    pinball: { make: AG.pinballGame, spots: LAYOUT.frames.pinball, parts: (i) => { const t = AM.pinball(i); return { body: t.body, glow: t.lit, glass: t.glass, dz: -1.05 }; }, eye: [0, 1.75, 0.3], look: [0, 1.1, -1.05], tallEye: [0, 2.8, 0.15], tallLook: [0, 0.95, -1], wide: [0, 0.8, 2.8], crowd: [[[-1.4, 1.4], [1.2, 1.5]], [[1.3, 1.0], [1.9, 0.3]]], coconut: 0.6 },
    // On the ride itself: the visitor's Ooga rides the beast, and the camera stands behind it, high and well off its
    // right shoulder, so the rider, the beast under it and the beat pole ahead all show: the pole up past the rider's
    // head, clear of the widest hair and hats even as the rider pops up on a slam, the head over the callouts, and the
    // next ride along only at the view's edge. A tall screen's view stands higher, looking down past the rider's hat,
    // so the pole shows under the callouts and the rider under it, above the meter. The front ride stands by the hall's
    // front wall, so both its watchers stand on the view's other side. A tall screen's view is all rider, beast and
    // beat pole, so the watchers keep to the countdown's wide shot there.
    ride: { make: AG.rideGame, spots: LAYOUT.frames.ride, parts: (i) => ({ body: AM.ride(i).base }), eye: [-2.2, 2.9, -2.5], look: [0.3, 1.1, 0.4], tallEye: [-0.9, 7, -4], tallLook: [0.05, 1.6, 1.3], wide: [0, 1.6, -2.2], crowd: [[[-2.4, 3.2], [-1.3, 2.9]], [[-2.2, 3.2], [2.2, 3.2]], [[-2.2, 3.2], [2.2, 3.2]], [[-2.2, 3.2], [2.2, 3.2]]], coconut: 1.3 }
  };
  // The mezzanine's cabinets, each a scene playing its retro game (`retro-games.js`): the machine is the cabinet where
  // it stands on the deck (its frame carries `y`), and the game paints the one shared screen canvas, which `drawScreen`
  // lays over the cabinet's glass every frame. The view looks square onto the glass (`retroView`), so the screen's
  // four corners map onto the overlay by one affine transform; `eye` and `look` here are only the wide view's and the
  // watchers' reference. The fires light the player's side, and the watchers stand at the cabinets either side, turned
  // to the player, off the dolly's line: they show in the countdown's wide shot and round the results, never over the
  // glass. A big moment cracks its coconut over the
  // control panel, below the glass, so the halves never fly behind the drawn screen.
  const S = AM.SCREEN, LEAN_C = Math.cos(S.lean), LEAN_S = Math.sin(S.lean);
  for (const c of AM.CABINETS) if (c.retro >= 0) {
    const id = AM.RETRO[c.retro].id;
    KINDS[id] = {
      make: RG[id], spots: [c], retro: c, parts: () => ({ body: AM.cabinet(c.index) }),
      eye: [0, S.y - LEAN_S * 1.1, S.z + LEAN_C * 1.1], look: [0, S.y, S.z], wide: [0, 1.1, 3.1],
      lamps: [[0, 2.6, 1.1], [0, 2.1, 2.3], [-1.5, 2.4, 0.7], [1.5, 2.4, 0.7]], crowd: [[[-1.5, 0.85], [1.5, 0.9]]], coconut: 0.45, crackAt: [0, 1.12, 0.5], steer: 2.6
    };
  }
  // A retro game's cues play on its cabinet's chip (`carnivalAudio`'s `chip`), each game mapping the names it calls
  // to its own 8-bit sounds, so one name can be a creature popped in one game and a paddle's blip in the next; the
  // watchers' cheers, groans and chants round the cabinet stay the hall's. Every name a game calls is here: one left
  // out throws when the game calls it.
  const CHIP_CUES = {
    invaders: { throw: "pew", swish: "zap", bonk: "hit", clang: "boom", thunk: "crumble", clack: "clack", tap: "march", chirp: "dive", knock: "alarm", fire: "powerup", coin: "oneup", big: "bonus", round: "clear", win: "win", slam: "lose", buzzer: "over" },
    snake: { crack: "chomp", big: "bonus", ding: "sparkle", score: "score", miss: "miss", click: "step", swish: "zap", knock: "alarm", thud: "thud", roll: "fire", tick: "tick", tally: "tick", clack: "clack", coin: "coin", chirp: "ready", round: "clear", win: "win", slam: "lose", buzzer: "over" },
    pong: { throw: "blip", bonk: "blip", clack: "bleep", thunk: "bloop", knock: "thud", swish: "whiff", clang: "zap", fire: "fire", score: "score", big: "bonus", chirp: "sparkle", ding: "pickup", coin: "coin", tap: "pop", round: "clear", win: "win", slam: "lose", buzzer: "over" },
    stampede: { flip: "hop", click: "step", tick: "tick", swish: "whiff", coin: "coin", ding: "sparkle", score: "score", big: "bonus", knock: "alarm", roll: "rumble", round: "clear", win: "win", miss: "splash", slam: "lose", buzzer: "over" },
    flap: { flip: "flap", tick: "blip", ding: "pickup", coin: "coin", score: "score", bell: "oneup", fire: "fire", spit: "pop", bonk: "bloop", crack: "crumble", big: "bonus", round: "clear", win: "win", slam: "lose", burn: "burn", buzzer: "over" },
    breaker: { throw: "blip", tap: "blip", swish: "whiff", clang: "zap", thunk: "bloop", bonk: "hit", clack: "clack", knock: "thud", chirp: "dive", coin: "coin", spit: "pickup", score: "score", ding: "powerup", fire: "powerup", big: "bonus", count: "alarm", tick: "tick", slam: "boom", miss: "drop", fall: "lose", round: "clear", win: "win", buzzer: "over" },
    dash: { throw: "jump", swish: "air", tap: "step", bonk: "stomp", thunk: "hit", knock: "thud", tick: "tick", chirp: "dive", coin: "coin", score: "score", clang: "bonus", fire: "powerup", round: "clear", win: "win", slam: "lose", buzzer: "over" },
    stacker: { tick: "step", click: "step", flip: "bleep", thunk: "thud", knock: "thud", tap: "beat", roll: "rumble", score: "score", big: "bonus", fire: "powerup", round: "clear", win: "win", slam: "lose", buzzer: "over" }
  };
  // The hall's neutral dark-brown dusk, a little brighter so the game reads; the warmth comes from the lamps.
  const RENDER_OPTS = {
    clear: [0.045, 0.035, 0.03], sky: [0.42, 0.37, 0.32], ground: [0.2, 0.16, 0.12],
    direct: [0.58, 0.5, 0.42], directStrength: 0.3, ambientFloor: 0.32,
    sun: { x: 0.2, y: 0.9, z: 0.4 }, shadowCenter: { x: 0, y: 2, z: -3 }, shadowExtent: 10,
    lights: new Float32Array(BL.glRenderer.POINT_LIGHT_CAPACITY * 8), lightCount: 0, bloomStrength: 1.1,
    fog: [0.06, 0.045, 0.035], fogNear: 14, fogFar: 34
  };
  // The first count dollies in from wide; a replay's is shorter (2, 1, Go) and starts from the results' view.
  const COUNT = 3.2, COUNT_AGAIN = 2.2, WIDE_OFFSET = [0, 1.4, 3.2];
  // The meter needle's 101 positions and the goal bar's 101 fills, built once, so moving them never builds a string.
  const NEEDLE = Array.from({ length: 101 }, (_, i) => `translateX(${i}%)`);
  const FILL = Array.from({ length: 101 }, (_, i) => `scaleX(${i / 100})`);
  // The score's roll, the hit-stop (held at SLOW_FLOOR speed for SLOW_HOLD, then eased back by SLOW), how long a
  // refused press is held, the results' tally (after TALLY_WAIT, over TALLY) and how long its verdict holds before a
  // key plays again (VERDICT_HOLD), the goal bar's run past the third star, and the coaching line's life (seconds,
  // presses).
  const ROLL = 0.35, SLOW = 0.3, SLOW_HOLD = 0.06, SLOW_FLOOR = 0.12, BUFFER = 0.12, TALLY = 1.1, TALLY_WAIT = 0.35, VERDICT_HOLD = 0.5, GOAL_OVER = 1.15, COACH_S = 12, COACH_N = 4;
  // Where the three stars stand along the goal bar, evenly, whatever a game's thresholds: the bar fills toward each
  // star in turn, so the next one reads at a glance even where two thresholds lie close (the stylesheet places them).
  const GOAL_AT = [0.3, 0.6, 0.9];
  const STAR_CUES = ["star0", "star1", "star2"];
  // The HUD's animations, built once: Web Animations take the same keyframes and timings every time.
  const POP = [{ transform: "scale(1.35)" }, { transform: "scale(1)" }], POP_T = { duration: 220 };
  const POP_BIG = [{ transform: "scale(1.8)", color: "#fff3a0" }, { transform: "scale(0.94)", offset: 0.55 }, { transform: "scale(1)" }], POP_BIG_T = { duration: 460, easing: "ease-out" };
  const DROP = [{ transform: "translateX(-6px)", color: "#ff7a5a" }, { transform: "translateX(5px)", offset: 0.3 }, { transform: "translateX(-3px)", offset: 0.6 }, { transform: "translateX(0)" }], DROP_T = { duration: 380 };
  const STAR_IN = [{ transform: "scale(0) rotate(-40deg)", opacity: 0 }, { transform: "scale(1.5) rotate(8deg)", opacity: 1, offset: 0.65 }, { transform: "scale(1)", opacity: 1 }], STAR_T = { duration: 420, easing: "ease-out" };
  const RECORD = [{ transform: "translateY(-8px) scale(0.6)", opacity: 0 }, { transform: "translateY(0) scale(1.12)", opacity: 1, offset: 0.12 }, { transform: "scale(1)", opacity: 1, offset: 0.2 }, { transform: "scale(1)", opacity: 1, offset: 0.86 }, { transform: "translateY(-4px) scale(0.96)", opacity: 0 }], RECORD_T = { duration: 2400, fill: "forwards" };
  const FLASH = [{ opacity: 0.8 }, { opacity: 0 }], FLASH_T = { duration: 300, easing: "ease-out" };
  const FADE_IN = [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], FADE_T = { duration: 260, easing: "ease-out" };
  const CALL = [{ opacity: 0, transform: "translate(-50%, -30%) scale(0.6)" }, { opacity: 1, transform: "translate(-50%, -50%) scale(1.08)", offset: 0.25 },
    { opacity: 1, transform: "translate(-50%, -52%) scale(1)", offset: 0.7 }, { opacity: 0, transform: "translate(-50%, -80%) scale(0.96)" }];
  const CALL_T = { duration: 900, easing: "ease-out", fill: "forwards" }, CALL_BIG_T = { duration: 1300, easing: "ease-out", fill: "forwards" };
  // Each of those is built once a visit on its element (`anim`, in `enter`) and replayed from its start, so a moment
  // makes nothing new and an element never holds more than its own few; `replay` first stops the rest of `group`,
  // the element's other animations.
  const made = (node, keys, timing) => new Animation(new KeyframeEffect(node, keys, timing), document.timeline);
  const replay = (a, group) => {
    if (group) for (let i = 0; i < group.length; i++) if (group[i] !== a) group[i].cancel();
    a.currentTime = 0;
    a.play();
  };
  // The coaching line each game shows on its first run in a page visit: keys, then touch words.
  const COACH = {
    skee: ["Space to aim, then Space in the green", "Tap to aim, then tap in the green"],
    hoops: ["Space when the bone is in the green", "Tap when the bone is in the green"],
    shy: ["Space when the marker is on a coconut", "Tap when the marker is on a coconut"],
    claw: ["Space twice to drop, then Space in the green", "Tap twice to drop, then tap in the green"],
    hockey: ["A and D slide your mallet, Space smashes", "Drag to slide your mallet, tap to smash"],
    billiards: ["Space stops the cue, then Space in the green", "Tap stops the cue, then tap in the green"],
    darts: ["Space stops the line across, then the line up", "Tap stops the line across, then the line up"],
    pinball: ["Space launches, then Space flips", "Tap launches, then tap flips"],
    ride: ["Space as the bone crosses the green", "Tap as the bone crosses the green"]
  };
  // Which games have coached this page visit; one flag per game, never more.
  const coached = {};
  for (const id of Object.keys(KINDS)) coached[id] = false;

  let renderer, game, world, go, root, camera, hud, hooks, input, fx, audio, kind = null, play = null, machine = null, slot = 0, rival = null, rider = null, retro = null;
  // The steering the games that aim read: `x` -1 to 1 across, from a drag or held arrow and A and D keys; for the retro
  // games also `hold` (-1, 0 or 1 while a key is held), `steps`, one more each press of right and one less each of
  // left (never a key's repeat, and only in play, so a press on the pause card moves nothing), and each `NOTCH` of the
  // canvas's width a drag moves (or a game's own `notch` of its screen's), and `y`, 1 while S or the down arrow is held
  // or a drag is pulled a notch down (`DRAG.down`), -1 while W or the up arrow is; and `stepsY`, counted as `steps` is,
  // one more each press of S or the down arrow and one less each of W or the up arrow, and each notch a drag moves
  // down or up while it goes more that way than across (`DRAG.ny`).
  const aim = { x: 0, hold: 0, steps: 0, y: 0, stepsY: 0 }, held = { left: false, right: false, up: false, down: false }, DRAG = { x: 0, y: 0, ny: 0, first: false, down: false, x0: 0, y0: 0, still: false }, NOTCH = 1 / 9, TAP_SLOP = 7;
  const onDown = (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") { held.left = true; if (!e.repeat && phase === "play") aim.steps--; }
    else if (k === "arrowright" || k === "d") { held.right = true; if (!e.repeat && phase === "play") aim.steps++; }
    else if (k === "arrowup" || k === "w") { held.up = true; if (!e.repeat && phase === "play") aim.stepsY--; }
    else if (k === "arrowdown" || k === "s") { held.down = true; if (!e.repeat && phase === "play") aim.stepsY++; }
  };
  const onUp = (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") held.left = false; else if (k === "arrowright" || k === "d") held.right = false;
    else if (k === "arrowup" || k === "w") held.up = false; else if (k === "arrowdown" || k === "s") held.down = false;
  };
  // A press on the canvas acts as it goes down, in every game but one steered by a drag (the air hockey), where a
  // quick tap acts (`onTap`) and the drag steers. The action button acts as it goes down too, and its click, which
  // follows on release, is then spent (`actDown`). A retro game's drag maps across its screen as drawn (`SHOWN`), so
  // the Ooga or paddle stands under the finger. In a retro game the mouse steers by hovering, so its click starts no
  // drag and acts as it goes down (its tap on release is then spent, `pressedBy`), and a second finger on the canvas
  // while the steering one (`steerId`) is down acts as it lands and never moves the aim. A quick second tap is a
  // double tap to `interact.js`, and acts like the first. A retro game that never steers (`taps`, the flap) takes
  // every press on the canvas as it goes down, as the carnival games do.
  const onPoint = (e) => {
    if (!play) return;
    if (!play.aims || play.taps) { if (e.type === "pointerdown" && e.button === 0) act(); return; }
    if (e.pointerType === "mouse" && !e.buttons && e.type !== "pointermove") return;
    if (e.type === "pointerdown") {
      pressedBy = e.pointerType;
      if (retro && e.pointerType !== "mouse") { if (steerId >= 0 && steerId !== e.pointerId && !e.isPrimary) { act(); return; } steerId = e.pointerId; }
    } else if (steerId >= 0 && e.pointerId !== steerId && e.pointerType !== "mouse") return;
    // Read from the event's own offset, which builds no rectangle as the drag moves.
    const x = e.offsetX;
    // A retro game's finger steers once it has moved past a tap's few pixels (`interact.js`'s TAP_PX), so a tap that
    // acts never moves the Ooga or paddle to where it landed.
    if (retro && e.pointerType !== "mouse") {
      if (e.type === "pointerdown") { DRAG.x0 = x; DRAG.y0 = e.offsetY; DRAG.still = true; }
      else if (DRAG.still && Math.hypot(x - DRAG.x0, e.offsetY - DRAG.y0) > TAP_SLOP) DRAG.still = false;
    }
    if (retro && SHOWN.w > 0) { if (!DRAG.still || e.pointerType === "mouse") aim.x = Math.max(-1, Math.min(1, ((x - SHOWN.x) / SHOWN.w * 2 - 1) * 1.12)); }
    else aim.x = Math.max(-1, Math.min(1, (x / canvasEl.clientWidth * 2 - 1) * 1.6));
    if (e.type === "pointerdown") { DRAG.x = x; DRAG.y = DRAG.ny = e.offsetY; DRAG.down = false; DRAG.first = e.pointerType !== "mouse"; if (retro && e.pointerType === "mouse" && e.button === 0) act(); return; }
    // Only a held drag counts notches: a hovering mouse steers `x` and carries the drag's start along with it.
    if (e.pointerType === "mouse" && !e.buttons) { DRAG.x = x; DRAG.ny = e.offsetY; DRAG.down = false; return; }
    const notch = play.notch && SHOWN.w > 0 ? SHOWN.w * play.notch : canvasEl.clientWidth * NOTCH;
    DRAG.down = e.offsetY - DRAG.y >= notch;
    // Out of play (paused, counting in) a drag moves nothing and carries its start along.
    if (phase !== "play") { DRAG.x = x; DRAG.ny = e.offsetY; return; }
    const y = e.offsetY, across = aim.steps;
    // A finger's first notch comes at half the width, so a short flick steps once; the rest come a notch apart.
    if (DRAG.first && (x - DRAG.x >= notch * 0.5 || DRAG.x - x >= notch * 0.5)) { const d = x > DRAG.x ? 1 : -1; aim.steps += d; DRAG.x += d * notch; DRAG.first = false; }
    while (x - DRAG.x >= notch) { aim.steps++; DRAG.x += notch; }
    while (DRAG.x - x >= notch) { aim.steps--; DRAG.x -= notch; }
    // Down and up count the same way while the drag goes more that way than across; a notch across starts the count
    // down afresh, and one down the count across, so a swipe's drift steps nowhere.
    if (aim.steps !== across) DRAG.ny = y;
    else if (Math.abs(y - DRAG.ny) > Math.abs(x - DRAG.x)) {
      if (DRAG.first && Math.abs(y - DRAG.ny) >= notch * 0.5) { const d = y > DRAG.ny ? 1 : -1; aim.stepsY += d; DRAG.ny += d * notch; DRAG.x = x; DRAG.first = false; }
      while (y - DRAG.ny >= notch) { aim.stepsY++; DRAG.ny += notch; DRAG.x = x; }
      while (DRAG.ny - y >= notch) { aim.stepsY--; DRAG.ny -= notch; DRAG.x = x; }
    }
  };
  const onLift = (e) => { if (e.pointerId === steerId) steerId = -1; DRAG.down = false; };
  const onTapped = () => { if (play.aims && !play.taps && !(retro && pressedBy === "mouse")) act(); };
  const onActDown = (e) => {
    if (e.button !== 0 || phase !== "play") return;
    actDown = true;
    act();
  };
  let canvasEl = null, actDown = false, pressedBy = "", steerId = -1;
  let phase = "intro", shownCount = -1, finalScore = 0, introEl = null, leaving = false;
  const targets = [], shown = { score: -1, best: -1, left: -1, round: -1, target: -1, verb: null, meter: -2, w0: -1, w1: -1, long: -1, fire: null, label: null, streak: -1, mult: -1, note: null, goal: -1, final: -1 };
  // The presentation's numbers on one object, so a frame's writes change them in place: the score's roll (`from` to
  // `to`, `rollT` into it), the hit-stop (`slow`, seconds left) and a big moment's afterglow (`big`), a held press
  // (`buffer`, seconds left) and the action, count and round it was made under, the cues the game has played
  // (`cues`), the best the run started with (`bestAt`, `record` while the score is past it, `hailed` once it has been),
  // the goal bar's stars lit (`lit`), the coaching line (`coachT` seconds, `coachN` presses left), what the run saved
  // (`better`, tickets `won` and the `total`), the results' tally (`tallying`, `tallyT`, `tickT`, `stars` lit) and
  // when its verdict landed (`verdictAt`), the camera's dolly (`k0` where a count starts it, `cam` where it is), the
  // visit's clock (`elapsed`), which the watchers, the rival and the camera's breath and shake run on, and the
  // flow's timers: the count's seconds left (`countT`, of `count`) and its next drum stroke (`drumT`), the pause
  // before the results (`doneT`), the camera's ease back at them (`back`), its shake and its punch in on a big moment
  // (`shake`, `punch`), the chant and the groan kept from piling up (`chantT`, `groanT`) and the rival's mood
  // (`rivalT`). A double kept in a closure's `let` is boxed afresh on every write; on an object it is written in
  // place, so nothing here allocates per frame.
  const T = { elapsed: 0, from: 0, to: 0, rollT: 0, slow: 0, big: 0, buffer: 0, bufVerb: "", bufLeft: 0, bufRound: 0, cues: 0, bestAt: 0, record: false, hailed: false, lit: 0, coachT: 0, coachN: 0,
    better: false, won: 0, total: 0, tallying: false, tallyT: 0, tickT: 0, stars: 0, verdictAt: 0, k0: 0, cam: 0, count: COUNT, countT: 0, drumT: 0, doneT: 0, back: 0, shake: 0, punch: 0, chantT: 0, groanT: 0, rivalT: 0 };
  const EYE = { x: 0, y: 0, z: 0 }, LOOK = { x: 0, y: 0, z: 0 }, WIDE = { x: 0, y: 0, z: 0 };
  // The eye and aim point for a wide screen, then for a tall one (a kind's `tallEye` and `tallLook`, else the same):
  // EYE and LOOK take the pair that fits the screen each frame, so turning a phone turns the view.
  const VIEW = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  // `still` is the visitor's reduced-motion wish, read on arrival: no flash, camera shake or punch, or score shake.
  let el = null, anim = null, still = false;

  // ---- the juice --------------------------------------------------------------------------------------------
  // What a cracked coconut is made of, built once and shared: a husk half (a bowl of fibre-streaked brown husk
  // round white flesh, open to +y, `HALF_R` across, scaled by the node), and the flecks at a game's size `s` (its
  // `coconut`, so they read as far off as its play is): coconut milk drops, husk chips (brown, fibre-dark and a white
  // sliver of flesh) and bits of leaf, cached by size; all unshadowed.
  const HALF_R = 0.09;
  const half = models.cached(() => {
    const r = HALF_R, n = 6, outer = [], inner = [[r, 0]];
    for (let k = 0; k <= n; k++) { const a = k / n * Math.PI / 2; outer.push([Math.sin(a) * r, -Math.cos(a) * r]); }
    for (let k = n; k >= 0; k--) { const a = k / n * Math.PI / 2; inner.push([Math.sin(a) * r * 0.84, -Math.cos(a) * r * 0.8]); }
    const husk = models.turn(outer, 12, "#6b4a26"), streak = BL.math.hexToRgb("#4a3219");
    husk.faces.forEach((f, k) => { if (k % 12 % 3 === 0) f.color = streak; });
    return models.noShadow(models.shaded([husk, models.turn(inner, 12, "#f4ecd6", 0.25)]));
  });
  const lathed = (profile, s, segments, color, emissive = 0) => models.lathe({ profile: profile.map(([r, y]) => [r * s, y * s]), segments, color, emissive });
  const drop = (color, s) => models.noShadow(lathed([[0, -0.016], [0.011, -0.012], [0.014, -0.003], [0.009, 0.01], [0.004, 0.018], [0, 0.023]], s, 6, color, 0.3));
  const sliver = (color, s) => models.noShadow(lathed([[0, -0.008], [0.024, -0.004], [0.02, 0.005], [0, 0.008]], s, 3, color));
  const leafBit = (color, s) => {
    const g = lathed([[0, -0.032], [0.014, -0.012], [0.012, 0.012], [0, 0.034]], s, 4, color);
    for (let i = 2; i < g.verts.length; i += 3) g.verts[i] *= 0.2;
    return models.noShadow(g);
  };
  const FLECKS = new Map();
  const flecks = (s) => {
    let f = FLECKS.get(s);
    if (!f) FLECKS.set(s, f = { s, milk: [drop("#fbf6e8", s), drop("#eee4cc", s)], chips: [sliver("#6b4a26", s), sliver("#3f2a14", s), sliver("#f1e8d2", s)], leaves: [leafBit("#6fae3a", s), leafBit("#3a6e24", s)] });
    return f;
  };
  // The watchers ({ cave, at, t, mood, moodT, delay } and their pose, eased; `at` is x, z and facing in the hall at
  // the wide screen's spot, then at the tall one's) and the coconuts cracking (a pool of
  // `CRACKS` pairs of halves, { a, b, t, x, y, z, s }), both made in `build` and emptied in `leave`. `face` is which
  // way the view looks along the machine (+1 down -z), `SIDE` is the machine's left to right across the hall and
  // `RIVAL` is where the hockey rival stands with its mallet in the middle (it slides along `SIDE` with it).
  const watchers = [], cracks = [], SIDE = { x: 1, z: 0 }, RIVAL = { x: 0, y: 0, z: 0 };
  const CRACKS = 3, CRACK_LIFE = 1.2, CHEER = 1, FLOP = 2, PUMP = 3;
  // What the Oogas say on the results card, by stars.
  const SAYS = ["Ooga try again.", "Ooga okay.", "Ooga happy!", "Ooga proud!"];
  let face = 1, resultStars = 0, rivalMood = 0, bits = null;
  // How far back toward the wide view the camera eases at the results.
  const RESULTS_BACK = 0.6;
  // Throws `count` of `geos` from (x, y, z): out to `speed` across, `up` upward, heavier than embers, for `life` s.
  const spray = (x, y, z, count, geos, speed, up, life, gravity = 5.5) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.65);
      fx.spawnParticle(geos[i % geos.length], x, y, z, Math.cos(a) * s, up * (0.5 + Math.random() * 0.7), Math.sin(a) * s, life * (0.7 + Math.random() * 0.5), 10, gravity);
    }
  };
  // Every watcher takes `mood` for `seconds`, one a beat after another; a pump never cuts a cheer or a flop short.
  // The hockey rival feels the opposite.
  const react = (mood, seconds) => {
    for (let i = 0; i < watchers.length; i++) {
      const w = watchers[i];
      if (mood === PUMP && w.moodT > 0 && w.mood !== PUMP) continue;
      w.mood = mood; w.moodT = seconds; w.delay = 0.04 + i * 0.09;
    }
    if (rival && mood !== PUMP) { rivalMood = mood === CHEER ? FLOP : CHEER; T.rivalT = seconds; }
    // The rider feels it too: a fist never cuts both arms short, and a miss's wobble is over by the note after next.
    if (rider && !(mood === PUMP && rider.mood === CHEER && rider.moodT > 0)) { rider.mood = mood; rider.moodT = mood === FLOP ? 0.7 : seconds; }
  };
  // A coconut cracks at a point in machine `p`'s frame: on a big moment its halves fly apart and it spills milk,
  // the watchers cheer and chant and the camera punches in; on an ordinary score only husk chips and a leaf fly.
  const crack = (p, lx, ly, lz, big) => {
    const w = toHall(p, lx, ly, lz, BURST);
    // Thrown wider and higher where the play is further off, so a burst fills the same share of the view.
    const k = bits.s, up = Math.sqrt(k);
    if (!big) {
      spray(w.x, w.y, w.z, 5, bits.chips, 0.8 * k, 1.3 * up, 0.8);
      spray(w.x, w.y, w.z, 1, bits.leaves, 0.6 * k, 1.5 * up, 1.2);
      react(PUMP, 0.7);
      return;
    }
    let c = cracks[0];
    for (let i = 0; i < cracks.length; i++) { const q = cracks[i]; if (q.t < 0) { c = q; break; } if (q.t > c.t) c = q; }
    c.t = 0; c.x = w.x; c.y = w.y; c.z = w.z;
    c.a.visible = c.b.visible = true;
    spray(w.x, w.y, w.z, Math.round(16 + 10 * k), bits.milk, 1.1 * k, 1.8 * up, 1.1);
    spray(w.x, w.y, w.z, 6, bits.chips, 1.3 * k, 1.6 * up, 0.9);
    spray(w.x, w.y, w.z, 3, bits.leaves, 0.9 * k, 2 * up, 1.5);
    audio.cue("crack", 0.8);
    audio.cue("slam", 0.6);
    if (T.chantT <= 0) { audio.cue("ooga", 0.6); T.chantT = 2.2; }
    // The hit-stop and a warm flash; the score's next pop is the big one.
    T.slow = SLOW; T.big = 0.6;
    if (!still) { T.punch = 1; replay(anim.flash); }
    react(CHEER, 1.8);
  };
  const flop = () => {
    react(FLOP, 1.4);
    if (T.groanT <= 0) { audio.cue("groan", 0.8); T.groanT = 1.6; }
  };
  // The halves fly apart across the view, turning their white insides to the camera as they tumble and fall, and
  // shrink away at the end of their life; per frame, allocation-free.
  const stepCracks = (dt) => {
    for (let i = 0; i < cracks.length; i++) {
      const c = cracks[i];
      if (c.t < 0) continue;
      c.t += dt;
      const t = c.t, out = t * 1.05 * c.s, y = Math.max((machine.y || 0) + 0.06, c.y + t * (1.3 - 3.2 * t)), open = Math.min(1, t / 0.35), s = c.s * Math.min(1, (CRACK_LIFE - t) / 0.3);
      c.a.position.x = c.x - SIDE.x * out; c.a.position.y = y; c.a.position.z = c.z - SIDE.z * out;
      c.b.position.x = c.x + SIDE.x * out; c.b.position.y = y; c.b.position.z = c.z + SIDE.z * out;
      c.a.rotation.z = -Math.PI / 2 + t * 1.8; c.a.rotation.y = machine.turn - face * open * 1.1;
      c.b.rotation.z = Math.PI / 2 - t * 1.8; c.b.rotation.y = machine.turn + face * open * 1.1;
      c.a.scale.x = c.a.scale.y = c.a.scale.z = c.b.scale.x = c.b.scale.y = c.b.scale.z = Math.max(0.01, s);
      if (t >= CRACK_LIFE) { c.t = -1; c.a.visible = c.b.visible = false; }
    }
  };
  // The watchers' pose for the moment, eased so nothing snaps: idle, looking about; leaning in, hands on knees,
  // while you aim, further while it flies; arms up and pumping for a cheer, one fist for a score, hands on heads for a
  // flop, and at three stars a dance; each at its spot for the screen's shape, so turning a phone moves them. Part
  // rotations only, allocation-free.
  const poseWatchers = (dt) => {
    const leaning = phase === "play" ? (play.status.verb ? 0.14 : 0.22) : 0, dance = phase === "results" && resultStars === 3, ease = Math.min(1, dt * 10);
    const o = renderer.size.height > renderer.size.width ? 3 : 0;
    for (let i = 0; i < watchers.length; i++) {
      const w = watchers[i], P = w.cave.parts, t = T.elapsed + w.t;
      if (w.delay > 0) w.delay -= dt;
      else w.moodT = Math.max(0, w.moodT - dt);
      const mood = w.delay > 0 || w.moodT <= 0 ? 0 : w.mood;
      let lean = leaning, armR = -0.12 + Math.sin(t * 1.3) * 0.05, armL = -0.12 + Math.sin(t * 1.3 + 1) * 0.05, spread = 0.1, head = leaning ? 0.15 : 0, look = leaning ? 0 : Math.sin(t * 0.45) * 0.35, sway = 0, kick = 0;
      if (dance) {
        const b = t * 7.5;
        armR = -2.4 + Math.sin(b) * 0.6; armL = -2.4 - Math.sin(b) * 0.6; spread = 0.35; lean = -0.05; look = 0;
        sway = Math.sin(b * 0.5) * 0.45; head = Math.sin(b) * 0.15; kick = Math.sin(b);
      } else if (mood === CHEER) {
        armR = armL = -2.55 - Math.abs(Math.sin(t * 11)) * 0.35; spread = 0.35; head = -0.3; lean = -0.1; look = 0;
      } else if (mood === FLOP) {
        armR = armL = -2.8; spread = -0.55; head = 0.3; lean = 0.08; look = Math.sin(t * 9) * 0.25;
      } else if (mood === PUMP) {
        armL = -2.5 - Math.abs(Math.sin(t * 12)) * 0.3;
      } else if (leaning) armR = armL = -0.55;
      w.lean += (lean - w.lean) * ease; w.armR += (armR - w.armR) * ease; w.armL += (armL - w.armL) * ease;
      w.spread += (spread - w.spread) * ease; w.head += (head - w.head) * ease; w.look += (look - w.look) * ease; w.sway += (sway - w.sway) * ease;
      w.cave.root.position.x = w.at[o]; w.cave.root.position.z = w.at[o + 1];
      w.cave.root.rotation.x = w.lean;
      w.cave.root.rotation.y = w.at[o + 2] + w.sway;
      P.legR.rotation.x = -w.lean - Math.max(0, kick) * 0.5;
      P.legL.rotation.x = -w.lean - Math.max(0, -kick) * 0.5;
      P.armR.rotation.x = w.armR; P.armL.rotation.x = w.armL;
      P.armR.rotation.z = -w.spread; P.armL.rotation.z = w.spread;
      P.head.rotation.x = w.head; P.head.rotation.y = w.look;
    }
  };
  // The visitor's Ooga on a ride's beast (`rider`, seated in `build` on the game's rocker, so it rocks with the beast):
  // legs astride and fists on the grips, the body leaning each frame as far as its arms reach them, so the hands stay
  // put as it pops up off the saddle when the beast slams down; its legs keep to the flanks and its head stays level.
  // One fist up on a perfect beat or a star, both arms pumping on a big moment, arms out in a wobble on a miss, and
  // from the moment the run ends, before the results card covers it, both arms up and legs kicking for a run with a
  // star, let go and slumped for one without. A hand lets go of its grip and takes it again eased, as the watchers
  // move, and while neither holds on the body sits at the seat's `lean`, against the beast's rear and roll. Part
  // rotations only, allocation-free.
  const poseRider = (dt) => {
    const r = rider, P = r.cave.parts, R = play.rocker, seat = r.seat, t = T.elapsed, ease = Math.min(1, dt * 10);
    r.moodT = Math.max(0, r.moodT - dt);
    const end = phase === "done" || phase === "results", mood = end ? (finalScore >= play.stars[0] ? CHEER : FLOP) : r.moodT > 0 ? r.mood : 0;
    let lean = seat.lean - R.rotation.x * 0.5, roll = -R.rotation.z * 0.6, head = 0, look = 0, kick = 0, holdL = 1, holdR = 1, lx = 0, lz = 0, rx = 0, rz = 0;
    if (mood === CHEER) {
      holdL = holdR = 0; lx = -2.6 - Math.abs(Math.sin(t * 11)) * 0.35; rx = -2.6 - Math.abs(Math.sin(t * 11 + 1)) * 0.35; lz = -0.35; rz = 0.35; head = -0.3; lean -= 0.08;
      if (end) kick = Math.sin(t * 9) * 0.3;
    } else if (mood === PUMP) {
      holdL = 0; lx = -2.7 - Math.abs(Math.sin(t * 12)) * 0.3; lz = -0.2; head = -0.25;
    } else if (mood === FLOP && end) {
      holdL = holdR = 0; lx = rx = -0.3; lz = -0.1; rz = 0.1; lean += 0.3; head = 0.45;
    } else if (mood === FLOP) {
      const w = Math.sin(t * 13);
      holdL = holdR = 0; roll += w * 0.16; lx = rx = -1.2; lz = -0.95 + w * 0.3; rz = 0.95 + w * 0.3; look = Math.sin(t * 9) * 0.35;
    }
    r.holdL += (holdL - r.holdL) * ease; r.holdR += (holdR - r.holdR) * ease;
    r.lean += (lean - r.lean) * ease; r.roll += (roll - r.roll) * ease; r.head += (head - r.head) * ease; r.look += (look - r.look) * ease;
    // Holding on, the lean that brings the shoulders the arm's reach from the grips, the hip where the hop leaves it:
    // the grip `gy` up and `gz` along from the hip in the rider's units, the shoulder swinging on a circle about it.
    const k = r.k, hop = Math.max(0, AM.RIDE_Y - R.position.y) * 1.6, gy = (seat.grip[1] - seat.y - hop) / k, gz = (seat.grip[2] - seat.z) / k;
    const ex = seat.grip[0] / k - r.ax, sr = Math.hypot(r.ay, r.az), gd = Math.hypot(gy, gz);
    const fit = Math.atan2(gz, gy) - Math.atan2(r.az, r.ay) - Math.acos(Math.max(-1, Math.min(1, (ex * ex + gd * gd + sr * sr - r.reach * r.reach) / (2 * sr * gd))));
    const sit = r.lean + (fit - r.lean) * Math.max(r.holdL, r.holdR), o = r.cave.root;
    o.position.y = seat.y + hop;
    o.rotation.x = sit; o.rotation.z = r.roll;
    // Each arm on its grip, or easing to its mood's pose as it lets go.
    aimArm(-1, sit, r.roll, gy, gz);
    r.lx += ((holdL ? RIDER_AIM.x : lx) - r.lx) * ease; r.lz += ((holdL ? RIDER_AIM.z : lz) - r.lz) * ease;
    P.armR.rotation.x = r.lx + (RIDER_AIM.x - r.lx) * r.holdL; P.armR.rotation.z = r.lz + (RIDER_AIM.z - r.lz) * r.holdL;
    aimArm(1, sit, r.roll, gy, gz);
    r.rx += ((holdR ? RIDER_AIM.x : rx) - r.rx) * ease; r.rz += ((holdR ? RIDER_AIM.z : rz) - r.rz) * ease;
    P.armL.rotation.x = r.rx + (RIDER_AIM.x - r.rx) * r.holdR; P.armL.rotation.z = r.rz + (RIDER_AIM.z - r.rz) * r.holdR;
    // The legs and head undo the body's lean past the seat's, and the head most of the beast's pitch.
    const bent = sit - seat.lean;
    P.legR.rotation.x = -seat.reach - bent + kick; P.legL.rotation.x = -seat.reach - bent - kick;
    P.head.rotation.x = r.head - (bent + R.rotation.x) * 0.8; P.head.rotation.y = r.look;
  };
  // A rider's arm at `side` (-1 its left) aimed from its shoulder at its grip (`gy`, `gz` from the hip, see
  // `poseRider`) through the body's lean `sit` and roll `tilt`: its turns about x and z, the arm hanging down -y, into
  // RIDER_AIM.
  const RIDER_AIM = { x: 0, z: 0 };
  const aimArm = (side, sit, tilt, gy, gz) => {
    const r = rider, gx = side * r.seat.grip[0] / r.k, cs = Math.cos(sit), ss = Math.sin(sit), ct = Math.cos(tilt), st = Math.sin(tilt);
    const y1 = gy * cs + gz * ss, dx = gx * ct + y1 * st - side * r.ax, dy = y1 * ct - gx * st - r.ay, dz = gz * cs - gy * ss - r.az;
    RIDER_AIM.x = Math.atan2(-dz, -dy); RIDER_AIM.z = Math.asin(dx / Math.hypot(dx, dy, dz));
  };

  // A point in machine `p`'s frame, into the hall; a frame with a `y` (a cabinet on the deck) stands at that height.
  const toHall = (p, lx, ly, lz, out) => {
    const c = Math.cos(p.turn), s = Math.sin(p.turn);
    out.x = p.x + c * lx + s * lz; out.y = (p.y || 0) + ly; out.z = p.z - s * lx + c * lz;
    return out;
  };
  const text = (node, value) => { node.textContent = value; };

  // ---- the HUD --------------------------------------------------------------------------------------------
  const popup = (message, big) => {
    const p = el.pop;
    text(p, message);
    p.hidden = false;
    p.dataset.big = big ? "true" : "false";
    replay(anim.pop[big ? 1 : 0], anim.pop);
  };
  // How full the goal bar is at a score of `v`, in whole percent: from the last star passed toward the next, and past
  // the third on to the bar's end at GOAL_OVER times its threshold.
  const goalPct = (v) => {
    const s = play.stars;
    let i = 0;
    while (i < 3 && v >= s[i]) i++;
    const lo = i ? s[i - 1] : 0, hi = i < 3 ? s[i] : s[2] * GOAL_OVER, from = i ? GOAL_AT[i - 1] : 0, to = i < 3 ? GOAL_AT[i] : 1;
    return Math.round(100 * Math.max(0, Math.min(to, from + (to - from) * (v - lo) / (hi - lo))));
  };
  // The score shown at `v` (rolling to the game's): the goal bar fills with it, a star lights as it passes each
  // threshold (and goes dark again under a penalty), and passing the best the run started with is a moment of its own.
  const scoreShown = (v) => {
    shown.score = v;
    text(el.score, String(v));
    // Seven figures (a pinball's best runs) step the type down, so on a phone the score box still clears the stats.
    const long = v >= 1e6 ? 1 : 0;
    if (long !== shown.long) { shown.long = long; el.score.dataset.long = long ? "true" : "false"; }
    const pct = goalPct(v);
    if (pct !== shown.goal) { shown.goal = pct; el.goalFill.style.transform = FILL[pct]; }
    const stars = play.stars;
    while (T.lit < 3 && v >= stars[T.lit]) {
      el.goalStars[T.lit].dataset.lit = "true";
      replay(anim.goal[T.lit]);
      audio.cue(STAR_CUES[T.lit], 0.8);
      T.lit++;
      react(PUMP, 0.8);
    }
    while (T.lit > 0 && v < stars[T.lit - 1]) el.goalStars[--T.lit].dataset.lit = "false";
    // The Best box burns gold only while the score is past the best (a penalty can take it back under); the ribbon,
    // horn and cheer come the first time in a run only.
    if (T.bestAt > 0 && (v > T.bestAt) !== T.record) {
      T.record = !T.record;
      el.bestBox.dataset.record = T.record ? "true" : "false";
      if (!T.record) el.record.hidden = true;
      else if (!T.hailed) {
        T.hailed = true;
        el.record.hidden = false;
        replay(anim.record);
        audio.cue("best", 0.8);
        react(CHEER, 1.6);
      }
    }
  };
  // Per frame: every field written only when it changes. The score rolls only in play: through a replay's count the
  // game still holds the last run's numbers.
  const syncHud = (dt) => {
    const s = play.status;
    if (phase === "play" || phase === "done") {
      if (s.score !== T.to) {
        const down = s.score < T.to;
        if (!down || !still) replay(anim.score[down ? 2 : T.big > 0 ? 1 : 0], anim.score);
        T.from = shown.score; T.to = s.score; T.rollT = 0;
      }
      if (shown.score !== T.to) {
        T.rollT += dt;
        const k = Math.min(1, T.rollT / ROLL), e = 1 - (1 - k) * (1 - k) * (1 - k);
        const v = k >= 1 ? T.to : Math.round(T.from + (T.to - T.from) * e);
        if (v !== shown.score) scoreShown(v);
      }
    }
    // Once the run passes the best it started with, the Best box follows the score. A best of six figures (a
    // pinball's) is shortened, so on a phone it clears the stats beside it; any less is exact, as a best to beat is.
    const best = T.record ? shown.score : game.state.arcade[kind];
    if (best !== shown.best) { shown.best = best; text(el.best, best >= 1e5 ? BL.game.formatLarge(best) : String(best)); }
    if (s.left !== shown.left) { shown.left = s.left; text(el.left, String(s.left)); }
    if (s.label !== shown.label) { shown.label = s.label; text(el.leftLabel, s.label); }
    if (s.round !== shown.round) { shown.round = s.round; text(el.round, String(s.round)); }
    if (s.target !== shown.target) { shown.target = s.target; el.need.hidden = !s.target; if (s.target) text(el.target, String(s.target)); }
    // While a press resolves (no verb) the button dims on the word it had, so it never flickers through "Play".
    if (s.verb !== shown.verb) {
      shown.verb = s.verb;
      if (phase !== "play") text(el.act, "Play");
      else if (s.verb) text(el.act, s.verb);
      el.act.disabled = phase !== "play" || !s.verb;
    }
    // A retro screen shows its own multiplier and charge, and these pills would sit on its glass.
    if (s.fire !== shown.fire) { shown.fire = s.fire; el.streak.hidden = !s.fire || !!retro; }
    const streak = s.streak || 0, mult = s.mult || 0;
    if (streak !== shown.streak || mult !== shown.mult) {
      const grew = streak > shown.streak || mult > shown.mult, on = !retro && (streak >= 2 || mult > 1);
      shown.streak = streak; shown.mult = mult;
      el.combo.hidden = !on;
      if (on) {
        text(el.combo, streak < 2 ? `×${mult}` : mult > 1 ? `${streak} in a row · ×${mult}` : `${streak} in a row`);
        if (grew) replay(anim.combo);
      }
    }
    const note = s.note || "";
    if (note !== shown.note) { shown.note = note; el.note.hidden = !note; text(el.note, note); }
    const m = s.meter < 0 ? -1 : Math.round(s.meter * 100);
    if (m !== shown.meter) {
      if ((m < 0) !== (shown.meter < 0)) el.meter.hidden = m < 0;
      shown.meter = m;
      if (m >= 0) el.needle.style.transform = NEEDLE[m];
    }
    if (s.window0 !== shown.w0 || s.window1 !== shown.w1) {
      shown.w0 = s.window0; shown.w1 = s.window1;
      el.window.style.left = `${Math.round(s.window0 * 1000) / 10}%`;
      el.window.style.width = `${Math.round((s.window1 - s.window0) * 1000) / 10}%`;
    }
  };

  // ---- the flow -------------------------------------------------------------------------------------------
  // The phase, mirrored on the HUD's root for the stylesheet (the action button and meter hide under the cards).
  const setPhase = (p) => { phase = p; el.root.dataset.phase = p; };
  // A run's HUD back to its start: the score at 0, the goal bar empty, no ribbon, streak, held press or hit-stop.
  const resetRun = () => {
    T.from = T.to = 0; T.rollT = ROLL; T.lit = 0; T.record = T.hailed = false; T.buffer = T.slow = T.big = 0;
    scoreShown(0);
    for (let i = 0; i < 3; i++) el.goalStars[i].dataset.lit = "false";
    el.bestBox.dataset.record = "false";
    el.record.hidden = el.combo.hidden = true;
    shown.streak = shown.mult = 0;
  };
  const coachOff = () => {
    T.coachT = 0;
    el.coach.hidden = true;
  };
  const startCount = (seconds) => {
    setPhase("count"); T.count = T.countT = seconds; shownCount = -1; T.drumT = 0.14; T.k0 = T.cam;
    // A replay's rider lets go of the results' cheer or groan and takes the grips for the count.
    if (rider) rider.moodT = 0;
    el.results.hidden = el.pause.hidden = true;
    shown.verb = null;
    resetRun();
  };
  // Go: the game starts, the best to beat is the one saved, and a game's first run in the page visit coaches.
  const startPlay = () => {
    setPhase("play"); play.start(); shown.verb = null;
    if (retro) audio.music(kind);
    T.bestAt = game.state.arcade[kind];
    if (!coached[kind]) {
      coached[kind] = true;
      T.coachT = COACH_S; T.coachN = COACH_N;
      el.coach.hidden = false;
      replay(anim.coach);
    }
  };
  // One press at the game: whether it took it, by the cue it played or the action it moved on to.
  const press = () => {
    const cues = T.cues, verb = play.status.verb;
    play.act();
    return T.cues !== cues || play.status.verb !== verb;
  };
  const acted = () => {
    T.buffer = 0;
    if (T.coachT > 0 && --T.coachN <= 0) coachOff();
  };
  const act = () => {
    audio.activate();
    if (phase !== "play") return;
    const s = play.status;
    if (press()) acted();
    else if (s.verb && (play.aims || play.buffers)) { T.buffer = BUFFER; T.bufVerb = s.verb; T.bufLeft = s.left; T.bufRound = s.round; }
  };
  // The run ends: its best and tickets are saved at once, so leaving in the beat before the card loses nothing.
  const finish = (score) => {
    // Once a run: an end reported again (a later substep of the same frame) must not pay or record twice.
    if (phase !== "play") return;
    setPhase("done"); T.doneT = 0.9; finalScore = score; T.buffer = 0;
    coachOff();
    T.better = game.recordArcade(kind, score) && score > 0;
    T.won = play.tickets(score); T.total = game.addTickets(T.won);
    // A retro game stopped its tune when it decided the run (`over`); a run ended any other way stops it here.
    if (retro) audio.music(null);
  };
  // The results show what the end saved, and the card tallies the score up from nothing, a star lighting as it
  // passes each threshold (the watchers dance at the third), then the verdict.
  const showResults = () => {
    setPhase("results");
    let stars = 0;
    for (let i = 0; i < 3; i++) if (finalScore >= play.stars[i]) stars++;
    text(el.says, SAYS[stars]);
    text(el.final, "0");
    shown.final = 0;
    text(el.finalBest, String(game.state.arcade[kind]));
    text(el.won, `+${T.won}`);
    text(el.tickets, String(T.total));
    el.newBest.hidden = true;
    for (let i = 0; i < 3; i++) el.stars[i].dataset.lit = "false";
    resultStars = T.stars = 0;
    T.tallying = true;
    T.tallyT = finalScore > 0 ? -TALLY_WAIT : TALLY; T.tickT = 0;
    el.results.hidden = false;
    el.pop.hidden = true;
  };
  // The stars' embers: thrown from just behind the card's top edge, part way along the view from where the camera
  // stands at the verdict, and sized to the view there, as wide as it is and rising most of the way up it, so they
  // go up round the card over any machine and on any screen.
  const EMBER_AT = 0.65, EMBER_UP = 0.4, EMBER_RISE = 0.45, EMBER_SPREAD = 1.2, EMBER_FALL = 2, EMBER_LIFE = 1.6;
  const celebrate = (count) => {
    const C = camera.position, G = camera.target;
    let vx = G.x - C.x, vy = G.y - C.y, vz = G.z - C.z;
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz), d = len * EMBER_AT;
    vx /= len; vy /= len; vz /= len;
    // The view's up: the world's, square to the view.
    let ux = -vy * vx, uy = 1 - vy * vy, uz = -vy * vz;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz), half = d * Math.tan(camera.fov / 2), up = half * EMBER_UP / ul;
    ux *= up; uy *= up; uz *= up;
    spray(C.x + vx * d + ux, C.y + vy * d + uy, C.z + vz * d + uz, count, SPARKS, half * renderer.size.width / renderer.size.height * EMBER_SPREAD,
      Math.sqrt(2 * EMBER_FALL * EMBER_RISE * half), EMBER_LIFE, EMBER_FALL);
  };
  const stepTally = (dt) => {
    T.tallyT += dt;
    if (T.tallyT < 0) return;
    const k = Math.min(1, T.tallyT / TALLY), v = Math.round(finalScore * (1 - (1 - k) * (1 - k) * (1 - k)));
    T.tickT -= dt;
    if (v !== shown.final) {
      shown.final = v;
      text(el.final, String(v));
      if (T.tickT <= 0) { audio.cue("tally", 0.6); T.tickT = 0.06; }
    }
    while (T.stars < 3 && v >= play.stars[T.stars]) {
      el.stars[T.stars].dataset.lit = "true";
      replay(anim.stars[T.stars]);
      audio.cue(STAR_CUES[T.stars], 0.9);
      resultStars = ++T.stars;
    }
    if (k < 1) return;
    // The verdict: the watchers dance at three stars, cheer at one or two and groan at none.
    T.tallying = false; T.verdictAt = T.elapsed;
    if (T.better) { el.newBest.hidden = false; replay(anim.newBest); }
    if (T.stars === 3) audio.cue("ooga", 0.6);
    else if (T.stars) react(CHEER, 2);
    else flop();
    audio.cue(T.stars ? "win" : "buzzer");
    if (T.stars) celebrate(30 + T.stars * 12);
  };
  // A key on the card: while it tallies, the tally lands at once; once the verdict has held a moment, play again. So
  // a key the player is still pressing for the game as it ends never skips the card.
  const onCard = () => {
    if (T.tallying) { T.tallyT = TALLY; stepTally(0); }
    else if (T.elapsed - T.verdictAt >= VERDICT_HOLD) again();
  };
  const again = () => {
    play.stop();
    startCount(COUNT_AGAIN);
  };
  // The Sound button or M: the sound off or back on, every Sound button saying which.
  const toggleMute = () => {
    const off = audio.setMuted(!audio.muted);
    for (const b of el.mute) text(b, off ? "Sound off" : "Sound");
  };
  const togglePause = () => {
    if (phase === "play") { setPhase("pause"); el.pause.hidden = false; T.buffer = 0; if (retro) audio.pause(true); }
    else if (phase === "pause") { setPhase("play"); el.pause.hidden = true; if (retro) audio.pause(false); }
  };
  const leave = () => {
    if (leaving) return;
    leaving = true;
    go("arcade", slot);
  };
  const onKey = (e) => {
    if (e.key === " " || e.key === "Enter") {
      if (phase === "play") act();
      else if (phase === "results") onCard();
      else return false;
      return true;
    }
    if (e.key === "Escape") {
      if (phase === "play" || phase === "pause") togglePause();
      else leave();
      return true;
    }
    if (e.key === "m" || e.key === "M") {
      toggleMute();
      return true;
    }
    return false;
  };

  // ---- the stage ------------------------------------------------------------------------------------------
  // `visitor` is the Ooga playing (see `enter`).
  const build = (visitor) => {
    const hall = AM.hall();
    addChild(root, createNode({ geometry: hall.floor }), createNode({ geometry: hall.rock }), createNode({ geometry: hall.timber }));
    const lamps = AM.lanterns();
    addChild(root, createNode({ geometry: lamps.frame }), createNode({ geometry: lamps.glass, sightHidden: true }));
    // A fire right beside a retro cabinet (the deck's bowls by the row's ends) burns low, so from the view square on the
    // glass it frames the screen rather than blazing across a fifth of it.
    const K = KINDS[kind];
    for (const [x, y, z, s0] of lamps.flames) {
      const s = K.retro && Math.hypot(x - K.retro.x, z - K.retro.z) < 2 ? s0 * 0.3 : s0;
      addChild(root, createNode({ position: { x, y, z }, scale: { x: s, y: s, z: s }, geometry: AM.blaze(), sightHidden: true }));
    }
    K.spots.forEach((p, i) => {
      const parts = K.parts(i), node = createNode({ position: { x: p.x, y: p.y || 0, z: p.z }, rotation: { x: 0, y: p.turn, z: 0 } });
      const glow = createNode({ geometry: parts.glow, sightHidden: true }), holder = parts.dz || parts.dy ? createNode({ position: { x: 0, y: parts.dy || 0, z: parts.dz || 0 }, rotation: { x: 0, y: parts.turn || 0, z: 0 } }) : node;
      addChild(holder, createNode({ geometry: parts.body }), glow);
      if (parts.glass) addChild(holder, createNode({ geometry: parts.glass, sightHidden: true }));
      if (parts.lamp) addChild(holder, createNode({ geometry: parts.lamp }));
      if (holder !== node) addChild(node, holder);
      addChild(root, node);
      const sounds = CHIP_CUES[kind], shake = (k) => { if (!still) T.shake = Math.max(T.shake, k); };
      // A name missing from the game's map would play nothing, so it throws instead.
      const cue = sounds ? (name, gain) => {
        const s = sounds[name];
        if (!s) throw new Error(`carnival: ${kind} has no chip cue for "${name}"`);
        T.cues++;
        audio.chip(s, gain);
      } : (name, gain) => { T.cues++; audio.cue(name, gain); };
      // A retro game's host (`retro-games.js`): its big moments crack a coconut over the control panel, and its tune
      // stops the moment the run is decided (`over`), so the end's own jingle plays alone.
      const host = K.retro ? {
        get best() { return game.state.arcade[kind]; }, aim, still, onEnd: finish, over: () => audio.music(null), popup, cue, shake, flop,
        crack: (big) => crack(p, K.crackAt[0], K.crackAt[1], K.crackAt[2], big)
      } : {
        node, glow,
        get best() { return game.state.arcade[kind]; },
        onEnd: finish,
        burst: (lx, ly, lz, count) => { const w = toHall(p, lx, ly, lz, BURST); fx.burst(w.x, w.y, w.z, count, SPARKS, 2.4); },
        popup, cue, shake, aim, index: i,
        crack: (lx, ly, lz, big) => crack(p, lx, ly, lz, big), flop
      };
      // The cabinet's carved sign on its marquee, as the hall hangs it.
      if (K.retro) {
        const named = AM.RETRO[p.retro], geo = BL.hubModels.caveSign(named.title, named.icon), b = boundsOf(geo), k = AM.MARQUEE.w / (b.max[0] - b.min[0]);
        addChild(node, createNode({ position: { x: 0, y: AM.MARQUEE.y, z: AM.MARQUEE.z }, scale: { x: k, y: k, z: k }, geometry: geo }));
      }
      if (parts.oche) addChild(node, createNode({ geometry: AM.dartOche() }));
      // The machine played is `slot`; the others of its kind stand at rest beside it.
      const g = K.make(host);
      if (i === slot) { play = g; machine = p; }
    });
    // An Ooga across the air hockey table, following its mallet: from the roster, never the visitor.
    rival = null;
    const everyone = BL.contributors.activeRoster.map((c) => c.name);
    const names = everyone.length > 1 ? everyone.filter((n) => n !== visitor) : everyone, rivalName = K.rival ? names[(slot + 1) % names.length] : null;
    if (K.rival) {
      const cave = models.caveman(BL.contributors.traitsFor(rivalName));
      if (cave.parts.gun) cave.parts.gun.visible = false;
      cave.root.rotation.y = machine.turn;
      toHall(machine, 0, 0, K.rival, RIVAL);
      Object.assign(cave.root.position, { x: RIVAL.x, z: RIVAL.z });
      addChild(root, cave.root);
      rival = cave;
    }
    // The visitor rides the played beast: on the game's rocker, astride its saddle (`RIDE_SEATS`), at the seat's scale,
    // empty-handed as the hall's Oogas walk and with nothing on its back (bc1gui's board would poke through the monkey's
    // shell). `poseRider` reads its right shoulder (`ax`, `ay`, `az`; the left mirrors it) and `reach`, shoulder to
    // fist, in its own units.
    rider = null;
    if (play.rocker && visitor) {
      const seat = AM.RIDE_SEATS[slot], cave = models.caveman(BL.contributors.traitsFor(visitor)), P = cave.parts, k = seat.scale, a = P.armL.position;
      for (const held of [P.club, P.gun, P.lion, P.board]) if (held) held.visible = false;
      Object.assign(cave.root.position, { x: 0, y: seat.y, z: seat.z });
      Object.assign(cave.root.scale, { x: k, y: k, z: k });
      P.legR.rotation.z = -seat.splay; P.legL.rotation.z = seat.splay;
      addChild(play.rocker, cave.root);
      rider = { cave, seat, k, ax: a.x, ay: a.y, az: a.z, reach: -P.fingersL.position.y, mood: 0, moodT: 0, lean: seat.lean, roll: 0, head: 0, look: 0, holdL: 1, holdR: 1, lx: 0, lz: 0, rx: 0, rz: 0 };
    }
    // The room's big pieces behind the machine: the stage, the mezzanine with its dark cabinets, every other game's
    // machines as they stand in the hall, and the lights.
    const st = AM.stage(), mz = AM.mezzanine();
    addChild(root, createNode({ position: { x: AM.STAGE.x, y: 0, z: AM.STAGE.z }, geometry: st.body }), createNode({ position: { x: AM.STAGE.x, y: 0, z: AM.STAGE.z }, geometry: st.lit, sightHidden: true }));
    addChild(root, createNode({ geometry: mz.body }));
    for (const other of Object.keys(KINDS)) {
      const O = KINDS[other];
      // A retro game's machine is its cabinet, which the cabinets below stand on the deck.
      if (other === kind || O.retro) continue;
      O.spots.forEach((p, i) => {
        const parts = O.parts(i), node = createNode({ position: { x: p.x, y: 0, z: p.z }, rotation: { x: 0, y: p.turn, z: 0 } });
        const holder = createNode({ position: { x: 0, y: parts.dy || 0, z: parts.dz || 0 }, rotation: { x: 0, y: parts.turn || 0, z: 0 } });
        addChild(holder, createNode({ geometry: parts.body }));
        if (parts.glow) addChild(holder, createNode({ geometry: parts.glow, sightHidden: true }));
        if (parts.glass) addChild(holder, createNode({ geometry: parts.glass, sightHidden: true }));
        if (parts.lamp) addChild(holder, createNode({ geometry: parts.lamp }));
        if (other === "ride") addChild(holder, createNode({ position: { x: 0, y: AM.RIDE_Y, z: 0 }, geometry: AM.ride(i).body }));
        addChild(node, holder);
        addChild(root, node);
      });
    }
    // The cabinets, each showing its loop's first frame; a retro game's own is its machine, its glass the live screen.
    for (const c of AM.CABINETS) {
      if (c === K.retro) continue;
      const cab = createNode({ position: { x: c.x, y: c.y, z: c.z }, rotation: { x: 0, y: c.turn, z: 0 }, geometry: AM.cabinet(c.index) });
      addChild(cab, createNode({ position: { x: 0, y: S.y, z: S.z }, rotation: { x: S.lean, y: 0, z: 0 }, geometry: c.game >= 0 ? AM.attractFrames(c.game)[0] : AM.retroFrames(c.retro)[0], sightHidden: true, depthBias: -0.1 }));
      addChild(root, cab);
    }
    // Four lamps: warm light on the machine from over it and from behind the player, and firelight either side of it.
    const l = RENDER_OPTS.lights, lamp = (n, x, y, z, radius, r, g, b) => { const o = n * 8; l[o] = x; l[o + 1] = y; l[o + 2] = z; l[o + 3] = radius; l[o + 4] = r; l[o + 5] = g; l[o + 6] = b; l[o + 7] = 0; };
    const P = machine, at = (lx, ly, lz) => toHall(P, lx, ly, lz, BURST), L = K.lamps || LAMPS;
    let w = at(L[0][0], L[0][1], L[0][2]); lamp(0, w.x, w.y, w.z, 7, 1.15, 0.9, 0.66);
    w = at(L[1][0], L[1][1], L[1][2]); lamp(1, w.x, w.y, w.z, 6, 1, 0.82, 0.6);
    w = at(L[2][0], L[2][1], L[2][2]); lamp(2, w.x, w.y, w.z, 6, 1.05, 0.62, 0.32);
    w = at(L[3][0], L[3][1], L[3][2]); lamp(3, w.x, w.y, w.z, 6, 0.98, 0.58, 0.3);
    RENDER_OPTS.lightCount = 4;
    toHall(P, K.eye[0], K.eye[1], K.eye[2], EYE);
    toHall(P, K.look[0], K.look[1], K.look[2], LOOK);
    const wide = K.wide || WIDE_OFFSET;
    toHall(P, K.eye[0] + wide[0], K.eye[1] + wide[1], K.eye[2] + wide[2], WIDE);
    Object.assign(VIEW[0], EYE); Object.assign(VIEW[1], LOOK);
    toHall(P, ...(K.tallEye || K.eye), VIEW[2]); toHall(P, ...(K.tallLook || K.look), VIEW[3]);
    // The watchers: the roster after the visitor and the rival, those whose names hash lowest with the game's, each at
    // its spot watching the player, turned a little toward the play, so their faces show, empty-handed as the hall's
    // Oogas walk.
    const crowd = names.filter((n) => n !== rivalName && n !== visitor), list = K.crowd[slot] || K.crowd[0], hash = crowd.map((n) => BL.math.fnv1a(n + kind));
    const tall = K.tall ? K.tall[slot] || K.tall[0] : list;
    for (let i = 0; i < list.length && i < crowd.length; i++) {
      let pick = 0;
      for (let j = 1; j < hash.length; j++) if (hash[j] < hash[pick]) pick = j;
      hash[pick] = Infinity;
      const cave = models.caveman(BL.contributors.traitsFor(crowd[pick]));
      cave.parts.club.visible = false;
      if (cave.parts.gun) cave.parts.gun.visible = false;
      const at = [];
      for (const [x, z] of [list[i], tall[i]]) {
        toHall(P, x, 0, z, BURST);
        at.push(BURST.x, BURST.z, Math.atan2(EYE.x * 0.8 + LOOK.x * 0.2 - BURST.x, EYE.z * 0.8 + LOOK.z * 0.2 - BURST.z));
      }
      cave.root.position.x = at[0]; cave.root.position.y = P.y || 0; cave.root.position.z = at[1];
      cave.root.rotation.y = at[2];
      addChild(root, cave.root);
      watchers.push({ cave, at, t: i * 2.1 + 0.7, mood: 0, moodT: 0, delay: 0, lean: 0, armR: -0.12, armL: -0.12, spread: 0.1, head: 0, look: 0, sway: 0 });
    }
    // The cracking coconuts' halves and flecks, sized to the game's view, and which way is across it.
    bits = flecks(K.coconut || 1);
    face = K.eye[2] > K.look[2] ? 1 : -1;
    SIDE.x = Math.cos(P.turn); SIDE.z = -Math.sin(P.turn);
    for (let i = 0; i < CRACKS; i++) {
      const a = createNode({ geometry: half(), visible: false, sightHidden: true }), b = createNode({ geometry: half(), visible: false, sightHidden: true });
      addChild(root, a, b);
      cracks.push({ a, b, t: -1, x: 0, y: 0, z: 0, s: K.coconut || 1 });
    }
    // A retro game's glass in the hall: its corners (top left, top right, bottom left, bottom right, on the pixels'
    // face), its middle, and the way it faces and its up, for the view square onto it.
    retro = K.retro ? K : null;
    if (retro) {
      for (let k = 0; k < 4; k++) {
        const lx = (k & 1 ? 0.5 : -0.5) * S.w, ly = (k & 2 ? -0.5 : 0.5) * S.h;
        toHall(P, lx, S.y + ly * LEAN_C - GLASS_Z * LEAN_S, S.z + ly * LEAN_S + GLASS_Z * LEAN_C, BURST);
        CORNERS[k * 3] = BURST.x; CORNERS[k * 3 + 1] = BURST.y; CORNERS[k * 3 + 2] = BURST.z;
      }
      toHall(P, 0, S.y, S.z, BURST);
      const s = Math.sin(P.turn), c = Math.cos(P.turn);
      GLASS.cx = BURST.x; GLASS.cy = BURST.y; GLASS.cz = BURST.z;
      GLASS.nx = s * LEAN_C; GLASS.ny = -LEAN_S; GLASS.nz = c * LEAN_C;
      GLASS.ux = s * LEAN_S; GLASS.uy = LEAN_C; GLASS.uz = c * LEAN_S;
      // The shared screen, its font and the CRT helpers, made in the build (the first visit's) rather than a frame.
      RG.kit.screen(); RG.kit.crt();
    }
  };
  // Every score and win throws embers, as a fire does.
  const BURST = { x: 0, y: 0, z: 0 }, SPARKS = [0, 1, 2].map((i) => AM.spark(i));
  // The four lamps in a machine's frame, over it and behind the player and firelight either side, unless a kind has
  // its own (`lamps`).
  const LAMPS = [[0, 2.6, -2.5], [0, 2.2, 0.6], [-1.6, 3, -3.5], [1.6, 3, -3.5]];

  const enter = (ctx, id) => {
    ({ renderer, game, world, go } = ctx);
    kind = id;
    slot = Number.isInteger(ctx.place) && KINDS[id].spots[ctx.place] ? ctx.place : 0;
    aim.x = aim.hold = aim.steps = aim.y = aim.stepsY = 0; held.left = held.right = held.up = held.down = DRAG.down = false;
    canvasEl = ctx.canvas;
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    canvasEl.addEventListener("pointermove", onPoint);
    canvasEl.addEventListener("pointerdown", onPoint);
    canvasEl.addEventListener("pointerup", onLift);
    canvasEl.addEventListener("pointercancel", onLift);
    pressedBy = ""; steerId = -1;
    leaving = false;
    camera = createCamera({ fov: 52, near: 0.1, far: 50 });
    root = createNode();
    hud = hudMod.create({ roster: BL.contributors.activeRoster, catalog: models.SWAG, tierColors: models.TIER_COLORS, renderIcon: hudMod.renderIcon, lootEnabled: ctx.lootEnabled });
    hooks = {};
    input = interactMod.create({ canvas: ctx.canvas, renderer, camera, hooks });
    fx = fxMod.create({ root, input, hooks, hud, game, world, renderer, camera, overlay: ctx.overlay, tickerAt: { x: 0, y: 4, z: -4 } });
    audio = BL.carnivalAudio.create(!!KINDS[id].retro);
    // A page a gesture has already activated builds the sound here, in the transition's black frame, rather than on
    // the count's first cue; before any gesture it does nothing, and the first cue after one builds it.
    audio.activate();
    Object.assign(hooks, { onTap: onTapped, onDoubleTap: onTapped });
    hud.onAction((action) => {
      if (action === "carnival-act") { if (actDown) actDown = false; else act(); }
      else if (action === "carnival-again") again();
      else if (action === "carnival-resume") togglePause();
      else if (action === "carnival-mute") toggleMute();
      else if (action === "leave") leave();
    });
    el = {
      root: document.getElementById("carnival"), score: document.getElementById("carnival-score"), best: document.getElementById("carnival-best"),
      left: document.getElementById("carnival-left"), leftLabel: document.getElementById("carnival-left-label"), round: document.getElementById("carnival-round"), roundLabel: document.getElementById("carnival-round-label"),
      target: document.getElementById("carnival-target"), act: document.getElementById("carnival-act"), streak: document.getElementById("carnival-streak"),
      pop: document.getElementById("carnival-pop"), meter: document.getElementById("carnival-meter"), needle: document.getElementById("carnival-needle"),
      window: document.getElementById("carnival-window"), results: document.getElementById("carnival-results"), pause: document.getElementById("carnival-pause"),
      final: document.getElementById("carnival-final"), finalBest: document.getElementById("carnival-final-best"), won: document.getElementById("carnival-won"),
      tickets: document.getElementById("carnival-tickets"), newBest: document.getElementById("carnival-newbest"), title: document.getElementById("carnival-title"), says: document.getElementById("carnival-says"),
      mute: [...document.querySelectorAll('[data-action="carnival-mute"]')], stars: [...document.querySelectorAll("#carnival-stars .carnival-star")],
      flash: document.getElementById("carnival-flash"), goalFill: document.getElementById("carnival-goal-fill"), goalStars: [...document.querySelectorAll("#carnival .carnival-goal-star")],
      bestBox: document.getElementById("carnival-best-box"), record: document.getElementById("carnival-record"), need: document.getElementById("carnival-need"), needLabel: document.getElementById("carnival-need-label"),
      combo: document.getElementById("carnival-combo"), coach: document.getElementById("carnival-coach"), note: document.getElementById("carnival-note"),
      help: document.getElementById("carnival-help"), starNeeds: [...document.querySelectorAll("#carnival-stars .carnival-star-need")]
    };
    el.act.addEventListener("pointerdown", onActDown);
    const star = (node) => made(node, STAR_IN, STAR_T);
    anim = {
      pop: [made(el.pop, CALL, CALL_T), made(el.pop, CALL, CALL_BIG_T)], score: [made(el.score, POP, POP_T), made(el.score, POP_BIG, POP_BIG_T), made(el.score, DROP, DROP_T)],
      combo: made(el.combo, POP, POP_T), flash: made(el.flash, FLASH, FLASH_T), coach: made(el.coach, FADE_IN, FADE_T), record: made(el.record, RECORD, RECORD_T),
      goal: el.goalStars.map(star), stars: el.stars.map(star), newBest: star(el.newBest)
    };
    actDown = false;
    T.shake = T.punch = T.chantT = T.groanT = resultStars = T.rivalT = T.back = 0;
    T.slow = T.big = T.buffer = T.coachT = T.k0 = T.cam = 0;
    T.tallying = false;
    still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Who plays: the Ooga the arcade sent in (`world.pilot`), or on a page that opens here `character=`, as the arcade
    // takes it; with nobody named, the roster's default pick, as the arcade's. It stays `world.pilot`, so the arcade
    // this game leaves to brings the same Ooga back to the machine even on a page that opened here.
    const asked = ctx.from === null ? new URLSearchParams(location.search).get("character")?.trim().toLowerCase() : null;
    const wanted = asked ? BL.contributors.roster.find((c) => c.name.toLowerCase() === asked)?.name : world.pilot;
    world.pilot = wanted && BL.contributors.roster.some((c) => c.name === wanted) ? wanted : BL.contributors.activeRoster[0]?.name || null;
    build(world.pilot);
    text(el.title, play.name);
    text(el.help, play.help);
    text(el.needLabel, KINDS[kind].need || "Need");
    text(el.roundLabel, play.roundLabel || "Round");
    text(el.coach, (play.coach || COACH[kind])[window.matchMedia("(pointer: coarse)").matches ? 1 : 0]);
    // The results card prints each star's threshold under it.
    for (let i = 0; i < 3; i++) text(el.starNeeds[i], BL.game.formatLarge(play.stars[i]));
    for (const b of el.mute) text(b, audio.muted ? "Sound off" : "Sound");
    el.root.hidden = false;
    el.root.dataset.kind = kind;
    el.results.hidden = el.pause.hidden = el.streak.hidden = el.meter.hidden = el.pop.hidden = el.coach.hidden = el.need.hidden = el.note.hidden = true;
    for (const key in shown) shown[key] = key === "verb" || key === "fire" || key === "label" || key === "note" ? null : -2;
    resetRun();
    introEl = document.querySelector(`[data-intro="${kind}"]`);
    setPhase("intro");
    T.elapsed = 0;
    Object.assign(camera.position, WIDE);
    Object.assign(camera.target, LOOK);
    const scene = SCENES[kind];
    scene.root = root;
    scene.camera = camera;
    scene.input = input;
    // `crack` and `flop` stage a big moment or a miss at a point in the played machine's frame; `watchers` counts them
    // and `spots` lists where each stands in the hall, [x, z, facing] on a wide screen, then on a tall one.
    scene.debug = { hud, carnival: { get kind() { return kind; }, get phase() { return phase; }, get status() { return play.status; }, act, again, finish: (s) => { finish(s); }, tickets: (s) => play.tickets(s),
      crack: (lx, ly, lz, big) => crack(machine, lx, ly, lz, big), flop, get watchers() { return watchers.length; }, get spots() { return watchers.map((w) => w.at); } } };
  };

  // Per frame, allocation-free: the flow, the game, the camera and the HUD.
  const update = (dt) => {
    T.elapsed += dt;
    if (phase === "intro" && introEl.hidden) startCount(COUNT);
    let dolly = 1;
    if (phase === "count") {
      T.countT -= dt;
      dolly = Math.min(1, (T.count - T.countT) / (T.count - 0.6));
      const n = Math.ceil(T.countT - 0.6);
      if (n !== shownCount) {
        shownCount = n;
        if (n > 0 && n <= 3) { popup(String(n), true); audio.cue("count"); }
        else if (n <= 0) { popup("Ooga go!", true); audio.cue("go"); startPlay(); }
      }
      // The hand drum's roll under the count, quickening and swelling into the Go.
      T.drumT -= dt;
      if (phase === "count" && T.drumT <= 0) {
        const k = Math.min(1, (T.count - T.countT) / (T.count - 0.6));
        audio.cue("tap", 0.25 + 0.6 * k * k);
        T.drumT += 0.15 - 0.09 * k;
      }
    } else if (phase === "intro") dolly = 0;
    aim.hold = held.left === held.right ? 0 : held.right ? 1 : -1;
    aim.y = held.down || DRAG.down ? 1 : held.up ? -1 : 0;
    if (aim.hold) aim.x = Math.max(-1, Math.min(1, aim.x + aim.hold * dt * (KINDS[kind].steer || 2.2)));
    // A held press, tried again each frame while the game still shows the action, count and round it was made under.
    if (phase === "play" && T.buffer > 0) {
      const s = play.status;
      if (s.verb !== T.bufVerb || s.left !== T.bufLeft || s.round !== T.bufRound) T.buffer = 0;
      else if (press()) acted();
      else T.buffer -= dt;
    }
    if (phase === "play" && T.coachT > 0 && (T.coachT -= dt) <= 0) coachOff();
    // The game runs at the hit-stop's pace only while its verb is empty (the press resolved, the payoff playing), so
    // no window a player is timing ever slows; the juice always does. The pace is held near still for SLOW_HOLD, then
    // eased back to full speed by the end of SLOW; worked out here rather than returned from a call, which would box it.
    let pace = 1;
    if (T.slow > 0) {
      const u = SLOW - T.slow, k = Math.max(0, (u - SLOW_HOLD) / (SLOW - SLOW_HOLD));
      pace = SLOW_FLOOR + (1 - SLOW_FLOOR) * k * k * (3 - 2 * k);
    }
    T.slow = Math.max(0, T.slow - dt);
    T.big = Math.max(0, T.big - dt);
    if (phase !== "pause") play.update(pace < 1 && !play.status.verb ? dt * pace : dt);
    audio.tick();
    if (rival) {
      const P = rival.parts, u = play.rivalU;
      rival.root.position.x = RIVAL.x + SIDE.x * u; rival.root.position.z = RIVAL.z + SIDE.z * u;
      // Following its mallet, or for a moment after a goal cheering its own or clutching its head at yours.
      T.rivalT = Math.max(0, T.rivalT - dt);
      const cheer = T.rivalT > 0 && rivalMood === CHEER, clutch = T.rivalT > 0 && rivalMood === FLOP;
      P.armL.rotation.x = cheer ? -2.55 - Math.abs(Math.sin(T.elapsed * 11)) * 0.35 : clutch ? -2.8 : -1 - play.rivalArm * 2.5;
      P.armR.rotation.x = cheer ? -2.55 - Math.abs(Math.sin(T.elapsed * 11 + 1)) * 0.35 : clutch ? -2.8 : -0.4;
      P.armR.rotation.z = clutch ? 0.55 : -0.1; P.armL.rotation.z = clutch ? -0.55 : 0.1;
      P.head.rotation.x = clutch ? 0.3 : cheer ? -0.3 : 0;
    }
    if (phase === "done") { T.doneT -= dt; if (T.doneT <= 0) showResults(); }
    else if (phase === "results" && T.tallying) stepTally(dt);
    poseWatchers(dt);
    if (rider) poseRider(dt);
    // The frame's own `dt` is handed on as it came whenever nothing slows, so no new number is boxed for the call.
    stepCracks(pace < 1 ? dt * pace : dt);
    T.chantT = Math.max(0, T.chantT - dt); T.groanT = Math.max(0, T.groanT - dt);
    // The camera: eased from where the count found it (wide on arrival, the results' view on a replay) to the eye,
    // and at the results eased part way back out so the watchers show round the card; a slow breath, a decaying
    // shake (two quick sines, so it rumbles rather than jitters) and on a big moment a punch in toward the play that
    // springs back.
    T.back = phase === "results" ? Math.min(1, T.back + dt * 0.9) : 0;
    const k = (T.k0 + (1 - T.k0) * dolly * dolly * (3 - 2 * dolly)) * (1 - T.back * T.back * (3 - 2 * T.back) * RESULTS_BACK), breath = Math.sin(T.elapsed * 0.8) * 0.02;
    T.cam = k;
    T.shake = Math.max(0, T.shake - dt * 2.2);
    T.punch = Math.max(0, T.punch - dt * 3);
    const jx = Math.sin(T.elapsed * 53) * T.shake * 0.07, jy = Math.sin(T.elapsed * 41 + 1.3) * T.shake * 0.07, kick = T.punch * T.punch * 0.08;
    if (retro) retroView();
    else {
      const v = renderer.size.height > renderer.size.width ? 2 : 0, VE = VIEW[v], VL = VIEW[v + 1];
      EYE.x = VE.x; EYE.y = VE.y; EYE.z = VE.z; LOOK.x = VL.x; LOOK.y = VL.y; LOOK.z = VL.z;
    }
    camera.position.x = WIDE.x + (EYE.x - WIDE.x) * k + jx;
    camera.position.y = WIDE.y + (EYE.y - WIDE.y) * k + breath + jy;
    camera.position.z = WIDE.z + (EYE.z - WIDE.z) * k;
    camera.position.x += (LOOK.x - camera.position.x) * kick; camera.position.y += (LOOK.y - camera.position.y) * kick; camera.position.z += (LOOK.z - camera.position.z) * kick;
    camera.target.x = LOOK.x + jx * 0.5; camera.target.y = LOOK.y + jy * 0.5; camera.target.z = LOOK.z;
    syncHud(dt);
    stepTweens(dt);
    fx.update(pace < 1 ? dt * pace : dt);
  };
  // ---- the retro screen -----------------------------------------------------------------------------------------
  // The view square onto a retro cabinet's glass, from as far out as lets the screen fill `RETRO_FILL_H` of the view's
  // height and at most `RETRO_FILL_W` of its width, so a phone held upright sees it nearly edge to edge; there the
  // view drops a little (`RETRO_LIFT` of its height) so the screen rides above the action button. Allocation-free.
  const RETRO_FILL_H = 0.62, RETRO_FILL_W = 0.92, RETRO_LIFT = 0.07, GLASS_Z = 0.006;
  // The corners are set once a visit and kept in a plain array rather than a typed one: its numbers stay boxed, so
  // handing them to `renderer.project` every frame boxes none afresh.
  const GLASS = { cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, ux: 0, uy: 0, uz: 0 }, CORNERS = Array.from({ length: 12 }, () => null);
  const retroView = () => {
    const aspect = renderer.size.width / renderer.size.height, t = 2 * Math.tan(camera.fov / 2);
    const d = Math.max(S.h / (RETRO_FILL_H * t), S.w / (RETRO_FILL_W * t * aspect)), lift = aspect < 1 ? RETRO_LIFT * d * t : 0;
    LOOK.x = GLASS.cx - GLASS.ux * lift; LOOK.y = GLASS.cy - GLASS.uy * lift; LOOK.z = GLASS.cz - GLASS.uz * lift;
    EYE.x = LOOK.x + GLASS.nx * d; EYE.y = LOOK.y + GLASS.ny * d; EYE.z = LOOK.z + GLASS.nz * d;
  };
  // The game paints the shared screen, which is laid over the glass: the four corners projected into `CORNER`, one
  // affine transform fitted to them (their mean edges and middle; the view is square on, so it is all but exact), the
  // pixels unsmoothed, a glow under it spilling onto the bezel, scanlines, the glass's vignette and sheen, and a faint
  // bloom. `SHOWN` keeps where it landed across the view, for the drag. Allocation-free.
  const CORNER = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, depth: 0 })), SHOWN = { x: 0, w: 0 };
  const drawScreen = (ctx) => {
    if (!retro) return;
    // Paused, the game stands still, so the screen and its glow keep last frame's pixels and are only laid again.
    const kit = RG.kit, scr = kit.screen(), crt = kit.crt(), W = kit.W, H = kit.H, paused = phase === "pause";
    if (!paused) play.draw(scr.ctx);
    SHOWN.w = 0;
    for (let k = 0; k < 4; k++) if (!renderer.project(CORNERS[k * 3], CORNERS[k * 3 + 1], CORNERS[k * 3 + 2], CORNER[k])) return;
    const a = CORNER[0], b = CORNER[1], c = CORNER[2], d = CORNER[3];
    const ux = (b.x - a.x + d.x - c.x) / (2 * W), uy = (b.y - a.y + d.y - c.y) / (2 * W);
    const vx = (c.x - a.x + d.x - b.x) / (2 * H), vy = (c.y - a.y + d.y - b.y) / (2 * H);
    const ex = (a.x + b.x + c.x + d.x) / 4 - (ux * W + vx * H) / 2, ey = (a.y + b.y + c.y + d.y) / 4 - (uy * W + vy * H) / 2;
    SHOWN.x = Math.min(a.x, c.x); SHOWN.w = Math.max(b.x, d.x) - SHOWN.x;
    // The glow canvas drawn so its screen lands on the screen, and its clear border fades out round it.
    const dpr = Math.min(window.devicePixelRatio || 1, 2), gx = crt.pad * W / crt.gw, gy = crt.pad * H / crt.gh, gw = W + 2 * gx, gh = H + 2 * gy;
    if (!paused) crt.glowCtx.drawImage(scr.canvas, crt.pad, crt.pad, crt.gw, crt.gh);
    ctx.setTransform(ux * dpr, uy * dpr, vx * dpr, vy * dpr, ex * dpr, ey * dpr);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(crt.glow, -gx, -gy, gw, gh);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scr.canvas, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(crt.cover, 0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.14;
    ctx.drawImage(crt.glow, -gx, -gy, gw, gh);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const overlay = (dt) => fx.drawOverlay(dt, drawScreen);

  const leaveScene = () => {
    play.stop();
    window.removeEventListener("keydown", onDown);
    window.removeEventListener("keyup", onUp);
    canvasEl.removeEventListener("pointermove", onPoint);
    canvasEl.removeEventListener("pointerdown", onPoint);
    canvasEl.removeEventListener("pointerup", onLift);
    canvasEl.removeEventListener("pointercancel", onLift);
    steerId = -1;
    el.act.removeEventListener("pointerdown", onActDown);
    canvasEl = null;
    actDown = false;
    T.buffer = T.slow = T.coachT = 0;
    audio.dispose();
    fx.dispose();
    for (const node of targets) input.remove(node);
    targets.length = 0;
    while (root.children.length) removeChild(root, root.children[root.children.length - 1]);
    watchers.length = cracks.length = 0;
    const count = input.targetCount;
    input.dispose();
    hud.dispose();
    el.root.hidden = true;
    // The HUD's animations are stopped and let go; their elements stay in the page for the next visit.
    for (const key in anim) { const a = anim[key]; if (Array.isArray(a)) for (const b of a) b.cancel(); else a.cancel(); }
    const scene = SCENES[kind];
    scene.input = scene.debug = null;
    hud = hooks = input = fx = audio = play = machine = introEl = el = rival = rider = anim = retro = null;
    SHOWN.w = 0;
    return { targets: count };
  };
  // Swapped in and out, so kept on the GPU between swaps: the scoreboard digits and the golden coconut; and the
  // cracks' milk, chips and leaves and the embers, whose particles are made only when a coconut first cracks or a
  // first score or win throws them.
  const liveGeometry = (set) => {
    for (let d = 0; d < 10; d++) set.add(AM.digit(d));
    set.add(AM.coconut(0)).add(AM.coconut(1)).add(AM.pinLight(0)).add(AM.pinLight(1));
    for (const list of [bits.milk, bits.chips, bits.leaves, SPARKS]) for (const g of list) set.add(g);
    if (rival) set.add(rival.headOpen).add(rival.headClosed);
    if (rider) set.add(rider.cave.headOpen).add(rider.cave.headClosed);
  };
  const stats = () => {
    let nodes = 0;
    traverseVisible(root, () => nodes++);
    const all = (n) => 1 + n.children.reduce((sum, c) => sum + all(c), 0);
    return { visibleNodes: nodes, allNodes: all(root), tweens: tweenCount(), targets: input.targetCount, ...fx.stats() };
  };

  const SCENES = {};
  BL.scenes = BL.scenes || {};
  for (const id of Object.keys(KINDS)) {
    SCENES[id] = BL.scenes[id] = {
      id, enter: (ctx) => enter(ctx, id), update, overlay, onDonation: () => {}, onKey, onLootCleared: () => {}, renderOpts: RENDER_OPTS,
      leave: leaveScene, stats, liveGeometry, root: null, camera: null, input: null, debug: null, agent: null, agentView: null, agentControls: null, agentHandoff: null,
      get inMotion() { return phase === "play" || phase === "count"; }
    };
  }
})();
