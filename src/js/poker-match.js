// The relay and the independent client verifier run the same public state machine.
// It sees encrypted cards and public openings only; no private shuffle or key.
(() => {
  "use strict";
  const BL = window.BL, C = BL.pokerCrypto, R = BL.pokerRules;
  const copy = x => JSON.parse(JSON.stringify(x));
  const active = phase => !["idle", "complete", "aborted"].includes(phase);
  const validIndex = n => Number.isInteger(n) && n >= 0 && n < 10;
  const create = (table, initial = null) => {
    if (!validIndex(table)) throw new Error("Invalid table");
    const game = R.createSealed(initial?.game);
    const counters = new Map(initial?.counters || []);
    let phase = "idle", context = null, members = [], keys = new Map(), deck = [], aggregate = null, shuffleAt = 0;
    let root = "", ackRoot = "", acknowledgments = new Set(), shares = new Map(), requested = [], events = [], header = null, canceled = null;
    let epoch = initial?.epoch || 0, revision = 0, lastRequest = new Map(), busy = false;
    const checkpoint = () => ({ game: game.checkpoint(), counters: [...counters], epoch });
    const member = id => members.find(m => m.id === id);
    const shareContext = (id, index) => [context, "card", id, index];
    const shuffleContext = async id => [context, "shuffle", shuffleAt, id, await C.digest(deck)];
    const currentShares = index => members.map(m => shares.get(m.id)?.get(index)).filter(Boolean);
    const needShares = (kind, indices) => {
      phase = kind;
      const plan = game.plan(), owner = new Map();
      for (const h of plan.holes) if (h) for (const p of h.positions) owner.set(p, h.id);
      requested = members.map(m => ({ id: m.id, indices: indices.filter(i => (kind !== "hole" || owner.get(i) !== m.id) && !shares.get(m.id)?.has(i)) }));
    };
    const advance = () => {
      const s = game.snapshot(), plan = game.plan();
      if (s.result) { phase = "complete"; requested = []; return; }
      const pending = plan.board.filter(i => currentShares(i).length !== members.length);
      if (pending.length) { needShares("board", pending); return; }
      if (plan.reveal) { needShares("showdown", plan.holes.filter(h => h && !h.folded).flatMap(h => h.positions)); return; }
      phase = "betting"; requested = [];
    };
    const finishShares = () => {
      if (requested.some(r => r.indices.some(i => !shares.get(r.id)?.has(i)))) return;
      if (phase === "hole") { advance(); return; }
      const indices = [...new Set(requested.flatMap(r => r.indices))];
      game.open(indices.map(i => [i, C.openPublic(deck[i], currentShares(i))]));
      if (phase === "showdown") game.resolve();
      advance();
    };
    const begin = async req => {
      if (active(phase)) throw new Error("A hand is already running");
      const s = game.snapshot();
      members = s.seats.flatMap((p, seat) => p && p.stack > 0 ? [{ id: p.id, seat, stack: p.stack }] : []);
      if (members.length < 2 || !member(req.signer)) throw new Error("At least two funded players are needed");
      if (typeof req.data.nonce !== "string" || !/^[0-9a-f]{64}$/.test(req.data.nonce)) throw new Error("Invalid hand nonce");
      header = checkpoint(); events = []; root = await C.digest([C.DOMAIN, table, header]);
      epoch++;
      context = { protocol: C.DOMAIN, table, epoch, nonce: req.data.nonce, members, dealerBefore: s.dealer, blinds: [R.SMALL, R.BIG] };
      phase = "keys"; keys = new Map(); deck = []; aggregate = null; shuffleAt = 0; ackRoot = "";
      acknowledgments = new Set(); shares = new Map(); requested = []; canceled = null;
    };
    const append = async req => { root = await C.digest([root, req]); events.push({ request: copy(req), root }); revision++; };
    const perform = async req => {
      const { op, data, signer } = req;
      if (op === "join" || op === "leave" || op === "refill") {
        if (active(phase)) throw new Error("Wait until this hand finishes");
        if (op !== "join" && !game.snapshot().seats.some(s => s?.id === signer)) throw new Error("Take a seat first");
        if (op === "join") { C.math.decode(signer, true); if (counters.size >= 256 && !counters.has(signer)) throw new Error("Table session limit reached"); game.join(signer, String(data.name || "Ooga").slice(0, 32), false, data.seat ?? -1); }
        if (op === "leave") game.leave(signer);
        if (op === "refill") game.refill(signer);
        phase = "idle"; header = null; events = []; root = ""; return;
      }
      if (op === "start") { await begin(req); return; }
      if (!member(signer) || !active(phase) || data.hand !== context.nonce || data.epoch !== context.epoch) throw new Error("Wrong hand or player");
      if (op === "key") {
        if (phase !== "keys" || keys.has(signer)) throw new Error("Key already fixed");
        if (!await C.signatureValid(data.key, "hand-key", [context, signer], data.proof) || [...keys.values()].includes(data.key)) throw new Error("Invalid key ownership proof");
        const proposed = new Map(keys); proposed.set(signer, data.key);
        if (proposed.size === members.length) { const joint = C.aggregate(members.map(m => proposed.get(m.id))); const fresh = C.initialDeck(joint); aggregate = joint; deck = fresh; phase = "shuffle"; }
        keys = proposed;
      } else if (op === "shuffle") {
        if (phase !== "shuffle" || members[shuffleAt]?.id !== signer) throw new Error("Not your shuffle");
        const output = await C.verifyShuffle(deck, aggregate, await shuffleContext(signer), data.shuffle);
        deck = output; shuffleAt++;
        if (shuffleAt === members.length) phase = "ack";
      } else if (op === "ack") {
        if (phase !== "ack" || data.root !== ackRoot || acknowledgments.has(signer)) throw new Error("Deck agreement mismatch");
        acknowledgments.add(signer);
        if (acknowledgments.size === members.length) { game.start(); needShares("hole", game.plan().holes.filter(Boolean).flatMap(h => h.positions)); }
      } else if (op === "shares") {
        if (!["hole", "board", "showdown"].includes(phase)) throw new Error("No cards requested");
        const need = requested.find(r => r.id === signer)?.indices.filter(i => !shares.get(signer)?.has(i)) || [];
        if (!need.length || !Array.isArray(data.shares) || data.shares.length !== need.length) throw new Error("Wrong number of card shares");
        const seen = new Set(), validated = [];
        for (const entry of data.shares) {
          if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid card share");
          const [i, proof] = entry;
          if (!need.includes(i) || seen.has(i) || !await C.shareValid(keys.get(signer), deck[i], shareContext(signer, i), proof)) throw new Error("Unauthorized or invalid card share");
          seen.add(i); validated.push([i, proof]);
        }
        const map = shares.get(signer) || new Map(); for (const [i, proof] of validated) map.set(i, copy(proof)); shares.set(signer, map);
        finishShares();
      } else if (op === "act") {
        if (phase !== "betting" || data.version !== game.version) throw new Error("The table changed; choose your action again");
        game.act(signer, data.action, data.amount); advance();
      } else throw new Error("Unknown table command");
    };
    const submit = async req => {
      if (busy) throw new Error("Table is busy"); busy = true;
      try {
        if (!req || req.table !== table || typeof req.signer !== "string" || !Number.isSafeInteger(req.seq) || req.seq < 1 || !req.data || typeof req.data !== "object" || Array.isArray(req.data)) throw new Error("Invalid command");
        const unsigned = { table: req.table, signer: req.signer, seq: req.seq, op: req.op, data: req.data };
        const id = await C.digest(req), previous = lastRequest.get(req.signer);
        if (previous?.id === id) return;
        if (req.seq !== (counters.get(req.signer) || 0) + 1) throw new Error("Stale or out-of-order command");
        if (!await C.signatureValid(req.signer, "command", unsigned, req.signature)) throw new Error("Invalid command signature");
        if (events.length >= 512 && active(phase)) throw new Error("Hand event limit reached");
        await perform(req);
        counters.set(req.signer, req.seq); lastRequest.set(req.signer, { id });
        if (header) await append(req); else revision++;
        if (req.op === "shuffle" && phase === "ack") ackRoot = root;
      } finally { busy = false; }
    };
    const cancel = async (reason, offender = null) => {
      if (busy || !active(phase)) return false;
      if (!["timeout", "disconnect", "event-limit", "verification"].includes(reason) || offender !== null && !member(offender)) throw new Error("Invalid cancellation");
      if (game.playing) game.abort(); phase = "aborted"; requested = []; canceled = { reason, offender };
      await append({ op: "cancel", reason, offender }); return true;
    };
    const state = viewer => {
      const s = game.snapshot(viewer); if (phase !== "betting") s.legal = null;
      return { table, revision, phase, state: s, context: copy(context), keys: [...keys], deck: copy(deck), aggregate, shuffleAt, ackRoot, acknowledgments: [...acknowledgments],
        requested: copy(requested), plan: game.plan(), shares: [...shares].map(([id, map]) => [id, [...map]]), root, canceled: copy(canceled), counters: [...counters] };
    };
    return { submit, cancel, state, checkpoint, shuffleContext, shareContext,
      summary: () => ({ table, phase, revision, state: game.snapshot() }),
      evictIdle: id => {
        if (active(phase) || busy) throw new Error("Cannot evict during a hand");
        if (!game.snapshot().seats.some(s => s?.id === id)) return;
        game.leave(id); phase = "idle"; header = null; events = []; root = ""; revision++;
      },
      export: (from = 0) => header ? { protocol: C.DOMAIN, table, initial: copy(header), events: copy(events.slice(from)), root } : null,
      get handNonce() { return context?.nonce || ""; }, get eventCount() { return events.length; },
      get revision() { return revision; }, get phase() { return phase; }, get active() { return active(phase); }, get busy() { return busy; }
    };
  };
  const replay = async (record, progress = () => {}) => {
    if (!record || record.protocol !== C.DOMAIN || !validIndex(record.table) || !record.initial || !Array.isArray(record.events) || record.events.length < 1 || record.events.length > 513 || record.events[0].request?.op !== "start") throw new Error("Invalid hand record");
    const match = create(record.table, record.initial);
    for (let i = 0; i < record.events.length; i++) {
      const event = record.events[i];
      if (event.request?.op === "cancel") await match.cancel(event.request.reason, event.request.offender);
      else await match.submit(event.request);
      if (match.state().root !== event.root) throw new Error("Broken hand record at event " + i);
      progress(i + 1, record.events.length);
    }
    if (match.state().root !== record.root) throw new Error("Hand record root mismatch");
    return match;
  };
  BL.pokerMatch = Object.freeze({ create, replay, active });
})();
