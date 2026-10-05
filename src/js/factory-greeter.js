// The factory's foreman, Flink. One visit owns the rig, the on-screen tour menu and the feed subscription.
// Dialogue is data for later speech. The tour observes events; it never drives the node or the visitor.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { models, contributors, factoryModels: FM } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const DEMO = "obl.factory.demo.v1", HEIGHT = 1.05, BASE = HEIGHT * 5 / 16;
  // His name sits with the dialogue: the act button reads TALK TO FLINK in his reach, the menu heads itself with it.
  const NAME = "Flink";
  const LINES = {
    greeting: "Ooga! Me Flink, the foreman. Want a look round?",
    greetingDemo: "Ooga! Me Flink. Mind — this node is a demo one.",
    noOogaDemo: "Demo node today! Pick an Ooga on the island.",
    noOoga: "No Ooga, no tour! Pick one on the island.",
    menu: "Four tours! Pick one.",
    follow: "Come come! Lines, the core, the switchboard.",
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
    done: "That is forwarding! Wander free — me wait by the stairs.",
    warning: "Still coming? Me wait here.",
    abandoned: "Lost my visitor! Back to post.",
    cancelled: "All good. Me head back!",
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
  // His post stands on the balcony's left at the head of the grand stairway, clear of its lantern post and the
  // arrival path, so the visitor walks up to him. Explicit waypoints use the broad arrival stairs and the left
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
  const DRESS = {
    torso(k, v) {
      const leather = k.color("#52331f"), brass = k.color("#c9962e");
      v.fill(2, 6, 1, 7, 5, 5, leather);
      v.fill(2, 2, 5, 7, 1, 5, leather);
      v.fill(6, 6, 5, 7, 1, 5, leather);
      v.fill(3, 5, 3, 3, 5, 5, brass);
    },
    headgear(k) {
      addChild(k.parts.head, createNode({ position: { x: 0, y: 0.53 * k.h, z: 0 }, scale: { x: 0.75, y: 0.75, z: 0.75 }, geometry: FM.hardHat() }));
    }
  };
  const TRAITS = models.cached(() => ({ ...contributors.traitsFor("foreman/factory"), display: NAME, height: HEIGHT,
    belly: 1, skin: "#bf855d", hair: "#35251a", fur: "#795333", face: "beard", dress: DRESS }));

  const create = ({ parent, input, fx, feed, visitor, demoRunning, coarse }) => {
    const figure = models.caveman(TRAITS()), body = figure.root, parts = figure.parts;
    body.position.x = ROUTE[0][0]; body.position.y = ROUTE[0][1] + BASE; body.position.z = ROUTE[0][2];
    parts.club.visible = parts.snack.visible = parts.hat.visible = false;
    addChild(parent, body);
    input.add(parts.torso, { kind: "greeter" }, { radius: 0.65 });
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
      return Math.hypot(p.x - position.x, p.z - position.z, p.y - actor.baseY - (position.y - BASE)) <= range;
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
    // One anchored bubble replaces the previous line and follows the foreman, including his return. Each spoken
    // beat also arms the tour's auto-advance: after a readable pause the next line comes on its own.
    const say = (id, repeat = false) => {
      if (!repeat || state.spoken !== id) state.utterance = 0;
      state.spoken = id;
      const beat = SPEECH[id][state.utterance];
      state.advance = 1.6 + beat.length * 0.06;
      fx.say(figure, beat, 8);
    };
    const greet = (interacting = true) => {
      if (state.phase === "return" || state.phase === "walk") return;
      if (state.phase === "talk") { say(state.spoken, true); return; }
      if (interacting && visitor() && !near()) return;
      state.greeted = true;
      if (!interacting) {
        show("greeting");
        say(demoRunning() ? "greetingDemo" : "greeting");
        return;
      }
      const actor = visitor();
      if (!actor) { say(demoRunning() ? "noOogaDemo" : "noOoga"); return; }
      // Talking turns the visitor's Ooga to face him, and the menu opens on screen.
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
      const feet = position.y - BASE, actor = visitor();
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
      body.rotation.y = Math.atan2(x - position.x, z - position.z);
      position.x = x; position.z = z; position.y = floor + BASE; state.blocked = 0;
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
      const stride = walking ? Math.sin(elapsed * (state.phase === "return" ? 15 : 8)) * 0.5 : 0;
      parts.legL.rotation.x = stride; parts.legR.rotation.x = -stride;
      parts.armL.rotation.x = state.phase === "greeting" ? -2 + Math.sin(elapsed * 5) * 0.12 : -stride * 0.6;
      parts.armR.rotation.x = state.phase === "talk" ? -1.1 : stride * 0.6;
      const look = state.phase === "talk" ? tour.look[state.waypoint] : null;
      if (!walking && look) {
        body.rotation.y = Math.atan2(look[0] - position.x, look[2] - position.z);
        parts.head.rotation.x = -Math.min(0.6, Math.max(-0.4, Math.atan2(look[1] - position.y - 1.1, Math.hypot(look[0] - position.x, look[2] - position.z))));
      } else {
        parts.head.rotation.x = 0;
        if (!walking && actor) body.rotation.y = Math.atan2(actor.root.position.x - position.x, actor.root.position.z - position.z);
      }
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
      input.remove(parts.torso);
      removeChild(parent, body);
      panel.remove(); stop.remove();
      state.lastEvent = null;
    };
    return { root: body, state, update, greet, act, actLabel, escape, dispose,
      liveGeometry(set) { set.add(figure.headOpen).add(figure.headClosed); } };
  };
  BL.factoryGreeter = { create, LINES, TOURS, NAME };
})();
