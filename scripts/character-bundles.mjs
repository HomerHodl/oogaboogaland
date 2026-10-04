// Trusted-base GitHub Actions coordinator. No checkout/build of submitted code.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGitHub } from "./character-github.mjs";
import { BOT, OPERATORS, isOperator } from "./character-operators.mjs";
import { CharacterRejection, touchesCharacters } from "./character-safety.mjs";
import { LANES, manifestPath, branchPrefix, dayOf, due, inspectSubmission, readManifest, checkRegistry, isBundle, validateBundle, reviewDecision } from "./character-submissions.mjs";

const serializable = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "source"));
const manifestText = (state) => JSON.stringify(state, null, 2) + "\n";
const STATUS = "Character intake";
const BUNDLE_STATUS = "Character bundle safety";
const IDENTITY_STATUS = "Character identity ownership";
const title = (lane) => lane === "daily" ? "Daily character updates · automatic at midnight UTC" : "Character updates · maintainer review required";
const body = (lane, state) => [
  lane === "daily" ? "Validated data-only character changes. Eligible nonempty bundles merge at the first successful run after midnight UTC." : "Custom character code. A maintainer must review the exact diff and merge this PR manually. The automation never merges this lane.",
  "An empty bundle stays open for the next submission. The manifest is bookkeeping, not a character contribution.",
  ...state.entries.map((entry) => `- ${entry.path} — ${entry.pr ? `#${entry.pr}` : "standalone commit"} at ${entry.head}`)
].join("\n\n");

export const createCoordinator = (gh, bot, now = () => new Date()) => {
  if (!/^[A-Za-z0-9-]+\[bot\]$/.test(bot || "")) throw new Error("Set CHARACTER_BOT_LOGIN to the automation's bot login");
  const ref = async (branch) => (await gh.api(`git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  const status = (sha, context, state, description) => gh.api(`statuses/${sha}`, "POST", { context, state, description: description.slice(0, 140) });
  const comment = async (number, key, message) => {
    const marker = `<!-- obl-character-bundle:${key} -->`;
    const comments = await gh.list(`issues/${number}/comments`);
    if (!comments.some((row) => row.user.login === bot && row.body.includes(marker))) await gh.api(`issues/${number}/comments`, "POST", { body: `${marker}\n${message}` });
  };
  const deployMerged = async (pr) => {
    // GITHUB_TOKEN merges suppress push workflows. A durable marker permits
    // recovery if a run stops after merging; duplicate dispatches are harmless.
    if (bot !== BOT || !isBundle(pr, bot) || !pr.merged_at || pr.merged_by?.login !== bot) return;
    const key = `build-${pr.merge_commit_sha}`, marker = `<!-- obl-character-bundle:${key} -->`;
    if ((await gh.list(`issues/${pr.number}/comments`)).some((row) => row.user.login === bot && row.body.includes(marker))) return;
    await gh.api("actions/workflows/pages.yml/dispatches", "POST", { ref: "rock", inputs: { merge_sha: pr.merge_commit_sha } });
    await comment(pr.number, key, "Post-merge Pages build and contributor reconciliation dispatched.");
  };
  const openBundles = async () => (await gh.list("pulls?state=open&base=rock")).filter((pr) => isBundle(pr, bot));
  const rejectSubmission = async (pr, submission, error) => {
    await status(submission.head, STATUS, "failure", error instanceof CharacterRejection ? error.message : "Scan unavailable or conflicted; retry or ask a maintainer");
    // A timeout, rate limit or base conflict is not evidence of malicious code.
    if (!(error instanceof CharacterRejection) || !pr) throw error;
    if ((await gh.api(`pulls/${pr.number}`)).head.sha !== submission.head) throw new Error("PR changed before rejection; retry");
    await comment(pr.number, `rejected-${submission.head}`, `This character submission was not accepted: ${error.message}\n\nNo submitted code was executed. This is a policy finding, not a claim about intent. Correct the issue and reopen, or contact an OBL maintainer for security review.`);
    await gh.api(`pulls/${pr.number}`, "PATCH", { state: "closed" });
  };
  const ensure = async (lane) => {
    const found = (await openBundles()).filter((pr) => pr.head.ref.startsWith(branchPrefix(lane)));
    if (found.length > 1) throw new Error("Multiple open bundles for one lane; maintainer reconciliation required");
    if (found.length) {
      const pr = await gh.api(`pulls/${found[0].number}`);
      if (bot !== BOT && pr.user.login === BOT) {
        const head = await gh.api(`commits/${pr.head.sha}`);
        if (head.author?.login === BOT) {
          const checked = await validateBundle(gh, pr, BOT, await ref("rock"));
          if (checked.entries.length) throw new Error("Only empty Actions placeholders can be adopted automatically");
          await gh.commit(pr.head.ref, pr.head.sha, [{ path: manifestPath(lane), source: manifestText({ ...checked.state, automation: bot }) }], [], `Adopt empty ${lane} bundle with repository App`);
          return gh.api(`pulls/${pr.number}`);
        }
      }
      return pr;
    }
    const rock = await ref("rock"), branch = `${branchPrefix(lane)}${rock.slice(0, 12)}`;
    let existing = await gh.api(`git/ref/heads/${encodeURIComponent(branch)}`, "GET", undefined, true);
    if (!existing) existing = await gh.api("git/refs", "POST", { ref: `refs/heads/${branch}`, sha: rock });
    const current = existing.object.sha;
    const previous = await gh.file(current, manifestPath(lane), 262144);
    // Resume creation after an interrupted run, but do not reuse a manually
    // closed bundle or accept a branch somebody else pre-populated.
    const closed = await gh.list(`pulls?state=closed&head=${gh.repo.split("/")[0]}:${branch}`);
    if (closed.length) throw new Error("Bundle branch was closed without a new rock commit; maintainer review required");
    if (current !== rock) {
      const commit = await gh.api(`commits/${current}`);
      if (commit.author?.login !== bot || !commit.commit.verification?.verified) throw new Error("Unexpected pre-existing bundle branch");
      if (!previous) throw new Error("Interrupted bundle has no manifest");
      readManifest(previous.source, lane);
    } else {
      const state = { version: 1, lane, openedOn: dayOf(now()), round: rock, entries: [] };
      await gh.commit(branch, current, [{ path: manifestPath(lane), source: manifestText(state) }], [], `Open ${lane} character bundle`);
    }
    return gh.api("pulls", "POST", { head: branch, base: "rock", title: title(lane), body: body(lane, { entries: [] }) });
  };
  const load = async (lane) => {
    const pr = await ensure(lane), file = await gh.file(pr.head.sha, manifestPath(lane), 262144);
    if (!file) throw new Error("Bundle has no manifest");
    const state = readManifest(file.source, lane);
    const commit = await gh.api(`commits/${pr.head.sha}`);
    if (commit.author?.login !== bot || !commit.commit.verification?.verified) throw new Error("Bundle head was edited outside the trusted automation");
    return { pr, state };
  };
  const updateBase = async (pr, rock) => {
    const diff = await gh.api(`compare/${rock}...${pr.head.sha}`);
    if (!diff.behind_by) return false;
    // Only after validating every queued file against current rock. GitHub adds
    // a merge commit; no history is force-pushed and a head race is rejected.
    await gh.api(`pulls/${pr.number}/update-branch`, "PUT", { expected_head_sha: pr.head.sha });
    return true; // New head needs fresh checks (and a new manual approval).
  };
  const removeSuperseded = async (pr, rock) => {
    const diff = await gh.api(`compare/${rock}...${pr.head.sha}`);
    if (!diff.files || diff.files.length >= 300) throw new Error("Cannot reconcile a truncated submission diff");
    const changed = new Set(diff.files.map((file) => file.filename));
    for (const lane of LANES) {
      const { pr: bundle, state } = await load(lane);
      const removed = state.entries.filter((entry) => entry.pr === pr.number && entry.head !== pr.head.sha && changed.has(entry.path));
      if (!removed.length) continue;
      const additions = [], deletions = [];
      for (const entry of removed) {
        const original = await gh.file(rock, entry.path);
        if (original) additions.push({ path: entry.path, source: original.source });
        else deletions.push(entry.path);
      }
      const paths = new Set(removed.map((entry) => entry.path));
      const next = { ...state, entries: state.entries.filter((entry) => !paths.has(entry.path)) };
      additions.push({ path: manifestPath(lane), source: manifestText(next) });
      await gh.commit(bundle.head.ref, bundle.head.sha, additions, deletions, `Withdraw superseded character revisions from PR #${pr.number}`);
      await gh.api(`pulls/${bundle.number}`, "PATCH", { body: body(lane, next) });
    }
  };
  const intake = async (submission) => {
    const rock = await ref("rock");
    const pr = submission.pr ? await gh.api(`pulls/${submission.pr}`) : null;
    if (pr && (pr.state !== "open" || pr.base.ref !== "rock")) return;
    if (pr && isBundle(pr, bot)) {
      try {
        const checked = await validateBundle(gh, pr, bot, rock);
        if (await updateBase(pr, rock)) return;
        const review = await reviewDecision(gh, pr);
        await status(pr.head.sha, STATUS, "success", "System bundle: source ownership revalidated");
        await status(pr.head.sha, IDENTITY_STATUS, checked.entries.length ? "success" : "pending", checked.entries.length ? "Bundled identities and immutable sources verified" : "Empty placeholder; waiting for submissions");
        const ready = checked.entries.length > 0 && !review.changesRequested && (checked.lane === "daily" || review.approved);
        await status(pr.head.sha, BUNDLE_STATUS, ready ? "success" : "pending", ready ? "Scanned provenance and review policy satisfied"
          : !checked.entries.length ? "Empty bundle waiting for character submissions" : "Waiting for w-s-bitcoin or 2140data to approve this exact head");
      } catch (error) {
        await status(pr.head.sha, BUNDLE_STATUS, "failure", "Bundle failed revalidation; inspect the workflow log");
        throw error;
      }
      return;
    }
    if (pr?.draft) { await status(pr.head.sha, STATUS, "pending", "Draft character submissions wait until ready for review"); return; }
    if (pr) submission = { pr: pr.number, head: pr.head.sha };
    await status(submission.head, BUNDLE_STATUS, "success", "Source PR; character extraction is gated by Character intake");
    await status(submission.head, STATUS, "pending", "Scanning character revisions and GitHub ownership");
    if (pr) await removeSuperseded(pr, rock);
    let inspected;
    try { inspected = await inspectSubmission(gh, submission, rock); }
    catch (error) {
      return rejectSubmission(pr, submission, error);
    }
    if (!inspected.entries.length) {
      const remaining = inspected.hasCharacters && inspected.mixed;
      await status(submission.head, STATUS, remaining ? "failure" : "success", remaining ? "Character changes already included: remove them from this mixed PR" : "No unbundled character changes");
      if (pr && inspected.hasCharacters && !inspected.mixed) {
        await comment(pr.number, `included-${submission.head}`, "These character changes are already present on rock. No duplicate bundle entry was created; this character-only PR can be closed.");
        if ((await gh.api(`pulls/${pr.number}`)).head.sha === submission.head) await gh.api(`pulls/${pr.number}`, "PATCH", { state: "closed" });
      }
      return;
    }
    // Both lanes are inspected before either is mutated, preventing a later
    // invalid file in a mixed submission from leaving a partial accepted batch.
    if (inspected.entries.some((entry) => entry.lane === "daily")) {
      const pending = await load("daily");
      if (due(pending.state, now())) {
        await mergeDaily();
        if (due((await load("daily")).state, now())) throw new Error("Yesterday's bundle is waiting for checks; today's submission will be retried after it merges");
      }
    }
    const bundles = [];
    for (const lane of LANES) bundles.push(await load(lane));
    const incomingPaths = new Set(inspected.entries.map((entry) => entry.path));
    for (const { state } of bundles) for (const entry of state.entries) {
      if (incomingPaths.has(entry.path) && (entry.pr !== submission.pr || !entry.pr) && entry.head !== submission.head) throw new Error("A different submission already updates this character; resolve it before queueing another");
    }
    // Prevent one file being represented in both the automatic and manual lane.
    for (const { state } of bundles) for (const entry of state.entries) {
      if (incomingPaths.has(entry.path) && inspected.entries.find((next) => next.path === entry.path).lane !== state.lane) throw new Error("Character moved between review lanes; a maintainer must remove the previous queued version first");
    }
    const existing = [];
    for (const { pr: bundle, state } of bundles) for (const entry of state.entries) if (!incomingPaths.has(entry.path)) {
      const file = await gh.file(bundle.head.sha, entry.path);
      if (!file) throw new Error("Queued character is missing");
      existing.push({ ...entry, source: file.source });
    }
    try { await checkRegistry(gh, rock, [...existing, ...inspected.entries]); }
    catch (error) { return rejectSubmission(pr, submission, error); }
    if (pr && (await gh.api(`pulls/${pr.number}`)).head.sha !== submission.head) throw new Error("PR changed during scan; retry");
    const destinations = [];
    for (const { pr: bundle, state } of bundles) {
      const additions = inspected.entries.filter((entry) => entry.lane === state.lane);
      if (!additions.length) continue;
      const unchanged = additions.every((entry) => state.entries.some((old) => old.path === entry.path && old.head === entry.head && old.hash === entry.hash));
      if (!unchanged) {
        const next = { ...state, entries: [...state.entries.filter((old) => !incomingPaths.has(old.path)), ...additions.map(serializable)] };
        // An empty placeholder reused tomorrow starts its day on the first entry.
        if (!state.entries.length) next.openedOn = dayOf(now());
        await gh.commit(bundle.head.ref, bundle.head.sha, [
          ...additions.map((entry) => ({ path: entry.path, source: entry.source })),
          { path: manifestPath(state.lane), source: manifestText(next) }
        ], [], `Bundle character changes from ${pr ? `PR #${pr.number}` : submission.head}`);
        await gh.api(`pulls/${bundle.number}`, "PATCH", { body: body(state.lane, next) });
      }
      destinations.push(`#${bundle.number} (${state.lane === "daily" ? "daily automatic" : "manual review"})`);
      // Bot-authored commits do not start pull_request workflows. Publish the
      // required checks in this run after validating the freshly saved head.
      await intake({ pr: bundle.number });
    }
    if (pr) {
      await comment(pr.number, `moved-${submission.head}`, `Your character changes from ${submission.head} have been copied to ${destinations.join(" and ")}.\n\n${inspected.mixed
        ? "This PR remains open for the other work. Remove the copied character changes from this branch (restore those paths to the PR base); the Character intake check stays failing until they are removed. The bot does not rewrite your branch."
        : "This character-only PR is being closed because its changes are preserved in the bundle. Follow the linked bundle for review and merge progress."}`);
      if (!inspected.mixed && (await gh.api(`pulls/${pr.number}`)).head.sha === submission.head) await gh.api(`pulls/${pr.number}`, "PATCH", { state: "closed" });
    }
    await status(submission.head, STATUS, inspected.mixed ? "failure" : "success", inspected.mixed ? "Character changes copied: remove them from this PR before merging other work" : "Character changes moved to their bundle PRs");
  };
  const mergeDaily = async () => {
    let bundle = await ensure("daily"), rock = await ref("rock");
    const checked = await validateBundle(gh, bundle, bot, rock);
    if (!due(checked.state, now())) return;
    if (await updateBase(bundle, rock)) return;
    if ((await reviewDecision(gh, bundle)).changesRequested) throw new Error("A maintainer requested changes to the daily bundle");
    const validatedHead = bundle.head.sha;
    // Revalidate against current rock before asking GitHub to merge that exact
    // head. GitHub branch rules still apply; never use an admin/bypass merge.
    await status(bundle.head.sha, STATUS, "success", "Daily bundle ownership revalidated");
    await status(bundle.head.sha, BUNDLE_STATUS, "success", "All bundled character revisions satisfy the data-only policy");
    await status(bundle.head.sha, IDENTITY_STATUS, "success", "Bundled identities and immutable sources verified");
    bundle = await gh.api(`pulls/${bundle.number}`);
    if (bundle.head.sha !== validatedHead) throw new Error("Bundle head changed after validation; retry");
    if (bundle.mergeable !== true || !["clean", "unstable"].includes(bundle.mergeable_state)) throw new Error("Daily bundle is not mergeable under branch rules yet");
    const checks = await gh.api(`commits/${bundle.head.sha}/check-runs?per_page=100`);
    const statuses = await gh.api(`commits/${bundle.head.sha}/status?per_page=100`);
    if (checks.total_count >= 100 || checks.check_runs.some((check) => check.status !== "completed" || !["success", "neutral", "skipped"].includes(check.conclusion))
      || statuses.total_count >= 100 || statuses.state !== "success") throw new Error("Daily bundle checks are not all passing yet");
    const latest = await gh.api(`pulls/${bundle.number}`);
    if (latest.head.sha !== bundle.head.sha || await ref("rock") !== rock) throw new Error("Bundle or rock changed before merge; retry");
    const result = await gh.api(`pulls/${bundle.number}/merge`, "PUT", { sha: bundle.head.sha, merge_method: "merge", commit_title: "Merge daily validated character updates" });
    if (!result.merged) throw new Error("GitHub declined the daily merge");
    await deployMerged(await gh.api(`pulls/${bundle.number}`));
    await ensure("daily");
  };
  const sweep = async () => {
    await ensure("daily"); await ensure("manual");
    const failures = [];
    for (const pr of await gh.api("pulls?state=closed&base=rock&sort=updated&direction=desc&per_page=100")) {
      if (isBundle(pr, bot) && pr.merged_at) await deployMerged(await gh.api(`pulls/${pr.number}`));
    }
    // A changed source must be replaceable even when yesterday's bundle fails
    // revalidation. Retry the merge after intake has removed superseded entries.
    try { await mergeDaily(); } catch (error) { failures.push(error.message); }
    for (const pr of await gh.list("pulls?state=open&base=rock")) {
      try { await intake({ pr: pr.number, head: pr.head.sha }); }
      catch (error) { failures.push(`#${pr.number}: ${error.message}`); }
    }
    // Push signals can be superseded by GitHub's concurrency queue. Recover
    // standalone branch heads as well; fork commits become visible through PRs.
    for (const branch of await gh.list("branches", 1)) {
      if (branch.name === "rock" || branch.name.startsWith("automation/characters-") || branch.name.startsWith("automation/site-artifact-")) continue;
      const prs = await gh.list(`commits/${branch.commit.sha}/pulls`);
      if (prs.some((pr) => pr.base.ref === "rock")) continue;
      try { await intake({ pr: null, head: branch.commit.sha }); }
      catch (error) { failures.push(`Branch head ${branch.commit.sha}: ${error.message}`); }
    }
    // Recover dropped/pending workflow events, then perform the midnight gate.
    try { await mergeDaily(); } catch (error) { failures.push(error.message); }
    if (failures.length) throw new Error(failures.join("\n"));
  };
  const auditRock = async (sha) => {
    const prs = await gh.list(`commits/${sha}/pulls`);
    if (prs.some((pr) => pr.merged_at && pr.base.ref === "rock" && pr.merge_commit_sha === sha)) return;
    const commit = await gh.api(`commits/${sha}?per_page=100`);
    if (!commit.files || commit.files.length >= 100 || commit.files.some(touchesCharacters)) {
      await status(sha, STATUS, "failure", "Direct rock character push bypassed intake; maintainer action required");
      throw new Error("Direct rock character changes cannot be quarantined after a push. Require PRs and the character checks in branch rules.");
    }
  };
  return { ensure, intake, mergeDaily, sweep, auditRock, deployMerged };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gh = createGitHub(process.env.GITHUB_REPOSITORY, process.env.CHARACTER_TOKEN);
  const coordinator = createCoordinator(gh, process.env.CHARACTER_BOT_LOGIN);
  const expectedBot = process.env.CHARACTER_APP_SLUG ? `${process.env.CHARACTER_APP_SLUG}[bot]` : BOT;
  if (process.env.CHARACTER_BOT_LOGIN !== expectedBot) throw new Error("Configured bot does not match the workflow's token identity");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && (!isOperator(event.sender)
    || !OPERATORS.some((operator) => operator.login === process.env.GITHUB_TRIGGERING_ACTOR))) throw new Error("Only w-s-bitcoin and 2140data may operate manual automation runs");
  if (event.pull_request) {
    if (event.action === "closed") { await coordinator.ensure("daily"); await coordinator.ensure("manual"); }
    else await coordinator.intake({ pr: event.pull_request.number, head: event.pull_request.head.sha });
  } else if (event.workflow_run) {
    const run = event.workflow_run;
    if (run.event === "pull_request_review") {
      // workflow_run can omit pull_requests for fork/review events. Only the
      // two trusted bundle PRs need their operator review gate refreshed.
      for (const lane of LANES) await coordinator.intake({ pr: (await coordinator.ensure(lane)).number });
    }
    if (run.event === "push" && run.head_branch === "rock") await coordinator.auditRock(run.head_sha);
    // Ignore PR runs and automation branches. Never read its artifacts or code.
    if (run.event === "push" && run.head_repository?.full_name === gh.repo && run.head_branch !== "rock" && !run.head_branch.startsWith("automation/characters-")) {
      const prs = await gh.list(`commits/${run.head_sha}/pulls`);
      const open = prs.filter((pr) => pr.state === "open" && pr.base.ref === "rock");
      if (open.length) for (const pr of open) await coordinator.intake({ pr: pr.number, head: pr.head.sha });
      else await coordinator.intake({ pr: null, head: run.head_sha });
    }
  } else await coordinator.sweep();
}
