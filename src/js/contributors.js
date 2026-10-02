// The roster, built from the character registry, with bounded repository activity from oogatron snapshots
// (schemas 1-3; a schema-3 snapshot's `repos[].contributors` fans last-seen onto per-repository keys so
// work routes pick the matching cave). It gives each contributor a working (<1h), chilling (<24h) or
// sleeping state, the active solo roster, and hashed traits with each character's `look` laid over them.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  // Clanking (working) within one hour, chillin until a day has passed,
  // asleep after that. The 60s hub interval re-samples these thresholds.
  const MINUTE = 60 * 1e3, HOUR = 60 * MINUTE, WORK_WINDOW = HOUR, CHILL_WINDOW = 24 * HOUR;
  const ENTROPY = "oogaboogax/entropylab", MAX_REPOS = 64;
  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  // Historical EntropyLab activity; a backend can refresh it with applyActivity.
  // One entry per file in src/characters/, in join order.
  const characters = BL.characters.all();
  // `look.maintainer` marks someone who keeps every project on the island: until
  // the backend reports their commits they are busy in all of them, whatever the
  // clock says (explicit debug roster modes take precedence). Delete the flag once
  // real activity arrives and the dates take over again.
  const roster = characters.map(({ handle, display, lastCommit, look }) => ({ name: handle, display: display || handle, lastCommitAt: lastCommit * 1e3, lastContributionAt: 0, activity: new Map([[ENTROPY, lastCommit * 1e3]]), maintainer: !!(look && look.maintainer) }));
  // Filter construction, not visibility: solo worlds do no work for absent Oogas.
  // Keep the canonical roster intact for activity, likenesses and stable indices.
  const params = new URLSearchParams(location.search);
  const solo = params.has("debug") && (params.get("solo") === "1" || params.get("solo") === "");
  const requestedStatus = params.has("debug") ? params.get("status") : null;
  const debugState = requestedStatus === "clankin" ? "working" : requestedStatus === "chillin" ? "chilling" : requestedStatus === "sleepin" ? "sleeping" : null;
  const character = params.get("character")?.trim().toLowerCase().replace(/^(?:gorilla|clanker)-/, "");
  const activeRoster = solo ? roster.filter((entry) => entry.name.toLowerCase() === character) : roster;
  const byName = new Map(roster.map((contributor) => [contributor.name.toLowerCase(), contributor]));
  characters.forEach((c, i) => { if (c.github) byName.set(c.github.toLowerCase(), roster[i]); });
  const listeners = new Set(), snapshotRepos = new Set();
  const repositoryOf = (repo) => {
    if (typeof repo !== "string") return null;
    const key = repo.toLowerCase();
    if (key === "w-s-bitcoin/entropylab") return ENTROPY;
    return /^oogaboogax\/[a-z0-9_.-]{1,100}$/.test(key) ? key : null;
  };
  // Repeatable debug-only fixture: ooga=handle:clank:lab,obl,lf (or chill/sleep).
  // Unlisted owners sleep; explicit caves replace both activity and maintainer defaults.
  // Resolve handles and cave aliases once, keeping state/site reads allocation-free.
  const debugRoster = params.has("debug") && params.has("ooga"), debugModes = new Map();
  if (debugRoster) {
    const repos = new Map();
    for (const slot of BL.caves.slots) {
      if (!slot.repo || slot.status !== "open" && slot.status !== "mirror") continue;
      repos.set(slot.id, slot.repo);
      repos.set(slot.name.toLowerCase(), slot.repo);
      repos.set(slot.repo, slot.repo);
      repos.set(slot.repo.slice(slot.repo.indexOf("/") + 1), slot.repo);
      repos.set(slot.scene === "factory" ? "lf" : slot.status === "mirror" ? "obl" : slot.scene || slot.status, slot.repo);
    }
    for (const value of params.getAll("ooga")) {
      const [name, mode, caves = ""] = value.toLowerCase().split(":", 3);
      const contributor = byName.get(name.trim());
      if (!contributor) continue;
      const sites = new Set();
      if (mode?.trim() === "clank") for (const cave of caves.split(",", MAX_REPOS)) {
        const key = cave.trim(), repo = repos.get(key) || repos.get(repositoryOf(key));
        if (repo) sites.add(repo);
      }
      const state = mode?.trim() === "clank" && sites.size ? "working" : mode?.trim() === "chill" ? "chilling" : "sleeping";
      debugModes.set(contributor, { state, sites });
    }
  }
  // Callers use the canonical lowercase repository key, keeping frame queries allocation-free.
  const hasRecentActivity = (contributor, repo, at = Date.now()) => {
    if (debugRoster) return debugModes.get(contributor)?.sites.has(repo) || false;
    if (debugState === "working" && repo === ENTROPY) return true;
    if (contributor.maintainer) return true;
    const seen = contributor.activity.get(repo);
    return seen > 0 && seen <= at && at - seen < WORK_WINDOW;
  };
  const stateAt = (stamp, at) => {
    const age = at - stamp;
    if (!Number.isFinite(age) || stamp <= 0 || age < 0) return "sleeping";
    if (age < WORK_WINDOW) return "working";
    return age < CHILL_WINDOW ? "chilling" : "sleeping";
  };
  const stateFor = (contributor, at = Date.now()) => {
    if (debugRoster) return debugModes.get(contributor)?.state || "sleeping";
    if (debugState) return debugState;
    if (contributor.maintainer) return "working";
    return stateAt(contributor.lastCommitAt, at);
  };
  const contributionStateFor = (contributor, at = Date.now()) => stateAt(contributor.lastContributionAt, at);
  const ageAt = (stamp, at) => {
    if (!Number.isFinite(stamp) || stamp <= 0) return "no activity";
    const minutes = Math.max(0, Math.floor((at - stamp) / MINUTE));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };
  const ageLabel = (contributor, at = Date.now()) => contributor.maintainer ? "building" : ageAt(contributor.lastCommitAt, at);
  const contributionAgeLabel = (contributor, at = Date.now()) => ageAt(contributor.lastContributionAt, at);
  const recordContribution = (contributor, stamp) => {
    if (stamp <= contributor.lastContributionAt) return false;
    contributor.lastContributionAt = stamp;
    return true;
  };
  // Rows: { name: GitHub handle, lastCommitAt: Unix milliseconds, repo? }.
  // Keep each repository's newest activity; delayed snapshots cannot rewind it.
  const applyActivity = (rows, at = Date.now()) => {
    if (!Array.isArray(rows) || !Number.isFinite(at)) return 0;
    const changed = new Set();
    for (const row of rows) {
      if (!row || typeof row.name !== "string" || !Number.isFinite(row.lastCommitAt) || row.lastCommitAt <= 0 || row.lastCommitAt > at) continue;
      const contributor = byName.get(row.name.toLowerCase()), repo = repositoryOf(row.repo === undefined ? ENTROPY : row.repo);
      if (!contributor || !repo) continue;
      if (recordContribution(contributor, row.lastCommitAt)) changed.add(contributor);
      const previous = contributor.activity.get(repo);
      if (previous !== undefined ? row.lastCommitAt <= previous : contributor.activity.size >= MAX_REPOS) continue;
      contributor.activity.set(repo, row.lastCommitAt);
      contributor.lastCommitAt = Math.max(contributor.lastCommitAt, row.lastCommitAt);
      changed.add(contributor);
    }
    if (changed.size) for (const notify of listeners) notify();
    return changed.size;
  };
  // Oogatron snapshots, one or an array: schema 2 or 3 (org-wide — the baked
  // jumbotron payload and the live /v2/stats poll) or legacy schema 1 project
  // snapshots keyed by meta.repo. generated_at describes the snapshot, never
  // the contributor's most recent activity. A schema-3 snapshot whose repos
  // carry per-contributor last_seen_at fans out onto each repository key —
  // that is what routes a clanking Ooga to the cave of the repo they actually
  // contributed to. Without that field, org-wide last_seen_at lands on the
  // lab's key as before; either way stateFor (max across repos) gives the
  // same org-wide wake/sleep state.
  const applySnapshot = (snapshots, at = Date.now()) => {
    const rows = [];
    let sourceChanged = false;
    // One sub-snapshot per repository key, so the per-key first-snapshot
    // bookkeeping below stays uniform across all three intake shapes.
    const intakes = [];
    for (const snapshot of Array.isArray(snapshots) ? snapshots : [snapshots]) {
      if (!snapshot || !snapshot.meta) continue;
      const version = snapshot.meta.schema_version;
      if (version === 1) {
        const repo = repositoryOf(snapshot.meta.repo);
        if (repo && Array.isArray(snapshot.contributors)) intakes.push({ repo, contributors: snapshot.contributors });
        continue;
      }
      if (version !== 2 && version !== 3) continue;
      if (typeof snapshot.meta.org !== "string" || snapshot.meta.org.toLowerCase() !== "oogaboogax") continue;
      // The org's latest seen time is authoritative for the roster even when
      // per-repository rows are used separately to route working characters.
      if (Array.isArray(snapshot.contributors)) for (const contributor of snapshot.contributors) {
        if (!contributor || typeof contributor.login !== "string" || typeof contributor.last_seen_at !== "string" || !ISO_TIME.test(contributor.last_seen_at)) continue;
        const stamp = Date.parse(contributor.last_seen_at), entry = byName.get(contributor.login.toLowerCase());
        if (entry && Number.isFinite(stamp) && stamp > 0 && stamp <= at && recordContribution(entry, stamp)) sourceChanged = true;
      }
      const perRepo = version === 3 && Array.isArray(snapshot.repos)
        ? snapshot.repos.filter((r) => r && typeof r.name === "string" && Array.isArray(r.contributors))
        : [];
      if (perRepo.length) {
        for (const r of perRepo) {
          const repo = repositoryOf(`oogaboogax/${r.name}`);
          if (repo) intakes.push({ repo, contributors: r.contributors });
        }
      } else if (Array.isArray(snapshot.contributors)) {
        intakes.push({ repo: ENTROPY, contributors: snapshot.contributors });
      }
    }
    for (const { repo, contributors: list } of intakes) {
      const firstSnapshot = !snapshotRepos.has(repo), accepted = [];
      for (const contributor of list) {
        if (!contributor || typeof contributor.login !== "string" || typeof contributor.last_seen_at !== "string" || !ISO_TIME.test(contributor.last_seen_at)) continue;
        const lastCommitAt = Date.parse(contributor.last_seen_at);
        const entry = byName.get(contributor.login.toLowerCase());
        if (entry && Number.isFinite(lastCommitAt) && lastCommitAt > 0 && lastCommitAt <= at) accepted.push({ entry, name: contributor.login, lastCommitAt, repo });
      }
      // The first authoritative snapshot replaces the bundled historical fallback,
      // even when the fallback happened to be later. Subsequent snapshots still
      // cannot rewind newer activity received during this page session.
      if (accepted.length) {
        if (firstSnapshot) for (const row of accepted) {
          row.entry.activity.delete(repo);
          let latest = 0;
          for (const stamp of row.entry.activity.values()) latest = Math.max(latest, stamp);
          row.entry.lastCommitAt = latest;
        }
        snapshotRepos.add(repo);
        for (const { name, lastCommitAt } of accepted) rows.push({ name, lastCommitAt, repo });
      }
    }
    const updated = applyActivity(rows, at);
    if (sourceChanged && !updated) for (const notify of listeners) notify();
    return updated;
  };
  const subscribe = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };
  // Explicit debug fixture only; the director never calls this on a normal page.
  const seedDebugActivity = (at = Date.now()) => {
    for (let i = 0; i < roster.length; i++) {
      const contributor = roster[i];
      const age = i < 3 ? i * 30000 : i < 6 ? 8 * HOUR + i * 60000 : CHILL_WINDOW;
      contributor.lastCommitAt = at - age;
      contributor.activity.clear();
      contributor.activity.set(ENTROPY, contributor.lastCommitAt);
    }
    for (const notify of listeners) notify();
  };
  const { fnv1a, mulberry32 } = BL.math;
  const voiceFor = (name) => BL.characters.get(name)?.voice || null;
  const SKINS = ["#c98a5b", "#a9744c", "#8a5a3a", "#d9a06b", "#b58057"];
  const HAIRS = ["#2b1b10", "#4a2c14", "#151312", "#5c4425", "#7a2e12"];
  const HAIRS_SLIM = ["#ece5d3", "#e0dac6", "#f2eee2", "#b9dcaa", "#a3d19a"];
  const FURS = ["#d98a2e", "#cc7f28", "#c98936", "#e09a40", "#c27a24", "#d4913a"];
  // A character's look overrides the hashed skin, hair and fur and carries its
  // flags into the traits; its dress hooks go to models.buildCaveman.
  const traitsFor = (name) => {
    const character = BL.characters.get(name);
    const look = character?.look || {};
    const slim = look.build === "slim";
    const rand = mulberry32(fnv1a(name));
    const skin = SKINS[Math.floor(rand() * SKINS.length)];
    const hashedHair = (slim ? HAIRS_SLIM : HAIRS)[Math.floor(rand() * HAIRS.length)];
    const traits = {
      ...look,
      name,
      display: character?.display || name,
      slim,
      skin: look.skin || skin,
      hair: look.hair || hashedHair,
      fur: look.fur || FURS[Math.floor(rand() * FURS.length)],
      height: 0.92 + rand() * 0.24,
      belly: (0.9 + rand() * 0.35) * (slim ? 0.8 : 1),
      rand: mulberry32(fnv1a(name + "/body")),
      dress: character?.dress
    };
    // An explicit stature replaces the hashed one after every draw, so the
    // other hashed traits keep their sequence.
    if (look.height) traits.height = look.height;
    return traits;
  };
  BL.contributors = { roster, activeRoster, solo, debugState, debugRoster, stateFor, ageLabel, contributionStateFor, contributionAgeLabel, traitsFor, voiceFor, hasRecentActivity, applyActivity, applySnapshot, subscribe, seedDebugActivity };
})();
