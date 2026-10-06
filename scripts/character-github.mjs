// All paths and refs come from GitHub metadata or fixed policy, never a shell.
import { CharacterRejection } from "./character-safety.mjs";

export const createGitHub = (repo, token, fetcher = fetch) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") || !token) throw new Error("Missing repository or automation token");
  const request = async (path, method = "GET", body, missing = false) => {
    const response = await fetcher(`https://api.github.com/${path}`, { method,
      headers: { accept: "application/vnd.github+json", "content-type": "application/json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "obl-character-bundle" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]} returned ${response.status}`);
    if (response.status === 204) return null;
    const data = await response.json();
    if (data.errors) throw new Error("GitHub GraphQL request failed");
    return data;
  };
  const api = (path, method, body, missing) => request(`repos/${repo}/${path}`, method, body, missing);
  const list = async (path, limit = 10) => {
    const rows = [];
    for (let page = 1; page <= limit; page++) {
      const batch = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error("Expected GitHub list");
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    throw new Error("GitHub list exceeded the automation limit; maintainer review required");
  };
  const trees = new Map(), blobs = new Map();
  const tree = async (ref) => {
    if (!trees.has(ref)) {
      const result = await api(`git/trees/${encodeURIComponent(ref)}?recursive=1`);
      if (result.truncated) throw new Error("Truncated Git tree; cannot validate safely");
      trees.set(ref, new Map(result.tree.map((entry) => [entry.path, entry])));
    }
    return trees.get(ref);
  };
  const file = async (ref, path, max = 32768) => {
    const entry = (await tree(ref)).get(path);
    if (!entry) return null;
    if (entry.type !== "blob" || entry.mode !== "100644" || entry.size > max) throw new CharacterRejection("Character and queue files must be bounded regular files, never symlinks or executable files.");
    if (blobs.has(entry.sha)) return blobs.get(entry.sha);
    const blob = await api(`git/blobs/${entry.sha}`);
    if (blob.encoding !== "base64" || blob.size > max) throw new CharacterRejection("Unsupported file encoding or size.");
    const bytes = Buffer.from(blob.content, "base64"), source = bytes.toString("utf8");
    if (!bytes.equals(Buffer.from(source))) throw new CharacterRejection("Invalid UTF-8 source.");
    const result = { source, sha: entry.sha };
    blobs.set(entry.sha, result);
    return result;
  };
  const commit = async (branch, expected, additions, deletions, message) => {
    const result = await request("graphql", "POST", {
      query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
      variables: { input: { branch: { repositoryNameWithOwner: repo, branchName: branch }, expectedHeadOid: expected,
        message: { headline: message }, fileChanges: {
          additions: additions.map(({ path, source }) => ({ path, contents: Buffer.from(source).toString("base64") })),
          deletions: deletions.map((path) => ({ path })) } } }
    });
    return result.data.createCommitOnBranch.commit.oid;
  };
  return { repo, api, list, tree, file, commit };
};
