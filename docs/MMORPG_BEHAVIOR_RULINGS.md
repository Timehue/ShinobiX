# MMORPG behavior rulings — 2026-09-08

The four decisions `docs/MMORPG_BEHAVIOR_AUDIT_2026-09-08.md` left open, now made and
shipped. Each was researched against how the genre actually handles the same problem —
including which attempts were later reverted, which is usually the more informative half.

The through-line: **every ruling here fixes the incentive by making the legitimate path
work, not by adding a punishment.** No currency, XP, gear or reward rate changed. Every
change is additive or a refusal, so none of it can corrupt a live save.

---

## F1 — Death is a free full heal → the hospital treats injury only

**Ruled:** discharge restores **HP only**. Chakra and stamina are recovered by resting
or at the Cafeteria. To make resting a real option, idle recovery becomes a share of
each **pool** (a full bar in 30 minutes at any level) instead of a flat 1 point/second.
The Healer self top-up gets the rank-scaled cooldown that healing anyone else already
had, floored at 60 s.

To be precise about the cost, since an earlier draft of this doc understated it by
saying "nothing is taken": a defeat now leaves you paying the same short rest or 100-ryo
Feast that a player who *survived* a hard fight already pays. That symmetry is the point
— before, losing consciousness refunded the fight and surviving it did not.

**Why.** The audit called this a missing penalty. It is really an inverted exchange
rate. At level 100 the pools are 10,000 each (`HP_CAP`, `CHAKRA_CAP_V2`,
`STAMINA_CAP_V2`) while idle recovery ran at 1 point/second — so a full bar took
**2h46m**, a Feast cost 100 ryo, and dying returned up to 30,000 points free in 60
seconds. Dying was simply the best of the three.

The genre has been here. FFXIV 1.0 had players suiciding to teleport; BioShock's
Vita-Chambers made dying a strategy. The answer was never a bigger stick — Guild Wars 2
deleted repair costs outright on the reasoning that lost time is penalty enough. What
does work is Lost Ark's rule for raid resurrection: you come back at full health, but
your cooldowns and gauges do not reset. That removes the tactical value of dying without
touching currency, gear or XP — all three of which are architecturally blocked here
anyway (ryo is client-owned, level is derived from the stat ledger so an XP penalty
would de-level, and there is no durability system).

The regen retune is not a separate nicety, it is what makes the ruling fair. Without it,
HP-only discharge strands a high-level player for hours and quietly forces a ryo tax.
It is also finishing a job already started: the owner ruled on 2026-07-31 that cafeteria
meals must scale with the pool, because the old flat amounts predated the v2 pool curve.
Regen never got that pass.

Measured effect on a full HP bar from empty: **L1 8.3m (unchanged) · L20 40m → 20m ·
L50 90m → 30m · L100 2h46m → 27.8m.** It is floored at the old rate, so **nobody
recovers slower than before**; levels 1–19 keep exactly what they had, because their
pools are already smaller than the 30-minute budget. (One correction to an earlier draft
of this doc: the "~100-HP pools" phrase belongs to the cafeteria's PRE-v2 history. Under
v2 even level 1 holds 500 HP / 1000 chakra, so the flat rate had fallen behind at every
level, not only high ones.)

The Cafeteria was verified to scale the same way — `restoreAmount` returns
`max(flat, pool × pct)` — so a 100-ryo Feast really is a full instant restore at level
100, not a 9,999-point relic. That is what makes "rest, or pay" a genuine choice rather
than a forced wait.

**Rejected:** the audit's own "discharge at 50% HP". About 68% of explore tiles force a
fight and an unresolved ambush blocks all further tiles, so death here attaches to the
game's highest-frequency *compulsory* activity. Sending players back into that at half
health is the Guild Wars 1 shape where the penalty manufactures more of itself. Also
rejected: a longer or escalating stay (lands on the unlucky and the under-levelled, not
the exploiter), and any ryo or item cost on death (collides with the client-owned ryo
architecture and with economy ruling 6).

**Kill switches:** `DISABLE_HP_ONLY_DISCHARGE=1`, `DISABLE_POOLED_VITAL_REGEN=1`.
Separate on purpose — the discharge half is a true hot switch, revertible alone.

⛔ **The regen flag is NOT hot.** It is read server-side only; the client's idle clock is
unconditionally pooled. Throwing it alone puts the client at the pooled rate and the
server at the flat one, so the autosave ceiling clamps every save — which is exactly the
falling-bars symptom. It requires a matching client redeploy.

**Checked — the Healer economy is not collateral damage.** A Healer's income is XP equal
to the percentage of HP they restore, and ranks 1–9 (plus anyone without the Lifeline
mastery) can *only* heal a **hospitalized** target (`api/player/heal.ts:105-108, 364-366`).
Hospitalized characters do not regenerate at all — `canRegenVitals` excludes them — so
faster resting cannot shrink the core Healer loop. The only narrowed window is the
rank-10 / Lifeline "heal a merely-injured player" perk, where a target now self-recovers
in ~28 minutes instead of ~2h46m at level 100. That is an endgame convenience, not the
profession's living, and HP-only discharge leaves Healer XP per heal unchanged.

**Watch for:** any report of vitals appearing to *fall* on save means a mirror drifted.
Fix the mirror — do **not** throw the regen flag at it, which reverts only the server half
and makes it worse. If Feast purchases do not rise, something else
is still refilling chakra for free. If rank-10 Healers report they can no longer find
injured targets, widen that perk rather than slowing regeneration back down.

---

## F2/F3 — "Hospitalized" now means the same thing everywhere

**Ruled:** one shared predicate, `isIncapacitated()`, applied at every entry point that
commits a character to a fight: Hollow Gate dive start, ranked queue, Team Arena queue,
and guard-duty signup, alongside the four handlers that already checked.

**Why.** The rule was enforced in 4 of ~15 places and held everywhere else only by a
client screen pin — in a codebase whose stated invariant is that the client is never the
enforcement layer. The dive case was doing real damage: `hollow-gate/start.ts` spent a
daily-capped entry while `combat-start.ts` refused every fight inside the run, so an
admitted player burned one of two daily dives on a run they could not play, and the open
run then suppressed their recovery on top of the admission.

**Deliberately still allowed while admitted:** training, mission claims, card duels, pet
content, shops and banking. You can browse the auction house while dead in most MMOs;
the rule is about entering combat, not about freezing the account.

---

## F4 — Silence now holds on every surface that reaches another player

**Ruled:** clan chat, sector trail signs and custom profile titles all check
`getActiveSilence()` and return the same 403 shape the chat surfaces already use. Scoped
to the authored-text action only: sparking someone else's sign and wearing an *earned*
title carry no text and stay available.

**Named-weapon forging is handled differently, and the difference matters.** A weapon's
name reaches the public PvP battle log, so a silence has to reach it — but the item is
stat gear, and the roll token expires in 20 minutes while a silence lasts days. Refusing
the forge would destroy a paid roll rather than mute anything. So the forge proceeds and
the **authored text is dropped**: the weapon mints as "Named Weapon" with a generated
description. Silence costs speech, not progression.

**Why.** A moderation action a player can route around is worse than none — the
moderator believes it is handled and the target learns which door still works. Silence
was enforced on DMs, village chat and PvP chat, and not on four other surfaces that
publish player-authored text to strangers. A silence should cost speech, not progress,
which is why the non-text branches stay open.

---

## F5 — Field Recovery: a 120-second shield after a PvP defeat

**Ruled:** a defeat (or a sleeper KO) stamps `pvpShieldUntil = now + 120 s`, and
`/api/player/attack` refuses a target who is admitted or shielded, reading the
**authoritative save** rather than presence.

**Why 120 s.** The 60-second hospital stay plus 60 seconds to actually leave the sector
that just beat you. Deliberately short: on a 100–200 player server, opponent
availability is already the binding constraint on Honor Seals — the tuning note in
`_vanguard-rewards.ts` says so — and a long immunity would starve legitimate sector PvP
to stop a grief the reward caps already make unprofitable. WoW's answer to the same
problem was diminishing returns on repeat kills, which this codebase already has; what
it lacked was any protection on the *action*.

**Why the save and not presence.** The presence character is whatever that player's own
client sent. A shield read from there would be self-declared permanent immunity — the
exact bug that forced `inBattle` to become server-owned in 2026-09. `pvpShieldUntil` is
server-owned in the save validator: a client can neither grant itself one nor clear one
it is still serving.

**What this actually fixes:** not a 0-HP auto-loss — session creation already refuses an
unconscious fighter — but the *pin*. Stamping `pendingAttacker` on a downed player made
`engagedInWorldDuel` refuse their safe-zone exit, re-stampable at 6/minute, indefinitely.
The offline path already refused to touch an already-defeated player; the online path now
agrees with it.

**Not shipped:** a per-pair attack cooldown. The shield covers the grief without it, and
on a server this small a further restriction risks making sector PvP unplayable for
honest players. Revisit only if repeat-targeting shows up in practice.

---

## F6 — Clans get a successor instead of being orphaned

**Ruled:** a new server-authoritative `POST /api/clan/leave`. It removes the member,
clears their clan pointer and — when the **founder** leaves — promotes a successor in the
same atomic step. The successor is computed: declared rank (Leader → Officer → member)
as a preference, then longest tenure, then slug, so the order is total and the pass is
idempotent.

**Why.** `founderName` could only change by admin action, so a founder who left kept the
title forever and dissolution, doctrine and seal-pool distribution became permanently
unreachable for the people still in the clan — which could still hold territory, a
treasury and war commitments. Every major MMO solved this long ago: WoW ships automatic
guild-master replacement, FFXIV and EVE ship explicit transfer plus an inactivity path.
Nobody leaves a guild headless.

**Why rank is a preference and not a gate:** a clan whose remaining members hold no rank
must still get an owner, or the headless state returns with extra steps. **Why computed
and never claimed:** there is no "claim leadership" call to race, so no hostile-takeover
surface — a member becomes eligible only by outranking or outlasting everyone else.

The old flow's roster removal was best-effort (`.catch(() => {})`) after local state had
already been cleared, so a failed write left a ghost member. That is now one write under
the clan lock.

**Not shipped:** the 30-day founder-inactivity cron. It is the right long-term shape, but
a server reset is pending, so existing orphaned clans will be wiped rather than repaired;
what mattered was stopping new ones. Worth adding before launch.

---

## F8 — Transfers get the aggregate ceiling the per-call cap implied

**Ruled:** a rolling 24-hour **send-side** budget — 1,000,000 ryo for a settled account,
25,000 for a guest, a brand-new account, or one below level 10. **Nothing is added to
receiving, at any tier.**

**Why send-side only.** RuneScape ran the other experiment: its 2008 trade limit capped
what players could give away, broke legitimate play, and was removed in 2011 as a
failure. The lesson the genre took is that RMT controls belong on the sender and on
untrusted accounts, never on everyone — a player receiving a gift has done nothing
suspicious, and a new player receiving help is precisely the case you want to work.

**Why rolling and not a UTC day.** Every other daily cap here is UTC-keyed, which is
right for content and wrong for an anti-abuse ceiling: a day boundary is doubled for free
by sending at 23:59 and again at 00:01, and a cap with a known workaround just selects
for players who know the trick.

No new magnitudes were invented for the trust tiers — 72 hours account age and level 10
are numbers already blessed elsewhere in this codebase, and neither can be bought. The
per-transfer caps, the 1,000 floor, the 10% burn and the 20/60s rate limit are unchanged.

---

## Gates run

Final tree (`0d34013ae`, after the verification pass):

- Full backend suite **9,757/9,757**.
- Root build + sizecheck **PASS** (initial graph 383,014 B gzip against the 389,000 ceiling).
- Client lint **0 errors**.
- `npm run test:e2e` — **385 passed, 2 failed**, both `firefox-desktop`, in specs this work
  does not touch. Re-run in isolation on firefox: **1 passed, 4 skipped, 0 failed**. One of
  the two (`first-pact-rpg.spec.ts:192`) *declares* a firefox skip, so it could only have
  failed during fixture setup, before reaching its own skip line; both also stub
  `**/api/**` wholesale, so no server change here can reach them. Read as a worker dying
  under load, not a regression — but it is recorded rather than rounded to "green".
- `npm run test:e2e:combat-layout` with `COMBAT_LAYOUT_CAPTURE_PHASE=after
  COMBAT_LAYOUT_STRICT=1` — **20 passed, 10 skipped, 0 failed**.

The ownership golden-master snapshot was regenerated deliberately for the one new
server-owned field, and the diff shows only that field.

⛔ **Gate on the suite's own exit code, not the shell's.** Both e2e commands here end in
an `echo`, so the wrapper exits 0 even when Playwright failed; the first e2e result in
this session was misread for exactly that reason. `${PIPESTATUS[0]}` is the truth.
