# Early-Game Progression — Master Layout

The consolidated, refined plan for the new-player journey (creation → Genin →
toward Chunin), built to **work within the systems already in the game**. This is
the overview; detail lives in:
[`early-progression.md`](./early-progression.md) (rationale + numbers),
[`onboarding-tutorial.md`](./onboarding-tutorial.md) (FTUE detail + auto-learn),
[`competitor-early-game.md`](./competitor-early-game.md) (evidence).

---

## Ground rules — no new systems

This layout adds **no new mechanics**. It re-uses what already exists and layers
guidance/onboarding on top. Specifically:

**Existing systems used as-is:** levels + XP (`level × 100`), ninja ranks
(Academy 1-14 → Genin 15 → Chunin 30 → Jonin 50 → Special Jonin 80), the **rank
exams** as Logbook checklists, the **Logbook** quest-log, missions / hunts /
exploration with their **daily caps**, the **awakening** RNG element roll (kept),
**jutsu mastery** (0-50, free L1, +20/cast in battle), stat training, the
**profession** system (Healer / Vanguard / Pet Tamer), PvP, hospital, pets, clans.

**Explicitly NOT added:**
- ❌ **No new stamina / energy / action bar.** Stamina stays exactly what it is
  today — an *in-battle and training* resource. It is **not** a content gate.
- ❌ **No new currency.** Ryo + Fate Shards + the existing soft currencies only.
- ❌ **No new gating system.** **Daily caps** (20 missions + 20 hunts +
  exploration, `game.ts:57-60`) remain the *only* throttle on content, and the
  daily reset is the come-back-tomorrow hook.

**Every change below is one of three kinds:**
- 🟢 **Additive UI** — surfaces/explains what already exists; no balance, mostly
  client-only.
- 🟡 **Additive logic** — small, low-risk additions on top of existing systems.
- 🟠 **Tuning** — adjusts existing numbers; balance-sensitive, needs sign-off.

---

## The journey at a glance

| Band | Level / Rank | Existing systems in play | What the layout adds |
|---|---|---|---|
| **A. Creation** | Lvl 1 | character creator, bloodline→jutsu access, awakening, stats | 🟢 creation blurbs + stat preview · 🟡 auto-learn bloodline jutsu · 🟢 awakening reveal |
| **B. Academy (first session)** | Lvl 1–5 | village hub, D-rank missions, arena/hunt AI, training, exploration, awakening free roll @L2, Logbook | 🟢 **Academy Logbook checklist** + HUD "next goal" pin + empty-states + nav progressive-disclosure |
| **C. Academy (late)** | Lvl 6–14 | continued loop, Genin exam checklist appears @L11 | 🟢 checklist hands off to Genin Exam · 🟡 Academy PvP-protection · 🟢 profession teased |
| **D. Genin promotion** | Lvl 15 (gate @20) | rank→Genin @15, C-rank content @15, Genin exam gate @20 | 🟢 **Genin ceremony** unlocks profession picker + PvP + clan nav · 🟡 mastery req on exam · 🟠 re-tune exam stat count |
| **E. Genin → Chunin** | Lvl 15–29 | C-rank missions/hunts, Chunin exam @21, professions, clans, PvP, pets, profession dailies | 🟢 profession missions in Logbook · 🟢 clan as social hook · ceremony @Chunin |
| **F. Beyond** | Lvl 30+ | Chunin/Jonin/Special-Jonin exams (existing) | same pattern: ceremony + reveal at each rank |

---

## Band A — Creation (Level 1)

**In play (unchanged):** `CharacterCreator` (name / village / bloodline /
specialty); a chosen bloodline already *grants access* to its 4 jutsu
(`lib/bloodline.ts:87`); awakening; 20 starting stat points.

**Add:**
- 🟢 One-line **mechanical blurb** on each bloodline/village + a starting-stat
  preview (today they're flavor-only).
- 🟡 **Auto-learn the chosen bloodline's 4 jutsu at mastery level 1** and
  pre-equip 3 (+ universal Flicker), inside `createCharacter`. Client-only —
  verified it persists (the save sanitizer doesn't touch `jutsuMastery`,
  `onboarding-tutorial.md` §1.4). Turns "a ninja who can't fight" into combat-ready.
- 🟢 **Awakening reveal card:** "You awaken the [Bloodline] — you've learned 4
  jutsu," making the at-creation choice immediately matter.

---

## Band B — Academy, first session (Levels 1–5)

**In play (unchanged):** village hub, D-rank missions (`levelReq 1`,
~80-90 XP / 60-75 ryo), arena + hunt AI, stat training, exploration, the **free
awakening roll at Level 2** (RNG element, kept), the Logbook.

**Add (all 🟢 additive UI):**
- **Academy Training checklist in the Logbook** — the level 1-10 entry that's
  currently missing (the Logbook is empty until the Genin exam @L11). Six
  teach-by-doing goals in the **same row format as the exams** (full draft:
  `early-progression.md` §5a):
  1. Awaken your first element · 2. Equip your jutsu loadout (4) · 3. Win your
  first battle · 4. Train at the grounds · 5. Complete your first mission ·
  6. Sharpen a jutsu to mastery Lv 3.
  Each reads an existing counter — no new state except one
  `onboarding.academyClaimed` flag. Targets are multiplier-independent.
- **HUD "next goal" pin** surfacing the first incomplete checklist item, so the
  player always sees what's next without opening a menu.
- **Empty-state CTAs** (empty loadout → "Unlock your bloodline jutsu →", etc.).
- **Nav progressive disclosure:** foreground Academy-relevant locations
  (Missions, Training, Arena, Awakening); de-emphasize Clan / PvP / Ranked until
  Genin (using the *existing* rank, no new gate).

**Pacing:** daily caps only. Stamina is never surfaced as a blocker.

---

## Band C — Academy, late (Levels 6–14)

**In play (unchanged):** the same loop; the **Genin exam checklist already
appears at Level 11** (`App.tsx:26284`).

**Add:**
- 🟢 On Academy-checklist completion → a one-time **"Claim Academy reward"** →
  the Logbook's "next goal" now points at the **Genin Exam**. Seamless handoff.
- 🟡 **Academy PvP-protection:** players of Academy rank (level 1-14) can't be
  targeted in PvP (server reject in `api/player/attack.ts` / `challenge.ts` /
  `pvp/*`; client badge). Additive, low-risk; keep cPanel/Vercel in sync
  (`onboarding-tutorial.md` §1.8). *No PvP rank gate exists today — this is new
  protective logic, not a change to combat math.*
- 🟢 Profession path **teased** ("Choose your path at Genin").

**Goal:** work the Genin exam checklist (awaken element · train stats · 20
missions · 20 AI kills · 50 tiles) **+ a new "raise a jutsu to mastery 3"
requirement** (🟡 — teaches the jutsu system the exam currently ignores; combat-
driven, ~8 casts).

---

## Band D — Genin promotion (Level 15; exam gate at 20)

**In play (unchanged):** rank title flips to **Genin at level 15**
(`rankFromLevel`); the **Genin exam gates XP at level 20** until passed; C-rank
missions/hunts unlock at 15.

**Add:**
- 🟢 **Genin ceremony** — reuse the existing VN framework (the profession picker
  is already VN-style) so promotion is a *moment*, not the current `alert()`
  (`App.tsx:26455`). The ceremony is the **progressive-disclosure gate**: it
  reveals the **profession picker**, opens **PvP** (Academy protection ends), and
  surfaces **Clan** in the nav.
- 🟡 **Move the profession unlock from a floating Level 13 to the Genin
  promotion** (optional — see note). At 13-14 (Academy, PvP-protected) Vanguard
  has no PvP outlet and Healer few targets, so 2 of 3 professions are dormant
  anyway; Genin is when they all become usable. *If you'd rather not touch the
  unlock level, keep L13 and just place the ceremony — the layout still works.*
- 🟠 **Re-tune the Genin exam "Train 1000 stats" requirement** to the chosen XP
  multiplier — stat points scale with *effective* XP (`statPointsEarnedFromXp`,
  `App.tsx:2031`), so this number is only sane relative to the multiplier in
  force. (Decision: `early-progression.md` §0b / §9.)

> **Two "Genin" moments:** rank title @15 vs exam @20. Recommend the ceremony +
> profession picker fire on **passing the Genin exam** (the meaningful gate), with
> the level-15 title flip as a smaller "you're a Genin now" beat. Pick one anchor
> and keep it consistent.

---

## Band E — Genin → Chunin (Levels 15–29)

**In play (unchanged):** C-rank missions/hunts, the **Chunin exam checklist @L21**
(awaken 2nd element · 50 missions · 100 tiles · **join a clan** · beat the L25
Exam Proctor), professions active with their own 1-10 rank tracks, the existing
**profession daily missions** (`api/missions/daily.ts`), clans, PvP, pets.

**Add (🟢):**
- **Surface the active profession's next mission/rank in the Logbook** (today it's
  a separate `DailyProfessionMissions.tsx`) so exams + Academy + professions share
  one "what's next" home.
- **Clan introduced as the social hook** — the Chunin exam already requires it, so
  the layout simply breadcrumbs "join a clan" as the day-2 retention anchor.
- 🟡 **One-time early profession respec** (free until ~Chunin) — the L15 choice is
  permanent but made before the player has tried PvP/healing/pets; a single respec
  is the safety valve (`professions.md` defers full swap to v2).

---

## Band F — Beyond (Level 30+)

Chunin (exam @L21→gate 39), Jonin (@41), Special Jonin (@80) exams already exist
as Logbook checklists. Same pattern: each rank-up is a **ceremony that reveals the
next tier of content** (B-rank → A-rank → S-rank missions, ranked queue, village
guard, etc.) via the *existing* level/rank gates. Out of early-game scope; no new
mechanics needed.

---

## Change inventory (so nothing here rewrites a live system)

**🟢 Additive UI — no balance, mostly client-only:**
- Academy Logbook checklist + HUD next-goal pin + empty-states
- Nav progressive disclosure (hide/show by *existing* rank)
- Creation blurbs + stat preview · Awakening reveal · rank-up ceremonies
- Profession missions surfaced in the Logbook

**🟡 Additive logic — small, low-risk, on top of existing systems:**
- Auto-learn bloodline jutsu at creation (client-only, persists)
- Academy PvP-protection (server check + client badge; cPanel parity)
- "Raise a jutsu to mastery 3" requirement added to the Genin exam
- Profession unlock level 13 → 15 (a parameter change; optional)
- One-time early profession respec

**🟠 Tuning — existing numbers, needs sign-off (balance / live saves):**
- XP multiplier decision + Genin exam stat-count re-tune (coupled)
- *Optional:* smoother first few jutsu-training levels (the 3,000-ryo L1→2 cliff)
  — **not required**, since auto-learn + battle-XP mastery already lets a new
  player fight and grow jutsu without paying
- *Optional:* shorter hospital timer for low levels

**❌ Not added:** new stamina/energy system, new currency, any new content gate.
Daily caps stay the only throttle.

---

## Build order (recap)

> **Followable runbook:** [`early-progression-buildplan.md`](./early-progression-buildplan.md)
> has the task-by-task steps (exact files, code sketches, verify commands).


1. **Phase 1 (🟢 + the client-only 🟡):** auto-learn jutsu + Academy checklist +
   HUD pin + empty-states + nav disclosure. No API, no balance, no save risk.
2. **Phase 2 (🟡):** PvP-protection, Genin-exam mastery requirement, profession
   unlock move + ceremony, respec.
3. **Phase 3 (🟠, with sign-off):** XP-multiplier + exam re-tune; optional jutsu-
   cost / hospital smoothing.
