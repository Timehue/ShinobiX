# Combat-Authority Audit — Fighter/Loadout Construction — Phase 0 (2026-07-31)

Baseline: `origin/main` @ `de50b3385`. Claims tagged **VERIFIED** or **INFERRED**.

## 1. How many fighter-builder pipelines exist?

For **player** fighters: effectively **2.5 pipelines** (one server, one client,
plus a server NPC-clamp variant). For **enemy/NPC** combatants: ~5 server
template builders (server-authored stats, not player loadouts).

### Pipeline A — the server hydrator (single shared builder) — VERIFIED

`hydrateCharacterFromSave` — `api/pvp/session.ts:779` — with sub-resolvers:

- `resolveEquippedLoadout` (jutsu) — `api/pvp/session.ts:598`
- `resolveEquippedPvpItems` (gear) — `api/pvp/session.ts:714`
- `deriveCombatMultipliers`, `deriveEquipmentStatBonuses`, `buildItemLookup` —
  `api/pvp/_multipliers.ts` (lookup `:61`; precedence
  `ITEM_CATALOG ?? adminItems ?? player creatorItems` at `:99`)
- `sealItemCharges` (consumable budget) — `api/pvp/session.ts:1012`
- Admin content as one composed argument: `loadAdminCombatContent()` —
  `api/_admin-content.ts:34` (reads `save:admin1/2` via the `_admin-*-catalog.ts` modules).

`sealTowerFighter` (`api/towers/_seal.ts:54`) is a **thin wrapper** over
Pipeline A — it calls `hydrateCharacterFromSave` verbatim, adding only a
specialty whitelist clamp (`:58-59`). Every server-authoritative PvE mode
funnels through it, mostly via `buildAuthoritativeSoloEncounter`
(`api/_authoritative-pve.ts:229`, seal at `:251`).

### Pipeline B — NPC clamp path — VERIFIED

`hydrateNpcCharacter` — `api/pvp/session.ts:961`. Client-supplied payload,
multipliers/stats clamped, **vitals left intact** (legitimate boss HP); used
when a PvP-shaped fighter has no save (admin tests, AI opponents).

### Pipeline C — the client Arena builder (no server fighter) — VERIFIED

`characterCombatStats` built at `shinobij.client/src/screens/Arena.tsx:301`
(`perRankStatCap({...})`) + `getPvpItemLoadout`
(`shinobij.client/src/lib/equipment-stats.ts:60`). The server never constructs a
fighter for these modes; it only gates rewards with sealed tokens/receipts.

### Enemy-side template builders — VERIFIED

`missionEnemyTemplate` / `hollowGateEnemyTemplate` / `weeklyBossEnemyTemplate`
(`api/_authoritative-pve.ts:56/84/143`), `storyBossEnemyTemplate`
(`api/story/_authoritative-story-combat.ts`), tower catalog `getEnemyTemplate` →
`templateActor` (`api/towers/_encounter.ts:237`), `buildMercCharacter`
(`api/towers/_merc-fighters.ts:60` — synthetic capped-stat fighter, deliberately
no bloodline/item bonuses). The Anbu defender is a player save sealed through
Pipeline A (`getOrSealAnbuSnapshot`, `api/_anbu-infiltration-store.ts:196`, seal `:208`).

The combat-core "slice 2" adapters (`api/combat-adapters/pvpAdapter.ts:10`,
`clanBossAdapter.ts:59/83`) are shape converters for the shared resolver
(`api/combat-core/resolveJutsu.ts`), not additional builders.

## 2. Mode-by-mode trace

| Mode | Entry endpoint | Pipeline | Notes |
|---|---|---|---|
| Casual PvP | `POST /api/pvp/session` (`session.ts:1180+`) | **A** (both fighters, save read `:1264-1266`, admin content `:1268`) | NPC side falls to **B** (`:1280-1295`) |
| Ranked PvP | same endpoint, `ranked:true` (`:1199`); matchmade via `api/pvp/ranked-queue.ts` + `_ranked-match-token.ts` | **A** — identical | Same loadout as casual |
| Sector/Village War fights | PvP session with `useCurrentVitals:true`; resolved from `pvp:<battleId>` (`api/village/sector-war.ts:245,270`) | **A** | Sealed `guardDefensePct` for on-duty defenders (`session.ts:1339-1354`); current vitals |
| Village Guard challenge | `api/village-guard/challenge.ts` → PvP session (`:161`) | **A** | AI fallback = **B** |
| Battle Towers | `POST /api/towers/start` (`:76-98`) | **A via sealTowerFighter**; host gets `hostLoadout` fallback, allies `{}`; `sealTowerItemCharges` per member | admin content passed |
| Endless Spire | same `towers/start.ts` with ascension seal + `_spire-catalog.ts` floors (`:125`) | **A via sealTowerFighter** | ascension modifies enemies/floors only |
| Clan Boss | `POST /api/clan-boss/assault-start` (`:84-95`) | **A via sealTowerFighter** per squad member | boss HP capped to pool chunk |
| Mission combat (built-in) | `POST /api/missions/combat-start` (`:62-71`) → `buildAuthoritativeSoloEncounter` | **A via sealTowerFighter** | **legacy E/D missions remain client-trusted** (`queue-combat-claim.ts:44,90`, `clientTrustedCombatMissionRewardAllowed`) — those fights are **C** |
| Story bosses | `POST /api/story/boss-start` (`:63-74`) | **A via sealTowerFighter** | `storyBossEnemyTemplate`; settle via `api/story/settle.ts` binding |
| Weekly Boss | `POST /api/weekly-boss` `kind:'startFight'` (`:577-589`) | **A via sealTowerFighter** | score-attack HP 99,999,999; **legacy client `damage` report returns 503 for non-admins** (`:543-549`) |
| Hollow Gate | `POST /api/hollow-gate/combat-start` | **C (client Arena)** — combatMode forced `'pve'`/`'pet'` (`:35`); tactical tower path RETIRED, old boards discarded (`:81-86`). Server mints a run-bound binding; rewards sealed server-side (`_combat-session.ts:190`, `hollowGateCombatReward`) | biggest divergence from the unified pipeline |
| Endless Tower (client mode, distinct from Spire) | `POST /api/endless/run` | **C** — wave wins gated on `aiFightToken` proof; server bookkeeping only (`_run.ts`) | |
| Generic AI/mercenary fights, raids | `missions/ai-fight-start.ts` → `report-ai-fight.ts`; `raid-start` → `report-raid` | **C** — sealed base-reward token, no server fighter | |
| War mercenaries | `deployOneMerc` (`api/_merc-auto.ts:77-79`) headless | Target = **A via sealTowerFighter** (clientChar `{}`); merc = `buildMercCharacter`; deterministic `resolveMercBattle` via towers engine | defender cannot suppress the outcome |
| ANBU Vault raid | `api/village/anbu-infiltration.ts:175,182` | Raider = **A** (live save); Anbu boss = **A** over the appointee's save, from a **daily sealed snapshot** (`_anbu-infiltration-store.ts:208`) | |
| Tournament combat | **None exists** (grep VERIFIED — only a passing comment `session.ts:146`) | — | |

## 3. Comparison matrix (vs the PvP truth source)

| Mode group | Items | Jutsu | Stats | Modifiers | Resources | Consumables | Content defs |
|---|---|---|---|---|---|---|---|
| Casual/Ranked/War PvP | SAME (`resolveEquippedPvpItems` + attunement overlay `:727-747`) | SAME (`resolveEquippedLoadout` + legacy 16th slot `:892-915`) | SAME (`clampStatsObject` ≤2500 + gear fold `:839-846`) | SAME — bloodlineMult `:798-810`, legacy slot, war-only `guardDefensePct` | SAME (v2 caps `:853-856`, `sealV2JutsuCosts` `:920`) | SAME (`sealItemCharges`, potion cap 2, `itemsUsed` deducted at claim-rewards) | JUTSU_CATALOG + ITEM_CATALOG + admin slots + own bloodlines/creatorJutsus/creatorItems |
| Towers / Spire / Clan Boss / Missions / Story / Weekly / Anbu / Merc-target | SAME (delegates) | SAME | SAME + specialty clamp (`_seal.ts:58`) | SAME | SAME | SAME (`sealTowerItemCharges`; tower settle deducts `itemsUsed`) | SAME — all callers pass `loadAdminCombatContent()` (verified per call site) |
| Hollow Gate / Endless Tower / AI fights / legacy E/D missions | **DIFFERENT** — client-resolved from client bundle + local creatorItems mirror | **DIFFERENT** — client-resolved | **DIFFERENT** — client `perRankStatCap` (Arena.tsx:301); server never clamps the fighter | client-side equivalents | client-side | **DIFFERENT** — no server charge seal; deduction via autosave, not receipts | client bundle catalogs (can drift from server mirrors) |
| PvP-vs-NPC | clamped client payload | sanitized client payload | clamped | clamped | vitals NOT clamped (`:974`) | potion sealed at cap, others unlimited (`:1010-1011`) | client-supplied |

## 4. Paths that silently drop unresolved content

1. **`api/pvp/session.ts:673`** — `if (!jutsu) continue;` — an equipped jutsu id
   that resolves nowhere is dropped with **no log at all**. The one remaining
   fully-silent drop; propagates to every sealTowerFighter mode. VERIFIED.
2. **`api/pvp/session.ts:679-691`** — bloodline-gate-denied jutsu dropped, but
   logged (`[pvp-loadout] bloodline-gated jutsu dropped`). Dropped-but-logged.
3. **`api/pvp/session.ts:742` + warn `:754-760`** — unresolvable equipped item
   ids (the named-weapon risk) are dropped ("a fight must not fail to start over
   one piece of gear") but now emit `[pvp-items] unresolved equipped item id(s)`.
   Per `:712-713` a forged `named-weapon-*` definition lives **only** in the
   player's own `creatorItems` — nothing else can supply it if that entry is
   lost. Dropped-but-logged; the underlying loss mode is unfixed. VERIFIED.
4. **Latent silent drops when `admin` is omitted** — `api/towers/_seal.ts:45-52`
   and `api/_authoritative-pve.ts:239-243` both document that calling without
   the admin catalog "drops any admin-authored equipped item silently."
   Every production caller currently passes it (`towers/start.ts:76`,
   `clan-boss/assault-start.ts:84`, `village/anbu-infiltration.ts:175`,
   `_anbu-infiltration-store.ts:208`, `_merc-auto.ts:77`,
   `missions/combat-start.ts:71`, `story/boss-start.ts:72`,
   `weekly-boss.ts:586`) — but the parameter defaults to `null`, so any future
   caller regresses silently. VERIFIED.
5. **Client-Arena modes** (Hollow Gate PvE, Endless Tower, AI fights) —
   unresolvable content fails client-side lookup with no server visibility. INFERRED.

## 5. Would the same character get identical loadouts across modes?

**Across all server-sealed modes: yes, byte-comparable** — casual PvP, ranked,
war PvP, Towers, Spire, Clan Boss, mission combat-start, story bosses, Weekly
Boss, Anbu, and merc-target hydration all flow through
`hydrateCharacterFromSave` with the admin catalog. That is the concrete
achievement of the unification work (through slice 2). Remaining divergences:

- **Hollow Gate / Endless Tower / generic AI fights / legacy E/D missions build
  the fighter client-side** (Pipeline C) — different catalogs (client bundle vs
  server mirrors), no server clamps, no sealed consumable budget. The largest
  structural divergence left.
- **hostLoadout asymmetry:** the initiating host may supply client-computed
  fallback fields; allies/defenders/merc-targets always get `{}`
  (`towers/start.ts:97`, `clan-boss:94`, `_merc-auto:77`). Matters only for
  fields the save lacks — normally none.
- **Anbu defender staleness:** sealed from a daily snapshot, can lag the
  appointee's real loadout by up to a day.
- **Specialty clamp** exists only on the tower wrapper (`_seal.ts:58`), not raw
  PvP hydration (PvP defaults invalid specialties at use). Cosmetic difference.
- **War-only fields:** `guardDefensePct` and current-vitals entry exist only in
  `useCurrentVitals` PvP fights.
- **NPC-shaped opponents** (Pipeline B) keep unclamped vitals and
  mostly-unlimited consumables — intentional.
