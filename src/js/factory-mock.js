// A demo node for the Lightning Factory until a real one publishes. It speaks the feed's demo contract
// (`obl.factory.demo.v1`): exactly the shape of Foundry's public events, plus the `station` each event belongs
// to and a settled forward's bucketed `fee`. Never liquidity, never an exact amount or time.
//
// Everything is seeded, so the same seed plays the same show. `snapshot` is the node's public face, the
// part Lightning gossip would give anyone: its alias, and per channel the peer, capacity, age and fee
// policy. The peers are made up. `update(dt, emit)` runs the show: a forward every second or two, mostly on
// the featured lines and sometimes failing, a rebalance now and then, Foundry's hourly summary, and a loop
// of LOOP seconds that closes the newest line and opens another in its place, lets the feed fall silent
// for a while, and stops and restarts the node. Between those beats one of the smaller lines closes now and
// then and another opens in its place (`CHURN`), so the forge has work every half minute or so and a
// visitor sees it within seconds of coming in. `replay(emit)` first tells the history a page catches up on.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mulberry32 } = BL.math;
  const { DEMO } = BL.factoryFeed;
  const LOOP = 150;
  // The loop's beats, in seconds: a line closes and is dismantled, a new one is built in its place, the
  // feed goes quiet, and the node stops and comes back.
  const BEATS = { close: 24, closed: 36, open: 48, active: 62, quiet: 100, loud: 118, stop: 124, start: 132, ready: 136 };
  const BEAT_ORDER = ["close", "closed", "open", "active", "quiet", "loud", "stop", "start", "ready"];
  // The smaller lines' churn, [second in the loop, beat]: the spare line opens and comes up, and another closes and
  // becomes the next spare, three times a loop and clear of the featured line's beats, the quiet and the restart.
  const CHURN = [[4, "open"], [14, "active"], [18, "close"], [22, "closed"], [72, "open"], [82, "active"], [86, "close"], [90, "closed"],
    [138, "open"], [140, "close"], [144, "closed"], [146, "active"]];
  const PEERS = ["Beach", "Volcano", "Jungle", "Harbor", "Tidepool", "Reef", "Glacier", "Canyon", "Meadow", "Lagoon", "Summit",
    "Bayou", "Mesa", "Delta", "Tundra", "Grotto", "Ridge", "Marsh", "Fjord", "Dune", "Cove", "Crater", "Orchard", "Quarry"];

  // The node's public face. The first three peers are the largest channels; Harbor and Tidepool take turns
  // as the newest line, which is the one the loop closes and replaces. Quarry starts closed, the churn's
  // first spare.
  const snapshot = (seed) => {
    const rand = mulberry32(seed ^ 0x5eed);
    const channels = PEERS.map((peer, i) => ({
      id: peer.toLowerCase(), peer,
      capacity: i < 3 ? [8e6, 7e6, 6e6][i] : Math.round((0.5 + rand() * 4.5) * 1e5) * 10,
      ageDays: i === 3 ? 2 : i === 4 ? 0 : 20 + Math.floor(rand() * 400),
      feePpm: [50, 100, 150, 250, 400][Math.floor(rand() * 5)], baseMsat: rand() < 0.5 ? 0 : 1000,
      active: i !== 4 && peer !== "Quarry"
    }));
    const active = channels.filter((c) => c.active);
    return {
      alias: "Ooga Booga Lightning Node", channels,
      get capacity() { return channels.reduce((sum, c) => sum + (c.active ? c.capacity : 0), 0); },
      get channelCount() { return channels.reduce((n, c) => n + (c.active ? 1 : 0), 0); },
      peerCount: active.length + 3
    };
  };

  const create = ({ seed = 21, now = () => Date.now(), node = "ooga" } = {}) => {
    const rand = mulberry32(seed), snap = snapshot(seed);
    let seq = 0, t = 0, loop = 0, nextForward = 1, nextRebalance = 30, nextSummary = 55, settled = 0, failed = 0;
    let beat = 0, quiet = false, newest = "harbor", churn = 0, spare = "quarry", opening = null, leaving = null, turn = 4;
    const HEX = "0123456789abcdef";
    // Random public ids in the UUIDv4 shape the schema requires, drawn from the seed so a replay repeats.
    const uuid = () => {
      let s = "";
      for (let i = 0; i < 32; i++) {
        const v = i === 12 ? 4 : i === 16 ? 8 + Math.floor(rand() * 4) : Math.floor(rand() * 16);
        s += HEX[v];
        if (i === 7 || i === 11 || i === 15 || i === 19) s += "-";
      }
      return s;
    };
    // Floored to the minute, and to the hour for a rebalance, as an export publishes them.
    const bucket = (hour) => {
      const d = new Date(now());
      d.setUTCSeconds(0, 0);
      if (hour) d.setUTCMinutes(0);
      return d.toISOString();
    };
    const event = (type, payload = {}, stream = "live", origin = "observed") => ({
      schema: DEMO, id: uuid(), seq: ++seq, bucket: bucket(type.startsWith("rebalance")), node, origin, stream, type, payload
    });
    const channel = (id) => snap.channels.find((c) => c.id === id);
    const scaleOf = (sats) => sats < 1e4 ? "dust" : sats < 1e5 ? "small" : sats < 1e6 ? "medium" : sats < 1e7 ? "large" : "very_large";
    // A forward on an active line: mostly the three largest and the newest, sometimes one of the rest; never `not`.
    const pickLine = (not = null) => {
      const featured = rand() < 0.72;
      for (let tries = 0; tries < 8; tries++) {
        const c = featured ? channel(["beach", "volcano", "jungle", newest][Math.floor(rand() * 4)]) : snap.channels[4 + Math.floor(rand() * (snap.channels.length - 4))];
        if (c.active && c.id !== not) return c;
      }
      return channel(not === "beach" ? "volcano" : "beach");
    };
    // A forward comes in on one line and leaves by another. Now and then a large one, rarely a very large one.
    const forward = (emit) => {
      const c = pickLine(), out = pickLine(c.id), fail = rand() < 0.12, r = rand();
      const scale = r < 0.08 ? "dust" : r < 0.6 ? "small" : r < 0.92 ? "medium" : r < 0.985 ? "large" : "very_large";
      if (fail) {
        failed++;
        emit(event("forward.failed", { scale, count: 1, station: c.id, out: out.id }));
      } else {
        settled++;
        emit(event("forward.settled", { scale, count: 1, station: c.id, out: out.id, fee: "dust" }));
      }
    };
    const replay = (emit) => {
      emit(event("node.started", {}, "replay"));
      emit(event("node.ready", {}, "replay"));
      emit(event("peer.count.changed", { peer_count: snap.peerCount }, "replay"));
      for (const c of snap.channels) if (c.active) emit(event("channel.active", { scale: scaleOf(c.capacity), station: c.id, channel_count: snap.channelCount }, "replay"));
      for (let i = 0; i < 6; i++) forward((e) => { e.stream = "replay"; emit(e); });
    };
    // The next smaller line to close: round the lines past the featured ones, skipping any closed or opening.
    const nextToClose = () => {
      for (let k = 0; k < snap.channels.length; k++) {
        turn = turn + 1 < snap.channels.length ? turn + 1 : 5;
        const c = snap.channels[turn];
        if (c.active && c.id !== opening) return c.id;
      }
      return null;
    };
    const churnBeat = (emit, at) => {
      const next = CHURN[churn];
      if (!next || at < next[0]) return;
      churn++;
      switch (next[1]) {
        case "open":
          opening = spare;
          emit(event("channel.opening", { scale: scaleOf(channel(opening).capacity), station: opening }));
          break;
        case "active":
          channel(opening).active = true;
          emit(event("channel.active", { scale: scaleOf(channel(opening).capacity), station: opening, channel_count: snap.channelCount }));
          opening = null;
          break;
        case "close":
          leaving = nextToClose();
          if (leaving) emit(event("channel.closing", { scale: scaleOf(channel(leaving).capacity), station: leaving }));
          break;
        case "closed":
          if (!leaving) break;
          channel(leaving).active = false;
          emit(event("channel.closed", { scale: scaleOf(channel(leaving).capacity), station: leaving, channel_count: snap.channelCount }));
          spare = leaving;
          leaving = null;
          break;
      }
    };
    // The loop's scripted beats, each fired once as the clock passes it.
    const script = (emit) => {
      const at = t - loop * LOOP;
      churnBeat(emit, at);
      const next = BEAT_ORDER[beat];
      if (!next || at < BEATS[next]) return;
      beat++;
      const fresh = newest === "harbor" ? "tidepool" : "harbor";
      switch (next) {
        case "close": emit(event("channel.closing", { scale: scaleOf(channel(newest).capacity), station: newest })); break;
        case "closed":
          channel(newest).active = false;
          emit(event("channel.closed", { scale: scaleOf(channel(newest).capacity), station: newest, channel_count: snap.channelCount }));
          break;
        case "open": emit(event("channel.opening", { scale: scaleOf(channel(fresh).capacity), station: fresh })); break;
        case "active":
          channel(fresh).active = true;
          newest = fresh;
          emit(event("channel.active", { scale: scaleOf(channel(fresh).capacity), station: fresh, channel_count: snap.channelCount }));
          break;
        case "quiet": quiet = true; break;
        case "loud": quiet = false; break;
        case "stop": emit(event("node.stopped")); break;
        case "start": emit(event("node.started")); break;
        case "ready": emit(event("node.ready")); break;
      }
    };
    const update = (dt, emit) => {
      t += dt;
      if (t - loop * LOOP >= LOOP) {
        loop++;
        beat = 0;
        churn = 0;
      }
      script(emit);
      if (quiet) return;
      // Nothing routes between the node stopping and coming back ready.
      const running = beat < 7 || beat === 9;
      if (running && t >= nextForward) {
        nextForward = t + 0.7 + rand() * 1.5;
        forward(emit);
      }
      if (running && t >= nextRebalance) {
        nextRebalance = t + 35 + rand() * 20;
        emit(event("rebalance.succeeded", { scale: rand() < 0.6 ? "medium" : "large", count: 1 }));
      }
      if (t >= nextSummary) {
        nextSummary = t + 60;
        const all = settled + failed;
        emit(event("activity.summary", { count: Math.max(1, all), success_ratio: all ? Math.round(settled / all * 100) / 100 : 1, peer_count: snap.peerCount, channel_count: snap.channelCount }, "live", "derived"));
        settled = failed = 0;
      }
    };
    return { snapshot: snap, replay, update, get t() { return t; }, get newest() { return newest; }, LOOP, BEATS };
  };

  BL.factoryMock = { create, snapshot, PEERS, LOOP, BEATS };
})();
