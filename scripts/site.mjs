// Builds the page and stages the site as GitHub Pages serves it: `node scripts/site.mjs [dir]`, default
// untracked/site. Search engines and link crawlers judge a page by the HTML at its exact address, so every
// route in src/js/routes.js gets a real page of its own: oogarally.html answers /oogarally with a 200, its own
// title, description, canonical address and preview card, and the router opens the rally from the path.
// Each is the whole built page with its own head. 404.html sends a miscased or slash-ended route
// (/OogaRally/) to its address and anything else home; sitemap.xml and robots.txt list the routes, and
// cards/ holds the card images from `npm run cards`; a route without an `image` uses home's.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { externalizeAudio } from "./distribution-audio.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, process.argv[2] || "untracked/site");
await import("./build.mjs");

const context = { window: {} };
vm.runInNewContext(readFileSync(join(root, "src", "js", "routes.js"), "utf8"), context);
const routes = context.window.BL.routes;
const { site, name, list } = routes;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "cards"), { recursive: true });
// The isolated Maxis provider document is loaded only by an explicit media selection.
mkdirSync(join(out, "src", "js"), { recursive: true });
cpSync(join(root, "src", "maxis-player"), join(out, "src", "maxis-player"), { recursive: true });
copyFileSync(join(root, "src", "js", "maxis-media-data.js"), join(out, "src", "js", "maxis-media-data.js"));

let shell = readFileSync(join(root, "oogaboogaland.html"), "utf8");
if (process.argv.includes("--audio-assets")) shell = externalizeAudio(shell, root, out);
if (shell.split("</title>").length !== 2 || shell.split("</head>").length !== 2) throw new Error("oogaboogaland.html: expected one <title> and one </head>");

const esc = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const urlOf = (entry) => `${site}/${entry.path}`;
const imageOf = (entry) => entry.image || list[0].image;
const head = (entry) => {
  const title = esc(routes.title(entry));
  return [
    `<meta name="description" content="${esc(entry.description)}">`,
    `<link rel="canonical" href="${urlOf(entry)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(name)}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${esc(entry.description)}">`,
    `<meta property="og:url" content="${urlOf(entry)}">`,
    `<meta property="og:image" content="${site}/cards/${imageOf(entry)}.jpg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${title}">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ].join("\n  ");
};
for (const entry of list) {
  const page = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(routes.title(entry))}</title>`)
    .replace("</head>", `  ${head(entry)}\n</head>`);
  writeFileSync(join(out, entry.path ? `${entry.path}.html` : "index.html"), page);
  if (!entry.image) continue;
  const image = join(root, "cards", `${entry.image}.jpg`);
  if (!existsSync(image)) throw new Error(`cards/${entry.image}.jpg is missing; run npm run cards`);
  copyFileSync(image, join(out, "cards", `${entry.image}.jpg`));
}
writeFileSync(join(out, "404.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(name)}</title>
  <meta name="robots" content="noindex">
  <script>const p = location.pathname, to = p.toLowerCase().replace(/[/]+$/, ""); location.replace((to && to !== p ? to : "/") + location.search);</script>
</head>
<body><a href="/">${esc(name)}</a></body>
</html>
`);
writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${list.map((entry) => `  <url><loc>${urlOf(entry)}</loc></url>`).join("\n")}
</urlset>
`);
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`staged ${out}: ${list.length} pages of ${kb(shell.length)}, ${list.filter((entry) => entry.image).length} cards, sitemap.xml, robots.txt`);
