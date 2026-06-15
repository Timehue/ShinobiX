# Gameplay Systems Depth Audit & Gap-Fill Plan — 2026-06-09

A whole-game audit of every major gameplay system, scoring how *deep* each one
is today and laying out an incremental plan to fill the shallow spots. Researched
across the codebase plus genre peers (shinobi browser RPGs, PBBGs, ARPGs,
guild-war & monster-taming games). **Companion to** the existing design docs
(`professions.md`, `early-progression.md`, `competitor-early-game.md`).

> **Constraint reminder (from CLAUDE.md):** the game is **live with real player
> saves**. Everything below is framed as **additive** content/systems. Do **not**
> retune existing reward rates, rarity odds, AP costs, cooldowns, or payouts for
> existing players as part of "filling gaps." New reward paths must be
> **server-authoritative** (recompute or mint-token, never trust the client).
> Schema/storage changes need explicit approval.

---

## 1. Executive summary

The game is **mechanically rich but content-thin in repeatable depth**. The
moment-to-moment engines (ninja combat, the pet battle sub-game, the clan-war
loop) are genuinely deep and well-secured. What's shallow is almost everywhere
the same three things:

1. **No long-term "seasons & ladders" frame.** Nothing competitive resets or
   pays out over time — PvP ranked, pet ranked, clan war, and village war are all
   one-off or never-resetting. This is the single biggest retention gap.
2. **Low content variety on top of solid plumbing.** ~18 reused enemy AIs power
   *all* PvE; missions are one reskinned mechanic; expeditions are three timers;
   the weekly boss is a tap-race. The systems work — they just don't vary.
3. **Built-but-dormant systems sitting unused.** A fully-scaffolded clan upgrade
   tree is inert; 49 achievements pay nothing; territory and the village-war loop
   barely touch each other. *(Update 2026-06-15: the server-authoritative
   pet-ranked ladder — originally listed here as "unwired on the client" — is now
   wired: PetArena.tsx → /api/pet/ranked-start + /api/pet/battle-result.)*

### Depth scorecard

| System | Sub-system | Verdict |
|---|---|---|
| **Core combat** | Turn engine (hex/AP/positioning) | 🟢 DEEP |
| | Status-tag system (~32 tags) | 🟢 DEEP |
| | Jutsu catalog variety | 🟡 MEDIUM |
| | Bloodlines (combat identity) | 🟡 MEDIUM |
| | Stat-training / character build | 🟡 MEDIUM |
| | Awakening / elements | 🔴 SHALLOW |
| **Clans / clan war** | Clan war loop | 🟢 DEEP |
| | Membership / roles | 🟡 MEDIUM |
| | Clan economy (treasury / seal pool) | 🟡 MEDIUM |
| | Clan progression / identity | 🔴 SHALLOW |
| | Clan co-op PvE content | 🔴 SHALLOW |
| **Village war** | Village-vs-village war loop | 🟡 MEDIUM |
| | Kage / politics | 🔴 SHALLOW |
| | Village guard / defense | 🔴 SHALLOW |
| | Territory & map control | 🔴 SHALLOW |
| | Village upgrades / identity | 🔴 SHALLOW |
| **PvE content** | Hollow Gate dungeon | 🟡 MEDIUM |
| | Hunting / overworld | 🔴–🟡 SHALLOW–MED |
| | Endless Tower | 🔴 SHALLOW |
| | Weekly boss (mechanics) | 🔴 SHALLOW |
| | Enemy variety / bestiary | 🔴 SHALLOW |
| **Missions / professions** | Vanguard profession | 🟢 DEEP |
| | Profession plumbing (auth/anti-cheat) | 🟢 DEEP |
| | Hunter Guild | 🟡 MEDIUM |
| | Healer profession | 🟡 MEDIUM |
| | Gameplay missions / Mission Hall | 🔴–🟡 SHALLOW–MED |
| | Pet Tamer profession | 🔴–🟡 SHALLOW–MED |
| | Daily profession missions | 🔴 SHALLOW |
| | Expeditions | 🔴 SHALLOW |
| | AI raids (as content) | 🔴 SHALLOW |
| **Pets** | Battle sub-game | 🟢 DEEP |
| | Progression (level/train) | 🟡 MEDIUM |
| | Expeditions | 🟡 MEDIUM |
| | Pet ↔ main-game integration | 🟡 MEDIUM |
| | Acquisition / collection | 🔴 SHALLOW |
| | Ranked / arena | 🔴 SHALLOW (dormant) |
| | Breeding / evolution / fusion | ⚫ ABSENT |
| **Economy / endgame** | Crafting | 🟡 MEDIUM |
| | Item / equipment | 🟡 MEDIUM |
| | Leaderboards | 🟡 MEDIUM |
| | Maxed-player loops | 🟡 MEDIUM |
| | Currencies & sinks (inflationary) | 🔴 SHALLOW |
| | PvP ranked ladder | 🔴 SHALLOW |
| | Achievements (no rewards) | 🔴 SHALLOW |
| | Player trading / market | ⚫ ABSENT |

---

## 2. Force multipliers — fix these first

Six cross-cutting levers each deepen *multiple* systems at once. Prioritize these
over any single-system feature.

### FM-1 — A shared "Seasons & Ladders" framework
**Touches:** PvP ranked, pet ranked, clan war, village war, leaderboards.
Build **one** reusable seasonal concept — soft rating reset (compress toward
baseline), named tiers, a season-end reward table keyed to peak tier, and an
authoritative leaderboard — then apply it to all four competitive systems. Right
now none of them reset or pay out over time, so the ladders ossify and there's
nothing to climb *toward*. This is the highest retention leverage in the whole
audit. *(Peers: ranked seasons/tiers/decay/rewards are universal — League,
Apex, Hero Wars guild seasons, GW2 WvW 2-week seasons, Tacticus 6-wars/season
leagues.)*

### FM-2 — Enemy variety: elite affixes + a bestiary
**Touches:** hunting, Hollow Gate, Endless Tower, explore — *all* PvE at once.
Nearly every PvE system reuses the same ~18-AI pool filtered by level. Two
additive changes multiply perceived depth everywhere:
- **Elite affixes** — roll modifiers (Shielded, Regenerating, Venomous, Berserk,
  etc.) onto elite/boss encounters, reusing the existing combat-tag system.
- **A bestiary screen** built off the *already-saved* `defeatedAiIds`, with
  kill-count tiers, lore, and drop info (and optionally a small per-type combat
  bonus). *(Peers: D3/D4 elite affixes; PoE map modifiers; Terraria/Diablo
  Immortal bestiaries.)*

### FM-3 — Turn on dormant systems
**Touches:** clans, pets. Cheapest wins in the audit — the code already exists.
- **Clan upgrade tree** is fully scaffolded (`types/clan.ts`, `clan-math.ts`) but
  inert: no purchase UI, and `clanUpgradeBonus` wires only two of seven
  buildings. Add a purchase endpoint (treasury / war-supply sink) + real
  per-building effects.
- **Pet ranked ladder** is server-authoritative and built (`api/pet/ranked-start.ts`
  says so explicitly) but **never called by the client**. Finish the client call
  and layer on FM-1's tiers/seasons.

### FM-4 — Reward hooks on existing scaffolds
**Touches:** achievements, map control, village defense. Several systems already
*track* the right data but pay nothing.
- **49 achievements** evaluate on every grant pass but award zero — attach a
  one-time payout (currency / title / cosmetic) to each.
- **Successful village defense** is unpaid AFK risk today — pay queued guards who
  repel a raid.
These are near-zero new systems; they just connect existing triggers to rewards
(server-authoritative, daily-capped).

### FM-5 — An elemental advantage triangle in main combat
**Touches:** all ninja combat, village/element choice, loadout building.
The **pet** battle sub-game already has a 5-element type chart
(Fire>Wind>Lightning>Earth>Water>Fire, ×1.25/×0.80). The **main** combat does
not — element is cosmetic + an access key with a near-zero weather modifier.
Drop a single `elementMatchupMultiplier()` into the existing `weatherMult` slot
in `calculateDamage` (mirror it in `api/pvp/move.ts`, add to the parity test).
Instantly makes all 5 elements matter. *Highly balance-sensitive — tune small.*

### FM-6 — Real currency sinks (economy health)
**Touches:** the whole economy. Seven currencies, many faucets (including a bank
that *generates* ryo daily), and thin sinks → stockpiling/inflation. Add sink
verbs: a sell/market tax, a gear-repair or named-forge re-roll cost, achievement/
prestige cosmetic sinks. Pairs naturally with FM-1 (season cosmetics) and the
gear-upgrade loop below. *(Peers: AH cuts are among the largest MMO sinks; PoE
currency-as-crafting; Albion global discount.)*

### Structural decision to make early
**Territory is clan-scoped; war is village-scoped — they barely interact.** The
single highest-leverage design call is whether to **promote territory to a true
village asset** (held sectors buff the whole village; collected `warSupply`
funds/repairs wars — a real logistics loop) or keep the two metagames separate.
Most village-war fill-out ideas branch off this choice, so decide it before
Phase 3.

---

## 3. Per-system gap analysis & fill-out

Each section: what's there, where it's thin, and the prioritized additive ideas.
Effort **S/M/L**; ⚠️ marks balance-sensitive items.

### 3.1 Core combat / jutsu / bloodlines
**Deep:** hex-grid AP engine with positioning/range/AOE/push-pull; ~32-tag status
system with stacking rules and prevents/counters. **Thin:** elements are
cosmetic; bloodlines are a flat damage % + element access (no unique identity);
jutsu are template-uniform (60AP-damage or 40AP-2-tag shells, fixed cooldown 7);
free auto-respec removes build commitment.

- **High** — Elemental advantage triangle (FM-5). *M, ⚠️*
- **High** — Bloodline passive identities: one small always-on passive per rank
  (e.g. "+X% Wound cap", "Poison ticks +1 round") as a data field applied at
  existing status sites. Turns a number into a playstyle. *M, ⚠️*
- **High** — Combo/weakness action-economy: landing into an Ignition/IDT window
  refunds a little AP or shaves the next cooldown — rewards burst setups. *M, ⚠️*
- **Med** — Break jutsu out of the uniform shell: add 2–3 AP/cooldown archetypes
  (cheap spammable, big long-cooldown nuke) so loadouts have tradeoffs. *S–M, ⚠️*
- **Med** — Gear→discipline/element synergy: a "+X% to [discipline/element]
  damage" item bonus summed in the existing item-mult path. *S–M, ⚠️*
- **Med** — Meaningful tiles: 1–2 terrain types (hazard chip damage, high-ground
  +range) on the hex grid we already pay for. *M, ⚠️*
- **Low** — Awakening as progression (choose/re-roll element, a 3rd tier) instead
  of one random roll. *S*

### 3.2 Clans & clan war
**Deep:** the clan-war loop — five challenge modes, full 2v2 queues, anonymity,
two-phase + PvP-session anti-cheat, a complete server-side Triple-Triad tile-card
game, MVP, timeout finalize. **Thin:** clan progression/identity (level feeds
only a cosmetic hall tier; the whole building-upgrade tree is dormant; "boosts"
are just roster-count); near-closed economy (warSupply has no sink, seal pool is
a closed Vanguard loop); no clan leaderboard/seasons; no co-op content.

- **High** — Activate the dormant clan upgrade tree (FM-3): purchase endpoint +
  real per-building effects (warRoom → clan-war HP or shorter challenge cooldown;
  medicalWing → member regen; blacksmith → gear discount). Gives treasury/
  warSupply a real sink. *M, ⚠️*
- **High** — Clan-war seasons + clan leaderboard (FM-1): aggregate existing
  per-war results/MVP/lifetime-damage into season standings + a global clan rank
  with end-of-season crates. *M, ⚠️*
- **Med** — War-prep / defense-lineup phase: let the defender pre-set rosters or a
  war plan in a prep window (defender play is purely reactive today). *M–L, ⚠️*
- **Med** — Broaden seal-pool & warSupply sinks: let any clan currency fund the
  pool; add clan-scoped purchases (war crates, temp clan buffs). *S–M, ⚠️*
- **Med** — Clan identity fields: description/motto, alliance & rivalry tags
  (rivalry could grant a small bonus vs a tagged rival). *S–M*
- **Low** — Unify or clearly document the two parallel rank systems
  (contribution "Clan Head/Elder…" vs role "Founder/Leader/Officer…"). *S*
- **Low** — Instanced clan co-op: promote the passive "defeat raid bosses"
  counter into a real shared-HP clan boss. *L, ⚠️ (defer)*

> ⚠️ Clan-war reward distribution is currently **client-computed**
> (`App.tsx:1442-1538`). Any new clan reward must follow the
> mint-token/recompute pattern, not extend the client-trust path.

### 3.3 Village war & territory
**Medium:** a real declare→raid→tug-of-war→end loop with server authority,
role-scaled contribution, decay, MVP, and crates. **Thin:** it's one shared HP
bar in a single war-ground sector; the Kage is a permanent liberation unlock
(no election/term/vote); village guard is an AFK queue with no rewards; "village
upgrades" are actually **per-character** buffs unrelated to the village; villages
differ only in lore prose; no alliances/diplomacy; map control gives only a flat
personal daily currency drip.

- **High** — Held territory buffs the whole village (DAoC Relic model): village
  sector count grants a shared passive, surfaced on the village screen. Turns map
  control into a strategic stake. *M, ⚠️*
- **High** — Convert `warSupply` into a real war sink (logistics loop): spend it
  to subsidize war declaration, repair the war-ground, or buy temp war buffs.
  Closes a dangling resource. *M, ⚠️*
- **High** — Kage term + lightweight re-confirmation (weekly-championship model):
  after N days the seat opens to a challenge window or contribution vote, with
  optional anti-incumbency fatigue. *L, ⚠️ (flag-gated)*
- **Med** — Reward successful defense (FM-4): pay queued guards + treasury when a
  raid is repelled. *S, ⚠️*
- **Med** — Village mechanical identity from lore theme: map each village's
  theme to one tiny passive (e.g. one +offense, one +defense). *S–M, ⚠️*
- **Med** — Village-wide build track (distinct from per-character upgrades):
  Walls/Barracks/Watchtower funded from treasury by Kage/ANBU — a collective goal
  + treasury sink. *L, ⚠️*
- **Med** — War seasons / recurring war ladder (FM-1). *M*
- **Low** — Per-sector identity (names + small yields) so captures are
  deliberate. *M, ⚠️*
- **Low** — Stand up the missing `/api/village/war/declare` route the code
  comments reference, or remove the dead ref (declarations overload
  `/api/world-state` today). *S*

### 3.4 PvE content (hunting / dungeons / tower / boss)
**Medium:** Hollow Gate (fog-of-war, tile variety, themes, traps, key-locked
doors). **Thin:** only 5 floors / 3 layouts, no run modifiers/affixes/branching;
Endless Tower is content-flat (identical 1v1 each wave, no affixes/leaderboard);
the weekly boss is an HP-less tap-race with no phases (and admin-gated spawn, so
not reliably weekly); hunting is "walk to fixed sector, click N, fight one scaled
AI"; explore is a flat-odds slot machine; ~18 AIs power everything.

- **High** — Bestiary off `defeatedAiIds` (FM-2) with kill-count tiers/lore/drops.
  *M, ⚠️ (combat bonus — start tiny/cosmetic)*
- **High** — Hollow Gate run modifiers ("Seals/Curses"): roll 1–2 risk/reward
  modifiers at run start, shown before entry. *M, ⚠️*
- **High** — Endless Tower global leaderboard (FM-1): persist `endlessTowerBestWave`
  server-side, surface in Hall of Legends. *M*
- **Med** — Elite-tile affixes in Hollow Gate (FM-2). *M, ⚠️*
- **Med** — Endless Tower stacking debuff + breakpoint chests (every 25/50). *S–M, ⚠️*
- **Med** — More Hollow Gate layouts + a 2nd dungeon boss (append ASCII strings;
  add one `isBossAi`). *S*
- **Med** — Hunt rare-spawn / "Apex" variant with bonus drops. *M, ⚠️*
- **Low** — Weekly-boss soft phases + auto-spawn on ISO-week rollover. *M, ⚠️*
- **Low** — Per-biome enemy pools so the 5 biomes feel distinct (FM-2). *S*

### 3.5 Missions, expeditions & professions
**Deep:** profession plumbing (token-first, server-authoritative, full
anti-cheat) and the **Vanguard** identity (PvP kills + raids + 3 currency sinks +
clan donation pool). **Thin:** all 28 profession dailies are the same "tally N
actions" shape with XP-only rewards; gameplay missions are one mechanic
(`fetchExplore`) reskinned ~20 times ("Escort"/"Patrol" are cosmetic labels);
**zero built-in raids** (admin-only — empty on a fresh server); expeditions are
3 fixed timers with no risk/choice; Healer and Pet Tamer lean on multipliers more
than unique verbs (Pet Tamer is largely passive).

> **Note:** the profession *spec* (`professions.md`) is essentially fully built —
> Pet Tamer Phase 2 is even *ahead* of the doc. The gap here is **content
> variety**, not missing mechanics.

- **High** — Expedition variety: risk tiers + a choice/outcome at collect (e.g.
  "Dangerous Ruins" — higher rare-drop rate but a chance to return wounded).
  Keep within the existing token-sealed payout; add variance, not expected value.
  *M, ⚠️*
- **High** — Diversify the daily-mission pool with new `MissionKind`s that tap
  existing systems ("complete 2 hunts", "win a Tower floor", "train a pet"). The
  anti-fatigue fix. *M*
- **High** — Ship a starter set of built-in `CreatorRaid`s (4–6, D→S), mirroring
  `builtinHuntMissions` — the raid surface is coded but empty. *S–M, ⚠️*
- **Med** — Weekly profession objectives + a login streak/milestone meter over
  the dailies (capped, non-exclusive rewards). *M, ⚠️*
- **Med** — Capstone Rank-10 "permanent verb" for Healer & Pet Tamer (not just a
  multiplier): e.g. Healer AoE ward once/day; Pet Tamer 5th expedition slot or a
  guaranteed weekly rare dig. *M, ⚠️*
- **Med** — Real mission archetypes beyond `fetchExplore` (true escort = protect
  modifier; fetch = collect drops; branching-choice mission). *L, ⚠️*
- **Low** — Tappable expedition log; longer runs roll rarer flavor. *S*
- **Low** — Tie mission D→S to an in-world promotion arc, not pure level-gating. *M*

### 3.6 Pets
**Deep:** the battle sub-game — 14×7 grid, BFS/LoS/cover, ~22 move kinds, 16
statuses, scored AI, 7 archetypes, type chart, 1v1+2v2 (the 166 KB sim is the
largest file in the repo). **Thin:** acquisition (only random "befriend" + 5
starters; 5-slot cap with destructive release, no box); per-rarity hard stat caps
make same-species pets converge (no IV/EV variance); **no breeding/evolution/
fusion at all**; the ranked ladder is built server-side but **dormant** on the
client; no collection/dex bonus.

- **High** — Wire the dormant pet-ranked ladder (FM-3) + add tiers/seasons
  (FM-1). Finished-but-invisible system; lowest-risk highest-yield. *M, ⚠️*
- **High** — Pet evolution/ascension: let a maxed standard/rare pet ascend to the
  next tier's cap (consuming dupes/treats) so early pets stay relevant. *M–L, ⚠️*
- **High** — Per-pet stat variance ("Potential", Coromon-style grindable — not
  RNG) so same-species pets differ and training has a target. Flag-gate so live
  pets default neutral. *M, ⚠️*
- **Med** — Breeding **or** fusion (pick one): fusion (Cassette Beasts model)
  reuses 140 species combinatorially as a long-tail goal. *Big new system —
  needs approval.* *L, ⚠️*
- **Med** — Non-destructive storage box (active 5 + reserve) to kill the
  destructive-release pain. *S–M (schema touch — needs approval)*
- **Med** — Collection/dex completion bonuses (own N species / element set). *S*
- **Low** — Expedition risk/failure tiers with rare pet-egg/shard payouts. *S–M, ⚠️*
- **Low** — Shiny/variant axis (cheap as a tint, expensive as new art). *S–L*
- **Low** — Hand-craft signature kits for the 100 procedural pets. *M, ⚠️*

### 3.7 Economy, items & endgame meta
**Medium:** crafting (unified craft-point pool + a randomized Named forge),
~160 items with 6 mechanically-distinct armor sets. **Thin:** every shop/dropped
item is deterministic (no affixes/random rolls/item levels/sockets); no
upgrade/enchant/reforge of existing gear (only craft a fresh copy); 7 currencies
with many faucets and few sinks (the bank *adds* ryo daily) → inflation; **no
player trading/market**; ranked is a raw never-resetting Elo with no tiers/
seasons/rewards; 49 achievements pay nothing; leaderboards are client-side top-10
slices; a maxed level-100 player hits a fixed gear ceiling with no prestige.

- **High** — Ranked seasons + tiers + end-of-season rewards (FM-1). The Elo
  plumbing exists; this is UI + a soft-reset cron + a rewards table. *M, ⚠️*
- **High** — Attach rewards to achievements (FM-4): one-time payouts on the 49
  existing predicates. *S, ⚠️ (mild)*
- **High** — Real currency sinks (FM-6): sell/market tax, gear-repair or
  forge-reroll cost, prestige cosmetics; audit the bank faucet. *M, ⚠️*
- **Med** — Gear upgrade/enchant loop on *existing* items (spend craft points to
  add +levels or re-roll a tag) — an item chase without new item data. *M, ⚠️*
- **Med** — Constrained player market / consignment board (server-authoritative,
  taxed, `withKvLock`) — high value + a sink, but largest surface + RMT risk;
  gate to non-premium gear first. *L, ⚠️ (needs approval)*
- **Med** — Post-cap prestige axis (paragon-style capped horizontal points from
  overflow XP) so "maxed" ≠ "done", without raising the power ceiling. *M, ⚠️*
- **Low** — Server-authoritative global leaderboards (show the viewer's own rank
  outside top 10). *M*
- **Low** — Item rarity/affix variance on *dropped* (not shop) gear — prototype
  PvE-only first. *L, ⚠️ (highest balance risk)*

---

## 4. Phased roadmap

Sequenced by value-per-risk. Each phase is shippable on its own.

### Phase 1 — Activate & connect (low effort, low risk, fast visible value)
Turn on what already exists and attach rewards to existing triggers.
- Activate the clan upgrade tree (FM-3).
- Wire the pet-ranked ladder client call (FM-3).
- Achievement reward payouts (FM-4).
- Bestiary screen off `defeatedAiIds` (FM-2).
- Reward successful village defense (FM-4).
- More Hollow Gate layouts + a 2nd boss; per-biome explore pools (FM-2).
- Server-authoritative global leaderboards; Endless Tower leaderboard.
- Clan identity fields (motto/description/rivalry tags).
- Built-in `CreatorRaid` starter set.
- Clean up the dead village-war `declare` route reference.

### Phase 2 — Seasons & ladders framework (medium effort, highest retention)
Build FM-1 once, apply everywhere.
- Shared season concept: soft reset + named tiers + end-of-season reward table.
- Apply to: PvP ranked, pet ranked, clan war, village war.
- Pair with FM-6 sinks (season cosmetics) and achievement titles.

### Phase 3 — Depth & variety layers (medium effort, balance-sensitive)
Make the deep engines vary and the shallow loops decide.
- Elemental advantage triangle (FM-5); bloodline passives; combo action-economy.
- Hollow Gate run modifiers + elite affixes; Endless Tower stacking debuff +
  breakpoint chests.
- Expedition risk/choice variety; new mission kinds + weekly objectives;
  Healer/Pet-Tamer capstone verbs.
- Gear upgrade/enchant loop; currency sinks (market tax, repair).
- Pet evolution/ascension + per-pet Potential variance.

### Phase 4 — Big new systems (large effort, need explicit approval / schema)
Decide the territory↔village structural question first.
- Territory→village unification + warSupply logistics loop.
- Kage term/re-election; village-wide build track.
- Player market / consignment shop.
- Pet breeding/fusion; pet storage box.
- Clan instanced co-op (clan boss/raid).
- Post-cap prestige axis; dropped-gear affix loot (PvE-first prototype).

---

## 5. Guardrails (do not violate while filling gaps)

- **Additive only** for existing players — no retuning live reward rates, rarity
  odds, AP costs, cooldowns, or payouts under the banner of "depth."
- **Server-authoritative rewards** — every new currency/XP/item path recomputes
  server-side or uses the mint-token pattern (`docs/auth-and-anti-cheat-patterns.md`).
  Note the clan-war reward path is still client-computed — don't extend it.
- **Shared-state writes** (treasury, seal pool, war HP, territory, market) go
  through `withKvLock` with `failClosed` on currency paths.
- **Schema/storage changes need approval** — flagged on every Phase-4 item and on
  the pet storage box / per-pet variance fields.
- **Balance-sensitive systems** (jutsu, bloodlines, pets, PvP, ranked, guard,
  missions, professions, economy) change behind small, capped, flag-gated deltas;
  mirror any combat-formula change into `api/pvp/move.ts` and the parity test.
- **Don't touch** avatars or the storage-routing rules; rebuild + commit `dist/`
  for any cPanel-bound change.

---

## Appendix — peers referenced

Seasons/ladders: League ranked seasons, Apex ranked & decay, Hero Wars/Wild Rift
guild seasons, GW2 WvW, Tacticus Guild War leagues. Combat depth: NinjaManager &
Tenno (elemental triangles), Ninpocho (bloodline-as-trained-stat). PvE: Diablo
3/4 elite affixes, Path of Exile map modifiers, AFK Arena King's Tower, New World
phased bosses, Terraria/Diablo Immortal bestiaries. Missions/dispatch: Torn Duke
missions & Jobs, Ninja Saga mission ranks, AFK Arena Bounty/Abyssal dispatch.
Pets: Temtem/Coromon (IV/EV & Potential), Cassette Beasts & SMT (fusion),
Summoners War/Epic Seven (ascension), IdleOn (collection passives). Economy:
PoE (currency-as-crafting, affixes), Albion (sink design), Diablo/Warframe
(paragon/prestige). Guild/territory: GW2 guild halls, Travian build trees, DAoC
relics, Foxhole logistics.
