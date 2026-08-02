# Migrating the Four Client-Built Combat Modes

The last structural gap from the Phase 0 combat-authority audit. Eight combat
modes already build their fighter on the server through one shared pipeline;
four still build it on the client. This is the plan to move them, in order,
without breaking live combat.

## What's already done (do not rebuild it)

The machinery exists and is proven by every server-sealed mode:

| Piece | Where | What it gives you |
|---|---|---|
| `hydrateCharacterFromSave` | `api/pvp/session.ts:779` | the one authoritative fighter builder |
| `sealTowerFighter` | `api/towers/_seal.ts` | thin wrapper + specialty clamp; **admin catalog is a required arg** |
| `buildAuthoritativeSoloEncounter` | `api/_authoritative-pve.ts:229` | full solo encounter: sealed fighter + enemy + run record |
| enemy templates | `api/_authoritative-pve.ts:56/84/143`, `api/story/_authoritative-story-combat.ts` | mission / hollow-gate / weekly / story enemies |
| session store | `api/towers/_tower-store.ts` | run persistence, per-run receipts, consumable settle |
| turn engine | `api/towers/_engine.ts` | `startRound`, `runAiUntilHuman` |

A cross-mode parity test (`api/_fighter-authority.test.ts`) already asserts
`sealTowerFighter` output deep-equals the PvP hydration. **Any migrated mode
inherits that guarantee for free** — which is the whole point of moving them.

So this is wiring, not invention.

## Order — smallest first, flagship last

Do them one at a time, each landing on `main` before the next starts. The
pattern gets proven on cheap modes before it touches Hollow Gate.

### 1. Generic AI fights (`missions/ai-fight-start` → `report-ai-fight`)
Smallest surface: no run state, no floors, single fight. Today the server
mints a sealed base-reward token and never builds a fighter; the client
resolves the whole battle in `Arena.tsx`.

- Server: `ai-fight-start` builds the encounter with
  `buildAuthoritativeSoloEncounter` (enemy from the AI profile, same shape
  `weeklyBossEnemyTemplate` uses) and persists it.
- Client: `Arena.tsx` drives turns through the tower engine endpoints instead
  of its local resolver.
- Reward: `report-ai-fight` derives the payout from the settled session rather
  than the sealed token. Keep the existing `redeemedAiFightRewards` receipt —
  it already makes the payout idempotent.

### 2. Endless Tower (`endless/run`)
Wave loop over the same engine. Wins are currently gated on an `aiFightToken`
proof; once (1) lands, the token becomes a real session and the wave counter
comes from the run record instead of the client.

### 3. Legacy E/D combat missions
Once mission combat is fully server-built, delete
`clientTrustedCombatMissionRewardAllowed` and the
`COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON` branch in
`missions/queue-combat-claim.ts`. C/B/A/S ranks already require a bound Tower
run — this makes E/D match, and removes the last client-trusted reward path.

### 4. Hollow Gate PvE — last, and on its own
Biggest: run state, augments, consumables, locked doors, the extraction haul.
`hollow-gate/combat-start` forces `combatMode: 'pve'` and hands the fight to
the client Arena. Two client-trusted values disappear when this lands:
- the **haul** (`hollow-gate/settle` pays `min(client haul, depth ceiling)`),
- the **PvE win claim** (`combat-settle` trusts `outcome: 'win'`).

Both become derived from the sealed session.

## Rules for each migration

1. **Kill-switch, default ON.** Ship each mode server-built with
   `DISABLE_SERVER_<MODE>_COMBAT=1` as the opt-out, matching the project's
   convention (ship on, kill-switch off) — so a bad migration is one env var
   away, not a redeploy.
2. **Parity before cutover.** Add the mode to `api/_fighter-authority.test.ts`'s
   caller list so it is proven to seal the same fighter as PvP.
3. **The admin catalog is required.** `sealTowerFighter`'s `admin` parameter has
   no default; pass `loadAdminCombatContent()` or authored gear silently
   vanishes.
4. **Reward from the session, receipt in the payout write.** Follow the
   settlement contract (`docs/architecture/reward-settlement-contract.md`):
   the receipt rides the same save write as the payout.
5. **Certify.** `npm run certify:release` after each mode; add a journey check
   for the migrated mode.

## Why this is worth doing

These four are the only paths left where the client decides what it fought
with and, in Hollow Gate's case, whether it won. Everything else — PvP, ranked,
Towers, Spire, Clan Boss, missions, story, weekly boss, Anbu, mercenaries —
is already server-sealed and byte-identical. Closing these four retires the
last client-trusted combat surface and unblocks deleting the legacy
client-trust release flags entirely.

## Prerequisite

Nothing blocks starting. The `STRICT_RAW_SAVE_LEDGER` flip is *not* a
prerequisite — but note it interacts with (4): strict mode freezes
`creatorItems`, and Hollow Gate's client build reads the client's local mirror
of it. Migrating Hollow Gate first would remove that coupling.
