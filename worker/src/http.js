// Response helpers and the request checks every route shares.

import { cookieNames, parseCookies } from "./cookies.js";
import { getSession } from "./db.js";

const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers } });

export const text = (body, status, headers = {}) =>
  new Response(body, { status, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8", ...headers } });

export const redirect = (location, cookies = []) => {
  const headers = new Headers(BASE_HEADERS);
  headers.set("location", location);
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
};

/** State-changing requests must come from the site itself: a matching Origin, or same-origin fetch metadata. */
export const fromSite = (request, siteOrigin) => {
  const origin = request.headers.get("origin");
  if (origin) return origin === siteOrigin;
  return request.headers.get("sec-fetch-site") === "same-origin";
};

/** Accepts only a same-site path: `/x`, never `//host`, `/\host`, a scheme, or control characters. */
export const safeNext = (value) => {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  return value;
};

export const clientIp = (request) => request.headers.get("cf-connecting-ip") || "local";

/** A rate limiter binding answers `{ success }`; an unbound one (tests, a missing binding) never limits. */
export const allowed = async (limiter, key) => !limiter || (await limiter.limit({ key })).success;

export const sessionToken = (request, env) =>
  parseCookies(request.headers.get("cookie")).get(cookieNames(env.SITE_ORIGIN).session) || null;

/** `{ player, session, token }`, or null on any failure; the reason is never sent to the client. */
export const getSessionFromRequest = async (request, env) => {
  const token = sessionToken(request, env);
  if (!token) return null;
  try {
    const found = await getSession(env.DB, token);
    return found ? { ...found, token } : null;
  } catch (err) {
    console.error("session lookup failed", err);
    return null;
  }
};
