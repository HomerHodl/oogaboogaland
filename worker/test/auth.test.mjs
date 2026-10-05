// Pure checks on the sign-in helpers: no D1, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieNames, parseCookies, serializeCookie } from "../src/cookies.js";
import { randomToken, sameString, sha256Hex } from "../src/crypto.js";
import { isExpired, needsTouch, publicPlayer, sanitizeDisplay, TOUCH_SECONDS } from "../src/db.js";
import { fromSite, safeNext } from "../src/http.js";

test("tokens are 32 random bytes in base64url and never repeat", () => {
  const a = randomToken(), b = randomToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test("session hashes are stable SHA-256 hex", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("state comparison needs an exact string", () => {
  assert.ok(sameString("abc", "abc"));
  assert.ok(!sameString("abc", "abd"));
  assert.ok(!sameString("abc", "abcd"));
  assert.ok(!sameString(null, "abc"));
});

test("next accepts only same-site paths", () => {
  assert.equal(safeNext("/"), "/");
  assert.equal(safeNext("/?scene=lab&debug=1"), "/?scene=lab&debug=1");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "evil", "/a\nb", "/a\\b", null, "/" + "x".repeat(600)]) {
    assert.equal(safeNext(bad), "/", String(bad));
  }
});

test("cookies: parsed by name, first wins, __Host- only on https", () => {
  const jar = parseCookies("a=1; obl_session=tok; a=2; broken; =x");
  assert.equal(jar.get("a"), "1");
  assert.equal(jar.get("obl_session"), "tok");
  assert.equal(cookieNames("https://obl.ruleswithoutrulers.com").session, "__Host-obl_session");
  assert.equal(cookieNames("http://localhost:8787").session, "obl_session");
  assert.equal(serializeCookie("n", "v", { maxAge: 60, secure: true }), "n=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure");
  assert.ok(!serializeCookie("n", "", { maxAge: 0, secure: false }).includes("Secure"));
});

test("state-changing requests must come from the site", () => {
  const site = "https://obl.ruleswithoutrulers.com";
  const req = (headers) => new Request(`${site}/auth/logout`, { method: "POST", headers });
  assert.ok(fromSite(req({ origin: site }), site));
  assert.ok(!fromSite(req({ origin: "https://evil.com" }), site));
  assert.ok(fromSite(req({ "sec-fetch-site": "same-origin" }), site));
  assert.ok(!fromSite(req({ "sec-fetch-site": "cross-site" }), site));
  assert.ok(!fromSite(req({}), site));
});

test("sessions expire at their time and are touched at most every ten minutes", () => {
  assert.ok(isExpired({ expires_at: 100 }, 100));
  assert.ok(!isExpired({ expires_at: 101 }, 100));
  assert.ok(needsTouch({ last_used_at: null }, 100));
  assert.ok(!needsTouch({ last_used_at: 100 }, 100 + TOUCH_SECONDS - 1));
  assert.ok(needsTouch({ last_used_at: 100 }, 100 + TOUCH_SECONDS));
});

test("display names keep the donation character set and 3-24 characters", () => {
  assert.equal(sanitizeDisplay("  Ooga   Booga!  "), "Ooga Booga!");
  assert.equal(sanitizeDisplay("<script>x</script>"), "scriptxscript");
  assert.equal(sanitizeDisplay("ab"), null);
  assert.equal(sanitizeDisplay(null), null);
  assert.equal(sanitizeDisplay("x".repeat(40)).length, 24);
});

test("the page never receives the avatar url or ban fields", () => {
  const p = publicPlayer({ id: 1, login: "ooga", display: null, avatar_url: "https://x", look: "{\"bald\":true}", created_at: 5, banned_at: null });
  assert.deepEqual(p, { id: 1, login: "ooga", display: "ooga", look: { bald: true }, createdAt: 5 });
  assert.equal(publicPlayer({ id: 1, login: "o", look: "[1]" }).look, null);
  assert.equal(publicPlayer({ id: 1, login: "o", look: "{bad" }).look, null);
});
