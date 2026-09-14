# MMORPG Behavior Audit — 2026-09-08

Scope: the whole live game, judged against the question "does this behave the way a
player would expect an MMORPG to behave?" — not code quality, not performance, not UI.

Baseline: `9a13ff264` (branch `claude/mmorpg-behavior-audit-783026`, worktree copy of
main's tip as of 2026-09-08).

Method: read the executable handlers under `api/**`, the shared contracts under
`shared/**`, and the client guards under `shinobij.client/src/lib/**`. Every finding
below cites the file and line that proves it. No code was changed.

The reading was broad but **not uniform** — `docs/MMORPG_BEHAVIOR_AUDIT_HANDOFF.md`
carries the disposition table and an explicit list of the systems this pass did not
reach (sector war, missions/hunts, professions, pets, crafting, cards, story). Read
that before treating "full game" as exhaustive.

## Executive summary

This codebase is in unusually good shape for the class of defect this audit hunts.
The hard problems an MMORPG normally gets wrong are already solved here and solved
carefully: server-owned `inBattle` with real evidence behind it, a battle-lapse
reconciler per mode, a regeneration cursor that does not lose sub-second remainders,
idempotent settlement receipts carried inside the save, `withKvLock` on every shared
read-modify-write, and presence gating extracted into one tested pure module. The
2026-08 roundness audit and the F01–F22 behavior handoff (all 22 items live as of
2026-09-08) closed most of the connective-tissue gaps.

What remains is a different shape of problem, and it is consistent enough to name:
**a rule is decided correctly in one place and then not applied at the other places
that need it.** Five of the eight findings below are that exact pattern — the game
already knows the right answer, it just does not ask the question everywhere.

The one genuinely new design problem is F1: **dying is currently the cheapest and
fastest way to heal.** That is not an enforcement gap; it is an incentive inversion
that emerges from two individually-reasonable decisions, and it needs an owner ruling
rather than a patch.

Severity uses: **High** = reachable through the stock client by an ordinary player and
distorts play. **Medium** = real, but needs a tampered client, an unusual state, or a
patient griefer. **Low** = correctness/maintenance, not felt at the table.

---

## F1 — Death is a net-positive: it is the cheapest full heal in the game (High)

**What happens.** Being knocked to 0 HP admits the player to hospital for 60 seconds
(`PVP_HOSPITAL_DURATION_MS`, `AI_FIGHT_HOSPITAL_DURATION_MS`, and every other admission
constant are all `60_000` — `api/pvp/_vitals-settlement.ts:28`,
`api/missions/_ai-fight-outcome.ts:24`, `api/player/heal.ts:34`,
`api/hollow-gate/settle.ts:46`, `api/battle/lock.ts:59`, `api/save/[name].ts:304`).
On discharge the server writes `hp: maxHp, chakra: maxChakra, stamina: maxStamina`
(`api/player/heal.ts:242-249`), and after the timer expires that discharge is **free** —
`freshChargedRyo` stays 0 (`api/player/heal.ts:229-241`).

There is no material penalty attached to a defeat anywhere. A repo-wide search for
`onDefeat|defeatPenalty|loseRyo|ryoLoss|xpLoss|deathPenalty` returns nothing, and
`api/pvp/_bounty.ts` confirms bounties are third-party staked ryo, never looted from
the victim. Ranked rating does drop on a loss (`api/pvp/claim-rewards.ts:483`), but
that is the only cost, and it applies to one mode.

**Why it is illogical.** Compare the three ways to restore vitals:

| Route | Cost | Time | Restores |
|---|---|---|---|
| Natural regen | free | 1 point/sec (`VITAL_REGEN_MS = 1000`, `api/_elapsed-state.ts:12`) | all three |
| Cafeteria "Feast" | 100 ryo | instant | all three (`api/player/_cafeteria.ts:30`) |
| **Dying** | **free** | **60 s** | **all three** |

For any character whose pools exceed 60, dying beats regen. For any player short on
ryo, dying beats the Feast. The code that handles *surviving* a lost fight states the
intended design explicitly — "bailing out of a fight you are losing still means healing
before the next one" (`api/missions/_ai-fight-outcome.ts:202-205`) — and dying is the
one outcome that skips exactly that cost. **Losing consciousness is mechanically better
than limping away**, which is the inversion.

Starting an AI fight to die in has no entry cost, no stamina price and no daily cap;
`api/missions/ai-fight-start.ts` carries only a rate limit.

**The Healer case is sharper, and it is deliberate.** A Healer discharges *instantly*
and free, timer or not (`api/player/heal.ts:172-180, 227-230`); the comment is explicit
that this is the profession perk and the button reads "Free Self-Heal & Discharge
(Healer)". Taken alone that is a fine perk. Combined with a zero-cost death it means a
Healer has an unlimited, zero-cooldown, free full-restore button whose only input is
losing a fight on purpose.

**This is balance-sensitive and needs an owner ruling, not a patch.** CLAUDE.md puts
cooldowns and payouts behind explicit approval. Options, cheapest first:

1. **Discharge at partial vitals** — e.g. 50% HP and 25% chakra/stamina instead of full.
   Preserves the 60 s stay as the visible penalty, removes the free top-up, one-line
   change at `api/player/heal.ts:242-249`. Recommended: it fixes the inversion without
   touching any reward rate.
2. **Add a small material cost to admission** — a flat ryo fee or a % of carried ryo,
   burned. Real MMORPG-shaped, but it is a new sink and wants economy sign-off.
3. **Leave the perk, gate the loop** — keep discharge as-is but make repeat admissions
   within a window progressively longer. More code, more surface.

Option 1 also fixes the Healer case without removing the perk: the Healer still skips
the wait, they just do not get a free refill.

---

## F2 — "Hospitalized" is a real rule the server enforces in only 4 of ~15 places (Medium)

**What happens.** The design rule is unambiguous and stated in the code:
"You cannot enter combat while hospitalized" (`api/hollow-gate/combat-start.ts:110-112`,
which correctly checks `hospitalized === true || hp <= 0`). Server-side, only four
entry points ask:

| Entry point | Hospital gate | Battle-state gate |
|---|---|---|
| `api/world/explore.ts:235` | yes | yes |
| `api/missions/ai-fight-start.ts:538` | yes | yes |
| `api/hollow-gate/combat-start.ts:110` | yes | yes |
| `api/battle/lock.ts` | yes | yes |
| `api/training/start.ts` | **no** | **no** |
| `api/pvp/ranked-queue.ts` | **no** | **no** |
| `api/towers/pvp-queue.ts` | **no** | **no** |
| `api/towers/start.ts` | **no** | yes |
| `api/hollow-gate/start.ts` | **no** | **no** |
| `api/village-guard/queue.ts` | **no** | **no** |
| `api/card-clash/queue.ts`, `ai-start.ts` | **no** | **no** |
| `api/pet/showdown.ts` | **no** | yes |
| `api/missions/claim-mission.ts` | **no** | **no** |

Ranked and spar fights start at **full** vitals by design — `useCurrentVitals=false`
resets to `maxHp` (`api/pvp/session.ts:1642-1657`, `api/pvp/_low-level-hp.ts`). That
design is right for a fresh-start contest, but it means an unconscious player who
queues ranked fights at full strength, and the hospital penalty simply does not exist
for anyone who plays ranked.

**Why it is only Medium.** The stock client does hold the line: on boot a hospitalized
save is forced to the Hospital screen (`restoreScreenForSave`,
`shinobij.client/src/lib/screen-guards.ts:114`) and pinned there
(`isHospitalNavigationBlocked`, same file line 138). So an ordinary player mostly
cannot reach these endpoints while admitted. Two things still make it worth closing:
the pin only engages once the player is *on* the hospital screen, so an admission that
lands mid-session (a lapse settlement, a sleeper kill resolving) leaves them free until
they navigate or reload; and this game's own stated invariant is that the client is
never the enforcement layer.

**Fix.** Extract the predicate that `combat-start.ts:110` already uses into
`api/_elapsed-state.ts` (which owns `canRegenVitals` and already reasons about exactly
this state) as an exported `isIncapacitated(character)`, then call it from the
combat-entering endpoints in the table. Small, mechanical, one test per call site.
Decide deliberately which non-combat activities *should* be allowed while admitted —
training and mission-claim are arguably fine, card duels almost certainly are; ranked,
tower, guard-duty signup and dive entry are not.

---

## F3 — A hospitalized player can burn a daily-capped Hollow Gate entry into an unplayable run (Medium)

**What happens.** This is F2 with a consequence attached, which is why it is separate.
`api/hollow-gate/start.ts` has no hospital gate but *does* consume a daily-capped dive
slot (`if (ord === null) return 429 'daily-cap'`, line 302) and writes `hollowGateRun`
onto the save. The player then tries to fight and `api/hollow-gate/combat-start.ts:110`
refuses: "You cannot enter combat while hospitalized."

The player is left holding a live run they cannot advance, with a daily entry already
spent. It also suppresses their recovery: `canRegenVitals` returns false while
`hasActiveHollowGateRun(character)` (`api/_elapsed-state.ts:159`), so the open run
blocks regeneration on top of the admission already blocking it.

It resolves itself after the 60 s discharge, so this is a wasted entry rather than a
permanent lock — but a wasted daily-capped entry is exactly the kind of loss players
file tickets about.

**Fix.** Add the same `isIncapacitated` check to `hollow-gate/start.ts` **before** the
`ord` reservation. Two lines, and it is strictly a refusal — no existing successful
flow changes.

---

## F4 — A silenced player can still broadcast text, through four public surfaces (Medium)

**What happens.** Moderation writes a real silence record (`mod:silence:<name>`,
`api/admin/moderation.ts:57,334-354`) and exposes `getActiveSilence()`. Four surfaces
enforce it — `api/messages.ts:164`, `api/village/chat.ts`, `api/pvp/chat.ts`,
`api/_village-state-validate.ts`. Four surfaces that also accept player-authored text
visible to other players do **not**:

- `api/clan/chat/send.ts` — clan chat. Authenticates and rate-limits (line 38), never
  checks silence.
- `api/sector/trail-sign.ts` — player-authored signs left in a world sector, read by
  everyone who walks through. Authenticates and rate-limits (line 56), never checks.
- `api/player/profile-title.ts` — a public custom title. `api/_text-moderation.ts:240`
  confirms this is treated as an identity surface (it bans impersonation terms), yet
  the handler never checks silence. (Correction, 2026-09-08: an earlier draft of this
  finding also claimed it had no rate limit. It does — `enforceRateLimitKv('profile-title',
  20, 60_000)` at line 17. The original grep was case-sensitive and missed
  `enforceRateLimitKv`; only the silence check was genuinely absent.)
- `api/craft/named.ts` — named-weapon names, which `api/save/[name].ts` notes are
  echoed into the public PvP battle log.

**Why it is illogical.** A moderation action that a player can route around is worse
than no action: the moderator believes the problem is handled, and the target learns
which door still works. Silence should mean silence on every surface that reaches
another player.

**Fix.** Call `getActiveSilence()` in those four handlers and return the same 403 shape
`api/messages.ts:164` already returns, so the client's existing "You are silenced"
handling works unchanged. Low risk,
four small diffs, one test each.

---

## F5 — Post-defeat protection exists offline but not online (Medium)

**What happens.** The offline path is protective and says so plainly: killing a sleeper
camp checks the victim's save and refuses with *"Target has already been defeated."* if
they are already hospitalized (`api/player/sleeper-kill.ts:75-77`), and it parks the
victim in sector 0 on a successful kill so they leave the sleeper pool entirely
(comment at `api/player/sleeper-kill.ts:44-46`).

The online path has no equivalent. `attackBlock` (`api/_realtime/presence-gating.ts:109-124`)
refuses an offline, sub-level-10, traveling, engaged or in-battle target — but never a
hospitalized or 0-HP one. `worldInteractionBlock` (line 127) likewise never checks the
*attacker's* condition.

**Correction (2026-09-08).** An earlier draft of this finding claimed a 0-HP target
"enters the fight at 0 HP: a guaranteed loss". That is **wrong**, and the check that
makes it wrong is `api/pvp/session.ts:2202-2211`, which already refuses to create a
continuous-vitals session with an unconscious fighter ("… is unconscious and cannot
enter this fight"). Verified directly against the source. The real defect is narrower
but nastier: the attack still stamps `pendingAttacker` on the downed player, and
`engagedInWorldDuel` (`api/_realtime/world-duel-engagement.ts`) then refuses their
safe-zone exit. The heartbeat clears the stamp each cycle, so at 6 attacks/minute one
attacker could pin a recovering player out of town indefinitely — a trap rather than a
kill, and one no reward cap touches, because the caps limit rewards and not attacks.

A repo-wide search for `protectionUntil|immuneUntil|pvpCooldown|attackCooldown|recentlyAttacked|lastAttackedBy|revenge`
returns **nothing** — there is no per-pair attack cooldown of any kind.
`PER_TARGET_DAILY_CAP = 3` (`api/pvp/_vanguard-rewards.ts:64`) caps the attacker's
*rewards*, not the attacks, so griefing past 3 is free. The only brake is a 6-per-60s
rate limit on the attacker across all targets (`api/player/attack.ts:26`).

**Why it is only Medium.** The 60 s admission is short, and the client pins an admitted
player to the Hospital screen so they usually stop reporting a sector ≥ 1 presence,
which `worldInteractionBlock` requires. But the protection is currently a side effect of
client routing rather than a rule, and the offline path proves the team already decided
what the rule should be.

**Fix.** Two lines in `presence-gating.ts`, mirroring the wording sleeper-kill already
uses: refuse an attack when the target's presence character is hospitalized or at 0 HP,
and refuse when the *attacker* is. Then consider a short per-pair cooldown (a
`pvp:recent:<attacker>:<target>` key with a few-minute TTL) so the same player cannot
be farmed repeatedly — worth an owner ruling, since it interacts with sector war.

---

## F6 — A clan founder who leaves orphans the clan permanently (Medium)

**What happens.** Leaving a clan is a client-orchestrated flow
(`shinobij.client/src/screens/ClanHall.tsx:415-435`). It warns the founder that
"leaving doesn't transfer ownership" — and that is literally true, because there is no
succession path anywhere. `founderName` can only change by admin action
(`api/_clan-save-validate.ts:130-136`). Once the founder is gone, the record still
names them, and everything gated on being the founder becomes permanently unreachable
for the people who are still in the clan:

- dissolution (`assertClanDissolutionFounder`, `api/clan/_dissolve.ts:49-54`)
- the clan doctrine (`api/_clan-save-validate.ts:172`)
- seal-pool distribution, and `deleteClan` on the client (`character.clanFounder`)

Roster management survives, because `ADMIN_ROLES` includes Leader and Officer
(`api/_clan-save-validate.ts:66`) — so this is partial orphaning, not total. But the
clan can still hold territory, a treasury and war commitments that nobody can now wind
down, and the only remedy is an admin.

Secondly, the roster removal on leave is explicitly best-effort and client-side —
`writeClanData(...).catch(() => { /* non-fatal */ })` (line 428). A failed write or a
closed tab leaves a ghost member on the roster who is no longer in the clan.

**Fix.** Two independent pieces, either of which stands alone:
1. **Succession.** On a founder leaving, promote the longest-tenured Leader (then
   Officer, then member) and write the new `founderName` server-side. This is the piece
   that needs a real decision — auto-promote vs. an explicit "transfer ownership"
   button vs. flagging the clan for admin adoption — so it is worth asking the owner
   which shape they want before building it.
2. **A server-side leave endpoint.** `POST /api/clan/leave` doing the roster removal and
   the character update in one authoritative step, replacing the best-effort client
   write. This mirrors `api/clan/kick.ts`, which already does exactly this shape
   (`nextChar.clan = null`, line 99) — so it is a small, well-precedented addition.

---

## F7 — Inventory overflow silently destroys items on every grant path except the shop (Medium)

**What happens.** The save validator caps inventory at 500 by **truncation**:
`char.inventory = (char.inventory as unknown[]).slice(0, INVENTORY_CAP)`
(`api/save/[name].ts:1693-1696`). Items past the cap are deleted with no error, no
notice and no log.

Exactly one grant path checks the cap first and refuses cleanly: the shop, with
"Your inventory is full." (`api/shop/_settlement.ts:212`, `MAX_INVENTORY = 500` — the
same number, correctly). Roughly fifteen other paths append to inventory without
checking: `api/craft/_forge.ts`, `api/craft/named.ts`, `api/dungeon/_run.ts`,
`api/events/_claim.ts`, `api/inventory/_war-crate.ts`, `api/village/claim-war-crate.ts`,
`api/war/_reward.ts`, `api/clan/_exchange.ts`, `api/hollow-gate/_forge-key.ts`,
`api/missions/_world-ai-fight.ts`, `api/sector/story-reckoning.ts`,
`api/clan/treasury/transfer.ts`, `api/village/treasury/transfer.ts`,
`api/profession/choose.ts`, `api/pet/progress.ts`.

So a full-inventory player who completes a war crate, forges a weapon or claims an
event reward can lose it, and the game will never tell them.

**Credit where due:** the same file handles the *pet* cap correctly, and the contrast
is instructive — `PET_CAP = Math.max(maxPets(exChar), existingPets.length)`
(`api/save/[name].ts:1586`) can never truncate below what the player already owns, so
it refuses growth instead of destroying possessions. `api/pet/sanctuary-transfer.ts:92`
checks the cap at acquisition time. That is the right pattern; inventory just does not
follow it.

**Fix.** Two steps, in order:
1. Make the validator's truncation **non-destructive in the same way pets are**: cap at
   `Math.max(INVENTORY_CAP, existingInventory.length)` so persistence never deletes
   what a player already holds. This is the safety net and should land first.
2. Add an at-acquisition capacity check to the grant paths, returning the shop's
   existing 409 "Your inventory is full." so the player is told at the moment it
   matters. `tileCards` and `creatorItems` (`api/save/[name].ts:2102, 2405`) have the
   same truncation shape and deserve the same review.

---

## F8 — Player-to-player transfers are capped per call but not in aggregate (Low)

**What happens.** `api/player/_trade-core.ts` is well built: a 10% burned tax as the
sink, per-transfer caps (`ryo: 200_000`), floors that kill dust spam, self-trade
refused (`api/player/trade.ts:97`), a mandatory nonce, and 20 calls/60s
(`api/player/trade.ts:87`). The stated intent of the cap is "so no single call can move
an unbounded amount".

But there is no rolling or daily aggregate, so the ceiling is really 20 × 200,000 =
4,000,000 ryo per minute, and no restriction at all on the *recipient* — no minimum
level, no minimum account age. The Vanguard reward path takes account age seriously
(`ACCOUNT_AGE_MIN_MS = 72h`, `api/pvp/_vanguard-rewards.ts:65`) and even checks same-IP
and same-device; the trade path checks none of that.

**Why only Low.** The 10% burn is real friction at volume, and on a 100–200 player
server (the owner-approved launch capacity) this is a small population to launder
through. It is listed because it is the one economic door where the per-call limit
reads like a real limit and is not.

**Fix.** A rolling 24 h aggregate per sender keyed like the existing daily counters
(`dailyCounter` in `api/_village-stores.ts:257` is the established pattern), plus a
minimum recipient account age reusing `ACCOUNT_AGE_MIN_MS`. Both are additive; neither
changes an existing successful trade. Amounts need an owner ruling.

---

## Things checked and found correct

Worth recording so a future pass does not re-litigate them:

- **Daily resets are globally consistent.** All ~17 day-key helpers are
  `toISOString().slice(0, 10)` on UTC, so every daily cap in the game rolls at the same
  instant. The duplication is a maintenance smell (one shared helper would be better)
  but there is no behavioral drift — worth a cleanup ticket, not a fix.
- **Vitals regeneration** (`api/_elapsed-state.ts`) is genuinely well built: a cursor
  that keeps sub-second remainders, recovery counted from `hospitalizedUntil` rather
  than admission, and correct exclusions for battle lock, open dives and admissions.
- **Fresh-start vs. continuous vitals** is a deliberate, correct distinction —
  ranked/spar reset, sector raids carry damage forward (`api/pvp/session.ts:1642-1657`).
- **Newcomer protection** is intentionally two-tier (attackable floor 10, Academy
  challenge protection 15) and the reasoning is documented in
  `api/_realtime/presence-gating.ts:37-56`.
- **AFK / abandonment** is handled per mode by the battle-lapse work, and PvP has an
  explicit forfeit path after two skipped rounds (`api/pvp/move.ts:1871-1915`).
- **Offline timed activity** does not evaporate: a training grant outlives its 25 h
  token cache because it is recoverable from the save (`api/training/complete.ts:135`).
- **Bans** are enforced at authentication (`api/player-auth.ts`, `api/_auth.ts:430`),
  including on the token path.
- **Ranked queue liveness** expires unpolled entries after 60 s
  (`api/pvp/ranked-queue.ts:38`), so a player who closes the tab does not sit in queue.

## Suggested order of work

Sequenced so the cheap, no-ruling-needed items land first and nothing is blocked
waiting on a decision:

1. **F3** — hospital gate on `hollow-gate/start.ts`. Two lines, prevents a real loss.
2. **F4** — silence on the four unenforced text surfaces. Four small diffs.
3. **F7 step 1** — make inventory truncation non-destructive. One line, stops item loss.
4. **F2** — extract `isIncapacitated` and apply it. Mechanical once F3 has established
   the shape.
5. **F5** — hospitalized/0-HP checks in `presence-gating.ts`.
6. **F6 step 2** — a server-side clan leave endpoint.
7. **F7 step 2** — at-acquisition capacity checks on the grant paths.

Needing an owner ruling before any code: **F1** (which discharge option), **F6 step 1**
(which succession shape), **F5's** optional per-pair cooldown, and **F8's** amounts.

Every item above is additive or a refusal — none changes an existing successful flow,
which keeps them safe against live saves. Each wants a handler-driven test using the
recipe in `docs/auth-and-anti-cheat-patterns.md`; F2 and F5 touch files pinned by
source-contract tests (`_pvp-contract.test.ts`, `heartbeat.test.ts`), so run the full
root suite rather than the touched files alone.
