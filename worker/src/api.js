// /api/*: who is signed in, their display name, and deleting the account.
// Signed out, /api/me answers 200 with `player: null`, so a signed-out page logs nothing.

import { cookieNames, isSecureOrigin, serializeCookie } from "./cookies.js";
import { deletePlayer, getPlayer, publicPlayer, sanitizeDisplay, updateDisplay } from "./db.js";
import { fromSite, getSessionFromRequest, json, text } from "./http.js";
import { contributorFor } from "./contributor-access.js";

const BODY_MAX = 1024;

const me = async (request, env) => {
  const found = await getSessionFromRequest(request, env);
  if (request.method === "GET") return json({ player: found ? publicPlayer(found.player) : null,
    character: found ? await contributorFor(found.player.login) : null });
  if (!fromSite(request, env.SITE_ORIGIN)) return json({ error: "forbidden" }, 403);
  if (!found) return json({ error: "unauthenticated" }, 401);

  if (request.method === "PATCH") {
    const raw = await request.text();
    if (raw.length > BODY_MAX) return json({ error: "too large" }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const display = sanitizeDisplay(body && body.display);
    if (!display) return json({ error: "display must be 3-24 letters, digits or simple punctuation" }, 400);
    await updateDisplay(env.DB, found.player.id, display);
    return json({ player: publicPlayer(await getPlayer(env.DB, found.player.id)) });
  }

  if (request.method === "DELETE") {
    await deletePlayer(env.DB, found.player.id);
    const clear = serializeCookie(cookieNames(env.SITE_ORIGIN).session, "", { maxAge: 0, secure: isSecureOrigin(env.SITE_ORIGIN) });
    return new Response(null, { status: 204, headers: { "set-cookie": clear, "cache-control": "no-store" } });
  }

  return json({ error: "method not allowed" }, 405, { allow: "GET, PATCH, DELETE" });
};

export const handleApi = (request, env, url) => {
  if (url.pathname === "/api/me") return me(request, env);
  if (url.pathname === "/api/health") return text("ok", 200);
  return json({ error: "not found" }, 404);
};
