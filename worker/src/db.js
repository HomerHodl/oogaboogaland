// D1 access. Players are keyed by the GitHub numeric id, which survives a login rename; sessions
// are stored by the SHA-256 of their token, so a leaked table holds nothing a browser could replay.

import { randomToken, sha256Hex } from "./crypto.js";

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const TOUCH_SECONDS = 10 * 60;
export const DISPLAY_MIN = 3;
export const DISPLAY_MAX = 24;
const USER_AGENT_MAX = 120;

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The same character set `donations.sanitize` keeps in src/js/donations.js; null when too short. */
export const sanitizeDisplay = (text) => {
  const clean = String(text ?? "").replace(/[^\w .,!?'@#:-]/g, "").replace(/\s+/g, " ").trim().slice(0, DISPLAY_MAX).trim();
  return clean.length >= DISPLAY_MIN ? clean : null;
};

export const isExpired = (session, now) => session.expires_at <= now;

/** A session is touched at most once per TOUCH_SECONDS so `/api/me` is not a write per call. */
export const needsTouch = (session, now) => !session.last_used_at || now - session.last_used_at >= TOUCH_SECONDS;

const parseLook = (text) => {
  if (!text) return null;
  try {
    const look = JSON.parse(text);
    return look && typeof look === "object" && !Array.isArray(look) ? look : null;
  } catch {
    return null;
  }
};

/** The fields the page may see. `avatar_url` stays server-side until the CSP allows GitHub images. */
export const publicPlayer = (row) => ({
  id: row.id,
  login: row.login,
  display: row.display || row.login,
  look: parseLook(row.look),
  createdAt: row.created_at,
});

export const upsertPlayerFromGitHub = async (db, { id, login, avatar_url }) => {
  const now = nowSeconds();
  await db.prepare(
    `INSERT INTO players (id, login, avatar_url, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET login = ?2, avatar_url = ?3, last_login_at = ?4`,
  ).bind(id, login, avatar_url || null, now).run();
  return db.prepare("SELECT * FROM players WHERE id = ?1").bind(id).first();
};

export const getPlayer = (db, id) => db.prepare("SELECT * FROM players WHERE id = ?1").bind(id).first();

export const updateDisplay = (db, id, display) =>
  db.prepare("UPDATE players SET display = ?2 WHERE id = ?1").bind(id, display).run();

export const createSession = async (db, playerId, userAgent) => {
  const token = randomToken();
  const now = nowSeconds();
  await db.prepare(
    "INSERT INTO sessions (token_hash, player_id, created_at, expires_at, last_used_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?3, ?5)",
  ).bind(await sha256Hex(token), playerId, now, now + SESSION_SECONDS, String(userAgent || "").slice(0, USER_AGENT_MAX)).run();
  return token;
};

/** `{ player, session }` for a live session of a player who is not banned; null otherwise. */
export const getSession = async (db, token) => {
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT s.token_hash, s.expires_at, s.last_used_at, p.*
     FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?1`,
  ).bind(hash).first();
  if (!row) return null;
  const now = nowSeconds();
  const session = { token_hash: row.token_hash, expires_at: row.expires_at, last_used_at: row.last_used_at };
  if (isExpired(session, now)) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(hash).run();
    return null;
  }
  if (row.banned_at) return null;
  if (needsTouch(session, now)) {
    await db.batch([
      db.prepare("UPDATE sessions SET last_used_at = ?2 WHERE token_hash = ?1").bind(hash, now),
      db.prepare("UPDATE players SET last_seen_at = ?2 WHERE id = ?1").bind(row.id, now),
    ]);
  }
  return { player: row, session };
};

export const deleteSession = async (db, token) =>
  db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();

export const deleteAllSessions = (db, playerId) =>
  db.prepare("DELETE FROM sessions WHERE player_id = ?1").bind(playerId).run();

/** Sessions go first: D1 enforces the foreign key, but the explicit order keeps the delete obvious. */
export const deletePlayer = (db, id) => db.batch([
  db.prepare("DELETE FROM sessions WHERE player_id = ?1").bind(id),
  db.prepare("DELETE FROM players WHERE id = ?1").bind(id),
]);

export const purgeExpiredSessions = (db) =>
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(nowSeconds()).run();
