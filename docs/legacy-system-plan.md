# Legacy System — Implementation Plan

**Status:** CORE BUILT (see the §5.1 status banner for exactly what shipped and
what's deferred), then hardened by a 47-agent adversarial verification pass
(35 confirmed findings fixed — dead-stat requirements, trial strands, the
accept-transaction repair path, pity reset, announcement-matrix drift, and
client dead-ends). This document remains the design source of truth for the
deferred waves (Specialty Jutsu, Eras, nameplates, reserved-title moderation).
Historical note: rarity tiers were revised by design direction from the
five-tier model in early passages to four tiers — 15 basic / 50 rare /
25 legendary / 10 mythic ("epic"/"common" no longer exist); where older
sections mention five tiers, the four-tier model and
[legacy-roster.md](legacy-roster.md) win.

**Prime directives preserved throughout:**
1. Bloodlines and Legacies are completely separate. Nothing here reads
   `bloodline`, `savedBloodlines`, or `equippedBloodlineId` for eligibility.
2. One Legacy per player, forever. Lock happens at acceptance (Stage 1).
   Decline is always free. No respec of any kind; admin emergency correction
   only, audited.
3. Nothing in this plan changes PvP combat balance. The one component that
   *touches* PvP (Specialty Jutsu) is explicitly gated behind a sign-off
   checkpoint (§10.6) and can ship PvE-only first.
4. Every reward path is server-authoritative (recompute or mint-token), per
   `docs/auth-and-anti-cheat-patterns.md`.

---

## 0. TL;DR

The handoff describes ~14 SQL tables, ~10 services, and ~40 endpoints. After a
full codebase survey, roughly **half of the system already exists** in some
form and should be *extended*, not rebuilt:

| Handoff concept | Already in the codebase | Gap to build |
|---|---|---|
| Wandering NPC that offers things | Sector Wanderers (`lib/wanderers.ts`, `api/sector/wanderer-*`), incl. an existing **Sage** archetype with quests | Per-player eligibility-gated spawn + pity, offer flow |
| NPC dialogue w/ portraits, branching, permanent flags | VN engine (`TriggeredVisualNovel.tsx`, `types/vn.ts`, `storyTraits`, choice `requireTrait`/`forbidTrait`/`trait`) | A Sage VN script + a way to feed it dynamic offer data |
| Level 1–50 tracking | ~15 lifetime counters already on the save (`totalPvpKills`, `totalMissionsCompleted`, `totalTilesExplored`, `warsWon`, `warMvpCount`, `lifetimeWarDamage`, ranked W/L, card clash W/L/D…) | Tamper-resistant side-car store, per-style buckets, support-action counters |
| Titles | Paid custom title (10 Fate Shards, 32 chars, moderated) + 18 achievement-earned wearable titles + `rankTitle` | Legacy titles, reserved-terms list, nameplate component, admin review/revoke |
| Hall of Legends | `screens/HallOfLegends.tsx` (6 leaderboard tabs) | A *permanent history* tab backed by a new store with statuses + admin correction |
| Trials (server-verified runs) | Hollow Gate start/settle sealed tokens; wanderer-ambush baseline+N-kills gauntlet; wanderer-quest metric baselines | Legacy trial definitions reusing those exact patterns |
| Announcements | Nothing (village chat only) | New `game:announcements` store + world-state-poll delivery + login briefing surface |
| Eras | Nothing directly; village-war / weekly-boss give the shape | `game:era-state` + contribution counters + unlock transaction |
| Admin tools | AdminPanel + `x-admin-password`, `recordAudit()` (`api/_audit.ts`), ModerationPanel | New Legacy admin section + new audit domain |
| Anti-cheat plumbing | `withKvLock`, NX once-markers, `consumeSingleUseToken`, daily-cap keys `X:<player>:<YYYY-MM-DD>` (25h TTL), rate limiter | Nothing new — reuse verbatim |

**No Supabase schema changes are needed.** Everything maps onto the existing
`kv_store` KV layer + save-embedded fields (§3), which is the house pattern for
every feature shipped in the last year (ranked seasons, sector war, card clash,
hollow gate).

Build order (§20): 8 waves, each independently shippable behind
`ENABLE_LEGACY` (server env) + `legacy.v1` (client flag), flags-off =
byte-identical behavior.

---

## 1. Design deviations from the handoff (and why)

These are the places where, exercising the "freedom to tweak" grant, the plan
deliberately departs from the handoff text. Everything not listed here follows
the handoff as written.

1. **No new SQL tables.** The handoff's 14 tables become KV keys + save fields
   (§3). CLAUDE.md forbids schema changes without approval, and the KV pattern
   is what every recent system uses. The `kv_store` JSONB table already gives
   us atomic NX (unique-constraint equivalent), TTL, locks, and Realtime.

2. **Authoritative Legacy stats live *outside* the player save.** The save is
   client-writable via autosave (by design — rewards are separately
   server-authorized). A prestige system that mints server announcements and a
   jutsu cannot trust save-embedded counters. So the scoring input is a
   server-only side-car key `legacy:stats:<player>`, written exclusively inside
   server settle endpoints (§4). Existing save counters are consulted **once**,
   at retroactive-bootstrap time, with reduced trust weighting (§5.4) — which
   also solves the handoff's "existing player fallback" requirement.

3. **No new currencies at launch.** The handoff proposes Legacy Seals, Memory
   Shards, Trial Sigils, Honor Marks. The economy was just repriced and has
   five materials already (`boneCharms`, `auraStones`, `auraDust`,
   `fateShards`, `mythicSeals`). Legacy progression is *achievement-gated, not
   material-gated* — which the handoff itself demands ("earned through
   achievements, not bought"). Materials add economy surface, dupe-bug surface,
   and UI surface for zero mechanical need. **Memory Shards** are kept as an
   optional Wave-8 flavor drop (cosmetic collection item from Legacy content)
   if you want them; nothing depends on them. Bone Charms / Aura
   Shards(Stones) stay bloodline/clan-side untouched, exactly per the handoff.

4. **Custom-title moderation is filter-first with a post-hoc admin review
   list, not a pre-approval queue.** The game already auto-filters
   (`sanitizeUserText`/`isCleanText`) with no queue. A pre-approval queue means
   building pending states, escrowed charges, refund flows, and admin latency
   for every purchase. Instead (§11.4): a hard **reserved/impersonation terms
   list** rejects instantly server-side (player is never charged — purchase
   validates before debit), the existing profanity filter rejects instantly,
   and a new admin "Recent custom titles" view supports one-click
   **revoke + refund** after the fact, audited. This satisfies the handoff's
   real goals (no impersonation, no offensive titles, no lost shards) with a
   fraction of the machinery. Industry practice supports hybrid
   automatic-filter + human-review rather than blocking queues.

5. **Sage spawn checks are client-*initiated*, server-*decided*.** There is no
   server push channel for per-player events (Realtime only covers
   `pvp:*`/`cw-tilecards:*`/`challenges:*`). Instead of new push
   infrastructure, the client calls a cheap `sage/roll` endpoint at the
   handoff's qualifying moments (login, PvP win, mission claim, dungeon
   settle, sector discovery). The server owns eligibility, odds, pity, and
   cooldowns, so a spam-clicking client gains nothing (§7.2).

6. **Era milestone counters use `kv.incr` fan-out keys, not one hot blob.**
   The handoff's `milestone_current` single row would become a lock-contention
   hot key with every mission claim bumping it. Per-metric counter keys with
   atomic `incr` + a daily cron roll-up avoid that (§14.3).

7. **Trials are built from existing verified primitives** (gauntlet
   baseline+N-kills, metric-delta objectives, PvP-win objectives) rather than
   a bespoke trial engine (§9). This keeps trials server-verifiable on day one
   without new combat code.

8. **Stage 4 "Proven" small non-PvP bonus is deferred.** The handoff allows a
   "small non-PvP bonus" at Stage 4. Given the balanced-PvP pillar and the
   title-bonus rules (≤1% non-PvP), the plan ships Stages 4–5 as pure
   prestige/cosmetic first; any numeric bonus is a separate, explicit later
   decision (§24).

---

## 2. Handoff → codebase translation map

### 2.1 Tables → storage

| Handoff table | Actual storage (this plan) | Notes |
|---|---|---|
| `legacy_definitions` | Static data module `shinobij.client/src/data/legacies.ts` + server mirror `api/_legacy-defs.ts` (generated, like the jutsu catalog) + admin override key `shared:legacy-defs` | Same pattern as jutsu: static base in code, admin tuning overlay, `updatedAt` recency merge |
| `player_legacy_stats` | KV `legacy:stats:<player>` (server-written only) | §4 |
| `legacy_event_log` | KV `legacy:events:<player>` (capped array, ~200 entries) + `recordAudit()` domain `legacy` for admin-relevant events | Aggregate counters + important-events-only, per handoff |
| `player_legacy_eligibility` | KV `legacy:eligibility:<player>` (computed cache, TTL 7d, recompute on demand) | Never authoritative; always recomputable from stats |
| `player_legacy` | Save field `character.legacy` (display/state) **+** KV `legacy:accepted:<player>` NX marker (the transactional uniqueness constraint) | NX set = the "unique constraint on player_id" (§8.2) |
| `legacy_trial_attempts` | KV `legacy:trial:<player>` (current attempt state; history appended to `legacy:events:<player>`) | |
| `wandering_legacy_npc_events` | KV `legacy:sage-offer:<player>` (active offer, TTL 7d, statuses spawned/viewed/declined/accepted/expired) + pity state `legacy:sage-pity:<player>` | |
| `legacy_rumors` | No store — rumors derive from thresholds over `legacy:stats` at read time; dedupe via `character.legacyRumorsSeen: string[]` (small, capped) | |
| `legacy_admin_audit` | `recordAudit()` with new domain `legacy` (extend the domain union in `api/_audit.ts`) | Existing 5000-cap append log + admin viewer |
| `titles` | Static data `shinobij.client/src/data/titles.ts` (+ existing `constants/achievements.ts` titles) | Definitions are content, not rows |
| `player_titles` | Save fields (existing `earnedTitles`-style union-merge + `character.equippedTitleId`) | §11 |
| `custom_titles` | Existing `character.customTitle` + new KV `titles:custom-log` (recent purchases ring buffer for admin review) | §11.4 |
| `eras` | KV `game:era-state` + per-metric counters `era:contrib:<eraId>:<metric>` | §14 |
| `server_announcements` | KV `game:announcements` (capped array ~100) + `game:announcements-seq` | §12 |
| `hall_of_legends` | KV `hall:entries` (append-only array, no TTL, status per entry) | §13 |
| `hall_of_legends_audit` | `recordAudit()` domain `legacy` | |
| `sector_discovery_rules` / cooldowns | Extends existing wanderer daily-cap keys (`wanderer-gift:<p>:<date>` pattern) — new discovery types get the same `X:<player>:<date>` + rarity config in static data | §15 |

### 2.2 Services → modules

| Handoff service | Actual home |
|---|---|
| LegacyTrackingService | `api/_legacy-track.ts` (pure helpers) called from settle endpoints (§4.2) |
| LegacyEligibilityService | `api/_legacy-score.ts` (pure, heavily unit-tested) + `api/legacy/evaluate.ts` endpoint |
| LegacyRumorService | `shinobij.client/src/lib/legacy-rumors.ts` (client, reads stats snapshot) — rumors are flavor, not rewards, so client-side is safe |
| WanderingLegacyNpcService | `api/legacy/sage.ts` (roll/offer/decline/accept in one handler, action-dispatched like `wanderer-ambush.ts`) |
| LegacyService (accept/trial/stages) | `api/legacy/trial.ts` + `api/_legacy-core.ts` |
| SpecialtyJutsuService | Extension of `api/pvp/session.ts` loadout resolution + `api/_legacy-defs.ts` (§10) |
| TitleService / TitleModerationService | Extensions of save sanitize + `api/_text-moderation.ts` + `api/admin/titles.ts` |
| EraService | `api/_era.ts` + `api/eras.ts` + cron hook |
| AnnouncementService | `api/_announce.ts` (create/rate-limit) — internal helper, no public create endpoint |
| HallOfLegendsService | `api/_hall.ts` + `api/hall-of-legends.ts` (read) + `api/admin/hall.ts` (correct/revoke/hide) |
| SectorDiscoveryService | Extension of existing `api/sector/wanderer-*` patterns |
| AdminLegacyService | `api/admin/legacy.ts` |

---

## 3. Storage design (full key map)

New KV keys (all via existing `api/_storage.ts`; no schema change):

```
legacy:stats:<player>            server-only counters (§4.1)          no TTL
legacy:events:<player>           important-events array, cap 200      no TTL
legacy:eligibility:<player>      cached scoring result                TTL 7d
legacy:sage-offer:<player>       active offer {legacyIds[], status,   TTL 7d
                                  spawnedAt, expiresAt, source}
legacy:sage-pity:<player>        {lastRollDate, missedDays,           no TTL
                                  lastSeenAt, dailyRolls}
legacy:sage-roll:<player>:<date> daily roll counter (kv.incr)         TTL 25h
legacy:accepted:<player>         NX permanence marker {legacyId, ts}  no TTL
legacy:trial:<player>            active trial attempt state           no TTL
legacy:trial-token:<player>:<id> sealed single-use gauntlet token     TTL 24h
titles:custom-log                ring buffer of recent custom-title   no TTL
                                  purchases for admin review, cap 200
game:announcements               array cap 100 {id, type, importance, no TTL
                                  title, message, player, village,
                                  meta, ts}
game:announcements-seq           kv.incr id counter                   no TTL
game:era-state                   {current, eras[{id, status,          no TTL
                                  milestones[], unlockedBy, unlockedAt}]}
era:contrib:<eraId>:<metric>     kv.incr counters                     no TTL
era:unlocked:<eraId>             NX once-marker (double-fire guard)   no TTL
hall:entries                     append-only array {id, entryType,    no TTL
                                  title, desc, player, village,
                                  status: active|corrected|revoked|
                                  hidden, correctionNote, ts}
```

New save fields on `Character` (all optional — old saves unaffected; follows
the `??=` idiom from `types/character.ts`):

```ts
legacy?: {
  legacyId: string;
  stage: 1 | 2 | 3 | 4 | 5;         // handoff Stage 1 "Path Accepted" .. 5 "Mythic"
  acceptedAt: number;
  trialCompletedAt?: number;
  specialtyJutsuUnlockedAt?: number;
  provenAt?: number;
  mythicAt?: number;
};
legacyRumorsSeen?: string[];         // rumor ids, cap ~40
equippedTitleId?: string;            // earned/legacy title slot (separate from customTitle)
```

**Why the split:** `character.legacy` is the *display* copy (renders on
Profile/nameplate/battle instantly, snapshotted nightly). The KV NX marker
`legacy:accepted:<player>` is the *enforcement* copy — the server refuses any
second acceptance regardless of what a tampered save claims, and refuses
specialty-jutsu equip if the marker's `legacyId` doesn't grant it. The save
endpoint's sanitizer strips/ignores client-supplied `legacy` mutations that
disagree with the marker (same defensive posture as `rankTitle` clamping).

Size discipline (image-in-JSON lesson): no images in any of these keys —
portraits/badges live as static client assets or `shared:images` like all
other art. `legacy:stats` is a flat counter object (~40 numbers).

---

## 4. Stat tracking (Phase 1 foundation)

### 4.1 The counter set (`legacy:stats:<player>`)

Flat counters, all `number`, all default 0 — grouped per the handoff's
categories but trimmed to what the engines can actually attribute today:

- **Style:** `ninjutsuKills, ninjutsuDamage, genjutsuKills, genjutsuControlUses,
  taijutsuKills, taijutsuDamage, bukijutsuKills, bukijutsuDamage`
- **PvP:** `pvpKills, pvpWins, pvpLosses, rankedWins, sameRankWins,
  higherLevelWins, defensiveWins, comebackWins, bestKillStreak, warPvpKills`
- **PvE:** `missionCompletions, huntCompletions, pveKills, eliteKills,
  bossContribution, dungeonClears, hollowGateClears, endlessTowerBest,
  firstClears`
- **Exploration:** `tilesExplored, sectorDiscoveries, hiddenFinds, biomesVisited`
- **Village:** `villageDonations, warContribution, sectorCaptures,
  sectorDefenses, warMissions, villageTenureDays`
- **Support:** `healingDone, shieldsApplied, cleansesUsed, damageBlocked`
- **Events:** `eventCompletions, weeklyBossTop10, gauntletTop25`
- **Anti-gaming inputs:** `repeatKillsByTarget` (small map, cap 20 entries,
  decayed), `suspicionFlags`
- **Meta:** `updatedAt, bootstrappedAt, bootstrapSnapshot` (§5.4)

### 4.2 Hook points (exact, from the survey)

`api/_legacy-track.ts` exports `bumpLegacyStats(playerName, deltas)` —
a `kv.get`/merge/`kv.set` on `legacy:stats:<player>`. Call sites (all already
run server-side, most already inside a save lock; the side-car write happens
*after* the existing save write so it can never block a payout):

| Hook | File | What it records |
|---|---|---|
| PvP win report | `api/missions/report-pvp-win.ts:127–144` (after `reportMissionEvent`) | `pvpKills/pvpWins`, same-rank/higher-level flags (both saves are loaded there), `repeatKillsByTarget`, streaks. Reuses the endpoint's existing account-age + IP-overlap farming checks — those failing ⇒ `suspicionFlags++` instead of credit |
| PvP loss / defensive win | same session-settle surface | `pvpLosses`, `defensiveWins` (defender won), `comebackWins` (winner HP < 15% — read from finished `PvpSession`) |
| Style attribution | `api/pvp/move.ts` — add per-cast accumulation on the session object (`session.styleTotals[type] += damage`), rolled into `legacy:stats` at settle | The engine knows each jutsu's `type` at cast time; a per-session accumulator avoids log re-parsing. **Log format unchanged** (no AI-rule-style lines) |
| Support attribution | same accumulator: `Heal`/`Shield` tag applications already resolve in `resolveTagStatuses()` | `healingDone`, `shieldsApplied`, `damageBlocked` |
| Mission claim | `api/missions/claim-mission.ts` (inside save lock, after `gainXp`) | `missionCompletions` / `huntCompletions` |
| AI-fight soft-cap gate | `api/missions/report-ai-fight.ts` | `pveKills` (only up to the existing daily cap — the cap doubles as anti-farm), `eliteKills` when the reported tier qualifies |
| Raid report | `api/missions/report-raid.ts` (inside save lock) | `warContribution`, raid counts |
| Pet expedition | `api/missions/report-pet-event.ts` | event/exploration flavor counters |
| Hollow Gate settle | `api/hollow-gate/settle.ts` (extraction only, not death) | `hollowGateClears`, `dungeonClears` |
| Sector war resolve | `api/village/sector-war.ts` (reads authoritative finished PvpSession) | `sectorCaptures`/`sectorDefenses`, `warPvpKills` |
| War crate claim | `api/village/claim-war-crate.ts` | `warContribution` roll-up (war-end stats already stamped here) |
| Weekly boss distribution | `api/weekly-boss.ts` distribution phase | `bossContribution`, `weeklyBossTop10` |
| Wanderer endpoints | `api/sector/wanderer-{gift,quest,ambush}.ts` | `sectorDiscoveries`, `hiddenFinds` |
| Village treasury donate | `api/village/treasury/donate.ts` | `villageDonations` |
| Card clash finalize | `api/card-clash/match.ts` | event counters |
| Daily login | `api/player/daily-login.ts` | `villageTenureDays` (+1 per claimed day in current village) |

Deliberately **not** hooked: raw tile movement, chat, per-hit events — the
handoff's "no unbounded event rows" rule. Client-only surfaces (Endless Tower
waves, PvE Arena kills beyond the capped report) contribute only through their
existing capped report endpoints.

`legacy:events:<player>` gets appends only for: first clears, boss kills,
offer accepted/declined, trial passed/failed, stage-ups, suspicion flags,
era-unlock credit, hall entries. Capped at 200, newest-first (same shape as
`mod:audit`).

### 4.3 Tests

- Unit: `bumpLegacyStats` merge semantics (missing key init, concurrent-ish
  sequential merges, map caps).
- Unit: style/support accumulator math against fixture sessions.
- Existing `npm test` suites must stay green — hooks are additive, after-write.

---

## 5. Eligibility & scoring engine

> **STATUS: BUILT (Waves 1–5 core + partial 7).** The roster shipped at **100
> legacies** with a revised four-tier rarity model per design direction:
> **15 basic / 50 rare / 25 legendary / 10 mythic** (no "epic"/"common" tiers).
> Full roster: [legacy-roster.md](legacy-roster.md), canonical source
> `api/_legacy-defs.ts`. Implemented: tracking side-car + all settle hooks,
> scoring engine + overlay, Sage roll/offer/decline/accept with the NX
> permanent lock, fresh-delta trials (stages 1→3), title grants, announcements
> + Hall stores/endpoints/tabs, admin endpoint, save-sanitizer guard, client
> (Sage sector NPC + VN + offer modal + Profile Legacy tab + Hall
> Legends/News tabs). Deferred: Specialty Jutsu (per design direction, "jutsus
> later"), eras, nameplate rollout, custom-title reserved-terms filter,
> AdminLegacyPanel UI, weekly-boss hook, rumor toasts pre-50.

### 5.1 Definitions format

`data/legacies.ts` — one record per Legacy:

```ts
{
  id: "moonlit-ghost",
  name: "Legacy of the Moonlit Ghost",
  rarity: "epic",                    // common | rare | epic | legendary | mythic
  category: "genjutsu",              // ninjutsu|genjutsu|taijutsu|bukijutsu|pvp|pve|village|support|explorer|mythic
  villageAffinity: "Moonshadow",     // influence weight only — never a hard lock
  title: "Moonlit Ghost",
  badgeIcon: "legacy-moonlit-ghost", // GameIcon glyph or /legacy/*.webp
  auraClass: "legacy-aura-moonlit",  // CSS aura (aura-sphere-avatar pattern)
  specialtyJutsuId: "legacy-moonlit-execution",
  minLevel: 50,
  eligibility: { /* rule DSL, §5.2 */ },
  trial: { /* trial def, §9.2 */ },
  bound: { /* stage-3 follow-up def */ },
  proven: { /* stage-4 def */ },
  lore: "...",
}
```

Roster at launch: the handoff's full category list (36 named Legacies + 4
mythic/server-history + 4 common fallbacks). Authoring all 44 is content work,
not code work; ship Wave 3 with ~16 (2 per category incl. the 4 fallbacks) and
grow. `suggestedBloodlineSynergy` is **omitted entirely** — even as flavor it
invites the coupling the handoff forbids.

### 5.2 Rule DSL (pure, testable)

Small declarative rule objects evaluated by `api/_legacy-score.ts`:

```ts
eligibility: {
  all: [
    { stat: "genjutsuKills", atLeast: 300, weight: 3, diminishAfter: 600 },
    { stat: "pvpWins", atLeast: 100, weight: 2 },
    { anyOf: [
        { stat: "sameRankWins", atLeast: 40 },
        { stat: "bestKillStreak", atLeast: 8 },
    ]},
    { maxSuspicion: 2 },
  ],
  villageBonus: { village: "Moonshadow", multiplier: 1.15 },
  score: "weighted-sum",             // produces eligibilityScore for ranking offers
}
```

Anti-gaming rules built into the evaluator (handoff §anti-gaming, all pure
functions):
- **Repeat-target decay:** kills vs the same player count `1, 1, 0.5, 0.25, 0…`
  (from `repeatKillsByTarget`).
- **Level-gap zeroing:** kills ≥15 levels below the killer contribute 0
  (already computable — `report-pvp-win` loads both saves).
- **Diminishing returns:** `diminishAfter` applies sqrt scaling past the knee.
- **Multi-proof for legendary/mythic:** rarity ≥ legendary requires `all` with
  ≥3 distinct stat categories, enforced structurally by a definition-lint test
  (a legendary def with fewer categories fails `npm test`).
- **Suspicion gate:** `suspicionFlags` above threshold caps offered rarity at
  rare, and surfaces the player on the admin dashboard.

### 5.3 Evaluation flow

`POST /api/legacy/evaluate` (authed player or admin; rate-limited 2/min):
reads `legacy:stats`, runs all active defs, writes `legacy:eligibility:<player>`
`{ evaluatedAt, entries: [{legacyId, score, rarity, reasons[]}] }`, returns the
top summary. Also invoked internally by `sage/roll` when the cache is stale.
`reasons[]` powers both the Sage's "evaluation summary" dialogue and the admin
"why is this player eligible" view — human-readable strings, never raw
formulas to players (§6).

### 5.4 Existing-player fallback (retroactive bootstrap)

First time `legacy:stats:<player>` is created (lazily, on first hook or first
evaluate), the tracker snapshots the save's existing lifetime counters into
`bootstrapSnapshot` and seeds mapped stats (`totalPvpKills → pvpKills`,
`totalMissionsCompleted → missionCompletions`, `totalTilesExplored →
tilesExplored`, `warsWon/warMvpCount/lifetimeWarDamage → warContribution`,
ranked W/L, card clash, `totalEndlessTowerWins`, `hollowGateWardenKills`,
unlocked achievement ids). Because those save counters are client-writable,
bootstrap values are **capped per-stat at plausibility ceilings** (e.g.
`pvpKills ≤ 2× rankedWins+monthly history`, level-scaled caps) and can only
ever qualify a player for **common/rare/epic** — legendary/mythic require
post-launch, server-observed play. Guarantees per the handoff: every Level-50+
veteran is at minimum eligible for the 4 Common fallbacks
(Wandering Shinobi / Village Veteran / Proven Fighter / Road-Worn Shinobi);
nothing is auto-assigned; the Sage still offers; the same warning applies. The
client shows the `ExistingPlayerLegacyNotice` copy from the handoff once
(dedupe via `legacyRumorsSeen`).

---

## 6. Pre-50 rumors

Pure client feature (`lib/legacy-rumors.ts` + `LegacyRumorToast` component —
existing toast styling): on level milestones (10/20/30/40/45) and after
qualifying wins, the client fetches the read-only stats summary
(`GET /api/legacy/stats` returns *bucketed tiers*, not raw numbers — e.g.
`genjutsu: "strong"` — so exact formulas stay hidden even from the network
tab) and picks an unseen rumor line from a static pool keyed by dominant
category/village. Dedupe in `legacyRumorsSeen`. No rewards, no server writes,
no exploit surface. VN-elder delivery can be added later by appending a rumor
line to the existing Village Elder dialogue.

---

## 7. Wandering Sage

### 7.1 Identity & presentation

Name: **Wandering Sage** (handoff's first choice). Visually a Sector Wanderer
(`SectorWanderer.tsx` billboard, patrol brain, tell-ring in a unique violet)
plus a world-map notice. Dialogue runs through the existing VN engine: the
offer flow is a `CreatorEvent`-shaped script built **at runtime** by
`lib/legacy-sage-vn.ts` from the server's offer payload (greeting → evaluation
summary page → up to 3 offer pages → warning page → confirm). Portrait at
`shinobij.client/public/portraits/wandering-sage.webp` — `defaultVnPortrait("Wandering Sage")`
already resolves that path with zero code. Choices use the VN's existing
choice mechanics but **acceptance is not a VN trait grant** — the Accept
button calls the server (§8); the VN is presentation only.

### 7.2 Spawn logic (server-decided, pity-backed)

`POST /api/legacy/sage { action: "roll" }` — called by the client on: login
(daily briefing check), PvP win report success, mission claim success, hollow
gate settle, sector discovery. Server logic:

1. Gate: level ≥ 50, no `legacy:accepted` marker, no active accepted trial,
   no live offer already, `legacy:sage-roll:<p>:<date>` under daily roll cap
   (e.g. 6 — extra client calls are free no-ops).
2. Ensure fresh eligibility (recompute if cache stale); if zero eligible
   Legacies → record pity day, return `{spawn:false}`.
3. Odds: base 5% per qualifying roll, +5% per full day elapsed since
   eligibility without a spawn (`legacy:sage-pity`), **hard pity: guaranteed
   on day 7**. (Soft+hard pity per standard bad-luck-protection practice.)
   Admin can force-spawn (§16) and tune base/pity via `shared:legacy-defs`
   overlay config.
4. On spawn: write `legacy:sage-offer:<player>` with the offer set — **best
   fit + alternate + fallback, max 3** (top scores across distinct
   categories; a Common fallback always padded in if fewer than 2 qualify) —
   status `spawned`, TTL 7d. Location: the player's current sector if set,
   else their village-outskirts sector (31/38/47/11).

Client learns about it from the roll response or from
`GET /api/legacy/sage` (piggybacked onto the login/briefing fetch). Rendering:
Sage appears in that sector (deterministic tile via the wanderer relocation
placement helper), a toast fires ("A Wandering Sage has appeared near …"), and
a violet marker dot shows on the world map at the sector's coordinates.
Engaging opens the VN. Offers expiring untouched → status `expired`, pity
continues (no penalty).

### 7.3 Decline flow

`{ action: "decline" }`: offer → `declined`, event logged, Sage despawns,
pity resets to a re-offer cooldown (e.g. 3 days before rolls resume). No lock,
no penalty, offers may differ next time (re-evaluated). Exactly per handoff.

---

## 8. Acceptance & the permanent lock

### 8.1 Confirmation UX

VN warning page (verbatim handoff copy: *"This Legacy is permanent. You may
only accept one Legacy forever. If you accept this trial, your path is
chosen."*) → then a **second**, non-VN `PermanentChoiceWarningModal` (built on
`gameConfirm` styling, danger variant, buttons "Go Back" / "I Accept This Path
Forever"). Two distinct affirmative steps; misclick-proof — the single biggest
player-regret lesson from permanent-choice systems like PoE ascendancies.

### 8.2 Transaction (`{ action: "accept", legacyId }`)

Inside `withKvLock("legacy:accept:" + player, …, { failClosed: true })`:

1. Re-validate: offer exists, not expired, `legacyId` **is in the offered
   set** (handoff: "Chosen Legacy was actually offered"), level ≥ 50.
2. `kv.set("legacy:accepted:" + player, {legacyId, ts}, { nx: true })` —
   if NX fails → 409 "already sealed" (the uniqueness constraint).
3. Under the save lock: write `character.legacy = {legacyId, stage: 1,
   acceptedAt}`, `bumpSaveVersion`, `mergePreservingImages` — standard idiom.
4. Offer → `accepted`; create `legacy:trial:<player>` (Stage-1 trial active);
   append event; `recordAudit(domain:"legacy")`.
5. Announcement: **mythic-rarity acceptance only** (handoff importance rules)
   via `announce()` (§12).

Failure between 2 and 3 (crash) is self-healing: accept is idempotent for the
*same* `legacyId` (marker exists + matches → repair the save copy and
continue), permanently refused for any other id.

### 8.3 Admin emergency correction

`POST /api/admin/legacy { action: "emergency-change", player, newLegacyId, reason }`
(full-admin only, `reason` required): rewrites marker + save + resets trial
state, `recordAudit` with old/new/reason — the handoff's audit fields map onto
the existing `AuditEntry` shape (`before`/`after`/`reason`). No player-facing
surface, ever.

---

## 9. Legacy Trials & stages

### 9.1 Stage model (handoff Stages 0–5 → implementation)

| Stage | Name | Gate | Grants |
|---|---|---|---|
| 0 | Eligible | scoring engine | offer visibility only |
| 1 | Path Accepted | §8.2 transaction | permanent lock; trial begins |
| 2 | Awakened | trial completion (§9.2) | base title, badge, profile display, base aura |
| 3 | Bound | follow-up challenge | **Specialty Jutsu** (§10), stronger title, aura upgrade |
| 4 | Proven | high-end challenge | prestige title, badge frame (no numeric bonus at launch, §1.8) |
| 5 | Mythic | mythic challenge (mythic-track Legacies only) | Hall of Legends entry, server announcement, mythic aura/frame |

Failed trials: `legacy:trial` records the attempt (`attemptNumber++`), stays
retryable forever, never unlocks a different Legacy. Retry friction is a
cooldown (e.g. 1h), not a material cost (no new currencies, §1.3).

### 9.2 Trial definitions — three server-verifiable primitives

Each Legacy's `trial`/`bound`/`proven` blocks compose from:

1. **Gauntlet** — clone of the wanderer-ambush pattern
   (`api/sector/wanderer-ambush.ts`): `trial/start` seals a baseline of the
   relevant server counter into `legacy:trial-token:<p>:<id>` (single-use,
   `consumeSingleUseToken`), client fights themed encounters (spawned like
   ambush robbers, using existing enemy-AI content at a sealed difficulty),
   `trial/complete` verifies `counter - baseline ≥ N`, consumes the token,
   advances the stage under the save lock. Daily attempt cap via
   `legacy-trial-count:<p>:<date>`.
2. **Metric objective** — clone of wanderer-quest: sealed baseline over any
   `legacy:stats` counter ("win 5 PvP matches", "clear 2 Hollow Gate floors",
   "heal 50k in battles"), progress read live, claim verifies delta.
3. **Composite** — `all[]` of the above (legendary/mythic tiers).

Rewards on completion are computed server-side from the definition (title
grant, stage bump) — nothing from the client body. Stage-2/3 completions of
epic+ rarity fire announcements per the importance matrix (§12.2).

The handoff's "Stage-1 rewards on acceptance" question: plan grants **nothing
tangible at acceptance** except the lock + trial access (cleanest
anti-snowball posture; the moment already feels huge).

---

## 10. Specialty Jutsu

### 10.1 Definitions

Static additions to the jutsu content set with ids `legacy-*`, one per Legacy,
authored **strictly within the existing tag vocabulary**
(`api/pvp/_tags.ts` canonical names) and existing AP norms (mostly 40 AP; the
engine's 40-AP-utility rule and per-rank caps apply unmodified). Because tag
resolution is data-driven, **zero combat-engine changes** are required in
either engine — confirmed by the survey (new jutsu with canonical tags are
immediately handled by `move.ts` and `combat-math.ts`).

Handoff examples translate directly, e.g. Moonlit Execution = 40 AP damage +
condition expressed through existing `Increase Damage Given`-style tagging;
False Opening = `Lag`-tag-based AP tax… **except**: `Lag`/`Overclock` are
bloodline-only by the tag-taxonomy rule, and non-bloodline jutsu get "basic"
caps (Wound 25%, amp 30%). Specialty jutsu are deliberately stamped
**non-bloodline** (no `bloodlineRank`) so they inherit the *weakest* cap tier
— structurally "slightly unique, never stronger than a bloodline kit," exactly
the handoff's balance rule. A definition-lint test enforces the banned-combo
list from the handoff (no damage+stun, no damage+heal, ≤1 role per jutsu, must
have cooldown ≥3 and AP ∈ {20,40,60}).

### 10.2 Catalog & validation

Ship them through the generated server catalog
(`scripts/jutsu-catalog-gen.mjs` → `api/pvp/_jutsu-catalog.ts`) so the server
owns the definitions. Extend `resolveEquippedLoadout()`
(`api/pvp/session.ts:478–540`) with one rule: any `legacy-*` id survives only
if the `legacy:accepted:<player>` marker's Legacy grants it **and** save stage
≥ 3. Since a player can only ever own one, "only one equipped" is enforced
structurally — belt-and-braces: the resolver also drops any second `legacy-*`
id. It occupies one of the 15 slots automatically (it's just a jutsu in
`equippedJutsuIds`; the client equip UI needs no new slot machinery, only an
ownership filter). Client-side, `getAllJutsus()` includes the specialty only
when owned.

### 10.3 Mastery, PvE parity

Normal `jutsuMastery` entry, normal rank-cap clamping, no exceptions. PvE
(Arena.tsx) sees it like any owned jutsu; the PvE-vs-elite bonus for
Gatebreaker-style kits is expressed as PvE-side difficulty-band tuning, not a
new tag (deferred to the balance pass).

### 10.4–10.5 Counterplay & framework

Adopt the handoff's role/counterplay checklists verbatim as the authoring
rubric inside `data/legacies.ts` comments + the lint test.

### 10.6 ⚠️ PvP sign-off gate (hard checkpoint)

Adding *any* new equippable jutsu to PvP is a combat-balance change, which
this project (and this task's instructions) forbid without explicit approval.
Therefore: Wave 6 ships Specialty Jutsu **defined but PvE-only** (loadout
resolver refuses `legacy-*` in PvP sessions behind a server flag
`LEGACY_SPECIALTY_PVP=0` default). Enabling them in PvP is a separate,
explicit decision after a per-jutsu balance review with you — using the
existing `scripts/` PvP balance-simulation tooling for numbers. **Nothing else
in the entire Legacy system touches combat balance.**

---

## 11. Titles & nameplates

### 11.1 Model

Keep both existing slots and add one:
- `customTitle` — paid free-text (exists; stays 10 Fate Shards / 32 chars /
  filtered; the handoff's 100–150-shard pricing is a live-economy change —
  flagged as an open decision §24 rather than silently repriced).
- `equippedTitleId` — NEW: earned titles (achievement titles migrate to it via
  `titlesForAchievementIds`; Legacy titles join the same pool). Fixes the
  current quirk where equipping an achievement title overwrites `customTitle`.
- `rankTitle` — untouched.
Grants are union-merge, never removed (matches existing achievement
behavior + handoff).

### 11.2 Nameplate

New `components/PlayerNameplate.tsx` rendering
`Name [Lvl] [Custom] [Earned/Legacy] [Village]` with badge chips + optional
legacy badge icon + aura ring. Adopted incrementally: Profile → Hall of
Legends rows → village chat header → PvP intro → sector peers (each site is
currently bespoke; replacing them is mechanical). Priority order per handoff.

### 11.3 Effects policy

Titles grant **zero** stats at launch. The handoff's allowed ≤1% non-PvP
bonuses are deferred with Stage-4 bonuses (§1.8). The forbidden-effects list
becomes a lint test over `data/titles.ts` (any def with a `pvp*` effect field
fails the build).

### 11.4 Custom-title moderation (filter-first + post-hoc review)

- Extend `api/_text-moderation.ts` with `RESERVED_TITLE_TERMS` (admin, mod,
  owner, dev, staff, official, support, GM, Kage/Hokage-authority terms,
  "server first", "hall of legends", "gate opener", every earned/server-first
  title string — generated from `data/titles.ts` so it can't drift) +
  `isAllowedCustomTitle()` = `isCleanText` ∧ no reserved term ∧ no
  earned-title collision.
- Enforce **server-side at save sanitize** (the sanitizer already processes
  `customTitle`) and in the purchase UI pre-check. Rejected = never charged
  (validation precedes the debit).
- Purchase logging: the client purchase flow (existing, client-debited spend —
  consistent with the project's "spends client-OK" stance) additionally POSTs
  `api/titles/custom-log` (fire-and-forget) appending to `titles:custom-log`.
- Admin `api/admin/titles.ts`: list recent custom titles, **revoke** (clears
  `customTitle` + refunds 10 shards under save lock + audit), grant/revoke
  earned titles, ban a term (appends to a `shared:legacy-defs`-hosted
  moderation extension list). Statuses per handoff collapse to
  `auto_approved` / `rejected(revoked)` — no pending state needed.

---

## 12. Server announcements

### 12.1 Storage & delivery

`api/_announce.ts` `announce(type, importance, payload)` → prepends to
`game:announcements` (cap 100) under a light lock; per-type rate-limit via
`kv.incr` keys (e.g. max 1 announcement per type per player per day; global
cap ~20/day below "high").

Delivery (cheapest→richest):
1. **World-state poll piggyback** — the 15s poll response gains
   `announcements: {latestSeq, recent[≤10]}` (a few hundred bytes; respects
   the payload-size lesson). Client keeps `lastSeenSeq` in localStorage,
   toasts anything new of importance ≥ high.
2. **Login news panel** — `DailyBriefingModal` gains a "World News" section
   (top 5 recent high/mythic).
3. **World Events page** — new tab on Hall of Legends screen listing the full
   buffer with importance styling.
4. **Village chat system line** (optional, Wave 7) — `api/village/chat.ts`
   already supports server-derived authorship; a `system: true` message style
   for high+ events.
5. **Discord webhook** (optional, Wave 8) — `DISCORD_ANNOUNCE_WEBHOOK_URL`
   env; mythic only; fire-and-forget with try/catch.

### 12.2 Importance matrix (from handoff, enforced in `announce()`)

| Event | Importance |
|---|---|
| Common/Rare acceptance or completion | none (event log only) |
| Epic completion (Stage 2/3) | medium (village-scoped line) |
| Legendary completion | high (global + login news) |
| Mythic acceptance/completion | mythic (global + login news + Hall + webhook) |
| Era unlock, server-firsts, world-boss firsts | high/mythic |

---

## 13. Hall of Legends (permanent history)

Extend `screens/HallOfLegends.tsx` (already tabbed) with a **"Legends"** tab
group backed by `GET /api/hall-of-legends`: Era Unlockers, Server Firsts,
Mythic/Legendary Legacy Holders, plus the existing live boards satisfying the
handoff's PvP-Champions/Village-Heroes/Pet-Masters tabs as-is.

Entries (`hall:entries`, §3) are append-only with
`status: active|corrected|revoked|hidden` + `correctionNote` — never
hard-deleted (handoff correction rules; matches how live games handle
exploit-tainted "firsts": revoke and annotate, don't erase). Writers:
`announce()` auto-creates entries for mythic/era/server-first types under an
NX guard per `entryType:key` (server-first can never double-mint — the same
idempotency trick as `ranked:season:rewarded`). Admin correction endpoints
(`api/admin/hall.ts`: correct/revoke/hide, reason required) audit via
`recordAudit(domain:"legacy")` with before/after. Public read filters
`hidden`; `revoked` renders with a strikethrough badge (admin-configurable
display flag in the defs overlay).

Legacy entries carry the handoff's fields (player, village, legacy, rarity,
path, trial, date, title) — all available at write time from the settle
context.

---

## 14. Era system

### 14.1 Definitions & state

Five eras per handoff (Shinobi Awakening / Hollow Gate Opens / Village
Dominion / World Boss Awakening / Mythic Legacies) in `data/eras.ts` with
`milestones[]`; live state in `game:era-state`
(`status: locked|admin_available|milestone_active|unlocked` per era). Note
Eras 2–4 gate content that **already exists and is live** (Hollow Gate,
village war, weekly boss) — for a live game we cannot retroactively re-lock
shipped systems without hurting current players. Resolution: Era gating
applies to **new** Legacy-flavored content layers (era-flavored Legacies,
trials, mythic tracks, announcements) and to *future* content drops; existing
live systems stay available and their Eras launch as already-`unlocked`
history entries crediting the real firsts where recorded. Era 5 (Mythic
Legacies) is the first genuinely gated one. This keeps the handoff's
world-history fiction without a live-ops regression. (Flagged in §24.)

### 14.2 Milestones (anti-chore, from AQ-gate lessons)

Each active era tracks 3–5 mixed-category server-wide counters (missions,
explorations, PvP battles, village projects) + one credited final trigger
(first player/village to do X). Requirements admin-tunable (defs overlay) —
per the war-effort lessons: keep timelines short, scale to population, credit
one finisher but reward everyone, and never let a small server stall out
(admin can lower `milestone_required` live).

### 14.3 Counters & unlock

Contributions: settle hooks (§4.2) also `kv.incr("era:contrib:<era>:<metric>")`
when that metric belongs to the active era (atomic, contention-free).
Unlock check: nightly cron job (`_scheduler.ts fire()` + a new
`runEraMilestonePass()`) plus opportunistic check on the credited-trigger
endpoints. Unlock transaction: `era:unlocked:<id>` NX marker (double-fire
impossible) → update `game:era-state` under lock → `announce(era_unlock,
high)` → Hall entry → title grant to the credited player via TitleService.

---

## 15. Sector discovery limits & the Sage as a discovery

The wanderer layer already implements the handoff's core demands
(server-rolled rewards, daily caps 3/day, cooldowns, relocation anti-farm).
Wave 7 extends it: a rarity field on discovery-type configs (common/rare/
epic/mythic) with per-rarity daily/weekly caps using the same
`X:<player>:<date>` counters (weekly = ISO-week key, like weekly-boss), and
two new discovery outcomes — **Legacy rumor** (client flavor, free) and
**Wandering Sage sighting** (calls the same server `sage/roll`; all §7.2
gates apply, so it is not farmable — a sighting without eligibility is just
flavor text). Epic+ discovery payouts route through server-rolled endpoints
identical to `wanderer-gift`.

---

## 16. Admin MVP

New AdminPanel section **"Legacy"** (new component file
`screens/AdminLegacyPanel.tsx`, mounted from AdminPanel like
ModerationPanel — AdminPanel.tsx itself gains only the mount lines) backed by
`api/admin/legacy.ts` + `api/admin/titles.ts` + `api/admin/hall.ts`
(full-admin) with actions:

- view player stats/eligibility/reasons; recalc eligibility; view/expire
  offers; view accepted legacy + trial state
- **force-spawn Sage** (testing); tune spawn odds/pity (defs overlay)
- emergency legacy change (reason required, audited)
- edit defs overlay (`shared:legacy-defs`): eligibility thresholds, trial
  params, era milestone numbers, announcement toggles
- titles: grant/revoke earned; custom-title review list; revoke+refund; term
  bans
- hall: correct/revoke/hide with reason
- eras: set status, edit milestone values, trigger unlock (testing)
- suspicion queue: players with `suspicionFlags > 0`

Every mutating action calls `recordAudit(domain:"legacy")` (one-line change in
`api/_audit.ts` to add the domain). The existing audit-log admin viewer picks
it up.

---

## 17. Assets

> **STATUS: GENERATED.** The full launch asset set (Wandering Sage + 8 Legacy
> Emissary wanderers, 20 badges, 20 specialty-jutsu icons, 5 era banners, 2 VN
> scenes, Hall banner, map marker) has been produced with the standard
> pipeline and staged in the repo — see
> [legacy-assets.md](legacy-assets.md) for the per-file manifest, emissary
> roster/lore hooks, and wiring notes. The table below records the placement
> conventions the generated files follow.

Pipeline (`shinobij.client/scripts/gen-asset.mjs` → gpt-image-1 → sharp
WebP/PNG), the handoff's prompt templates, and these placements:

| Asset | Path / mechanism |
|---|---|
| Wandering Sage VN portrait | `shinobij.client/public/portraits/wandering-sage.webp` (auto-resolved by speaker name) |
| Sage sector sprite faces | wanderer archetype portrait set (same format as existing archetypes) |
| Legacy badges (per legacy) | Prefer `GameIcon.tsx` SVG glyphs (crisp at chip size, zero image churn); webp via pipeline only for hero art on the LegacyProfilePanel |
| Auras | CSS classes modeled on `aura-sphere-avatar` (LeftProfileCard/MobileNav/CombatSideHud already have the hook points) — procedural, no image cost |
| Era banners / Hall plaques | webp via pipeline, lazy-loaded on those screens only |

Rules honored: no keys in code; provider via env; placeholders (CSS/SVG) if
providers unconfigured; nothing enters the polled payloads (cost lesson);
client-dist image-churn rule (commit only changed assets). All generated art
is original anime-inspired work per the handoff's IP rules.

---

## 18. API surface (complete)

All handlers are Vercel-style, OPTIONS-early-return, registered in `server.ts`
via `route()` (both bare + `/api` paths) — `server-routes.test.ts` enforces
wiring both directions automatically. Consolidated action-dispatch handlers
(house style, cf. `wanderer-ambush.ts`) keep the file count sane:

| Route | Actions / verbs | Auth | Notes |
|---|---|---|---|
| `/legacy/stats` | GET (bucketed tiers for self) | player | rumor/profile feed |
| `/legacy/evaluate` | POST | player/admin | rate-limit 2/min |
| `/legacy/sage` | GET active; POST roll/decline/accept | player | accept = §8.2 transaction |
| `/legacy/trial` | GET state; POST start/complete/claim | player | mint-token gauntlets, metric claims |
| `/legacy/definitions` | GET (public defs, no eligibility formulas) | player | codex UI |
| `/titles/custom-log` | POST | player | fire-and-forget purchase log |
| `/eras` | GET current+progress | player | |
| `/announcements` | GET recent | player | also piggybacked on world-state |
| `/hall-of-legends` | GET (tab param) | player | merges live boards + `hall:entries` |
| `/admin/legacy` | POST multi-action | full admin | §16 |
| `/admin/titles` | POST multi-action | full admin | §11.4 |
| `/admin/hall` | POST correct/revoke/hide | full admin | §13 |
| `/admin/eras` | POST set-status/edit-milestone/unlock | full admin | §14 |

Per-endpoint standards (from `_auth`/`_ratelimit`/`_lock` house patterns):
token-first auth via `authedPlayerOrAdmin`, `enforceRateLimit` on everything,
`withKvLock(..., { failClosed: true })` on every currency/lock/stage mutation,
daily caps as dated `kv.incr` keys, NX markers for idempotency. **No new CORS
headers** → no `_utils.ts`/`server.ts` CORS sync needed.

---

## 19. Client work map

All new UI in modules (App.tsx is at its ratchet ceiling — wiring lines only,
and if the wiring exceeds budget, drain first per the refactor rule):

```
src/data/legacies.ts, titles.ts, eras.ts          content definitions
src/lib/legacy.ts                                 client types + API calls
src/lib/legacy-rumors.ts, legacy-sage-vn.ts       rumor pool, VN script builder
src/components/PlayerNameplate.tsx                §11.2
src/components/LegacyRumorToast.tsx
src/components/PermanentChoiceWarningModal.tsx    gameConfirm-styled, danger
src/components/SectorSage.tsx                     thin wrapper over SectorWanderer
src/screens/LegacyPanel.tsx                       profile Legacy tab: stage, trial,
                                                  titles, specialty status, history
src/screens/AdminLegacyPanel.tsx                  §16
HallOfLegends.tsx                                 + Legends/News tabs
Profile.tsx                                       + Legacy tab mount, nameplate
WorldMap.tsx                                      + sage marker + engage hook
DailyBriefingModal.tsx                            + World News section
```

Existing screens are touched additively; mobile responsiveness follows each
screen's current patterns (nameplate chips wrap; VN is already
mobile-hardened).

---

## 20. Rollout waves, flags, deployment

Flags: server `ENABLE_LEGACY` (default **off**; hooks and endpoints no-op
404/skip when off — byte-identical live behavior) + client `legacy.v1`
localStorage (default off until launch, flipping to default-on at Wave 5 like
`wanderers.v1` did). `LEGACY_SPECIALTY_PVP` stays 0 pending §10.6 sign-off.

| Wave | Ships | Player-visible? |
|---|---|---|
| 1. Tracking foundation | `_legacy-track`, side-car store, all §4.2 hooks, bootstrap, tests | No |
| 2. Scoring + defs | `_legacy-score`, rule DSL, 16-legacy roster, evaluate endpoint, lint tests | No |
| 3. Rumors + stats read | `/legacy/stats`, rumor toasts | Soft (flavor) |
| 4. Sage + permanent lock | sage roll/offer/decline/accept, VN flow, warning modal, accept transaction, admin force-spawn + emergency-change | **Yes — core moment** |
| 5. Trials + stages + titles | trial endpoints, Stage 2–3 progression, Legacy titles, `equippedTitleId`, nameplate on Profile/Hall, reserved-terms moderation, admin title tools | Yes |
| 6. Specialty Jutsu (PvE-only) | defs, catalog regen, loadout validation, PvE enable; **PvP behind sign-off** | Yes |
| 7. Announcements + Hall + discovery tiers | announce plumbing, poll piggyback, briefing news, Legends tabs, hall admin, discovery rarity caps, Sage-sighting discovery | Yes |
| 8. Eras + polish | era state/milestones/cron/unlock, era admin, webhook, Stage 4–5 content, remaining legacy roster, hero art | Yes |

Every wave: `npm test` (root) + `npm run lint` (client) + `npm run build` +
commit regenerated root `dist/` (cPanel serves it verbatim; Railway
self-builds) + client dist per the image-churn rule (commit js/css/html only).
New-dep caution: if any new package is added (none is planned), cPanel needs a
manual NPM install before restart.

---

## 21. Test plan

- **Pure-unit (colocated `*.test.ts`, node:test/tsx):** scoring DSL +
  diminishing returns + level-gap zeroing + multi-proof lint; bootstrap caps;
  accept-transaction idempotency & NX contention (fake-KV harness like
  `_lock.ts` tests); trial baseline/claim math; reserved-title filter
  (leetspeak set); announcement rate-limit; era unlock NX idempotency; hall
  status transitions; specialty-jutsu definition lint (banned combos, AP set,
  non-bloodline stamp).
- **Parity/infra (free):** `server-routes.test.ts` (auto), jutsu-catalog
  drift test (auto after regen), `App.size.test.ts` ratchet (respected by
  §19), combat-formula parity (untouched — proves no balance drift).
- **Manual QA script:** force-spawn Sage → decline → re-offer → accept →
  fail trial → retry → complete → title/badge/aura → specialty equip
  (PvE) → announcement/hall verify → admin correction round-trip. On mobile
  viewport too (real innerWidth check per house rule).

---

## 22. Performance & cost notes

- No polling additions: everything rides existing 15s world-state poll
  (+ a few hundred bytes) and existing login fetches.
- All new keys are small JSON; the two arrays (`hall:entries`,
  `game:announcements`, `legacy:events`) are hard-capped; per-day counters
  self-expire (25h TTL) — no `kv_delete_expired` pressure.
- Scoring runs on demand (rate-limited) and in the Sage roll — never in the
  hot heartbeat path.
- Era `kv.incr` counters are contention-free by design (§14.3).

---

## 23. Security checklist (handoff → mechanism)

| Handoff validation | Mechanism |
|---|---|
| Level 50+, no existing Legacy, offer active/unexpired, chosen was offered | `sage accept` re-validation inside failClosed lock (§8.2) |
| One Legacy forever | `legacy:accepted` NX marker + save sanitizer ignores client `legacy` field |
| Decline never locks; failed trial never switches | decline only mutates offer status; trial state has no legacy-change path |
| Specialty: owned-only, one, normal slot, ≤15 | `resolveEquippedLoadout` extension (§10.2); 15-cap already enforced both sides |
| Titles unowned can't equip; shards never negative | equip validates against earned set server-side at sanitize; purchase validates before debit |
| Custom title filtered/reserved | `isAllowedCustomTitle` at save sanitize (server) (§11.4) |
| Era can't double-unlock; server-firsts can't dupe | NX markers (§13, §14.3) |
| Fallback can't auto-lock | bootstrap only writes stats/eligibility, never `legacy` |
| Hall corrections admin-only + audited | full-admin gate + `recordAudit` |
| Discovery cooldowns server-side | dated `kv.incr` caps in the reward endpoints |
| Transactions | `withKvLock({failClosed:true})` on accept/stage/title-refund/era/hall writes; single-use tokens for gauntlets |

---

## 24. Open decisions (need your call — none block Waves 1–3)

1. **Specialty Jutsu in PvP** (§10.6): ship PvE-only first as planned, then a
   per-jutsu balance review with sim numbers before flipping
   `LEGACY_SPECIALTY_PVP`. *(Recommended: yes, review after Wave 6.)*
2. **Custom-title repricing** (10 shards today vs 100–150 in the handoff):
   repricing a live cosmetic is an economy change. *(Recommended: keep 10 for
   plain text; charge 40–50 for the new style/icon options so the upgrade is
   the premium, and nobody's past purchase is devalued.)*
3. **Era retro-gating** (§14.1): confirm Eras 1–4 launch as unlocked history
   with real credited firsts where known, gating only new layers + Era 5.
4. **Stage-4 ≤1% non-PvP bonuses & Memory Shards flavor drops:** include in
   Wave 8 or keep pure-prestige? *(Recommended: pure prestige at launch.)*
5. **Title moderation model:** confirm filter-first + revoke/refund (§1.4) over
   a pre-approval queue.
6. **Launch roster:** which 16 Legacies go first (suggest: 4 fallback commons,
   1 rare + 1 epic per combat style, 2 village, 1 support, 1 explorer, 1 PvP,
   1 PvE).

---

## 25. Acceptance-criteria coverage

All 39 handoff criteria are covered by the sections above — as built, planned,
or explicitly deferred. **Built and verified:** separation from bloodlines
(#1–4), server-side 1–50 tracking with aggregate counters + event log (#5–6),
eligibility + anti-gaming (#8–9), existing-player fallback (#10–11), the Sage
with max-3 offers, free decline, permanent accept, one-forever, retryable
trials, no respec, audited admin correction (#12–20), titles/badges from
trials (#21), announcements with importance levels + spam control (#31–32),
permanent correctable Hall (#33–34), discovery cooldowns (#35), server-side
validation throughout (#38), pre-50 rumor toasts #7 (level-milestone hints on
the world map + the strongest-paths reading in the LegacyPanel),
reserved-terms custom-title moderation with post-hoc admin review/revoke +
refund #26–29 (earned-title impersonation blocked; legacy titles verify
against the server-owned grant), anti-chore Era milestones with the credited
first-mythic-awakening trigger, live progress in the Hall's World Eras tab,
and admin tuning #30, and the full AdminLegacyPanel #36 (player inspector,
force-spawn, emergency change, suspects queue incl. win-trading-ring flags,
title review, era dashboard, overlay editor, hall corrections). **Deferred
(the final wave):** Specialty Jutsu #22–25 — by design direction, "jutsus
last." *Intentional deviations:* no new Legacy materials at launch (§1.3),
filter+revoke/refund instead of a pre-approval queue (§1.4).

---

## 26. Research sources

- Permanent-choice design & regret: [PoE2 ascendancy permanence](https://gamerblurb.com/articles/path-of-exile-2-can-you-change-your-ascendancy), [PoE respec debate](https://www.pathofexile.com/forum/view-thread/1586056), [PoE2 respec philosophy shift](https://www.ssegold.com/poe-2-ascendancy-respec) — informs the double-confirmation + decline-freely + prestige-not-power stance.
- Pity systems: [Pity timers explained](https://gameanatomy.blog/2025/05/03/pity-timers-in-games-explained/), [Bad-luck protection modeling](https://medium.com/@niklasvmoers/designing-fair-and-fun-randomness-in-video-games-via-bad-luck-protection-48f2c2262cfa), [Soft/hard pity](https://mwm.ai/glossary/pity-system) — Sage 5%+5%/day, day-7 guarantee.
- UGC/title moderation: [CleanSpeak UGC best practices](https://cleanspeak.com/blog-archive/2022/06/07/best-practices-ugc-moderation-video-games), [Gaming content moderation guide](https://www.cometchat.com/blog/gaming-content-moderation) — hybrid filter + human review.
- Server-first/exploit handling: [Realm-first exploit report handling](https://us.forums.blizzard.com/en/wow/t/mop-classic-realm-first-pandaren-ambassador-exploit/2144814) — revoke-and-annotate, never silently erase.
- Community milestone events: [Blizzard engineering retro on recreating the AQ war effort](https://news.blizzard.com/en-us/world-of-warcraft/23504702/engineer-s-workshop-recreating-the-ahn-qiraj-war-effort), [AQ gates history](https://massivelyop.com/2020/06/27/the-game-archaeologist-when-world-of-warcraft-opened-ahnqirajs-gates/) — era milestone design (short timelines, population scaling, credit one/reward all).
