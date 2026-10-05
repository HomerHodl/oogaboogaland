# Contributor onboarding

Oogatron's raw org-wide `/v2/stats` snapshot is the single contributor source.
OBL does not crawl repositories or infer GitHub logins from commit author names,
display names, or email addresses. The raw snapshot includes `first_seen_at`,
which the smaller baked jumbotron payload deliberately omits.
Automatic files and temporary sign-in characters require an integer
`counts.commits >= 1`; issues, comments, reviews and PR activity alone do not qualify.
This threshold does not remove or rewrite existing custom profiles.

## Files after an OBL merge

The Pages workflow checks pushes to `rock` against GitHub's associated PR metadata.
Only a merged PR targeting `rock`, whose merge commit is that push's SHA, runs
`scripts/sync-characters.mjs --merge`. Direct pushes, scheduled Pages refreshes,
manual deployments and merges in other repositories do not create character files.

The reconciliation first validates new/changed character identities and adds any
unambiguous missing `github` mapping. It then loads the merged character registry
and compares both `handle` and `github`, ignoring case, with Oogatron's eligible
logins. A contributor whose first PR includes their character is already present;
no default is added. Existing custom looks, voices, aliases and dates are preserved.
Missing contributors get `src/characters/<lowercase-login>.js` with only their
handle and Oogatron's first/last contribution times. Their appearance hashes from
the same handle at build time and during a temporary session.

The deploy job remains read-only with checkout credentials disabled. It builds
with the new files and uploads them with the page and refreshed jumbotron bake.
The existing separate artifact job is the only job with `contents: write`; it
commits those files with the page. Its bot commit does not recursively reconcile.
A concurrent branch change can make that push fail safely; rerun the failed
workflow after reviewing the newer branch, rather than force-pushing an artifact.

No network fetch occurs during an ordinary `npm run build`. For a manual,
reproducible reconciliation, `node scripts/sync-characters.mjs <raw-stats.json>`
uses a saved snapshot. This is a maintainer command, not the normal merge trigger.
Reconciliation refuses to grow past 128 bundled characters; increase that budget
only after reviewing crew performance and the room's NPC-frame limit together.

## Filtering

`worker/src/contributor-policy.js` is shared by the generator and Worker lookup.
After applying the confirmed attributions below, it rejects remaining unresolved
`email:…` identities, invalid login syntax, bot flags or
non-User account types when supplied, invalid/future dates, and snapshots older
than a day. It deduplicates casing and preserves the earliest first contribution
and latest last contribution. The exact exclusion list includes the AI author
aliases currently present in Oogatron (`claude` and `codex`) and known automation
names. It does not guess from substrings such as `bot` in a human's name.

Oogatron currently does not supply a verified account type for every contributor.
Consequently this cannot detect every automated account using a normal GitHub
user profile. Maintain the exact exclusions when new automation identities are
found; ideally Oogatron should expose verified account IDs/types and identity
provenance. Human contributors using AI tools remain eligible.

## Confirmed contribution attribution

`src/js/contributor-identities.js` holds the explicit attribution table shared by
the page, snapshot bake, merge generator and Worker. The maintainer confirmed
`email:bdb4923572c8ac13` and `email:56537ddd43347582` as `MrHodlX`.
Their counts, weekly history and first/last activity roll into that login, and
their recent-event labels and leaderboard entries use it too. OBL's Oogatron user
filter shows only the attributed owner; existing alias selections resolve to that
owner. Source logins remain in `attributed_logins` for auditing.

Normalization is idempotent and leaves org/repository event totals unchanged.
It does not remove events or modify the upstream Oogatron database. Shared labels
such as `claude` and `codex` remain separate until event-level evidence identifies
their owners; a display name alone never creates an attribution. Credits do not
create OAuth aliases or grant an alias permission to drive the owner's character.
Changes to the attribution table or identity-check policy require an OBL maintainer
with Maintain/Admin permission, enforced by the trusted-base PR check.

## Identity ownership and aliases

The established convention is unchanged: `handle` is the character's name,
`github` is the optional owning GitHub login, and `display` is cosmetic. With no
`github`, the owner is `handle`. For example, `bc1gui.js` declares `handle:
"bc1gui"` and `github: "ottoz0r"`.

The **Character identity ownership** check runs on every PR targeting `rock`,
using the checker from the trusted base SHA. It fetches PR character sources as
text, parses literal declarations, and never executes PR JavaScript. The check:

- Warns when a filename or character handle is an alias for a different login.
- For a single new profile by an ordinary contributor, adds their PR-author
  GitHub login as `github` during merge reconciliation if it was omitted and the
  name differs. The PR warning explains the correction before merge.
- Rejects a new explicit owner other than the PR author, or transferring an
  existing character from another owner. Deleting another owner's character is
  also rejected. Appearance edits require the same owner or maintainer authority.
- Checks both old and new identities on renames, and rejects duplicate handles
  and owner aliases across files, ignoring case.
- Allows cross-owner administration only when GitHub reports the PR author's
  repository role as `maintain` or permission as `admin`. Write access or past
  contributions alone do not grant this exception. A maintainer creating a
  profile with no `github` keeps the declared handle as its owner.
- Rejects ambiguous batches by ordinary contributors unless owners are explicit.
  There is no blanket bot/pipeline exception; a future non-GitHub pipeline needs
  a separately designed trusted authorization path.

Identity fields must be literal strings in one `BL.characters.add({ ... })`
object. Duplicate fields, computed identity keys, spreads and getters are refused.
This is an identity guard, not a general JavaScript security scanner: code changes
still require review, especially changes to the registry, auth or policy itself.

**Repository setup:** after this workflow lands on `rock`, make **Character
identity ownership** a required check in its branch ruleset, require PRs and an
up-to-date branch, and restrict bypasses to maintainers. Without required checks,
GitHub can still permit a failing PR to merge; reconciliation will refuse it but
cannot undo the merge. The first PR installing a trusted-base checker cannot run
that checker from a base branch where it does not yet exist.

## Signing in before the next merge

GitHub OAuth still supplies the authenticated identity; only a `User` profile is
accepted. `/api/me` and `/room` independently look up that login in the same
filtered Oogatron snapshot. Lookups coalesce and cache for one minute per Worker
isolate, run only on requests, time out after four seconds, and grant no new
identity on failure. No background polling, new secret or D1 migration is needed
for sign-in. The separate [character bundle pipeline](character-bundles.md) uses
a repository-scoped GitHub App for protected daily and manual-review PRs.

Before building the first scene, the browser waits for the bounded account lookup
(at most six seconds) and can register one temporary default character matching
the signed-in login. Existing characters and aliases win. The hub's existing
ownership flow selects it. The room accepts that default body only for its verified
owner, persists eligibility in its socket attachment, and refuses arbitrary body
names. Client-supplied identity headers are stripped before the Worker sets them.

The temporary character is excluded from shared NPC frames, so the bundled crew's
signature stays identical across visitors. Other players see the driven character
through the existing remote-player pool. The next deployed bundle replaces the
temporary default with its generated file and the same deterministic appearance.
Changing its casing, handle or appearance later is an intentional customization.

This sign-in feature needs a Cloudflare Worker deployment. The existing staging
and production deployment workflows remain manual; merging alone does not deploy
either Worker. GitHub Pages and local files continue to run without an account
backend. A newly recorded contributor may need to reload after Oogatron's next
snapshot/cache refresh; an upstream outage leaves existing sign-in and characters
available without granting an unverified new character.

## Validation

The Worker suite includes filtering, cache/outage behavior, alias deduplication,
declarative identity parsing, author authorization, runtime roster registration
and room ownership checks. Repository testing defaults to `wait`: build and
syntax checks only until the maintainer requests the suite. Play-test a new
eligible login alongside an existing signed-in visitor, scene return trips,
sign-out, a reconnect and the first larger generated roster before rollout.
