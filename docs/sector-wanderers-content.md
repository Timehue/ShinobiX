# Sector Wanderers — Content & Voice (the written layer)

> Status: **CONTENT DRAFT, not started.** Written 2026-06-25. Companion to
> `docs/sector-wanderers-plan.md` (the spec). That doc says *how* Wanderers work and
> stay cheat-proof; **this** doc is the writers' room — named characters, voice, and
> the actual dialogue/quest text the encounters speak.
>
> **Everything here is cosmetic text.** No line below grants or takes anything by
> itself. All currency/XP/item movement is governed by the sealed server endpoints
> in the plan (§4, §5, §10). A `[Choice]` only *requests* an action; the server
> decides the result and the text shown is chosen to match the server's verdict.

---

## 0. How to read this doc

- **Scripted, not LLM** (plan §8.8). Lines are hand-written templates with
  interpolation tokens; variety comes from per-archetype variant pools, not
  generation.
- **Template tokens:** `%player` (display name), `%village`, `%sector`, `%biome`,
  `%element`, `%petName`, `%ryo`, `%rival.scar` (the remembered detail from a past
  fight — see §7). Tokens resolve client-side from already-known data; none of them
  is a trust surface.
- **Tone bible:** terse, weathered, a little mythic. These are road-worn shinobi, not
  quest-givers with floating exclamation marks. Humor is dry. Threats are quiet.
  Nobody over-explains. Keep lines short enough to read on mobile in one glance.
- **The tell in text:** the first time a Wanderer speaks in a session, its name plate
  reads *"Wandering shinobi"* under the name, and the dialogue box carries the small
  wanderer mon. Honest by design (plan §9) — we never pretend a Wanderer is a
  specific real player.

---

## 1. The roster at a glance

| # | Name | Archetype | Verb / mode | Biome | Flavor tie-in |
|---|---|---|---|---|---|
| 1 | **Old Mibu of the Tea-Road** | Peddler | Gift | forest / central | — |
| 2 | **Sister Yuki of the Broken Bell** | Pilgrim | Quest | snow | Healer |
| 3 | **Kazan the Ashbound** | Toll bandit | Shinobi duel / Rob | volcano | the **nemesis** centerpiece |
| 4 | **Tomoe & Kuro the Oni-Hound** | Beastmaster | Pet Coliseum | any | Pet Tamer |
| 5 | **Saji Two-Coins** | Gambler | Card Clash | central / shadow | — |
| 6 | **Hibiki the Tireless** | Wandering duelist | Shinobi duel (honor, not theft) | shadow | Vanguard; the *friendly* rival |
| 7 | **A [Enemy-Village] Patrol** | Faction unit | reactive (gift→duel in war) | any contested | village-war reactivity |

Seven is the seed set — enough to prove every verb, every challenge mode, both rival
polarities (villain Kazan / friendly Hibiki), and faction reactivity. Content scales
by adding archetypes to these same templates. Additional quest-givers (Caravan-master
**Doteki**, the defector **Nao**) and quest bosses appear in the **Quest Book (§11)**
and **Bestiary (§12)**.

---

## 2. Old Mibu of the Tea-Road — *Gift*

**Where:** forest & central roads. **Tell:** wanderer mon; "Wandering shinobi."
**Voice:** warm, rambling, grandfatherly; treats every traveler like a returning
grandchild. Never threatening.

**Intro (variant pool — one shown):**
> "Ahh, a face on the long road. Sit, sit — well, don't actually sit, you're in a
> hurry, I can tell. Here. Take this. No, I insist; an old man's pack is too heavy
> already."

> "You've the look of %village about you. I traded there, oh, before you were born.
> Take something for the road — a kindness keeps better than coin."

**Choices:**
- **[Accept his gift]** → *"There. Now you owe me nothing — but if our roads cross
  again, tell me how it served you."* (Server grants the sealed gift.)
- **[Decline — "Keep it, elder."]** → *"Hah! A shinobi with manners. Rarer than a
  mythic seal these days. Go on, then — the road remembers the polite ones."*
  (No reward; small standing gain — plan §8.3.)
- **[Ask about the road ahead]** → a one-line rumor seeded from world-state: *"They
  say %village and their rivals are at each other's throats again. Keep your hood up
  past sector %sector."* (Pure flavor; surfaces live war state — plan §8.4.)

**Rare variant — the small favor (gift-with-strings):**
> "Tell you what — carry this letter to the next soul you meet wearing Frostfang
> colors, and the tea's on me next time. Deal?"

This quietly seeds a micro-quest (§6 pattern) without a quest marker.

---

## 3. Sister Yuki of the Broken Bell — *Quest*

**Where:** snow sectors, near ruins. **Tell:** wanderer mon. **Voice:** quiet,
sorrowful, resolute. A healer who lost her temple. Speaks in short, weighted lines.

**Quest: "The Bell That Doesn't Ring"** (full text, three beats)

**Beat 1 — the ask:**
> "You hear it? No. No one does anymore. The bell of my temple has gone silent — not
> broken. *Taken.* A raider out of the volcano roads carries its clapper as a
> trophy. I cannot fight him. You can."
>
> *"Bring it back, and I will mend whatever the road has broken in you."*

**Choices:**
- **[Accept]** → *"Then go with snow at your back. Three things they say of him: he
  laughs before he strikes, he never bleeds, and he is afraid of bells."* (Hands the
  `WANDERER_QUESTS` mission id — objective: defeat a specific volcano-sector target,
  e.g. Kazan, §4.)
- **[Not now]** → *"The bell has waited a year. It can wait for you. Come back when
  your hands are steadier."*

**Beat 2 — in progress (on re-approach before completion):**
> "Still silent. You still breathe. Then it is not finished. Go."

**Beat 3 — turn-in (objective met):**
> "...I hear it. Faint, under your footsteps. You carry it like you don't even know.
> Give it here— *there.* Listen."
>
> *(a single, clear note)*
>
> "That sound is the only payment I wanted. But take this too — a healer pays her
> debts in more than prayers." *(Server pays the sealed `claim-mission` reward.)*

**Design note:** the objective reuses an existing tracker ("defeat target X in sector
Z," plan §4.2). The quest *connects two Wanderers* — Yuki sends you after Kazan (§4),
which is how you can first meet the nemesis as a quest target rather than an ambush.

---

## 4. Kazan the Ashbound — *Shinobi Duel / Rob* (the NEMESIS)

**Where:** volcano roads, ashfall weather. **Affiliation:** none — a burned-out
mercenary. **Tell:** wanderer mon; "Wandering shinobi." **Voice:** gravelled, darkly
funny, unbothered. The villain you love to hate. **He is the recurring rival** — his
text is keyed to `wandererRivals` state (plan §8.2).

### 4.1 First meeting (no prior rivalry)

**Intro:**
> "Far from home, %village. This stretch of ash is mine — has been since the fire
> that made me. Toll's simple: your purse, or your teeth. Choose quick; I've got a
> whole road to ruin today."

**Choices (the encounter grammar, plan §8.1):**
- **[Fight]** → *"Good. I was getting bored."* → the **shinobi duel** (real PvP
  engine; your ante is escrowed — plan §5.2).
- **[Pay the toll]** → *"Smart. Cowardly, but smart."* (Server-capped ryo debit; you
  pass. He remembers you paid — that feeds his contempt next time.)
- **[Intimidate]** *(server-checked vs your level/standing — plan §5.4)*
  - success: *"...Hm. You've got a graveyard in your eyes. Fine. Walk. This time."*
  - fail: *"That the best face you've got? Ha! No. Pay or bleed."*
- **[Bribe — slip him extra to "forget you"]** → *"Generous. I'll forget your face by
  sundown. Probably."* (Larger ryo sink; raises no rivalry — you bought peace.)
- **[Flee]** → *"RUN then! Run all the way home! I'll remember this!"* *(Sets the
  rivalry seed — he WILL bring this up.)*

**On your win:**
> "...heh. Hah. Nobody's— put me down— in years. Take your coin back. And take
> *this*—" *(he flicks you a scorched trinket)* "—so you remember the day you earned
> an enemy." *(Server returns stake + pays sealed bounty.)*

**On your loss:**
> "Should've paid the toll." *(Server takes the forfeited ante. You wake at the
> nearest hospital — reusing existing KO flow.)*

### 4.2 Return — *he remembers* (rivalry active)

The line is selected by `%rival.scar`, the remembered detail (you fled / you paid /
he beat you / you scarred him). Examples:

- *(if you fled)* "There they are. The one with the fast feet. Let's see if they're
  faster than fire today."
- *(if he beat you)* "Back for the other half of your teeth? I kept them. Sentimental."
- *(if you beat him — now scarred)* "See this? *(taps a burn you gave him.)* You did
  that. I've thought about you every day since. Isn't that *romantic.*"

### 4.3 Escalation (he leveled up off your losses)

If Kazan keeps winning, he promotes — bigger, meaner, and he **places an AI-badged
bounty on your head** on the public board (plan §8.2): other players (and other
Wanderers) can now hunt *you* for it.
> "You made me famous, %player. There's coin on your head now — my coin. Wonder
> who'll collect it. Maybe me. Maybe a friend. Sleep light."

### 4.4 Resolution (you finally end him)

> "...so this is how it ends. On my own road. By your hand." *(a long breath)* "Take
> the bounty off my body. Take the road. You earned the both of them, %player. ...Tell
> them the Ashbound went down *swinging.*" *(Clears the rivalry; pays the accumulated
> sealed bounty; he won't respawn against you for a long cooldown — the story has an
> ending, which is what makes it a story.)*

---

## 5. Tomoe & Kuro the Oni-Hound — *Pet Coliseum challenge*

**Where:** any biome; near water and shade. **Affiliation:** Pet Tamer. **Tell:**
wanderer mon. **Voice:** bright, proud, treats Kuro as family. Competitive but kind —
a *sport* rival, not a thief.

**Intro:**
> "Oh-ho! That %element pet of yours — Kuro, look, look! It's got *eyes* on it.
> Tamer, I'll make you a deal: my hound against your best beast, in the coliseum.
> No purse-snatching. Just the joy of a good scrap. You in?"

**Choices:**
- **[Accept — to the coliseum]** → *"YES! Kuro, you hear that? Game on!"* → the
  **continuous pet duel** runs (server re-runs the sim to verify, plan §4.5).
- **[Show off a different pet]** → opens your pet picker, then the duel.
- **[Maybe later]** → *"Aw. Kuro's disappointed — look at that face. We'll be around.
  The good ones always come back for a rematch."*

**Pre-duel taunt (banter over the coliseum gate):**
> "Kuro doesn't lose on home sand. But I *love* being wrong — show me something!"

**On your win:**
> "HAH! Down, Kuro, down — they beat us fair! Tamer, that was *beautiful.* Here,
> a tamer pays a tamer." *(Sealed pet-win reward.)*

**On your loss:**
> "Good fight! No shame — Kuro's been at this since he was a pup. Patch your beast up
> and come find us. I want the rematch more than you do!" *(Casual; no ranked
> rating touched — plan §4.5. No real theft unless an ante was set.)*

**Rematch (if rivalry forms — the friendly version):**
> "There they are! Kuro's been *pacing.* Best two of three this time — for pride."

---

## 6. Saji Two-Coins — *Card Clash challenge*

**Where:** central hub & shadow back-roads. **Affiliation:** none (claims six).
**Tell:** wanderer mon. **Voice:** fast, slick, never quite honest, oddly likeable.
The lowest-stakes mode by design (the card outcome isn't server-provable — plan §4.3,
§4.6), so Saji is about *style and small purses*, not your life savings.

**Intro:**
> "Friend. *Friend.* You play the Clash? Course you do — got the hands for it, I can
> tell. Small stake, three locations, my deck against yours. Win and the purse is
> yours. Lose and, well... we'll call it tuition."

**Choices:**
- **[Deal me in]** → *"A player! Finally. Shuffle up."* → **Card Clash** vs Saji's
  **fixed deck** (sealed at start so he can't cheat the snapshot — plan §4.6).
- **[What's the stake?]** → *"Modest. I'm a sportsman, not a monster. House rules:
  small purse, no take-backs, and I get to look smug if I win."* (States the small,
  capped reward honestly.)
- **[Walk]** → *"Tch. Everyone's busy until they're curious. I'll be here. I'm always
  here."*

**Pre-match patter:**
> "Three locations. Cards on reveal. May the better liar win — and friend, I am a
> *very* good liar."

**On your win:**
> "...well, slap me sideways. The purse is yours, square and clean. Don't spend it
> all proving you're better than me. You're not. *Probably.*"

**On your loss:**
> "Tuition paid! Don't sulk — you learned something, and learning's never free.
> Double-or-nothing? No? ...Offer stands, friend. It always stands."

**Rematch hook (rivalry):**
> "Back for your money? I admire the optimism. Sit down. Same stake, fresh shuffle."

---

## 7. Hibiki the Tireless — *Shinobi Duel (honor, not theft)*

**Where:** shadow roads, dawn/dusk. **Affiliation:** Vanguard. **Tell:** wanderer
mon. **Voice:** earnest, disciplined, hungry to improve. The **friendly rival** — the
opposite polarity to Kazan. He never robs you; he wants the *fight*. Beating each
other becomes a running, respectful saga.

**Intro:**
> "You move like someone who's won a few. Spar me — no purse, no grudge, just steel.
> I'm trying to be the best on these roads, and I can't do that dueling shadows."

**Choices:**
- **[Spar him]** → *"Thank you. Truly."* → shinobi duel (no theft; win pays a small
  sealed honor purse — **never Honor Seals**, those are human-PvP-only, plan §8.5).
- **[Decline]** → *"Another day, then. I'll be on the road — I'm always on the road."*

**On your win:**
> "...again. You beat me *again.* Good. Don't you dare get soft on me — I'll catch up.
> Next time, %player. Next time I take it."

**On your loss:**
> "Yield! You yield? — good. That was *close*, closer than the scoreboard says. Heal
> up. I'll be looking for you; iron sharpens iron."

**Long-rivalry line (after many bouts):**
> "You know we've fought eleven times? I counted. Five to you, six to me. Tiebreaker,
> right now. For the road."

---

## 8. The [Enemy-Village] Patrol — *faction reactivity*

Demonstrates plan §8.4: the **same** Wanderer reads differently by world-state.

**Peacetime (neutral / gift):**
> "Hold — ah. %village, not one of ours, but no quarrel today. Roads are long; here,
> water-purse. Go safe."

**During an active war with the player's village (hostile / forced duel):**
> "%village. *Here?* You've got nerve crossing into a war you started. Turn back, or
> I make an example of you for the front."
- **[Stand your ground]** → shinobi duel; spawns denser in contested sectors during
  war (plan §8.4).
- **[Withdraw]** → *"Run home. Tell them the border still has teeth."*

---

## 9. Ambient barks (no interaction — flavor as you pass)

Short lines a Wanderer says when you walk near but don't engage. Keyed by biome /
time of day (plan §8.7). One shown at random, throttled so they don't spam.

- *(forest, day)* "Mushrooms are up. Good eating, if you know the safe ones."
- *(snow, night)* "Cold enough to freeze a curse mid-word out here."
- *(volcano)* "Watch the vents. They breathe when you're not looking."
- *(shadow)* "...you hear that? No? ...Good. Keep walking."
- *(central, day)* "Heading to the Card Hall? Tell Saji he still owes me."
- *(any, near a rival)* "Small world, %player. Smaller road."

---

## 10. Writing & safety checklist (for whoever fills these out)

- **Text is cosmetic.** Pick the line to match the server's verdict; never let a line
  *promise* a reward the server hasn't sealed (plan §5).
- **Keep the tell.** First speech in a session shows "Wandering shinobi" + mon.
- **Never name a real player.** Generated namespace only (plan §3.3).
- **Mobile-first length.** ~2 short sentences per box; the dramatic ones can run 3.
- **Variant pools** of 3–6 per intro so the same archetype doesn't read identically
  twice in a day.
- **Rival lines** branch on `%rival.scar` state; write at least the four key beats
  (you fled / you paid / they beat you / you scarred them) per recurring archetype.
- **Profession currency stays human-only** — flavor a Vanguard/Healer Wanderer freely,
  but they pay ryo/items, never Honor Seals (plan §8.5).
- **Card mode = small stakes** in the *writing* too — Saji jokes about "tuition," he
  doesn't threaten your fortune. The voice should match the economic ceiling (§4.3).

---

## 11. Quest Book — the deep quests (random-roll pool)

Quest-giver Wanderers don't hand out one fixed errand. Each draws **one quest from a
weighted pool**, gated by the player's level band (`lib/pve-difficulty.ts`),
world-state, and which quests are already active or completed (no dupes, no repeats
until a cooldown lapses). Every quest is a server-authored `WANDERER_QUESTS` entry
(plan §4.2): the id, the stages, and the **sealed** rewards live server-side; the
client only renders the text and reports objective completions the **server
independently verifies**.

**These are meant to be hard.** Multi-stage, boss-gated, often chaining a shinobi
duel with a pet or card challenge, several time-boxed, a few with branches that
change the ending and your standing. They are the "campaign" inside the wandering.

**Verifiability rule (mirrors §4.3 — load-bearing):** a quest's *big* reward must
hang on a **server-verifiable** step — a shinobi-duel KO (real PvP session) or a pet
duel the server re-runs (`runPetDuel`). Card-match steps and "travel / deliver"
steps are connective tissue with *modest* weight, because the server can't prove
them. This is how a card-flavored quest (Q5) still pays out safely: its final, big
reward gates on a verifiable bodyguard duel, not the card games.

**Failure & abandon:** a failed time-box or a death on a final boss doesn't burn the
quest — it resets to its last checkpoint stage on a cooldown (so a hard quest is a
*grind to master*, not a one-shot loss). Abandoning returns you to the pool after a
cooldown. None of this is client-trusted: stage state lives in the
`WANDERER_QUESTS` claim record (plan §4.2, §5.4).

> **Reward currencies:** ryo + the occasional **fateShard** (rare, hard daily cap) +
> a unique **title** (`storyTitle`) + sometimes a sealed item. **Never Honor Seals**
> (those stay human-PvP-only — plan §8.5). All amounts are *sealed server-side*; the
> values below are design intent for tuning, not client-trusted numbers.

---

### Q1 — "The Bell That Doesn't Ring" · giver: Sister Yuki · band ~25–40 · **HARD**

The seed quest, now three real stages with a branch and a timer.

**Stage 1 — The Thief.** A raider out of the volcano roads carries the clapper of
Yuki's temple bell as a trophy. *Objective:* defeat **the Ashbound raider** (an
`ashbound-raider` boss, or **Kazan** himself if you have a rivalry — §4) in a
volcano sector. *(Server-verifiable: shinobi-duel KO.)*

**Stage 2 — The Cursed Carry (time-boxed).** The clapper is cursed; the moment you
take it, a *"The bell wants to ring"* meter starts (a soft real-time timer on the
existing cooldown infra). Carry it to Yuki's ruined temple (sector Z) before it
"rings," surviving two ambushes on the way. **Branch:**
- **Carry it raw** → the final boss is *enraged* (harder) but the reward gets a
  fateShard bonus.
- **Cleanse it early** (spend a Cleanse item, or get a Healer Wanderer/player to
  lift it) → easier final boss, base reward.

> *Yuki, on hand-off:* "Whatever you do — do not let it finish the sound. A bell that
> rings once will ring *forever.*"

**Stage 3 — The Bell-Wraith.** Re-hanging the clapper wakes the temple's sealed
guardian, the **Bell-Wraith** (new boss AI, §12). Defeat it to end the silence.
*(Server-verifiable.)*

**Reward:** large ryo + title **"Bellbearer"** + fateShard (branch bonus).
**Fail (the bell rings):** clapper lost; quest resets to Stage 1 after a cooldown;
Yuki: *"...it rang. I heard it in my teeth. Rest. We try again when you're ready."*

---

### Q2 — "The Hollow Caravan" · giver: **Caravan-master Doteki** (new) · band ~15–30 · **HARD**

A low-band gateway into hard content — escalating waves and a genjutsu twist.

**Stage 1 — The Trail.** Doteki's caravan vanished. Track it across **three sectors**
(travel/flavor step), finding worse signs at each: scattered crates, then blood,
then silence.

**Stage 2 — The Ambush (waves).** At the wreck, **three escalating bandit waves**
hit — survive all three. *(Verifiable via the duel sessions / wave clears.)* The last
wave is led by **Bandit Captain Goro** (new AI) — but he fights *wrong*, like a
puppet on strings.

**Stage 3 — The Hand on the Strings.** Beat Goro and the real enemy reveals itself: a
genjutsu **Puppeteer, "Itoguchi"** (new boss AI, §12), who was driving the captain.
**Branch (consequence):**
- **Spare Goro** (he was controlled) → he becomes a friendly bark Wanderer later;
  +standing.
- **Execute Goro** → bigger immediate ryo, −standing, a colder world reaction.

**Reward:** ryo + a sealed consumable bundle + title **"Caravan's Shield."**

---

### Q3 — "The Frostfang Defector" · giver: **the Defector (Nao)** (new) · band ~40–60 · **HARD, branching**

A faction quest that only rolls when a war involving the player's village is active
or recently ended (plan §8.4). Heavy moral branch.

**Stage 1 — The Offer.** A defector from the enemy village offers intel that would
turn the war — for safe passage out. **Branch at the top:**
- **Trust them** → escort them across two sectors; a sealed intel reward feeds your
  village's war effort.
- **Turn them in** → bounty from your village + standing with your Kage, but you make
  an enemy of every defector-sympathizer Wanderer (a standing flag).

**Stage 2 — The Silencer.** Either branch summons **Hunter-Nin Shirakawa** (new boss
AI, §12), an elite sent to erase the defector (and now you). A genuinely hard duel —
Shirakawa opens from stealth, hits fast, and flees-to-reposition. *(Verifiable.)*

**Stage 3 — The Line You Drew.** Resolution dialogue branches on Stage 1 + whether
you spared or killed Shirakawa. Standing and a small world-state ripple persist.

**Reward:** large ryo + title **"Border-Walker"** (trust) or **"Kage's Blade"**
(turn-in) + fateShard. The two titles are mutually exclusive — your choice is
remembered.

---

### Q4 — "The Coliseum Gauntlet" · giver: Tomoe · band: scales to your pets · **HARD**

The Pet-mode campaign — and proof the challenge modes feed quests cleanly.

**Stage 1–3 — The Gauntlet.** Three escalating **pet coliseum duels** vs named
Wanderer beasts (each a stronger pet AI). *(Each server-re-run-verified — plan §4.5.)*

**Stage 4 — The Storm-Hound.** The finale: **Raijū, the Storm-Hound** (new boss
*pet* AI, §12), a mythic-tier Lightning beast with a revive and a screen-wide ult.
Survive and win.

**Reward:** a sealed **pet item** (gear/food bundle) + title **"Beast-Crowned"** +
fateShard. Losing any duel drops you to the previous stage (grind-to-master, not
wipe).

---

### Q5 — "The Gambler's Debt" · giver: Saji Two-Coins · band: any · **MEDIUM (high flavor, safe stakes)**

A card-flavored quest that stays cheat-safe by ending on a *verifiable* duel — the
clean answer to "card outcomes can't be proven."

**Stage 1–2 — The Table.** Saji owes a patron, "The House." Play **two Card Clash
matches** vs the patron's enforcers to buy him time. *(Card steps = low weight,
flavor; small purse.)*

**Stage 3 — The Collection.** The House calls the debt anyway and sends a
**bodyguard, "Kuroban"** (new AI, §12) to take it out of Saji's hide — and yours. A
hard **shinobi duel.** *(This is the verifiable step the real reward hangs on.)*

**Stage 4 — The Twist.** Win and Saji... is gone, of course — but he left you his
"lucky" stake and a note. Comedic-noir payoff.

**Reward:** modest ryo (it *was* a gambler's debt) + title **"House Breaker"** + a
cosmetic card-back. Deliberately the *lightest* econ reward of the set, matching the
mode's unverifiable nature.

---

### Q6 — "Ashes of the Ashbound" · CAPSTONE · conditional · band: high · **VERY HARD**

Only rolls when you have an **active Kazan rivalry at high escalation** (plan §8.2) —
the nemesis arc delivered as a quest, an alternative to ending him on a random road.

**Stage 1 — The Lieutenants.** Fight through two of Kazan's promoted lieutenants
(new AI: **Cinder** and **Slag**) across volcano sectors. *(Verifiable.)*

**Stage 2 — The Lair.** Kazan in his **promoted boss form** (§12) — bigger, meaner,
and referencing every prior encounter via `%rival.scar`.

**Resolution:** ends the rivalry for good (the §4.4 death scene), pays the **entire
accumulated sealed bounty**, grants title **"Ash-Ender,"** and clears Kazan from your
roster for a long cooldown. The story gets an ending — which is the whole point.

---

### 11.x Rolling, weighting & anti-cheat (quest pool rules)

- **Weighted draw** by level band + world-state; Q3 needs a war, Q6 needs a high
  Kazan rivalry, Q4/Q5 are biased toward players who engage pet/card modes.
- **One active "epic" at a time** (the multi-stage ones) so the journal doesn't flood;
  short side-errands (the Old Mibu letter, §2) can run alongside.
- **Server-authoritative throughout:** stage advancement is granted by the server on a
  verified objective (a duel KO via the PvP session, a re-run pet duel), never on a
  client "I did it." Card/travel steps advance on completion but gate no large
  reward. Stage state + cooldowns live in the claim record (plan §5.4).
- **No economy break:** fateShard payouts share the existing rare-currency daily caps;
  titles are cosmetic; nothing changes existing rates.

---

## 12. Bestiary — new AI defined for the quests

All entries are **`CreatorAi`-shaped** (plan §2; `types/creator-ai.ts`) and scale via
the existing `aiStatsForLevel` / `aiHpForLevel` curves. Bosses set `isBossAi: true`,
`masterAi: true` (smart AI even mid-level), and `hpFloorExempt: true` so their HP is
authored, not floored. **Numbers below are design intent** — final values get tuned
by the balance harness in build; they are not client-trusted (the server seals each
fight's opponent, plan §5.1). Art reuses the player-avatar / pet pipelines or a
single generated portrait each.

| id | Name | Lvl (intent) | Element / role | Signature | Used in |
|---|---|---|---|---|---|
| `ashbound-raider` | Ashbound Raider | band-matched | Fire / bruiser | "Cinderlash" burn-on-hit | Q1 S1 |
| `bell-wraith` | The Bell-Wraith | ~40 boss | Yin / control | "Toll" — stun pulse on a timer; enrages if the clapper was carried raw | Q1 S3 |
| `bandit-captain-goro` | Bandit Captain Goro | ~28 | Earth / defender | "Iron Wall"; fights erratically (puppet tell) | Q2 S2 |
| `puppeteer-itoguchi` | Itoguchi, the Hand | ~32 boss | Genjutsu / control | "Strings" — copies your last jutsu; summons a puppet add | Q2 S3 |
| `hunter-shirakawa` | Hunter-Nin Shirakawa | ~55 boss | Lightning / assassin | Opens from stealth, burst + reposition-flee; punishes turtling | Q3 S2 |
| `raiju-storm-hound` | Raijū, the Storm-Hound | mythic boss **pet** | Lightning / aggressive | Revive-once + screen-wide "Thunderhead" ult | Q4 S4 |
| `house-kuroban` | Kuroban, the Bodyguard | ~45 boss | Bukijutsu / bruiser | Weapon-stance; shrugs the first big hit | Q5 S3 |
| `kazan-ashbound` | Kazan the Ashbound | scales w/ rivalry | Fire / bruiser | The nemesis; promoted form gains "Eruption" AoE | Q6 / §4 |
| `ashbound-cinder` | Cinder | band-matched | Fire / burst | Glass-cannon DoT | Q6 S1 |
| `ashbound-slag` | Slag | band-matched | Earth / defender | Tank/peeler; guards Cinder | Q6 S1 |

**Design notes per boss kind:**
- **Control bosses** (Bell-Wraith, Itoguchi) lean on stun/copy to punish a one-button
  loadout — they reward varied jutsu and item use (turn-affordability, the existing
  combat tags).
- **Assassin boss** (Shirakawa) uses reposition-flee to teach spacing on the PvP hex
  grid; AI rules drive open-from-stealth → burst → retreat.
- **Boss pet** (Raijū) is authored in the **pet** data model (`types/pet.ts`): a
  mythic-rarity Lightning pet with a revive trait + an ult, run through the same
  deterministic `runPetDuel` the player's pets use — so the server can re-verify the
  win exactly like any pet duel (plan §4.5).
- **Kazan** is the only AI with *stateful* scaling: his level/loadout escalate with
  the `wandererRivals` record (plan §8.2), and his promoted form is the Q6 capstone.

All of these are additive content; none alters an existing AI, balance number, or
reward rate.
