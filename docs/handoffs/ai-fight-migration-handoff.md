# Handoff — Generic AI-Fight Migration + PvE difficulty authority

Rewritten 2026-08-02 after pushing steps 2, 3a and 3b to `main`. Read this first.

## Where main is

`main` is **2be6e4776**, pushed green. Gates run immediately before the push, all
exit 0: `npm test` **4566/4566**, `tsc -p tsconfig.cpanel.json`, `npm run build`
(sizecheck PASS, 6.80 MB), `npm run certify:release` **28/28**.

Everything below is **server-side and inert in production**: the new fight path
is behind `ENABLE_SERVER_AI_COMBAT` (default OFF), and the engine's PvE guard
only activates on a session that sealed `pveGuard` — which only the flagged path
does. No live player behaviour changed.

A parallel session landed `dd85f6667` ("Render solo tower fights on the Arena
shell") just before this. It routes story/weekly/anbu onto `MissionArenaFight` —
i.e. it is groundwork for step 3d. No file overlap; the rebase was clean.

## Done

| Step | What | Where |
|---|---|---|
| 1 | `aiOpponentEnemyTemplate` — defeatable enemy from an AI profile | `api/_authoritative-pve.ts` |
| 2 | `ai-fight-start` seals a real encounter, returns `runId` | `api/missions/ai-fight-start.ts`, `_ai-fight-encounter.ts` |
| 2 | Generated mirror of the 71 built-in AI profiles | `api/_ai-profile-catalog.ts` |
| 2 | AI loadout resolution (catalog ∪ admin, sanitized) | `api/_ai-opponent-loadout.ts` |
| 3a | Server port of the AI level curves + `relevelBuiltinAi` | `api/_ai-level-curves.ts` |
| 3b | Server port of the PvE difficulty layer | `api/_pve-difficulty.ts` |
| 3b | `damageCap` threaded through the damage resolver; guard wired | `api/combat-core/resolveJutsu.ts`, `api/pvp/move.ts`, `api/towers/_engine.ts` |

Parity/behaviour tests: `scripts/ai-profile-catalog.test.mjs`,
`scripts/ai-level-curve-parity.test.ts` (~38.6k comparisons),
`scripts/pve-difficulty-parity.test.ts` (>5k-case guard grid),
`api/towers/_pve-guard.test.ts`, `api/missions/_ai-fight-encounter.test.ts`.
The three parity suites were **mutation-verified** (a deliberate wrong constant
fails them) rather than trusted for being green.

## ⚠ The finding that matters most: server AI casts at 30% damage

`api/pvp/move.ts` `applyJutsu` reads jutsu mastery off the **caster's**
`character.jutsuMastery`. **No server enemy template has ever carried one**, so
every server-sealed AI casts at `masteryDamageFrac(0) = 0.3` — 30% of the jutsu
damage the client's PvE AI deals (the client passes `pveAiMasteryForLevel`
explicitly). Corroboration that this is an oversight, not a balance choice:
`api/towers/_merc-fighters.ts:66` gives squad-side AI **allies** `level: 50`.

Empirically confirmed at ~3.3× in `api/towers/_pve-guard.test.ts`.

**Fixed for AI fights only.** Still open for **combat missions, story bosses,
Hollow Gate, the towers, clan boss, Anbu vault and the weekly boss** — their
templates were hand-tuned with mastery 0 in place, so correcting them is a real
balance change. Very likely why some server PvE reads as limp.

## Owner rulings (2026-08-02)

1. **Guard first, then mastery everywhere.** Do not enable enemy mastery in the
   other modes until the difficulty guard is extended to them — those modes have
   no mercy caps today, so tripling enemy jutsu damage first would wreck
   onboarding (the E-rank drill especially).
2. **Extend the guard + band layer to every server PvE mode, default ON with a
   kill switch.**
3. Arena practice spar keeps its player-chosen level slider; the server seals
   whatever level was chosen. Reward is flat and daily-capped, so the exposure
   is bounded throughput — no worse than today's fake-a-win.
4. Scope is: finish the AI-fight migration.

## Next, in order

### A. Wire the four AI-behaviour helpers (smallest, do first)

`pveAiCompetence`, `pveIsBurstJutsuAp`, `pveEasyBandHoldsBurst`,
`pveEasyBandAllowsLethal` are ported and parity-tested but have **zero
production consumers** — the only genuinely unwired thing in this work. They
belong in the engine's `bestAffordableJutsu` / `pickAiAction`
(`api/towers/_engine.ts`), gated on `session.pveGuard` like the rest. The client
applies them at `Arena.tsx:780` (burst hold), `:4019` (lethal intent) and
`:4848/:4852` (clear-buffs / cleanse thresholds).

### B. Extend the guard + band to the other PvE modes

Seal `pveGuard` and apply the band HP/stat multipliers in
`missions/combat-start.ts`, `story/boss-start.ts`, `towers/start.ts`,
`clan-boss/assault-start.ts`, `village/anbu-infiltration.ts`, `weekly-boss.ts`.
Default ON, kill switch `DISABLE_PVE_DIFFICULTY_GUARD=1`. The engine half
already works — a sealed `pveGuard` is the only gate.

⚠ **Weekly boss has its OWN guard cycle** (`weeklyBossGuardedHit`, deliberately
not ported). Do not double-clamp it.

### C. Then enemy jutsu mastery everywhere

Default ON, kill switch `DISABLE_PVE_AI_MASTERY=1`. Must follow B.

### D. Finish the migration

- **3c** — derive `scaling` per entry point from SERVER state: combat mission →
  `missionAiLevelAndBonus(mission, save.character.level)`; hunt → the hunt def;
  apex → `APEX_ROSTER`; rift → the shrine picker; endless → the wave.
- **3d** — route the client's ~8 AI-fight launches to the server-combat screen.
  `dd85f6667` already did this shape for story/weekly/anbu — follow it.
- **4** — derive the reward from the settled session (retire the client-claimed
  win in `report-ai-fight`); keep `redeemedAiFightRewards` for idempotency. The
  token already carries `runId`, so no second binding key is needed.
- **5** — retire the local Arena AI-fight path and the flag.

## Traps found the hard way — do not re-learn these

- **`EnemyTemplate['jutsu']` must declare `target` and `tags`.** The engine reads
  both; the encounter builder spreads jutsu through at runtime, so a narrow type
  silently disarms an AI's entire kit at the type boundary.
- **The PvE clamp must go PRE-shield.** The client caps `enemyDamage` before
  `blocked`, and before Wound/Siphon/Recoil/Lifesteal derive from it. Neither
  `res.opponent.hp` nor `fx.amount` exposes that number — both are post-shield.
  Hence the optional `damageCap` in `combat-core/resolveJutsu.ts`. `undefined`
  takes an explicit identity branch so PvP stays byte-identical.
- **`applyAoeSplash` bypasses `runJutsu`** and needs its own cap, or a
  multi-target enemy blast walks past the per-turn ceiling and the mercy floor.
- **`relevelBuiltinAi` DROPS `hpFloorExempt`** (it omits `makeBuiltinAi`'s 10th
  arg). Reproduced deliberately — see `lib/apex-contract.ts:18-24`.
- **`distributeStatBudget` is `STAT_KEYS`-order dependent** (the rounding-stall
  branch). The server list is asserted identical to the client's.
- **Order: re-level applies the HP floor, THEN the band multiplies.** Same as the
  client (`relevelBuiltinAi` → `Arena.tsx:692`).
- **The easy band does NOT make a player immortal.** The mercy floor prevents
  *sudden* death — a player who started the turn above half HP survives it — and
  lapses once they are worn below half. Do not assert immortality.
- **`api/_ai-profile-catalog.ts` is GENERATED.** After any change to `builtinAis`:
  `node --import tsx scripts/ai-profile-catalog-gen.mjs`. `rules` is not mirrored
  (random UUIDs each import would make the drift test flap).

## Combat-mode load audit (done, 2026-08-02)

Player-side loading is **consistent across every sealed mode** — authoritative
save + `augmentSaveWithForgedDefs` + `loadAdminCombatContent` →
`hydrateCharacterFromSave`, guarded by `api/_fighter-authority.test.ts`. Covers
PvP/MPvP (ranked, spar, bounty), solo PvE (missions, story, weekly, AI fight)
and MPvE (co-op towers, clan boss, Anbu). `towers/join.ts` is a pure read with
no re-seal — correct; a prior tampering hole there is closed.

**Hollow Gate PvE is the one mode not migrated at all** (still client-built).

## Working rules that held

- Gate on the **exit code**, never a quiet log. Pipes mask failures.
- `gh run watch --exit-status` returns 0 on FAILED runs — cross-check
  `gh pr checks` before relying on CI.
- Full local gates before a main push: `npm test`, `npm run build` (chains
  sizecheck — `npm test` misses it), `npm run certify:release`.
- **Re-run every gate after a rebase.**
- Verify, don't infer: a passing count is not proof a specific new test ran —
  grep the log by suite name.
- Mutation-check a new parity test (break the source, confirm it fails, revert).
  Two of my behavioural tests initially passed **vacuously** because the test
  driver skipped the enemy's turn entirely.
- Small, reversible commits; each leaves main releasable.

## Loose ends unrelated to this task

- The live-data scanner (`npm run scan:data`) and its cutovers are moot if the
  pre-launch WIPE happens.
- Capacity: ~500 concurrent comfortably per container, ~700-800 ceiling.
  `npm run soak -- --url=<staging>` before launch.
  `docs/runbooks/launch-capacity.md`.
