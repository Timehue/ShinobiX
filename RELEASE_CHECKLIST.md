# ShinobiX Release Checklist

Use this before a public beta, release candidate, or staging cutover. Do not call
a release ready unless the automated gates pass and the manual smoke items below
have current evidence.

## Build

- [ ] Node 22 confirmed locally and on deploy hosts (`node --version`)
- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd shinobij.client && npm ci`
- [ ] `cd shinobij.client && npm run lint`
- [ ] `cd shinobij.client && npm run build`
- [ ] `cd shinobij.client && npm audit --audit-level=high`
- [ ] CI green on the release branch or PR
- [ ] `npm run sizecheck` reviewed; top assets are expected
- [ ] `npm run check:tooling-handoffs`
- [ ] Current Critical/High CodeQL alert inventory is zero (a successful scan alone is not this check)

## Environment

- [ ] `SESSION_SECRET` set to a long random value
- [ ] `ADMIN_PASSWORD` set
- [ ] `ADMIN_CONTENT_PASSWORD` set
- [ ] `RESTART_TOKEN` set and not equal to `KV_PROXY_TOKEN`
- [ ] `CRON_SECRET` set if the manual cron endpoint is used
- [ ] Production storage is the current Supabase/base-store topology; the retired cPanel overlay is not configured
- [ ] Credentialed `/health?deep=1` confirms `saveStore=base-store` and a fresh backup
- [ ] Staging gate: `HEALTH_DEEP_TOKEN=... EXPECTED_SAVE_STORE=base-store REQUIRE_FRESH_BACKUP=1 node scripts/release-health-check.mjs https://your-staging-url.com`
- [ ] Forged-item scanner/backfill and remaining legacy-writer migration are complete before setting `STRICT_RAW_SAVE_LEDGER=1`
- [ ] If `STRICT_RAW_SAVE_LEDGER=1` is part of this cutover, the exact-candidate staging journey proves mastery, pets, inventory, and progression survive save/reload
- [ ] Retired Weekly Boss client-damage and mission client-win routes return their fail-closed responses

## Gameplay Smoke

- [ ] register
- [ ] login
- [ ] create character
- [ ] save/reload
- [ ] train
- [ ] jutsu train
- [ ] mission
- [ ] hunt
- [ ] inventory
- [ ] bank
- [ ] hospital
- [ ] PvP
- [ ] Battle Towers and Endless Spire
- [ ] Weekly Boss contribution, reconnect, expiry, and reward claim
- [ ] Hollow Gate enter, reconnect, extract, death, and reward settlement
- [ ] story chapter progression and finale
- [ ] Card Clash tutorial, free play, and AI settlement
- [ ] starter pet, wild encounter, Pet Home, breeding, expedition, arena, and ladder
- [ ] profession choice plus Healer, Vanguard, and Pet Tamer loops
- [ ] village agenda, treasury, map control, Village War, and sector rewards
- [ ] clan create/join, missions, treasury, Clan Boss solo, and Clan Boss parties when enabled
- [ ] custom jutsu
- [ ] bloodline jutsu
- [ ] weapon
- [ ] throwable
- [ ] consumable
- [ ] armor
- [ ] Clan Boss
- [ ] sector war if enabled
- [ ] legacy if enabled
- [ ] admin-authored narrative-only event publishes; unsupported creator missions/raids/reward events remain player-hidden

## Anti-Cheat

- [ ] tampered first save blocked
- [ ] duplicate reward claim blocked
- [ ] forged AI/mission win rejected or feature-gated
- [ ] duplicate Clan Boss settle banks once
- [ ] wrong-player settle rejected
- [ ] client cannot mint premium/power currencies through save
- [ ] client cannot self-grant server-owned titles/legacy
- [ ] Weekly Boss contribution is derived from the server-owned combat session
- [ ] Combat mission rewards require a winning server-owned combat session

## Ops

- [ ] request ID visible on error responses
- [ ] logs searchable by request ID
- [ ] Sentry enabled if desired; `sendDefaultPii: false` verified
- [ ] save snapshot cron enabled on one primary only
- [ ] restore drill documented and recently rehearsed
- [ ] isolated restore/readback rehearsed against the current Supabase/base-store topology after the cPanel-overlay retirement
- [ ] rollback steps documented
- [ ] operators know to search server logs for `[server error] [req <id>]`

## Deployment

- [ ] Railway `numReplicas=1`
- [ ] Do not raise Railway above one replica until shared presence and multi-replica settlement proof exist
- [ ] cPanel remains retired from the production gameplay and storage topology
- [ ] CDN/cache headers verified
- [ ] `index.html` no-cache
- [ ] hashed assets immutable
- [ ] fixed media cache sane
- [ ] Authenticated staging soak completed at intended peak and 1.5x peak (runbook default: 500 players for 300 seconds) while recording Railway CPU/RSS/event-loop and Postgres pool pressure
- [ ] Disposable rollback/schema-compatibility exercise completed for this candidate
- [ ] Candidate version chosen, current release notes written, and the exact certified SHA tagged only after all gates pass

## Clan Boss Operation Manual Staging

- [ ] Leave `DISABLE_CLAN_BOSS` unset; `server.ts` enables the weekly boss by default.
- [ ] Deploy initially with `DISABLE_CLAN_BOSS_PARTIES=1` and pass the solo-compatibility and admin-diagnostics gate.
- [ ] Remove only `DISABLE_CLAN_BOSS_PARTIES` on disposable staging, confirm diagnostics report parties enabled, and execute `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md` in full.
- [ ] Archive evidence for the 1-, 2-, and 4-player, Postgres, reconnect, response-loss, concurrent-settlement, loadout, expiry, admin, packet, duration, viewport, support, and AFK cases.
- [ ] Approve a staffed party rollout only after every runbook case passes; retain `DISABLE_CLAN_BOSS_PARTIES=1` as the party-only rollback.
