// GitHub sign-in. /auth/login sends the visitor to GitHub with a random state held in a short-lived
// cookie; /auth/callback checks that state, trades the code for a token, reads the public profile,
// forgets the token, and opens a D1 session. No OAuth scopes are requested.

import { cookieNames, isSecureOrigin, parseCookies, serializeCookie } from "./cookies.js";
import { randomToken, sameString } from "./crypto.js";
import { createSession, deleteAllSessions, deleteSession, SESSION_SECONDS, upsertPlayerFromGitHub } from "./db.js";
import { allowed, clientIp, fromSite, getSessionFromRequest, redirect, safeNext, text } from "./http.js";

const STATE_SECONDS = 600;
const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";

// The state cookie carries `<state>.<base64url(next)>` so the callback can return the visitor where they were.
const encodeNext = (next) => btoa(encodeURIComponent(next)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodeNext = (value) => {
  try {
    return safeNext(decodeURIComponent(atob(value.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return "/";
  }
};

const login = async (request, env, url) => {
  if (!(await allowed(env.AUTH_LIMITER, clientIp(request)))) return text("Too many sign-in attempts. Try again in a minute.", 429);
  const state = randomToken();
  const next = safeNext(url.searchParams.get("next"));
  const secure = isSecureOrigin(env.SITE_ORIGIN);
  const authorize = new URL(GITHUB_AUTHORIZE);
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${env.SITE_ORIGIN}/auth/callback`);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "true");
  return redirect(authorize.toString(), [
    serializeCookie(cookieNames(env.SITE_ORIGIN).oauth, `${state}.${encodeNext(next)}`, { maxAge: STATE_SECONDS, secure }),
  ]);
};

const callback = async (request, env, url) => {
  const names = cookieNames(env.SITE_ORIGIN);
  const secure = isSecureOrigin(env.SITE_ORIGIN);
  const clearState = serializeCookie(names.oauth, "", { maxAge: 0, secure });
  const held = parseCookies(request.headers.get("cookie")).get(names.oauth) || "";
  const dot = held.indexOf(".");
  const expected = dot > 0 ? held.slice(0, dot) : "";
  const code = url.searchParams.get("code");
  if (!expected || !code || !sameString(url.searchParams.get("state"), expected)) {
    return text("Sign-in expired or was not started here. Go back and try again.", 400, { "set-cookie": clearState });
  }
  const next = decodeNext(held.slice(dot + 1));

  let profile;
  try {
    const tokenRes = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "oogaboogaland" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${env.SITE_ORIGIN}/auth/callback`,
      }),
    });
    const answer = tokenRes.ok ? await tokenRes.json() : {};
    const token = answer.access_token;
    // GitHub answers 200 with `error` (incorrect_client_credentials, bad_verification_code, redirect_uri_mismatch).
    if (!token) throw new Error(`token exchange ${tokenRes.status} ${answer.error || ""}`.trim());
    const userRes = await fetch(GITHUB_USER, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "oogaboogaland" },
    });
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    profile = await userRes.json();
  } catch (err) {
    console.error("github sign-in failed", err);
    return text("GitHub did not answer. Try again.", 502, { "set-cookie": clearState });
  }
  if (!Number.isSafeInteger(profile.id) || typeof profile.login !== "string" || profile.type !== "User") {
    return text("GitHub sent an unexpected profile.", 502, { "set-cookie": clearState });
  }

  const player = await upsertPlayerFromGitHub(env.DB, { id: profile.id, login: profile.login, avatar_url: profile.avatar_url });
  if (player.banned_at) return text("This account cannot sign in.", 403, { "set-cookie": clearState });
  const session = await createSession(env.DB, player.id, request.headers.get("user-agent"));
  return redirect(next, [clearState, serializeCookie(names.session, session, { maxAge: SESSION_SECONDS, secure })]);
};

const logout = async (request, env, url) => {
  if (request.method !== "POST") return text("Method not allowed", 405, { allow: "POST" });
  if (!fromSite(request, env.SITE_ORIGIN)) return text("Forbidden", 403);
  const found = await getSessionFromRequest(request, env);
  if (found) {
    if (url.searchParams.get("all") === "1") await deleteAllSessions(env.DB, found.player.id);
    else await deleteSession(env.DB, found.token);
  }
  const clear = serializeCookie(cookieNames(env.SITE_ORIGIN).session, "", { maxAge: 0, secure: isSecureOrigin(env.SITE_ORIGIN) });
  return new Response(null, { status: 204, headers: { "set-cookie": clear, "cache-control": "no-store" } });
};

export const handleAuth = (request, env, url) => {
  if (url.pathname === "/auth/login" && request.method === "GET") return login(request, env, url);
  if (url.pathname === "/auth/callback" && request.method === "GET") return callback(request, env, url);
  if (url.pathname === "/auth/logout") return logout(request, env, url);
  return text("Not found", 404);
};
