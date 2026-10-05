// OBL merges only: materialize missing Oogatron contributors before the site build.
// Existing handles AND GitHub aliases always win, including a just-merged custom file.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCharacters } from "./characters.mjs";
import { MAX_CHARACTERS, contributorRows, readContributorSnapshot } from "../worker/src/contributor-policy.js";
import { checkCharacterIdentities, mergedPull } from "./contributor-pr.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const missingCharacters = (rows, existing) => {
  const taken = new Set();
  for (const row of existing) {
    taken.add(row.handle.toLowerCase());
    if (row.github) taken.add(row.github.toLowerCase());
  }
  return rows.filter((row) => !taken.has(row.handle.toLowerCase()));
};
export const characterSource = (row) => `// Default Ooga from Oogatron; customize this file to give it a look or voice.
(() => {
  "use strict";
  const BL = window.BL;
  BL.characters.add({
    handle: ${JSON.stringify(row.handle)},
    joined: ${row.joined},
    lastCommit: ${row.lastCommit}
  });
})();
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let changed = [];
  if (process.argv[2] === "--merge") {
    const pr = await mergedPull();
    if (!pr) { console.log("characters: not an OBL PR merge; no reconciliation"); process.exit(0); }
    changed = await checkCharacterIdentities(pr, true);
  }
  // A saved raw snapshot is useful for a reproducible build; the baked jumbotron
  // deliberately omits first_seen_at and is not an onboarding source.
  const stats = process.argv[2] && process.argv[2] !== "--merge" ? JSON.parse(readFileSync(process.argv[2], "utf8")) : await readContributorSnapshot();
  const existing = readCharacters(), missing = missingCharacters(contributorRows(stats), existing);
  if (existing.length + missing.length > MAX_CHARACTERS) throw new Error(`Character capacity ${MAX_CHARACTERS} exceeded; review crew and NPC frame budgets before increasing it`);
  for (const row of missing) {
    // Exclusive creation is a second guard: never overwrite even an unregistered file.
    writeFileSync(join(root, "src", "characters", `${row.handle}.js`), characterSource(row), { flag: "wx" });
  }
  const out = join(root, "untracked", "new-characters");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify([...changed, ...missing.map((row) => `${row.handle}.js`)]) + "\n");
  for (const row of missing) writeFileSync(join(out, `${row.handle}.js`), characterSource(row));
  for (const file of changed) writeFileSync(join(out, file), readFileSync(join(root, "src", "characters", file)));
  console.log(`characters: added ${missing.length}, preserved all existing files`);
}
