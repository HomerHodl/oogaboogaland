// The Lightning Factory's reader of a node's event stream. It follows Lightning Foundry's consumer contract
// (docs/lightning-factory.md in oogaboogax/lightningfoundry): every event is validated strictly and dropped whole
// if it fails, ordered by `seq` per node and never by `bucket`, a repeated `seq` is one event, a skipped one is
// counted as a gap and animated as silence, and a `slot`'s line lives for one UTC day only.
//
// Two contracts are read. `foundry.public.event.v1` is Foundry's public schema, closed at every level. The demo
// node speaks `obl.factory.demo.v1`: the same envelope and payload plus a `station` (which public channel the
// event belongs to), on a forward the `out` station it left by, and on a settled forward a bucketed `fee`. It is a separate contract rather than extra
// fields on the first, so a real Foundry stream can never be mistaken for it.
//
// Liveness keeps two things apart: the node said it stopped (`node.stopped`, observed), and the feed went quiet
// (nothing for `silentAfter`), which is unknown rather than stopped. `signal` reads "waiting", "live" or
// "silent"; `node` reads "unknown", "starting", "ready" or "stopped".
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const PUBLIC = "foundry.public.event.v1", DEMO = "obl.factory.demo.v1";
  const TYPES = new Set(["node.started", "node.ready", "node.stopped", "peer.count.changed", "channel.opening", "channel.active",
    "channel.closing", "channel.closed", "forward.settled", "forward.failed", "rebalance.succeeded", "rebalance.failed", "activity.summary"]);
  const SCALES = ["dust", "small", "medium", "large", "very_large"];
  const ENVELOPE = new Set(["schema", "id", "seq", "bucket", "node", "origin", "stream", "type", "payload"]);
  const PAYLOAD = new Set(["scale", "count", "success_ratio", "peer_count", "channel_count", "slot"]);
  const DEMO_PAYLOAD = new Set([...PAYLOAD, "station", "out", "fee"]);
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const NODE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/, SLOT = /^[a-z0-9]{1,8}$/, STATION = /^[a-z0-9][a-z0-9-]{0,31}$/;
  // A bucket is floored to its granularity, so it never carries seconds; a rebalance's is floored to the hour.
  const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(\.0+)?Z$/, HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(\.0+)?Z$/;
  const count = (v) => Number.isInteger(v) && v >= 1;
  const tally = (v) => Number.isInteger(v) && v >= 0;

  // Why an event is refused, or "" when it is accepted. The first reason found is the one counted.
  const refusal = (e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) return "shape";
    for (const k in e) if (!ENVELOPE.has(k)) return "field";
    if (e.schema !== PUBLIC && e.schema !== DEMO) return "schema";
    if (typeof e.id !== "string" || !ID.test(e.id)) return "id";
    if (!Number.isInteger(e.seq) || e.seq < 1) return "seq";
    if (typeof e.bucket !== "string" || !MINUTE.test(e.bucket) || Number.isNaN(Date.parse(e.bucket))) return "bucket";
    if (typeof e.node !== "string" || !NODE.test(e.node)) return "node";
    if (e.origin !== "observed" && e.origin !== "derived") return "origin";
    if (e.stream !== "live" && e.stream !== "replay") return "stream";
    if (!TYPES.has(e.type)) return "type";
    const p = e.payload;
    if (p !== undefined) {
      if (!p || typeof p !== "object" || Array.isArray(p)) return "payload";
      const allowed = e.schema === DEMO ? DEMO_PAYLOAD : PAYLOAD;
      for (const k in p) if (!allowed.has(k)) return "payload";
      if (p.scale !== undefined && !SCALES.includes(p.scale)) return "scale";
      if (p.count !== undefined && !count(p.count)) return "count";
      if (p.success_ratio !== undefined && !(typeof p.success_ratio === "number" && p.success_ratio >= 0 && p.success_ratio <= 1)) return "success_ratio";
      if (p.peer_count !== undefined && !tally(p.peer_count)) return "peer_count";
      if (p.channel_count !== undefined && !tally(p.channel_count)) return "channel_count";
      if (p.slot !== undefined && !(typeof p.slot === "string" && SLOT.test(p.slot))) return "slot";
      if (p.station !== undefined && !(typeof p.station === "string" && STATION.test(p.station))) return "station";
      if (p.fee !== undefined && (e.type !== "forward.settled" || !SCALES.includes(p.fee))) return "fee";
      if (p.out !== undefined && (e.type !== "forward.settled" && e.type !== "forward.failed" || typeof p.out !== "string" || !STATION.test(p.out) || p.out === p.station)) return "out";
    }
    // A rebalance happens because a channel ran low, so it may not name a line, carry a success rate, or be
    // timed finer than its hour; the demo contract keeps the same rule.
    if (e.type === "rebalance.succeeded" || e.type === "rebalance.failed") {
      if (!HOUR.test(e.bucket)) return "bucket";
      if (p && (p.slot !== undefined || p.station !== undefined || p.success_ratio !== undefined)) return "rebalance";
    }
    return "";
  };

  const create = ({ now = () => Date.now(), silentAfter = 180000 } = {}) => {
    const nodes = new Map(), listeners = new Set();
    const counts = { accepted: 0, dropped: 0, duplicates: 0, gaps: 0, reasons: {} };
    // What the boards read: the node's own counts where it gave them, and Foundry's hourly summary, which is derived.
    const reading = { node: "unknown", stream: "live", peers: null, channels: null, summary: null, settled: 0, failed: 0, rebalances: 0, fees: 0, contract: null };
    let lastAt = -Infinity;
    const perNode = (id) => {
      let n = nodes.get(id);
      if (!n) nodes.set(id, n = { last: 0, day: "", slots: new Map() });
      return n;
    };
    // A slot's line for its UTC day: letters in order of first appearance, all reassigned when the day turns,
    // so nothing carries a slot's identity past midnight.
    const lineOf = (n, e) => {
      const p = e.payload;
      if (!p) return null;
      if (p.station !== undefined) return p.station;
      if (p.slot === undefined) return null;
      let line = n.slots.get(p.slot);
      if (line === undefined) n.slots.set(p.slot, line = `slot-${n.slots.size}`);
      return line;
    };
    const accept = (e) => {
      const reason = refusal(e);
      if (reason) {
        counts.dropped++;
        counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
        return false;
      }
      const n = perNode(e.node);
      if (e.seq <= n.last) {
        counts.duplicates++;
        return false;
      }
      if (n.last && e.seq > n.last + 1) counts.gaps++;
      n.last = e.seq;
      const day = e.bucket.slice(0, 10);
      if (day !== n.day) {
        n.day = day;
        n.slots.clear();
      }
      counts.accepted++;
      lastAt = now();
      reading.stream = e.stream;
      reading.contract = e.schema;
      const p = e.payload || {};
      switch (e.type) {
        case "node.started": reading.node = "starting"; break;
        case "node.ready": reading.node = "ready"; break;
        case "node.stopped": reading.node = "stopped"; break;
        case "peer.count.changed": reading.peers = p.peer_count ?? reading.peers; break;
        case "channel.active": case "channel.closed": reading.channels = p.channel_count ?? reading.channels; break;
        case "forward.settled": reading.settled += p.count || 1; if (p.fee) reading.fees += p.count || 1; break;
        case "forward.failed": reading.failed += p.count || 1; break;
        case "rebalance.succeeded": reading.rebalances += p.count || 1; break;
        case "activity.summary":
          reading.summary = { count: p.count ?? null, ratio: p.success_ratio ?? null };
          reading.peers = p.peer_count ?? reading.peers;
          reading.channels = p.channel_count ?? reading.channels;
          break;
      }
      const line = lineOf(n, e);
      for (const fn of listeners) fn(e, line);
      return true;
    };
    const subscribe = (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };
    const reset = () => {
      nodes.clear();
      counts.accepted = counts.dropped = counts.duplicates = counts.gaps = 0;
      counts.reasons = {};
      Object.assign(reading, { node: "unknown", stream: "live", peers: null, channels: null, summary: null, settled: 0, failed: 0, rebalances: 0, fees: 0, contract: null });
      lastAt = -Infinity;
    };
    return {
      accept, subscribe, reset, counts, reading,
      get signal() { return lastAt === -Infinity ? "waiting" : now() - lastAt < silentAfter ? "live" : "silent"; },
      get lastAt() { return lastAt; },
      dispose() { listeners.clear(); nodes.clear(); }
    };
  };

  // The page's one factory node, on `world.factoryNode` and made on first need, as `world.mine` is: one feed, the demo
  // node playing into it on the node's own clock, and where each line stands. Whichever scene is active ticks it, so
  // the island's window and the hall watch one show, and a view that starts watching late finds it where it is.
  // Placement listens first, so every view reads it after it has moved: `at` is the place the last event's line
  // holds or held (null for none), `indexOf(line)` the place a line holds without claiming one, and `version` counts
  // every line placed or released and every bay's change of state. A line claims a place as the factory always
  // has: only a line being opened may take one, or any line on a public stream, whose slots are new each day; the
  // first free featured bay, then the first free gallery stand.
  const node = (world) => {
    if (world.factoryNode) return world.factoryNode;
    const L = BL.factoryModels.LAYOUT, n = world.factoryNode = {
      clock: Date.now(), feed: null, mock: null, bays: [], stands: [], placeOf: new Map(), at: null, version: 0,
      indexOf: (line) => n.placeOf.get(line) || null,
      // Through the properties, so a stubbed `mock.update` holds the show still.
      tick(dt) {
        n.clock += dt * 1000;
        n.mock.update(dt, n.feed.accept);
      }
    };
    n.feed = create({ now: () => n.clock, silentAfter: 10000 });
    n.mock = BL.factoryMock.create({ seed: 21 });
    for (let i = 0; i < L.bays.length; i++) n.bays.push({ bay: true, index: i, line: null, state: "empty" });
    for (const { stations } of L.galleries) for (let i = 0; i < stations; i++) n.stands.push({ bay: false, index: n.stands.length, line: null });
    const put = (place, line) => {
      place.line = line;
      n.placeOf.set(line, place);
      n.version++;
    };
    const free = (row) => {
      for (let i = 0; i < row.length; i++) if (!row[i].line) return row[i];
      return null;
    };
    const become = (place, state) => {
      if (!place.bay || place.state === state) return;
      place.state = state;
      n.version++;
    };
    // The demo node's featured floor: its three largest public channels, and the newest line in the fourth bay; the
    // rest by size in the galleries while they have room.
    const chans = n.mock.snapshot.channels.filter((c) => c.active).sort((a, b) => b.capacity - a.capacity), newest = n.mock.newest;
    chans.filter((c) => c.id !== newest).slice(0, 3).forEach((c, i) => put(n.bays[i], c.id));
    put(n.bays[3], newest);
    for (const b of n.bays) b.state = "active";
    let g = 0;
    for (const c of chans) if (!n.placeOf.has(c.id) && g < n.stands.length) put(n.stands[g++], c.id);
    n.feed.subscribe((e, line) => {
      let place = line ? n.placeOf.get(line) || null : null;
      if (!place && line && (e.schema === PUBLIC || e.type === "channel.opening" || e.type === "channel.active")) {
        place = free(n.bays) || free(n.stands);
        if (place) put(place, line);
      }
      if (place) {
        switch (e.type) {
          case "channel.opening": become(place, "building"); break;
          case "channel.active": become(place, "active"); break;
          case "channel.closing": become(place, "dismantling"); break;
          case "channel.closed":
            become(place, "empty");
            n.placeOf.delete(place.line);
            place.line = null;
            n.version++;
            break;
        }
      }
      n.at = place;
    });
    n.mock.replay(n.feed.accept);
    return n;
  };

  BL.factoryFeed = { create, node, refusal, PUBLIC, DEMO, TYPES, SCALES };
})();
