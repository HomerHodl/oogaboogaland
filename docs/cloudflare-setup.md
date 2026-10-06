# Cloudflare setup

The island runs as two Cloudflare Workers in the account `1e5c1e8f7c343bf6cabced151b1ae2c6`. Each serves the staged site (`npm run build:site` → `_site/`) from static assets plus GitHub sign-in on D1, the island room and voice (see `docs/auth-and-presence.md`):

| Worker | Address | Config | Deploys |
|---|---|---|---|
| `oogaboogaland-staging` | https://oogaboogaland-staging.wickedsmartbitcoin.workers.dev | `wrangler.staging.jsonc` | by hand on `rock` (`cloudflare-staging.yml`) |
| `oogaboogaland-production` | https://oogabooga.land (www redirects there; the workers.dev address serves the page signed out) | `wrangler.production.jsonc` | by hand on `rock` (`cloudflare-production.yml`) |

The two share code and nothing else: each has its own D1 database, room, OAuth App, Realtime app, secrets and rate-limit counters. Everything below is done once per Worker.

## What exists, per Worker

| Thing | Name | Set where |
|---|---|---|
| D1 database | `oogaboogaland-staging`, `oogaboogaland-production` | `d1_databases` (`database_id`), migrations in `worker/migrations` |
| Rate limiters | `AUTH_LIMITER` 10 sign-ins a minute per IP; `ROOM_LIMITER` 20 room connections and `VOICE_LIMITER` 120 voice calls a minute per player | `ratelimits` (staging namespaces 2001–2003, production 1001–1003) |
| Durable Object | `Room`, one named `island` | `durable_objects`, `migrations` |
| Cron | daily 04:00 UTC, purges expired sessions | `triggers` |
| Vars | `SITE_ORIGIN`, `GITHUB_CLIENT_ID`, `REALTIME_APP_ID` | `vars` |
| Worker secrets | `GITHUB_CLIENT_SECRET`, `REALTIME_SECRET` | `wrangler secret put` |
| Realtime SFU app | `oogaboogaland-staging`, `oogaboogaland-production` | Realtime → Serverless SFU |
| GitHub OAuth App | one per Worker, no scopes | the OogaBoogaX org's Developer settings |
| GitHub repo secret | `CLOUDFLARE_API_TOKEN` | OogaBoogaX repo Settings → Secrets and variables → Actions |

## Who administers it

Workers, databases, rooms, rate limiters, secrets and Realtime apps belong to the account, so any of its Super Administrators (or Administrators) can change, redeploy or rotate them whoever created them. Two things are tied to an owner, so they live where they outlast any one person:
- The deploy token is an **account-owned** API token (Manage Account → Account API Tokens), not a personal one.
- The OAuth Apps belong to the **OogaBoogaX** GitHub org, where every org owner can manage them.

Secrets cannot be read back once set; keep the OAuth client secrets and Realtime app secrets in a shared password manager. A lost one is regenerated and set again.

## One-time setup, per Worker

Run from `worker/` after `npm ci`, logged in with `npx wrangler login` as a member of the account (`npx wrangler whoami` lists it). `<env>` is `staging` or `production`.

1. **D1.** `npx wrangler d1 create oogaboogaland-<env>`; put its id in `database_id` (wrangler may offer to add a second binding: keep only `DB`).
2. **GitHub OAuth App** (OogaBoogaX → Settings → Developer settings → OAuth Apps → New): homepage `https://oogaboogaland-<env>.wickedsmartbitcoin.workers.dev`, callback `https://oogaboogaland-<env>.wickedsmartbitcoin.workers.dev/auth/callback`. Put the client id in `vars.GITHUB_CLIENT_ID`, then `npx wrangler secret put GITHUB_CLIENT_SECRET --config ../wrangler.<env>.jsonc`.
3. **Voice.** dash.cloudflare.com → Realtime → Serverless SFU → Create `oogaboogaland-<env>`; put the App ID in `vars.REALTIME_APP_ID`, then `npx wrangler secret put REALTIME_SECRET --config ../wrangler.<env>.jsonc` with the App token. Without it **Join voice** says voice is unavailable and everything else works.
4. `npm run deploy:<env>`: builds `_site`, applies the D1 migrations and deploys.
5. **Deploy token**, once for both: Manage Account → Account API Tokens → Create, with *Workers Scripts → Edit* and *D1 → Edit* on this account. Save it in the OogaBoogaX repo as `CLOUDFLARE_API_TOKEN`.

## The oogabooga.land domain

The zone `oogabooga.land` is in this account. Production serves the apex as a Worker Custom Domain (`routes` in `wrangler.production.jsonc`). `www` is a proxied DNS record (`CNAME www → oogabooga.land`) that a Redirect Rule in the zone (Rules → Redirect Rules, "Redirect from WWW to root", 301, keeping the path and query) sends to the apex; it never reaches the Worker. `SITE_ORIGIN` is `https://oogabooga.land`, and the production OAuth App's homepage and callback match it (`https://oogabooga.land/auth/callback`): sign-in cookies belong to that host alone. A Custom Domain can't be created over an existing DNS record for the same name, so a record left over from another host is deleted first. A deploy that changes `routes` needs *Zone → Workers Routes → Edit* on `oogabooga.land` in the deploy token.

## Every deploy

Both `cloudflare-staging.yml` and `cloudflare-production.yml` run by hand on `rock`: Actions → Deploy Cloudflare staging (or production) → Run workflow. Merging does not deploy either Worker. Each takes a fresh jumbotron snapshot, runs `npm run build:site` and the Worker's checks, applies D1 migrations and deploys. Every deploy drops live sockets, and clients reconnect on their own. These workflows are the normal deploy path: keep Workers Builds (a Worker's Settings → Build) disconnected and don't deploy from the dashboard, or a second deploy can replace the Worker and drop its secrets. If GitHub Actions is unavailable, the README documents the emergency laptop deployment procedure.

## Local development

```sh
cp worker/.dev.vars.example .dev.vars   # at the repo root, next to the wrangler configs; fill in the local OAuth App
cd worker
npm run migrate:local
npm run dev                             # http://localhost:8787, with the staging config
```

The local OAuth App has homepage `http://localhost:8787` and callback `http://localhost:8787/auth/callback`. `npm run dev` builds `_site/` and passes `--local-upstream localhost:8787`, so the Origin check sees the local address. Local D1 and the room live in `.wrangler/` and never touch staging.
