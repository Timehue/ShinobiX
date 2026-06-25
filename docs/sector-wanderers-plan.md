# Sector Wanderers — AI shinobi that roam sectors and *feel like players*

> ## ✅ As-built (shipped to `main`, behind the `wanderers.v1` flag, default OFF)
>
> The feature below is **built and live** (dormant until the flag is enabled). What
> actually shipped, and where it differs from the original plan:
>
> - **Wanderers** spawn per wild sector (seeded, 6h refresh), walk/patrol and
>   approach the player, with an honest "wandering" tell. Five archetypes:
>   **bandit** (attack), **pilgrim** (gift), **sage** (quest), **beast** (pet duel),
>   **gambler** (card clash). `lib/wanderers.ts`, `components/SectorWanderer.tsx`.
> - **Attack/rob** fights the player using a one-off AI that wears the wanderer's
>   name/face, **scaled to the player's level** (never impossible).
> - **Robber streak → ambush:** fending off robbers builds `character.robberStreak`;
>   at 5 the next bandit triggers an **ambush gauntlet — 3 robbers then a boss**,
>   back-to-back with carried HP. The engine is strictly **1v1**, so this is a
>   *sequential* gauntlet, not a simultaneous 3v1. Boss clear pays a
>   **server-authoritative** loot bundle (`api/sector/wanderer-ambush.ts`: sealed
>   baseline + verified clear + daily cap).
> - **Gift** (pilgrim): server-rolled bundle — small ryo + an occasional fate shard
>   + 1–5 bone charms, daily-capped (`api/sector/wanderer-gift.ts`).
> - **Quest** (sage): 5 varied, server-verified objectives (win battles / pet duels
>   / card rounds / scout tiles) with sealed baseline + reward
>   (`api/sector/wanderer-quest.ts`).
> - **Pet duel** (beast) → existing Pet Coliseum; **Card clash** (gambler) → existing
>   Card Hall. Both reuse those modes' existing, server-safe reward paths.
> - **Not yet built** from the depth layer below: the full multi-stage quest book
>   (§11 of the content doc), the persistent nemesis/bounty-board rivalry, the
>   reputation/standing layer, faction/war reactivity, and bespoke boss art (no
>   image-gen keys in the build env). `dist/` is left to a canonical rebuild before
>   enabling cPanel (Railway builds from source).
>
> The rest of this doc is the **original design plan** (more ambitious than what
> shipped); keep it as the north star for future passes.

---

> Status: **PLAN, not started.** Written 2026-06-25. Mandate from the owner:
> *"Make a plan for AI interaction with players in sectors — make the AI look
> like how players look with the avatars, and have them either rob/attack, give
> the player something with NPC text, or give a unique quest that fits the game …
> do whatever makes sense for the future of the game and it being seamless."*
>
> This plan is the result of (1) a codebase verification pass — the load-bearing
> combat / currency / anti-cheat files were read directly, not summarized; (2) a
> second codebase pass mapping which *existing* systems Wanderers can hook into for
> depth; and (3) online research into the genre, encounter design, the anti-cheat
> model, player-trust history, and the legal surface. The headline findings:
> **the engine is already ~90% ready** (this is mostly *wiring + content*), the one
> unsafe idea (real currency theft) has a code-proven fix drawn from your own
> patterns, and — most importantly for *the future of the game* — the bones for an
> **emergent rival ("nemesis") loop** already exist (the bounty "grudge" board),
> which is what turns disposable encounters into self-authored micro-stories.
>
> See **§8 (research-driven upgrades)** for the design-quality pass; §1–§7 and §9+
> are the verified architecture and build plan.

---

## 0. What is locked (and why)

"Do whatever makes sense" is broad, but four things are load-bearing for the live
game and the feature must respect them or it breaks players / the economy / trust.
These are correctness constraints, not creative ones:

1. **Server authority for anything that touches currency, XP, or items.** Combat,
   rewards, and theft are already server-authoritative in this codebase
   (`api/pvp/move.ts` resolves combat move-by-move; `api/pvp/claim-rewards.ts`
   settles against the real session). Wanderers must ride those rails. Per
   `docs/auth-and-anti-cheat-patterns.md`: never pay out or deduct from a
   client-supplied amount or a client-claimed outcome.

2. **No Supabase schema change, no breaking save migration.** Everything fits
   existing KV patterns (tokens, escrow keys, daily-counter keys, audit keys). The
   rivalry/standing state (§8.2, §8.3) lives as **additive, optional fields on the
   character JSON blob** — which is exactly how the game already grows (`honorSeals`,
   `fateShards`, `hunterRank` were all added this way). Old saves without the field
   read as "no rivals / neutral standing," so there is no migration and no risk to
   existing players. What's off-limits is a *Postgres* schema change or a *breaking*
   save shape change — neither is needed here.

3. **Ranked stays untouched and deterministic.** Wanderers are PvE flavor and are
   excluded from every ranked/ladder path, exactly as `petDuel.v1` is.

4. **Seamless rollout.** Every slice ships behind a default-off flag, is purely
   additive, and degrades to "no wanderers" cleanly. Railway self-builds; cPanel
   needs `dist/` rebuilt + committed per the hard rules.

Everything else — placement, density, dialogue, quest content, cadence — is on the
table and decided below.

---

## 1. The vision: a *living world*, not a bolted-on minigame

"Seamless" is the whole point. A Wanderer should read as **another shinobi who
happens to be in your sector** — rendered with the same avatar pipeline players use
and **actually walking the grid**: patrolling, and striding over to you (or you to
them) rather than sitting frozen on a tile (see §3.5, the movement pillar). The
difference from a real player is a deliberate, *honest* **subtle tell** (see §3.2).
The interaction it offers is one of three verbs that already map onto systems you
ship today:

- **Rob / Attack** — a rival/bandit shinobi. Reuses the real PvP combat engine.
- **Gift + dialogue** — a merchant/sage/friendly genin. Reuses the visual-novel
  encounter UI and the mint-token reward pattern.
- **Unique quest** — a quest-giver. Reuses the server-authoritative mission catalog
  and claim path.

The research backs this shape twice over: "random encounters while traversing a
world map" (combat / trade-gift / quest-hook) is the oldest RPG pattern there is,
and "NPCs that look like players" is a *shipped, successful* design (Erenshor's
"SimPlayers") — when it's **honest** about it. Hidden bots masquerading as players
generate real backlash when discovered; transparent ones become a charming feature.
That single lesson drives two decisions below (subtle tell; scripted dialogue).

---

## 2. What we reuse — the 90% that already exists

| Need | Existing system | File (verified) |
|---|---|---|
| Render a player-looking character in a sector | `SectorAvatar` billboard + the "other players as avatar dots" render loop | `shinobij.client/src/components/SectorAvatar.tsx`, `screens/WorldMap.tsx:1322` |
| Deterministic, non-flickering placement | `playerNameTile()` name→tile hash; `SectorScatter` seeded layout | `WorldMap.tsx:74`, `components/SectorScatter.tsx` |
| **Server-authoritative combat with an NPC opponent** | PvP session resolves server-side; "Opponent has no save → NPC" via `hydrateNpcCharacter` | `api/pvp/move.ts`, `api/pvp/session.ts:829,839` |
| **Stake ryo on a fight, pay by real outcome** | PvP **bounty board**: escrow up front, verify vs real `PvpSession`, idempotent, anti-alt | `api/pvp/bounty.ts`, `api/pvp/_bounty.ts` |
| **Fully server-resolved "take the rewards" outcome** | `sleeper-kill` (no-fight KO, caps, anti-alt, anti-farm) | `api/player/sleeper-kill.ts` |
| Repeat-reward decay (anti-farm) | `recordPairWinAndDecay` (pair-keyed, 1h window, 0.1 floor) | `api/pvp/_reward-farm.ts` |
| Sealed single-use reward token | `raid-start` (UUID, 5-min TTL, daily mint cap via atomic incr) | `api/missions/raid-start.ts` |
| Session-verified, idempotent settlement | outcome checked against session; NX claim key | `api/pvp/claim-rewards.ts:120-130` |
| Server-authoritative quest claim | mission catalog + claim path | `api/missions/claim-mission.ts`, `api/missions/_mission-catalog.ts` |
| **Deterministic, server-re-runnable pet duel** | `runPetDuel`/`runPetPartyDuel` (seeded LCG, quantized, byte-identical) + token/settle | `shinobij.client/src/lib/pet-duel-sim.ts`, `api/pet/ranked-start.ts`, `api/pet/battle-result.ts` |
| **Card-game engine + match record/settle** | client engine + the server-authoritative clan-war port | `shinobij.client/src/lib/card-clash.ts`, `api/clan/war/_card-clash-engine.ts`, `data/tile-cards.ts` |
| Dialogue / visual-novel encounter UI | `CreatorEvent` (`eventKind: "visualNovel"`) | `App.tsx` (CreatorEvent type), `WorldMap.tsx:1351` |

A Wanderer is, in effect: *a `CreatorAi` given a player-style avatar + name, placed
like a player-dot, with one of five interaction verbs attached* (two gives, three
challenges — §4).

---

## 3. The Wanderer model

### 3.1 Data shape (no persistence required)

A Wanderer is **derived, not stored**. The visual roster is generated on the
client from a seed; the server independently re-derives the same roster from the
same seed when it needs authoritative stats/rewards (§5). Conceptual shape:

```
Wanderer = {
  slotId: string          // stable within (sector, day) — the seed handle
  name: string            // generated, reserved namespace (never a real player)
  avatarId: string        // from the existing player-avatar art pool
  level: number           // banded to the sector (see lib/pve-difficulty.ts curve)
  verb: 'gift' | 'quest' | 'duel' | 'petDuel' | 'cardClash'
  challengeMode?: 'shinobi' | 'pet' | 'card'  // for the challenge verbs
  tell: WandererTell       // the subtle "this is AI" marker
  // verb-specific sealed params live SERVER-SIDE, re-derived from the seed
}
```

### 3.2 The subtle tell (decision: **subtle, honest, not hidden**)

Research is unambiguous: hidden player-impersonating bots are a trust landmine.
So Wanderers are visually player-grade but carry a small, consistent marker an
attentive player can read — e.g. a faint element-tinted ring + a tiny glyph in the
name badge (a "wanderer" mon), and on hover/click an explicit label ("Wandering
shinobi"). This is the difference between *living world* and *scam*. It also keeps
us clear of the legal surface (§8).

### 3.3 Naming (never impersonate a real player)

Names come from a generated shinobi-name space and are checked against the live
roster so a Wanderer can **never** reuse an existing player's exact name.
Impersonating a specific real player invites confusion and defamation complaints.

### 3.4 Placement & roster (seamless, deterministic, cheap)

- Roster seeded from `sector# + day-cycle` (you already have `lib/day-cycle`), so the
  *cast* of a sector is stable for a while and the world *refreshes on a believable
  clock* rather than randomly popping.
- Density is small (a handful per sector) and respects the existing on-screen entity
  budget + the `liteFx` / low-end-mobile gate. They share tile space with real
  players and sleepers — the tell keeps clicks unambiguous.

### 3.5 Movement — Wanderers walk; they are never stagnant (core pillar)

This is non-negotiable for the feel: a Wanderer must read as **another shinobi
moving through the sector**, not a pin stuck on a tile. The game already has exactly
the tool for it — **`SectorAvatar`**, the component that walks the *player's* own
avatar smoothly (6.5 tiles/sec, directional flip, footstep dust, walk-bob, contact
shadow). Wanderers render through that **same walking avatar**, so they move with the
identical life the player's character already has.

> Today, *other players* are drawn as static avatar dots (a deliberate bandwidth
> choice, since they're live presence on a capped roster). Wanderers are
> **client-generated and local**, so they cost no bandwidth to animate — meaning they
> can actually be **more alive than the other-player dots**, fully walking and
> reacting. (A later pass could revisit animating real players too.)

Three movement behaviors, all client-side and cosmetic:

1. **Patrol / wander (idle).** Each Wanderer follows a gentle, seeded path between
   waypoints in its area — strolling, pausing, glancing around — so a sector you walk
   into already feels *lived-in and in motion*. Seeded so it's deterministic and
   flicker-free, but the walk itself is just RAF interpolation like the player's.
2. **Approach (they come to you).** When you enter a Wanderer's notice radius it
   turns and **walks up to you** to start its thing — a bandit striding over to block
   the road, a merchant waving you across, a rival making a beeline. The encounter
   prompt opens when you actually meet, not on a far-off click.
3. **You approach them (you go to them).** You can also just walk to a Wanderer
   yourself; whoever closes the gap first, the meeting opens. Either direction works,
   so it never feels like waiting on a menu.

Wanderers **leash** to their area (they won't wander off the sector) and rotate out
on the day-cycle. Movement is **purely visual** — it changes nothing about rewards or
outcomes, which still run through the sealed server endpoints (§5). Perf: cap how many
animate at full detail at once and simplify distant ones, under the existing
`liteFx`/entity budget.

Because this is the pillar that sells "they feel like players," **the visuals-only
first slice (Phase 1) already has them walking and approaching** — not as a later
polish step.

---

## 4. The interaction set (two gives, three challenges)

Wanderers offer **five** interaction types in two families. All are
server-authoritative. The written archetypes + dialogue for each live in the
companion content doc, `docs/sector-wanderers-content.md`.

- **Gives** — *Gift* (§4.1) and *Quest* (§4.2): the wanderer hands you something.
- **Challenges** — the wanderer dares you into one of the game's three competitive
  systems: *Shinobi Duel* (§4.4), *Pet Coliseum* (§4.5), *Card Clash* (§4.6). Which
  mode a wanderer favors is part of its archetype.

Build order stays safest-first: **Gift → Quest → Shinobi-duel/rob → Pet duel →
Card clash** (see §11).

### 4.1 Gift + dialogue (Phase 2 — first slice)

Flow: click Wanderer → themed dialogue (reuse `visualNovel` UI) → it offers an
item / ryo / short buff.

Server safety (reuse `raid-start` pattern):
- `wanderer-encounter-start` re-derives the Wanderer from `(sector, slotId, day)`,
  **seals the gift** into a single-use token (5-min TTL, daily mint cap via atomic
  incr).
- `wanderer-report` consumes the token atomically, grants the **sealed** reward
  under `withKvLock(save, {failClosed:true})`, one claim per Wanderer instance.
- The reward is *never* read from the client body.

### 4.2 Unique quest (Phase 3) — a deep, randomly-rolling pool

Flow: a quest-giver Wanderer draws **one quest from a weighted pool** (gated by the
player's level band, world-state, and what's already active/done) and "hands" it to
the player. These are **multi-stage and hard** — boss-gated, often chaining a shinobi
duel with a pet or card challenge, several time-boxed, some with branches that change
the ending and the player's standing. Objectives ride existing trackers; rewards are
claimed through the existing `claim-mission` endpoint.

The full **quest book (6 quests + roll/weighting rules)** and the **bestiary of new
boss AI** they need are written out in `docs/sector-wanderers-content.md` §11–§12.

Server safety: add a `WANDERER_QUESTS` entry type to `api/missions/_mission-catalog.ts`
(server resolves id → sealed reward, enforces level/eligibility/daily cap, persists
under the save lock — same as combat/field/hunt missions today). **Stage state +
cooldowns live in the claim record**, and **stage advancement is server-verified** —
granted on a real objective (a duel KO via the PvP session, or a re-run pet duel),
never on a client "I did it." Card-match and travel/deliver steps may advance on
completion but **gate no large reward** (they aren't server-provable — §4.3). The big
reward always hangs on a verifiable step. New quest bosses are additive
`CreatorAi`-shaped entries (plan §2; `isBossAi`/`masterAi`/`hpFloorExempt`), the
server seals each fight's opponent (§5.1), so a hard quest can't be cheesed with a
weakened client opponent.

### 4.3 Challenge stakes scale with how verifiable the mode is (key design rule)

The three challenge modes differ in one way that **must** drive their economy: how
much the server can *prove* the outcome. That sets a hard ceiling on what each may
stake.

| Mode | Server can verify the outcome? | Safe economic ceiling |
|---|---|---|
| **Shinobi Duel** | **Fully** — combat resolves move-by-move on the server (`api/pvp/move.ts`) | **Highest** — real theft via ante + bounty (§5.2) |
| **Pet Coliseum** | **Yes** — the duel sim is deterministic; the server **re-runs it** from the sealed seed + rosters to confirm the result (`runPetDuel`) | **High** — sealed reward + optional ante, server-validated |
| **Card Clash** | **No** — hands are secret and the client engine uses `Math.random()`; not re-runnable | **Lowest** — small, daily-capped win reward; any stake is ante-only |

> **Rule of thumb: you can only put real money on an outcome the server can prove.**
> Card clash is the "for pride / standing / small purse" mode; the shinobi duel is
> the high-stakes mugging; the pet coliseum sits between, with real validation.

### 4.4 Shinobi Duel / Rob — the high-stakes challenge (Phase 4 — highest care)

The fiction: a rival/bandit Wanderer blocks your path — **Fight / Pay toll /
Intimidate / Bribe / Flee** (§8.1).

This is the verb that moves *real* currency on a loss, and the naive version is
exploitable. The safe design (decisions in §5):

1. **Combat = the existing PvP session.** Create a normal session with the player
   as `p1` and the Wanderer as the NPC `p2`. Combat resolves server-side
   (`api/pvp/move.ts`); the winner is server-owned. No new combat engine, no new
   battle UI — it's the same fight players already know.
2. **Theft = ante / escrow-and-forfeit, not post-loss deduction** (see §5.2).
3. **Bounty inversion (you mug them):** beating a Wanderer pays a **sealed** bounty
   (re-derived from the seed, throttled by daily caps + repeat-decay), modeled on
   `bounty.ts` claim + `sleeper-kill`'s capped grant.

### 4.5 Pet Coliseum challenge (Phase 5b)

A Pet-Tamer-flavored Wanderer leads with its beast. Flow: accept → the existing
**continuous pet duel** runs (`pet-duel-sim.ts`, behind `petDuelEngine.v1`), rendered
in the coliseum (`PetColiseum`). It's the same pet fight players already know.

Server safety (reuse `pet/ranked-start` → `pet/battle-result`, the verified pattern):
- `pet/wanderer-duel-start` re-derives the Wanderer's pet(s) and mints a token
  sealing the roster **+ the deterministic seed** (10-min TTL).
- `pet/wanderer-duel-result` requires the token, then the server **re-runs
  `runPetDuel(playerPet, wandererPet, seed)`** and pays the sealed reward only if the
  re-run agrees with the report — the outcome is *proven*, not trusted. Reward under
  the save lock, `reportKey` NX dedup, daily cap.
- **Casual PvE only** — it never touches the pet ranked rating (`petRankedRating`).
- Stakes: high (server-validated). Start reward-on-win; an ante is a safe later add.

### 4.6 Shinobi Card Clash challenge (Phase 5c)

A gambler/strategist Wanderer deals you in. Flow: accept → a **Card Clash** match
against a **fixed Wanderer deck** (`lib/card-clash.ts`, Card Hall UI).

Server safety (the card outcome is **not** server-verifiable — hands are secret, the
engine is non-deterministic):
- `card/wanderer-clash-start` writes a single-use match record sealing an
  **immutable Wanderer deck + the 3 locations** (snapshot at start, so the client
  can't swap the opponent or re-roll mid-match), short TTL.
- `card/wanderer-clash-result` is **single-phase** (the NPC can't dispute), deletes
  the record on use, and pays a **small, daily-capped** fixed reward under the save
  lock. Because a win can't be proven, the reward is deliberately low and the per-day
  cap tight; any *theft* on a loss is **ante-only** (debited at start).
- **Casual PvE only** — no clan-war HP, no ranked.

---

## 5. The anti-cheat spine (open decisions resolved here)

Two decisions were left for the owner. Per "do whatever makes sense for the future
of the game," they are resolved toward **integrity + seamlessness**:

### 5.1 Decision A — Rob fight difficulty: **server-sealed opponent (real stakes)**

> Chosen: the Wanderer's combat stats are **re-derived and sealed server-side**, not
> trusted from the client payload.

Why: a feature that takes real ryo must have real teeth. If the client supplies the
opponent, a player can send a 1-HP Wanderer and farm the win-reward / dodge the
risk — hollowing the whole mechanic. Sealing the opponent server-side is the
durable, "future of the game" choice.

Phased so it ships incrementally without a big-bang:
- **Phase 4a:** seal the *reward and the ante* server-side (bounds the exploit to,
  at worst, a capped daily reward). Opponent stats still come from the (clamped)
  client payload.
- **Phase 4b (hardening):** the session endpoint re-derives `p2` server-side for
  Wanderer fights from the sealed seed, so fight *difficulty* is authoritative too.
  This is the end state.

### 5.2 Decision B — "Real theft on loss": **ante / escrow-and-forfeit** (confirmed)

> The owner asked for *real theft on loss*. Delivered as an **ante**, because pure
> "deduct after you lose" is unenforceable.

The gap (found by reading the code): if ryo is deducted *after* a loss, the loser
controls whether the loss is ever reported — a cheater never calls the settlement
endpoint, or just abandons the tab and lets the 15-min session TTL expire. The
winner-claims model in `bounty.ts` / `claim-rewards.ts` works because the *winner*
is motivated; when the **NPC wins, no one is motivated to report the player's loss.**

The fix is your own existing pattern (`bounty.ts place` debits up front;
`raid-start` seals up front):

- **Engage** → server debits a **capped** stake into escrow immediately, under
  `withKvLock(save, {failClosed:true})`, sealed in a token.
- **Win** (server-verified via the real session) → stake returned + sealed bounty.
- **Lose or abandon** → stake forfeit.

The money moves at a moment the player cannot dodge. This delivers the *experience*
of "lose the fight, get robbed" while being fully cheat-proof, and it reuses a
pattern players already understand. **Flee** = no stake, no reward, small HP/stamina
or time cost. The stake cap is a small % of on-hand ryo, computed from a server
snapshot at engage-time.

### 5.3 The throttles (non-negotiable)

- Wanderer win-rewards and gifts plug into repeat-decay (`_reward-farm.ts`-style)
  **and** per-day caps keyed per player, or Wanderers become a ryo faucet.
- Single-use sealed tokens (5-min TTL) for every reward/theft path; idempotent
  settlement (NX key) so a retry can't double-pay or double-charge.
- Anti-alt IP/FP void already exists for player-vs-player paths; Wanderers are NPCs
  so collusion is less of a concern, but the per-player daily cap still bounds
  self-farming.

### 5.4 New attack surfaces introduced by the depth layer (§8)

- **Non-combat resolution is server-verified.** *Intimidate* checks the player's
  authoritative level/standing vs the Wanderer's sealed threshold server-side;
  *Bribe* / *Pay toll* is a real ryo debit under the save lock. The client never
  asserts "I intimidated them."
- **Rivalry state is server-authoritative.** `wandererRivals` is written only by the
  settlement endpoint from the verified session outcome — a client can't reset a
  rival to re-farm it, inflate a scar, or claim an un-fought revenge win.
- **No profession currency from AI.** Wanderers never grant Honor Seals (or any
  anti-farm-gated profession currency) — that stays human-PvP-only by design (§8.5).
- **VN payout fields are ignored.** Wanderer rewards come only from the sealed token
  endpoints (§10), never the `CreatorEvent` client-side reward fields (§8.6).

---

## 6. Economy & balance

- **Gifts/quests are faucets; robbery is a sink.** Tuned together, Wanderers can be
  roughly **net-neutral** on the ryo supply — a rare property worth preserving.
- All rates respect the existing PvE difficulty band curve (`lib/pve-difficulty.ts`)
  so a Wanderer's level/stats/reward match its sector, not a flat global value.
- Do **not** change any existing reward rate, drop odds, or combat formula — Wanderer
  rewards are *new, additive, and capped*, per the game-specific priorities.

---

## 7. Seamlessness hooks (make it feel native)

- **Day-cycle:** roster rotates on the real-clock day cycle; more bandits at
  "night," merchants by "day."
- **Biome:** Wanderer flavor + name + element lean on the sector biome (the same
  palette `SectorAvatar` / `SceneAmbience` already use).
- **Village / clan:** Wanderers can carry a village affiliation, and quest
  objectives can reference the player's clan/village so they read as in-world.
- **Dialogue is scripted/templated, NOT an LLM** (decision). Cheaper, deterministic,
  no moderation surface, no latency, and it sidesteps the chatbot-disclosure law and
  the mixed player reception LLM-NPCs get. Templates interpolate `%player`, sector,
  and biome for variety.
- **No new battle/screen chrome** — Wanderer fights are the existing PvP screen;
  gifts/quests are the existing visual-novel panel.

These are the table-stakes hooks; **§8 expands them into the depth layer** (rivals,
reactivity, reputation, choice-based resolution).

---

## 8. Research-driven upgrades (the depth layer)

The base plan (rob / gift / quest) works, but research into what makes encounter
systems *memorable* vs *grindy* surfaced upgrades that cost little to add and turn
Wanderers from a minigame into a living-world system. Each is grounded in an
existing codebase system so it stays seamless.

### 8.1 Encounter grammar: hook → meaningful choice → consequence

The #1 failure mode of random encounters is "click → fight → repeat." The fix
every source agrees on: an encounter should pose a **dramatic question**, offer a
**real choice**, and deliver a **consequence** ([Angry GM](https://theangrygm.com/redesigning-random-encounters-2/),
[Domain of Many Things](https://www.domainofmanythings.com/blog/random-encounters-not-random-chaos-a-gms-guide)).
So every verb gets *multiple resolutions*, not one button:

- **Rob:** *Fight / Pay toll / **Intimidate** / **Bribe** / Flee.*
- **Gift:** *Accept (and maybe owe a small favor) / Decline (and gain standing).*
- **Quest:** branching choices with different conclusions (the VN system already
  supports this — §8.6).

**Non-combat resolutions use the player's real build**, so stats matter outside
combat (intelligence/willpower/level/standing). This must be **server-verified**:
*Intimidate* succeeds only if the server (not the client) confirms the player's
authoritative level/standing clears the Wanderer's sealed threshold; *Bribe* is a
real, capped ryo **sink** debited under the save lock. No client-claimed success.

### 8.2 Recurring rivals — the nemesis loop (the headline upgrade)

The single best "future of the game" idea, and your engine already has the bones.
Shadow of Mordor's Nemesis System is beloved because enemies **remember** you,
**escalate**, and **reference past encounters**, producing self-authored revenge
stories no one scripted ([Wireframe](https://wireframe.raspberrypi.com/articles/killer-feature-shadow-of-mordors-nemesis-system-reinvented-npc-rivalries-for),
[Film Stories](https://filmstories.co.uk/features/killer-feature-shadow-of-mordors-nemesis-system-reinvented-npc-rivalries-for-the-better/)).
Your **bounty board** (`api/pvp/bounty.ts` / `_bounty.ts`) is explicitly described
in-code as "turns anonymous fights into grudges — the core small-population
retention hook." Wanderers can plug straight in:

- A Wanderer who **beats/robs you** becomes a named **rival**: it returns stronger,
  with a scar/grudge line ("You fled last time, leaf-rat"), and may **place a sealed
  bounty** on your head (rendered with an "AI Wanderer" badge on the existing public
  bounty board so it's honest, not disguised).
- A Wanderer you **beat/rob** can come back for revenge, or escalate to a "named
  bandit" mini-boss.
- Rivalry state is a small **additive save field** (`wandererRivals`: last outcome,
  scar tag, level bumps, next-escalation) — **server-authoritative** so a player
  can't reset a rival to re-farm it or fake "I beat my rival."

This is the mechanic that makes a low-population world feel alive even when few
humans are online — the reactive-worldbuilding lesson: *an NPC who reacts to you
reveals how the world perceives your actions* ([reactive worldbuilding](https://medium.com/@tomas.ca.garrett/beyond-the-basics-the-craft-of-reactive-worldbuilding-bb5c615e1ef6),
[low-pop MMO discussion](https://forums.mmorpg.com/discussion/457282/living-npc)).

### 8.3 Reputation / standing — the world treats you differently (optional depth)

There is **no** reputation system today, but kill-counts, Honor Seals, and
`hunterRank` exist (`types/character.ts`). A light **standing** layer (derived where
possible, plus a small additive field) lets Wanderers *react*: rob a lot → feared
(bandits respect you, merchants wary, higher tolls); help/spare them → trusted
(better gifts, friendlier dialogue, more quests). A working reputation system
"creates visible shifts in how the world treats you" ([Game Rant](https://gamerant.com/best-reputation-systems-open-world-games/)).
Scope guard: this is a **later** layer (it pays off game-wide, not just for
Wanderers) — seed it now via Wanderer outcomes, expand later.

### 8.4 Faction & war reactivity (villages, clans, territory)

Wanderers carry a **village/clan affiliation** at spawn and read live world-state
(`api/world-state.ts`: village wars, `SectorTerritory.ownerVillage/ownerClan`,
weather). During an active war they turn hostile to enemy-village players (forces a
rob/attack), friendlier to allies; they **spawn denser in contested/enemy sectors**
so wartime travel feels dangerous. Zero new infrastructure — it's reading systems
that already drive buffs/debuffs.

### 8.5 Profession-flavored Wanderers (with one guardrail)

Professions (`docs/professions.md`) make natural Wanderer archetypes: a **Healer**
Wanderer offers to patch you up; a **Pet Tamer** gifts pet food / an expedition
nudge; a **Vanguard** rival offers a duel. **Guardrail (anti-exploit):** Vanguard
**Honor Seals are deliberately gated to *human* PvP kills, not AI** — so a Wanderer
must **never grant Honor Seals** (or any profession currency that's anti-farm-gated).
Profession *flavor* yes; profession *currency* from an AI, no.

### 8.6 Reuse the visual-novel event system for rendering — but seal the rewards

The `CreatorEvent` `visualNovel` system (`App.tsx` CreatorEvent type, `data/vn-events.ts`)
already does multi-page dialogue, **branching choices, conditions, speaker art, and
embedded battles**. Wanderer encounters should render as VN events (a new
`trigger: "wandererEncounter"`), so we build **no new dialogue system**. **Critical
caveat:** the VN type carries client-side `xpReward/ryoReward/currencyRewards`
fields — Wanderer rewards must **bypass those** and route only through the
server-sealed token endpoints (§10). Reuse the VN *presentation/choice* layer; never
its client-applied payout.

### 8.7 Curated, weighted rosters — not truly random

"Random" should mean *curated and weighted by context*, not uniform noise
([Angry GM Part 1](https://theangrygm.com/redesigning-random-encounters-1/)). The
seed picks from hand-authored Wanderer **archetype tables** weighted by sector,
biome, player level band (`lib/pve-difficulty.ts`), time of day, and world-state.
Repeat encounters **change their starting conditions** (the rival escalates, brings
a friend, references last time) so they never read as copy-paste.

### 8.8 On LLM dialogue — keep it scripted (with an honest footnote)

One MMO (Aetolia) wired NPCs to an LLM and players enjoyed guards *reacting* to
them; but LLM-NPC games also draw mixed-to-negative reactions and moderation
headaches ([PC Gamer](https://www.pcgamer.com/games/rpg/wuxia-mmo-where-winds-meet-is-full-of-ai-chatbot-npcs-and-people-are-doing-all-the-standard-obscene-stuff-to-them-i-made-him-think-that-my-character-was-pregnant-with-his-child/)).
Decision stands: **scripted/templated dialogue is the spine** — deterministic, free,
moderation-free, and it dodges the chatbot-disclosure law. An optional, clearly-
labeled, opt-in LLM "bark" layer could be a *far-future* experiment, never the core.

---

## 9. Trust, ethics & legal

- **Honest by design.** The subtle tell + explicit "Wandering shinobi" label convert
  this from the "hidden bot" failure mode (documented backlash: "automatically
  trash," "a scam") into the Erenshor success mode (loved *because* it's transparent).
- **Never impersonate a real player** (§3.3).
- **Legal:** California's bot-disclosure law (SB 1001) targets bots that incentivize a
  *real-money sale/transaction* without disclosure; the 2026 companion-chatbot law
  (SB 243) **explicitly exempts video-game NPCs** that stay on-topic. We're clear —
  the guardrail is simply: **Wanderers transact only in the in-game economy; they
  never push real-money premium-currency sales.**

---

## 10. Architecture & endpoints

### 10.1 Spawning model (hybrid: cheap visuals, authoritative rewards)

- **Visuals: client-deterministic.** Generate the per-sector roster on the client
  from `sector# + day` — no DB, no cron, no presence/heartbeat (Wanderers aren't
  online players).
- **Rewards: server re-derives the same roster** from the same seed function (ported
  server-side) so it can seal stats/rewards independently. The server *never* trusts
  "Wanderer X existed and I beat it" — it re-derives X and gates on caps + sealed
  token + the server-verified session outcome.

### 10.2 New endpoints

Each must be **created in `api/` AND `route()`-registered in `server.ts` on both the
bare and `/api`-prefixed path** (no auto-routing). CORS headers stay synchronized
between `api/_utils.ts` and `server.ts`.

- `api/sector/wanderer-encounter-start.ts` — re-derive Wanderer; mint a single-use
  token sealing `{slotId, sector, verb, reward, anteStake}`. For `rob`, debit the
  ante into escrow here under the save lock.
- `api/sector/wanderer-report.ts` — consume token atomically; for gift, grant sealed
  reward; for the shinobi duel, settle against the real `PvpSession` (return stake +
  bounty on win; the forfeit already happened at engage). All under
  `withKvLock(..., failClosed)`.
- `api/pet/wanderer-duel-start.ts` + `api/pet/wanderer-duel-result.ts` — pet-coliseum
  challenge. Start mints a token sealing the Wanderer roster **+ deterministic seed**;
  result requires the token and the server **re-runs `runPetDuel` to verify** before
  paying the sealed reward (save lock, `reportKey` NX dedup, daily cap). Casual only —
  never `petRankedRating`. (Mirrors `api/pet/ranked-start.ts` → `api/pet/battle-result.ts`.)
- `api/card/wanderer-clash-start.ts` + `api/card/wanderer-clash-result.ts` — card
  challenge. Start writes a single-use match record sealing an **immutable Wanderer
  deck + 3 locations**; result is single-phase (NPC can't dispute), deletes the
  record, and pays a small daily-capped reward under the save lock. Outcome is not
  server-verifiable, so stakes stay low (§4.3, §4.6).
- Quest path: **reuse `api/missions/claim-mission.ts`** + the `WANDERER_QUESTS`
  catalog extension (no new reward endpoint).

### 10.3 Client

- Extend the sector tile-render loop in `WorldMap.tsx` to draw Wanderers via the
  existing avatar look + the tell.
- A small interaction modal (dialogue / fight entry / quest accept), behind a
  default-off flag (e.g. `wanderers.v1`), following the other sector-feature flags.
- `authFetch.ts` attaches auth automatically; new screens/components go in their own
  modules under `src/{screens,components,lib,data}` — **not** App.tsx (it's at its
  size ratchet ceiling).

---

## 11. Phased rollout (flag-gated, incremental)

The base loop (Phases 0–4) ships first and is fully playable on its own. The extra
challenge modes (5a/5b) and the depth layer (6–9) are what make it a living-world
system — each independently shippable behind its own flag, nothing a big-bang.

**Base loop**
- **Phase 0 — design lock & content prep.** Curate the avatar pool (reuse existing
  player art → ~$0), the name generator + reserved-namespace check, the tell style,
  and the seed/roster function (shared client+server).
- **Phase 1 — visuals + movement.** Render player-looking Wanderers with the tell,
  **walking the sector via `SectorAvatar`** — patrolling on a seeded path and
  **approaching the player** (and the player can approach them); meeting opens a
  dialogue-only encounter, **no rewards** yet. Proves the "they feel like players,
  and they're not stagnant" feel with zero economy surface (§3.5).
- **Phase 2 — Gift + dialogue (with choice).** Sealed-token gift via
  `wanderer-encounter-start` → `wanderer-report`, rendered through the VN system with
  an accept/decline choice. First reward slice.
- **Phase 3 — Unique quest (branching).** `WANDERER_QUESTS` + `claim-mission`, with
  VN branching choices. Mostly content.
- **Phase 4a — Rob (reward + ante sealed).** Reuse PvP session; ante/forfeit escrow;
  sealed bounty on win. Resolutions: Fight / Pay toll / Flee.
- **Phase 4b — Rob hardening + Intimidate/Bribe.** Server-seals the opponent stats
  (real difficulty); add the server-verified non-combat resolutions (§8.1, §5.4).

**Challenge modes** (each its own flag; ship after the rob loop is proven)
- **Phase 5a — Pet Coliseum challenge.** `pet/wanderer-duel-start` →
  `pet/wanderer-duel-result` with server re-run verification (§4.5). Reuses the
  coliseum the player already knows.
- **Phase 5b — Card Clash challenge.** `card/wanderer-clash-start` →
  `card/wanderer-clash-result`, fixed Wanderer deck, low capped stakes (§4.6).

**Depth layer**
- **Phase 6 — Reactivity & flavor.** Faction/war reactivity (§8.4), profession
  archetypes (§8.5), curated weighted rosters + escalating repeat conditions (§8.7),
  day-cycle patrols.
- **Phase 7 — Recurring rivals (nemesis loop).** `wandererRivals` state, escalation,
  scar/grudge dialogue, and the AI-badged bounty-board integration (§8.2). This is
  the retention centerpiece — and rivals can challenge in *any* of the three modes.
- **Phase 8 — Reputation / standing (optional, game-wide).** The standing layer
  (§8.3), seeded by Wanderer outcomes; worth doing as its own system since it pays
  off beyond Wanderers.
- **Phase 9 — polish.** Richer movement flavor (idle glances, group patrols,
  biome-specific gaits), extra FX behind `liteFx`, mobile pass. (Core walking +
  approach already shipped in Phase 1 — §3.5.)

Each phase: default-off flag, additive, save-safe. `npm test` from root for any
`api/`/`server.ts` change; `npm run lint` in `shinobij.client/` for frontend; rebuild
+ commit `dist/` for backend changes (cPanel serves committed `dist/` verbatim;
Railway self-builds).

---

## 12. Remaining owner calls (small)

The big decisions are resolved (§5, §8). What's left is tuning, safe to set during
build and adjust live:

- Stake-cap % and per-day Wanderer-encounter caps (start conservative).
- Wanderer density per sector and day-cycle weighting.
- Whether `gift` rewards are ryo-only at first or include items/buffs.
- How far to take the rival nemesis loop (a light "they come back stronger once" vs
  a full escalating hierarchy) — start light, expand if it lands.
- Whether the reputation/standing layer (Phase 7) is in scope for v1 or deferred.

---

## 13. Risks

- **Trust:** mitigated by the honest tell + scripted dialogue + no-impersonation rule.
- **Economy:** mitigated by caps + decay + faucet/sink balance; change *no* existing
  rates.
- **Farm-the-win exploit:** closed by Phase 4b opponent-sealing; bounded by caps
  before then.
- **Render budget:** small density + `liteFx` gate; reuse existing avatar path.
- **Scope creep (the real risk now that depth is in scope):** the depth layer is
  genuinely valuable but it's where a "small feature" becomes a quarter of work. The
  phasing is the mitigation — Phases 0–4 stand alone and ship a complete loop; the
  challenge modes (5a/5b) and depth layer (6–9) are opt-in increments, each behind
  its own flag, none required for the base feature to be good.
- **Rivalry state bloat:** cap `wandererRivals` (e.g. a handful of active rivals,
  oldest evicted) so the save field can't grow unbounded.

---

*Companion references: `docs/auth-and-anti-cheat-patterns.md` (the safety model this
plan rides on), `lib/pve-difficulty.ts` (the band curve), `lib/day-cycle` (the
roster clock).*
