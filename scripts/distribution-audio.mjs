// Cloudflare-only staging: keep the portable page embedded, serve exact MP3 bytes on demand.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const hash = (bytes, encoding) => createHash("sha256").update(bytes).digest(encoding);
export function externalizeAudio(html, root, out) {
  const source = readFileSync(join(root, "src/js/dsb-audio-data.js"), "utf8").trim().replace(/\r\n/g, "\n").replace(/<\/script/gi, "<\\/script");
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!script || script[1].split(source).length !== 2) throw new Error("distribution: expected one embedded DSB audio module");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const data = context.window.BL.dsbAudioData;
  if (!Array.isArray(data.voices) || data.voices.length !== 4 || typeof data.music !== "string") throw new Error("distribution: invalid DSB recordings");
  mkdirSync(join(out, "audio"), { recursive: true });
  const asset = (encoded) => {
    const bytes = Buffer.from(encoded, "base64"), name = `dsb-${hash(bytes, "hex")}.mp3`;
    writeFileSync(join(out, "audio", name), bytes);
    return `/audio/${name}`;
  };
  const descriptor = { external: true, voices: data.voices.map(asset), music: asset(data.music) };
  const replacement = `window.BL.dsbAudioData = ${JSON.stringify(descriptor)};`;
  const updated = script[1].replace(source, replacement);
  const oldPolicy = `script-src 'sha256-${hash(script[1], "base64")}'`;
  if (html.split(oldPolicy).length !== 2) throw new Error("distribution: script hash not found");
  return html.replace(script[0], () => `<script>${updated}</script>`)
    .replace(oldPolicy, `script-src 'sha256-${hash(updated, "base64")}'`);
}
