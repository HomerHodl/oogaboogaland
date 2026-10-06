# Contributor activity

Character status uses real contribution times: **working** ("clanking") for less
than one hour, **chilling** from one to 24 hours, then **sleeping**. Activity in any tracked
OogaBoogaX repository can make an Ooga work; each project keeps its own timestamp so
work routes can choose the corresponding cave. The existing static roster remains a
historical fallback and does not pretend that its old commits just happened.
`?debug=1` leaves these activity-derived states alone. Explicit `status=` and
`ooga=` fixtures override them when requested; `seedDebugActivity()` remains a
test helper for repeatable activity windows.

Roster activity labels use yellow **clankin**, orange **chillin**, and gray **sleepin**.
A separate dot before the name is green when `cave.humanControlled` is true and gray
when offline. The tooltip dot keeps its existing behavior: green for human presence,
otherwise the activity color. Local possession and release update the flag and both
roster readouts immediately, including while sleeping.
A future global presence adapter can update the same flag and call
`crew.refreshRosterRow(cave)`; tooltip status follows it each frame. Presence does
not replace the character's activity state or contribution timestamps.

The Oogatron integration exports `BL.jumbotronData`, an Oogatron schema 3
snapshot (baked from `/v2/stats`), and the live poller pushes the same shape
through `applySnapshot` once a minute, so a sleeper whose contribution lands
wakes and walks out within minutes. A schema-3 snapshot's `repos[].contributors`
rows fan out onto per-repository keys — that is what routes each working Ooga
to the cave of the repo they actually contributed to (a fresh repo with no
cave falls back to the Ooga Booga Land cave). The adapter accepts org-wide
schema 2/3 snapshots, legacy schema 1 project snapshots, or an array of
either:

```js
BL.contributors.applySnapshot({
  meta: { schema_version: 3, org: "OogaBoogaX", generated_at: "2026-09-21T00:00:00Z" },
  contributors: [
    { login: "public-handle", last_seen_at: "2026-09-17T12:34:56Z" }
  ]
});
```

Oogatron returns `last_seen_at`: the latest event time for a contributor's commits,
pull requests, reviews, merges, issue creations, and comments (on issues, pull
request conversations, reviews, and commits alike) — so commenting on a PR or an
issue counts as activity and wakes the character to clanking exactly as a commit
does. `scripts/jumbotron-data.mjs` preserves that field alongside `login`:

```js
last_seen_at: c.last_seen_at,
```

Weekly counts and the snapshot's `generated_at` cannot establish whether someone
contributed within the past hour, so the adapter ignores rows without a valid
activity timestamp. Profile names, email addresses, and avatars are not imported.

The activity adapter is event-type agnostic, so every event type shares the same
one-hour clanking and 24-hour chilling windows through `last_seen_at`.
Oogatron currently stores `mergedAt` in a pull request event's payload but timestamps
that event with the pull request's creation time; an older pull request merged today
therefore still needs an Oogatron-side event/timestamp update to count as activity today.

Repository names normalize to lowercase through `activity-repos.js`. Any
`OogaBoogaX/<repo>` is accepted, with `w-s-bitcoin/entropylab` as the historical
EntropyLab alias. `lightningfactory`, `lightning-foundry`, `lightning-factory`
and underscore variants normalize to `oogaboogax/lightningfoundry`; the old
`drneski` owner is also accepted for those Factory/Foundry names. All aliases
share one activity key, retaining the newest valid timestamp.

The Lightning Factory work site accepts both `oogaboogax/lightningfoundry` and
`oogaboogax/bananapayserver` during normal play. BananaPayServer remains its own
repository in the activity data and boards; it shares the Factory work destination.
An Ooga with recent activity in either repository works at that cave, and its
Clanker follows the same assignment. That activity does not also select the Ooga
Booga Land fallback cave. The existing activity windows still apply.

The baked and live board readers group historical Factory/Foundry names under
`lightningfoundry`, including repository filters and recent-event labels. Grouping
preserves upstream event counts and recent rows, combines weekly and contributor
leaderboards, and unions contributor identities using their newest timestamps.
It does not deduplicate Oogatron's stored events: the public snapshot omits event
IDs, and distinct commits can share a login and timestamp. Any duplicate history
caused by repository renames must be repaired in Oogatron using those IDs.

Confirmed contribution identities normalize through `contributor-identities.js`
before repository grouping. Counts, weekly history, recent-event logins and
activity timestamps roll into the attributed owner without increasing event
totals. Oogatron user filters show the owner once, and saved alias selections map
to that owner. This is contribution attribution, not an OAuth identity alias;
see [Contributor onboarding](contributor-onboarding.md#confirmed-contribution-attribution).

GitHub handles match without case;
the public aliases `ottoz0r` and `drneski` map to the `bc1gui` and `DrNeski`
characters (each declared as `github` in its character file). Unknown handles
do not create new characters through the activity adapter. Merge reconciliation
and the server-verified sign-in fallback handle onboarding separately; see
[Contributor onboarding](contributor-onboarding.md). Each character stores at most 64 repositories.
Malformed, future, repeated, and older timestamps do not replace newer activity.

`BL.contributors.hasRecentActivity(contributor, "oogaboogax/entropylab")` is the
allocation-free work-route query; pass the canonical lowercase repository key.
`stateFor(contributor)` and `ageLabel(contributor)` use the newest timestamp across
projects. The roster orders characters from newest to oldest activity and displays
minute-level ages for the first hour. `subscribe(callback)` reports accepted activity
batches and returns an unsubscribe function. These updates supplement the existing
minute status refresh, which advances every visible age and lets working status expire
without receiving a new event.

The lower-level adapter accepts millisecond timestamps when an upstream provider
has already normalized its data:

```js
BL.contributors.applyActivity([
  { name: "public-handle", repo: "OogaBoogaX/entropylab", lastCommitAt: 1789648496000 }
]);
```

`lastCommitAt` is retained for compatibility and represents the latest supported
contribution, including non-commit events. An omitted `repo` defaults to EntropyLab.

The page paints from a baked snapshot, then polls. The Pages workflow runs on
every push to `rock` and every ten minutes: it fetches `/v2/stats` from the
Oogatron worker, rebuilds the bundled page, and deploys it. While the tab is
visible, `oogatron-live.js` polls the same `/v2/stats` endpoint once a minute and
feeds each payload to the jumbotron and `applySnapshot`; a failed poll keeps the
baked snapshot, and `?oogatron=0` or `?nosim=1` turns polling off. The request is
a plain read-only GET that sends nothing about the visitor. Oogatron's worker
syncs from GitHub every minute, so new activity reaches an open page within a
few minutes. The UI never manufactures recent contribution activity when a row
has no valid timestamp.

Sources: [Oogatron stats contract](https://github.com/rules-without-rulers/oogatron/blob/rock/worker/src/api/stats.ts),
[event timestamp tracking](https://github.com/rules-without-rulers/oogatron/blob/rock/worker/src/sync/identity.ts),
[integration PR](https://github.com/rules-without-rulers/oogaboogaland/pull/1).
