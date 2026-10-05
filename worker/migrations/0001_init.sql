-- Players and their sessions. No passwords exist: identity is the GitHub account, and a session is a
-- random cookie token stored here only as its SHA-256. The GitHub access token is used once at
-- sign-in and never stored.

CREATE TABLE players (
  id            INTEGER PRIMARY KEY,          -- GitHub numeric user id (stable; logins can change)
  login         TEXT    NOT NULL,             -- GitHub login at last sign-in; not unique, a freed login can be reused
  display       TEXT,                         -- in-game name, 3-24 sanitized characters; NULL shows the login
  avatar_url    TEXT,                         -- kept for later; not sent to the page while the CSP blocks GitHub images
  look          TEXT,                         -- JSON in the shape of a src/characters `look`; NULL = hashed look
  created_at    INTEGER NOT NULL,             -- unix seconds
  last_login_at INTEGER NOT NULL,
  last_seen_at  INTEGER,
  banned_at     INTEGER,
  ban_reason    TEXT
);
CREATE INDEX players_login ON players(login);

CREATE TABLE sessions (
  token_hash   TEXT    PRIMARY KEY,           -- SHA-256 hex of the cookie token
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,              -- created_at + 30 days
  last_used_at INTEGER,
  user_agent   TEXT                           -- first 120 characters, for a later "sign out everywhere" list
);
CREATE INDEX sessions_player  ON sessions(player_id);
CREATE INDEX sessions_expires ON sessions(expires_at);
