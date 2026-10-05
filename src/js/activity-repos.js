// Repository identities shared by the activity board, contributor routing and snapshot bake.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const FOUNDRY = "oogaboogax/lightningfoundry";
  const foundryName = /^lightning[-_]?(?:factory|foundry)$/;
  const nameOf = (name) => {
    const key = String(name).toLowerCase();
    return foundryName.test(key) ? "lightningfoundry" : key;
  };
  const keyOf = (repo) => {
    if (typeof repo !== "string") return null;
    const key = repo.toLowerCase();
    if (key === "w-s-bitcoin/entropylab") return "oogaboogax/entropylab";
    if (/^(?:oogaboogax|drneski)\/lightning[-_]?(?:factory|foundry)$/.test(key)) return FOUNDRY;
    return /^oogaboogax\/[a-z0-9_.-]{1,100}$/.test(key) ? key : null;
  };
  const COUNTS = ["commits", "prs", "reviews", "issues", "comments"];
  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  const countOf = (value) => Number.isFinite(value) ? value : 0;
  const latest = (a, b) => typeof b === "string" && Number.isFinite(Date.parse(b))
    && (!a || !Number.isFinite(Date.parse(a)) || Date.parse(b) > Date.parse(a)) ? b : a;
  const addCounts = (into, from) => {
    for (const type of COUNTS) into[type] = (into[type] || 0) + countOf(from && from[type]);
  };
  const activityAt = (value, at) => {
    const stamp = typeof value === "string" && ISO_TIME.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(stamp) && stamp > 0 && stamp <= at ? stamp : 0;
  };
  // Group repository identities only. Stats omit event IDs, so aliases cannot
  // safely deduplicate historical credits here: preserve every supplied count
  // and recent row, including multiple events sharing an author and timestamp.
  const normalizeStats = (input, at = Date.now()) => {
    input = BL.contributorIdentities.normalizeStats(input, at);
    if (!input || input.meta?.schema_version !== 3 || !Array.isArray(input.repos)) return input;
    const groups = new Map();
    for (const repo of input.repos) {
      const name = nameOf(repo.name);
      let group = groups.get(name);
      if (!group) { group = []; groups.set(name, group); }
      group.push(repo);
    }
    const repos = [];
    for (const [name, group] of groups) {
      if (group.length === 1) { repos.push({ ...group[0], name }); continue; }
      const totals = {}, weeks = new Map(), contributors = new Map(), identities = new Set();
      const boards = Object.fromEntries(COUNTS.map(type => [type, new Map()]));
      let lastActivity = null, reportedContributors = 0;
      for (const repo of group) {
        addCounts(totals, repo.totals);
        reportedContributors = Math.max(reportedContributors, countOf(repo.totals?.contributors));
        lastActivity = latest(lastActivity, repo.last_activity_at);
        for (const row of Array.isArray(repo.weekly) ? repo.weekly : []) {
          const key = String(row.week);
          let week = weeks.get(key);
          if (!week) { week = { week: key }; weeks.set(key, week); }
          addCounts(week, row);
        }
        for (const type of COUNTS) for (const row of Array.isArray(repo.leaderboards?.[type]) ? repo.leaderboards[type] : []) {
          const key = String(row.login).toLowerCase(), board = boards[type];
          let entry = board.get(key);
          if (!entry) { entry = { ...row, login: String(row.login), count: 0 }; board.set(key, entry); }
          entry.count += countOf(row.count);
          identities.add(key);
        }
        for (const row of Array.isArray(repo.contributors) ? repo.contributors : []) {
          const key = String(row.login).toLowerCase(), entry = contributors.get(key);
          if (entry) {
            // Invalid or future alias rows must not hide an accepted activity
            // timestamp when the normalized snapshot later reaches the roster.
            if (activityAt(row.last_seen_at, at) > activityAt(entry.last_seen_at, at)) entry.last_seen_at = row.last_seen_at;
          } else contributors.set(key, { ...row });
          identities.add(key);
        }
      }
      // Older schema-3 rows may omit contributor membership. Leaderboard
      // identities still count, and an unknown reported population stays intact.
      totals.contributors = Math.max(identities.size, reportedContributors);
      repos.push({ ...group[0], name, totals, last_activity_at: lastActivity,
        weekly: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
        leaderboards: Object.fromEntries(COUNTS.map(type => [type, [...boards[type].values()]
          .sort((a, b) => b.count - a.count || a.login.localeCompare(b.login))])),
        contributors: [...contributors.values()] });
    }
    return { ...input, repos, recent: Array.isArray(input.recent)
      ? input.recent.map(row => ({ ...row, repo: nameOf(row.repo) })) : input.recent };
  };
  BL.activityRepos = { FOUNDRY, nameOf, keyOf, normalizeStats };
})();
