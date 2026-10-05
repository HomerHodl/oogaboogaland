// A deliberately small data language, not a JavaScript evaluator or an AI judge.
// Nothing from a submission is imported, run in a vm, or passed to a shell.
import { LOGIN } from "../worker/src/contributor-policy.js";
import { declaredIdentity } from "./character-identity.mjs";

export class CharacterRejection extends Error {}
const reject = (message) => { throw new CharacterRejection(message); };
export const characterPath = (path) => /^src\/characters\/[A-Za-z0-9-]{1,39}\.js$/.test(path);
export const touchesCharacters = (file) => [file.filename, file.previous_filename].some((path) => path?.startsWith("src/characters/"));
const instruction = /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|security)\s+(?:instructions?|prompts?|rules?)|(?:system|developer)\s*prompt|<\|(?:im_start|system|assistant)|(?:disable|bypass)\s+(?:the\s+)?(?:security|scanner|validation)|exfiltrat/i;
const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/.test(value) && !instruction.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const login = (value) => typeof value === "string" && LOGIN.test(value) && !value.includes("--");

export const validateCharacterData = (row, now = Date.now()) => {
  if (!keys(row, ["handle", "github", "display", "joined", "lastCommit", "look", "voice"])) reject("Only documented character data fields may be automatically bundled; executable dress hooks require maintainer review.");
  if (!login(row.handle) || row.github !== undefined && !login(row.github)) reject("Invalid character handle or GitHub owner.");
  if (row.display !== undefined && !text(row.display, 39)) reject("Invalid display text.");
  for (const field of ["joined", "lastCommit"]) if (!Number.isSafeInteger(row[field]) || row[field] <= 0 || row[field] * 1000 > now) reject("Character dates must be valid past Unix seconds.");
  if (row.look !== undefined) {
    const colors = ["skin", "hair", "fur", "eyeColor"];
    const flags = ["bald", "cleanShaven", "hairless", "noBrow", "wideEyes", "noPupils", "cigarette", "gasMask", "stoneAxe", "skater", "pumpkin"];
    if (!keys(row.look, [...colors, ...flags, "face", "build", "height", "hatY", "eyeGlow", "portrait"])) reject("Unknown appearance field.");
    for (const [key, value] of Object.entries(row.look)) {
      if (colors.includes(key) && (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value))) reject("Colors must be six-digit hex values.");
      if (flags.includes(key) && typeof value !== "boolean") reject("Appearance flags must be boolean.");
      if (key === "face" && !["none", "beard", "smirk"].includes(value)) reject("Unsupported face.");
      if (key === "build" && !["slim", "normal"].includes(value)) reject("Unsupported build.");
      const ranges = { height: [0.8, 1.3], hatY: [-4, 20], eyeGlow: [0, 1] };
      if (ranges[key] && (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1])) reject("Appearance value exceeds its safe range.");
      if (key === "portrait") {
        if (!keys(value, ["min", "max"]) || ![value.min, value.max].every((v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) <= 32))
          || !value.min.every((n, i) => n < value.max[i])) reject("Invalid portrait bounds.");
      }
    }
  }
  if (row.voice !== undefined && (!keys(row.voice, ["poke", "idle"]) || !text(row.voice.poke, 160)
    || !Array.isArray(row.voice.idle) || !row.voice.idle.length || row.voice.idle.length > 24 || !row.voice.idle.every((v) => text(v, 160)))) reject("Voice requires bounded plain-text poke and idle lines.");
  return row;
};

// Parse the entire file, including the fixed wrapper. A valid declaration hidden
// beside malicious code cannot pass. All output is regenerated from parsed data.
export const parseSafeCharacter = (source, now = Date.now()) => {
  if (typeof source !== "string" || Buffer.byteLength(source) > 32768) reject("Character source exceeds 32 KiB.");
  if (instruction.test(source) || /[\u0000\u202a-\u202e\u2066-\u2069]/.test(source)) reject("Suspicious instruction text or invisible direction controls found.");
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith("//", i)) { const end = source.indexOf("\n", i); i = end < 0 ? source.length : end; continue; }
    if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); if (end < 0) reject("Unclosed comment."); i = end + 2; continue; }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++]; let value = "", closed = false;
      while (i < source.length) {
        const c = source[i++];
        if (c === quote) { closed = true; break; }
        if (c === "\\") {
          const escape = source[i++];
          if (!["\\", '"', "'"].includes(escape)) reject("Only escaped quotes and backslashes are allowed in strings.");
          value += escape;
        } else { if (c < " " || c === "\u2028" || c === "\u2029") reject("Invalid string character."); value += c; }
      }
      if (!closed) reject("Unclosed string.");
      tokens.push({ kind: "string", value }); continue;
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/.exec(source.slice(i));
    if (number) { tokens.push({ kind: "number", value: Number(number[0]) }); i += number[0].length; continue; }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));
    if (word) { tokens.push({ kind: "word", value: word[0] }); i += word[0].length; continue; }
    tokens.push({ kind: "symbol", value: source[i++] });
  }
  let position = 0;
  const take = (value, kind = "symbol") => {
    const token = tokens[position++];
    if (!token || token.value !== value || token.kind !== kind) reject("Use the documented data-only character wrapper; additional executable code is not eligible.");
  };
  const value = (depth = 0) => {
    if (depth > 6) reject("Character data is nested too deeply.");
    const token = tokens[position++];
    if (!token) reject("Incomplete character data.");
    if (token.kind === "string" || token.kind === "number") return token.value;
    if (token.kind === "word" && ["true", "false"].includes(token.value)) return token.value === "true";
    if (token.kind === "symbol" && token.value === "{") {
      const result = Object.create(null);
      while (tokens[position]?.value !== "}") {
        const key = tokens[position++];
        if (!key || !["word", "string"].includes(key.kind) || ["__proto__", "prototype", "constructor"].includes(key.value) || Object.hasOwn(result, key.value)) reject("Invalid, duplicate or prototype-related field.");
        take(":"); result[key.value] = value(depth + 1);
        if (tokens[position]?.value === "}") break;
        take(",");
      }
      take("}"); return result;
    }
    if (token.kind === "symbol" && token.value === "[") {
      const result = [];
      while (tokens[position]?.value !== "]") {
        if (result.length >= 32) reject("Character array exceeds its limit.");
        result.push(value(depth + 1));
        if (tokens[position]?.value === "]") break;
        take(",");
      }
      take("]"); return result;
    }
    reject("Only literal strings, numbers, booleans, arrays and objects are eligible.");
  };
  for (const token of ["(", "(", ")", "=", ">", "{"]) take(token);
  take("use strict", "string"); take(";"); take("const", "word"); take("BL", "word"); take("="); take("window", "word"); take("."); take("BL", "word"); take(";");
  take("BL", "word"); take("."); take("characters", "word"); take("."); take("add", "word"); take("(");
  const row = value();
  for (const token of [")", ";", "}", ")", "(", ")", ";"]) take(token);
  if (position !== tokens.length) reject("Additional code after the character declaration is not allowed.");
  return validateCharacterData(row, now);
};

export const safeCharacterSource = (row) => {
  // The existing identity checker uses bare property names at the top level.
  const data = JSON.stringify(validateCharacterData(row), null, 2).replace(/^  "([A-Za-z]+)":/gm, "  $1:");
  return `(() => {\n  "use strict";\n  const BL = window.BL;\n  BL.characters.add(${data});\n})();\n`;
};

export const scanCharacter = (source) => {
  if (typeof source !== "string" || Buffer.byteLength(source) > 32768) reject("Character source exceeds 32 KiB.");
  // This screen is deliberately conservative. Passing it does NOT make custom
  // code safe: it goes exclusively to a human-reviewed bundle, never auto-merge.
  if (instruction.test(source) || /[\u0000\u202a-\u202e\u2066-\u2069]/.test(source)) reject("Suspicious instructions or invisible direction controls found.");
  if (/\b(?:eval|Function|fetch|XMLHttpRequest|WebSocket|import|require|process|globalThis|document|localStorage|sessionStorage|navigator|location|constructor|__proto__|prototype|setTimeout|setInterval|Worker|atob)\b|\\x[0-9a-f]{2}|\\u[0-9a-f{]|https?:\/\//i.test(source)) reject("Network, dynamic execution, ambient access, encoded code or prototype access requires a separate security review.");
  if (/\bwindow\b(?!\s*\.\s*BL\b)/.test(source)) reject("Custom code may not access window outside BL.");
  try { const row = parseSafeCharacter(source); return { lane: "daily", row, source: safeCharacterSource(row) }; }
  catch (error) {
    if (!(error instanceof CharacterRejection)) throw error;
    // The identity reader still rejects ambiguous registrations. Unsupported
    // syntax is not silently accepted by the automatic lane.
    let row;
    try { row = declaredIdentity(source); } catch { reject("Cannot establish a single literal character identity."); }
    return { lane: "manual", row, source };
  }
};

export const checkOwner = (row, previous, author, maintainer = false) => {
  if (!login(author)) reject("No authenticated GitHub author.");
  const me = author.toLowerCase();
  if (!row.github && !previous && row.handle.toLowerCase() !== me && !maintainer) row.github = author;
  const owner = (row.github || row.handle).toLowerCase();
  if (!maintainer && (owner !== me || previous && (previous.github || previous.handle).toLowerCase() !== me)) reject("Only the GitHub owner or an OBL Maintain/Admin user may change this character.");
  if (previous && (previous.handle.toLowerCase() !== row.handle.toLowerCase() || (previous.github || previous.handle).toLowerCase() !== owner)) reject("Identity transfers and renames require a separate maintainer-reviewed PR.");
  return row;
};
