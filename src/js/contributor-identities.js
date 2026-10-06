// Confirmed attribution only. Shared unchanged by the page, snapshot bake and Worker.
// These are contribution credits, never OAuth aliases or permission to drive an Ooga.
(() => {
  "use strict";
  const scope = typeof window === "undefined" ? globalThis : window;
  const BL = scope.BL = scope.BL || {};
  // These owners were explicitly confirmed by the maintainer. Display names
  // alone must never add entries to this table.
  const OWNERS = Object.freeze({
    "email:bdb4923572c8ac13": "MrHodlX",
    "email:56537ddd43347582": "MrHodlX",
    "harry": "hotpixelgroup"
  });
  const METRICS = ["commits", "prs", "reviews", "issues", "comments"];
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  const ownerOf = (login) => typeof login === "string" && Object.hasOwn(OWNERS, login.toLowerCase()) ? OWNERS[login.toLowerCase()] : login;
  const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const addCounts = (into, from) => {
    for (const key of METRICS) into[key] = Math.min(Number.MAX_SAFE_INTEGER, (into[key] || 0) + number(from?.[key]));
  };
  const stamp = (value, at) => {
    const n = typeof value === "string" && ISO.test(value) ? Date.parse(value) : NaN;
    return n > 0 && n <= at ? n : 0;
  };
  const mapped = (row) => row && typeof row.login === "string" && ownerOf(row.login) !== row.login;

  const mergeRows = (rows, board, at) => {
    if (!Array.isArray(rows) || !rows.some(mapped)) return rows;
    const groups = new Map();
    for (const row of rows) {
      if (!row || typeof row.login !== "string") continue;
      const login = ownerOf(row.login), key = login.toLowerCase();
      let group = groups.get(key);
      if (!group) { group = []; groups.set(key, group); }
      group.push(row);
    }
    const out = [];
    for (const group of groups.values()) {
      const alias = group.find(mapped);
      if (!alias) { out.push(...group); continue; }
      const login = ownerOf(alias.login);
      if (board) {
        let count = 0;
        for (const row of group) count = Math.min(Number.MAX_SAFE_INTEGER, count + number(row.count));
        out.push({ login, count });
        continue;
      }
      // A bot source's flags/profile must not overwrite its human owner's metadata.
      const canonical = group.find((row) => !mapped(row));
      const merged = { ...canonical, login }, counts = {}, weeks = new Map(), attributed = new Set();
      let first = 0, last = 0, hasCounts = false, hasWeekly = false;
      for (const row of group) {
        const joined = stamp(row.first_seen_at, at), seen = stamp(row.last_seen_at, at);
        if (joined && (!first || joined < first)) first = joined;
        if (seen > last) last = seen;
        if (row.counts) { addCounts(counts, row.counts); hasCounts = true; }
        if (mapped(row)) attributed.add(row.login.toLowerCase());
        if (Array.isArray(row.attributed_logins)) for (const name of row.attributed_logins) if (typeof name === "string") attributed.add(name);
        if (!Array.isArray(row.weekly)) continue;
        hasWeekly = true;
        for (const rowWeek of row.weekly) {
          if (!rowWeek || typeof rowWeek.week !== "string") continue;
          let week = weeks.get(rowWeek.week);
          if (!week) { week = { week: rowWeek.week }; weeks.set(rowWeek.week, week); }
          addCounts(week, rowWeek);
        }
      }
      if (first) merged.first_seen_at = new Date(first).toISOString();
      if (last) merged.last_seen_at = new Date(last).toISOString();
      if (hasCounts) merged.counts = counts;
      if (hasWeekly) merged.weekly = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
      merged.attributed_logins = [...attributed].sort();
      out.push(merged);
    }
    if (board) out.sort((a, b) => number(b.count) - number(a.count) || a.login.localeCompare(b.login));
    return out;
  };

  const normalizeScope = (input, at) => {
    const contributors = mergeRows(input.contributors, false, at);
    let leaderboards = input.leaderboards;
    for (const key of METRICS) {
      const board = mergeRows(input.leaderboards?.[key], true, at);
      if (board === input.leaderboards?.[key]) continue;
      if (leaderboards === input.leaderboards) leaderboards = { ...leaderboards };
      leaderboards[key] = board;
    }
    if (contributors === input.contributors && leaderboards === input.leaderboards) return input;
    let totals = input.totals;
    if (Array.isArray(contributors) && contributors.length !== input.contributors.length && totals) {
      totals = { ...totals, contributors: Math.max(0, number(totals.contributors) - (input.contributors.length - contributors.length)) };
    }
    // Activity totals and repository weekly totals already count these events;
    // only their owners change, so adding to those totals would double-count.
    return { ...input, contributors, leaderboards, totals };
  };
  const normalizeStats = (input, at = Date.now()) => {
    if (input?.meta?.schema_version !== 3 || typeof input.meta.org !== "string" || input.meta.org.toLowerCase() !== "oogaboogax") return input;
    const result = normalizeScope(input, at);
    let repos = input.repos, recent = input.recent;
    if (Array.isArray(repos)) {
      const normalized = repos.map((repo) => normalizeScope(repo, at));
      if (normalized.some((repo, i) => repo !== repos[i])) repos = normalized;
    }
    if (Array.isArray(recent) && recent.some(mapped)) recent = recent.map((row) => mapped(row) ? { ...row, login: ownerOf(row.login) } : row);
    return repos === input.repos && recent === input.recent ? result : { ...result, repos, recent };
  };
  BL.contributorIdentities = { OWNERS, ownerOf, normalizeStats };
})();
