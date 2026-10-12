# Pet battle presentation and response audit — October 11, 2026

The owner requested one professional Pet Arena presentation across pet battles,
player-controlled ranked matches, AI-driven Beastfront, balance verification and
a live-main release. This follows the twelve-species competitive implementation.
The checkout incorporated live main `f8f45a3f1`, then `444dda004` (the intervening
chat fix), then `eb8073e56` (socket chat and retention fixes). This record distinguishes local automated evidence from production
rollout and human playtesting.

## Runtime ownership and presentation

| Mode | Combat authority | Presentation coverage |
| --- | --- | --- |
| Ranked Pet Colosseum and code-based sparring | `api/_pet-tactics/engine.ts`; both human seats submit private orders | Existing Pet Arena squad builder, preview, command console, targeting, resources, results and cinematic renderer |
| NPC/practice, story/road, first pact, wild binding, dungeon and Hollow Gate | `api/_pet-showdown/engine.ts`; player commands versus server AI | Shared `PetShowdownBattle` console, left-side HP/energy, painted move icons, inspector, targets, playback, help and result panels |
| Beastfront | Warfront Rite formation/AI resolver | Shared theme on formation, arena controls and result states; AI remains responsible for combat |
| Gauntlet | Gauntlet drafting/progression and board resolver | Shared theme on setup/drafting and board HUD; removed the visible engineering build label |
| Historical receipts | Original sealed combat authority | Settlement compatibility only; no fresh retired-duel admission |

The shared material owner is `shinobij.client/src/styles/pet-battle-theme.css`.
It uses the previously accepted original `command-ink-v2.webp` artwork. Native
planning removes the duplicate friendly plates above the menu; HP, energy and
meter are on the squad cards. Measured menu height reserves the matching arena
viewport. Portrait and short landscape layouts remain scrollable, keyboard
accessible and clear of the playfield. Native fights retain their established
last-choice submission flow; only two-human Pet Arena requires an explicit lock.

## Retirement ruling and Dungeon integration

The owner explicitly retired the continuous-time owned-pet duel and Fight Plan
screen. Their attempted restyle was reverted and their preview evidence removed.
Pet Arena no longer mounts the old live host or exposes its party toggle. Direct
challenges open the current twelve-pet command room. The socket challenge handler
refuses new admission, and saved VFX preview URLs cannot load the retired renderer.
Existing historical proof settlement remains supported and regression-tested.

Dungeon Rare Beast uses the current server command arena. An exact parent run
must contain authoritative Warden and Card wins. Under a save lock, one session
is sealed and attached to that run; retries adopt it instead of rerolling. The
boss uses a level-55 rare-companion stat budget and a fixed authored kit.
It is sealed before its cosmetic identity is assigned, so art cannot change
growth normalization or its kit. Historical cinematic boss snapshots stay
unchanged. Terminal rounds/concessions commit the parent proof before the client advances. Parent replacement blocks old commands.
The battle pays nothing; Dungeon run settlement remains the reward owner.
An expired session requires leaving its run, and a recorded loss cannot restart
within the same run. Retained completed proofs recover without another fight.

## Numeric changes for fresh NPC fights

The authoritative owners are `damage-pacing.ts`, `engine.ts` and `ai.ts` under
`api/_pet-showdown/`. Fresh sessions and replay descriptors seal `response-v2`.

- Ordinary direct hits through 60% maximum HP are unchanged; excess damage
  smoothly approaches 90% at every level instead of losing this response curve
  at high levels.
- Unprepared signatures approach 60% maximum HP. Empower, Mark or favorable
  weather permits a prepared signature to approach 75%, before defense.
- Guard and protective moves resolve in a defensive phase before attacks.
  Guard covers direct hits; ongoing damage still matters. Switching retains its
  earlier phase. Speed continues to matter within each phase.
- Paid NPC tiers match the player's rarity. Training allocation, AI policy,
  traits and gear distinguish difficulty instead of hidden rarity jumps.

Unversioned stored sessions/descriptors use `legacy-v1`. Input-only territorial
and retained ranked proofs explicitly retain the legacy resolver. Replay
validation rejects unknown versions. New ranked battles use Pet Tactics and
have no AI fallback. Competitive twelve-species, Beastfront and Gauntlet numbers were not changed
in this release. The continuous-time owned-pet duel is retired.

## Automated balance evidence

The final `npc-1v1.json`, `npc-2v2.json` and `npc-3v3.json` cover 161 templates,
levels 1/25/50/100, four tiers and two seeds: **15,456 matches**. The public-sheet
policy uses balanced growth, no player traits/gear and two reserves. Both sides'
legal opening damage probes have **zero full-health opening KOs**. Existing
role, element and species bands pass all three formats without relaxed gates.
Sparring scored 49.2%/49.0%/45.7% in 1v1/2v2/3v3. Paid tiers remain intentionally
unequal challenges for an untraited, ungeared player fixture. Their aggregate
difficulty is not strictly monotonic in 1v1 under this one policy (Champion
31.7% player score versus Warrior 28.6%); treat that overlap as a playtest watch
item rather than proof of universal tier difficulty.
`npc-1v1-before.json` records the prior high-level opener issue; the
`response-only` files are intermediate experiments, not the final configuration.

Five fresh-session signature reports cover **150,620 damaging probes** across
same-rarity catalog pairs at those four levels. All have zero full-health KOs.
Maximum observed damage was 59.49% without setup and 74.62% with setup. Prepared
signatures into Guard peaked at 37.40%. These are controlled balanced-growth
probes without gear/traits, not a complete owned-loadout meta certification.

`dungeon-command-balance.json` covers 966 fixed-boss command matches against
all 161 catalog templates at levels 45/55/65 with two seeds, balanced growth,
no player gear/traits, and champion public-sheet decisions for both seats.
All terminate, with zero draws and zero full-health KOs in 4,542 legal opening
damage probes. At level 55 the rare-pet fixture wins 80% (mean 3.71 rounds).
This is an accessible progression seal, not a ranked mirror; species, elemental
counters and earned equipment change difficulty. Human challenge tuning remains
a watch item. The pre-calibration report records the rejected old cinematic stat
frame: only 1/110 same-level rare fixtures won. It is not the shipped profile.

`gauntlet-balance-report.json` records 64 complete Gauntlet runs including
production enemy placement, centering, merges, growth, relics and synergies.
Drafting and positioning averaged 6.125 rounds cleared versus 5.03125 for
first-offer/front-row play, across 546 board fights. One stronger-policy run
cleared the entire run. These heuristics do not establish optimized human win
rates; late progression difficulty remains a playtest watch item.

The unchanged Beastfront harness's 32 mirror-seed samples scored 50%, with no
draws, capped clashes or idle fighters. Formation changes altered 40.6% of
outcomes, and first-clash losers recovered in 15.6%. Median match duration was
58.1 seconds. Equal-template mirrors do not guarantee parity between different
progression tiers; the harness's deliberate stat advantage remains advantageous.

The previously recorded 12,528-match/24,192-signature competitive audit remains
applicable because its five source hashes match the current checkout.
Its documented species watch items still require broader human playtesting.

`balance-summary.json` consolidates the final results and records SHA-256 hashes
for the numeric owners and audit harnesses. The detailed per-fixture reports
remain the evidence; this summary does not replace the production owners.

## Reproduction

Run from repository root:

```text
node --import tsx scripts/showdown-training-audit.mjs --seeds 2 --format 1v1 --bench 2 --report docs/audits/pet-battle-unification/npc-1v1.json
node --import tsx scripts/showdown-burst-audit.mjs --levels 1,25,50,100 --seeds 1 --ultimates-only --setup none --report docs/audits/pet-battle-unification/signatures-none.json
node --import tsx scripts/pet-gauntlet-balance-audit.mts
node --import tsx scripts/dungeon-pet-balance-audit.mts
node --import tsx scripts/warfront-rite-harness.mts 32
node --import tsx scripts/pet-tactics-qa-server.mts
node shinobij.client/scripts/verify-pet-battle-menus.mjs
```

Repeat the NPC command for 2v2/3v3; signature setup for buff/mark/weather and
buff plus `--guarded`. The Gauntlet command refreshes current board-mode evidence.
Set `PET_ARENA_QA_RANKED=1` when running the existing
`shinobij.client/scripts/verify-pet-tactics.mjs` for the two-human lifecycle.
The loopback harness signs isolated memory-backed accounts and refuses production
mode. Browser screenshots use real production components and authoritative local
handlers; fixture pages are excluded from production build inputs.

## Final local validation

- 652 tests in 72 selected files passed, with zero failures, skips or cancellations.
  The manifest is `regression-files.txt`. Historical receipt and in-memory
  recovery tests use explicit pre-cutover fixtures; they do not reopen admission.
- Full client lint passed with zero errors and 18 existing refresh warnings.
- Server and production-setting client builds passed after integrating current
  main. Analytics, realtime and error-reporting branches were enabled using
  harmless public placeholders. The retired Fight Plan string is absent from
  emitted JavaScript.
- Distribution verification passed. Budgeted JS/CSS is 9,167,363 bytes against
  the unchanged 9,513,000-byte ceiling; no size limit was loosened.
- The real local server's fresh-account release certification passed 92/92.
- Current-menu browser QA passed seven native layouts, including fresh Dungeon
  commands at desktop/mobile, plus Beastfront and Gauntlet at both sizes: eleven
  cases, zero browser errors or failed responses. Checks cover keyboard actions,
  targets, authoritative resource updates, touch sizing and arena/menu geometry.
- Two authenticated ranked players completed a 14-round knockout, including
  reconnect, private planning, cancellation and lifecycle checks. Settlement
  wrote one receipt per player with ratings 1012/988; ryo and pets stayed unchanged.
- Four wild-capture browser cases passed (success/failure at desktop/mobile).

These are local automated results. Main publication, CI and the actual Railway
revision are checked separately at release time. This file does not assert a
production rollout or optimized human balance.

## Full-CI follow-up

The first published revision, `c14cf951a`, passed the production image build/boot,
client quality, PostgreSQL integration and the 652 selected regressions. The full
suite found seven integration failures outside that selection. Six were stale
source-contract assumptions or the QA entry's missing model warm-up; the new
Dungeon save writer also needed the canonical `mutatePlayerSave` path.

Dungeon admission and terminal writes now use that shared mutation path, so idle
HP/chakra/stamina regeneration and its cursor survive a versioned parent commit.
A behavioral regression verifies both admission and concession after 30 seconds
of recovery. Existing lost-reply, concurrent-admission, exact-parent, unpaid-win
and proof-repair tests still pass. Forty-five targeted follow-up tests pass, with
zero failures/skips/cancellations; server build, client types, scoped lint,
fresh Dungeon desktop/mobile browser checks and 92/92 release certification
also pass. Numeric combat rules are unchanged by this follow-up.

A final parent-mode check restores the kickoff one-use item commitment. Terminal
proof and item spend share one canonical save mutation; retries do not spend
twice, and a different item equipped later is preserved. The expanded parent and
integration group passes 53/53, including historical receipts, with seven current
Dungeon command cases. Server build passes after this correction.
