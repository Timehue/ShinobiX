# Profession System

Unlocks at **Level 13**. Each player picks one active profession. Each profession has its own XP and rank progression (1–10).

Starting professions: **Healer**, **Vanguard**, **Pet Tamer**.

Profession choice is **permanent** (profession swap deferred for v1). Presented as a visual-novel-style picker — see [Profession Picker (Visual Novel)](#profession-picker-visual-novel) below.

---

## 1. Healer

Support profession. Heals other players from the hospital screen. Visibility of who needs healing is gated by rank.

### Core mechanics

- **No global healing cooldown.** Healers can heal as often as they want.
- **Per-target cooldown: 5 minutes.** Any Healer healing the same target triggers this lockout — prevents two-Healer ping-pong farming. Cooldown is on the target, not on the (Healer, target) pair.
- **Healer must be at the hospital screen to cast heals.** Heal actions are issued from the hospital UI.
- **Cannot heal players in active battle.** Target must not be `inBattle` or have `pendingAttacker` set. (See [api/pvp/session.ts](api/pvp/session.ts) for battle state.)
- **Cannot heal cross-village.** Healer and target must be in the same village, even for clan members.
- **Self-heal allowed but grants no Healer XP.**

### Healer vision (rank progression payoff)

- **Ranks 1–9:** Healer sees injured / low-HP players **in the village hospital** who are **not in combat**. Heal them from the hospital screen.
- **Rank 10:** Healer additionally sees **all injured players from the same village** anywhere in the world. Can heal them remotely from the hospital.

Healer power scales by **scope of who you can help**, not by reduced cooldown.

> **Server-side filtering required:** the list of injured players must be filtered server-side — never send all player HP/location data to the client and rely on a UI filter. Hostile clients could mine it for PvP intel.

### Healer XP

- **XP = percent of HP restored.** A heal that restores 50% of target's max HP = 50 XP. A heal that restores 80% = 80 XP. Caps at 100 XP per heal.
- **Healer needs more total XP than other professions** — uses the **1.5× XP curve** (see XP curves section).
- **Synergy bonus:** Healing a player who was hospitalized from a raid within the last 10 min = +50% XP for that heal.

### Healer XP sources

- Heal another player (XP = % HP restored)
- Complete healing missions
- Heal clan members or village allies (same heal action, no extra modifier)

### Healer missions

| Tier | Objective (unique players) | Reward |
|------|----------------------------|--------|
| 1 | Heal 5 unique players | Healer XP + Ryo |
| 2 | Heal 10 unique players | Healer XP + Ryo + medical supplies |
| 3 | Heal 25 unique players | Healer XP + Ryo |
| 4 | Heal 50 unique players | Healer XP + Ryo |
| 5 | Heal 100 unique players | Healer XP + Ryo + Hospital contribution points |

Mission counters track **unique players** — healing the same buddy 5x does not complete "heal 5 unique players."

---

## 2. Vanguard

PvP and raid profession. Only profession that earns **Honor Seals**.

### Core mechanics

- Vanguard XP and Honor Seals are earned **from PvP player kills only**. AI defender kills give 0 XP and 0 Seals.
- **AI defenders still count the raid toward raid missions** — fighting AI defenders progresses "Raid 3 villages" missions even though the kills themselves give nothing.
- Mission completion rewards (XP + Seals + Ryo) are paid out regardless of whether defenders were human or AI.
- **No raid mission cooldown** — missions can be chained.

### Vanguard rank progression

| Rank | Seals/PvP Kill | Bonus |
|------|----------------|-------|
| 1 | 1 | — |
| 2 | 1 | +10% Vanguard XP |
| 3 | 2 | — |
| 4 | 2 | +25% Ryo from raid missions |
| 5 | 3 | — |
| 6 | 3 | +1 active raid mission slot |
| 7 | 4 | — |
| 8 | 4 | 10% Honor Seal discount on jutsu training (non-retroactive) |
| 9 | 5 | — |
| 10 | 5 | +1 Seal per raid mission completion |

### Vanguard XP

- **XP per PvP kill:** 100 base + 10 per target level above 30 (max ~800 XP for a Level 100 kill)
- **Raid mission completion:** XP per mission tier
- AI defender kills: 0 XP

### Vanguard missions

- Raid 1 enemy village
- Raid 3 enemy villages
- Raid 5 enemy villages
- Defeat 3 unique enemy defenders (AI counts)
- Win 5 unique PvP battles (real players only)
- Defeat 10 unique enemy village shinobi (real players only)

Mission counters track **unique targets** where applicable.

### Vanguard XP sources

- PvP player kills
- Raid mission completion
- Defending own village from human raiders (PvP kills)

### Anti-abuse rules

| Rule | Number |
|------|--------|
| Max Honor Seals per unique target per day | 3 (4th+ kill from same target = 0 Seals) |
| Level gap for full Seal reward | Within 10 levels of attacker |
| Level gap with reduced reward | 10–20 levels below = 50% Seals |
| Level gap with no reward | >20 levels below attacker = 0 Seals |
| Daily Honor Seal cap | 50 per day |
| Quick-surrender protection | Fights ending in <15 seconds = 0 Seals |
| Friendly duels | 0 Seals |
| Same-IP within last 7 days | 0 Seals (alt-account protection) |
| Target account <72 hours old | 0 Seals (alt-account protection) |

---

## 3. Pet Tamer

Pet-focused profession. Makes pets stronger in PvE, trains pets faster, gets better expedition rewards.

### Phased rollout

**Phase 1 (launches with profession system):** PvE pet damage multiplier only — no new infrastructure required.

**Phase 2 (after pet training and expedition systems exist):** Training speed bonus + expedition reward improvements.

### Pet Tamer rank progression (Phase 1 — PvE damage)

| Rank | PvE Pet Damage Bonus |
|------|---------------------|
| Unlock | +5.0% |
| Rank 1 | +6.5% |
| Rank 2 | +8.0% |
| Rank 3 | +9.5% |
| Rank 4 | +11.0% |
| Rank 5 | +12.5% |
| Rank 6 | +14.0% |
| Rank 7 | +15.5% |
| Rank 8 | +17.0% |
| Rank 9 | +18.5% |
| Rank 10 | +20.0% |

+1.5% per rank. **Applies in PvE only.** Does NOT apply in PvP, including AI-defended village raids.

### Pet Tamer rank progression (Phase 2 — training speed)

| Rank | Pet Training Speed |
|------|-------------------|
| Unlock | +10% faster |
| Rank 3 | +12% faster |
| Rank 5 | +15% faster |
| Rank 7 | +17% faster |
| Rank 10 | +20% faster |

### Pet Tamer XP

- **5 XP per minute of expedition duration.** A 30-minute expedition = 150 XP. A 4-hour expedition = 1,200 XP.
- **Long-expedition bonuses:** +50% XP for expeditions ≥1 hour, +100% XP for expeditions ≥4 hours (rewards committing to longer runs).
- **Daily "First Expedition" bonus:** 2× Tamer XP on the first completed expedition each day (login hook).
- **Pet escort synergy:** +20% Tamer XP on the next expedition after a successful escorted raid (see Cross-profession synergies).
- Canceled expeditions: 0 XP.
- Expeditions under 10 min: 0 XP (anti-spam).

### Improved expedition rewards (Phase 2)

- More pet XP
- More pet food
- More Ryo
- More materials
- Higher chance at rare expedition rewards
- Small chance at bonus loot

---

## Honor Seal sinks

The currency Vanguards earn needs sinks. Three sinks ship with the system; none affect PvP balance.

### Sink 1 — Jutsu level 30→40 via Honor Seals

Currently jutsu leveling 30→50 requires PvP. Honor Seals provide an alternative path for **levels 30→40 only**. Levels 40→50 still require PvP — preserves high-end PvP pressure.

| Jutsu Level | Honor Seal Cost |
|-------------|-----------------|
| 30 → 31 | 20 |
| 31 → 32 | 25 |
| 32 → 33 | 30 |
| 33 → 34 | 35 |
| 34 → 35 | 40 |
| 35 → 36 | 45 |
| 36 → 37 | 50 |
| 37 → 38 | 55 |
| 38 → 39 | 60 |
| 39 → 40 | 65 |
| **Total 30→40** | **425 Seals** |

No power increase vs the PvP path — same end state, different route. Bloodline-locked jutsu are eligible.

### Sink 2 — Jutsu training speedup

Spend Honor Seals to reduce the current training timer.

- 1 Seal = -10 min off current training timer
- 10 Seals = finish current training instantly

No power increase, just time skip.

### Sink 3 — Clan donation

Solves the Vanguards-earn-but-don't-personally-need-Seals asymmetry. Lets the village/clan benefit from Vanguard activity.

- **Vanguard can donate to clan pool:** up to **50% of their current Seal balance per day** can be donated.
- **Clan leader distributes the pool:** clan leader assigns Seals from the pool to specific clan members.
- **Recipients can spend on Sink 1 (jutsu 30→40) and Sink 2 (training speedup).** They cannot re-donate or transfer further.
- **Pool has no cap;** untouched Seals persist in the pool.
- **Donations are non-refundable.**

This turns Vanguard activity into clan utility and rewards the social/political side of clan leadership.

### Vanguard Rank 8 discount

Vanguards at Rank 8+ pay **90% cost** on all Honor Seal jutsu transactions (Sink 1 and Sink 2). Discount is **non-retroactive** — only applies to transactions made at/after Rank 8.

Discount applies whether the Seals came from PvP kills or clan-donated.

---

## XP curves

Target: ~30 days of moderately active play to reach Rank 10.

### Baseline curve (Vanguard, Pet Tamer)

| Rank | XP to next | Cumulative |
|------|-----------|------------|
| 1 → 2 | 100 | 100 |
| 2 → 3 | 250 | 350 |
| 3 → 4 | 500 | 850 |
| 4 → 5 | 1,000 | 1,850 |
| 5 → 6 | 2,000 | 3,850 |
| 6 → 7 | 3,500 | 7,350 |
| 7 → 8 | 5,500 | 12,850 |
| 8 → 9 | 8,000 | 20,850 |
| 9 → 10 | 12,000 | 32,850 |

### Healer curve = 1.5× baseline

| Rank | XP to next | Cumulative |
|------|-----------|------------|
| 1 → 2 | 150 | 150 |
| 2 → 3 | 375 | 525 |
| 3 → 4 | 750 | 1,275 |
| 4 → 5 | 1,500 | 2,775 |
| 5 → 6 | 3,000 | 5,775 |
| 6 → 7 | 5,250 | 11,025 |
| 7 → 8 | 8,250 | 19,275 |
| 8 → 9 | 12,000 | 31,275 |
| 9 → 10 | 18,000 | 49,275 |

### Time-to-Rank-10 sanity check

| Profession | Per-action XP | Expected daily XP | Days to Rank 10 |
|------------|--------------|-------------------|-----------------|
| Healer | ~60 XP/heal (avg) | ~1,800 (30 heals) | ~27 days |
| Vanguard | ~300 XP/kill (Lv 50) | ~4,500 (15 kills) | ~7 days |
| Pet Tamer | 5 XP/min + bonuses | ~750 (4 expeditions) | ~44 days |

Vanguard is intentionally fast for highly active PvPers. Pet Tamer is slow but largely passive. Healer sits in the middle.

---

## Cross-profession synergies

Both reuse existing systems, no new infrastructure beyond profession identity checks:

1. **Healer assist bonus:** Healing a player hospitalized from a raid within the last 10 min gives +50% Healer XP for that heal.
2. **Pet escort:** A Pet Tamer's pet can accompany a Vanguard on a raid. Pet's PvE multiplier does NOT apply in PvP combat, but:
   - The Vanguard earns **+5% Honor Seals** on PvP raid kills while the pet is present.
   - The Pet Tamer earns **+20% Tamer XP on the next expedition** after a successful escorted raid.

---

## Profession Picker (Visual Novel)

Triggered automatically on next login after reaching **Level 13**. Player cannot dismiss without choosing — profession is part of progression.

### Page 1 — Intro narrative

Visual novel layout: full-screen backdrop (village scene), text box at bottom, character/elder portrait on the left or right.

**Suggested narrative copy** (adjust to game's voice):

> The village elder eyes you carefully.
>
> *"You have grown stronger. Your skills have caught my attention — and the attention of the village. The time has come to choose your path."*
>
> *"Three paths are open to a shinobi of your standing. The Healer mends what war breaks. The Vanguard leads the charge against our enemies. The Pet Tamer walks with beasts and bends them to their will."*
>
> *"Choose wisely. Your choice will shape who you become."*

[**Continue ▶**]

### Page 2 — Choice screen

Three large choice cards displayed side-by-side. Each card shows:
- Profession name (large)
- Profession icon / illustration
- One-line tagline
- 2–3 bullet summary of core mechanic

| Card | Tagline | Summary |
|------|---------|---------|
| **Pet Tamer** | "Walk with beasts." | • Pets +5–20% stronger in PvE<br/>• Faster pet training<br/>• Better expedition rewards |
| **Healer** | "Mend what war breaks." | • Heal allies from the hospital<br/>• See injured villagers at Rank 10<br/>• No healing cooldown |
| **Vanguard** | "Lead the charge." | • Earn Honor Seals from PvP kills<br/>• Raid enemy villages<br/>• Discount jutsu training at Rank 8 |

Hovering a card highlights it; clicking selects it.

### Confirmation modal

After clicking a card, a modal appears:

> **Become a [Healer/Vanguard/Pet Tamer]?**
>
> This is your **permanent** profession. You cannot change it later.
>
> [ Cancel ] [ Yes, I'm sure ]

- **Cancel** → returns to choice screen (Page 2). No state committed.
- **Yes, I'm sure** → profession committed to character save, modal closes, brief confirmation animation, picker exits, player returned to normal gameplay.

### Implementation notes

- Picker is a new client screen/route (e.g., `ProfessionPicker.tsx`).
- Triggered from a session-init check: `if (character.level >= 13 && !character.profession) showPicker()`.
- Picker is **modal/blocking** — cannot be skipped, cannot navigate away.
- Commit calls a new endpoint: `POST /api/profession/choose` with `{ profession: 'healer' | 'vanguard' | 'petTamer' }`.
- Server validates: player level ≥ 13, no existing profession set, profession value is one of the three valid options.
- On server reset (per launch plan), all returning players hit the picker on their first login at Level 13+.

---

## Onboarding

- Profession picker appears on next login after reaching Level 13.
- No migration plan needed — server reset coincides with launch.

---

## Integration notes for implementation

- Add `profession` field to character save (alongside existing `rank` / `clan` / `bloodline` / `village`).
- Add `professionRank` and `professionXp` fields (or a nested object) — store per-profession progress so future profession-swap support doesn't lose data.
- Honor Seals already exist in [api/save/[name].ts](api/save/[name].ts) with a 200/save cap — no schema work needed for the currency itself.
- **Healing endpoint rework:** [api/player/heal.ts](api/player/heal.ts) currently enforces `identity.name === targetName`. Healer profession needs this gate relaxed for Healers, with checks for: target consent, target not in battle (`inBattle`/`pendingAttacker`), per-target 5-min cooldown, same-village requirement, and Rank 10 unlock for world-wide visibility.
- **Hospital screen UI work:** [shinobij.client/src/screens/Hospital.tsx](shinobij.client/src/screens/Hospital.tsx) today only shows the self-heal timer. The Healer profession needs:
  - List of hospitalized players in village (Ranks 1–9)
  - World map / list of injured village mates (Rank 10)
  - Heal button per row with per-target cooldown indicator
  - Min-HP filter, name search
- Village Guard system at [api/village-guard/](api/village-guard/) already handles raid defense — Vanguard missions plug in here.
- **Vanguard PvP kill attribution:** distinguish AI defender vs human defender kills in raid resolution — only human kills grant XP/Seals.
- **Clan Honor Seal pool:** new shared clan-scoped storage (`save:clan-<slug>` already exists for clan data). Add `honorSealPool` field + leader-distribution endpoint.
- **Daily reset timing:** Pet Tamer "First Expedition" bonus, Vanguard Seal cap, Vanguard alt-account checks all need a consistent server-side daily reset (suggest UTC midnight).
- Pet Tamer Phase 1 only needs a PvE damage multiplier — no pet stat/training/expedition APIs required yet.

---

## Items intentionally deferred

- **Profession swap policy** — not added in v1. Players are locked to their chosen profession until this is designed.
- **Village upgrade Honor Seal sinks** (Training Hall, Town Defense, Mission Hall, Hospital, Guard upgrades) — deferred until the village upgrade system exists.
- **Pet Tamer Phase 2** (training speed + expedition rewards) — deferred until pet training and expedition APIs are built.
