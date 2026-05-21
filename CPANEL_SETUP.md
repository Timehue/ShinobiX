# cPanel Node.js App Setup (fatedreunion.com / sparkedhost)

## Goal
Run the Express API server on cPanel (Phusion Passenger) to offload API traffic
from Vercel/Supabase and reduce Supabase CPU load.

The server uses `DATABASE_URL` (direct Postgres pool) instead of Supabase REST,
so it is faster and never hits Supabase's CPU-intensive JSONB endpoints.

---

## Folder structure to create in File Manager

```
nodeapps/shinobi-api/
nodeapps/shinobi-api/api/          <- compiled API handlers
nodeapps/shinobi-api/public/       <- built React frontend
nodeapps/shinobi-api/server.js     <- Express entry point
nodeapps/shinobi-api/package.json  <- cpanel-deploy/package.json
```

---

## Files to upload

| Local source | Upload destination |
|---|---|
| `dist/server.js` | `nodeapps/shinobi-api/server.js` |
| `dist/api/` (entire folder) | `nodeapps/shinobi-api/api/` |
| `cpanel-deploy/package.json` | `nodeapps/shinobi-api/package.json` |
| `shinobij.client/dist/*` (all files) | `nodeapps/shinobi-api/public/` |

**Tip:** Zip `dist/` locally, upload & extract in File Manager, then move
the contents of the extracted `dist/` folder up into `nodeapps/shinobi-api/`.
Then upload `cpanel-deploy/package.json` as `package.json`.
Then zip & upload `shinobij.client/dist/` into the `public/` subfolder.

---

## Application Manager registration form

- **Application name**: `Shinobi Journey`
- **Deployment domain**: `fatedreunion.com`
- **Application root**: `nodeapps/shinobi-api`
- **Application startup file**: `server.js`
- **Node.js version**: newest available (18+ required, 20+ preferred)
- **Application mode**: Production

---

## Environment variables

Set these in Application Manager after registering:

```
DATABASE_URL        = postgres://postgres.soaychxshtbgwujhytsf:<password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
SUPABASE_URL        = https://soaychxshtbgwujhytsf.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <service role key>
ADMIN_PASSWORD      = <admin password>
OPENAI_API_KEY      = <openai key if using AI image generation>
```

> NOTE: Rotate the Postgres password after setup — it was shared in chat.
> Go to Supabase dashboard → Settings → Database → Reset password.

---

## Start the app

1. Click **Run NPM Install** (installs express, pg, @supabase/supabase-js)
2. Click **Restart**

---

## Test endpoints

```
https://fatedreunion.com/api/health          -> {"ok":true}
https://fatedreunion.com/api/debug/storage   -> confirms DB connection
https://fatedreunion.com/                    -> serves React frontend
```

---

## How it works

- Phusion Passenger launches `node server.js` and keeps it alive
- `server.js` is the Express wrapper in `dist/server.js`
- All `/api/*` routes hit the Express handlers directly (no Vercel cold starts)
- `public/` folder serves the React SPA; `*` falls through to `index.html`
- `_storage.ts` detects `DATABASE_URL` and uses the pg Pool backend instead
  of Supabase REST — this is what cuts the CPU load

---

## Rebuilding after code changes

```bash
# In the NinjaK repo:
npm run build:cpanel          # compiles TypeScript -> dist/
cd shinobij.client && npm run build   # builds React -> shinobij.client/dist/

# Then re-upload changed files to cPanel and restart the app
```
