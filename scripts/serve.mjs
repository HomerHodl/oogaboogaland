// Builds and stages the site (scripts/site.mjs into untracked/site) and serves it locally; --watch rebuilds
// on every change under src/. Everything outside `/src/` is the staged site as GitHub Pages serves it, so
// /rally answers from rally.html and an unknown path from 404.html; `/src/` is the unbundled source tree,
// which gives DevTools real file names while the same flags apply to both.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, "scripts", "site.mjs");
const site = join(root, "untracked", "site");
const src = join(root, "src");
const watching = process.argv.includes("--watch");
const port = Number(process.env.PORT) || 8080;
// Loopback only: `/src/` exposes the source tree, so reaching it from another machine is opt-in.
const host = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

// One build at a time; a change that lands mid-build queues exactly one more.
let building = null;
let queued = false;
function rebuild() {
  if (building) {
    queued = true;
    return building;
  }
  building = new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [build], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code !== 0) console.log(`build failed (exit ${code}); serving the previous page`);
      else console.log(`rebuilt in ${Date.now() - started} ms`);
      building = null;
      if (queued) {
        queued = false;
        rebuild();
      }
      resolve(code === 0);
    });
  });
  return building;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveFile(res, path) {
  if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, "not found");
  send(res, 200, readFileSync(path), TYPES[extname(path)] || "application/octet-stream");
}

const server = createServer((req, res) => {
  // A malformed escape such as `/src/%` throws here; that is the request's fault, not the server's.
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return send(res, 400, "bad request");
  }
  if (pathname === "/") return serveFile(res, join(site, "index.html"));
  if (pathname === "/src" || pathname === "/src/") return serveFile(res, join(src, "index.html"));
  if (pathname.startsWith("/src/")) {
    // Resolve inside src/ only; a normalized path that escapes it is refused.
    const file = normalize(join(src, pathname.slice("/src/".length)));
    if (!file.startsWith(src + sep)) return send(res, 403, "forbidden");
    return serveFile(res, file);
  }
  const file = normalize(join(site, pathname));
  if (!file.startsWith(site + sep)) return send(res, 403, "forbidden");
  for (const candidate of [file, `${file}.html`]) if (existsSync(candidate) && statSync(candidate).isFile()) return serveFile(res, candidate);
  send(res, 404, readFileSync(join(site, "404.html")), TYPES[".html"]);
});

await rebuild();
server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`port ${port} is in use; pick another with PORT=<n>`);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`serving http://${host}:${port}/ (the staged site; try /rally) and http://${host}:${port}/src/ (sources)`);
  if (!watching) return;
  let timer = null;
  watch(src, { recursive: true }, (_, file) => {
    if (file) console.log(`changed ${file}`);
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
  console.log(`watching ${src} for changes`);
});
