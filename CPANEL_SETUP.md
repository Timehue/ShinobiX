# cPanel Deployment Guide — ShinobiX

Runs the Express API + React SPA on cPanel via Phusion Passenger (Node.js).
No Vercel needed. Direct Postgres connection to Supabase cuts cold-start latency.

---

## One-time setup

### 1. Clone the repo on the server

In cPanel → **Terminal** (or SSH):

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/Timehue/ShinobiX.git shinobix
cd shinobix
npm install
```

### 2. Register the Node.js app in cPanel

Go to **Software → Setup Node.js App → Create Application**:

| Field | Value |
|---|---|
| Node.js version | 20 or 22 (latest available) |
| Application mode | Production |
| Application root | `apps/shinobix` |
| Application URL | `fatedreunion.com` (or subdomain) |
| Application startup file | `app.js` |

Click **Create**.

### 3. Set environment variables

In the Application Manager, add:

```
DATABASE_URL         = postgres://postgres.<project>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres
SUPABASE_URL         = https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY = <service role key>
ADMIN_PASSWORD       = <your admin password>
OPENAI_API_KEY       = <openai key — only needed for AI image generation>
```

> `DATABASE_URL` activates the direct pg Pool backend in `_storage.ts`.
> This is faster than Supabase REST and avoids their CPU-intensive JSONB endpoints.

### 4. Run npm install (in App Manager)

Click **Run NPM Install** in the Application Manager, or in Terminal:

```bash
cd ~/apps/shinobix
npm install
```

### 5. Start the app

Click **Restart** in the Application Manager.

---

## Test it

```
https://fatedreunion.com/api/health          → {"ok":true}
https://fatedreunion.com/api/debug/storage   → confirms DB connection + env vars
https://fatedreunion.com/                    → React SPA loads
```

---

## Deploying updates

All code changes flow through Git. After pushing to GitHub:

**On the cPanel server (Terminal or SSH):**

```bash
cd ~/apps/shinobix
git pull
npm run build        # compiles TypeScript + builds React client
```

Then click **Restart** in Application Manager (or via Terminal if you have the restart command).

### What `npm run build` does

1. `build:server` — TypeScript → `dist/` (Express server + API handlers)
2. `build:client` — Vite → `shinobij.client/dist/` (React SPA)

The Express server automatically serves the React build from `shinobij.client/dist/`
and falls back to `index.html` for all non-API routes.

---

## How it works

```
cPanel Passenger
  └── node app.js
        └── loads .env
        └── imports dist/server.js  (Express)
              ├── /api/*  →  handler modules in dist/api/
              └── /*      →  serves shinobij.client/dist/ (React SPA)
```

- `_storage.ts` sees `DATABASE_URL` → uses pg Pool (direct Postgres, no REST overhead)
- All `/api/...` fetch calls from the React app hit the same Express process
- No cold starts, no Vercel function limits, no Supabase REST timeout issues

---

## File layout (on server)

```
~/apps/shinobix/
  app.js                     ← Passenger entry point (loads .env, starts server)
  dist/
    server.js                ← compiled Express server
    api/                     ← compiled API handlers
  shinobij.client/
    dist/                    ← built React SPA (served as static files)
  api/                       ← TypeScript source (not served directly)
  package.json
  .env                       ← created manually on server, never committed
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| App won't start | `cat ~/apps/shinobix/logs/error.log` or Passenger log in cPanel |
| `/api/health` 502 | App not running — click Restart in App Manager |
| `/api/debug/storage` error | Check `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars |
| React app shows blank page | Run `npm run build` — client may not be built yet |
| API calls return 404 | Run `npm run build:server` — dist/ may be out of date |
