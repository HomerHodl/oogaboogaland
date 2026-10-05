// The chain snapshot: one bounded view of the Bitcoin mempool, blocks and mining, assembled from
// whichever source answers. The mempool.space websocket in mempool.js is the live transport for the
// backlog, fee tiers, difficulty, inflow and blocks; this module polls REST for what the socket never
// sends (the fee histogram behind the ladder and the rain, block pace, hashrate) and for everything
// while the socket is down, and holds its own Coinbase socket for the price, with REST behind it.
//
// Two providers, one code path. `/mempool`, `/mempool/recent`, `/blocks` and `/blocks/tip/height`
// return the same shapes from mempool.space and from any Esplora instance, so the fallback is a base
// URL swap; the mempool.space-only endpoints are dropped for ten minutes when they fail and tried
// again after, leaving `/fee-estimates` (same shape on both) to stand in for the fee tiers. Every reader
// tolerates a missing field rather than branching.
//
// Polite by construction: one poll of a kind at a time, each cycle rescheduling from its own
// completion, every failure widening the gap, and Retry-After obeyed when a provider sends one.
//
// Nothing here allocates per frame: the snapshot is one object mutated in place and the fee ladder is
// a fixed typed array. Weather reads the two derived axes at the foot of the snapshot.
//
// The snapshot is the standing view behind the weather, the lake and the Mempool chamber's paintings: backlog, the fee ladder
// in fixed rungs, tip, block pace, difficulty epoch, hashrate and price. The socket's `stats` and
// `fees` land in it (coalesced into one announce a tick later) and stamp `socketAt`, never
// `succeeded`, so a REST provider's backoff and Retry-After stand; while they are fresh, REST
// `/mempool` adds only the histogram and the fee and difficulty endpoints are skipped. REST polls
// only while the tab is visible, and a 200 whose body has no usable shape counts as a failure, not a
// poll. Three consecutive failures swap the base URL to Esplora; the preferred provider is probed
// every fifteen minutes.
//
// `derive` sets two derived readings. `gale` comes from the socket's inflow, the arriving volume, and is zero once
// the socket is stale: it is what makes the Mempool island's weather (rain, cloud and wind; weather.js judges
// its age for itself between derives). `soak` comes from the paying backlog and is kept as data: `paying` is the
// vsize at 1 sat/vB or more (the fee ladder's first rung before normalizing), `payEma` its ten-minute average by
// elapsed time, cached for reloads, and `paySoak` maps it on a log scale from PAY_DRY to PAY_FULL MvB. The whole
// backlog, `vsize`, fills the island's lake (pool-water.js).
//
// The live price is Coinbase Exchange's public `ticker_batch` socket (`readTicker`: `type:
// "ticker"`, strings parsed, `open_24h` as `priceOpenUsd`), subscribed in `onopen` because the feed
// drops a socket not subscribed within five seconds; an `error` or an empty `subscriptions` closes it
// with backoff, and PRICE_STALL of silence (the feed says nothing while the price is flat) redials.
// Only while it is not delivering does the minute REST walk run through PRICE_SOURCES in order of
// measured speed (Coinbase Exchange stats, Kraken, Coinbase spot, mempool.space), so a degraded chain
// source keeps its ticker; the first two carry the day's open (Coinbase's a rolling 24 hours,
// Kraken's today's UTC), and the walk goes on past a found price until the open is known.
//
// `snapshot.live` (a fresh socket push or REST poll) is computed on read, never stored, and the last
// snapshot rides in sessionStorage to paint a reload before the first poll lands. Exports start,
// setHidden, subscribe, dispose, derive and snapshot among others; the director leaves it off under
// `nosim` and `chain=0`, and `chain=esplora` or `chain=https://host/api` pins the provider.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { clamp } = BL.math;
  const MEMPOOL = "https://mempool.space/api", ESPLORA = "https://blockstream.info/api";
  // The backlog drives the weather, so it is polled hardest; the epoch numbers move once a block at most.
  const BACKLOG_MS = 30000, BLOCKS_MS = 60000, PRICE_MS = 60000, SLOW_MS = 600000;
  const TIMEOUT_MS = 12000, FAIL_LIMIT = 3;
  const BACKOFF_MIN = 15000, BACKOFF_MAX = 300000, EXTENDED_RETRY = 600000, PREFER_RETRY = 900000;
  const LADDER = 24, LADDER_MAX = 200;
  const PACE_BLOCKS = 6, TARGET_BLOCK = 600;
  // Socket readings count as live for as long as a REST backlog poll would.
  const FRESH_MS = BACKLOG_MS * 3;
  // Soak is the backlog that pays: vB waiting at 1 sat/vB or more, in MvB, smoothed over ten minutes
  // so the block-by-block sawtooth does not flick it, on a log scale. It no longer makes the rain; it stays
  // a reading. The sub-sat pool beneath it sat at ~40 MvB for months and says nothing about pressure.
  const PAY_DRY = 0.3, PAY_FULL = 4, PAY_TAU = 600000;
  // Gale is the socket's inflow in vB/s, calm below the first and full at the second.
  const INFLOW_CALM = 1000, INFLOW_FULL = 3500;
  // Coinbase Exchange pushes `ticker_batch` every five seconds while the price moves and nothing while
  // it is flat, so only a long silence means a dead socket; the REST walk covers the gap.
  const PRICE_WS = "wss://ws-feed.exchange.coinbase.com", PRICE_STALL = 60000, PRICE_BACKOFF_MIN = 2000, PRICE_BACKOFF_MAX = 60000;
  // Price rides its own providers, not the chain's: the Esplora fallback has no prices endpoint, and
  // tying the two would lose the ticker exactly when the chain source degraded. First one to answer wins.
  // Providers in order of measured speed, the two that carry the day's open first (`open`: Coinbase
  // Exchange's is a rolling 24-hour open, Kraken's `o` today's UTC open), so the up-or-down-today reading
  // normally costs one request; the price-only tickers are the fallbacks.
  const PRICE_SOURCES = [
    { name: "coinbase", url: "https://api.exchange.coinbase.com/products/BTC-USD/stats", read: (d) => Number(d && d.last), open: (d) => Number(d && d.open) },
    { name: "kraken", url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD", read: (d) => Number(d && d.result && d.result.XXBTZUSD && d.result.XXBTZUSD.c && d.result.XXBTZUSD.c[0]), open: (d) => Number(d && d.result && d.result.XXBTZUSD && d.result.XXBTZUSD.o) },
    { name: "coinbase spot", url: "https://api.coinbase.com/v2/prices/BTC-USD/spot", read: (d) => Number(d && d.data && d.data.amount) },
    { name: "mempool.space", url: "https://mempool.space/api/v1/prices", read: (d) => Number(d && d.USD) }
  ];

  // The fee ladder, downsampled from an unbounded histogram into fixed rungs: sat/vB on a log scale
  // against the vsize waiting at or above that rate, normalized to the fullest rung.
  const ladder = new Float32Array(LADDER);
  const ladderRate = new Float32Array(LADDER);
  for (let i = 0; i < LADDER; i++) ladderRate[i] = Math.pow(LADDER_MAX, i / (LADDER - 1));

  const snapshot = {
    source: "mempool.space", at: 0, polls: 0, errors: 0, degraded: false, backoff: 0,
    // Validated field observations, epoch milliseconds; zero means not observed this session.
    // feesAt covers all five recommended tiers, never the independent next-block projection.
    // Legacy readers can replace missing/invalid fields with defaults; those have unknown freshness.
    backlogAt: 0, feesAt: 0, heightAt: 0, priceAt: 0,
    // Mempool backlog
    count: 0, vsize: 0, totalFee: 0, deep: 0, floor: 0, ladder, ladderRate,
    // The paying backlog (MvB at 1 sat/vB or more) and its ten-minute average, stamped when last read
    paying: 0, payEma: 0, payAt: 0,
    // The socket's inflow in vB/s, and when the socket last delivered the backlog
    inflow: 0, socketAt: 0,
    // Fees
    nextFee: 0, fastestFee: 0, halfHourFee: 0, hourFee: 0, economyFee: 0, minimumFee: 0,
    // Chain
    height: 0, lastTxCount: 0, lastWeight: 0, lastSize: 0, lastBlockAt: 0, pace: TARGET_BLOCK,
    // Mining and market
    progressPercent: 0, difficultyChange: 0, remainingBlocks: 0, remainingTime: 0,
    hashrate: 0, difficulty: 0, priceUsd: 0, priceOpenUsd: 0, priceSource: null,
    // Derived weather axes, 0..1
    soak: 0, gale: 0
  };
  const observedNumber = (v) => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v)) && Number(v) >= 0;
  const socketFresh = () => snapshot.socketAt > 0 && Date.now() - snapshot.socketAt < FRESH_MS;
  // Read, never stored: `derive` only runs after a reading lands, so a stored flag on a feed that has
  // stopped entirely would sit there claiming to be live for the rest of the visit.
  Object.defineProperty(snapshot, "live", {
    enumerable: true,
    get: () => socketFresh() || snapshot.at > 0 && Date.now() - snapshot.at < FRESH_MS
  });

  const subscribers = new Set();
  let base = MEMPOOL, fails = 0, pinned = false, backoff = 0;
  // mempool.space's own endpoints, dropped for a while by a failure rather than for the session: one
  // transient 500 must not cost the visit its fee tiers, its difficulty and its hashrate. Infinity is
  // the Esplora fallback, which genuinely does not serve them.
  let extendedUntil = 0, preferAt = 0;
  const extended = () => base === MEMPOOL && Date.now() >= extendedUntil;
  const dropExtended = () => {
    extendedUntil = Date.now() + EXTENDED_RETRY;
  };
  const timers = { backlog: 0, blocks: 0, price: 0, slow: 0, block: 0, emit: 0, priceSocket: 0, priceWatch: 0 };
  let started = false, hidden = false;
  let unsubscribeFeed = null;

  // Announces a change. It does not stamp freshness: a failover or a recovery is news, but it is not
  // data, and `snapshot.at` only ever moves when a poll actually lands (see `succeeded`).
  const emit = () => {
    for (const fn of subscribers) fn(snapshot);
  };
  const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

  const getUrl = async (url) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) {
        // A provider asking us to wait is obeyed, not argued with: 429 and 503 may carry Retry-After.
        const error = new Error(String(res.status));
        error.status = res.status;
        const after = Number(res.headers.get("retry-after"));
        if (after > 0) error.retryAfter = Math.min(BACKOFF_MAX, after * 1000);
        throw error;
      }
      return await res.json();
    } finally {
      window.clearTimeout(timer);
    }
  };
  const get = (path) => getUrl(`${base}${path}`);
  // Three consecutive failures on the preferred provider hand the session to Esplora; a pinned
  // provider never switches, it just keeps failing quietly and the island keeps its last numbers.
  // Every failure pushes the next poll of every kind further out, so a provider that is down or rate
  // limiting is asked less often rather than exactly as often. The first success clears it.
  const failed = (error) => {
    snapshot.errors++;
    const wait = error && error.retryAfter;
    backoff = Math.min(BACKOFF_MAX, wait || (backoff ? backoff * 2 : BACKOFF_MIN));
    snapshot.backoff = backoff;
    // A 429 is an explicit request to stop, so it moves the session at once; anything else has to
    // happen three times running before one bad answer can cost the preferred provider.
    const limited = error && error.status === 429;
    if (pinned || base === ESPLORA || (!limited && ++fails < FAIL_LIMIT)) return;
    base = ESPLORA;
    extendedUntil = Infinity;
    fails = 0;
    preferAt = Date.now() + PREFER_RETRY;
    snapshot.source = "esplora";
    snapshot.degraded = true;
    // The wait was the old provider's request, not the new one's, so the fallback is asked at once.
    // Deferred a tick: this runs inside a poll that still holds its own guard.
    backoff = 0;
    snapshot.backoff = 0;
    emit();
    window.setTimeout(() => {
      pollBacklog();
      pollBlocks();
    }, 0);
  };
  // The fallback is where a session waits, not where it stays. Every so often the preferred provider
  // is probed with its cheapest endpoint, and the moment it answers the session goes home and gets its
  // fee tiers, difficulty and hashrate back. A probe costs one request a quarter hour at most.
  const recover = async () => {
    if (pinned || base !== ESPLORA || Date.now() < preferAt) return;
    preferAt = Date.now() + PREFER_RETRY;
    try {
      const height = await getUrl(`${MEMPOOL}/blocks/tip/height`);
      if (!(Number(height) > 0)) return;
      base = MEMPOOL;
      extendedUntil = 0;
      fails = 0;
      backoff = 0;
      snapshot.backoff = 0;
      snapshot.source = "mempool.space";
      snapshot.degraded = false;
      emit();
      // The fee tiers came back with the provider; fetch them now rather than a cycle from now.
      window.setTimeout(pollBacklog, 0);
    } catch {
      // Still out. The fallback keeps serving and the next window tries again.
    }
  };
  const succeeded = () => {
    fails = 0;
    backoff = 0;
    snapshot.backoff = 0;
    snapshot.polls++;
    snapshot.at = Date.now();
  };

  // vsize at or above each rung, from [feerate, vsize] buckets in descending feerate order.
  const readHistogram = (histogram) => {
    ladder.fill(0);
    snapshot.paying = 0;
    if (!Array.isArray(histogram) || !histogram.length) return;
    let lowest = Infinity, peak = 0;
    for (const bucket of histogram) {
      if (!Array.isArray(bucket) || bucket.length < 2) continue;
      const rate = Number(bucket[0]), size = Number(bucket[1]);
      if (!(rate >= 0) || !(size > 0)) continue;
      if (rate < lowest) lowest = rate;
      for (let i = 0; i < LADDER; i++) if (rate >= ladderRate[i]) ladder[i] += size;
    }
    for (let i = 0; i < LADDER; i++) if (ladder[i] > peak) peak = ladder[i];
    // The first rung is exactly 1 sat/vB, so before normalizing it holds the paying backlog.
    snapshot.paying = ladder[0] / 1e6;
    if (peak > 0) for (let i = 0; i < LADDER; i++) ladder[i] /= peak;
    snapshot.floor = Number.isFinite(lowest) ? lowest : 0;
  };

  // The ten-minute average of the paying backlog, by the time actually elapsed; the first reading seeds it.
  const smoothPaying = (now) => {
    const k = snapshot.payAt > 0 ? 1 - Math.exp(-Math.max(0, now - snapshot.payAt) / PAY_TAU) : 1;
    snapshot.payEma += (snapshot.paying - snapshot.payEma) * k;
    snapshot.payAt = now;
  };
  // While the socket is delivering, REST (which lags it by a few seconds) only adds the histogram and
  // leaves the count, size and fees the socket already holds.
  const readBacklog = (data, histogramOnly = false) => {
    if (!data || typeof data !== "object") return false;
    // Shape, never value: a drained mempool really does report zero, so only a missing field is bad.
    if (typeof data.count !== "number" || typeof data.vsize !== "number") return false;
    if (!histogramOnly) {
      snapshot.backlogAt = Number.isFinite(data.vsize) && data.vsize >= 0 ? Date.now() : 0;
      snapshot.count = data.count | 0;
      snapshot.vsize = Number(data.vsize) || 0;
      snapshot.totalFee = Number(data.total_fee) || 0;
      snapshot.deep = snapshot.vsize / 1e6;
    }
    readHistogram(data.fee_histogram);
    smoothPaying(Date.now());
    return true;
  };
  // Block pace over the recent tip, which both providers can answer.
  const readBlocks = (blocks) => {
    if (!Array.isArray(blocks) || !blocks.length) return false;
    const tip = blocks[0];
    if (tip && tip.height > 0) {
      snapshot.heightAt = Number.isInteger(Number(tip.height)) ? Date.now() : 0;
      snapshot.height = tip.height | 0;
      snapshot.lastTxCount = tip.tx_count | 0;
      snapshot.lastWeight = tip.weight | 0;
      snapshot.lastSize = tip.size | 0;
      snapshot.lastBlockAt = (tip.timestamp | 0) * 1000;
    }
    const span = Math.min(PACE_BLOCKS, blocks.length - 1);
    if (span > 0) {
      const newest = blocks[0].timestamp | 0, oldest = blocks[span].timestamp | 0;
      if (newest > oldest) snapshot.pace = (newest - oldest) / span;
    }
    return true;
  };
  const readFees = (projection) => {
    if (!Array.isArray(projection)) return;
    // An empty projection is an empty mempool, which is free; a missing key holds the last reading.
    const first = projection[0];
    snapshot.nextFee = first && first.medianFee > 0 ? first.medianFee : 0;
  };
  const readRecommended = (fees) => {
    if (!fees || typeof fees !== "object") return;
    snapshot.feesAt = observedNumber(fees.fastestFee) && observedNumber(fees.halfHourFee) && observedNumber(fees.hourFee) && observedNumber(fees.economyFee) && observedNumber(fees.minimumFee) ? Date.now() : 0;
    snapshot.fastestFee = Number(fees.fastestFee) || 0;
    snapshot.halfHourFee = Number(fees.halfHourFee) || 0;
    snapshot.hourFee = Number(fees.hourFee) || 0;
    snapshot.economyFee = Number(fees.economyFee) || 0;
    snapshot.minimumFee = Number(fees.minimumFee) || 0;
  };
  // Esplora's estimates are a confirmation-target map, not tiers; the same five readings come out of it.
  const readEstimates = (est) => {
    if (!est || typeof est !== "object") return;
    snapshot.feesAt = observedNumber(est[1]) && observedNumber(est[3]) && observedNumber(est[6]) && observedNumber(est[144]) && observedNumber(est[1008]) ? Date.now() : 0;
    const at = (t) => Number(est[t]) || 0;
    snapshot.fastestFee = at(1);
    snapshot.halfHourFee = at(3);
    snapshot.hourFee = at(6);
    snapshot.economyFee = at(144);
    snapshot.minimumFee = at(1008);
    if (!snapshot.nextFee) snapshot.nextFee = at(1);
  };
  const readDifficulty = (d) => {
    if (!d || typeof d !== "object") return;
    snapshot.progressPercent = Number(d.progressPercent) || 0;
    snapshot.difficultyChange = Number(d.difficultyChange) || 0;
    snapshot.remainingBlocks = d.remainingBlocks | 0;
    snapshot.remainingTime = Number(d.remainingTime) || 0;
  };
  const readHashrate = (h) => {
    if (!h || typeof h !== "object") return;
    snapshot.hashrate = Number(h.currentHashrate) || 0;
    snapshot.difficulty = Number(h.currentDifficulty) || 0;
  };
  // Walk the price providers in order and keep the first sane answer; a total outage holds the last
  // price rather than blanking the tablet, and nothing about the visitor is ever sent.
  // The day's open comes from the first provider that carries one, so the walk goes on past a price
  // already found until the open is known too.
  const pollPrice = async () => {
    let priced = false, opened = false;
    for (const source of PRICE_SOURCES) {
      if (priced && (opened || !source.open)) continue;
      try {
        const data = await getUrl(source.url);
        const value = source.read(data);
        if (!priced && value > 0) {
          snapshot.priceAt = Number.isFinite(value) ? Date.now() : 0;
          snapshot.priceUsd = value;
          snapshot.priceSource = source.name;
          priced = true;
        }
        if (source.open) {
          const open = source.open(data);
          if (open > 0) {
            snapshot.priceOpenUsd = open;
            opened = true;
          }
        }
        if (priced && opened) return true;
      } catch {
        // Try the next one; a dead ticker must never take the chain poll down with it.
      }
    }
    return priced;
  };

  // The paying backlog in MvB on a log scale, dry at PAY_DRY and a downpour by PAY_FULL.
  const paySoak = (pay) => clamp(Math.log(Math.max(PAY_DRY, pay) / PAY_DRY) / Math.log(PAY_FULL / PAY_DRY), 0, 1);
  // Only the socket measures inflow, so without it the wind drops rather than holding a stale gale.
  const derive = () => {
    snapshot.soak = paySoak(snapshot.payEma);
    snapshot.gale = socketFresh() ? clamp((snapshot.inflow - INFLOW_CALM) / (INFLOW_FULL - INFLOW_CALM), 0, 1) : 0;
  };

  // One poll of a kind at a time. Each takes several requests in sequence and the slowest can outrun
  // its own interval, so without this a slow provider would have requests stacked on it exactly when
  // it is least able to answer them — the shape that gets a client rate limited.
  const busy = { backlog: false, blocks: false, price: false, slow: false };
  const guard = (key, body) => async () => {
    if (busy[key]) return;
    busy[key] = true;
    try {
      await body();
    } finally {
      busy[key] = false;
    }
  };

  const pollBacklog = guard("backlog", async () => {
    try {
      // The socket already carries the count, the projection and the fee tiers; REST adds the histogram.
      const socket = socketFresh();
      if (!readBacklog(await get("/mempool"), socket)) throw new Error("no backlog in the response");
      if (!socket && extended()) {
        try {
          readFees(await get("/v1/fees/mempool-blocks"));
          readRecommended(await get("/v1/fees/recommended"));
        } catch {
          dropExtended();
        }
      }
      if (!socket && !extended()) readEstimates(await get("/fee-estimates"));
      succeeded();
      derive();
      emit();
      save();
    } catch (error) {
      failed(error);
    }
  });
  const pollBlocks = guard("blocks", async () => {
    await recover();
    try {
      if (!readBlocks(await get("/blocks"))) throw new Error("no blocks in the response");
      succeeded();
      derive();
      emit();
      save();
    } catch (error) {
      failed(error);
    }
  });
  // Price is its own minute cycle, whatever the chain provider is doing, so a fallback session keeps
  // its ticker and Ooga Mine's candles move with the real coin; it stands down while the socket prices.
  const pollTicker = guard("price", async () => {
    if (priceFresh() || !(await pollPrice())) return;
    emit();
    save();
  });
  const pollSlow = guard("slow", async () => {
    if (!extended()) return;
    try {
      if (!socketFresh()) readDifficulty(await get("/v1/difficulty-adjustment"));
      readHashrate(await get("/v1/mining/hashrate/3d"));
      succeeded();
      derive();
      emit();
      save();
    } catch {
      dropExtended();
    }
  });

  // Each cycle reschedules from its own completion, not from its start, so a poll can never lap the
  // one before it; `backoff` stretches every gap while a provider is unhappy. The handle is kept so
  // dispose actually stops the cycle instead of clearing an id the last tick already replaced.
  const cycle = (key, poll, ms) => {
    const tick = async () => {
      timers[key] = 0;
      if (visible()) await poll();
      if (started) timers[key] = window.setTimeout(tick, ms + backoff);
    };
    timers[key] = window.setTimeout(tick, ms);
  };

  // One socket message carries both the projection and the stats, so the two readings are announced
  // once, a tick later, rather than twice in the same breath.
  const announce = () => {
    if (timers.emit) return;
    timers.emit = window.setTimeout(() => {
      timers.emit = 0;
      derive();
      emit();
      save();
    }, 0);
  };
  const onFeedEvent = (event) => {
    if (event.type === "stats") {
      snapshot.backlogAt = observedNumber(event.vsize) ? Date.now() : 0;
      snapshot.count = event.count | 0;
      snapshot.vsize = Number(event.vsize) || 0;
      snapshot.totalFee = Number(event.totalFee) || 0;
      snapshot.deep = snapshot.vsize / 1e6;
      snapshot.inflow = Number(event.inflow) || 0;
      readRecommended(event.fees);
      readDifficulty(event.da);
      // Freshness only: the REST provider's failures, backoff and Retry-After are its own business.
      snapshot.socketAt = Date.now();
      announce();
      return;
    }
    if (event.type === "block") {
      snapshot.heightAt = Number.isInteger(Number(event.height)) && Number(event.height) > 0 ? Date.now() : 0;
      snapshot.height = event.height | 0;
      snapshot.lastTxCount = event.txCount | 0;
      snapshot.lastBlockAt = Date.now();
      // A new block empties part of the pool and replaces the tip, so both are refreshed rather than
      // left to their intervals: the socket gives the height at once, but the size, weight and pace
      // behind it only come from /blocks, and a sign showing a new height beside the last block's
      // size is worse than showing neither.
      // A courtesy, not a right: while we are backing off, the block's news waits for the cycle rather
      // than jumping the queue past a provider that asked us to wait.
      if (backoff) return;
      window.clearTimeout(timers.block);
      timers.block = window.setTimeout(() => {
        timers.block = 0;
        pollBacklog();
        pollBlocks();
      }, 1500);
      return;
    }
    if (event.type === "fees") {
      snapshot.nextFee = Number(event.nextFee) || 0;
      announce();
    }
  };

  // Every provider here answers a null origin, so a page opened straight off disk polls like a served
  // one; the suite is held off by `nosim` in director.js, not by the scheme.
  // A reload or a back-navigation repaints from the last snapshot of this session rather than from
  // zeros, and a live poll always follows immediately, so the cache is a first frame and never the
  // answer. `at` comes back with it, which is what keeps `snapshot.live` honest about its age.
  const CACHE_KEY = "oogaboogaland.chain", CACHE_MAX = 600000;
  const CACHED = [
    "count", "vsize", "totalFee", "deep", "floor", "nextFee", "fastestFee", "halfHourFee", "hourFee",
    "economyFee", "minimumFee", "height", "lastTxCount", "lastWeight", "lastSize", "lastBlockAt",
    "pace", "progressPercent", "difficultyChange", "remainingBlocks", "remainingTime", "hashrate",
    "difficulty", "priceUsd", "priceOpenUsd", "paying", "payEma", "payAt"
  ];
  const save = () => {
    try {
      const values = {};
      for (const key of CACHED) values[key] = snapshot[key];
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: snapshot.at, ladder: Array.from(ladder), values }));
    } catch {
      // A private window or a full quota is not a reason to stop reading the chain.
    }
  };
  const restore = () => {
    let held;
    try {
      held = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return false;
    }
    if (!held || !held.values || !(held.at > 0) || Date.now() - held.at > CACHE_MAX) return false;
    for (const key of CACHED) if (typeof held.values[key] === "number") snapshot[key] = held.values[key];
    if (Array.isArray(held.ladder) && held.ladder.length === LADDER) ladder.set(held.ladder);
    // Cache values have no per-field observation proof; do not inherit freshness on restore.
    snapshot.backlogAt = snapshot.feesAt = snapshot.heightAt = snapshot.priceAt = 0;
    snapshot.at = held.at;
    derive();
    return true;
  };

  // The live price: Coinbase Exchange's public `ticker_batch` on one socket while the tab is visible.
  // It subscribes in `onopen`, since the feed drops a socket that has not subscribed within five
  // seconds; a refused subscription leaves the socket open, so an error or an empty channel list is
  // what closes it. Messages carry `type: "ticker"` and their numbers as strings.
  let priceSocket = null, priceBackoff = PRICE_BACKOFF_MIN, priceAt = 0, priceHeardAt = 0;
  const priceFresh = () => priceAt > 0 && Date.now() - priceAt < PRICE_STALL;
  const readTicker = (data) => {
    if (!data || data.type !== "ticker" || data.product_id !== "BTC-USD") return false;
    const price = Number(data.price), open = Number(data.open_24h);
    if (!(price > 0)) return false;
    snapshot.priceUsd = price;
    if (open > 0) snapshot.priceOpenUsd = open;
    snapshot.priceSource = "coinbase live";
    priceAt = Date.now();
    snapshot.priceAt = Number.isFinite(price) ? priceAt : 0;
    return true;
  };
  const dropPrice = () => {
    window.clearTimeout(timers.priceWatch);
    timers.priceWatch = 0;
    if (!priceSocket) return;
    const ws = priceSocket;
    priceSocket = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
  };
  const retryPrice = () => {
    if (!started || hidden || timers.priceSocket) return;
    timers.priceSocket = window.setTimeout(connectPrice, priceBackoff);
    priceBackoff = Math.min(PRICE_BACKOFF_MAX, priceBackoff * 2);
  };
  const onPrice = (text) => {
    priceHeardAt = Date.now();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.type === "error" || data.type === "subscriptions" && !(Array.isArray(data.channels) && data.channels.length)) {
      dropPrice();
      retryPrice();
    } else if (readTicker(data)) {
      priceBackoff = PRICE_BACKOFF_MIN;
      announce();
    }
  };
  const watchPrice = () => {
    timers.priceWatch = 0;
    if (!priceSocket) return;
    if (Date.now() - priceHeardAt > PRICE_STALL) {
      dropPrice();
      retryPrice();
    } else timers.priceWatch = window.setTimeout(watchPrice, PRICE_STALL / 2);
  };
  const connectPrice = () => {
    timers.priceSocket = 0;
    if (!started || hidden || priceSocket || typeof WebSocket === "undefined") return;
    let ws;
    try {
      ws = new WebSocket(PRICE_WS);
    } catch {
      retryPrice();
      return;
    }
    priceSocket = ws;
    ws.onopen = () => {
      priceHeardAt = Date.now();
      ws.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker_batch"] }));
      timers.priceWatch = window.setTimeout(watchPrice, PRICE_STALL / 2);
    };
    ws.onmessage = (e) => onPrice(e.data);
    ws.onclose = () => {
      if (priceSocket === ws) priceSocket = null;
      window.clearTimeout(timers.priceWatch);
      timers.priceWatch = 0;
      retryPrice();
    };
    ws.onerror = () => {};
  };
  // The director's visibility pause: a hidden tab holds no price socket (REST already skips its polls).
  const setHidden = (value) => {
    if (hidden === !!value) return;
    hidden = !!value;
    if (!started) return;
    window.clearTimeout(timers.priceSocket);
    timers.priceSocket = 0;
    if (hidden) dropPrice();
    else {
      priceBackoff = PRICE_BACKOFF_MIN;
      connectPrice();
    }
  };

  const start = (options = {}) => {
    if (started || typeof fetch === "undefined") return;
    started = true;
    // A pinned source is never mempool.space itself, so `extended()` already reads false for it.
    if (options.source === "esplora") { base = ESPLORA; pinned = true; snapshot.source = "esplora"; }
    else if (typeof options.source === "string" && options.source.startsWith("https://")) { base = options.source; pinned = true; snapshot.source = options.source; }
    if (BL.mempool) unsubscribeFeed = BL.mempool.subscribe(onFeedEvent);
    if (restore()) emit();
    connectPrice();
    pollBacklog();
    pollBlocks();
    pollTicker();
    pollSlow();
    cycle("backlog", pollBacklog, BACKLOG_MS);
    cycle("blocks", pollBlocks, BLOCKS_MS);
    cycle("price", pollTicker, PRICE_MS);
    cycle("slow", pollSlow, SLOW_MS);
  };
  const subscribe = (fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  };
  const dispose = () => {
    started = false;
    for (const key of Object.keys(timers)) {
      window.clearTimeout(timers[key]);
      timers[key] = 0;
    }
    dropPrice();
    if (unsubscribeFeed) unsubscribeFeed();
    unsubscribeFeed = null;
    subscribers.clear();
  };

  BL.chain = {
    MEMPOOL, ESPLORA, LADDER, TARGET_BLOCK, PAY_DRY, PAY_FULL, snapshot, start, setHidden, subscribe, dispose, derive,
    paySoak, readBacklog, readBlocks, readFees, readEstimates, readDifficulty, readTicker,
    get extended() { return extended(); }, get backoff() { return backoff; }, get base() { return base; }, recover,
    PRICE_SOURCES, pollPrice, ingest: onFeedEvent
  };
})();
