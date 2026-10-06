// The chamber's wall paintings: the chain read out in pigment on the earth of the room under the lake. Four
// reading stops, one on each flat face the layout cuts into the round wall (`poolLayout.STOPS`): what is waiting,
// what it costs, the newest block, and the difficulty epoch.
//
// Every figure is set in the jumbotron's 5x7 font and merged into quads by `poolModels.panelFrom`, with no backing:
// only the painted pixels become geometry, so the wall shows between the letters. Each row is a label, the reading
// itself at twice the size and its unit, sized to be read from the floor at an Ooga's eye height without opening
// anything; the handprints, figures, bands and tallies beside them are bounded groups that repeat the reading and
// never stand in for it. Ochre, red earth, charcoal and bone; a stop shimmers when its reading changes and settles
// back to matte.
//
// Every reading is bound to its own field of the one `chain.snapshot`, with the freshness of its own category: the
// backlog, the fees and the block each carry a stamp (`backlogAt`, `feesAt`, `heightAt`), zero
// until this session has observed them. Fresh readings use bone pigment; old or restored readings go grey; one never
// seen is a dash, never a zero. An observed zero stays a zero. The epoch's figures carry no stamp of
// their own, so their age is said to be unknown. A new block's weight is held back until the reading that
// belongs to that block arrives, so a height never stands over the last block's details.
//
// A stop's panel is rebuilt only when what it prints changes, and the geometry it replaces is released. Each stop
// also keeps a `board` for the shared board dialog: the same painting on dark stone, with its definitions.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { poolLayout: L, poolModels: P } = BL;
  const { createNode, addChild, removeChild } = BL.scene;
  const { drawText, measureText } = BL.jumbotron.text;

  // Wide enough for the longest label beside the largest reading and its unit, on a stop's 6 m flat face.
  const W = 160, H = 104, PX = 0.033, ROW = 16, TOP = 18, SHIFT = 0.32;
  // A colour no pigment uses: `panelFrom` leaves it out, so the wall shows through.
  const CLEAR = [3, 1, 2], STONE = "#241b14";
  const INK = { ochre: "#d9a441", earth: "#c8643a", bone: "#f1e7cf", dim: "#cdbb96", charcoal: "#8a7c66", stale: "#8d8272", water: "#7cc8ff" };
  // How long a category's last observation counts as live.
  const FRESH_MS = { backlog: 120000, fees: 120000, block: 180000 };
  const PIGMENT = 0.52, SHIMMER_SECONDS = 2.2, REFRESH_SECONDS = 5, WALL = L.CHAMBER_R - 0.03, FOOT = L.FLOOR + 0.85;
  // A new block's own details may take this long to follow its height before they are called missing.
  const DETAIL_MS = 30000;

  const sig = (n) => BL.game.formatThree(n);
  const compact = (n) => BL.game.formatThree(n, true);
  const dec = (n, d) => String(+n.toFixed(d));
  const sat = (n) => BL.game.formatFeeRate(n);
  const grouped = (n) => Math.round(n).toLocaleString("en-US");
  const span = (ms) => ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} S` : ms < 5400000 ? `${Math.round(ms / 60000)} MIN` : `${dec(ms / 3600000, 1)} HRS`;
  const sourceName = (s) => s.source === "mempool.space" ? "MEMPOOL.SPACE" : s.source === "esplora" ? "ESPLORA" : "PINNED SOURCE";
  // A category's standing: "live", "stale", "held" (restored, not yet confirmed) or "none".
  const standing = (stamp, has, now, fresh) => stamp > 0 ? (now - stamp < fresh ? "live" : "stale") : has ? "held" : "none";
  const statusText = (s, state, stamp, now) => state === "live" ? `${sourceName(s)} LIVE` : state === "stale" ? `STALE ${span(now - stamp)}` : state === "held" ? "HELD FROM BEFORE" : "NO READING";
  const valueInk = (state) => state === "live" ? INK.bone : INK.stale;
  // A reading, or a dash where its category has never been seen: an observed zero is still a reading.
  const shown = (state, text) => state === "none" ? "-" : text;

  // Small pixel sprites: a handprint, an Ooga, a spiral.
  const HAND = ["..#.#..", "#.#.#.#", "#.#.#.#", "#######", ".#####.", ".#####.", "..###.."];
  const OOGA = [".###.", "#####", "#####", ".###.", "#####", ".#.#."];
  const SPIRAL = [".####.", "#....#", "#.##.#", "#.#..#", "#.####", "#....."];
  const CLOCK = ["...###...", "...###...", "..#####..", ".##...##.", "##.....##", "#...#...#", "#...##..#", "#....#..#", "##.....##", ".##...##.", "..#####.."];
  const sprite = (c2, rows, x, y, ink) => {
    c2.fillStyle = ink;
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === "#") c2.fillRect(x + c, y + r, 1, 1);
  };
  // One row: its label (and a smaller word under it), then the reading large with its unit, set to the right.
  const row = (c2, i, label, under, value, unit, ink, spacing = ROW) => {
    const y = TOP + i * spacing;
    drawText(c2, label, 2, y, INK.dim, 1);
    if (label === "AVG BLOCK") sprite(c2, CLOCK, 9 + measureText(label, 1), y - 2, INK.dim);
    if (under) drawText(c2, under, 2, y + 8, INK.charcoal, 1);
    const unitW = unit ? measureText(unit, 1) + 3 : 0;
    if (unit) drawText(c2, unit, W - 2 - measureText(unit, 1), y + 7, INK.earth, 1);
    drawText(c2, value, W - 2 - unitW - measureText(value, 2), y, ink, 2);
  };
  // The title with its handprint. Each stop's own figures go beside it, from FIGURES on.
  const FIGURES = 70;
  const heading = (c2, title) => {
    sprite(c2, HAND, 2, 2, INK.earth);
    drawText(c2, title, 12, 3, INK.ochre, 1);
  };

  // The four stops. Each returns the key it printed, so an unchanged reading costs nothing.
  const PAGES = [
    {
      title: "WAITING", caption: "Waiting transactions",
      note: "Transactions waiting for a block. Backlog is their total virtual size in millions of virtual bytes (MvB), and the lake above rises and falls with it. The last two rows show total fees waiting and the projected next-block fee rate.",
      rows: (s, now) => {
        const state = standing(s.backlogAt, s.count > 0 || s.vsize > 0, now, FRESH_MS.backlog), ink = valueInk(state);
        return {
          state, status: statusText(s, state, s.backlogAt, now), figures: state === "none" ? 0 : Math.min(12, Math.ceil(s.deep / 10)), spacing: 20,
          lines: [
            ["WAITING", "", shown(state, compact(s.count)), "TX", ink],
            ["BACKLOG", "", shown(state, sig(s.vsize / 1e6)), "MVB", ink],
            ["FEES WAITING", "", shown(state, compact(s.totalFee)), "SAT", ink],
            ["NEXT BLOCK", `FLOOR ${shown(state, sat(s.floor))}`, shown(state, sat(s.nextFee)), "SAT/VB", ink]
          ]
        };
      },
      extra: (c2, page) => { for (let i = 0; i < page.figures; i++) sprite(c2, OOGA, FIGURES + i * 7, 3, INK.charcoal); }
    },
    {
      title: "FEES", caption: "Fee choices",
      note: "Recommended fee rates in sats per virtual byte (sat/vB): for the next block, within half an hour, within an hour, within a day, and the lowest rate still relayed. They are rates, not amounts: a transaction pays its rate times its own size.",
      rows: (s, now) => {
        const tiers = [s.fastestFee, s.halfHourFee, s.hourFee, s.economyFee, s.minimumFee];
        const state = standing(s.feesAt, tiers.some((t) => t > 0), now, FRESH_MS.fees), ink = valueInk(state);
        return {
          state, status: statusText(s, state, s.feesAt, now), tiers, top: Math.max(1, ...tiers),
          lines: ["FASTEST", "HALF HOUR", "HOUR", "ECONOMY", "MINIMUM"].map((label, i) => [label, "", shown(state, sat(tiers[i])), "SAT/VB", ink])
        };
      },
      // A band under each label, as long as its rate is high.
      extra: (c2, page) => {
        if (page.state === "none") return;
        c2.fillStyle = INK.earth;
        for (let i = 0; i < 5; i++) c2.fillRect(2, TOP + i * ROW + 10, Math.max(2, Math.round(52 * page.tiers[i] / page.top)), 2);
      }
    },
    {
      title: "THE CHAIN", caption: "Newest block",
      note: "The newest block: its height, transaction count, size in bytes (B), kilobytes (KB) or megabytes (MB), weight in millions of weight units (MWU), and the recent pace between blocks.",
      rows: (s, now, detail) => {
        const state = standing(s.heightAt, s.height > 0, now, FRESH_MS.block), ink = valueInk(state);
        const own = detail.height === s.height;
        const size = own && s.lastSize > 0 ? s.lastSize : 0;
        const sizeUnit = size >= 1e6 ? "MB" : size >= 1e3 ? "KB" : size ? "B" : "";
        const sizeScale = size >= 1e6 ? 1e6 : size >= 1e3 ? 1e3 : 1;
        return {
          state, status: statusText(s, state, s.heightAt, now),
          lines: [
            ["BLOCK", "", shown(state, grouped(s.height)), "", ink],
            ["TX COUNT", "", shown(state, s.lastTxCount > 0 ? compact(s.lastTxCount) : "..."), "", ink],
            ["SIZE", "", shown(state, size ? sig(size / sizeScale) : "..."), sizeUnit, ink],
            ["WEIGHT", "", shown(state, own && s.lastWeight > 0 ? sig(s.lastWeight / 1e6) : "..."), "MWU", ink],
            ["PACE", "", shown(state, sig(s.pace / 60)), "MIN", ink]
          ]
        };
      },
      extra: (c2) => {
        c2.fillStyle = INK.charcoal;
        for (let i = 0; i < 6; i++) { c2.fillRect(FIGURES + i * 7, 3, 5, 5); if (i) c2.fillRect(FIGURES - 2 + i * 7, 5, 2, 1); }
      }
    },
    {
      title: "DIFFICULTY", caption: "Difficulty epoch",
      note: "The current 2,016-block difficulty epoch, numbered from zero using the block height; network difficulty in trillions; average time between blocks in this epoch; and the projected change at the next retarget. The difficulty feed has no timestamp of its own, so its age is not known.",
      rows: (s) => {
        const has = s.height > 0 || s.remainingBlocks > 0 || s.progressPercent > 0 || s.difficulty > 0, state = has ? (s.live ? "unknown" : "stale") : "none", ink = state === "unknown" ? INK.bone : INK.stale;
        const retarget = s.remainingBlocks > 0 || s.progressPercent > 0 || s.difficultyChange !== 0;
        return {
          state, status: state === "none" ? "NO READING" : state === "stale" ? "STALE" : "AGE UNKNOWN", percent: s.progressPercent,
          lines: [
            ["DIFF EPOCH", "", s.height > 0 ? grouped(Math.floor(s.height / 2016)) : "-", "", ink],
            ["DIFFICULTY", "", shown(state, s.difficulty ? `${sig(s.difficulty / 1e12)}T` : "-"), "", ink],
            ["AVG BLOCK", "", shown(state, s.avgBlockMs ? sig(s.avgBlockMs / 60000) : "-"), "MIN", ink],
            ["EST RETARGET", "", retarget ? shown(state, `${s.difficultyChange >= 0 ? "+" : ""}${sig(s.difficultyChange)}`) : "-", "%", ink]
          ]
        };
      },
      // A trail of tallies in fives across the top, struck through as far as the epoch has run.
      extra: (c2, page) => {
        sprite(c2, SPIRAL, FIGURES - 10, 2, INK.charcoal);
        if (page.state === "none") return;
        const done = Math.round(Math.max(0, Math.min(100, page.percent)) / 100 * 20);
        for (let i = 0; i < 20; i++) {
          c2.fillStyle = i < done ? INK.ochre : INK.charcoal;
          c2.fillRect(FIGURES + i * 3 + Math.floor(i / 5) * 3, 3, 2, 6);
        }
      }
    }
  ];

  const paint = (c2, page, def, background) => {
    c2.fillStyle = background;
    c2.fillRect(0, 0, W, H);
    heading(c2, def.title);
    def.extra(c2, page);
    for (let i = 0; i < page.lines.length; i++) row(c2, i, ...page.lines[i], page.spacing);
  };

  const create = ({ site, renderer }) => {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    // willReadFrequently: every rebuild reads the panel back, and without it Chrome warns.
    const c2 = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    const clear = `rgb(${CLEAR[0]},${CLEAR[1]},${CLEAR[2]})`, width = W * PX;
    const detail = { height: 0, weight: 0, since: 0 };
    const stops = L.STOPS.map((bearing, i) => {
      const def = PAGES[i], sx = Math.sin(bearing), cz = Math.cos(bearing);
      // The panel is cut facing +z with x to its right: turned to face the room, x runs to the reader's right.
      // The Canvas 2D renderer sorts faces by depth alone: the bias keeps the paint in front of the wall it lies on.
      const x = sx * WALL - cz * SHIFT, z = cz * WALL + sx * SHIFT;
      const node = createNode({ position: { x: x + cz * width / 2, y: FOOT, z: z - sx * width / 2 }, rotation: { x: 0, y: bearing + Math.PI, z: 0 }, sightHidden: true, glow: PIGMENT, depthBias: -0.6 });
      addChild(site.node, node);
      const boardCanvas = document.createElement("canvas");
      boardCanvas.width = W; boardCanvas.height = H;
      const board = {
        title: def.caption, help: "", canvas: boardCanvas, count: 1, index: 0, version: 0, caption: def.caption, note: def.note, wide: true,
        go() {}
      };
      return { index: i, bearing, node, def, printed: "", shimmer: 0, x, y: FOOT + H * PX / 2, z, width, height: H * PX, board, c2: boardCanvas.getContext("2d", { alpha: false }), owner: null };
    });
    let wait = 0, snapshot = null;
    const refresh = (s, now = Date.now()) => {
      snapshot = s;
      // The block's own details: its weight belongs to the height it arrived with, so a height that moves ahead of
      // them shows them as still to come.
      if (s.height !== detail.height && (s.lastWeight !== detail.weight || !detail.height)) { detail.height = s.height; detail.weight = s.lastWeight; detail.since = now; }
      else if (s.height !== detail.height && now - detail.since > DETAIL_MS) detail.since = now;
      for (const stop of stops) {
        const page = stop.def.rows(s, now, detail);
        const key = page.status + "|" + page.lines.map((l) => l[1] + l[2] + l[4]).join("|") + "|" + (page.figures || 0) + (page.percent === undefined ? "" : Math.round(page.percent / 5));
        if (key === stop.printed) continue;
        const first = !stop.printed;
        stop.printed = key;
        paint(c2, page, stop.def, clear);
        if (stop.node.geometry) renderer.releaseGeometry(stop.node.geometry);
        stop.node.geometry = P.panelFrom(c2, W, H, PX, PX, CLEAR);
        paint(stop.c2, page, stop.def, STONE);
        stop.board.version++;
        if (!first) stop.shimmer = 1;
      }
    };
    // Ages move without the feed saying anything, so the stops are read again every few seconds; a reading that
    // changes is painted at once, from the hub's own chain subscription.
    const update = (dt) => {
      wait -= dt;
      if (wait <= 0 && snapshot) { wait = REFRESH_SECONDS; refresh(snapshot); }
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        if (stop.shimmer > 0) stop.shimmer = Math.max(0, stop.shimmer - dt / SHIMMER_SECONDS);
        stop.node.glow = PIGMENT + (1 - PIGMENT) * stop.shimmer * stop.shimmer;
      }
    };
    const dispose = () => {
      for (const stop of stops) {
        if (stop.node.geometry) renderer.releaseGeometry(stop.node.geometry);
        stop.node.geometry = null;
        removeChild(site.node, stop.node);
      }
      stops.length = 0;
      snapshot = null;
    };
    return { stops, refresh, update, dispose };
  };

  BL.poolPaintings = { W, H, PX, PAGES, FRESH_MS, standing, create };
})();
