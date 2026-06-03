# Competitor Research — Early-Game Progression

How comparable games handle the new-player experience, and what ShinobiX should
take from each. Companion to [`early-progression.md`](./early-progression.md) and
[`onboarding-tutorial.md`](./onboarding-tutorial.md). Researched across three
clusters: direct ninja/anime browser RPGs, the classic stat-training/energy
"PBBG" lineage ShinobiX descends from, and best-in-class idle/gacha onboarding.

> **Single biggest takeaway:** ShinobiX's two closest genre twins —
> **TheNinja-RPG** and **Ninpocho Chronicles** — both start a new Academy
> Student with **3 basic jutsu to learn and level**. Every comparable game gives
> a starter kit. **ShinobiX starting with zero equipped jutsu is the genre
> outlier** — which is exactly what the auto-learn-bloodline-jutsu plan fixes.

---

## 1. The closest analogs — ninja stat-training RPGs

These share ShinobiX's exact DNA: Academy→Genin→Chunin ranks, real-time resource
pools, learn-and-level jutsu, bloodlines.

### TheNinja-RPG (theninja-rpg.com) — the genre ancestor
- **Start as an Academy Student** with HP/Chakra/Stamina pools and essentially
  no offense; your first task is to **learn 3 academy jutsu** (Clone,
  Replacement, Transform) by spending Ryo. ([Fresh Player Guide](https://theninja-rpg.fandom.com/wiki/Fresh_Player_Guide))
- **Rank-up is a checklist, not just XP:** Academy→Genin requires **18,000 XP +
  Academy level 10 + all 3 starter jutsu at level 5 + 12 Intelligence.** The
  academy *is* the tutorial-by-objective. ([KISS Guide](http://kiss-tnrguide.blogspot.com/2013/05/kisss-beginners-guide.html))
- **Training grows your max pools**, so early training is self-reinforcing
  ("cap your pools first"). A **Sensei system** grants up to **+200% stat gain**
  to soften the early grind.
- **Level/stat caps rise per rank**, pacing power. Bloodline is rolled *at* the
  Genin rank-up (a reward moment), not at creation.
- **Premium currency (Reputation Points)** is not pushed at new players — its
  early relevance is the bloodline economy.

### Ninpocho Chronicles — sibling design
- Every ninja starts as an **Academy Student**; the defining first task is
  learning **Clone / Transform / Replacement** (Ryo + 90 Chakra + 90 Stamina
  each). **Rank-up requires all 3 starter jutsu at level 5.** ([Ninpocho](https://ninpocho.com/))
- Player-discovered optimal opening: **"cap your chakra & stamina pools first."**
  The early game is explicitly a pool-maxing phase before real combat.

### Ninja Saga — best-executed scripted FTUE
- The **tutorial IS the Genin Exam**: mentor NPC teaches Attack/Charge/Run via a
  3-round training-dummy fight, then **gifts your first element + first jutsu
  free**, and graduating promotes Academy→Genin. ([Ninja Saga Wiki — Tutorial](https://ninjasaga.fandom.com/wiki/Tutorial))
- Premium currency (Tokens) is introduced early but its **meaningful sink is
  deferred** to rank exams ("save Tokens for Chunin/Jonin").
- Social hook: you can learn jutsu **from friends for free** (at 2× time).

### Naruto Online — the "what to avoid" monetization benchmark
- Heavily guided, **auto-pathing** story FTUE; companions unlock by clearing PvE
  instances. But: a **day-one "$1/day for 5 days" recharge event**, stamina regen
  1 per ~3 min, and progression gated behind cash. Widely criticized as
  **pay-to-win**, and auto-combat "feels less engaging." ([MMOs.com review](https://mmos.com/review/naruto-online), [Common Sense Media](https://www.commonsensemedia.org/game-reviews/naruto-online))

**Verdict for ShinobiX:** the closest, most-loved games make the **Academy phase a
learn-your-starter-jutsu tutorial**, gate the rank-up behind *mastering* those
jutsu, and defer premium pressure. The disliked one front-loads a paywall.

---

## 2. The stat-training / energy lineage (PBBG)

ShinobiX's stamina + training + missions + PvP + clan loop is this genre. They
gate action behind a regenerating resource + daily reset, and are *infamous* for
opaque onboarding.

- **Torn** — Energy (5/15min, cap 100) + Nerve; **does not refill on level-up**,
  so growth is pure regen+time. A fresh player gets ~15 min of input then is
  gated out with nothing to chase — the genre's most common silent killer.
  Mitigated by a real **mission system** (Duke, ~67 contracts) that answers
  "what now?" ([Torn Energy](https://wiki.torn.com/wiki/Energy), [Duke Missions](https://wiki.torn.com/wiki/List_of_Duke_Missions))
- **Kingdom of Loathing** — 40 adventures/day (cap 200, hoarding deleted so you
  log in *daily*). A short **skippable tutorial (Toot Oriole)** + a **persistent
  quest-giver (the Council)** that always dispenses the next objective. Early
  levels are cheap = fast wins. Famous lesson: **a charming tutorial doesn't fix
  the post-tutorial cliff** ("once done, you're on your own"). ([KoL Adventures](https://www.kingdomofloathing.com/doc.php?topic=adventures), [jayisgames](https://jayisgames.com/review/kingdom-of-loat.php))
- **Mafia Wars / Mob Wars** — the **level-up full-refill** turns the energy bar
  into a *combo meter*: spend down, ding a level, refill + 5 skill points, chain
  far past raw regen. **Mob Wars nerfed this in 2012 and lost players** — the
  early-session refill is load-bearing. ([Mafia Wars](https://en.wikipedia.org/wiki/Mafia_Wars), [Mob Wars refill change](https://mobwars.wordpress.com/2012/11/02/new-level-up-refill-rates/))
- **Improbable Island** — a fresh Game Day every 4h refills stamina, **plus 2
  "Chronospheres" = instant New Days** so an engaged newbie can play past the
  first wall instead of bouncing. Opposite failure mode from KoL: **text-wall
  overload** at start. ([Improbable Island newbie guide](https://wiki.improbableisland.com/doku.php?id=gameplay:guides:newbie))
- **Outwar** — refills-on-level, but treats **levels 1-75 as undifferentiated
  grind** with crews/PvP only relevant at 90+. Textbook **burying the fun**. ([Recommended Path](https://outwar.info/wiki/Recommended_Path))
- **Bootleggers / Omerta** — a **job/crime ladder** where early success *rate*
  matters more than payout (failure wastes the resource); money funnels into
  gear + protection; a gang/family is the retention anchor. **Politics & War**
  gives new nations a **14-day no-war protection window**.

**The genre's recurring failure modes:** (1) the post-tutorial cliff, (2)
text-wall overload, (3) buried fun behind a grind/friend wall, (4) the
15-minute-then-locked-out momentum gate, (5) newbie predation, (6)
wiki-dependence as load-bearing design.

---

## 3. Best-in-class idle & gacha onboarding (the polished end)

ShinobiX has idle elements (training timers that complete offline) and gacha
elements (awakening rolls, Fate Shards), so these are the quality bar.

- **First 10 minutes = guaranteed win → instant reward → first upgrade.** AFK
  Arena scripts **guaranteed victories**; Dokkan Battle jumps a new account
  **level 1→27 in the first session** and loans powerful units; idle games
  un-grey the first cheap upgrade within seconds. ([GameRefinery](https://www.gamerefinery.com/first-impression-seals-the-deal-onboarding-best-practices-part-1/), [DoF AFK Arena](https://www.deconstructoroffun.com/blog/2019/6/6/afk-arena-puts-lilith-into-the-billionaire-club))
- **Progressive feature unlock keyed to account level.** Genshin's **Adventure
  Rank ladder** (AR12 dailies, AR16 co-op, AR20 endgame…) and HSR's
  **Trailblaze Level ladder** reveal one system at a time and gray out the rest.
  "Dump it all in the first 10 minutes and players bail." ([Genshin AR](https://genshin-impact.fandom.com/wiki/Adventure_Rank), [HSR beginner guide](https://hsr.keqingmains.com/misc/beginner-guide/))
- **Offline progress as the return hook.** AFK Arena's chest fills and **caps**
  (overflow nags you back); Melvor banks up to **24h** offline. Framed as "your
  stuff kept working while you were away," and **idle yield scales with active
  progress** so the two reinforce each other. ([Macmillan](https://alexandremacmillan.com/2019/06/13/idle-mechanics-and-monetizing-progession-in-afk-arena/), [Melvor](https://wiki.melvoridle.com/w/Beginners_Guide))
- **Energy is generous and never blocks the fun.** Genshin/HSR keep **story &
  combat off the stamina meter** — stamina only gates *optional farming* — and
  shower new accounts with refills. The cap is framed as "spend before it
  overflows," not "you're locked out." ([HSR](https://hsr.keqingmains.com/misc/beginner-guide/), [Raid energy](https://hellhades.com/beginners-energy-guide-raid-shadow-legends/))
- **The "first 7 days" program.** A **login calendar** where ~3-7 logins grant a
  **guaranteed premium reward**, + a **beginner-mission track** that teaches each
  system and pays guaranteed premium currency (Dokkan "Greatest Warrior," HSR's
  9-part Operation Briefing), + dailies as a **single activity-points bar →
  premium** (HSR: 500 points → 60 jade), not a nagging checklist. ([HSR](https://hsr.keqingmains.com/misc/beginner-guide/), [Epic Seven](https://www.bluestacks.com/blog/game-guides/epic-seven/es-new-player-guide-en.html))
- **Always-visible "next thing."** Trackable main quest that auto-paths;
  side-rail beginner missions; un-greyed next upgrade. Removes the "what now?"
  that kills D1.
- **First gacha pull is free and chosen, not gambled.** Epic Seven's **Selective
  Summon** (10-pull guaranteeing a 5★, infinite rerolls until happy); HSR's
  first warp guarantees a 4★. Monetized RNG is introduced only after the player
  has a usable build. ([Epic Seven](https://www.bluestacks.com/blog/game-guides/epic-seven/es-new-player-guide-en.html))

---

## 4. Cross-cluster patterns (the through-lines)

1. **Everyone gives a starter kit.** No comparable game starts you empty-handed.
2. **The first win is guaranteed and fast** (scripted fight / loaned power / cheap
   early levels).
3. **Progressive disclosure keyed to rank/level** — never all systems at once.
4. **A persistent "next objective"** beyond the one-shot tutorial (quest-giver,
   beginner-mission rail, tracked quest).
5. **Generous early energy; keep the fun off the meter;** refill on milestones.
6. **Daily reset + first-7-days program** is the universal retention glue.
7. **Defer premium pressure;** first pull free/chosen. Day-one paywalls are the
   #1 thing players resent (Naruto Online).
8. **Don't bury the signature fun** (PvP/clans/pets) behind dozens of hours.

---

## 5. What this means for the ShinobiX plan

This research **validates** the existing plan and **adds** several concrete
mechanics. Updates to fold into the other two docs:

**Reinforced (already in the plan):**
- ✅ Auto-learn bloodline jutsu at creation — confirmed as the genre standard
  (TheNinja-RPG/Ninpocho/Ninja Saga). ShinobiX is the outlier; fix it first.
- ✅ Guided first win in the first minutes (Ninja Saga's exam-as-tutorial).
- ✅ Always-visible "Next Goals" panel (Torn's Duke, KoL's Council, gacha rails).
- ✅ New-player daily scaffold; the **daily-cap reset** (missions/hunts/explore)
  is the come-back-tomorrow hook.
- ✅ **PvP protection for Academy Students** (owner-confirmed) — like Politics &
  War's protection window, but tied to rank (Academy = level 1-14).
- ✅ Defer Fate Shards / paid pulls past the first rank-up.

**New ideas worth adding:**
- **Rank-up as a learn-and-level checklist.** Make the Genin objective include
  "raise your starter jutsu to mastery level N" (TheNinja-RPG/Ninpocho model), so
  the rank-up *is* the tutorial. **Owner decision:** keep this a *soft* teach-by-
  doing goal (Next-Goals + small reward), not a hard wall. Mastery is judged by
  the per-jutsu `mastery.level`, reached via battle use (+20 XP/cast) — see
  `onboarding-tutorial.md` §1.7.
- **Progressive unlock ladder keyed to Ninja Rank** (Genshin AR / HSR TL model).
  Suggested order: **Academy**: training + first missions → **Genin**: jutsu
  loadout + Awakening (elements) → **Chunin**: pets + clans → **later**: PvP →
  ranked queue → village guard. Sharpens `early-progression.md` §8.
- **Reframe training timers as a "while you were away" payout**, capped (8-24h)
  so it overflows and nags a return (AFK Arena/Melvor). Make the **first**
  training timer very short for an instant first claim.
- **Success-rate-first early missions** with the success % surfaced, so a loss
  doesn't waste one of the player's limited **daily mission/hunt slots** (mafia-
  game lesson, reframed around daily caps rather than stamina).

**Dropped after owner review (kept here for the record):**
- ~~Stamina refill burst on rank-up~~ and ~~new-player instant-stamina tokens~~ —
  moot: **stamina is not a content gate** in ShinobiX; daily caps do the pacing.
- ~~First Awakening "free & chosen / guaranteed"~~ — the **RNG roll is a kept
  feature**; the existing free Lv 2 / Lv 20 rolls stay, outcome stays random.

**Hard "avoid" list (all corroborated):**
- ❌ Day-one paywall / premium pressure (Naruto Online's #1 criticism).
- ❌ Full auto-combat in the FTUE — keep the first fight manual so verbs are
  taught.
- ❌ Text-wall onboarding (Improbable Island) — progressive disclosure instead.
- ❌ Burying PvP/clans/pets behind a long grind (Outwar).
- ❌ A 15-minute-then-locked-out first session (Torn).
- ❌ Relying on an external wiki as the manual — bake "how" into mission text +
  tooltips.
- ⚠️ Per CLAUDE.md: implement all of this as a **new-player onboarding layer**
  (beginner missions, login calendar, rank-keyed unlock table, shortened *first*
  training timer, starter-jutsu seed) — **not** by retuning live reward rates,
  rarity odds, AP costs, or payouts for existing players.

---

## Sources

Ninja RPGs: [TheNinja-RPG Fresh Player Guide](https://theninja-rpg.fandom.com/wiki/Fresh_Player_Guide) ·
[KISS Beginners Guide](http://kiss-tnrguide.blogspot.com/2013/05/kisss-beginners-guide.html) ·
[Ninpocho](https://ninpocho.com/) ·
[Ninja Saga Tutorial](https://ninjasaga.fandom.com/wiki/Tutorial) ·
[Naruto Online review (MMOs.com)](https://mmos.com/review/naruto-online) ·
[Common Sense Media](https://www.commonsensemedia.org/game-reviews/naruto-online)

PBBG lineage: [Torn Energy](https://wiki.torn.com/wiki/Energy) ·
[Torn Duke Missions](https://wiki.torn.com/wiki/List_of_Duke_Missions) ·
[KoL Adventures](https://www.kingdomofloathing.com/doc.php?topic=adventures) ·
[jayisgames KoL](https://jayisgames.com/review/kingdom-of-loat.php) ·
[Mafia Wars](https://en.wikipedia.org/wiki/Mafia_Wars) ·
[Mob Wars refill change](https://mobwars.wordpress.com/2012/11/02/new-level-up-refill-rates/) ·
[Improbable Island newbie guide](https://wiki.improbableisland.com/doku.php?id=gameplay:guides:newbie) ·
[Outwar Recommended Path](https://outwar.info/wiki/Recommended_Path) ·
[Politics & War Fundamentals](https://politicsandwar.fandom.com/wiki/Fundamentals_of_Gameplay)

Idle/gacha: [DoF — AFK Arena](https://www.deconstructoroffun.com/blog/2019/6/6/afk-arena-puts-lilith-into-the-billionaire-club) ·
[GameRefinery — Onboarding](https://www.gamerefinery.com/first-impression-seals-the-deal-onboarding-best-practices-part-1/) ·
[HSR Beginner Guide (KQM)](https://hsr.keqingmains.com/misc/beginner-guide/) ·
[Genshin Adventure Rank](https://genshin-impact.fandom.com/wiki/Adventure_Rank) ·
[Melvor Beginners Guide](https://wiki.melvoridle.com/w/Beginners_Guide) ·
[Macmillan — AFK Arena idle mechanics](https://alexandremacmillan.com/2019/06/13/idle-mechanics-and-monetizing-progession-in-afk-arena/) ·
[Epic Seven New Player Guide](https://www.bluestacks.com/blog/game-guides/epic-seven/es-new-player-guide-en.html) ·
[Raid energy guide](https://hellhades.com/beginners-energy-guide-raid-shadow-legends/)
