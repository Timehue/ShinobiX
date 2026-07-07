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

## Environment

- [ ] `SESSION_SECRET` set to a long random value
- [ ] `ADMIN_PASSWORD` set
- [ ] `ADMIN_CONTENT_PASSWORD` set
- [ ] `RESTART_TOKEN` set and not equal to `KV_PROXY_TOKEN`
- [ ] `CRON_SECRET` set if the manual cron endpoint is used
- [ ] Storage mode chosen deliberately: Supabase-only or cPanel disk overlay
- [ ] If disk overlay is used, `REQUIRE_DISK_OVERLAY=1`
- [ ] `/health?deep=1` confirms expected `saveStore`
- [ ] For staging gate: `EXPECTED_SAVE_STORE=remote-proxy node scripts/release-health-check.mjs https://your-staging-url.com`
- [ ] cPanel-only DNS bypass, if needed, has both `SUPABASE_DNS_HOST` and `SUPABASE_HARDCODED_IP`; no fallback host/IP is in source
- [ ] Public beta leaves `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` unset until Weekly Boss settlement is server-authoritative
- [ ] Public beta leaves `ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` unset unless higher-rank local-combat mission rewards are explicitly accepted

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
- [ ] tower
- [ ] custom jutsu
- [ ] bloodline jutsu
- [ ] weapon
- [ ] throwable
- [ ] consumable
- [ ] armor
- [ ] Clan Boss
- [ ] sector war if enabled
- [ ] legacy if enabled

## Anti-Cheat

- [ ] tampered first save blocked
- [ ] duplicate reward claim blocked
- [ ] forged AI/mission win rejected or feature-gated
- [ ] duplicate Clan Boss settle banks once
- [ ] wrong-player settle rejected
- [ ] client cannot mint premium/power currencies through save
- [ ] client cannot self-grant server-owned titles/legacy
- [ ] Weekly Boss player contribution is disabled or server-authoritative
- [ ] High-value combat mission rewards are disabled or server-authoritative

## Ops

- [ ] request ID visible on error responses
- [ ] logs searchable by request ID
- [ ] Sentry enabled if desired; `sendDefaultPii: false` verified
- [ ] save snapshot cron enabled on one primary only
- [ ] restore drill documented and recently rehearsed
- [ ] rollback steps documented
- [ ] operators know to search server logs for `[server error] [req <id>]`

## Deployment

- [ ] Railway `numReplicas=1`
- [ ] cPanel does not serve gameplay API unless Passenger is single worker or shared presence exists
- [ ] If cPanel ever serves gameplay, Passenger must be single worker or presence must move to Redis/shared store
- [ ] cPanel only serves KV/image overlay for production gameplay topology
- [ ] CDN/cache headers verified
- [ ] `index.html` no-cache
- [ ] hashed assets immutable
- [ ] fixed media cache sane

## Clan Boss Manual Staging

- [ ] enable `ENABLE_CLAN_BOSS=1`
- [ ] seed clan
- [ ] open Clan Boss UI
- [ ] start solo assault
- [ ] start party assault
- [ ] use normal jutsu
- [ ] use bloodline jutsu
- [ ] use custom jutsu
- [ ] use weapon
- [ ] use throwable
- [ ] use potion
- [ ] use combat item
- [ ] win/wipe/timeout
- [ ] settle twice
- [ ] verify standings
- [ ] verify inventory deduction
- [ ] verify weekly reward once-only
