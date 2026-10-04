// PR metadata comes from GitHub, never from commit author strings or display names.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXCLUDED, LOGIN } from "../worker/src/contributor-policy.js";
import { declaredIdentity, mayAuthorIdentity } from "./character-identity.mjs";
import { isOperator } from "./character-operators.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Attribution changes transfer stats/eligibility and are not self-service profile edits.
const POLICY_FILES = new Set(["src/js/contributor-identities.js", "scripts/contributor-pr.mjs",
  "scripts/character-identity.mjs", "worker/src/contributor-policy.js", ".github/workflows/character-identities.yml",
  "scripts/character-safety.mjs", "scripts/character-submissions.mjs", "scripts/character-github.mjs", "scripts/character-bundles.mjs",
  "scripts/character-operators.mjs",
  ".github/workflows/character-bundles.yml", ".github/workflows/character-push.yml"]);
const github = async (path, missing = false) => {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "")) throw new Error("Missing GitHub repository");
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "user-agent": "oogaboogaland" },
    signal: AbortSignal.timeout(15000)
  });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub metadata returned ${response.status}`);
  return response.json();
};
export const mergedPull = async () => {
  const sha = process.env.CHARACTER_MERGE_SHA || process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("Missing merge SHA");
  const pulls = await github(`commits/${sha}/pulls?per_page=100`);
  return pulls.find((pr) => pr.merged_at && pr.base.ref === "rock" && pr.merge_commit_sha === sha) || null;
};
const changedFiles = async (pr) => {
  const files = [];
  let policyChanged = false;
  for (let page = 1; page <= 30; page++) {
    const batch = await github(`pulls/${pr.number}/files?per_page=100&page=${page}`);
    for (let file of batch) {
      if (POLICY_FILES.has(file.filename) || POLICY_FILES.has(file.previous_filename)
        || [file.filename, file.previous_filename].some((path) => path?.startsWith(".github/character-bundles/") || path?.startsWith(".github/workflows/"))) policyChanged = true;
      if (!file.filename.startsWith("src/characters/") && file.previous_filename?.startsWith("src/characters/")) file = { ...file, filename: file.previous_filename, status: "removed" };
      if (!file.filename.startsWith("src/characters/")) continue;
      if (!/^src\/characters\/[A-Za-z0-9-]{1,39}\.js$/.test(file.filename)) throw new Error("Character filenames must be GitHub-style handles ending in .js");
      files.push(file);
    }
    if (batch.length < 100) return { files, policyChanged };
  }
  throw new Error("PR file list exceeded the supported limit; declare character owners explicitly");
};
// Returns only an unambiguous single-profile mapping. An explicit github field
// lets a maintainer add somebody else's profile without assigning it to themselves.
export const identityAdvice = (rows, paths, author, maintainer = false) => {
  const added = rows.filter((row) => paths.includes(`src/characters/${row.file}`));
  return added.map(({ file, character }) => {
    const login = character.github || (maintainer ? character.handle : added.length === 1 ? author : null);
    const mismatch = login && (file.slice(0, -3).toLowerCase() !== login.toLowerCase() || character.handle.toLowerCase() !== login.toLowerCase());
    const occupied = rows.some((row) => row.character !== character && [row.character.handle, row.character.github].some((key) => key?.toLowerCase() === author.toLowerCase()));
    const github = !maintainer && !character.github && mismatch && added.length === 1 && !occupied && LOGIN.test(author) && !EXCLUDED.has(author.toLowerCase()) ? author : null;
    return { file, login, mismatch, github, missing: !character.github && (!login || mismatch && !github && !maintainer) };
  });
};
export const checkCharacterIdentities = async (pr, apply = false) => {
  const { isBundle, validateBundle } = await import("./character-submissions.mjs");
  if (isBundle(pr, process.env.CHARACTER_BOT_LOGIN)) {
    const { createGitHub } = await import("./character-github.mjs");
    const gh = createGitHub(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
    const rock = apply ? (await gh.api(`commits/${pr.merge_commit_sha}`)).parents[0].sha
      : (await gh.api("git/ref/heads/rock")).object.sha;
    const checked = await validateBundle(gh, pr, process.env.CHARACTER_BOT_LOGIN, rock);
    if (apply && !checked.entries.length) throw new Error("Empty character bundle: keep it open until a submission arrives");
    // Valid empty placeholders pass validation; the coordinator keeps their merge gates pending.
    // The coordinator also publishes the mandatory exact-head review status separately.
    // This identity check stays independent so approving a review need not rerun it.
    return [];
  }
  const { files, policyChanged } = await changedFiles(pr), changed = [];
  if (!files.length && !policyChanged) return changed;
  const permission = await github(`collaborators/${encodeURIComponent(pr.user.login)}/permission`, true);
  const maintainer = permission?.permission === "admin" || permission?.role_name === "maintain";
  if (policyChanged && (!maintainer || !isOperator(pr.user))) throw new Error("Changing automation policy requires operator authority from w-s-bitcoin or 2140data");
  if (!files.length) return changed;
  const rows = [];
  // Local source is the trusted base checkout for PR checks and the merged checkout
  // for reconciliation. Only declarations are parsed; no character code is executed.
  for (const file of readdirSync(join(root, "src", "characters")).filter((file) => file.endsWith(".js"))) {
    rows.push({ file, character: declaredIdentity(readFileSync(join(root, "src", "characters", file), "utf8")) });
  }
  const sources = new Map(), previous = new Map();
  const readAt = async (path, sha) => {
    const data = await github(`contents/${path}?ref=${sha}`);
    if (data.type !== "file" || data.encoding !== "base64" || data.size > 1024 * 1024) throw new Error("Expected a bounded character source file");
    return Buffer.from(data.content, "base64").toString("utf8");
  };
  for (const file of files) {
    const name = file.filename.slice("src/characters/".length), oldPath = file.previous_filename || file.filename;
    if (file.status !== "added") {
      const old = declaredIdentity(await readAt(oldPath, pr.base.sha));
      previous.set(name, old);
      // Unrelated appearance edits may be reviewed normally; identity transfers and
      // deleting another person's profile require an actual maintainer.
      if (file.status === "removed" && !mayAuthorIdentity(pr.user.login, old, old, maintainer)) throw new Error(`${name}: only its owner or an OBL maintainer may remove this character`);
    }
    const index = rows.findIndex((row) => row.file === name);
    if (index >= 0) rows.splice(index, 1);
    if (file.previous_filename) {
      const oldIndex = rows.findIndex((row) => `src/characters/${row.file}` === file.previous_filename);
      if (oldIndex >= 0) rows.splice(oldIndex, 1);
    }
    if (file.status === "removed") continue;
    const source = apply ? readFileSync(join(root, file.filename), "utf8") : await readAt(file.filename, pr.head.sha);
    sources.set(name, source);
    rows.push({ file: name, character: declaredIdentity(source) });
  }
  const paths = files.filter((file) => file.status === "added").map((file) => file.filename);
  const adviceRows = identityAdvice(rows, paths, pr.user.login, maintainer);
  for (const advice of adviceRows) {
    if (advice.mismatch) console.log(`::warning file=src/characters/${advice.file}::Filename differs from GitHub login ${advice.login}; use the existing github field to preserve ownership and activity matching.`);
    if (advice.missing) throw new Error(`${advice.file}: declare github explicitly for this new character`);
    if (!advice.github) continue;
    if (sources.get(advice.file).split("BL.characters.add({").length !== 2) throw new Error(`${advice.file}: declare github explicitly; registration is not a literal BL.characters.add object`);
    if (!apply) {
      console.log(`::warning file=src/characters/${advice.file}::Merge reconciliation will add github: ${JSON.stringify(advice.github)}. Set github explicitly before merging if this character belongs to someone else.`);
      // Authorization below considers the mapping the merge job will write.
    }
    const row = rows.find((row) => row.file === advice.file);
    row.character.github = advice.github;
  }
  const identities = new Map();
  for (const row of rows) for (const key of new Set([row.character.handle, row.character.github].filter(Boolean).map((name) => name.toLowerCase()))) {
    if (identities.has(key)) throw new Error(`${row.file}: duplicate character handle or GitHub owner ${key}`);
    identities.set(key, row.file);
  }
  for (const file of files) {
    if (file.status === "removed") continue;
    const name = file.filename.slice("src/characters/".length), row = rows.find((row) => row.file === name), old = previous.get(name);
    if (!mayAuthorIdentity(pr.user.login, row.character, old, maintainer)) throw new Error(`${name}: contributors may create or change only their own character; another owner requires OBL maintain or admin permission`);
    if (name.slice(0, -3).toLowerCase() !== (row.character.github || row.character.handle).toLowerCase()) console.log(`::warning file=${file.filename}::Filename is an alias; GitHub ownership is ${row.character.github || row.character.handle}.`);
  }
  // Validate the whole batch before writing any automatic mapping.
  if (apply) for (const advice of adviceRows) {
    if (!advice.github) continue;
    const path = join(root, "src", "characters", advice.file), source = sources.get(advice.file);
    const marker = "BL.characters.add({";
    if (source.split(marker).length !== 2) throw new Error(`${advice.file}: declare github explicitly; registration is not a literal BL.characters.add object`);
    writeFileSync(path, source.replace(marker, `${marker}\n    github: ${JSON.stringify(advice.github)},`));
    changed.push(advice.file);
  }
  return changed;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (event.pull_request) await checkCharacterIdentities(event.pull_request);
}
