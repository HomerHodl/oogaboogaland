// OBL merges only: materialize missing Oogatron contributors before the site build.
// Existing handles AND GitHub aliases always win, including a just-merged custom file.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Only untouched generated aliases may retire, and only when their confirmed
// owner already has a character. A custom look/voice/source is never removed.
export const retiredCharacters = (existing, sourceFor) => {
  const retired = [];
  for (const row of existing) {
    const owner = globalThis.BL.contributorIdentities.ownerOf(row.handle);
    if (owner === row.handle || !existing.some((c) => c !== row && [c.handle, c.github].some((key) => key?.toLowerCase() === owner.toLowerCase()))) continue;
    const file = `${row.handle.toLowerCase()}.js`, source = sourceFor(file);
    if (source === characterSource(row)) retired.push({ file, source });
  }
  return retired;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, "untracked", "new-characters"), retirement = join(out, "retired.json");
  const sourceFor = (file) => { const path = join(root, "src", "characters", file); return existsSync(path) ? readFileSync(path, "utf8") : null; };
  if (process.argv[2] === "--retired-artifact") {
    if (!existsSync(retirement)) process.exit(0);
    const records = JSON.parse(readFileSync(retirement, "utf8"));
    const allowed = retiredCharacters(readCharacters(), sourceFor);
    if (!Array.isArray(records) || records.some((r) => !allowed.some((a) => a.file === r?.file && a.source === r.source))) throw new Error("Retired character artifact does not match an untouched confirmed alias");
    for (const row of records) rmSync(join(root, "src", "characters", row.file));
    process.exit(0);
  }
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
  const retired = retiredCharacters(existing, sourceFor);
  if (existing.length - retired.length + missing.length > MAX_CHARACTERS) throw new Error(`Character capacity ${MAX_CHARACTERS} exceeded; review crew and NPC frame budgets before increasing it`);
  for (const row of missing) {
    // Exclusive creation is a second guard: never overwrite even an unregistered file.
    writeFileSync(join(root, "src", "characters", `${row.handle}.js`), characterSource(row), { flag: "wx" });
  }
  for (const row of retired) rmSync(join(root, "src", "characters", row.file));
  changed = changed.filter((file) => !retired.some((row) => row.file === file));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify([...changed, ...missing.map((row) => `${row.handle}.js`)]) + "\n");
  writeFileSync(retirement, JSON.stringify(retired) + "\n");
  for (const row of missing) writeFileSync(join(out, `${row.handle}.js`), characterSource(row));
  for (const file of changed) writeFileSync(join(out, file), readFileSync(join(root, "src", "characters", file)));
  console.log(`characters: added ${missing.length}, retired ${retired.length} untouched confirmed aliases, preserved custom profiles`);
}
