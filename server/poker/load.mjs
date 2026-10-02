import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const modules = ["poker-rules.js", "poker-crypto.js", "poker-match.js"];
export const source = modules.map(file => readFileSync(new URL("../../src/js/" + file, import.meta.url), "utf8")).join("\n");
export function loadProtocol() {
  const window = { BL: {} };
  runInNewContext(source, { window, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout }, { filename: "poker-protocol.js" });
  return window.BL;
}
