// Oogatron board, ported from rules-without-rulers/oogatron (its jumbotron/data.js + views.js).
// Data baked in as BL.jumbotronData by scripts/jumbotron-data.mjs for the first paint;
// oogatron-live.js may push fresher payloads in through refreshData at runtime.
// jumbotron-data.js is that bake (oogatron schema 3, from /v2/stats), generated and never edited.
//
// The hub board is a cached cabinet with bitmap views: the recent-contributions feed, org totals
// with issue counts, per-repo totals and per-repo commit/PR/review/comment leaderboards. The
// main rotation shows only org panels. Popup readers show org, combined selected-repo, or single-repo
// panels according to their own filters. Navigation is mounted on the frame in cave-sign style:
// paper-white block chevrons on the side rails page, and one clickable indicator dot per slide on
// the bottom rail (the current one lit) jumps. `tapAt(worldRay)` resolves a tap through the
// cabinet's inverted world matrix, answers `screen` for the screen itself so the hub opens the
// shared board dialog (`hud.openBoard`), and pages only from the rails; `prevView`, `goToView` and
// `boardToWorld` do the rest, and any manual change restarts the auto-rotate timer. `canvas`,
// `version`, `index`, `count`, `caption` and `goToView` are all that dialog reads.
// `refreshData` accepts a live payload and the screen geometry it replaces is released, so the
// board stays bounded; the module itself never fetches.
//
// Its 5x7 `FONT` (exported under `text`) is the page's other shared alphabet: the board and the
// Mempool cave's wall panels both set from it, and an unknown character draws as a box.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { box, bevelBox, merge, cached } = BL.models;
  const { createNode, addChild } = BL.scene;
  const { mat4 } = BL.math;

  // Palette extracted from this world's own materials (see oogatron Phase 4).
  const PALETTE = {
    screenBg: "#0a0c0a",
    grid: "#131912",
    text: "#f3efe4",
    dim: "#a6a6a2",
    accent: "#d8892b",
    commits: "#46ff70",
    prs: "#3fd1c5",
    reviews: "#6f9fca",
    comments: "#f5c542",
    issues: "#e5533d",
    plank: "#a9773f",
    woodDark: "#5c4425",
    nail: "#3a2a18",
    woodJoint: "#42301a"
  };

  const BOARD_W = 240, BOARD_H = 108;

  const FONT = {
    A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
    B: [0b11110, 0b10001, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
    C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
    D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
    E: [0b11111, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000, 0b11111],
    F: [0b11111, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000, 0b10000],
    G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
    H: [0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001, 0b10001],
    I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
    J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
    K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
    L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
    M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
    N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
    O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
    Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
    R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
    S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
    T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
    U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
    W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
    X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
    Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
    Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
    0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
    1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
    2: [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
    3: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
    4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
    5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
    6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
    7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
    8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
    9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
    " ": [0, 0, 0, 0, 0, 0, 0],
    "-": [0, 0, 0, 0b01110, 0, 0, 0],
    "_": [0, 0, 0, 0, 0, 0, 0b11111],
    ".": [0, 0, 0, 0, 0, 0b00110, 0b00110],
    "·": [0, 0, 0, 0b00100, 0, 0, 0],
    ",": [0, 0, 0, 0, 0, 0b00100, 0b01000],
    ":": [0, 0b00110, 0b00110, 0, 0b00110, 0b00110, 0],
    "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
    "%": [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
    "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
    ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
    "+": [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
    "*": [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
    "'": [0b00100, 0b00100, 0, 0, 0, 0, 0],
    "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
    "?": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0, 0b00100],
    $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100]
  };
  const FALLBACK_GLYPH = [0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111];
  const GLYPH_W = 5, GLYPH_H = 7, TRACKING = 1;

  const glyphOf = (ch) => FONT[ch.toUpperCase()] || FALLBACK_GLYPH;
  const measureText = (text, scale = 1) =>
    text.length === 0 ? 0 : (text.length * (GLYPH_W + TRACKING) - TRACKING) * scale;
  const drawText = (ctx, text, x, y, color, scale = 1) => {
    ctx.fillStyle = color;
    let cx = x;
    for (const ch of text) {
      const rows = glyphOf(ch);
      for (let r = 0; r < GLYPH_H; r++) {
        const bits = rows[r];
        for (let c = 0; c < GLYPH_W; c++) {
          if (bits & (1 << (GLYPH_W - 1 - c))) ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
        }
      }
      cx += (GLYPH_W + TRACKING) * scale;
    }
  };
  const fitText = (text, maxWidth, scale = 1) => {
    const perChar = (GLYPH_W + TRACKING) * scale;
    const maxChars = Math.max(0, Math.floor((maxWidth + TRACKING * scale) / perChar));
    return text.length <= maxChars ? text : text.slice(0, maxChars);
  };

  const normalizeCounts = (counts) => ({
    commits: (counts && counts.commits || 0) | 0, prs: (counts && counts.prs || 0) | 0,
    reviews: (counts && counts.reviews || 0) | 0, issues: (counts && counts.issues || 0) | 0,
    comments: (counts && counts.comments || 0) | 0
  });
  const normalizeWeekly = (weekly) => Array.isArray(weekly)
    ? weekly.map((w) => ({ week: String(w.week), commits: w.commits | 0, prs: w.prs | 0, reviews: w.reviews | 0, issues: w.issues | 0, comments: w.comments | 0 })).sort((a, b) => a.week < b.week ? -1 : 1)
    : [];
  const normalizeBoard = (b) => Array.isArray(b) ? b.map((e) => ({ login: String(e.login), count: e.count | 0 })) : [];
  const normalizeBoards = (lb) => ({
    commits: normalizeBoard(lb && lb.commits), prs: normalizeBoard(lb && lb.prs),
    reviews: normalizeBoard(lb && lb.reviews), comments: normalizeBoard(lb && lb.comments),
    issues: normalizeBoard(lb && lb.issues)
  });
  // Board rows carry GitHub logins; a character maps its login to the in-game name.
  const displayLabel = (c) => c.login.startsWith("email:") ? "anonymous" : BL.characters.displayOf(c.login);

  // Oogatron schema 3 (/v2/stats): org-wide totals/leaderboards, a per-repo
  // breakdown with its own leaderboards and last activity, plus the recent
  // contributions feed.
  const parseStats = (json) => {
    if (typeof json !== "object" || json === null) throw new Error("stats payload is not an object");
    if (!json.meta || json.meta.schema_version !== 3) throw new Error("unsupported stats schema_version");
    if (!Array.isArray(json.repos)) throw new Error("stats repos is not an array");
    if (!Array.isArray(json.contributors)) throw new Error("stats contributors is not an array");
    json = BL.activityRepos.normalizeStats(json);
    const contributors = json.contributors.map((c) => ({ login: String(c.login) }));
    const byLogin = new Map(contributors.map((c) => [c.login, c]));
    const repos = json.repos.map((r) => {
      const weekly = normalizeWeekly(r.weekly);
      return {
        name: String(r.name),
        totals: { contributors: (r.totals && r.totals.contributors || 0) | 0, ...normalizeCounts(r.totals) },
        lastActivityAt: typeof r.last_activity_at === "string" ? r.last_activity_at : null,
        leaderboards: normalizeBoards(r.leaderboards),
        weeklyTotals: weekly.map((w) => ({ week: w.week, total: w.commits + w.prs + w.reviews + w.issues + w.comments }))
      };
    });
    const recent = (Array.isArray(json.recent) ? json.recent : []).map((e) => ({
      login: String(e.login), repo: String(e.repo), type: String(e.type), occurredAt: String(e.occurred_at),
      draft: e.draft === true
    })).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    // Org-wide weekly series: the repos' weeks summed.
    const weeklyMap = new Map();
    for (const r of repos) {
      for (const w of r.weeklyTotals) {
        let agg = weeklyMap.get(w.week);
        if (!agg) { agg = { week: w.week, total: 0 }; weeklyMap.set(w.week, agg); }
        agg.total += w.total;
      }
    }
    const weeklyTotals = [...weeklyMap.values()].sort((a, b) => a.week < b.week ? -1 : 1);
    return {
      org: String(json.meta.org || ""),
      generatedAt: String(json.meta.generated_at || ""),
      totals: { contributors: json.totals.contributors | 0, ...normalizeCounts(json.totals) },
      leaderboards: normalizeBoards(json.leaderboards),
      repos, recent, contributors, byLogin, weeklyTotals,
      latestWeek: weeklyTotals.length ? weeklyTotals[weeklyTotals.length - 1].week : null
    };
  };

  const clearBoard = (ctx, resolution = 1) => {
    if (ctx.canvas.width !== BOARD_W * resolution || ctx.canvas.height !== BOARD_H * resolution) {
      ctx.canvas.width = BOARD_W * resolution;
      ctx.canvas.height = BOARD_H * resolution;
    }
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    ctx.fillStyle = PALETTE.screenBg;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  };
  const header = (ctx, title, right) => {
    // Repo names can outrun the board (25 glyphs > 192px beside the week label),
    // so every header title truncates to the room the right label leaves.
    const roomForTitle = BOARD_W - 6 - (right ? measureText(right, 1) + 4 : 0);
    drawText(ctx, fitText(title, roomForTitle, 1), 3, 3, PALETTE.accent, 1);
    if (right) drawText(ctx, right, BOARD_W - 3 - measureText(right, 1), 3, PALETTE.dim, 1);
    ctx.fillStyle = PALETTE.dim;
    ctx.fillRect(0, 12, BOARD_W, 1);
  };

  // Shared body for the org (Live Wire) and per-repo totals boards:
  // headline counts left, weekly activity sparkline right.
  const renderTotalsBoard = (ctx, title, right, totals, weeklyTotals) => {
    // Five bitmap pixels per board unit make each 1.4-unit glyph pixel exactly 7 square pixels.
    const resolution = 5, textPixel = 7;
    clearBoard(ctx, resolution);
    header(ctx, title, right);
    const rows = [
      ["CONTRIBUTORS", totals.contributors, PALETTE.accent],
      ["COMMITS", totals.commits, PALETTE.commits],
      ["PRS", totals.prs, PALETTE.prs],
      ["REVIEWS", totals.reviews, PALETTE.reviews],
      ["ISSUES", totals.issues, PALETTE.issues],
      ["COMMENTS", totals.comments, PALETTE.comments]
    ];
    // Draw the same 5x7 glyphs on whole bitmap pixels so their edges stay sharp.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let y = 18;
    for (const [label, value, color] of rows) {
      drawText(ctx, label, 4 * resolution, y * resolution, PALETTE.dim, textPixel);
      const v = String(value);
      drawText(ctx, v, 200 * resolution - measureText(v, textPixel), y * resolution, color, textPixel);
      y += 15;
    }
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    const spark = weeklyTotals.slice(-10);
    if (spark.length > 0) {
      const maxV = Math.max(...spark.map((w) => w.total), 1);
      const chartW = 30, bx = BOARD_W - 2 - chartW, baseY = 103, maxH = 55;
      spark.forEach((w, i) => {
        const h = Math.max(1, Math.round(w.total / maxV * maxH));
        const x0 = bx + Math.floor(i * chartW / spark.length);
        const x1 = bx + Math.floor((i + 1) * chartW / spark.length);
        ctx.fillStyle = i === spark.length - 1 ? PALETTE.accent : PALETTE.commits;
        ctx.fillRect(x0, baseY - h, x1 - x0 - 1, h);
      });
    }
    return false;
  };

  const renderTotals = (ctx, model, params) =>
    renderTotalsBoard(ctx, params?.scope === "multi" ? "MULTI TOTALS" : model.filtered ? "FILTERED TOTALS"
      : `${(model.org || "OOGABOOGAX").toUpperCase()} TOTALS`, model.latestWeek || "", model.totals, model.weeklyTotals);

  const renderRepo = (ctx, model, params) => {
    const repo = model.repos.find((r) => r.name === (params && params.name)) || model.repos[0];
    if (!repo) {
      clearBoard(ctx);
      drawText(ctx, "NO REPOS", 58, 48, PALETTE.dim, 1);
      return false;
    }
    return renderTotalsBoard(ctx, `${repo.name.toUpperCase()} TOTALS`, model.latestWeek || "", repo.totals, repo.weeklyTotals);
  };

  const renderLeaderboard = (ctx, model, params) => {
    const type = params && params.type || "commits";
    // Without a repo param the board uses the current org or multi-repo aggregate.
    const repo = params && params.repo ? model.repos.find((r) => r.name === params.repo) : null;
    const board = (repo ? repo.leaderboards : model.leaderboards)[type] || [];
    const color = PALETTE[type] || PALETTE.accent;
    clearBoard(ctx);
    header(ctx, `${repo ? repo.name.toUpperCase() + " " : params?.scope === "multi" ? "MULTI " : ""}TOP ${type.toUpperCase()}`, model.latestWeek || "");
    const top = board.slice(0, 7);
    const maxV = Math.max(...top.map((e) => e.count), 1);
    let y = 16;
    top.forEach((e, i) => {
      const c = model.byLogin.get(e.login);
      const label = fitText(displayLabel(c || e).toUpperCase(), 66, 1);
      drawText(ctx, String(i + 1), 4, y, i === 0 ? PALETTE.accent : PALETTE.dim, 1);
      drawText(ctx, label, 14, y, PALETTE.text, 1);
      const barX = 84, barMax = BOARD_W - barX - 30;
      ctx.fillStyle = color;
      ctx.fillRect(barX, y + 1, Math.max(1, Math.round(e.count / maxV * barMax)), 5);
      const v = String(e.count);
      drawText(ctx, v, BOARD_W - 4 - measureText(v, 1), y, color, 1);
      y += 13;
    });
    return false;
  };

  const TYPE_COLOR = { commit: "commits", pr: "prs", review: "reviews", merge: "accent", issue: "issues", comment: "comments" };
  const RECENT_TYPES = ["commit", "pr", "review", "merge", "issue", "comment"];
  const ROLLUP_RANK = { merge: 0, pr: 1, commit: 2, review: 3, issue: 4, comment: 5 };
  const rollupRecent = (rows) => {
    const groups = new Map(), rolled = [];
    for (const row of rows) {
      const stamp = Date.parse(row.occurredAt);
      const key = `${row.login}\0${row.repo}`;
      let group = groups.get(key);
      if (!group || !Number.isFinite(stamp) || !Number.isFinite(group.rollupStamp)
          || group.rollupStamp - stamp >= 60000) {
        group = { ...row, rolledCount: 1, rollupStamp: stamp };
        groups.set(key, group);
        rolled.push(group);
        continue;
      }
      group.rolledCount++;
      if (stamp > Date.parse(group.occurredAt)) group.occurredAt = row.occurredAt;
      const rank = ROLLUP_RANK[row.type] ?? 6, previous = ROLLUP_RANK[group.type] ?? 6;
      if (rank < previous || rank === previous && group.draft && !row.draft) {
        group.type = row.type;
        group.draft = row.draft;
      }
    }
    rolled.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
      || (ROLLUP_RANK[a.type] ?? 6) - (ROLLUP_RANK[b.type] ?? 6)
      || a.repo.localeCompare(b.repo) || a.login.localeCompare(b.login));
    return rolled;
  };
  // Short relative age for the recent feed, against wall-clock now.
  const recentAge = (iso, nowMs) => {
    const ms = nowMs - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return "NOW";
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}M`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}H`;
    return `${Math.floor(hours / 24)}D`;
  };

  // The latest ten matching events, newest first, with no age cutoff.
  // Readers filter the complete history before this display limit is applied.
  const renderRecent = (ctx, model, params, nowMs) => {
    clearBoard(ctx);
    header(ctx, params?.title || "RECENT", model.latestWeek || "");
    const rows = params?.rows || model.recent;
    if (!rows.length) {
      drawText(ctx, "NO ACTIVITY", 52, 48, PALETTE.dim, 1);
      return false;
    }
    const recent = rows.slice(0, 10);
    // Keep the ten-row spacing so shorter lists stay at the top.
    const step = (BOARD_H - 4 - GLYPH_H - 16) / 9;
    for (let i = 0; i < recent.length; i++) {
      const e = recent[i], y = Math.round(16 + i * step);
      // A draft PR reads muted: it is announced, not landed.
      const draft = e.type === "pr" && e.draft && !(e.rolledCount > 1);
      const color = draft ? PALETTE.dim : PALETTE[TYPE_COLOR[e.type]] || PALETTE.accent;
      drawText(ctx, fitText(displayLabel(e).toUpperCase(), 72, 1), 4, y, PALETTE.text, 1);
      drawText(ctx, fitText(e.repo.toUpperCase(), 66, 1), 82, y, PALETTE.dim, 1);
      const age = recentAge(e.occurredAt, nowMs);
      const ageX = BOARD_W - 4 - measureText(age, 1);
      const label = draft ? "DRAFT PR" : e.type.toUpperCase() + (e.rolledCount > 1 ? "+" : "");
      const typeX = 158, typeWidth = Math.max(1, ageX - typeX - 4);
      const scale = e.rolledCount > 1 ? Math.min(1, typeWidth / measureText(label)) : 1;
      drawText(ctx, e.rolledCount > 1 ? label : fitText(label, typeWidth, 1), typeX, y + (GLYPH_H * (1 - scale)) / 2, color, scale);
      drawText(ctx, age, ageX, y, PALETTE.dim, 1);
    }
    return false;
  };

  const VIEWS = { recent: renderRecent, totals: renderTotals, repo: renderRepo, leaderboard: renderLeaderboard };
  const SW = 20 / 9, SH = 1, BORDER = 0.16, DEPTH = 0.14, FRAME_D = 0.3;
  // Wide thick frame: lit pixels meet the rails and sit back of them, so edge-on views show wood.
  const RAIL = (SH + 2 * BORDER) / 7.5;
  // DROP = how far the stand reaches below the cabinet's middle, so the hub seats it without copying numbers.
  const LEG_H = 0.306, FOOT_H = 0.06;
  const DROP = (SH + 2 * BORDER) / 2 + LEG_H + FOOT_H / 2;
  // How far the posts reach below DROP, into the ground.
  const POST_BURY = 0.8;
  const OPEN_X = (SW + 2 * BORDER) / 2 - RAIL, OPEN_Y = (SH + 2 * BORDER) / 2 - RAIL;
  const FX = 2 * OPEN_X / SW, FY = 2 * OPEN_Y / SH;
  const CURVE_HALF = (SW + 2 * BORDER + 0.2) / 2, CURVE_SAG = 0.07, CURVE_STEP = CURVE_HALF / 6;
  const curveOffset = (x, curved) => curved ? CURVE_SAG * (x / CURVE_HALF) ** 2 : 0;
  const cabinetGeometry = cached(() => {
    const outerW = SW + 2 * BORDER, outerH = SH + 2 * BORDER;
    const t = RAIL;
    // Rails sit forward of the backing, never flush: coplanar faces make the board sparkle from either side.
    // The rails' faces stay where the chrome and the tap plane expect them (z = 0.02 + DEPTH / 2); the timber
    // grows backwards to FRAME_D, so the cabinet reads as thick bevelled wood like the island's signs.
    const fz = 0.02 + DEPTH / 2 - FRAME_D / 2;
    const parts = [
      // Backing is 0.024 narrower than the rails (0.012 a side): matching their extent flickers coplanar seams.
      // Its back sits 0.02 behind the rails' backs, never flush with them.
      box({ w: outerW - 0.024, h: outerH - 0.024, d: 0.2, color: PALETTE.plank, offset: { z: -0.13 } }),
      bevelBox({ w: outerW - 0.008, h: t, d: FRAME_D, color: PALETTE.woodDark, offset: { y: outerH / 2 - t / 2, z: fz } }),
      bevelBox({ w: outerW - 0.008, h: t, d: FRAME_D, color: PALETTE.woodDark, offset: { y: -(outerH / 2 - t / 2), z: fz } }),
      // Side rails a clear 0.02 shallower front and back than the top and bottom ones they overlap at the corners.
      bevelBox({ w: t, h: outerH - 0.008, d: FRAME_D - 0.04, color: PALETTE.woodDark, bevel: 0.022, offset: { x: outerW / 2 - t / 2, z: fz } }),
      bevelBox({ w: t, h: outerH - 0.008, d: FRAME_D - 0.04, color: PALETTE.woodDark, bevel: 0.022, offset: { x: -(outerW / 2 - t / 2), z: fz } }),
      // A thick cap plank along the top, overhanging the frame like a sign's header.
      bevelBox({ w: outerW + 0.2, h: 0.12, d: FRAME_D + 0.08, color: PALETTE.plank, offset: { y: outerH / 2 + 0.06, z: fz } })
    ];
    // No thin strips: edge-on they fall below a pixel and sparkle against the screen. Depth comes from chunky parts.
    const nx = outerW / 2 - t / 2, ny = outerH / 2 - t / 2;
    for (const [px, py] of [[-nx, ny], [nx, ny], [-nx, -ny], [nx, -ny]]) {
      parts.push(box({ w: 0.1, h: 0.1, d: 0.014, color: PALETTE.woodJoint, offset: { x: px, y: py, z: DEPTH / 2 + 0.025 } }));
      parts.push(box({ w: 0.07, h: 0.07, d: 0.028, color: PALETTE.nail, offset: { x: px, y: py, z: DEPTH / 2 + 0.042 } }));
    }
    const legX = SW / 2 - 0.18, legH = LEG_H, bottom = -outerH / 2;
    for (const sx of [-legX, legX]) {
      // Posts run up into the frame rather than butting flush against its underside, and down past DROP into
      // the ground, so they stay buried on the uneven rim and never show a flush base.
      const postH = legH + FOOT_H + 0.015 + POST_BURY;
      parts.push(bevelBox({ w: 0.2, h: postH, d: 0.2, color: PALETTE.woodDark, offset: { x: sx, y: bottom + 0.015 - postH / 2, z: fz } }));
    }
    return merge(...parts);
  });
  // Clip only the long timber faces into shallow strips before bending them; short joints and posts keep their shape.
  const curvedCabinetGeometry = cached(() => {
    const source = cabinetGeometry(), geo = { verts: [], faces: [], lines: [] }, verts = source.verts;
    const clip = (points, edge, above) => {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const insideA = above ? a[0] >= edge : a[0] <= edge;
        const insideB = above ? b[0] >= edge : b[0] <= edge;
        if (insideA) out.push(a);
        if (insideA !== insideB) {
          const t = (edge - a[0]) / (b[0] - a[0]);
          out.push([edge, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
      return out;
    };
    const append = (points, face) => {
      if (points.length < 3) return;
      const indices = [];
      for (const p of points) {
        indices.push(geo.verts.length / 3);
        geo.verts.push(p[0], p[1], p[2] + curveOffset(p[0], true));
      }
      geo.faces.push({ ...face, i: indices });
    };
    for (const face of source.faces) {
      const points = face.i.map((index) => [verts[index * 3], verts[index * 3 + 1], verts[index * 3 + 2]]);
      let min = Infinity, max = -Infinity;
      for (const p of points) { min = Math.min(min, p[0]); max = Math.max(max, p[0]); }
      if (max - min <= CURVE_STEP) { append(points, face); continue; }
      for (let i = 0; i < 12; i++) {
        const left = -CURVE_HALF + i * CURVE_STEP, right = left + CURVE_STEP;
        if (right <= min || left >= max) continue;
        append(clip(clip(points, left, true), right, false), face);
      }
    }
    return geo;
  });

  // SCREEN_Z sits back of the rails' faces, just clear of the backing behind it.
  const SCREEN_Z = 0.046;
  const CONTENT_Z = 0.053;

  const pushQuad = (geo, x0, x1, y0, y1, z, color, emissive, curved = false, fit = 1) => {
    const steps = curved ? Math.max(1, Math.ceil((x1 - x0) / CURVE_STEP)) : 1;
    for (let i = 0; i < steps; i++) {
      const left = x0 + (x1 - x0) * i / steps, right = x0 + (x1 - x0) * (i + 1) / steps;
      const base = geo.verts.length / 3, zl = z + curveOffset(left * fit, curved), zr = z + curveOffset(right * fit, curved);
      geo.verts.push(left, y0, zl, right, y0, zr, right, y1, zr, left, y1, zl);
      geo.faces.push({ i: [base, base + 1, base + 2, base + 3], color, emissive });
    }
  };

  const screenGeometryFrom = (ctx, curved) => {
    const geo = { verts: [], faces: [], lines: [] };
    const width = ctx.canvas.width, height = ctx.canvas.height;
    const pxW = SW / width, pxH = SH / height;
    // Face colors are 0-255 like models.js hexToRgb; the renderer normalizes at upload.
    pushQuad(geo, -SW / 2, SW / 2, -SH / 2, SH / 2, SCREEN_Z, [10, 12, 10], 0.35, curved, FX);
    const data = ctx.getImageData(0, 0, width, height).data;
    // Skip background (10,12,10) and the scanline tint (19,25,18): it would shimmer at distance.
    const skip = (r, g, b) => (r === 10 && g === 12 && b === 10) || (r === 19 && g === 25 && b === 18);
    for (let y = 0; y < height; y++) {
      const wy0 = SH / 2 - (y + 1) * pxH, wy1 = SH / 2 - y * pxH;
      const row = y * width;
      let x = 0;
      while (x < width) {
        const i = (row + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (skip(r, g, b)) { x++; continue; }
        let run = x + 1;
        while (run < width) {
          const j = (row + run) * 4;
          if (data[j] !== r || data[j + 1] !== g || data[j + 2] !== b) break;
          run++;
        }
        pushQuad(geo, -SW / 2 + x * pxW, -SW / 2 + run * pxW, wy0, wy1, CONTENT_Z, [r, g, b], 0.9, curved, FX);
        x = run;
      }
    }
    geo.castShadow = false; // Thousands of tiny quads have no business in the shadow pass.
    return geo;
  };

  // ---- Frame-mounted navigation chrome -------------------------------------
  // Paper-white square-pixel arrows painted flat on the side rails. Circular indicators on the bottom rail use
  // the popup's dark stone and orange selection colours. Small clearance above the wood avoids coplanar flicker.
  const CHROME_WHITE = [243, 239, 228];
  const DOT_DARK = [45, 43, 40], DOT_ORANGE = [216, 137, 43];
  const OUTER_W = SW + 2 * BORDER, OUTER_H = SH + 2 * BORDER;
  const CHROME_CELL = 0.027, CHROME_PIXEL = 0.0225;
  const ARROW_Z = 0.074, DOT_Z = 0.1, DOT_SIZE = 0.05;
  const RAIL_X = OUTER_W / 2 - RAIL / 2, RAIL_Y = OUTER_H / 2 - RAIL / 2;
  // 4x7 chevrons, rows top-first; mirrored for the right rail.
  const ARROW_LEFT = ["0001", "0010", "0100", "1000", "0100", "0010", "0001"];
  const ARROW_RIGHT = ARROW_LEFT.map((row) => [...row].reverse().join(""));
  const pushBlock = (geo, cx, cy, size, z, color, emissive, curved) => {
    pushQuad(geo, cx - size / 2, cx + size / 2, cy - size / 2, cy + size / 2, z, color, emissive, curved);
  };
  const pushArrow = (geo, rows, cx, curved) => {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== "1") continue;
        const x = cx + (c - (rows[r].length - 1) / 2) * CHROME_CELL;
        const y = ((rows.length - 1) / 2 - r) * CHROME_CELL;
        pushBlock(geo, x, y, CHROME_PIXEL, ARROW_Z, CHROME_WHITE, 0.25, curved);
      }
    }
  };
  const pushDot = (geo, cx, cy, color, emissive, curved) => {
    const base = geo.verts.length / 3, indices = [];
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const x = cx + Math.cos(angle) * DOT_SIZE / 2;
      geo.verts.push(x, cy + Math.sin(angle) * DOT_SIZE / 2, DOT_Z + curveOffset(x, curved));
      indices.push(base + i);
    }
    geo.faces.push({ i: indices, color, emissive });
  };
  // The dot row's geometry and hit-test share this layout; pitch shrinks so
  // the row stays clear of the corner joint plates however long the cycle.
  const dotLayout = (n) => {
    const pitch = Math.max(0.07, Math.min(0.11, (OUTER_W - 0.8) / Math.max(1, n)));
    return { pitch, x0: -((n - 1) * pitch) / 2 };
  };
  const chromeGeometryFrom = (count, current, curved) => {
    const geo = { verts: [], faces: [], lines: [] };
    pushArrow(geo, ARROW_LEFT, -RAIL_X, curved);
    pushArrow(geo, ARROW_RIGHT, RAIL_X, curved);
    const { pitch, x0 } = dotLayout(count);
    for (let i = 0; i < count; i++) {
      const lit = i === current;
      pushDot(geo, x0 + i * pitch, -RAIL_Y, lit ? DOT_ORANGE : DOT_DARK, lit ? 0.9 : 0, curved);
    }
    geo.castShadow = false;
    return geo;
  };

  const create = ({ data, position = { x: 0, y: 0, z: 0 }, ry = 0, scale = 1, width = 1, curved = false } = {}) => {
    const canvas = document.createElement("canvas");
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    // willReadFrequently: each refresh reads the board back; without it Chrome warns and console-clean checks trip.
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });

    let model = null;
    try {
      model = parseStats(data);
    } catch (e) {
      model = null; // Bad data leaves model null (awaiting screen); the island must not break.
    }

    let view = { name: "recent", params: undefined };
    let cycleIndex = 0;
    let rotateEvery = 8;
    let paused = false;
    let lastElapsed = 0;
    let lastSwitchAt = 0;
    let resetRotation = false;
    let dirty = true;
    // All canvases use one minute-aligned age sample, even when painted at different times or paused on RECENT.
    let recentNow = Math.floor(Date.now() / 60000) * 60000;
    // World->local for board taps, cached: the cabinet never moves once placed.
    const tapInverse = new Float32Array(16);
    let tapInverseValid = false;
    const TAP_P = [0, 0, 0], TAP_D = [0, 0, 0];
    const TAP_HIT = { bx: 0, by: 0, lx: 0, ly: 0, t: 0 };

    // The island board and unfiltered readers show org pages. A filtered reader
    // shows either one repo or the combined selection, never both scopes.
    const BOARD_TYPES = ["commits", "prs", "reviews", "comments", "issues"];
    const BOARD_EVENT_TYPES = { commits: "commit", prs: "pr", reviews: "review", comments: "comment", issues: "issue" };
    const buildCycle = (source = model, filtered = false, repoFilter = null) => {
      const types = source?.boardTypes || BOARD_TYPES;
      const repo = repoFilter !== null && source?.repos.length === 1 ? source.repos[0] : null;
      const multi = repoFilter !== null && source?.repos.length > 1;
      const c = [{ name: "recent", params: repo ? { repo: repo.name } : multi ? { scope: "multi" } : undefined }];
      if (repoFilter !== null && !repo && !multi) return c;
      if (repo) {
        if (!source?.typeFiltered) c.push({ name: "repo", params: { name: repo.name } });
        for (const type of types) {
          if (filtered && !repo.leaderboards[type].length) continue;
          c.push({ name: "leaderboard", params: { type, repo: repo.name } });
        }
      } else {
        if (!source?.typeFiltered) c.push({ name: "totals", params: multi ? { scope: "multi" } : undefined });
        for (const type of types) {
          if (filtered && !source.leaderboards[type].length) continue;
          c.push({ name: "leaderboard", params: multi ? { type, scope: "multi" } : { type } });
        }
      }
      return c;
    };
    let cycleViews = buildCycle(model);
    const cycle = () => cycleViews;

    // Build a reader's projection only on a filter edit or a new feed, never per frame.
    const filteredModel = (source, filters) => {
      if (!source || filters.repos === null && filters.users === null && filters.types === null) return source;
      const users = filters.users === null ? null : new Set(filters.users);
      const repos = filters.repos === null ? null : new Set(filters.repos);
      const types = filters.types === null ? null : new Set(filters.types);
      const pickBoards = (boards) => Object.fromEntries(BOARD_TYPES.map((type) =>
        [type, users ? boards[type].filter((row) => users.has(row.login)) : boards[type]]));
      const totalsOf = (boards) => {
        const logins = new Set(), totals = { contributors: 0 };
        for (const type of BOARD_TYPES) {
          totals[type] = 0;
          for (const row of boards[type]) { totals[type] += row.count; logins.add(row.login); }
        }
        totals.contributors = logins.size;
        return totals;
      };
      const selectedRepos = source.repos.filter((repo) => !repos || repos.has(repo.name)).map((repo) => {
        const leaderboards = pickBoards(repo.leaderboards);
        return { ...repo, leaderboards, totals: users ? totalsOf(leaderboards) : repo.totals,
          // The feed has no per-user weekly history; don't show other users' history.
          weeklyTotals: users ? [] : repo.weeklyTotals };
      });
      let leaderboards = pickBoards(source.leaderboards), totals = users ? totalsOf(leaderboards) : source.totals;
      let weeklyTotals = users ? [] : source.weeklyTotals;
      if (repos) {
        leaderboards = {};
        for (const type of BOARD_TYPES) {
          const counts = new Map();
          for (const repo of selectedRepos) for (const row of repo.leaderboards[type]) {
            counts.set(row.login, (counts.get(row.login) || 0) + row.count);
          }
          leaderboards[type] = [...counts].map(([login, count]) => ({ login, count }))
            .sort((a, b) => b.count - a.count || a.login.localeCompare(b.login));
        }
        totals = totalsOf(leaderboards);
        if (!users) for (const type of BOARD_TYPES) totals[type] = selectedRepos.reduce((sum, repo) => sum + repo.totals[type], 0);
        const weeks = new Map();
        for (const repo of selectedRepos) for (const week of repo.weeklyTotals) weeks.set(week.week, (weeks.get(week.week) || 0) + week.total);
        weeklyTotals = [...weeks].map(([week, total]) => ({ week, total })).sort((a, b) => a.week < b.week ? -1 : a.week > b.week ? 1 : 0);
      }
      const boardTypes = types === null ? null : BOARD_TYPES.filter((type) => types.has(BOARD_EVENT_TYPES[type]));
      return { ...source, filtered: true, typeFiltered: types !== null, boardTypes, repos: selectedRepos, leaderboards, totals, weeklyTotals,
        recent: source.recent.filter((row) => (!repos || repos.has(row.repo)) && (!users || users.has(row.login)) && (!types || types.has(row.type))) };
    };

    const renderBoard = () => {
      if (!model) {
        clearBoard(ctx);
        drawText(ctx, "OOGATRON", 62, 44, PALETTE.accent, 2);
        drawText(ctx, "AWAITING DATA", 57, 60, PALETTE.dim, 1);
        return;
      }
      (VIEWS[view.name] || VIEWS.totals)(ctx, model, view.params, recentNow);
    };

    const node = createNode({
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: 0, y: ry, z: 0 },
      scale: { x: scale * width, y: scale, z: scale },
      geometry: curved ? curvedCabinetGeometry() : cabinetGeometry()
    });
    // Drawn at board size then scaled in to clear the rails; z is left alone.
    const screenNode = createNode({ geometry: null, scale: { x: FX, y: FY, z: 1 } });
    addChild(node, screenNode);
    // The navigation chrome lives on the wood frame, unscaled cabinet space.
    const chromeNode = createNode({ geometry: null });
    addChild(node, chromeNode);
    let chromeCount = -1, chromeCurrent = -1;

    const swapGeometry = (target, geometry, renderer) => {
      const old = target.geometry;
      if (old === geometry) return;
      target.geometry = geometry;
      if (old && renderer && renderer.releaseGeometry) renderer.releaseGeometry(old);
    };
    // Counts every repaint of the board, so a copy of it (the hub's close-up) knows when to redraw.
    let version = 0;
    const refresh = (renderer) => {
      renderBoard();
      swapGeometry(screenNode, screenGeometryFrom(ctx, curved), renderer);
      dirty = false;
      version++;
    };
    const refreshChrome = (renderer) => {
      const count = cycle().length;
      const current = cycleIndex % count;
      if (count === chromeCount && current === chromeCurrent) return;
      chromeCount = count;
      chromeCurrent = current;
      swapGeometry(chromeNode, chromeGeometryFrom(count, current, curved), renderer);
    };

    // A world ray -> board pixel, or null off the screen: invert the cabinet's
    // world matrix (the mirror-ripples pattern), intersect the screen plane in
    // local space, then map through the screen fit back to raster coordinates.
    const boardAt = (ray) => {
      if (!tapInverseValid) {
        mat4.invert(tapInverse, node.world);
        tapInverseValid = true;
      }
      mat4.transformPoint(TAP_P, tapInverse, ray.ox, ray.oy, ray.oz);
      TAP_D[0] = tapInverse[0] * ray.dx + tapInverse[4] * ray.dy + tapInverse[8] * ray.dz;
      TAP_D[1] = tapInverse[1] * ray.dx + tapInverse[5] * ray.dy + tapInverse[9] * ray.dz;
      TAP_D[2] = tapInverse[2] * ray.dx + tapInverse[6] * ray.dy + tapInverse[10] * ray.dz;
      if (!TAP_D[2]) return null;
      let t = (SCREEN_Z - TAP_P[2]) / TAP_D[2];
      if (curved) for (let i = 0; i < 3; i++) t = (SCREEN_Z + curveOffset(TAP_P[0] + TAP_D[0] * t, true) - TAP_P[2]) / TAP_D[2];
      if (t < 0) return null;
      const lx = TAP_P[0] + TAP_D[0] * t, ly = TAP_P[1] + TAP_D[1] * t;
      // Anywhere on the cabinet face counts; the linear mapping lets rail
      // taps land outside the 0..BOARD range and regionize naturally. The
      // shared SCREEN_Z plane under-corrects rail parallax by a few board
      // pixels at steep angles — the rail zones are generous enough.
      if (Math.abs(lx) > OUTER_W / 2 + 0.05 || Math.abs(ly) > OUTER_H / 2 + 0.05) return null;
      const bx = (lx / (SW * FX) + 0.5) * BOARD_W;
      const by = (0.5 - ly / (SH * FY)) * BOARD_H;
      TAP_HIT.bx = bx; TAP_HIT.by = by; TAP_HIT.lx = lx; TAP_HIT.ly = ly; TAP_HIT.t = t;
      return TAP_HIT;
    };

    // The slide's name for a caption: the view and, for a repository or a leaderboard, whose.
    const captionOf = (v) => {
      if (v.name === "recent") return v.params?.repo ? `${v.params.repo} · recent`
        : v.params?.scope === "multi" ? "Multi recent" : "Recent activity";
      if (v.name === "totals") return v.params?.scope === "multi" ? "Multi totals" : "Org totals";
      if (v.name === "repo") return `${v.params.name} totals`;
      return `${v.params.repo || (v.params.scope === "multi" ? "multi" : "org")} · ${v.params.type}`;
    };
    const viewParams = (params) => {
      if (!params) return params;
      const normalized = { ...params };
      if (typeof normalized.name === "string") normalized.name = BL.activityRepos.nameOf(normalized.name);
      if (typeof normalized.repo === "string") normalized.repo = BL.activityRepos.nameOf(normalized.repo);
      return normalized;
    };
    const repoFilters = (values) => values === null ? null : [...new Set(values.map(BL.activityRepos.nameOf))];
    const userFilters = (values) => values === null ? null : [...new Set(values.map(BL.contributorIdentities.ownerOf))];
    const indexOfView = (selected, pages = cycle()) => {
      const params = viewParams(selected.params);
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page.name === selected.name && page.params?.name === params?.name
          && page.params?.repo === params?.repo && page.params?.type === params?.type
          && page.params?.scope === params?.scope) return i;
      }
      return 0;
    };
    const api = {
      node,
      canvas,
      get view() { return view; },
      get version() { return version; },
      get index() { return cycleIndex % cycle().length; },
      get count() { return cycle().length; },
      get caption() { return captionOf(view); },
      get paused() { return paused; },
      get cycleSeconds() { return rotateEvery; },
      // Popup readers share the parsed feed, but own only a small bitmap and
      // their page/cycling state. They never build another cabinet or GPU mesh.
      createReader(state = null) {
        const canvas = document.createElement("canvas");
        canvas.width = BOARD_W; canvas.height = BOARD_H;
        const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        let filters = { repos: repoFilters(state?.filters?.repos ?? null), users: userFilters(state?.filters?.users ?? null), types: state?.filters?.types ?? null };
        let rollup = state?.rollup === true;
        let source = filteredModel(model, filters), pages = buildCycle(source, source !== model, filters.repos);
        const recentParams = { rows: [] };
        const refreshRecent = () => {
          recentParams.rows = source ? (rollup ? rollupRecent(source.recent) : source.recent) : [];
          recentParams.title = filters.repos === null ? "RECENT" : source?.repos.length === 1
            ? `${source.repos[0].name.toUpperCase()} RECENT` : source?.repos.length > 1 ? "MULTI RECENT" : "RECENT";
        };
        refreshRecent();
        let index = indexOfView(state ? state.screen : view, pages), selected = pages[index], seenModel = model;
        let filterVersion = 0;
        let paused = state?.paused ?? false, dirty = true, version = 0, switchAt = lastElapsed;
        let shownRecentNow = -1;
        const reader = {
          title: "Oogatron", floating: true, help: "", note: "", canvas,
          get count() { return pages.length; },
          get index() { return index; },
          get view() { return selected; },
          get caption() { return captionOf(selected); },
          get version() { return version; },
          get paused() { return paused; },
          get filters() { return filters; },
          get rollup() { return rollup; },
          get filterVersion() { return filterVersion; },
          get repos() { return model ? model.repos : []; },
          get users() { return model ? model.contributors : []; },
          get types() { return RECENT_TYPES; },
          setFilter(kind, values) {
            filters = { ...filters, [kind]: kind === "repos" ? repoFilters(values) : kind === "users" ? userFilters(values) : values };
            source = filteredModel(model, filters);
            refreshRecent();
            pages = buildCycle(source, source !== model, filters.repos);
            index = indexOfView(selected, pages); selected = pages[index];
            filterVersion++; switchAt = lastElapsed; dirty = true;
          },
          setRollup(value) {
            rollup = value === true;
            refreshRecent();
            switchAt = lastElapsed; dirty = true;
          },
          setPaused(value) { paused = value; switchAt = lastElapsed; },
          go(next) {
            if (!Number.isInteger(next) || next < 0 || next >= pages.length) return;
            index = next; selected = pages[index];
            switchAt = lastElapsed; dirty = true;
          },
          update(elapsed = lastElapsed) {
            if (seenModel !== model) {
              seenModel = model;
              source = filteredModel(model, filters);
              refreshRecent();
              pages = buildCycle(source, source !== model, filters.repos);
              index = indexOfView(selected, pages);
              selected = pages[index];
              filterVersion++;
              dirty = true;
            }
            if (!paused && rotateEvery > 0 && elapsed - switchAt >= rotateEvery) reader.go((index + 1) % pages.length);
            if (selected.name === "recent" && shownRecentNow !== recentNow) dirty = true;
            if (!dirty) return;
            if (source) (VIEWS[selected.name] || VIEWS.totals)(context, source, selected.name === "recent" ? recentParams : selected.params, recentNow);
            else {
              clearBoard(context);
              drawText(context, "AWAITING DATA", 57, 48, PALETTE.dim, 1);
            }
            dirty = false;
            shownRecentNow = recentNow;
            version++;
          },
          dispose() { canvas.width = canvas.height = 0; }
        };
        return reader;
      },
      setPaused(value) {
        paused = value;
        resetRotation = true;
      },
      setView(name, params) {
        if (!VIEWS[name]) return;
        view = { name, params: viewParams(params) };
        resetRotation = dirty = true;
      },
      nextView() {
        const c = cycle();
        cycleIndex = (cycleIndex + 1) % c.length;
        view = c[cycleIndex];
        resetRotation = dirty = true;
      },
      prevView() {
        const c = cycle();
        cycleIndex = (cycleIndex - 1 + c.length) % c.length;
        view = c[cycleIndex];
        resetRotation = dirty = true;
      },
      goToView(index) {
        const c = cycle();
        if (!Number.isInteger(index) || index < 0 || index >= c.length) return;
        cycleIndex = index;
        view = c[cycleIndex];
        resetRotation = dirty = true;
      },
      boardToWorld(bx, by) {
        const out = [0, 0, 0];
        mat4.transformPoint(
          out, node.world,
          (bx / BOARD_W - 0.5) * SW * FX,
          (0.5 - by / BOARD_H) * SH * FY,
          SCREEN_Z + curveOffset((bx / BOARD_W - 0.5) * SW * FX, curved)
        );
        return { x: out[0], y: out[1], z: out[2] };
      },
      pickRay(ray) {
        const hit = boardAt(ray);
        return hit ? hit.t : Infinity;
      },
      // A tap resolved onto the cabinet: the side-rail arrows page, the bottom-rail dots jump to
      // their slide, the top rail or a miss into thin air advances, and the screen itself is left
      // to the caller ("screen": the hub opens its close-up). Returns what it did, for checks.
      tapAt(ray) {
        const hit = boardAt(ray);
        if (!hit) {
          api.nextView();
          return "next";
        }
        if (hit.bx < 0) {
          api.prevView();
          return "prev";
        }
        if (hit.bx > BOARD_W) {
          api.nextView();
          return "next";
        }
        if (hit.by > BOARD_H) {
          const c = cycle();
          const { pitch, x0 } = dotLayout(c.length);
          const index = Math.max(0, Math.min(c.length - 1, Math.round((hit.lx - x0) / pitch)));
          api.goToView(index);
          return `dot:${index}`;
        }
        if (hit.by >= 0) return "screen";
        api.nextView();
        return "next";
      },
      autoRotate(seconds) {
        rotateEvery = seconds > 0 ? seconds : 0;
      },
      // A fresh /v2/stats payload from the live poller; invalid data is
      // ignored so a worker hiccup can never blank the board.
      refreshData(json) {
        let next;
        try {
          next = parseStats(json);
        } catch (e) {
          return false;
        }
        model = next;
        cycleViews = buildCycle(model);
        // A repo view whose repo vanished falls back inside renderRepo.
        dirty = true;
        return true;
      },
      update(elapsed, renderer) {
        lastElapsed = elapsed;
        const now = Math.floor(Date.now() / 60000) * 60000;
        if (now !== recentNow) {
          recentNow = now;
          if (view.name === "recent") dirty = true;
        }
        // Any manual slide change restarts the auto-rotate countdown.
        if (resetRotation) {
          lastSwitchAt = elapsed;
          resetRotation = false;
        }
        if (!paused && rotateEvery > 0 && elapsed - lastSwitchAt >= rotateEvery) {
          lastSwitchAt = elapsed;
          api.nextView();
          resetRotation = false;
        }
        if (dirty) refresh(renderer);
        refreshChrome(renderer);
      },
      dispose(renderer) {
        if (renderer && renderer.releaseGeometry) {
          if (screenNode.geometry) renderer.releaseGeometry(screenNode.geometry);
          if (chromeNode.geometry) renderer.releaseGeometry(chromeNode.geometry);
          if (node.geometry) renderer.releaseGeometry(node.geometry);
        }
        screenNode.geometry = null;
        chromeNode.geometry = null;
        node.geometry = null;
      }
    };
    return api;
  };

  // The 5x7 bitmap font and its helpers are the island's only readable type; the Mempool cave
  // carves its wall panels with the same glyphs so both boards read alike.
  BL.jumbotron = { create, parseStats, PALETTE, DROP, text: { FONT, GLYPH_W, GLYPH_H, TRACKING, glyphOf, measureText, drawText, fitText } };
})();
