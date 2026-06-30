# Village War Map — Sectors, War Resources, Tax & Structure Maintenance — Master Plan

> **Status:** PLAN ONLY — no code written. Balance‑sensitive and economy‑touching;
> needs owner sign‑off before any implementation (CLAUDE.md hard rules: no
> reward/currency/balance changes without explicit approval).
> **Author direction (this pass):** Build the "Village War Map" shown in the
> reference mock — four villages, 8 sectors each, a War‑Resources economy, a daily
> tax, sector benefits, war/mercenary costs — and **partner it with daily
> maintenance on village structures that scales with structure level.** Treat the
> mock's prices/quantities as *placeholders*; rebalance them. Mark owned sectors
> visibly on the world map. No regressions to the (substantial) systems that
> already exist.
> **Companion docs:** [`economy-progression-redesign.md`](./economy-progression-redesign.md),
> [`economy-telemetry-plan.md`](./economy-telemetry-plan.md),
> [`auth-and-anti-cheat-patterns.md`](./auth-and-anti-cheat-patterns.md),
> [`professions.md`](./professions.md), [`ui-design-system.md`](./ui-design-system.md).

---

## 0. TL;DR — the one thing to understand first

**This is not a greenfield feature. ~70% of it already exists** and is live. The
mock is a *unification + visual layer + economy rebalance* on top of systems the
game already ships:

| Mock element | Reality in code today |
|---|---|
| 4 villages (Ashen Leaf / Frostfang / Stormveil / Moonshadow) | **Exist**, hard‑coded `data/sectors.ts:24`; biomes volcano/snow/forest/shadow |
| Sectors owned by a village | **Exist** — world sectors 1–60, biome‑banded; `villageOwnedTerritories(village)` already drives daily Map‑Control rewards |
| Honor Seals | **Exist** as a currency (`api/_economy.ts`); already pay for war‑declare, mercenaries, structure upgrades |
| War declaration, sector capture, contributions, spoils, mercenaries | **Exist** — `api/world-state.ts` (`VillageWar`), `api/village/_mercenaries.ts`, `api/_war-spoils.ts` |
| "Sector benefits daily" | **Partly exists** — per‑player Map‑Control reward `sectors×100 ryo` etc. (`api/_map-control-reward.ts`) |
| Village structures that level up | **Exist** — 8 upgrades, max L50, Honor‑Seal cost (`lib/village-upgrades.ts`) — **but PER‑PLAYER, not village‑level, and with no upkeep** |
| **War Resources currency** | **Does NOT exist** — new |
| **Daily Tax** (ryo deduction scaling with sectors) | **Does NOT exist** — new |
| **Daily structure maintenance** | **Does NOT exist** — new |
| **The visual War Map view** | Partly — there's a live world map (`WorldMap.tsx`) but no ownership treatment; current `VillageWarScreen.tsx` is text/leaderboard. The mock's hex grid is reference‑only |

So the work splits into **(A) new economy mechanics** — War Resources, Tax, Maintenance,
village‑level structures — **(B) a new lightweight combat layer** — **Sector War** with
per‑sector Control HP, Kage‑chosen win‑conditions, terrain control and hired AI merc
squads (§17), all reusing the *existing* battle resolvers — **(C) a War‑Map view +
ownership treatment** on the existing world map, and **(D) a rebalance** re‑pricing
war/merc costs onto WR. The biggest risks are in the *seams* with live systems (player
wallets, clan territory, the existing war engine), not the new code itself. **§8–9
(economy seams) and §17 (combat layer) are the load‑bearing sections.**

---

## 1. The reference mock, transcribed

For the record, exactly what the mock specifies (so we can diff our rebalanced
version against it):

- **Villages & sectors:** Ashen Leaf `AL‑1…AL‑8`, Frostfang `FF‑1…FF‑8`, Stormveil
  `SV‑1…SV‑8`, Moonshadow `MS‑1…MS‑8`. Central castle between them. 32 home sectors.
- **Tax System (daily ryo deduction):** 8 sectors → 1% · 10 sectors → 0% · <6 → 2% ·
  <2 → 5%. "Deducted from all villagers daily based on the number of sectors your
  village controls."
- **Sector Benefits (daily):** +10 War Resources **and** +1 Honor Seal *for each
  sector your village controls.*
- **War Costs:** Declare War on a village = 5,000 War Resources · Sector War (1
  sector) = 2,000 War Resources.
- **Hire Mercenaries:** Lv 80 = 500 · Lv 90 = 1,000 · Lv 100 = 1,500 War Resources.
  "Mercenaries last for 2 days before needing to be rehired."
- **Resources Overview:** *War Resources* — used for war, mercenaries, strategic
  actions. *Honor Seals* — earned daily, used in shop and for special events.
- **Summary:** control more sectors → lower taxes + more rewards; use war resources
  to expand/defend; honor seals for special rewards/upgrades.

**Every number above is treated as a placeholder.** §6 shows why the raw numbers
don't close (a 5,000‑WR war at +10 WR/sector is ~62 days of income) and proposes a
self‑consistent re‑tuning.

---

## 2. What already exists (regression inventory)

Verified by reading the code. **Do not break any of these.** File references are
load‑bearing for whoever implements.

### 2.1 Geography
- `villages` list + biome bands: shadow 1–20, forest 21–35, volcano 36–45, snow
  46–55, **central 56–60**, lava 99. `shinobij.client/src/data/sectors.ts`.
- Village "outskirts" anchor sectors: Stormveil 31, Ashen Leaf 38, Frostfang 47,
  Moonshadow 11 (`villageOutskirtsSectorNumber`).
- World map render: `shinobij.client/src/screens/WorldMap.tsx` (~2,730 lines, biome
  backgrounds via static `import`s, **no hex overlay** today).

### 2.2 Territory & war
- `world:territory:<sector>` records: owner, HP (0–20000), control score, `warSupply`
  (accrues 100/day), guards, terrain. `api/world-state.ts` + `api/_territory-supply.ts`.
  **⚠ `warSupply` is collected by CLANS** (`api/clan/territory/collect-supply.ts`) into
  the *clan* treasury — this is a live clan feature, see §9 risk #3.
- `VillageWar` (`api/world-state.ts`): declare = **500 Honor Seals** (Kage), 1h pending,
  village HP 5,000, decay −500/day after 3 days, 14‑day cap, war‑ground sector capture
  flips ownership + drains 750 HP. Spoils on loss: winner takes 15% ryo / 15% honor /
  10% fate from loser treasury (`api/_war-spoils.ts`). Loss debuff −10% training, 3 days.
- Client war UI: `shinobij.client/src/screens/VillageWarScreen.tsx` (text/leaderboard;
  GET/POST `/api/world-state`).

### 2.3 Mercenaries (`api/village/_mercenaries.ts`)
5 sealed tiers, **Honor‑Seal** cost, once‑per‑tier‑per‑war, **no duration**, damage
floored so a merc can never end a war:

| id | level | cost (seals) | war dmg |
|---|---|---|---|
| merc‑ronin | 75 | 150 | 120 |
| merc‑reaver | 80 | 250 | 200 |
| merc‑shadow | 85 | 400 | 320 |
| merc‑oni | 95 | 650 | 500 |
| merc‑warlord | 100 | 1000 | 750 |

### 2.4 Village structures = **per‑player** upgrades (`lib/village-upgrades.ts`)
8 upgrades, max **L50**, bonus is **per‑character** (each player buys their own with
their own Honor Seals; the bonus applies only to that player). **No upkeep, never
destroyed, permanent.** Cost `floor(base + lvl·4 + lvl^1.25·2)`.

| key | name | per level | base |
|---|---|---|---|
| training | Training Grounds | +0.25% train XP | 10 |
| jutsuTraining | Jutsu Training | +0.25% jutsu XP/speed | 12 |
| shop | Shop | 0.25% discount | 12 |
| townDefense | Town Defense | +0.1% guard def | 14 |
| petYard | Pet Yard | +0.25% pet XP | 12 |
| bank | Bank | +0.01%/day interest | 16 |
| missionHall | Mission Hall | +0.5% mission rewards | 14 |
| hospital | Hospital | 1% discount | 12 |

> **This is the single most important design fork** — see §7. The mock's
> "structures with daily maintenance" implies *village‑level* structures; today's
> upgrades are *personal*. Attaching upkeep to the personal ones would be a large,
> punishing change to a live per‑player system. Recommendation: **leave these
> untouched and introduce a separate village‑level structure layer.**

### 2.5 Treasury, leadership, currencies, cron
- Village treasury `game:village-state:<slug>` — 6 currencies (ryo, honorSeals,
  fateShards, boneCharms, auraStones, mythicSeals) + items. Donate = any member;
  withdraw = Kage only. Validator `api/_village-state-validate.ts` forbids client‑side
  credit.
- Kage (L100 + story), ANBU (3), Kage challenges. `api/village/kage*.ts`.
- Currencies `api/_economy.ts`: ryo, fateShards, boneCharms, auraStones, auraDust,
  honorSeals, mythicSeals, hollowShards. **No War Resources.**
- Daily cron: in‑process scheduler `api/cron/_scheduler.ts`, fires 03:00 UTC, single
  always‑on instance (Railway), `DISABLE_SNAPSHOT_CRON=1` on secondaries. Today runs
  snapshot saves + ranked rollover only.

### 2.6 Server‑authority patterns we must reuse
- `withKvLock(target, fn, { failClosed: true })` for every currency/shared mutation;
  lock the **shared resource key**, not the actor save; **debit before credit, never
  re‑credit** (`api/_lock.ts`, anti‑cheat doc).
- Lazy daily idempotency via a date stamp inside the lock (`lastXDate !== today` →
  run, else no‑op) — exactly how `api/player/daily-login.ts` works.
- `bumpSaveVersion` + `mergePreservingImages` on every save write.
- New endpoints: handler in `api/**` **and** `route()` in `server.ts` (both bare +
  `/api` path); `server-routes.test.ts` enforces parity both directions. Keep CORS in
  `api/_utils.ts` ↔ `server.ts` in sync.

---

## 3. Design goals & guardrails

1. **One coherent economy with three legible loops** (§5), each resource doing one
   job — no "what is this currency even for" confusion.
2. **Sinks kept taut and wealth‑scaling**, per the economy master‑plan and the
   external research (Koster, EVE MER, CivFanatics upkeep threads): a balance‑scaling
   faucet needs a balance‑scaling sink; percentage sinks stay relevant when fixed ones
   don't.
3. **Expansion is the reward** — controlling more sectors must visibly *help*
   (lower tax, more income), and the dominant‑village paradox (0% tax = no ryo income)
   must not break upkeep.
4. **High‑stakes conquest, with brakes — not a brick (owner direction).** Total
   conquest (a village taken to 0) is intended and the snowball is accepted. The safety
   net is *not* a sector floor but: a **rock‑bottom comeback discount** (sector‑war +
   mercs: 0 sectors → free, 1 sector → 75% off), the war engine's own limits (1h
   pending, 14‑day cap, decay, 7‑day rematch cooldown), and per‑player tax caps + the
   Academy exemption so individual players are never wrecked.
5. **Save‑safe & reversible.** Upkeep shortfalls suspend bonuses (dormancy), never
   destroy state. Tax has hard caps and new‑player grace.
6. **Server‑authoritative everywhere.** Every gain is recomputed server‑side; tax can't
   be dodged from the client; the whole feature ships behind a default‑OFF flag.
7. **Reuse the existing resolvers.** The new sector‑war layer *orchestrates* fights but
   doesn't re‑implement combat — winners come from the existing PvP / Card‑Clash / pet
   sims, and the village war keeps its existing engine. We add only a thin Control‑HP +
   win‑condition layer on top (§17), not a new battle system.

---

## 4. Sector model — assign ownership to the EXISTING sectors (no new hex layer)

> Per owner direction: the mock's `AL‑1…8` hex grid was **reference only** — we do
> **not** build a parallel hex map. We take the **existing 60 world sectors** and
> *edit which village owns which* so it makes geographic sense, then mark the owned
> ones clearly on the existing world map (§10). The gameplay biome of each sector
> (`biomeForWorldSector`) already aligns one band to one village, so ownership writes
> itself: shadow→Moonshadow, forest→Stormveil, volcano→Ashen Leaf, snow→Frostfang,
> central→contested.

**Central is a neutral, non‑capturable hub (owner direction).** The central band /
castle owns **no war sectors**, cannot be captured, and is **excluded from every
"sectors controlled" count**. It stays purely the lore/visual heart of the map (and a
natural home for neutral events) — the generated central sector map already shows an
unclaimed keep with empty banner‑poles. So the war economy is a **zero‑sum contest
between the four villages only**.

**Home territory: 8 sectors per village — all capturable, none protected (owner
direction).** Each village starts owning its 8 home sectors; **every** one can be
captured by an enemy village in war, and recaptured. There is **no protected core and
no floor** — a village that loses all its land sits at **0** until it fights back, so
**total conquest is on the table**. A village earns from every sector it currently
holds, so **conquest pays**: a winner occupying enemy land out‑earns and out‑levels
everyone, while a conquered village is genuinely crippled until it rallies. Special
sectors are avoided (Hollow‑Gate shrines 1/52/57, Death's Gate 99); all band sectors
**not** listed below stay **neutral wilderness / PvE exploration** as today — the war
layer is a curated 32‑sector contest on top of the unchanged exploration map.

| Village | Biome band | Home sectors (all 8 capturable, start owned) |
|---|---|---|
| Moonshadow | shadow 1–20 | **11 (outskirts), 2, 3, 4, 5, 6, 7, 8** |
| Stormveil | forest 21–35 | **31 (outskirts), 21, 22, 23, 24, 25, 26, 27** |
| Ashen Leaf | volcano 36–45 | **38 (outskirts), 36, 37, 39, 40, 41, 42, 43** |
| Frostfang | snow 46–55 | **47 (outskirts), 46, 48, 49, 50, 51, 53, 54** |
| *Central 56–60* | central | *neutral hub — not owned, not capturable, not counted* |

- **Start state:** every village holds its full **8** → the **0% tax** tier. From there
  it's a pure tug‑of‑war: take enemy sectors to earn more and tax them harder; lose your
  own to fall toward 0.
- **"Sectors controlled"** (drives tax tier + WR income) = sectors you currently hold —
  your own un‑occupied home sectors **+ any enemy sectors you occupy**. Your own land
  ranges **0–8**; a conqueror holding others' land counts higher and earns
  proportionally (conquest pays, no cap).
- **Rock‑bottom comeback (owner direction):** a nearly‑wiped village gets a steep
  discount on sector‑war challenges *and* mercenary hires so it can fight back despite
  ~no WR income — **0 sectors → free · 1 sector → 75% off · ≥2 sectors → full price**
  (§6.3). It protects no sector and hands out no currency; it just keeps the zero/one
  state from bricking.
- **Source of truth / regression note:** the per‑player Map‑Control reward already
  reads `villageOwnedTerritories(village)`. **Implementation must confirm** how it
  derives ownership today and write the war‑map owner into a **dedicated field/record**,
  never mutating the **clan‑owned** `warSupply`/territory semantics (§9 risk #3). The
  `AL‑n`‑style label is a **display alias**; the canonical key stays the world‑sector
  number, so every existing territory / war / map‑control path keeps working unchanged.

A small pure module — proposed `shinobij.client/src/data/war-map-sectors.ts` (+ server
twin `api/_war-map-sectors.ts`) — holds the sector→village table, the display alias,
and `homeSectorsForVillage()` / `villageForSector()` mappers. Pure data, unit‑testable,
same shape as `data/sectors.ts`. Re‑tuning the contest is single‑table edits to WR
income (§6.1) and the tax tiers (§6.4).

---

## 5. The three‑loop economy (the spine)

Each resource gets exactly one job:

### Loop 1 — War Resources (WR): the **military upkeep** loop *(new currency, village‑pool only)*
- **Faucet:** controlled sectors (daily), war victories, sector captures.
- **Sink:** **daily structure maintenance** + war declaration + sector war + mercenaries.
- **Self‑balancing:** every structure level is a permanent WR/day drain, so a village
  can only sustain what its sectors fund. Hold more sectors → afford more building +
  more war. Lose sectors → must downsize or let structures go dormant.
- **Scope:** WR is a **village pool**, *not* a personal character currency. Stored on
  the village record; spent by the Kage/officers. This avoids adding a 9th personal
  currency, a save migration, and per‑player WR exploits.

### Loop 2 — Ryo Tax: the **personal anti‑inflation sink** *(new)*
- **Faucet for whom:** nobody — it's a daily *deduction* from each villager's ryo,
  rate set by how many sectors their village controls (more sectors → lower rate).
- **Where it goes:** village treasury ryo (Kage war‑chest for member rewards /
  subsidies), with a configurable **burn share** (default 50%) destroyed outright so
  it is a real inflation sink, not just a transfer (see §6.4, §8.2).
- **Why ryo and not WR:** keeps the dominant‑village paradox from breaking upkeep —
  upkeep lives in Loop 1 (WR, sector‑funded), so a 0%‑tax super‑village still pays
  maintenance from its large WR income. Tax is a *wealth* lever, decoupled from upkeep.

### Loop 3 — Honor Seals: **prestige / progression** *(existing, re‑roled)*
- **Faucet:** unchanged personal sources (Vanguard PvP, map‑control) **+** a small
  per‑sector trickle to the village seal pool (+1/sector/day, per the mock).
- **Sink:** **structure upgrades** (the one‑time level‑up cost — fits "used in shop /
  special rewards/upgrades") + existing shop/special‑event uses.
- **Freed from war:** war declaration & mercenaries **move off Honor Seals onto WR**
  (§6.3). This is what makes Honor Seals "the shop & special‑events currency" the mock
  describes, and gives WR a reason to exist.

```
        ┌─────────── villagers' ryo ───────────┐
 TAX %  │  (rate ↓ as sectors ↑)               │  → 50% burn (sink) + 50% treasury ryo
        └──────────────────────────────────────┘
 SECTORS ─► +WR/day ─► [ maintenance ] + [ declare war / sector war / mercenaries ]
        └─► +HonorSeal/day (village pool) ─► [ structure upgrades ] + shop/events
```

---

## 6. Re‑balanced numbers (v1 — first pass, telemetry‑tunable)

> The mock's raw numbers don't close. The fixes below preserve the *ratios that
> matter* (income vs. war cadence vs. upkeep ceiling) and are sized against the
> measured faucets in `economy-progression-redesign.md`. All values are constants in
> one server module (`api/_war-economy.ts`) with a client mirror, so tuning is a
> one‑line change + a parity test.

### 6.1 Sector benefits (per controlled sector, per day → village pool)
| Resource | Mock | **Proposed v1** | Rationale |
|---|---|---|---|
| War Resources | +10 | **+25** | a full‑8 village funds ~weekly war + mid‑level upkeep; a conquered village earns nothing (correct — conquest pays) |
| Honor Seals | +1 | **+1** | keep — modest village seal trickle |

Village WR income scales with **sectors currently held** (own un‑occupied + enemy
occupied): 8 → **200/day** · 6 → 150 · 4 → 100 · 2 → 50 · 0 → **0/day** (fully
conquered). A conqueror occupying enemy land scales **past** 200 (e.g. 8 own + 4
occupied = 12 → 300/day) — there is no cap, so winning a war directly funds the next
one. This is the entire WR faucet.

### 6.2 Structure maintenance (per structure, per day, in WR)
`dailyMaint(level) = round(2 · level^1.25)` — gently super‑linear so high levels are
a real commitment (matches the CivFanatics/Civ upkeep‑scaling research). Village‑level
structures cap at **L10** (not L50 — they're shared and potent; see §7). Re‑based to
**2** (from 3) to fit the tighter 100–200/day income band.

| Level | WR/day per structure |
|---|---|
| 1 | 2 |
| 3 | 8 |
| 5 | 15 |
| 8 | 27 |
| 10 | 36 |

With **6 structures** (§7): all‑L5 = **90/day**; all‑L8 = **162/day**; all‑L10 =
**216/day**. Note all‑L10 (216) *just exceeds* full‑8 income (200) — deliberate: even a
fully‑held village can't max every structure *and* wage war on home income alone; it
must keep one or two structures lower **or conquer enemy sectors to fund the rest**. As
a village is raided toward 0 its income collapses and it can no longer cover upkeep, so
its structures go **dormant** (§7) — being conquered also strips your bonuses until you
reclaim land. That is the taut ceiling, sized to the 0–8 economy.

### 6.3 War & mercenary costs (move onto WR)
| Action | Mock | **Proposed v1 (WR)** | Notes |
|---|---|---|---|
| Declare war on a village | 5,000 | **800** | ≈5–7 days of a full‑8 village's *net* income (after light upkeep) → ~weekly war for a strong village; a besieged one can't afford it (defend first) |
| Sector war (contest 1 enemy sector) | 2,000 | **250** | a couple of skirmishes/week |
| Mercenary Lv75 (ronin) | — | **60** | 2‑day contract |
| Mercenary Lv80 (reaver) | 500 | **110** | 2‑day |
| Mercenary Lv85 (shadow) | — | **170** | 2‑day |
| Mercenary Lv95 (oni) | 1,000* | **280** | 2‑day |
| Mercenary Lv100 (warlord) | 1,500 | **420** | 2‑day |

\*Mock lists Lv80/90/100; code has 75/80/85/95/100. Keep the **existing 5 tiers**
(don't churn the sealed table), switch currency Honor Seals → **WR**, add a **2‑day
expiry** (re‑hireable), keep the "can't end a war alone" damage floor.

**Comeback discount (rock‑bottom rule):** sector‑war challenges **and** mercenary hires
get a steep discount when a village is nearly wiped, so it can fight back despite ~no WR
income:

| Sectors held | Sector‑war + mercenary cost |
|---|---|
| 0 | **free** (100% off) |
| 1 | **75% off** |
| ≥2 | full price (sector‑war 250 · mercs at tier) |

So a 0‑sector village fights free to grab a foothold, then at 1 sector still pays only a
quarter (sector‑war 63 · e.g. tier‑1 merc 15) to push for a second, and from **2
sectors** it's back on the normal economy. This is the only anti‑brick measure (§4) — it
shields no sector and grants no currency.

> The **mercenary** half of this discount is confirmed: Option B (§17.5) fields a hired AI
> squad *in (Combat) sector wars*, so the 0‑sector / 1‑sector discount applies to **both**
> the sector‑war entry and the merc squad.

### 6.4 Tax tiers (daily, on personal ryo)
Anchored to the full **0–8** range now that any sector can be lost: full home = the 0%
reward; the further a village is conquered, the more its members are taxed, bottoming at
the mock's **5%** when it's all but wiped. This is intentional pressure — the conquered
village's own players feel the loss directly — and the bigger war‑chest it funds (plus
the rock‑bottom comeback discount, §6.3) is its lever to fight back.

| Sectors controlled | **Proposed v1** | Meaning |
|---|---|---|
| 8 (full home) | **0%** | un‑raided — the dominance reward |
| 6–7 | **1%** | a sector or two lost |
| 4–5 | **2%** | half conquered |
| 2–3 | **3.5%** | nearly overrun |
| 0–1 | **5%** | conquered — the heaviest tier |

(A conqueror holding >8 stays at 0% — the tier maxes the reward at 8, it doesn't go
negative. This 5‑row table is the single place to rescale if a village's home size ever
changes.)

**Tax base (owner decision): wallet ryo + banked ryo** (`ryo + bankRyo`). Banking is
*not* a tax shelter — this makes the tax a true wealth sink and stops the obvious
"park everything in the bank to dodge it" exploit. It also counter‑weights the
bank‑interest faucet (the game's #1 inflation source per the economy master‑plan):
the same wealthy balances that earn the most interest now pay the most upkeep.

**Academy Students are fully exempt.** `rankFromLevel(level) === "Academy Student"`
i.e. **level < 15** ([`lib/stats.ts:131`](../shinobij.client/src/lib/stats.ts)). New
players pay **zero** tax until they graduate to Genin — onboarding is never punished,
and the exemption is tied to a real in‑game rank, not an arbitrary timer.

Other guardrails (all new — the mock has none; essential to avoid a death spiral and
live‑economy backlash):
- **Wealth exemption:** first **5,000 ryo** of the combined base untaxed (so a freshly
  graduated Genin with pocket change still pays ~nothing; the tax bites real wealth).
- **Daily cap:** tax ≤ **250,000 ryo/player/day** (whales contribute meaningfully but
  are never nuked; a 10M‑ryo banked whale pays the 1% = 100k/day, well under the cap).
- **Catch‑up cap:** a returning player owes at most **3 days** of back‑tax (§8.2), so
  an absence is never a wipe on login.
- **Burn share:** **50%** of collected tax is destroyed (the inflation sink), 50% to
  the village treasury war‑chest (default; a single tunable constant 0–100%).

### 6.5 Worked example (sanity check)
**WR / war cadence & conquest:** a full‑8 village (200 WR/day) running structures at ~L4
(6 × round(2·4^1.25)=11 → **~66 WR/day upkeep**) nets **~+134 WR/day** → a war
declaration (800) about every **6 days** (~weekly). Build harder (all‑L6 ≈ 114/day
upkeep → net +86) and the cadence stretches to ~9 days — **every structure level trades
against your war tempo.** Now the snowball the no‑floor model creates on purpose: a
winner that captures 4 enemy sectors jumps to 12 held → **300/day** income → it wars
*more* often while the loser, knocked to 4 sectors (100/day) and soon lower, can barely
field a mercenary. Conquest compounds — which is the aggressive, high‑stakes map you
asked for. The brake on a runaway is the existing war engine (1h pending, 14‑day cap,
decay, 7‑day rematch cooldown) plus the **rock‑bottom comeback discount** (0 sectors →
free, 1 sector → 75% off) — a nearly‑wiped village fights and hires mercs cheaply to
claw a foothold back.

**Tax / ryo sink:** full‑8 sits at **0%**, so a healthy village's members pay **no tax
at all** — it only switches on as you're conquered. A village knocked to 3 sectors
(3.5% tier), 20 members averaging ~600k combined wallet+bank ryo, sheds ≈ **420k
ryo/day** — half burned (anti‑inflation sink), half into the war‑chest its Kage can
spend on the counter‑attack — and **zero** effect on any Academy (sub‑Genin) player. So losing land bites *twice* (less WR, members taxed harder), which
is the intended pressure to either rally or get rolled.

---

## 7. Village structures + the per‑player‑vs‑village fork

**Decision (recommended): introduce a NEW village‑level structure layer; leave the
existing 8 per‑player upgrades exactly as they are.**

Why not bolt maintenance onto the existing upgrades: they're *per‑character* and
*permanent*; adding upkeep would (a) impose a daily personal cost on a live,
balance‑sensitive progression system, (b) be conceptually wrong (the mock's
maintenance is a *village* cost paid from a *village* economy), and (c) risk save
churn on every player. Hard‑rule territory.

**Proposed village structures (6), shared per village, Kage‑upgraded, L1–L10:**

| Structure | Village‑wide effect (proposed) | Ties into |
|---|---|---|
| **Ramparts / Walls** | +X% village war HP (raises the 5,000 cap) | war engine HP |
| **Watchtower** | +X% home‑sector defense / slower enemy sector capture | territory HP |
| **Barracks** | mercenary WR discount and/or +1 concurrent merc slot | `_mercenaries.ts` |
| **War Academy** | +X% village raid/sector‑war damage or sector‑war WR discount | world‑state raid |
| **Supply Depot** | +X WR per controlled sector (amplifies Loop 1 income) | sector benefits |
| **Treasury Vault** | −X% daily tax rate (one tier softer) and/or higher WR storage cap | tax loop |

- **Upgrade cost:** Honor Seals from the **treasury seal pool** (Loop 3), reusing the
  existing per‑level cost curve shape.
- **Daily maintenance:** WR from the village pool (Loop 1), §6.2 formula.
- **Shared state:** stored on the village record (`shared:village-war:<slug>`), not on
  characters — so there is exactly one source of truth and the Kage manages it.
- **Effects are additive and bounded**, applied at the same points the existing
  per‑player bonuses are read, so they compose without double‑dipping. Keep individual
  caps small (e.g. each ≤ +10–15% at L10) to protect war/defense balance.

**Maintenance shortfall behavior (save‑safe):** if the WR pool can't cover a day's
upkeep, structures don't get destroyed and don't lose levels — they go **dormant**
(their village‑wide bonus suspends) until the pool is positive again. The Kage gets a
warning notice the day before and on the day it happens. Reversible, no save risk.

---

## 8. Daily processing & where each deduction happens

Two distinct cadences, chosen to avoid a write‑storm over every save:

### 8.1 Village‑level daily pass — in cron (cheap: 4 records)
Add `runVillageWarDailyPass()` to `api/cron/_scheduler.ts`'s `fire()` (alongside
snapshot + ranked). For each of the 4 villages, inside
`withKvLock('shared:village-war:<slug>', …, { failClosed:true })`, guarded by
`lastWarPassDate !== today`:
1. Count controlled sectors (server‑authoritative, from territory/village ownership).
2. **Accrue** sector benefits: `+25 WR · sectors`, `+1 seal · sectors` to the pool.
3. **Deduct** structure maintenance (§6.2); flip under‑funded structures to dormant.
4. **Expire** mercenary contracts past their 2‑day window.
5. Stamp `lastWarPassDate = today`. Idempotent; re‑running same day is a no‑op.

Because it's only 4 records, this is trivial load and fits the existing single‑instance
cron model (disabled on cPanel secondaries via the existing env flag).

### 8.2 Player‑level tax — lazy, on game‑state load (no write‑storm)
**Do not** iterate every save in cron. Instead, when a player loads
(`/api/game-state` or first authed action of the day), inside
`withKvLock('save:<name>', …, { failClosed:true })`:
- **Skip entirely** if `rankFromLevel(level) === "Academy Student"` (level < 15) — no
  stamp, no debit.
- If `lastTaxDate < today`: read the village's current sector count → tier %; compute
  the base as **`ryo + bankRyo` minus the 5,000 exemption**; owed = `tier% × base`,
  for elapsed days **capped to 3 days** of catch‑up and to the 250k/day cap; debit
  **wallet first, then bank** for any remainder; credit the treasury (burn share
  applied); stamp `lastTaxDate = today`; `bumpSaveVersion`.
- Server‑computed; the client never supplies the amount or the tier. The treasury
  credit is a nested lock on the village record (debit‑before‑credit; on the rare
  contended credit, follow the seal‑pool precedent — debit already committed, fall
  through).

This scales with *active* players only, reuses the daily‑login idempotency pattern
verbatim, and — because Academy Students are skipped before any write — adds **zero**
load and zero save‑version churn for the entire new‑player population.

---

## 9. Regression surface & risks (read this twice)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Tax touches every player's wallet daily** — the most exposed live‑economy change | **High** | Flag‑gated default OFF; wealth exemption + daily cap + new‑player grace; lazy + idempotent + capped catch‑up; announce in‑game before enabling; telemetry watch (§12) |
| 2 | **Currency migration:** war‑declare & mercs move Honor Seals → WR | **High** | Keep Honor‑Seal code paths until WR is live; migrate atomically; preserve in‑flight wars + already‑hired mercs; update `server-routes.test.ts` + mercenary client mirror in lockstep |
| 3 | **Clan‑territory collision:** `world:territory.warSupply` is collected by **clans**; village map‑control reads village ownership of the same records | **High** | New WR/seal accrual must be **village‑keyed and computed in the daily pass**, never piggyback or zero `warSupply`. Do not change `world:territory` ownership semantics. Store war‑map village ownership in a dedicated field/record |
| 4 | **Per‑player upgrades** mistaken for the maintained structures | **Med** | §7 — new village layer is separate; per‑player upgrades untouched |
| 5 | **Dominant‑village paradox** (0% tax ⇒ no ryo income) breaks upkeep | **Med** | Solved by design: upkeep is WR (sector‑funded), not ryo |
| 6 | **Snowball / conquest to 0** — by owner choice a village can be wiped off the map and the strong compound | **Med (accepted by owner)** | Residual brakes: rock‑bottom comeback discount (0 sectors → free, 1 sector → 75% off on sector‑war + mercs), war‑engine limits (1h pending / decay / 14‑day cap / 7‑day rematch cooldown), per‑player tax cap + Academy exemption, dormancy not destruction. Watch the spread via telemetry; revisit if one village permanently locks the map |
| 7 | **App.tsx line‑budget ratchet** (`App.size.test.ts`, max ~10,139) | **Med** | New screen is its own module; App.tsx gets only the lazy‑import + 2–3 render lines; lower the budget after if we drain anything |
| 8 | **Committed `dist/` staleness** (cPanel serves committed dist verbatim) | **Med** | After any `api/`/`server.ts` change run `npm run build` and commit **root** `dist/` (+ client dist, force‑added) in the same change; Railway self‑builds |
| 9 | Route parity / CORS drift | **Med** | Register each new handler in `server.ts` (bare + `/api`); keep CORS headers synced; `npm test` parity gate |
| 10 | Honor‑Seal **Vanguard‑gating** consistency (map‑control seals are Vanguard‑only per‑player) | **Low** | Village seal‑pool accrual is village‑level, profession‑agnostic; keep the per‑player Vanguard rule unchanged |
| 11 | Cron double‑run on multi‑instance | **Low** | Reuse `DISABLE_SNAPSHOT_CRON` single‑instance assumption; idempotent date‑stamp makes a double‑fire a no‑op anyway |
| 12 | Mobile layout of the 32‑sector ownership overlay | **Low** | Horizontal‑scroll at ≤800px, fixed aspect; `isLowEndMobile()` degrades FX; ownership readable without color (banner marker + crest, §10) |

---

## 10. Client: the visual War Map screen + owned‑sector marking

### 10.1 New screen (own module — App.tsx budget)
- `shinobij.client/src/screens/VillageWarMap.tsx` — all logic/state/render here.
- Register `"villageWarMap"` in `src/types/core.ts`; add to `DEEP_LINKABLE_SCREENS`
  / `RESTORABLE_SCREENS` (hub‑like, **not** a battle screen) in
  `src/lib/screen-guards.ts`.
- App.tsx: one `lazyWithRetry` import + a 2–3‑line render branch; link from `Village`
  and `TownHall`.
- **Reuse `/api/world-state`** for wars/territories + a new read‑only
  `GET /api/village/war-map` that returns the assembled view (sectors, owners, WR/seal
  pools, tax tier, structure levels + upkeep + dormancy, active wars). All *actions*
  (declare/raid/capture/hire/upgrade) call dedicated server‑auth endpoints — the map is
  a view + launcher, not a new war engine.

### 10.2 Layout & overlay — built on the EXISTING world map, not a hex reskin
> Owner direction: the mock's hex grid was reference only, and we don't generate a
> replacement world‑map image. The "War Map" is the **existing** `WorldMap.tsx`
> geography with a polished **ownership treatment** layered on, plus a dedicated
> War‑Map panel/mode. High‑end, cohesive with the rest of the app — no toy hex board.
- **Ownership treatment on the live map:** each owned sector gets (a) a planted
  **village banner marker** at its centre (the four generated assets, §13), in the
  banner of **whoever currently holds it** (so a captured sector shows the conqueror's
  banner), (b) a sector outline/glow in that village's accent color, and (c) a small
  crest + alias label. Sectors **under active attack or recently flipped** pulse so the
  front line is obvious at a glance. The **central keep stays a neutral, unclaimable
  landmark** — no banner, no accent, never flips. Rendered as a `pointer-events:none`
  overlay over the existing sector tiles (same layering discipline as
  `components/SectorMap.tsx`), so it composes with the current map without touching its
  interaction code.
- **New sector‑map art (§13):** the per‑biome top‑down adventure maps are regenerated
  so each reads as *that village's territory* (its banners/outpost/colour woven into
  the terrain), served through the existing `sectorMapUrl()` / `public/sector-map/`
  pipeline — i.e. ownership is felt at the sector level too, not just via an overlay.
- **War‑Map panel** (`VillageWarMap.tsx`): the mock's info blocks — Tax System, Sector
  Benefits, War Costs, Hire Mercenaries, Summary — plus a Resources Overview bar (this
  village's WR + Honor‑Seal pools) and the live war/contribution state. This is the
  "command" surface; the map itself stays the navigable world map.
- Styling: new `src/styles/village-war-map-skin.css` imported in `index.css`; reuse
  the per‑village accents already in `atlas-skin.css` (Frostfang blue, Stormveil
  green, Ashen orange, Moonshadow purple). No Tailwind. Mobile: the existing world‑map
  horizontal‑scroll behavior at ≤800px is inherited; `isLowEndMobile()` drops the
  pulse/glow FX.

### 10.3 "This sector is owned by Village X" — the marking (asset deliverable)
Ownership must be obvious and **not rely on color alone** (accessibility). The
treatment per owned sector:
1. **Owned‑sector banner marker** — a planted village banner standee with the
   village's crest + a glowing claim‑ring at its base. *Already generated* (§13) — four
   transparent WebP markers, one per village, ready to pin at each owned sector's centre.
2. Sector border/glow in the village accent color (reinforcement, not the sole signal).
3. Crest watermark + `AL‑n` label on the sector.
4. Contested/under‑attack sectors pulse; the neutral central keep is dim/unclaimable.

This satisfies "make it noticeable on the world map that it's a village‑owned sector"
with a clear, colorblind‑safe, themed marker.

---

## 11. Decisions

### 11a. Locked by owner direction (this pass)
- **No new hex map** — the mock's grid was reference only; we edit ownership on the
  **existing sectors** and mark them on the existing world map (§4, §10).
- **Central is a neutral, non‑capturable hub** — owns no war sectors, can't be taken,
  excluded from every "sectors controlled" count (§4).
- **8 home sectors/village, all capturable, none protected, no floor** — a village can
  be conquered to 0, and holding enemy land earns more (conquest pays). The only
  anti‑deadlock rule: a **comeback discount on sector‑war + mercs — 0 sectors → free,
  1 sector → 75% off, ≥2 → full price** (§4, §6.3). Economy re‑tuned to the full 0–8
  range (§6).
- **Tax base = wallet ryo + banked ryo** — banking is not a shelter (§6.4).
- **Academy Students (level < 15) pay no tax** — onboarding is never taxed (§6.4, §8.2).
- **Generate new sector‑map art** (per village), **not** a world‑map image (§13).
- **Look must be high‑end / professional** — ownership treatment composes onto the
  real map and the regenerated sector art; no toy hex board.

### 11b. Still open (recommendation in **bold**)
1. **Structures: new village‑level layer vs. upkeep on existing per‑player upgrades?**
   → **New village‑level layer** (§7). Safer, no live per‑player churn.
2. **War Resources scope: village‑pool only vs. also personal?** → **Village‑pool
   only.** No 9th personal currency, no save migration, fewer exploits.
3. **Maintenance currency: WR vs. ryo?** → **WR** (solves the 0%‑tax paradox; classic
   sector‑funded upkeep).
4. **Tax split: burn vs. treasury?** → **50% burn / 50% treasury** default (real
   inflation sink; one tunable constant 0–100%).
5. **Mercenary tiers** → **DECIDED (§17.5):** keep the 5 tiers, WR‑priced, reworked into
   2‑day hired AI squads (Option B).
6. **New map vs. existing `VillageWarScreen`?** → **Beside** — the War‑Map panel is the
   command surface; the existing screen stays as the detailed war‑actions/log view (no
   war‑engine rewrite).

(Surfaced rather than asked mid‑flight because you requested a plan. Flag any in 11b you
want changed and the numbers/loops adjust accordingly.)

---

## 12. Build roadmap — dependency‑ordered, flag‑gated

**Pet sequencing — DECIDED: Combat + Card ship in v1; Pet is a fast‑follow (§17.2).**
Combat and Card already resolve winners server‑side (ready now); Pet needs the
deterministic sims wired server‑side (its own anti‑cheat surface). Shipping the two
ready types first delivers the feature sooner and de‑risks; the **max‑7** rule simply
spans the two live types until Pet lands.

**Flags (all default OFF):**
- `villageWarMap.v1` — master: the WR economy, structures, war modes, the War‑Map UI.
- `villageTax.v1` — **sub‑flag** for the lazy per‑player tax (the riskiest,
  wallet‑touching piece) so the rest can go live before it.
- `sectorMap.v1` — existing flag, gates swapping in the new per‑village sector art.
- Pet win‑condition gated on the server‑sim readiness (Phase 7) — not on by default
  until pet outcomes are authoritative.

**Phases** — each ends with `npm test` (root) + `npm run lint` (client) + a `dist`
rebuild/commit for any `api`/`server.ts` change (cPanel serves committed `dist`):

| # | Phase | What lands | Key tests |
|---|---|---|---|
| 0 | **Foundations (no behavior change)** | `api/_war-economy.ts` constants (§6); `war-map-sectors` table (§4); the `shared:village-war:<slug>` record schema — WR pool, 6 structures, 8 sector win‑conditions, terrain overrides, per‑sector Control HP, dormancy flags, `lastWarPassDate`; WR as a village‑pool field | pure‑core unit tests |
| 1 | **Economy passes** | daily village pass — WR/seal accrual + structure maintenance + dormancy + merc‑lease expiry (cron, idempotent); lazy per‑player **tax** behind `villageTax.v1` | tax tiers/exemption/cap/grace, maintenance curve, accrual, dormancy (mirror `_map-control-reward.ts` test style) |
| 2 | **Village‑level structures** | the 6 shared structures (§7) — upgrade from treasury seals, daily WR upkeep, dormancy, bounded effects wired into existing read points | upgrade cost, upkeep, dormancy on/off, effect caps |
| 3 | **Village‑war changes (reuse engine)** | declare cost → **800 WR**; **decouple territory** (war‑ground = in‑war HP objective, no map flip); **add winner buff** (mirror the existing loser‑debuff mechanism); keep spoils; migrate any in‑flight wars | spoils unchanged, buff/debuff apply, migration safe, route parity |
| 4 | **Sector‑war engine** | per‑sector **Control HP** (§17.6); sector‑war declare (250 WR + comeback discount); **win‑condition assignment** (Kage, max‑7); **Combat + Card** resolvers deal Control‑HP damage → flip + reset + persist; concurrency (multi vs different villages; mutually exclusive with village war); **terrain editing** (Kage 3 + elders 1) sealed into Combat sessions; village‑guard → sector‑defense wiring; keep contribution/MVP rewards | Control‑HP/flip, win‑condition cap, terrain buff in session, concurrency guards, persist |
| 5 | **Mercenaries (Option B)** | AI‑squad lease (WR · 2‑day · tier‑level · geared · **no pet summons**) for Combat sector wars; comeback free/−75%; refund‑on‑fail; reuse AI‑opponent infra | lease expiry, cost/refund, no‑pet rule, flip‑gating knob |
| 6 | **Client War‑Map view + UI** | ownership treatment on the existing world map (banner markers, glow, pulse, neutral central); War‑Map command panel (tax/benefits/costs/mercs/summary/resources); per‑win‑condition Attack wiring; Kage/elder management UI (structures, terrain, win‑conditions); **notifications / war feed** (§16b #7); mobile + `isLowEndMobile`; sector art behind `sectorMap.v1`; App.tsx budget | `App.size.test.ts`, lint, snapshot of overlay |
| 7 | **Pet win‑condition (fast‑follow)** | wire `pet-duel-sim` (1v1) + `pet-arena-sim` (4v4) to **resolve server‑side**; defender‑picks‑format; enable Pet as the third win‑condition | server‑auth pet outcome, format pick |
| 8 | **Telemetry + tuning + staged enable** | emit WR in/out, tax collected/burned, maintenance, dormancy, war/merc spend; enable flags for one test cohort; re‑fit §6; then global | telemetry sanity |

**Cross‑cutting tests:** `server-routes.test.ts` parity for every new endpoint;
`App.size.test.ts` budget; CORS sync (`api/_utils.ts` ↔ `server.ts`).
**Telemetry** (`economy-telemetry-plan.md`) is what lets the §6 numbers be re‑fit from
real data instead of guesswork — wire it before the staged enable.

---

## 13. Art assets (generated this pass)

All generated via the project's own gpt‑image‑1 pipeline so the output matches
in‑app art, and **staged only — no code/assets changed in place**. (Per owner
direction: **no world‑map image was generated.**)

**A. Owned‑sector banner markers** — transparent WebP, ~18–20 KB each, ~512 px tall,
in `shinobij.client/asset-gen-out/village-war-map/`. Planted village banner + crest +
glowing claim‑ring; the overlay that marks an owned sector on the live map (§10.3),
colorblind‑safe (shape + crest, not color alone):
- `owned-sector-ashenleaf.webp` — ember/flame crest, orange claim‑ring
- `owned-sector-frostfang.webp` — fanged‑snowflake crest, blue claim‑ring
- `owned-sector-stormveil.webp` — lightning‑over‑leaf crest, green claim‑ring
- `owned-sector-moonshadow.webp` — crescent‑moon crest, purple claim‑ring

**B. Owned‑sector maps** — full top‑down adventure maps (1408 px, "worldmap" style to
match the game), in `…/village-war-map/sector-maps/`. Each biome regenerated so the
terrain itself reads as that village's held territory (its banners + a themed outpost
woven into the existing biome's paths/POIs); drop‑in for the `public/sector-map/<biome>.webp`
pipeline behind `sectorMap.v1`:
- `sector-map-frostfang.webp` (snow) · `sector-map-moonshadow.webp` (shadow) ·
  `sector-map-stormveil.webp` (forest) · `sector-map-ashenleaf.webp` (volcano) ·
  `sector-map-central.webp` (contested neutral keep)

**To use:** review, then either publish via `gen-asset.mjs --publish` /admin, or move
markers into `src/assets/` and the maps into `public/sector-map/`, and reference them
from the new screen. The map prompts deliberately exclude characters/text/grid so they
drop straight into the existing sector renderer.

> Asset note (from memory): rebuilding `client/dist` re‑compresses **all** PNGs and
> can corrupt one mid‑build — when these ship, commit only the new `.webp` (and the
> `.js/.css/.html`), not the whole image churn.

---

## 14. Research basis (external, for the balance choices)

Genre conventions (comparable shinobi browser RPGs, kept generic per project policy):
villages as territorial hubs sitting in numbered map sectors, Kage leadership
declaring wars, multi‑stage village raids, perpetual war‑zone tug‑of‑war for
strategic relays, and per‑territory resources — all of which this plan mirrors and
which the game already implements in part.

Economy/upkeep design (named, non‑genre sources):
- **Percentage / wealth‑scaling sinks** stay effective when fixed ones don't (Albion,
  EVE MER) → drives the %‑of‑wallet tax and the wealth exemption.
- **Polynomial upkeep scaling** with level (CivFanatics building/unit‑maintenance
  threads; Civ era‑scaled upkeep) → the `level^1.25` maintenance curve.
- **Faucet ≈ sink, kept taut; match the math‑class** (Koster AGC; Cook/Lost Garden;
  EVE MER) → the WR income vs. upkeep ceiling, and tax as the wealth‑scaling
  counterweight to the wealth‑scaling bank‑interest faucet flagged in
  `economy-progression-redesign.md`.

---

## 15. Summary of what changes vs. what stays

**New:** War Resources (village pool) · daily Tax (personal ryo, wallet+bank, Academy‑
exempt) · 6 village‑level structures with daily WR maintenance + dormancy · **Sector War**
— a light per‑sector conflict with its own **Control HP**, a Kage‑chosen win‑condition
(Combat / Card [/ Pet], max‑7 of any type) and per‑sector terrain (Kage 3 + elders 1) ·
hired **AI merc squads** for Combat sector wars · a War‑Map view + ownership treatment on
the **existing** world map (banner markers, no hex board) · 8‑home sector ownership, all
capturable (0–8, no floor, conquest pays; comeback discount on sector‑war + mercs: 0 →
free, 1 → 75% off) with a neutral non‑capturable central hub · a daily village pass in
cron · lazy per‑player tax · new read + sector‑war endpoints.

**Changed:** war‑declare cost 500 seals → **800 WR** · mercenaries Honor Seals → WR,
reworked into 2‑day hired **AI squads** (Option B) · **Village War decoupled from
territory** (no longer flips sectors) **+ a winner buff added** (it only had a loser
debuff) · sector benefits become a village‑pool accrual · terrain becomes
leadership‑editable.

**Untouched (no regression):** the existing 8 per‑player upgrades · the village‑war
HP/decay/spoils math (only the declare currency, the territory‑coupling, and the new
winner buff change) · clan territory + `warSupply` collection · Kage/ANBU · treasury
donate/withdraw · per‑player map‑control reward · Vanguard seal gating · all other
currencies · saves (tax is additive, idempotent, capped, flag‑gated).

**Tests/build discipline:** `npm test` (root) + `npm run lint` (client) every phase;
rebuild + commit `dist/` for cPanel on any `api`/`server` change; flag default OFF
until telemetry confirms the §6 tuning.

---

## 16. Open gaps to resolve before building (completeness pass)

Things the plan does **not** yet pin down. Most are in the seams with the existing war
engine, not the new economy. Grouped by how blocking they are.

### 16a. Resolved by owner — now specified in §17
1. **Per‑sector capture** — yes: a **sector war** flips one sector at a time via that
   sector's win‑condition; village war no longer changes ownership (§17.1). Giving each
   sector its own HP/flip (reusing the existing flip logic) is still the biggest build.
2. **Village war ↔ sector war + concurrency** — **distinct, mutually exclusive modes**;
   **multiple sector wars vs different villages** allowed; village war stays 1v1 (§17.1).
3. **Captured sectors persist** (owner‑confirmed) — lose a sector war and the sector is
   the winner's and stays the winner's; flips reset Control HP under the new owner
   (§17.1, §17.6).
4. **Permissions** — **Kage** declares + spends WR; **elders** set 1 sector's terrain
   each; any member fights (§17.4).
5. **Mercenaries** — **Option B chosen**: a 2‑day hired **AI squad** (fully geared,
   tier‑level; Lv100 = Kage‑level fight) for **Combat** sector wars, **no pet summons**
   (§17.5).

### 16b. Should add — or the feature feels broken
6. **Individual incentives + defense wiring.** WR goes to the *village*, not the fighter
   — so **keep the existing per‑player contribution → war‑crate / MVP / bounty rewards**
   so players actually fight, and wire the **village‑guard queue → sector defense**
   (defenders protect the sector under attack).
7. **Notifications / legibility.** Players must see: your village is under attack, you
   lost/took sector X, your tax tier changed, a structure went dormant, mercs expired.
   A war feed + Kage alerts — otherwise the whole war is invisible and nobody shows up.
8. **No‑village / switching players.** Tax applies only to village members — define the
   no‑village case (no tax) and what happens to the tax stamp when a player changes
   villages (no double‑tax, no dodging by hopping).

### 16c. Balance watch‑items (telemetry‑tune, not blockers)
9. **Population imbalance** — the deepest fairness risk: a 50‑player village beats a
   5‑player one regardless of economy. Consider scaling defense/WR inversely to roster
   size or soft matchmaking. Flag and watch; don't over‑engineer v1.
10. **Peace equilibrium / collusion** — if all four sit at 8 sectors nobody is taxed and
    WR just banks; the inflation sink only fires during war. Add a **WR storage cap** so
    hoarding is bounded, and accept peace = no pressure (or a tiny baseline upkeep).
11. **Tax timing** — lazy tax reads the sector count at login; mid‑day swings make it
    slightly path‑dependent. Acceptable — note it.

**Explicitly out of scope (unchanged):** clan wars, ranked seasons, the roaming/wanderer
sectors. **Sub‑flag suggestion:** gate the **tax** behind its own flag so WR + structures
can go live before the riskiest, wallet‑touching piece.

---

## 17. Combat layer — village war, sector war, win‑conditions, terrain, mercenaries

Resolves §16a per owner rulings, grounded in a read of the existing war engine + a
battle‑type **server‑authority audit** (decisive — CLAUDE.md: never trust the client
for outcomes).

### 17.1 Two distinct conflict modes (owner ruling #3)
| | **Village War** (exists, keep) | **Sector War** (new) |
|---|---|---|
| Scale | all‑out, the whole village | one sector |
| Trigger | Kage declares · 800 WR | Kage declares · 250 WR (0 sectors → free · 1 → 75% off) |
| Mechanic | 5,000‑HP tug‑of‑war (existing engine) | **one battle**, resolved by that sector's win‑condition |
| Outcome | **steal treasury** (15% ryo/honor + 10% fate) **+ village‑wide buff (winner) / debuff (loser)** | **flips that one sector's ownership** |
| Territory | **does NOT change sector ownership** (decoupled) | the only thing that moves the map |
| Length | long (14‑day cap, decay, 1h pending) | short |
| Concurrency | 1v1 · 7‑day rematch cooldown | **multiple at once vs different villages** |

**The two modes are mutually exclusive (owner ruling #2):** a village in a village war
cannot run sector wars, and vice‑versa.

- **Village War keeps the existing engine** (`api/world-state.ts`): 5,000 HP, raids,
  decay, MVP/contributions, spoils on win (`_war-spoils.ts` 15%/10%), 3‑day loser
  debuff. **Two changes:** (a) declare cost 500 Honor Seals → **800 WR**; (b) **add a
  winner buff** — today only the loser is marked ("Demoralized"); the winner gets nothing
  village‑wide. Define a winner buff set (e.g. +X% combat / +X% income / −X% upkeep for N
  days) to match ruling #3. The war‑ground sector stays an **in‑war HP objective only**
  (it already drains enemy HP) and **no longer flips map ownership** — that moves
  entirely to sector war.
- **Sector War is new and light:** Kage targets one enemy‑held sector; the fight uses
  **that sector's win‑condition** (17.2); a win flips the sector. Being per‑sector and
  short, a village can prosecute **several at once vs different villages** — never while
  a village war is active.

### 17.2 Sector win‑conditions — the Kage's rock‑paper‑scissors (owner ruling #1)
The defending Kage assigns **each of the 8 owned sectors** a win‑condition — **Combat**,
**Card Battle**, or **Pet Battle** — and an attacker contesting a sector must win *that*
type. **No single type may be on more than 7 sectors**, so at least two types are always
in play and an attacker can't take the map with one competency (tactical RPS; "defender
sets the conditions" is the genre norm — Tibia/Albion).

**Server‑authority audit (this gates which types are safe):**

| Win‑condition | Server‑authoritative winner? | Reuse | Status |
|---|---|---|---|
| **Combat (PvP)** | ✅ winner from sealed HP (`api/pvp/move.ts`) | the existing `sectorAttack` DuelChallenge → PvP session already does attacker‑vs‑defender and seals the sector biome → terrain buff applies (`api/village-guard/challenge.ts`) | **Ready** |
| **Card Battle** | ✅ full engine runs server‑side, deterministic winner (`api/clan/war/_card-clash-engine.ts`) | fork the clan‑war card duel into a sector‑card session | **Ready** (needs a thin sector wrapper) |
| **Pet Battle** | ⚠️ **client‑run** — the autobattler runs in the browser; the server only validates a *claimed* outcome with daily caps (`api/pet/battle-result.ts`) | — | **NOT safe as‑is** |

**Pet battle is the one real blocker.** Trusting a client‑claimed pet result to flip
territory is exploitable. **Sequencing — DECIDED (§12):** ship **Combat + Card in v1**
(both already server‑authoritative); **Pet fast‑follows (Phase 7)** once the deterministic
sims run **server‑side** — `pet-duel-sim` (1v1) + `pet-arena-sim` (4v4), both already
built — sealing both loadouts and letting the server decide, same trust model as PvP/Card.
Until Pet lands, the **max‑7** rule simply spans the two live types.

**Per‑type attack‑button wiring (owner ask).** A sector's win‑condition determines what its
**Attack** button launches:
- **Combat** → a PvP shinobi fight (the existing `sectorAttack` DuelChallenge → PvP
  session). **No pet summons** here — pure shinobi battle (§17.5).
- **Card** → a Card Clash duel (forked clan‑war engine).
- **Pet** → a PvP **pet** battle, and **the defender (the attacked) chooses the format:
  Tactical 4v4 or Coliseum 1v1** (owner ruling). 4v4 → `pet-arena-sim`, 1v1 →
  `pet-duel-sim`; **both must be resolved server‑side** for the flip to be cheat‑proof
  (the pet blocker above). This is another "defender sets the conditions" layer.

### 17.3 Terrain control (owner ruling #6)
Terrain is already a per‑sector field (`terrainBuffStat`) that already affects combat:
**+10% to one jutsu school** — forest→Taijutsu, snow→Bukijutsu, volcano→Ninjutsu,
shadow→Genjutsu, central→none (`api/pvp/move.ts terrainMultiplier`). It's just not
player‑editable yet.

- **Kage sets terrain on 3 owned sectors; each elder (ANBU, up to 3) on 1** → up to
  **6 of 8** customized, the rest default to their biome.
- The chosen terrain buffs the **defender** in that sector's fight (home advantage — the
  research's "reward the defender" lesson). **Combat** sectors feed the existing
  `terrainMultiplier`; **Pet** (once server‑side) maps terrain to a pet‑element bonus;
  **Card** is terrain‑neutral for v1 (or a small location‑pool tweak — TBD).
- Implementation just exposes editing the field and seals it into the sector's battle
  session. Lets a Taijutsu‑heavy village stack Forest terrain on its Combat sectors to
  compound its strength.

### 17.4 Permissions (owner ruling #4)
- **Kage:** declares village war + sector wars, spends the WR pool (incl. mercenaries),
  assigns the 8 sector win‑conditions, sets terrain on 3 sectors, upgrades structures.
- **Elders (ANBU, up to 3):** set terrain on 1 sector each. No WR spend.
- **Any member:** fights (raids/defends/champions a sector); contribution → existing
  MVP / war‑crate rewards so individuals stay motivated (§16b #6).

### 17.5 Mercenaries — how they work today, and the rework question (owner ruling #5)
**Today (a one‑time HP chunk in a *village* war):** during an active village war a player
hires a tier (`api/village/hire-mercenary.ts`); the server deducts **Honor Seals**
(recomputed from a sealed table, under a save lock), marks it **once‑per‑tier‑per‑war**
(NX marker), and applies a **one‑time burst of damage to the enemy village's HP**,
**floored at 1 so a merc can never end a war** (a live player must land the kill).
Damage credits the hirer's contributions (MVP); a failed write **atomically refunds** the
seals. Five tiers: 150→1000 seals for 120→750 damage. **No duration, no re‑hire, no
ongoing effect.** So a "mercenary" today is really *"spend seals to chunk the enemy
village's HP, once."*

**Rework — DECIDED: Option B, a hired AI squad for sector wars (owner ruling).** Hiring
a merc tier fields a **group of fully‑geared, smart‑AI shinobi at that tier's level** that
fight on your side in **sector‑war battles**, on a **2‑day WR lease** (re‑hireable when it
lapses; free at 0 sectors / −75% at 1 per §6.3). The tier *is* the squad's level/strength:
Lv75 → Lv100, where **Lv100 is a Kage‑level fight** (a serious force). Reuses the existing
AI‑opponent/AI‑defender infrastructure (the village‑guard already spins up a geared AI
fighter from a level + archetype — here it's a squad of them). Rules:
- **Combat‑type sectors (v1).** Mercs are geared *shinobi* (weapons/armor/jutsu), so they
  contest **Combat** sectors; on Pet/Card sectors you field your own pets/deck. So the
  free‑mercs‑at‑0 comeback specifically helps retake **Combat** sectors — a clean foothold.
- **No pet summons in these war PvE fights** (owner ruling). In merc/Combat sector battles
  pet summoning is **disabled** — pure shinobi fights. (Pets only appear in Pet‑type
  sectors, §17.2.)
- Fully geared + smart AI scaled to tier; Lv100 = Kage‑calibre loadout/AI.
- Keep the **WR cost + 2‑day lease + refund‑on‑fail**; drop the old once‑per‑tier‑per‑war
  marker (the lease replaces it). Numbers reuse the §6.3 WR tier prices (60–420).
- **Anti‑AFK knob:** decide whether a merc squad can *flip* a sector outright or only chip
  its Control HP (§17.6) with a live player landing the final battle (the existing
  "players land the kill" principle). **Rec: mercs can flip in sector wars** — lower stakes
  than a village war and needed for the comeback — gated by WR cost + 2‑day expiry + the
  battle difficulty/terrain.

### 17.6 Sector Control HP — how a sector war actually resolves (owner ask)
A sector war isn't a single battle — each sector has its own **Control HP** bar (its
defensive health), and the attacker grinds it down through repeated **win‑condition
battles** until it breaks and flips. Sized to be **short** vs the village war's 5,000 HP:

- **Control HP default 600** per sector (tunable; well under the war‑ground's 1,000).
- A won battle of the sector's type deals **~150 HP** to it → **~4 wins to flip** (scale by
  margin/level if desired). A **defender win holds the line** — no loss, plus a small
  **+50 regen** so an active defense outlasts a half‑hearted siege.
- At **0 HP the sector flips to the attacker and resets to full** under the new owner (it
  must then be defended afresh). **Lose the sector war and the sector is the winner's and
  stays the winner's** — captures persist (owner ruling, §17.1).
- Both **live players and hired merc squads** (Combat sectors) deal Control‑HP damage on
  wins; **terrain + defender home advantage** make each attacker win harder to get.
- The bar is the siege‑progress UI, gives defenders a window to rally, and makes "shorter
  than a village war" concrete (~4 battles, not a 14‑day HP grind). It is **separate** from
  the village‑war 5,000‑HP pool and the war‑ground's 1,000 HP — a sector at full Control HP
  simply reads "secure."

*(Reuse note: this mirrors the existing `warGroundHp` pattern (`api/world-state.ts`) but
applied per home sector, with damage driven by win‑condition battle outcomes instead of raw
raids.)*
