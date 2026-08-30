# Full Game Simulation Report

Date: 2026-07-06
Worktree: `C:\Users\Tyler R\source\repos\NinjaK-full-game-simulation`
Branch: `codex/full-game-simulation-20260706`
Base commit: `6ceb920e Expose economy reconciliation in admin diagnostics`
Push status: not pushed

## Summary

I added a deterministic full-game simulation harness and wired it into the normal root `npm test` command.

Primary harness:

- `api/simulation/_full-game-simulation.test.ts`
- `package.json` test script now includes that file.

The harness does not use production credentials, production data, external APIs, or live Supabase state. It uses local synthetic characters and real server-side gameplay helpers.

## Commands Run

| Command | Result |
| --- | --- |
| `node --version` | `v24.15.0` |
| `npm --version` | `11.12.1` |
| Root dependency install | Historical pass; current release flow uses committed lockfiles with `npm ci` |
| `cd shinobij.client; npm ci` | Pass, initially reported 6 audit findings: 1 low, 2 moderate, 3 high |
| `cd shinobij.client; npm audit fix` | Pass, updated `shinobij.client/package-lock.json`, 0 vulnerabilities remaining |
| `cd shinobij.client; npm ci` after audit fix | Pass, clean install from lockfile, 0 vulnerabilities |
| `cd shinobij.client; npm audit` | Pass, 0 vulnerabilities |
| `cd shinobij.client; npm ls vite @babel/core brace-expansion qs ws engine.io-client` | Pass, confirmed patched dependency versions |
| `npm run build:server` | Pass |
| `cd shinobij.client; npm run lint` | Pass |
| `cd shinobij.client; npm run build` | Pass |
| `node --import tsx --test api/simulation/_full-game-simulation.test.ts` | Pass: 5 tests, 0 failures |
| `npm test` | Pass: 2379 tests, 375 suites, 0 failures |
| `npm run build` | Pass: server build, client build, `verify:dist` OK |
| `curl http://127.0.0.1:4181/health` | Pass: `{"ok":true,...}` |
| Browser smoke against `http://127.0.0.1:4181/` | Pass: root rendered, no failed images, no browser console errors, start-flow click opened character creation |

Note: build output was generated during verification and then cleaned back out of the worktree so the remaining diff stays reviewable.

## Simulation Coverage

### New Player Journey

Covered:

- New synthetic player creation
- Academy trial reward
- First combat mission claim through server mission reward helpers
- First hunt claim through server hunt reward helpers
- Territory scroll and hunt material inventory grants
- First PvE/tower fight through the real tower engine
- Sector travel state update
- Save/reload round trip by JSON serialization
- Resource and stat health checks after each step

### Villages and Specialties

Covered all requested villages:

- Ashen Leaf
- Stormveil
- Frostfang
- Moonshadow

Covered all combat specialties:

- Ninjutsu
- Taijutsu
- Genjutsu
- Bukijutsu

The harness runs a four-player party through Battle Tower floor 5 using `buildTowerEncounter` and `runTowerFloor`, then asserts a completed squad win and numerically safe actor state.

### Combat and PvP Parity

Covered:

- Built-in PvP jutsu resolution through `applyJutsu`
- Custom-created jutsu resolution through the same PvP truth source
- Status/tag application from custom jutsu
- Tower/PvE combat using the N-actor tower engine
- Named created weapon use
- Thrown weapon charge spending and `itemsUsed` tracking
- Combat item use and cooldown/charge spending
- Rejuvenation potion chakra/stamina restoration and charge spending

Pet and card battle parity were intentionally excluded from PvP parity per request. Existing pet/card tests still ran in the full suite, and the new route/UI contract checks that pet/card screens remain present.

### Clan Boss

Covered:

- Weekly clan boss week id
- Boss definition/floor lookup
- Clan progress creation
- Attempt reservation with participant breadth
- Repeated real Battle Tower boss assaults
- Assault HP cap via `CB_ASSAULT_HP_CAP`
- Server-trusted assault extraction via `extractAssaultResult`
- Banking damage via `bankAssault`
- Pool kill completion
- Kill timestamp
- Full damage accounting
- Composite score via `clanBossScore`
- Attempt cap guard via `CB_ASSAULTS_PER_MEMBER`

The simulation uses `oni-warlord` because it is deterministic and avoids the bulwark/regen mechanics making this smoke harness slow or noisy. Existing clan boss unit tests still cover floor catalog parity and clan-boss/PvP adapter parity.

### Sectors, Missions, Hunts, Economy, Inventory, Shops, Progression

Covered in a 1000-step soak over 64 synthetic players:

- Training stat increments
- Stamina spend
- Combat mission claims
- Hunt claims
- Daily mission and hunt cap checks
- Sector movement over the 1..144 range
- PvP base win rewards through `creditPvpWinBase`
- Shop-like ryo sink and potion inventory grant
- Bank interest through `computeBankInterest`
- Hospital heal sink
- Potion consumption
- Economy aggregation through `applyTxnToAgg`
- Duplicate transaction id detection
- Character health invariants after every step

### Server Route and Client Screen Contract

The harness asserts critical server routes are registered in `server.ts`, including:

- `/player-auth`
- `/save/:name`
- `/player/heal`
- `/training/start`
- `/training/complete`
- `/missions/daily`
- `/missions/claim-mission`
- `/sector/questbook`
- `/pvp/session`
- `/pvp/move`
- `/towers/start`
- `/towers/action`
- `/towers/settle`
- `/clan-boss/get`
- `/clan-boss/assault-start`
- `/clan-boss/assault-settle`
- `/bank/claim-interest`
- `/jutsu/speedup`

It also asserts key client screens exist, including Start, Character Creator, Training, Missions, World Map, PvP Battle, Battle Tower Fight, Clan Boss, Inventory, Bank, Hospital, Bloodline Maker, and pet/card sector battle screens.

## Browser/UI Smoke

Server used:

- `node dist/server.js`
- `PORT=4181`
- `DISABLE_REALTIME=1`
- `DISABLE_CLAN_BOSS=1`
- Local-only dummy secrets

Why port 4181: port 4174 was already occupied by an older Vite preview from another worktree, which caused empty replies on `127.0.0.1:4174`. I did not stop that unrelated process.

Browser checks:

- Landing page title: `Shinobi Journey -- A Living Ninja MMO`
- Root mounted: yes
- Root child count: 1
- Image count: 11
- Failed images: 0
- Browser console errors: 0
- Visible controls included `Log In`, `Play Now`, `Enter the World`, `Open the Guides`, `Start Playing`
- Clicking `Enter the World` opened the character creation flow with `Begin as a Shinobi`, `Choose Village`, and `Preview Shinobi`
- Failed images after click: 0
- Browser console errors after click: 0

Local server logs did show expected API errors for endpoints that require Supabase env:

- `/api/player/roster`
- `/api/game-state`
- `/api/world-state`

Those are environment limitations of this no-production-credentials run, not browser-render failures. I did not add fake Supabase credentials or hit production data.

Performance notes from the local perf beacon:

- Cold-start beacon: TTFB about 10 ms, FCP about 124 ms, LCP about 424 ms, load about 293 ms at 1280x720
- One reported long task: 120 ms
- Reported page bytes around 2.35 MB on the landing load
- Large build assets observed during `npm run build`: `world_map` about 795 KB, `tactics-diorama` about 612 KB, main CSS about 652 KB uncompressed / 120 KB gzip

## Findings

### No gameplay blocker found in the simulated paths

The new harness completed all tested gameplay paths without negative currencies, invalid resource values, failed combat termination, broken item charge accounting, duplicate economy transaction ids, or clan boss settlement drift.

### Local browser APIs need real storage env for full live-data testing

The SPA renders and starts the character creator locally, but live-data endpoints that read storage log errors when Supabase env vars are absent. A deeper browser test of roster/world/game-state screens needs either a dedicated local test storage backend or non-production Supabase credentials.

### Performance watch items

The landing page works, but the asset footprint is not tiny. The largest observed assets and CSS bundle are worth watching if load time becomes a user complaint.

### Dependency audit resolved

The 6 `shinobij.client` npm audit findings were resolved by updating the client lockfile with `npm audit fix`.

Patched resolved versions:

- `vite@8.1.3`
- `@babel/core@7.29.7`
- `brace-expansion@5.0.7`
- `qs@6.15.3`
- `engine.io-client@6.6.6`
- `ws@8.21.0`

`npm audit` now reports 0 vulnerabilities in `shinobij.client`.

## Files Changed

- Added `api/simulation/_full-game-simulation.test.ts`
- Updated `package.json` to include the simulation harness in `npm test`
- Updated `shinobij.client/package-lock.json` to resolve the 6 client npm audit findings
- Added this report: `FULL_GAME_SIMULATION_REPORT.md`

## Re-run Commands

Focused harness:

```powershell
node --import tsx --test api/simulation/_full-game-simulation.test.ts
```

Full suite:

```powershell
npm test
```

Build verification:

```powershell
npm run build
```

Browser smoke:

```powershell
$env:PORT='4181'
$env:SESSION_SECRET='local-simulation-secret'
$env:ADMIN_PASSWORD='local-admin'
$env:ADMIN_CONTENT_PASSWORD='local-content'
$env:DISABLE_REALTIME='1'
$env:DISABLE_CLAN_BOSS='1'
node dist/server.js
```

Then open:

```text
http://127.0.0.1:4181/
```

## Sign-off Status

No commit, no push, and no changes to main were made. This remains isolated in the worktree and branch pending review.
