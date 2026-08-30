# Product analytics data inventory

The product-event boundary is optional, explicit, aggregate-only, and disabled by default. Internal beta/economy/request telemetry remains the canonical operational record. The optional PostHog pilot uses the public capture API directly; it installs no SDK and enables no autocapture, DOM/form capture, cookies, replay, feature-flag polling, or person profiles.

PostHog requires a `distinct_id` even for anonymous events. Every event uses the same sentinel, `shinobi-journey-aggregate-v1`, plus `$process_person_profile: false`. It is deliberately not a player, browser, device, or session identity. Therefore this pilot supports aggregate event/property counts only; unique-user counts, retention cohorts, and user funnels are not valid outputs.

## Event inventory

| Event | Authority | Emission point / source of truth | Allowed properties | Retention concern | Third-party destination | Disabled/opt-out behavior |
|---|---|---|---|---|---|---|
| `landing_viewed` | Client-observed | `StartScreen.tsx` when the landing view is shown | `screenId`, `source`, `eventAuthority` | Aggregate visit count; no URL or identity | PostHog only when client gates are enabled | No event/network when disabled; no per-player identity exists |
| `character_creation_started` | Client-observed | Landing create action in `StartScreen.tsx` | `source`, `eventAuthority` | Aggregate onboarding-entry count | Optional PostHog | Same |
| `feature_entry_clicked` | Client-observed | Explicit login/guides/leaderboard landing actions | `source`, `contentId`, `eventAuthority` | Feature interest count; content IDs are authored constants | Optional PostHog | Same |
| `recoverable_ui_error_shown` | Client-observed | Root or screen React error boundary | `source`, `errorCategory`, `eventAuthority` | Aggregate UI reliability count; no error text/stack (Sentry owns diagnostics) | Optional PostHog | Same |
| `account_registered` | Server-authoritative | Existing `recordBetaMetric(account.registered)` after the auth row commits | `source`, `eventAuthority` | Account-count event without name/IP | Optional PostHog | Internal beta metric still records; external path is a no-op |
| `character_created` | Server-authoritative | First authenticated non-clan save after it commits | `source`, `eventAuthority` | Character-count event without name/save/village | Optional PostHog | Save is unaffected; external path is fire-and-forget/no-op |
| `mission_started` | Server-authoritative | New durable combat-mission session, not a resume | `mode`, `contentId`, `levelBand`, `eventAuthority` | Authored mission ID and coarse level band | Optional PostHog | Session creation is unaffected |
| `mission_settled` | Server-authoritative | Bridge from existing canonical `mission.claimed` beta metric after claim settlement | `source`, `levelBand`, `eventAuthority` | Coarse mission category; no reward/balance values | Optional PostHog | Internal beta/economy telemetry remains available |
| `shop_purchase_settled` | Server-authoritative | Non-replayed server-authoritative shop purchase | `source`, `contentId`, `eventAuthority` | Authored item ID only; no balance, inventory, or request ID | Optional PostHog | Purchase/reward path is unaffected |
| `pet_breeding_started` | Server-authoritative | Non-replayed breeding session after versioned save commit | `source`, `eventAuthority` | Aggregate start count; no pet/parent names, IDs, odds, or save | Optional PostHog | Breeding path is unaffected |
| `ranked_match_settled` | Server-authoritative | Bridge from canonical `pvp.settled` only when source is ranked | `mode`, `resultCategory`, `levelBand`, `eventAuthority` | Aggregate result and coarse level band; no opponent/player/rating | Optional PostHog | Existing beta metrics remain available |

## Property contract

`shared/product-analytics.ts` rejects unknown event names, unknown properties, freeform strings, values longer than 80 characters, strings outside a conservative identifier alphabet, and numeric values. The allowlist is: `source`, `screenId`, `mode`, `resultCategory`, `levelBand`, `villageCode`, `deviceTier`, `viewportClass`, `surface`, `featureFlag`, `featureFlagState`, `durationBucket`, `errorCategory`, `contentId`, and `eventAuthority`.

**Ambient properties.** `surface` and `viewportClass` are stamped onto every *client-observed* event automatically by `shinobij.client/src/lib/analytics/runtime.ts`; no call site passes them, and a call site cannot override them (they are applied after the caller's properties, like `eventAuthority`). Server-authoritative events carry neither, because the server has no viewport and cannot tell the surfaces apart. `surface` is `play-app` or `web`; `viewportClass` is one of six width buckets. Both stay aggregate-only: two values and six, with the shared `distinct_id` leaving nothing to join them against. They exist to answer what share of play is phone-shaped and what share happens inside the Play app — the two questions that decide whether an Android-only storefront is viable.

Never add player names/slugs, email, IP, fingerprints, tokens, save keys, request IDs, exact balances, freeform text, chat, reports, prompts, URLs, inventories, combat logs, raw errors, or whole objects. New events/properties require updating this inventory and the schema tests before a call site can emit them.

## Transport and failure behavior

- Client provider code is dynamically imported only after an explicitly enabled event. The in-memory queue is capped at 32 events and is never persisted.
- Client and server requests use a 1.5-second abort signal and fire-and-forget behavior. Failures increment only process-local diagnostics counters and never fail a page transition, save, reward, battle, purchase, or startup.
- Server and client can be enabled independently. This is useful while owner consent/policy decisions are unresolved.
- No duplicate admin dashboard was added. `readClientAnalyticsStatus()` and `readProductAnalyticsStatus()` expose only enabled/provider/last status/failure/drop counts for a future diagnostics card; they expose no project token.

## Owner decisions before production enablement

This document does not make legal-compliance claims. The owner must decide and document the lawful basis/consent behavior, privacy-policy wording, retention period, deletion expectations for aggregate events, chosen PostHog region, account access controls, event budget/alerts, and whether a user-facing global analytics opt-out is required. Until those decisions are made, leave all analytics environment variables absent.
