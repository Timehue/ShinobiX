# Leveling Without XP — Design & Migration Map

**Status:** Implementation reference. The live progression policy is summarized below;
the migration audit farther down retains historical snapshots and is not the source
for current numeric values. Runtime code owns those values.

**One-sentence version:** `character.level` stays as a field, but instead of being
driven by `gainXp`, it becomes a pure function of the server-conserved stat ledger
(`allocatedStatPoints(stats) + unspentStats`), clamped by the existing exam holds —
so every one of the ~30 systems that *reads* level keeps working untouched, and the
work is confined to the ~30 sites that *write* XP.

## Current progression policy (live code)

- **First-session target:** completing the Academy path guarantees at least Level 10.
  One-time catch-up grants are floors, not fixed payouts: the spar brings earned
  points to Level 2 (193), the Academy Trial to Level 6 (983), and graduation to
  Level 10 (1,800). A player who has already earned more gets no extra points at
  that checkpoint. The ordinary +20 spar and +5 Trial rewards remain included.
- **PvE and player PvP wins:** eligible server-settled PvE wins grant 3 base stat
  points; eligible player PvP wins grant 6. They share the 18-point daily combat
  budget. Growth follows the invested-stat/pool split and rank caps in
  `api/_stat-growth.ts`; the reservation is replay-safe.
- **Progressive curve:** thresholds rise smoothly from 193 points at Level 2 to
  29,000 at Level 100. Level 30 is 6,100; Level 80 is 19,500, so Levels 80–100
  require another 9,500 points. The Academy floors guarantee the Level 10
  first-session target while PvE and PvP wins provide repeatable growth.
- **Evidence and revisit:** thresholds and awards are code-level configuration
  (runtime-semantics evidence); the one-session timing still needs a guided
  new-player playthrough. Revisit the catch-up floors if first-session completion
  exceeds one session or graduates too far above Level 10.

---

## 1. Why this works now (and wouldn't have two months ago)

The two-axis redesign (live on main) already moved every stat point onto its own
server-authoritative rails:

- **Training** is direct-to-stat via sealed tokens (`api/training/start.ts` →
  `api/training/complete.ts` → `api/training/_grant.ts:11-21`), 3/10/38/72 pts per
  15m/1h/4h/8h session, 96 starts/day. Rates descend with tier length so chaining
  short timers out-earns long ones (96× 15m = 288/day … 3× 8h = 216/day); the
  reference 24h regimen (12× 1h + 4h + 8h = 230/day) caps a 12-stat build in ~89
  days. Early sessions are additionally multiplied by `rookieStatMultiplier`
  (×6 at L1 → 1.0 at L35, keyed off the earned-points ledger, not stored level).
- **Combat growth** is earned from eligible PvE and player PvP wins; see the live
  policy above for the 3/6 per-win awards and shared 18/day cap.
- **The ledger is already conserved and server-enforced.** The save sanitizer's
  `preserveStatPointEntitlement` (`api/save/_stat-entitlement.ts:52-55`) computes
  `allocated(stats) + unspentStats` and **rejects any client save that changes the
  sum**. Spending pool points and respec are exact transfers
  (`api/profile/_settlement.ts:52-79`).
- Level's only remaining jobs are: rank bands → caps (`statCapForLevel`,
  `jutsuLevelCapForLevel`), vitals (`maxHp/Chakra/StaminaForLevel` + full heal on
  level-up), and ~30 content/matchmaking gates — **all of which read `level` as an
  integer; none read `xp`** (verified sweep, §6).

So XP today is a *second* progression currency whose only output is that integer.
Removing it collapses progression to one currency — stat points — that is already
conserved, already capped, already audited.

**Security bonus:** the XP system is the last place the client self-grants
progression (`App.tsx:6507` chest `25+rand(30)`, `App.tsx:7123` tablet
`60+rand(50)`, `WorldMap.tsx:2371/2477/2674/2698`, client tower cash-out
`App.tsx:5227`), tolerated via the `+100 XP/save` sanitizer allowance
(`api/save/[name].ts:752-754`). Deleting XP deletes that entire trust surface:
level becomes forge-proof (recomputed server-side from the conserved ledger), and
`MAX_LEVEL_GAIN`, `MAX_XP_PER_MINUTE`, and the XP gains-window plumbing all retire.

---

## 2. Target architecture

```mermaid
flowchart LR
    subgraph EARN [Earning — server-authoritative, unchanged]
        T[Idle training\nsealed token, 20-23/hr] --> S
        P[Eligible PvE + player PvP wins\n3 or 6 per win, shared 18/day] --> S
        M[Content grants — story/tower\none-times + budgeted\nmission/boss/festival claims] --> S
    end
    S[("Stat ledger\nearned = allocated + unspentStats\n(conserved by save sanitizer)")]
    S --> L["level = levelForEarned(earned)\nclamped by examLevelCap (20 / 39)"]
    L --> R[rankFromLevel 15/30/50/80]
    R --> C[statCapForLevel\njutsuLevelCapForLevel]
    C -.->|ceiling| S
    L --> V[Vitals maxHp/Chakra/Stamina\n+ full heal on level-up]
    L --> G[~30 content gates, missions,\nmatchmaking, AI scaling, story]
```

The loop `caps → earning → level → caps` is a **ratchet, not a circularity**:
earning raises level, level raises caps, caps make room for more earning. The one
place it can deadlock is if a level threshold exceeds what the previous band's caps
allow you to earn — which is exactly what a naive inversion does (§3), and what the
calibrated progressive curve prevents.

**Core identity (new canonical helper, both mirrors):**

```
earnedStatPoints(char) = allocatedStatPoints(normalizeStats(char.stats)) + max(0, floor(char.unspentStats))
level(char)            = min( levelForEarned(earnedStatPoints(char)), examLevelCap(char) )
```

- `allocatedStatPoints` already exists on both sides (`lib/stats.ts:68-71`,
  `api/_xp-engine.ts:74-77`).
- A new-character baseline is `allocated 0 + unspentStats 20` → earned 20 → level 1
  (`api/save/_first-save-baseline.ts:35-44`).
- `unspentStats` counts toward earned, so **respec never de-levels** and pool
  points banked while cap-blocked still progress you (matching
  `computeCombatStatGrowth`'s roll-into-pool behavior).

---

## 3. The progressive threshold curve

The curve is cumulative and smooth: each level has a different total earned-stat
threshold, and the next-level cost generally rises as players advance. Runtime
code mirrors this polynomial in `api/_xp-engine.ts` and
`shinobij.client/src/lib/stats.ts`, rounded to whole stat points:

```text
n = level - 1
E(level) = round(191.67876990268087·n
              + 1.1074354304268461·n²
              − 0.02226330146888855·n³
              + 0.00021623956441357866·n⁴)
```

The curve preserves the Level 10 first-session target, eases the Level 30
threshold, and makes later levels more expensive. These are total earned points,
including allocated stats above base plus the unspent pool:

| Level | Total earned points | Increase from previous listed level |
|---:|---:|---:|
| 1 | 0 | — |
| 2 | 193 | 193 |
| 6 | 983 | 790 |
| 10 | 1,800 | 817 |
| 15 | 2,848 | 1,048 |
| 20 (Genin exam hold) | 3,917 | 1,069 |
| 30 | 6,100 | 2,183 |
| 39 (Chunin exam hold) | 8,112 | 2,012 |
| 50 | 10,679 | 2,567 |
| 80 | 19,500 | 8,821 |
| 90 | 23,704 | 4,204 |
| 100 | 29,000 | 5,296 |

The complete Level 1–10 climb needs 1,800 points; Level 1–30 needs 6,100. The
Level 80–100 climb needs 9,500 points, and each individual threshold is strictly
higher than the one before it. The Academy's spar, Trial, and graduation floors
bring players to Levels 2, 6, and 10 respectively, awarding only the shortfall
at each checkpoint. The exact time to finish the Academy still needs a guided
playthrough; its level outcome is guaranteed by the server-side floors.

`levelForEarned(S)` remains the largest level where `earnedForLevel(L) ≤ S`.
Exam holds still cap display and derived level at 20 and 39; earned points remain
banked and can advance the character across a hold after the exam is passed.

---
## 4. Faucet disposition table (every XP grant site)

Policy (v3, owner direction 2026-07-27): **growth folds into the daily loop.**
The design target, in the owner's words: *doing all the dailies gets you close
to the daily growth cap but not all of it — the rest is PvP's, and story stacks
on top.* Three grant classes:

- **One-time spine grants (outside any budget):** story milestones (~600
  total), Battle Tower floor first-clears, apex first-completion, tutorial
  spar, weekly-boss settlement (weekly receipt). Non-farmable by construction
  (progress-flag / receipt-gated). Story deliberately does **not** compete with
  dailies for budget — a story day is a bonus day, which is the strongest form
  of "leaving room for story."
- **The daily checklist (the dailies slice, target = 45 pts as built):** stat
  grants ride ONLY on claims that are already once-per-day — the 10 hunt + 5
  fetch board dailies at **+3 each** (`FIELD_MISSION_STAT_POINTS`,
  `api/missions/_mission-catalog.ts`). A full clear sums to
  `DAILY_PVE_GROWTH_TARGET = 45` **by construction** — there is no clamp to
  slam into, no "my later dailies paid zero" feel; the existing once-per-day
  claim receipts are the idempotency guard. Profession dailies stay on their
  own profession-XP track (a different namespace, untouched); festival dice add
  small seasonal pool points (+1–5) on top of the target. The checklist grows
  with level as boards unlock (dailies are levelReq-gated); the invariant pins
  the fully-unlocked sum, and early bands lean on training anyway. Values are
  pinned by a test: full-clear sum ∈ target ±10% — **base values; growth
  boosts (§4.1) multiply after.**
- **The combat slice (18 stat points/day shared by PvE and player PvP):** each
  eligible PvE win awards 3 points and each eligible player PvP win awards 6.
  Both use `computeCombatStatGrowth`, the auto+pool split, and the replay-safe
  `combat-stat-count` reservation. These are direct awards: pet traits, encounter
  bonuses, and the era dial do not multiply them. The cap keeps repeatable wins
  a supplement to daily missions and training.

**Unlimited-repeat mission claims pay ryo only** — repeatable combat-mission
slots, tower assists and similar turn-ins. Eligible server-settled PvE wins use
the shared combat budget; spars and plain practice stay at zero. Daily base
maximum = 45 + 18
= 63 direct budgeted stat points (on par with the old 60/day allowance), plus
eligible one-time grants. Growth boosts apply only to eligible non-combat grants
such as training and checklist rewards (§4.1). Surface it
as a split meter — **"Daily Growth 33/45 · Combat 12/18"** — so progress reads
as bars you fill. Non-combat claims and eligible PvE/PvP combat wins grant
**pool-only** (`unspentStats +=`), so players choose where every point goes.

### 4.1 Growth boosts — eligible XP bonuses become stat-gain bonuses

Growth boosts apply to eligible non-combat stat grants, so developed worlds can
progress faster through training and checklist rewards. PvE/PvP wins award the
exact points reserved from the shared 18-point daily combat budget; boosts do
not change either the award or the amount charged to that budget. Boosts never
raise the 2500 ceiling, only how quickly eligible non-combat grants reach it.

| XP-boost today | Becomes |
|---|---|
| Town Hall training XP bonus (`getTrainingXpBonus()` — village upgrades + clan/elder sources), currently displayed but **not actually granted** (`api/training/_session.ts:77` seals `bonusPct = 0` while `Training.tsx:238` shows the boosted figure) | **Training stat-rate bonus, actually sealed:** `training/start` computes `bonusPct` server-side from server-readable village/clan/elder state and seals it into the token. Fixes the pre-existing display/grant mismatch. |
| Elder focus `training` +10% XP (`api/_xp-engine.ts:159-166`) | +10% training stat rate, folded into the sealed `bonusPct`. |
| Mission XP boosts — `boostAmount(xp, townHallBonus + huntRankBonus)` (`api/missions/claim-mission.ts:391`) | Same `boostAmount`, applied to the **checklist grants** (base +4 → boosted). |
| Swift trait +25% PvP XP (`computePvpWinGains`) | No stat-growth multiplier. Win-based PvP points remain the direct 6-point award before the shared daily cap. |
| Death's Gate sector 99 ×2 XP | No stat-growth multiplier. It continues to affect the separate ryo reward. |
| `CHARACTER_XP_GAIN_MULTIPLIER` (client+server constant, parity-pinned = 1) | **Retired.** Successor: **`STAT_GAIN_MULTIPLIER` — a server-env era dial** (default 1) applied to eligible non-combat grants such as training and checklist rewards. PvE/PvP win awards are excluded. Server-only: no client constant or cross-build pin, and it can be changed without a rebuild. UI shows a **"Growth Surge ×N"** badge when the server reports it active. |
| Aura "Jutsu XP +N%", pet/profession/clan XP boosts | Untouched — different XP namespaces. |

**The two-generation effect, quantified (full cap, standard profile):**

| Cohort | Aggregate boost | Days to full cap |
|---|---|---|
| Gen 1 — launch, undeveloped villages | ~×1.0 | **~93** |
| Gen 2 — mature village (Town Hall + doctrine + elder, ~+25–30%) | ~×1.27 | **~73** |
| Gen 2 + era dial ×1.5 | ~×1.9 | **~49** |

Guardrail: pin a **maximum aggregate boost** (proposal: ×2.5 combined, era dial
included) in shared config so stacking can never run away, and write the
applied multiplier into the training/claim audit trail.

### Server faucets (all route through `api/_xp-engine.ts` `gainXp`)

| Site | Today | Disposition |
|---|---|---|
| `api/training/complete.ts:107` (sealed tier XP 20/70/220/375) | training XP trickle | **Delete.** Training already grants the stat; the trickle's only job was leveling. Remove `xp` from tier config + `_training-parity.test.ts:18` pin. |
| `api/pvp/claim-rewards.ts:313` + `api/player/sleeper-kill.ts:246-250` (`creditPvpWinBase`, 100/125×2) | PvP win XP | **Delete XP; keep ryo.** PvP stat growth uses the direct win award and shared 18-point daily cap (§4); growth boosts do not multiply it. `PvpWinBaseSummary` drops `xp/level` fields → client mirror `applyServerBaseReward` (`lib/progression.ts:83-101`) follows. |
| `api/missions/claim-mission.ts:391` (catalog 15–700; apex 3000) | mission XP | **Once-per-day claims join the daily checklist:** field/hunt dailies (already once-each/day) **+4 each**, profession dailies **+2–3 each**, tuned so a full clear ≈ 50 base — then multiplied by the same `boostAmount` town-hall/hunt-rank bonuses that used to boost mission XP (§4.1). **Repeatable combat-mission slots → ryo only** (they are the unlimited-repeat channel). Apex first-completion: one-time **+25**, outside. |
| `api/missions/report-ai-fight.ts:108` (sealed ≤150, 50/day full, 100/day hard) | AI-fight XP | **Delete XP; keep ryo + stamina** (retires the flat-100 double-dip oddity + the `_ai-fight-reward.ts` XP-decay machinery). Resolved by the v3 rule: raw AI wins are unlimited-repeat → **ryo only**; the once-per-day hunt/field *claim* is where that playtime's growth lands. Plain practice stays zero. |
| `api/story/_settle.ts:44` (tutorial spar 60) | teaching reward | **Convert to +20 pool points** (one-time, non-farmable, already gated) — teaches the USER STATS panel, replacing the "XP bar moved" teach. |
| `api/story/_settle.ts:74` (milestone table 120→10,000) | story chapter XP | **One-time pool grants, outside the daily budget** (table ÷ ~40 → 3→250 pts/chapter, **~600 total** across the story) + keep ryo. Server-tracked by `storyProgress`, non-farmable. |
| `api/world/_explore.ts:17` (20+, 100/day) + `api/world/_chest.ts:35` (50+, 23/day) | exploration XP | **Delete XP; keep/raise ryo slightly.** Exploration already pays discovery + loot. |
| `api/towers/_tower-store.ts:163,338` (floor first-clears 150–2500; assists) | Battle Tower XP | **Floor first-clears → one-time pool grants outside the budget** (XP table ÷ ~40 → ~4–60 pts/floor; already NX-receipt-gated). Assists (repeatable, daily-capped) → small budgeted grant or ryo-only (owner call). |
| `api/endless/_run.ts:47` (banked XP, softcap 450+60L) | Endless Tower banked XP | **Convert banked XP → banked ryo** at ~0.75:1 at wave-reward time; delete the entire daily-XP-softcap subsystem (`dailyTowerXp`, `towerDailyXpSoftCap`, `creditTowerXpWithSoftCap`). Risk/banking tension is preserved via ryo. Deliberately **not** a stat faucet — it's an infinite-repeat mode, and keeping it ryo-only avoids rebuilding the softcap subsystem for stats. |
| `api/hollow-gate/combat-settle.ts:172` (140/220/600×depth) + `_locked-door.ts:19` | Hollow Gate XP | **Delete XP; keep existing loot/ryo lines.** |
| `api/weekly-boss.ts:387` | weekly boss XP share | **Once-per-week pool grant, outside the daily budget** (~+10 pts per settlement, NX-receipt-gated — a weekly event shouldn't eat a day's checklist) + keep the ryo share. |
| `api/festival/sunscar.ts:75` (dice 10–75) | festival XP outcomes | **Joins the daily checklist** (+1/+1/+2/+2/+5 mirroring the table, counted inside the ~50 target) — dice are already daily-capped and cost ryo. |

### Client grant sites

| Site | Disposition |
|---|---|
| `lib/claim-mission.ts:89`, Training.tsx, Arena.tsx | Already server-mirrors — they follow the server response; nothing to do beyond type updates. Keep the rolling-deploy fallback graceful (fallback becomes "apply server character or no-op," never a local level bump). |
| `App.tsx:6507, 7123` (Hollow Gate client-RNG XP), `App.tsx:6770/6715` (locked door), `WorldMap.tsx:2371, 2477, 2674, 2698` (chest/explore/creator events), `App.tsx:5425, 5813` (creator/story events), `App.tsx:5227` (tower cash-out) | **Delete the `gainXp` calls** (convert to their ryo/loot lines). These are the client-trust holes; their XP would be discarded by the frozen sanitizer anyway (§5). Creator-event `xpReward` fields: keep accepting in content schema, ignore or map to ryo — don't break existing creator content. |
| `components/LeftProfileCard.tsx:212-219` ("⬆️ Level Up!" button, `gainXp(char, 0)`) | **Delete** — level-ups are automatic on earn. Replace with the earned-progress bar (§6). |

**Deliberately untouched XP namespaces:** jutsu mastery XP (`lib/jutsu-scaling.ts` —
zero shared code with character XP, verified), pet XP, profession XP, clan XP,
Vanguard profession XP.

---

## 5. Server authority & sanitizer changes (`api/save/[name].ts`)

| Today | After |
|---|---|
| `level` clamped to +5/save (`:748-751`), `xp` to +100/save (`:752-754`), `MAX_XP_PER_MINUTE` window (`:273, :2406-2410`) | **Server recomputes `level` from the ledger on every save write** (`level = min(levelForEarned(earned), examLevelCap)`); client-supplied `level`/`xp` ignored. Delete the XP clamp plumbing. Level forgery becomes impossible rather than rate-limited. |
| `xp` lives on the save | **Freeze:** field stays on stored saves (rollback insurance until the wipe), always forced from stored, never displayed. Drop at wipe. |
| Stat ledger conserved by `preserveStatPointEntitlement` | Unchanged — it is now the *level* anti-cheat too. Keep `totalStatsTrained` server-owned (`:881`) as the cross-check ledger. |
| Exam floors on `examsPassed` (`:1263-1313`) | Unchanged. |
| Vitals set by `gainXp` on level-up (full heal) | New `applyDerivedLevel(char)` helper (both mirrors) does: recompute level → if raised, set `rankTitle` + `maxHp/Chakra/Stamina` + full refill (verbatim from today's loop, `api/_xp-engine.ts:215-241`). Called from: training/complete, claim-rewards, sleeper-kill, story settle, migration reconcile, save-write sanitize. |

### Ledger leaks to plug (prerequisite fixes, from the conservation audit)

1. **Training overflow at rank cap is destroyed** (`api/training/_grant.ts:14-15`).
   Under stat-leveling that's destroyed *level progress*. **Fix: roll overflow into
   `unspentStats`** (mirror `computeCombatStatGrowth`'s pattern,
   `api/_stat-growth.ts:87-98`). This also fixes respec under-refund (#2) by
   construction.
2. Respec refunds post-truncation values (`api/profile/_settlement.ts:57-62`) —
   resolved by #1.
3. **Admin bypass** (`?signal=1` skips the sanitizer, `:2150, 2159-2163`; admin
   `maxedStats()` accounts, `App.tsx:779-789, 1386-1387`): admin accounts derive to
   L100 — acceptable, but **exclude admin-flagged saves from the earned/level
   leaderboards**, and admin "set level" (`AdminPanel.tsx:2063-2079`) becomes
   "grant/remove pool points" (level is no longer directly settable). |
4. `normalizeCharacter` defaults missing `unspentStats` to 20 (`App.tsx:1072`) —
   matches the creation baseline; harmless, keep.
5. The `<12 stat keys` bootstrap branch (`api/save/[name].ts:873-875`) is
   unconserved — tighten to intersect with baseline, or accept until the wipe
   (flagged).
6. Entitlement floors stats at 10 vs `capStat` floor 0 (`_stat-entitlement.ts:12`
   vs `lib/stats.ts:35-37`) — admin-only reachable; align floors while in there.

---

## 6. The nine XP readers, and the UI plan

Level *readers* (~30 systems, 100+ sites: caps, exams, missions, matchmaking,
Academy PvP protection, AI scaling, story gates, professions L13, Legacy L50,
Anbu/Hollow-Gate L100, patch notes L5, war tax, achievements…) — **all keep
working untouched** because `level` remains a field. The full sweep found **zero
gates that read `xp`**. The nine that do read XP:

| Reader | Disposition |
|---|---|
| `gainXp` engines + `progressAfterXp` + `statPointsEarnedFromXp` (`App.tsx:761-829`, `lib/stats.ts:174-183`, `api/_xp-engine.ts:209-244`) | Replaced by `earnedStatPoints`/`levelForEarned`/`applyDerivedLevel`. Net-negative App.tsx lines → **ratchet `App.size.test.ts` `MAX_LINES` down** after. |
| `statPointBudgetForProgress` (`lib/stats.ts:165-171` + server twin) | Delete (dead after ProgressionPanel refit). |
| **"Total XP Earned" leaderboard** (`api/player/_public-index.ts:107,148,211,272,479`; `PublicLeaderboard.tsx`; `HallOfLegends.tsx:203,320-324`) | **Swap metric to `earnedStatPoints`** — "Most Powerful / Total Stat Points Earned." Same board plumbing, new value + label. Exclude admin saves. |
| **Combat HUD `power={character.xp}`** (`Arena.tsx:5730`, `PvpBattleScreen.tsx:1414,2062` → `CombatSideHud.tsx:102-207`) | **Feed `earnedStatPoints` instead** — a *better* power number than XP ever was. |
| Save-route XP clamps (`api/save/[name].ts:748-759, 273`) | Deleted/frozen per §5. |
| `normalizeCharacter` xp clamp (`App.tsx:1033-1034`) | Level recomputed via ledger; xp line deleted. |
| Endless-tower XP softcap system (`lib/endless-tower.ts:36-80`) | Deleted with the banked-XP→ryo conversion (§4). |

### UI surfaces (~70 sites, 2 chokepoints)

- **Progress bars → earned-progress bars.** `LeftProfileCard.tsx:197-221`,
  `MobileNav.tsx:75-77,154-155`, `ProgressionPanel.tsx:30-70`, `Profile.tsx:389-405`
  switch from `xp / xpNeeded(level)` to
  `(earned − earnedForLevel(level)) / (earnedForLevel(level+1) − earnedForLevel(level))`
  with copy "N pts to Level L+1 — earn by training, daily missions, PvE wins, and PvP wins." ProgressionPanel's
  false "Each level grants ~301 stat points" line (`:41,92`) becomes the honest
  inverse: "Level L unlocks at N total points earned." The panel's
  `earned = spent + unspent` arithmetic is *already* the new model.
- **Toast chokepoints:** `rewardSummary` (`lib/currency.ts:79-80`) and
  `displayCharacterXpGain` (`lib/progression.ts:32`) — drop the XP part in these
  two places and ~40 call sites follow. Then sweep the ~15 hand-rolled `+N XP`
  strings (Arena victory `:3146-3154`, PvP summary `:1753-1757`, Hollow Gate
  modals, Logbook, WeeklyBossArena, SunscarFestival, StoryBoss, tower lobby).
- **Copy pass:** "XP hold" → "level hold" (`lib/logbook-objectives.ts`,
  `lib/daily-briefing-core.ts:111-132`, Logbook exam banner `:285`), Training
  screen blurbs (`Training.tsx:5,65,86,172-177,236-256` — also delete the dead
  "Testing XP" badges), guides (`data/guides.ts` ×7), `data/patch-notes.ts` (+ a
  new player-facing patch note), `data/admin-icons.ts:12` XP reward icon label.
- **CSS retire:** `.left-xp-*` (14-menu-panels…css:509-536), `.mobile-xp-bar-*`
  (23-mobile-shell.css:652-661), `.prog-bar-*` fill variants (ProgressionPanel.css).
- **Celebration:** level-ups now fire inside server-response application — trigger
  the existing level-up/rank-up UX off a level diff in `updateCharacter`
  (RankUpCelebration's localStorage-diff pattern already does this for ranks).

---

## 7. AI parity decision (recommend: freeze)

`aiStatsForLevel` distributes `statBudgetAtLevel(level)` (`lib/ai-stats.ts:81-86`),
and `ai-stats.test.ts:14-33` pins that coupling. Two options:

- **A (recommended): freeze AI on the old linear curve.** Rename it
  `aiStatBudgetForLevel` (same numbers, now AI-only). **Zero PvE balance change** —
  every enemy keeps exactly today's stats. Honors "don't change combat formulas
  unless asked."
- B: re-point AI at `earnedForLevel` so a level-L AI matches a *typical* level-L
  player's earned total. More honest, but globally re-tunes PvE difficulty
  (e.g. L50 AI loses ~22% of its stats) — do NOT bundle this into the migration;
  it's its own balance pass if ever.

---

## 8. Migration (one-time reconcile, lazy)

Pre-launch with a wipe pending, so generosity beats precision:

```
onLoad/onSaveWrite (server, once per save — flag `levelLedgerMigrated`):
  earned = earnedStatPoints(char)
  need   = earnedForLevel(char.level)          // stored level, already exam-clamped
  if (earned < need) char.unspentStats += need − earned    // top-up: nobody de-levels
  char.level = min(levelForEarned(earnedStatPoints(char)), examLevelCap(char))
  applyDerivedLevel(char)                       // rankTitle + vitals
```

- **Nobody de-levels; nobody loses unlocks.** Under-statted testers get a one-time
  pool infusion (precedent: the economy-redesign stat top-up, owner-accepted,
  patch-noted). Over-trained low-levels level *up* on first touch.
- Admin `maxedStats()` accounts derive to L100 (they already were).
- Lazy migration on save touch is sufficient pre-wipe; an optional admin sweep
  endpoint can force-migrate all saves for leaderboard consistency.
- `xp` field: frozen, retained until the wipe (rollback = revert the deploy; saves
  still carry xp).

**Rollout stance:** single cutover on a branch, adversarial-reviewed, no runtime
dual-path flag. A live formula flag would double the parity surface (client+server
× two engines) for a pre-launch game with a revert path. This deviates from the
usual "ship ON with kill switch" pattern deliberately — flagging it.

---

## 9. Test & verification plan

| Guard | Action |
|---|---|
| `api/_cross-build-parity.test.ts:145-154` source-text pins (`6 * level * level`, budget formula) | Replace with pins on the `LEVEL_EARNED_THRESHOLDS` table + `earnedForLevel` source text (both mirrors). |
| `api/_xp-engine.test.ts` (3,000-case `gainXp` sweep + golden anchors) | Rewrite as an `earned→level` sweep: all levels × earned values × exam flags, server vs client replica `deepEqual`; new golden anchors (earned 20→L1; 2,800→L15; 3,934→L19 vs 3,935→L20-held; exam-pass leap case; 29,000→L100). |
| `lib/stats.test.ts:17-65` (xpNeeded/budget/progress anchors) | Replace with threshold anchors + monotonicity + `levelForEarned(earnedForLevel(L)) === L`. **Add the reachability invariant:** `earnedForLevel(bandBoundary) ≤ 0.8 × bandCapacity` for every band — the anti-wall guard. |
| `lib/stats.test.ts` pacing bound | Rewrite: dedicated 340/day → L90 within [55, 90] days (or owner's chosen window). |
| New ledger tests | earned conservation under spend/respec/growth/training-overflow; overflow-rolls-into-pool; migration top-up (no de-level, exam clamp holds); `applyDerivedLevel` full-heal parity. Plus the **daily-checklist invariant**: sum of all once-per-day grants over the live daily catalog ∈ `DAILY_PVE_GROWTH_TARGET` ±10% — fails the build if someone adds a daily without re-tuning the slice (pins **base** sums; boosts multiply after). Boost tests: sealed `bonusPct` is server-derived, the aggregate-boost ceiling holds, and `STAT_GAIN_MULTIPLIER` defaults to 1. |
| `_training-parity.test.ts:18` per-tier `xp` pin | Drop the xp column both sides. |
| `lib/currency.test.ts:7,16` `"+10 XP"` strings | Update to the XP-less format. |
| `lib/endless-tower.test.ts` XP-softcap suites | Delete with the subsystem; new banked-ryo tests. |
| `lib/logbook-objectives.test.ts:130`, `ai-stats.test.ts` pin, `rank-progression`, `_stat-growth`, exam/eligibility tests | Update copy/pin targets; behavior unchanged. |
| Sim | Update `scripts/` pacing sim to the earned model; re-run the day-to-milestone table in §3 from code. |
| Ship gates | Full root `npm run build` (includes sizecheck — check the **margin**, CI adds Sentry), `npm test` from root, client `npm run lint`, App.tsx ratchet lowered, no `dist/` commit. |

---

## 10. Phase plan

Sequencing note: land/rebase the uncommitted launch-audit fixes from the other
worktree first — this touches the same engine files.

- **Phase 0 — Sign-offs (owner):** threshold table + pacing (§3), faucet
  conversions (§4, esp. story-milestone pool grants vs ryo-only), leaderboard swap,
  AI freeze (§7), no-kill-switch stance (§8). *This document is the ask.*
- **Phase 1 — Core curve (no behavior change yet):** `LEVEL_EARNED_THRESHOLDS` +
  `earnedForLevel`/`levelForEarned`/`earnedStatPoints`/`applyDerivedLevel` in
  `lib/stats.ts` + `api/_xp-engine.ts` (keep file names — everything imports them);
  freeze `aiStatBudgetForLevel`; training-overflow→pool fix; new tests + parity
  pins alongside the old ones.
- **Phase 2 — Server cutover:** `gainXp` internals → derived-level engine; the 12
  server faucet dispositions; sanitizer changes (level recompute, xp freeze, clamp
  deletion); leaderboard metric; migration reconcile + flag.
- **Phase 3 — Client cutover:** delete client `gainXp` sites; bars/HUD/toasts/copy
  per §6; tower banked-ryo; celebrations; CSS retire; App ratchet down.
- **Phase 4 — Verify & ship:** §9 suite green, pacing sim output attached,
  adversarial review pass (engine + sanitizer + migration), patch notes
  (`data/patch-notes.ts` + docs), single merge to main, Railway self-builds.
- **Known follow-ups (deliberately not bundled):** the "Growth Surge ×N" badge
  when the era dial is active (server env exists; UI surfacing pending); the
  split daily-growth meter ("Daily Growth 33/45 · Combat 12/18"); clan-doctrine
  term of the sealed training bonus verified against a live clan snapshot.

### Post-build audit (2026-07-28) — findings and dispositions

A full re-review (server grant consistency + player-facing copy) after the four
phases landed. Fixed in the audit commit:

- **Sanitizer exam-hold bypass (critical).** The derived-level recompute seeded
  from the raw client body, whose `examsPassed` is not validated until ~440
  lines later — so a forged `examsPassed` picked its own level cap and, because
  the recompute is rise-only, minted a *permanent* level past both holds. Now
  seeded from the stored exam list; covered by regression tests in
  `api/save/_save-integrity.test.ts`.
- **Strict-ledger burned the migration.** `levelLedgerMigrated` latched even
  when `enforceRawSaveLedgerBoundary` reverted the top-up, stranding that player
  below their level forever. The flag now only sticks when its effect does.
- **Hall of Legends ranked dead data.** The board was relabelled to stat points
  but still read the frozen `xp` field from the roster projection (0 for every
  post-cutover character, and disagreeing with the public leaderboard).
  `api/player/roster.ts` now serves the earned ledger in that slot, and
  `PUBLIC_INDEX_VERSION` bumped to 2 so dormant v1 rows rebuild instead of
  sitting on top with pre-cutover cumulative XP.
- **Weekly boss skipped the level-up vitals refill** (max pools raised, current
  pools not) — every other grant site spreads `leveled` wholesale.
- **Three dead copies of the frozen AI budget formula**, with the cross-build
  parity test pinning the two *dead* ones while the live one in `lib/ai-stats.ts`
  went unguarded. The dead `xpNeeded` / `statBudgetAtLevel` /
  `statPointBudgetForProgress` / `progressAfterXp` are deleted on both sides;
  the parity pin now asserts they stay deleted.
- **`rewardSummary`'s `xp` parameter** is gone (it could still print "+N XP"
  from a stray argument); claim toasts lead with the shared `statPointNote`.
- **Exam-hold UI lied.** During the L20/L39 holds the panel read "0 stat points
  to Level 21" while nothing happened. New `levelProgress()` in
  `lib/character-progress.ts` is the single source for every level bar and
  reports the hold by name.
- **Copy contradictions** in Town Hall upgrades, clan Training Grounds, the
  Scholars doctrine (a permanent choice sold on a deleted currency), Hall of
  Legends, the beginner guide's leveling advice, and the Missions rookie card.
  Guide section 9 now actually explains how leveling works.
- **Admin "Level N" testing buttons** were silently no-ops (the sanitizer
  ignores client level writes); they now move the ledger through the admin
  signal path.

Accepted, not fixed (documented deliberately):

- **Migration absorbs grants earned in the deploy window.** The top-up sets the
  pool to exactly `earnedForLevel(storedLevel)`, so points granted between
  deploy and that player's first sanitized save are absorbed rather than added.
  Bounded by one save cycle, never negative (nobody de-levels), and moot at the
  pending wipe.
- **Respec paths don't call `applyDerivedLevel`** — safe by conservation
  (allocated → pool is exactly neutral) plus rise-only, so level provably cannot
  move.
- **Training caps against the pre-grant level**, so a collect that crosses a
  rank boundary is capped at the old rank and the remainder rolls to the pool —
  never lost, self-corrects next session.
- **Pool allocation still bypasses `statCapForLevel`** on the non-strict save
  path (pre-existing; combat re-clamps via `perRankStatCap`).
- **Admin content editors still expose `xpReward` inputs** that no longer pay.
  Creator-content schema cleanup is its own pass.
- **Post-soak cleanup (after wipe):** drop `xp`/`dailyTowerXp` from types + stored
  saves, delete frozen sanitizer pass-throughs, remove migration flag.

---

## 11. Decision list (everything needing an owner call)

1. **Pacing: RESOLVED by owner directive** — the standard "dailies + a little
   extra" player fully caps in ~90 days (current fit: ~93, §3). Remaining
   confirmation: the standard-profile definition the fit assumes (~12 h
   effective training coverage/day). If "normal" should assume less training,
   the checklist grows to compensate.
2. **Slice sizes (as built):** dailies 45 / PvP 18 (base total 63, on par with
   today's 60). Consequence stands: heavy-PvP players' stat growth drops
   **60 → 18/day** — the cost of "dailies are the bulk." Confirm, or re-cut.
   (§3, §4)
3. **Per-claim numbers:** hunt/field +3–4, profession dailies +2–3, dice +1–5,
   story ~600 total, tower first-clears ~4–60/floor, weekly boss +10 — accept
   the §4 defaults (final values tuned against the live daily catalog and
   pinned by the full-clear ≈ target ±10% test) or set exact numbers?
4. **Leaderboard:** swap "Total XP Earned" → "Total Stat Points Earned"
   (recommended) or retire the board?
5. **AI curve freeze** (recommended) vs re-point at the new curve? (§7)
6. **No runtime kill switch** (single cutover + revert path) — confirm the
   deviation from ship-ON-with-kill-switch. (§8)
7. **Growth boosts: RESOLVED by owner directive** — eligible XP boosts convert
   to stat-gain boosts (§4.1: Town Hall + elder focus fold into the sealed
   training `bonusPct`; mission boosts apply to checklist rewards; PvE/PvP win
   awards stay direct and unboosted; the retired global multiplier is succeeded
   by the server-env `STAT_GAIN_MULTIPLIER` era dial). Remaining calls: the aggregate-boost
   ceiling (×2.5 proposed) and the era dial's launch default (1).
8. **Tutorial spar reward:** +20 pool points (recommended) or ryo?

## 12. Risks

- **Pacing shock** (~2× faster to high level) — the §3 table is the mitigation;
  it's a deliberate dial, not a side effect.
- **Reward-feel:** largely solved by the §4 daily checklist — the once-per-day
  claims show "+N stat pts" where they showed "+N XP", and the sum is designed
  to land, not clamp. Repeatable grinds are ryo-only by rule (legible, not
  broken). The split meter ("Daily Growth 32/40 · Combat 12/18") makes the
  structure visible.
- **Budget-key contention: mostly designed away in v3** — checklist grants are
  guarded by their existing once-per-day claim receipts (no shared counter
  needed), and only the PvP slice keeps the `combat-stat-count` key. Any
  counter that does end up shared stays under `withKvLock { failClosed: true }`.
- **Boost stacking:** converted bonuses now compound on real power-growth speed.
  Guards: the aggregate-boost ceiling (§4.1), server-derived-only `bonusPct`
  (never client-supplied), the applied multiplier written to the audit trail,
  and telemetry watching gen-2 pace against the ~73-day projection.
- **Exam-hold leap** (banked earned → multi-level jump on exam pass) — intended,
  patch-noted.
- **Admin accounts** derive to L100 and pollute earned leaderboards if not
  excluded (§5.3).
- **Rolling deploy window:** old clients self-granting XP against a new server is
  harmless (xp frozen, discarded); new clients against an old server must keep the
  graceful fallback (apply server character verbatim, never local-level).
- **Concurrent worktrees:** other sessions' uncommitted work on `App.tsx` /
  `_xp-engine.ts` will conflict — coordinate before Phase 2/3.
