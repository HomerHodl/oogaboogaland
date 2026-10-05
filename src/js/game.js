(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { fnv1a } = BL.math;
  const { HANDLE_MAX, MESSAGE_MAX } = BL.donations;
  const STORAGE_KEY = "oogaboogaland.v1";
  const INVENTORY_MAX = 200;
  const STACK_MAX = 9;
  const LOOT_TIERS = [
    { tier: "legendary", minSats: 100000 },
    { tier: "epic", minSats: 21000 },
    { tier: "rare", minSats: 5000 },
    { tier: "common", minSats: 1000 }
  ];
  const SATS_PER_BANANA = 400;
  const tierFor = (sats) => {
    const found = LOOT_TIERS.find((t) => sats >= t.minSats);
    return found ? found.tier : null;
  };
  // Same donation id always yields the same item.
  const lootFor = (donation, catalog) => {
    const tier = tierFor(donation.sats);
    if (!tier) return null;
    const pool = catalog.filter((item) => item.tier === tier);
    if (!pool.length) return null;
    return { tier, item: pool[fnv1a(`${donation.id}/loot`) % pool.length] };
  };
  const bananasFor = (sats) => Math.max(1, Math.min(12, Math.round(sats / SATS_PER_BANANA)));
  const LARGE_UNITS = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  const formatLarge = (n) => {
    const unit = LARGE_UNITS.find(([size]) => n >= size);
    if (!unit) return String(n);
    const v = n / unit[0];
    return `${v < 10 ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : Math.floor(v)}${unit[1]}`;
  };
  const formatThree = (n, compact = false) => {
    if (!Number.isFinite(n)) return "-";
    const rounded = Number(n.toPrecision(3));
    const unit = compact ? LARGE_UNITS.find(([size]) => Math.abs(rounded) >= size) : null;
    const value = unit ? rounded / unit[0] : rounded;
    const places = value === 0 ? 2 : Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value))));
    return `${value.toFixed(places)}${unit ? unit[1] : ""}`;
  };
  const isString = (v, max) => typeof v === "string" && v.length <= max;
  const isEntry = (e, catalog) => e && typeof e === "object" && isString(e.id, 40) && catalog.some((c) => c.id === e.itemId) && LOOT_TIERS.some((t) => t.tier === e.tier) && isString(e.donationId, 64) && Number.isFinite(e.at);
  const defaults = () => ({ inventory: [], assignments: {}, handle: "", message: "", handFed: 0, totalSats: 0, donations: 0, race: { best: {}, cup: null }, drop: { best: null, jumps: 0 }, orbit: { best: null, build: null }, mine: { best: null }, arcade: { skee: 0, hoops: 0, shy: 0, claw: 0, hockey: 0, billiards: 0, darts: 0, pinball: 0, ride: 0, invaders: 0, snake: 0, pong: 0, stampede: 0, flap: 0, breaker: 0, dash: 0, stacker: 0, tickets: 0, prizes: [] } });
  // Ooga Arcade's carnival bests, each capped past the most its game can score (nine doubled 100s; the round games
  // run on), the retro cabinets' bests (`retro-games.js`, capped past any run), the ticket balance, and the prizes
  // (`ARCADE_PRIZES` ids) redeemed at the counter.
  const ARCADE_MAX = { skee: 1800, hoops: 9999, shy: 999, claw: 400, hockey: 200, billiards: 200, darts: 540, pinball: 9999999, ride: 9999,
    invaders: 50000, snake: 120000, pong: 99999, stampede: 75000, flap: 20000, breaker: 50000, dash: 99999, stacker: 999999 }, TICKETS_MAX = 1e7;
  const ARCADE_PRIZES = ["banana-plush", "coconut-cup", "bone-kazoo", "gold-sticker", "gorilla-plush", "crown"];
  // A drop best is a landing on your feet: a crash keeps its ring points on the card but is never a best.
  const LANDINGS = ["stand", "stumble"];
  const ORBIT_LANDINGS = ["pad", "islet", "island", "land", "sea", "overpressure", "stuck", "heat", "breakup", "burnup", "splat", "crash", "wreck", "debris"];
  const CUP_MEDALS = ["gold", "silver", "bronze"];
  const MINE_ENDINGS = ["goal", "time", "broke", "wrecked", "seized", "left"];
  const isTime = (v) => Number.isFinite(v) && v > 0 && v < 36e5;
  const load = (catalog) => {
    const state = defaults();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return state;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.inventory)) state.inventory = parsed.inventory.filter((e) => isEntry(e, catalog)).slice(0, INVENTORY_MAX);
      if (parsed.assignments && typeof parsed.assignments === "object") {
        for (const [name, entryId] of Object.entries(parsed.assignments)) {
          if (isString(name, 40) && state.inventory.some((e) => e.id === entryId)) state.assignments[name] = entryId;
        }
      }
      if (isString(parsed.handle, HANDLE_MAX)) state.handle = parsed.handle;
      if (isString(parsed.message, MESSAGE_MAX)) state.message = parsed.message;
      for (const key of ["handFed", "totalSats", "donations"]) {
        if (Number.isFinite(parsed[key]) && parsed[key] >= 0) state[key] = Math.floor(parsed[key]);
      }
      if (parsed.race && parsed.race.best && typeof parsed.race.best === "object") {
        for (const [track, b] of Object.entries(parsed.race.best)) {
          if (isString(track, 16) && b && isTime(b.lap) && isTime(b.race)) state.race.best[track] = { lap: Math.floor(b.lap), race: Math.floor(b.race), medal: CUP_MEDALS.includes(b.medal) ? b.medal : null };
        }
      }
      if (parsed.race && parsed.race.cup && CUP_MEDALS.includes(parsed.race.cup.medal) && Number.isFinite(parsed.race.cup.points) && parsed.race.cup.points >= 0) {
        state.race.cup = { medal: parsed.race.cup.medal, points: Math.floor(parsed.race.cup.points) };
      }
      const jumps = parsed.drop && parsed.drop.jumps;
      if (Number.isFinite(jumps) && jumps >= 0 && jumps < 1e7) state.drop.jumps = Math.floor(jumps);
      const d = parsed.drop && parsed.drop.best;
      if (d && Number.isFinite(d.score) && d.score >= 0 && d.score < 1e6 && Number.isFinite(d.rings) && d.rings >= 0 && Number.isFinite(d.ringTotal) && d.ringTotal >= d.rings && d.ringTotal <= 99 && LANDINGS.includes(d.landing)) {
        state.drop.best = { score: Math.floor(d.score), rings: Math.floor(d.rings), ringTotal: Math.floor(d.ringTotal), landing: d.landing };
      }
      const o = parsed.orbit;
      if (o && o.best && Number.isFinite(o.best.score) && o.best.score >= 0 && o.best.score < 1e6 && typeof o.best.orbit === "boolean" && ORBIT_LANDINGS.includes(o.best.landing)) {
        state.orbit.best = { score: Math.floor(o.best.score), orbit: o.best.orbit, landing: o.best.landing };
      }
      const build = o && BL.rocketParts.sanitize(o.build);
      if (build && build.length) state.orbit.build = build;
      const m = parsed.mine && parsed.mine.best;
      if (m && Number.isFinite(m.sats) && m.sats >= 0 && m.sats < 1e15 && Number.isFinite(m.seconds) && m.seconds > 0 && m.seconds <= BL.mineRigs.RUN_SECONDS
        && MINE_ENDINGS.includes(m.ending) && typeof m.won === "boolean" && Number.isFinite(m.score) && m.score >= 0 && m.score < 1e7) {
        state.mine.best = { sats: Math.floor(m.sats), seconds: Math.floor(m.seconds), ending: m.ending, won: m.won, score: Math.floor(m.score), continued: m.continued === true };
      }
      const a = parsed.arcade;
      if (a && typeof a === "object") for (const kind in ARCADE_MAX) {
        if (Number.isFinite(a[kind]) && a[kind] >= 0 && a[kind] <= ARCADE_MAX[kind]) state.arcade[kind] = Math.floor(a[kind]);
      }
      if (a && Number.isFinite(a.tickets) && a.tickets >= 0 && a.tickets <= TICKETS_MAX) state.arcade.tickets = Math.floor(a.tickets);
      if (a && Array.isArray(a.prizes)) state.arcade.prizes = ARCADE_PRIZES.filter((id) => a.prizes.includes(id));
    } catch {
      return defaults();
    }
    return state;
  };
  const save = (state) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable; keep going in memory.
    }
  };
  const create = ({ catalog }) => {
    const state = load(catalog);
    let seq = state.inventory.length;
    const countOf = (itemId) => state.inventory.reduce((n, e) => n + (e.itemId === itemId), 0);
    // Full stacks never roll: a crate only carries an item the locker still has room for.
    const lootForVisitor = (donation) => lootFor(donation, catalog.filter((item) => countOf(item.id) < STACK_MAX));
    const addItem = ({ item, tier, donationId }) => {
      if (countOf(item.id) >= STACK_MAX) return null;
      const entry = { id: `${donationId}/${seq++}`, itemId: item.id, tier, donationId, at: Date.now() };
      state.inventory.push(entry);
      if (state.inventory.length > INVENTORY_MAX) {
        const dropped = state.inventory.shift();
        for (const [name, id] of Object.entries(state.assignments)) if (id === dropped.id) delete state.assignments[name];
      }
      save(state);
      return entry;
    };
    const assign = (entryId, name) => {
      if (!state.inventory.some((e) => e.id === entryId)) return false;
      // One item per caveman, so drop the previous wearer.
      for (const [other, id] of Object.entries(state.assignments)) if (id === entryId) delete state.assignments[other];
      state.assignments[name] = entryId;
      save(state);
      return true;
    };
    const unassign = (name) => {
      delete state.assignments[name];
      save(state);
    };
    const itemOf = (entryId) => {
      const entry = state.inventory.find((e) => e.id === entryId);
      return entry ? catalog.find((c) => c.id === entry.itemId) : null;
    };
    const assignedTo = (entryId) => Object.keys(state.assignments).find((name) => state.assignments[name] === entryId) || null;
    const recordDonation = (donation) => {
      state.totalSats += donation.sats;
      state.donations += 1;
      save(state);
    };
    const recordHandFed = () => {
      state.handFed += 1;
      save(state);
    };
    const resetAll = () => {
      if (BL.mineSim) BL.mineSim.clear();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable, but the reload still resets.
      }
    };
    const clearLoot = () => {
      state.inventory.length = 0;
      for (const name of Object.keys(state.assignments)) delete state.assignments[name];
      save(state);
    };
    // A track's best keeps its best medal too: the medal is earned by place as well as time, so it is
    // not something the times alone can say.
    const recordRace = (track, lap, race, medal = null) => {
      const b = state.race.best[track], rank = (m) => CUP_MEDALS.indexOf(m);
      const bestMedal = b && b.medal && (!medal || rank(b.medal) < rank(medal)) ? b.medal : medal || (b && b.medal) || null;
      const entry = { lap: Math.floor(b && b.lap < lap ? b.lap : lap), race: Math.floor(b && b.race < race ? b.race : race), medal: bestMedal };
      const improved = !b || entry.race < b.race || entry.lap < b.lap || (!!medal && (!b.medal || rank(medal) < rank(b.medal)));
      state.race.best[track] = entry;
      save(state);
      return improved;
    };
    // Best cup finish = a higher medal, or the same medal with more points.
    const recordCup = (place, points) => {
      const medal = CUP_MEDALS[place - 1];
      if (!medal) return false;
      const c = state.race.cup;
      const better = !c || CUP_MEDALS.indexOf(medal) < CUP_MEDALS.indexOf(c.medal) || (medal === c.medal && points > c.points);
      if (better) {
        state.race.cup = { medal, points: Math.floor(points) };
        save(state);
      }
      return better;
    };
    // Every flight counts as a jump; the count seeds the course's shape and numbers the results.
    const recordJump = () => {
      state.drop.jumps = (state.drop.jumps | 0) + 1;
      save(state);
      return state.drop.jumps;
    };
    const recordDrop = ({ score, rings, ringTotal, landing }) => {
      const b = state.drop.best;
      // A lost first jump is not a best.
      if (score <= 0 || !LANDINGS.includes(landing) || (b && b.score >= score)) return false;
      state.drop.best = { score: Math.floor(score), rings, ringTotal, landing };
      save(state);
      return true;
    };
    const recordOrbit = ({ score, orbit, landing }) => {
      const b = state.orbit.best;
      if (b && b.score >= score) return false;
      state.orbit.best = { score: Math.floor(score), orbit, landing };
      save(state);
      return true;
    };
    // A mine run is best by its score: coin mined plus the speed bonus a finished run earns, so a
    // faster win beats a slower one and any win beats a run that ran out of hour. `continued` marks a
    // run that came back from a loss: it can be the best, but it wears no medal.
    const recordMine = ({ sats, seconds, ending, won, score, continued }) => {
      const b = state.mine.best;
      if (b && score <= b.score) return false;
      state.mine.best = { sats: Math.floor(sats), seconds: Math.floor(seconds), ending, won: !!won, score: Math.floor(score), continued: !!continued };
      save(state);
      return true;
    };
    const recordArcade = (kind, score) => {
      if (!(kind in ARCADE_MAX) || !(score > state.arcade[kind])) return false;
      state.arcade[kind] = Math.min(ARCADE_MAX[kind], Math.floor(score));
      save(state);
      return true;
    };
    const addTickets = (n) => {
      state.arcade.tickets = Math.min(TICKETS_MAX, state.arcade.tickets + Math.max(0, Math.floor(n)));
      save(state);
      return state.arcade.tickets;
    };
    // Tickets spent at a machine (the jackpot wheel's spin): false, and nothing spent, when the tickets fall short or
    // the cost is not a whole number above nothing.
    const spendTickets = (n) => {
      if (!Number.isInteger(n) || n <= 0 || state.arcade.tickets < n) return false;
      state.arcade.tickets -= n;
      save(state);
      return true;
    };
    // A prize at the counter: false when it is already won or the tickets fall short.
    const redeem = (id, cost) => {
      if (!ARCADE_PRIZES.includes(id) || state.arcade.prizes.includes(id) || state.arcade.tickets < cost) return false;
      state.arcade.tickets -= cost;
      state.arcade.prizes.push(id);
      save(state);
      return true;
    };
    const setOrbitBuild = (stack) => {
      state.orbit.build = stack.slice();
      save(state);
    };
    const setIdentity = ({ handle, message }) => {
      state.handle = handle;
      state.message = message;
      save(state);
    };
    const forecast = (level, workers, eatRatePerWorker) => {
      const rate = workers * eatRatePerWorker;
      if (rate <= 0) return Infinity;
      return level / rate;
    };
    const formatDuration = (seconds) => {
      if (!Number.isFinite(seconds)) return "stable";
      if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
      if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
      return `${(seconds / 3600).toFixed(1)}h`;
    };
    return { state, countOf, lootFor: lootForVisitor, addItem, assign, unassign, itemOf, assignedTo, clearLoot, resetAll, recordDonation, recordHandFed, recordRace, recordCup, recordJump, recordDrop, recordOrbit, recordMine, recordArcade, addTickets, spendTickets, redeem, setOrbitBuild, setIdentity, forecast, formatDuration };
  };
  BL.game = { create, LOOT_TIERS, STACK_MAX, SATS_PER_BANANA, tierFor, lootFor, bananasFor, formatLarge, formatThree };
})();
