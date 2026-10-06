// Read identity declarations as data. In particular, never execute PR JavaScript
// in the pull_request_target job, even in a Node vm (which is not a sandbox).
import { LOGIN } from "../worker/src/contributor-policy.js";

export const declaredIdentity = (source) => {
  if (typeof source !== "string" || source.length > 1024 * 1024) throw new Error("Character source is too large");
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith("//", i)) { const end = source.indexOf("\n", i); i = end < 0 ? source.length : end; continue; }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unclosed comment");
      i = end + 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i++;
      while (i < source.length && source[i] !== c) { if (source[i] === "\\") i++; i++; }
      if (i >= source.length) throw new Error("Unclosed string");
      tokens.push(source.slice(start, ++i)); continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));
    if (word) { tokens.push(word[0]); i += word[0].length; continue; }
    tokens.push(c); i++;
  }
  const marker = ["BL", ".", "characters", ".", "add", "(", "{"];
  const starts = [];
  for (let i = 0; i < tokens.length; i++) if (marker.every((token, j) => tokens[i + j] === token)) starts.push(i + marker.length);
  if (starts.length !== 1) throw new Error("Use exactly one literal BL.characters.add({ ... }) declaration");
  const fields = new Map(), pairs = { "{": "}", "[": "]", "(": ")" };
  let i = starts[0];
  while (tokens[i] !== "}") {
    const key = tokens[i++];
    if (!["handle", "github", "display", "joined", "lastCommit", "look", "voice", "dress"].includes(key)
      || fields.has(key) || tokens[i++] !== ":") throw new Error("Character fields must be unique literal properties; no spreads, getters or computed keys");
    const start = i, stack = [];
    while (i < tokens.length) {
      const token = tokens[i];
      if (!stack.length && (token === "," || token === "}")) break;
      if (Object.hasOwn(pairs, token)) stack.push(pairs[token]);
      else if (["}", "]", ")"].includes(token) && stack.pop() !== token) throw new Error("Unbalanced character declaration");
      i++;
    }
    if (i >= tokens.length || i === start) throw new Error("Incomplete character declaration");
    fields.set(key, tokens.slice(start, i));
    if (tokens[i] === ",") i++;
  }
  if (tokens[i + 1] !== ")") throw new Error("Character registration must take one literal object");
  const literal = (name) => {
    const value = fields.get(name);
    if (!value && name === "github") return undefined;
    if (!value || value.length !== 1 || !/^(["'])[A-Za-z0-9-]+\1$/.test(value[0])) throw new Error(`${name} must be a literal GitHub login`);
    const login = value[0].slice(1, -1);
    if (!LOGIN.test(login) || login.includes("--")) throw new Error(`Invalid ${name}`);
    return login;
  };
  return { handle: literal("handle"), github: literal("github") };
};

export const mayAuthorIdentity = (author, character, previous, maintainer) => {
  if (maintainer) return true;
  const me = author.toLowerCase(), owner = (character.github || character.handle).toLowerCase();
  if (owner !== me) return false;
  return !previous || (previous.github || previous.handle).toLowerCase() === me;
};
