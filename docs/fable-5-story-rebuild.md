# ShinobiX — Story Rebuild Handoff (Post-Interview)

Status: authoritative story plan. This document supersedes the pre-draft interview
(`docs/fable-5-story-handoff.md`, now answered) and the combined rebuild request it
came from. The owner's interview answers are recorded in Appendix A and are the
source of truth. Engine facts a writer or implementer must respect are in Appendix C —
they were verified against the codebase on 2026-07-08, not assumed.

Hard anchors carried forward unchanged: four village arcs; the Hollow Gate central;
good, neutral, and bad paths with real consequences; level-capped wandering story
events; a Kage fight ending every arc; payoff into the playable Kage system.

One deliberate departure from the original rebuild request: this is a **deepen and
rethread**, not scorched earth. The shipped nine-milestone skeletons already track
the right beats (the Storm Engine, the erased names, the loyalty seals, the ledgers),
and 22 cast portraits already exist on disk. The rebuild keeps the cast and the
milestone spine, rewrites what the story *means*, threads a rival and seven new VN
interludes through every arc, and wires choices into systems that remember them.
That honors the owner's answers 5 and 6 ("keep it" / "keep it, make it deeper") and
keeps the asset and save-data blast radius small.

---

## 1. Core premise

A new shinobi joins a village to prove they belong. The village means it when it
welcomes them: the virtue is real, the training is real, the rank ladder is real.
So is the bill. Each of the four villages was founded by survivors of the Sunken
Court — a civilization that powered itself on what its people gave up — and each
founder built a virtue to make sure it never happened again, on top of the machine
that did it. The Kages know. The Elders collect. Every duel sworn in Stormveil,
every name burned in Ashen Leaf, every oath sealed in Frostfang, every secret filed
in Moonshadow feeds the Hollow Gate, and the seat the player is climbing toward
comes with the valve and the ledger. The story is about what the player does when
they learn that belonging, as their village defines it, is the feedstock — told
against a rival who decided the answer years ago, and a Kage who will explain,
sincerely, why the bill is worth paying.

---

## 2. Character dynamics map

The emotional center is the **player character** (owner answer 1). Everyone else is
positioned by what they do to the player's want — *prove I belong* — and to the
player's wound, which is keyed to the home village (owner answers 2, 3):

| Home village | The wound the village aggravates |
|---|---|
| Stormveil | Dismissed as weak — nobody thought you'd matter |
| Ashen Leaf | A name that shames you — family erased or dishonored |
| Frostfang | Having been left — abandonment |
| Moonshadow | Having been used — trust spent by someone else |

The village's culture is both salve and trap for its wound. Frostfang promises the
abandoned player that no one is ever allowed to leave; that promise is the seal.
Moonshadow teaches the used player to trust no one; that lesson is the ledger.
Quest copy should never name the wound. Show it in what the player is offered.

### The spokes

- **Kite Harrow — the main rival** (owner answer 4; name approved 2026-07-08).
  An **unsworn** shinobi: licensed out of Central, bound to no village, hired by
  all four. ("Unsworn" is the in-world term; "paper shinobi" is banned from all
  copy by owner decision.)
  Arrived the same season as the player, wants the same thing — to belong — and
  pursues it the opposite way: the player earns, Harrow transacts. Harrow keeps
  getting promoted faster, because every village's reward system pays for exactly
  the behavior its Kage siphons. That's what makes the rival *right*: "Your village
  doesn't reward what it preaches. It rewards what it feeds on. I'm just honest
  about the menu." Harrow appears in all four arcs (each player meets them inside
  their own arc) at levels 20, 80, and 92, plus wandering cameos.
- **The Kage — the villain of each arc** (owner answer 4). Not a monster wearing a
  title: an account holder. Each Kage inherited the valve with the seat, found their
  predecessor's ledger, and decided the arithmetic was survival. Their finale
  transformation is the Gate paying out the account — they become the thing they
  siphoned (§8).
- **The Elder — the temptation.** Owner answer 9: the Kage *and the Elders* profit.
  Each elder takes a different cut and carries it differently, which gives each
  village a different level-58 recruitment scene: Vanta (Stormveil) wants out and
  is looking for someone to hand his guilt to; Mori (Ashen Leaf) rationalizes —
  the accounting *is* survival; Sova (Frostfang) is a true believer who enforces;
  Iro (Moonshadow) is a profiteer who would sell Sable for a better position.
- **The companion — the cost made personal.** Mira Volt, Toma Reed, Captain Yura,
  Nyx — all kept from shipped content. Each one is hurt by the siphon in a way the
  player can see long before the player can name it. Each tracks a three-state
  relationship (§10): trust / respect / fear.
- **The Withheld emissaries — the alternative.** The existing Legacy emissaries and
  Wandering Sage, recast as descendants and echoes of the Court's refusers (§8).
  They are the only faction that wants nothing from the player except a pattern.

### The dynamics that carry scenes

- Player ↔ Harrow: same want, opposite method. Every Harrow scene is the player's
  path reflected back with the varnish off.
- Companion ↔ Kage: the human wound. Mira against Raiko, Toma against Hoshina,
  Yura against Kael, Nyx against Sable — each companion is a person the system is
  currently digesting.
- Elder ↔ player: recruitment. The offer at 58 is the story's midpoint thesis:
  you can be fed to the machine, or fed *by* it.
- Kage ↔ Gate: a mortgage. The Kage thinks they own the valve. The finale shows
  who owns whom.

---

## 3. Setting pressure map

Rule for all copy: the world shows its beliefs through rules and consequences, not
speeches. Each village needs its pressure visible in daily practice a player walks
past — before any NPC explains anything.

**Stormveil** — founded on the lesson *"they died obedient."* Freedom as survival
doctrine. Visible practice: the challenge ledger posted in the square decides
everyone's week; no locks on any door, and everyone sleeps armed; disputes are
settled by public duel, and refusing one costs more than losing one. The valve:
the Storm Engine under the arena — every sworn rivalry, every grudge fed into the
challenge system, drawn down as power. The elders take arena fees, bets, and first
pick of storm-tempered steel. The lie the village tells itself: "no one commands
us" — while the ledger commands everyone.

**Ashen Leaf** — founded on the lesson *"they died forgotten."* Memory as survival
doctrine. Visible practice: the public register; name-burning ceremonies for the
dishonored; memorial ash mixed into the mortar of new buildings, so the village is
literally built from its dead. The valve: the First Flame and the register — grief
and reverence drawn off every offering, and an erased name's grief flows
uncontested, because no one is left to claim it. The elders curate history and
sell restorations and absolutions. The lie: "the dead ask this of us."

**Frostfang** — founded on the lesson *"they died alone."* Loyalty as survival
doctrine. Visible practice: oath-marks on the wrist checked at every gate; roll
calls twice a day; solo travel is a crime with a kind name ("endangerment").
The valve: the seal vault under the ice — every act of obedience performed *while
doubting* cedes the doubt, and the ceded choice is the tithe. The elders are
exempt from the marks; that exemption is the entire fee. The lie: "the marks keep
us warm."

**Moonshadow** — founded on the lesson *"they died seen."* Secrecy as survival
doctrine. Visible practice: alias law (every citizen keeps at least two names);
a ledger economy where secrets are collateral; a speech curfew after dark. The
valve: the Hollow Mirror and the ledgers — every withheld truth is a held breath,
and the Mirror taxes it. The elders run the brokerage. The lie: "what no one
knows, no one can take."

All four founders diagnosed the same death differently, and all four were wrong the
same way: the Sunken Court didn't die obedient, forgotten, alone, or seen. It died
*ceded* — it gave the Gate everything, one reasonable surrender at a time. Each
village's virtue guards one flank and feeds the Gate through the same door. That
is the reversal the mid-game grid reveal turns on (§8).

---

## 4. Main conflict and escalation path

The engine of the conflict (owner answers 5, 7, 9): the Hollow Gate is the Sunken
Court's power grid, still running, and the people running it now are the Kages and
Elders, who convert their own population's interior life into power and position.
The player's climb toward rank is also a climb toward the valve.

Escalation is staged by what the player can *name*, not by monster size:

1. **Rumor (levels 4–25).** Oddities with mundane cover stories. A duel that left
   both fighters listless. An offering that made the mourner forget the face. The
   word "Hollow" appears only in places official copy wouldn't — graffiti, a
   drunk's joke, a child's rhyme.
2. **Sight (level 42 interlude).** The player sees an intake working once —
   village-specific instrument, no explanation. They can describe it. They can't
   name it.
3. **Instrument (level 58 interlude).** The elder names it, because the elder is
   offering a cut. "The draw." First time the machinery is called a system by
   someone inside it.
4. **Grid (levels 65–85; the level-75 wandering event).** The player learns all
   four villages sit on anchors of one lattice. The founders' virtues are four
   doors into the same room. The Kage's private war-footing suddenly reads as
   account management.
5. **The mouth (levels 92–100).** The pre-finale mandate scene, then the Kage
   fight — the Gate paying out the Kage's account mid-battle. The player's
   accumulated choices decide who stands with them and what the Kage says (§14
   pattern from the old handoff is kept: the Kage calls out real recorded choices).
6. **The valve changes hands (post-100).** The Kage-system consequence layer:
   eligibility, titles, heralds, and the standing question the post-game asks —
   the seat comes with the valve; what does the player do with it?

A good player starves the valve. A neutral player meters it. A bad player feeds
it better than the Kage did. No lane is a failure route; each gets its own
recognition, reactions, and Legacies.

---

## 5. Player-facing act structure

### The cadence

The nine shipped combat milestones stay at levels 4, 15, 25, 35, 50, 65, 75, 85,
100 — their array shape is save data and the Kage gate reads `storyProgress >= 9`
(Appendix C, rule 1). The rebuild adds **seven VN-only interludes per village** at
levels **20, 30, 42, 58, 70, 80, 92**, delivered as level-gated triggered events
outside the milestone array (owner asked for more VN between 20 and 95). Sixteen
story beats per village total.

### Interlude skeleton (shared shape, localized content)

- **L20 — "The Unsworn."** Kite Harrow arrives, outperforms someone the
  player likes, and collects payment without joy. Choice: how you treat the
  outsider — respect / measure / dismiss. Seeds the rival thread.
- **L30 — Companion scene.** Mira / Toma / Yura / Nyx off duty, one personal fact
  the player didn't ask for. Choice seeds the relationship state (trust base,
  respect base, or an early crack toward fear).
- **L42 — "The Draw" (sight).** The player witnesses the village's intake work
  once. Choice: report it / keep it / test it. First Hollow-lore traits.
- **L58 — "The Elder's Cut."** The elder shows the player the books — their
  version of them — and offers a taste. Choice: refuse / take note / take the cut.
  The story's midpoint. This choice is loudly remembered (finale dialogue, elder
  epilogue, wanderer reactions).
- **L70 — The wound scene.** The village aggravates the player's core wound
  directly (see per-village rows). The most personal choice in the arc; shifts the
  companion relationship one state in some direction no matter what is picked.
- **L80 — "Harrow's Shortcut."** Harrow found the bargain the Gate offers people
  who belong nowhere, and offers to split it. Choice: pull them back / use them /
  push them in. Fixes the rival's finale role: witness, broker, or casualty.
- **L92 — "Witnesses."** Pre-finale mandate. Three figures meet the player on the
  road — one who trusts them, one who fears them, one who wants to use them —
  cast from the player's actual recorded traits (first shipped use of
  `requireTrait` hub pages; authoring rule in Appendix C, rule 3). Sets which
  supporters appear at the finale and which mandate the post-game recognizes:
  trusted liberator, necessary arbiter, or feared successor.

### Acts, as the player experiences them

- **Act I — Welcome (4–25):** milestones 4/15/25 + interlude 20. Belonging is
  earned and feels good. Rumor-stage oddities only. Harrow arrives as an
  irritant, not a thesis.
- **Act II — The price noticed (30–58):** interludes 30/42/58 + milestones 35/50.
  The promotion at 50 asks for something small and wrong (each village's shipped
  level-50 beat already does this — keep). The elder's offer lands right after
  the player has something to lose.
- **Act III — The valve found (65–85):** milestones 65/75/85 + interludes 70/80.
  The shipped mid-arc reversals stay (Mira's staged betrayal, the ancestor beast,
  Yura's oath break, Nyx choosing a side) — recast so each reversal also exposes
  one more fitting of the grid.
- **Act IV — The account comes due (92–100):** interlude 92 + the Kage finale.
  The fight is the argument: the Kage's corrupted virtue against whatever the
  player's record says they are.
- **Post-game — The seat and the valve (100+):** Kage-system consequences,
  path-gated Legacies, the "Seat of Scars" wandering event, epilogue reactions.

### Per-village beat sheets

Milestone rows only note what the rebuild *changes*; shipped structure otherwise
stands. Interlude rows are new content.

**Stormveil — "Freedom Without Chains"** (wound: dismissed as weak)

| Lv | Beat | Type | Rebuild notes |
|---|---|---|---|
| 4 | First Thunder | milestone | Keep. Add one rumor-stage oddity: the losing scout can't remember why he was angry. |
| 15 | The Riot Bell | milestone | Keep. The planted orders now carry a draw-tally mark the player will re-see at 42. |
| 20 | The Unsworn | interlude | Harrow wins a ledger duel for pay, refuses the crowd's toast. |
| 25 | Orders Written in Lightning | milestone | Keep. |
| 30 | Mira, Off the Ledger | interlude | Mira's one honest hour: why she keeps two exit plans. Relationship seed. |
| 35 | The Storm Engine | milestone | Keep — this IS the valve; recast copy so the Engine reads as infrastructure, not superweapon. |
| 42 | The Draw | interlude | After a public grudge-match, the player sees the arena floor vent something the winners no longer have. |
| 50 | Jonin of the Unchained Sky | milestone | Keep (political-trap promotion). |
| 58 | Vanta's Cut | interlude | Vanta offers the player his own share — he wants a successor for his guilt, not his profit. |
| 65 | The Mission That Should Not Exist | milestone | Keep (civilian "rebel" camp). The refusers here are draw-refusers — first named resistance. |
| 70 | The Scheduled Loss | interlude | The ledger books the player against the person who first dismissed them as weak — and orders them to lose. Wound scene. |
| 75 | Mira's Betrayal | milestone | Keep. Her cover story is now specifically about protecting draw-refusers. |
| 80 | Harrow's Shortcut | interlude | Harrow has a buyer for the Engine's schematics: themselves. |
| 85 | The Kage's True Storm | milestone | Keep (forced open conflict = a deliberate surge of feedstock). |
| 92 | Witnesses | interlude | Mandate scene. |
| 100 | Break the False Thunder | milestone | Keep the fight; add trait-gated Kage lines + the sacrifice (below). |

Sacrifice (owner answer 10): to break the Engine for good, the player must
**publicly refuse the final challenge** — the one unforgivable act in duel
culture. Good path pays it (standing surrendered on its own terms; the crowd's
salute at 4 becomes silence, then something better). Neutral path meters the
Engine and carries the refusers' distrust instead. Bad path takes the Engine and
pays with Mira — trust is no longer available from anyone, only fear.

**Ashen Leaf — "The Names in the Ash"** (wound: a name that shames you)

| Lv | Beat | Type | Rebuild notes |
|---|---|---|---|
| 4 | Roots of the Shinobi | milestone | Keep. Rumor: a mourner at the register can't picture her son's face. |
| 15 | The Forbidden Seed | milestone | Keep. |
| 20 | The Unsworn | interlude | Harrow appraises the register out loud: "Efficient. Most archives only eat paper." |
| 25 | Names Removed from Scrolls | milestone | Keep — already the arc's spine. |
| 30 | Toma's Relic | interlude | Toma shows the player the family relic that shouldn't exist; asks them to hold it. Relationship seed. |
| 35 | The First Flame Chamber | milestone | Keep. The Flame is recast: not evil — trained to accept stolen offerings (shipped intent, keep). |
| 42 | The Draw | interlude | A name-burning: the player watches the crowd's grief pour somewhere the ash doesn't go. |
| 50 | The Branch That Rises | milestone | Keep (promotion requires swearing to an official lie). |
| 58 | Mori's Cut | interlude | Mori's offer is knowledge: which names were chosen by *need*. He calls the arithmetic mercy. |
| 65 | The Mission of Quiet Ash | milestone | Keep. |
| 70 | The Register Opens | interlude | The player's own shamed name surfaces in the register's intake queue. Erase it, claim it, or trade it. Wound scene. |
| 75 | The Ancestors Speak | milestone | Keep. |
| 80 | Harrow's Shortcut | interlude | Harrow found what an erased name is worth at the Gate: "You people burn currency." |
| 85 | The Kage Burns the Future | milestone | Keep (the Great Offering = a scheduled balloon payment). |
| 92 | Witnesses | interlude | Mandate scene. |
| 100 | The Tree Must Choose | milestone | Keep the fight; trait-gated lines + sacrifice. |

Sacrifice: holding the register open to restore the erased requires **a name of
equal weight — the player's own**. Good path pays it: the name the player finally
made worth something goes into the register, and NPC address changes afterward
(title/flavor hooks, §10). Neutral keeps some records sealed and carries the
sealed families' unanswered questions. Bad path claims the register and decides
which names matter — paid for with Toma's hope.

**Frostfang — "The Oath That Locked the Door"** (wound: having been left)

| Lv | Beat | Type | Rebuild notes |
|---|---|---|---|
| 4 | The Pack Survives | milestone | Keep. Rumor: a rescued drill partner thanks the player with a stranger's flatness. |
| 15 | The Missing Patrol | milestone | Keep. |
| 20 | The Unsworn | interlude | Harrow works unmarked, is paid double for it, and everyone pretends not to notice. |
| 25 | The Loyalty Seal | milestone | Keep — the valve's retail interface. |
| 30 | Yura, Off Duty | interlude | Yura recites the roll call from the winter she was left behind — the year she volunteered for the mark. Relationship seed. |
| 35 | The Pale Pack | milestone | Keep (the unsealed). |
| 42 | The Draw | interlude | A gate check: the player watches a doubting soldier obey, and watches what leaves him when he does. |
| 50 | Jonin of the Frozen Oath | milestone | Keep (rank vs seal terms). |
| 58 | Sova's Cut | interlude | Sova's offer is the exemption itself — the only currency Frostfang elders take. She believes every word she says. |
| 65 | Orders in White Blood | milestone | Keep (Kael manufactures the border fear that keeps the vault fed). |
| 70 | The Mark That Stays Warm | interlude | The seal is offered as comfort: take it, and no one you bind can ever leave you. The abandonment wound, weaponized kindly. |
| 75 | Yura Breaks the Oath | milestone | Keep — already the arc's best scene. |
| 80 | Harrow's Shortcut | interlude | Harrow can forge marks: loyalty as a product. "You could own people who *can't* leave. Isn't that the dream here?" |
| 85 | The Kage Freezes Dissent | milestone | Keep (the White Silence = a mass draw-down). |
| 92 | Witnesses | interlude | Mandate scene. |
| 100 | The Oath Must Break | milestone | Keep the fight; trait-gated lines + sacrifice. |

Sacrifice: breaking the coercive marks unbinds *everyone* — including from the
player. Good path pays it: **no oath will ever guarantee anyone comes back for
them**; whoever stands with them afterward chose to. Neutral installs review and
exemption law and carries the deserters' cases personally. Bad path re-points the
vault at itself and pays with Yura — she stays, sealed, and the player knows the
difference between staying and being kept.

**Moonshadow — "The Price of a Secret"** (wound: having been used)

| Lv | Beat | Type | Rebuild notes |
|---|---|---|---|
| 4 | No One Saves You | milestone | Keep. Rumor: the trial's decoy target thanks the player, then denies the trial happened. |
| 15 | The Sold Secret | milestone | Keep. |
| 20 | The Unsworn | interlude | Harrow buys a secret about the player, then tells the player what they paid. An introduction and a threat, delivered as a courtesy. |
| 25 | Masks Beneath Masks | milestone | Keep. |
| 30 | Nyx, One True Thing | interlude | Nyx trades the player one verified truth about themselves — at cost — to teach how the economy works. Relationship seed. |
| 35 | The Hollow Moon Contract | milestone | Keep. |
| 42 | The Draw | interlude | A confession booth that isn't for absolution: the player watches where the whispers drain. |
| 50 | Jonin of the Hidden Knife | milestone | Keep (promotion requires blackmail work). |
| 58 | Iro's Cut | interlude | Iro's offer is a shelf in the archive: the player's own file, and the right to edit anyone else's — for a fee that compounds. |
| 65 | Mission to Kill a Witness | milestone | Keep. |
| 70 | Your File | interlude | The player reads their own ledger entry — the village has recorded them since level 4, and the file quotes their actual choices back at them (trait-gated lines). The used-again wound, in writing. |
| 75 | Nyx Chooses a Side | milestone | Keep. |
| 80 | Harrow's Shortcut | interlude | Harrow's buyer wants the Mirror itself. Harrow, for once, hesitates — being copied is the one thing that frightens someone with no home. |
| 85 | The Kage Owns Every Secret | milestone | Keep (living doubles, false confessions). |
| 92 | Witnesses | interlude | Mandate scene. |
| 100 | The Moon Belongs to No One | milestone | Keep the fight; trait-gated lines + sacrifice. |

Sacrifice: the Mirror only breaks for someone **fully seen** — the player's whole
record, every logged choice across the arc, published to the village. Good path
pays it and lives publicly ever after (world-reaction copy references their real
trait record). Neutral keeps the network under strict law and carries the sealed
war-starting truths alone. Bad path takes the ledgers and pays with Nyx — the
one broker who dealt straight with them files the player under "client."

---

## 6. Key NPCs and what each one wants

| NPC | Role | Wants | Will trade | Path deltas |
|---|---|---|---|---|
| Kite Harrow | Main rival, all arcs | To belong somewhere that can't revoke it | Anything, priced fairly; never loyalty | Good: becomes the finale's witness and the Accord's first hire. Neutral: the player's broker. Bad: the last honest voice, then a casualty or an enemy. |
| Raiko Veyr | Stormveil Kage | An unconquerable village; secretly, to stop hearing the Engine | The truth, if beaten in the open | Finale form: pure rivalry — can't stop fighting, even when he's won. |
| Hoshina Enju | Ashen Leaf Kage | The village to outlive everything, whatever the mortar costs | Restorations, selectively | Finale form: the offering — the Flame wears her. |
| Kael Whitefang | Frostfang Kage | Zero desertions, zero doubts, zero winters like the last one | Safety, at list price | Finale form: the oath — a puppet of his own marks, unable to choose at all. |
| Sable Nocturne | Moonshadow Kage | A village no one can see well enough to hurt | Any secret except her own | Finale form: the secret — no true face left under the masks. |
| Elder Vanta | Stormveil elder | Out — and an heir for his guilt | His whole share, too eagerly | Can defect to the player at 58; his epilogue depends on whether they let him buy peace. |
| Elder Mori | Ashen Leaf elder | The arithmetic to have been worth it | Which names were chosen by need | Never defects; can be beaten in an argument at 92 if the player restored names. |
| Elder Sova | Frostfang elder | The system she'd die for to deserve her | Exemption — the only elder currency | True believer; on the bad path she kneels first and means it, which should be worse than fear. |
| Shade Master Iro | Moonshadow elder | A better shelf in whatever archive survives | Anyone, including Sable | Flips to whichever side is winning at 85; both sides know it. |
| Mira Volt | Stormveil companion | To trust one person without an exit plan | Her cover, eventually her life | States: trust / respect / fear (traits, §10). |
| Toma Reed | Ashen Leaf companion | His family's name back | His safety, too cheaply | States: hope / caution / disillusionment. |
| Captain Yura | Frostfang companion | An oath worth what she paid for it | Obedience, until 75 | States: trust / oathbound respect / fear. Her grammar arc: "I am ordered" → "I choose." |
| Nyx | Moonshadow companion | To retire owing nothing to anyone | One card always held back | States: partnership / transactional respect / suspicion. |
| The Wandering Sage | Withheld keeper | The Court's mistake never repeated | Legacy trials; history, in fragments | Already shipped (Legacy system); recast as the survivor-line of the refusers. |
| Legacy emissaries | Withheld echoes | To find their pattern repeated in the living | Recognition — nothing else | Already shipped; their VN copy gains the Court framing. |

---

## 7. Village worldview table

| | Stormveil | Ashen Leaf | Frostfang | Moonshadow |
|---|---|---|---|---|
| Founding lesson | "They died obedient" | "They died forgotten" | "They died alone" | "They died seen" |
| Virtue | Freedom | Memory | Loyalty | Secrecy |
| Daily practice | Challenge ledger; no locks; armed sleep | The register; name-burnings; ash in the mortar | Oath-marks; roll calls; no solo travel | Alias law; secret-collateral economy; speech curfew |
| What the Kage siphons | Rivalry-heat | Grief and reverence | Ceded choice | Withheld truth |
| The valve | Storm Engine under the arena | First Flame + the register | Seal vault under the ice | The Hollow Mirror + the ledgers |
| The Kage's argument | "A village that fights itself can't be conquered" | "The dead hold the walls" | "Choice is the crack that lets winter in" | "What no one knows, no one can take" |
| What the others call it | Banditry with a flag | Ancestor worship that eats its young | A barracks pretending to be a family | A blackmail racket with a moon on it |
| The lie it tells itself | "No one commands us" | "The dead ask this of us" | "The marks keep us warm" | "No one can hurt what no one knows" |

Every faction sounds right from inside. Never write a villager who knows they're
in the wrong village.

---

## 8. Hollow Gate truth and how the player learns it

**The truth** (owner answer 7): the Hollow Gate is the power grid of the Sunken
Court, the civilization under what is now Central. It was built as a utility: a
lattice that turned ceded interior life — grief you didn't want to carry, fear
before a battle, a grudge you were glad to be rid of — into workable power. It
wasn't evil at inception, and the story is stronger if early copy lets a player
half-agree with it. Then the Court learned to bill. It died not in a war but of
anesthesia: a people who had surrendered so much, one reasonable piece at a time,
that no one was left who wanted anything. The Gate outlived its city the way a
furnace outlives a house.

Four refugee columns walked out of the fall. Each founder took one lesson and
built a village against it — and each village, knowingly or not, settled on one
of the grid's four anchors. The virtues were real fixes for the wrong diagnosis.

**The Kages** did not invent the siphon. Each one, on taking the seat, found the
predecessor's ledger and the valve that comes with it, and made the same choice
for four different sincere reasons. The finale transformation is not a power-up;
it is the Gate settling an account. You become what you siphoned. The horror of
the finale is that it's a *succession* the player is interrupting — and the
post-game's standing question is that the player is now in the line of
succession.

**Legacies** (owner answer 8): some of the Court refused the cession — the
**Withheld**. They carried their whole selves out, and what they refused to
surrender persisted as patterns: mercy, endurance, protection, deception,
domination. A Legacy is inherited by *matching the pattern in action* — which is
exactly what the shipped server-counter requirement model already measures. The
line the whole system hangs on: **the Gate is made of what people gave up;
a Legacy is what someone refused to give up.** The Gate can counterfeit a Legacy;
a counterfeit is a stolen identity, and emissaries can smell the difference.

**How the player learns it, in order:**

1. Rumor (4–25): cover stories that don't quite cover. No proper nouns.
2. Sight (42): one intake, witnessed, unexplained.
3. Instrument (58): the elder names "the draw" while offering a cut.
4. Grid (65–85): the level-75 wandering event ("Four Seals, One Gate") plus the
   85 milestone reveal that the four anchors are one lattice — and that the
   founders were wrong the same way.
5. Succession (92–100): the Sage or an emissary gives the player the last piece —
   the ledger passes with the seat — right before the player fights for the seat.
6. The Hollow Gate dungeon (already shipped) is retconned cleanly: descending it
   *is* descending into the Court. The finale's Hollow Gate Key already ships;
   now it means something.

Never deliver 1–5 as a lore dump. Each stage arrives attached to a person who is
paying for it.

---

## 9. Legacy meaning and post-game identity path

Owner answer 10 makes the post-game identity **cost-defined**: each village's true
ending has a named sacrifice (§5 beat sheets), and the identity the world assigns
afterward reflects which cost the player paid — or made someone else pay.

**Identities** (computed from the finale lane + accumulated path counters, §10):

- **Liberator** — paid the sacrifice personally. Public trust, council-backed
  recognition, messier and healthier village flavor.
- **Warden** — metered the machine instead of breaking it. Institutional respect,
  moral weight carried visibly; officials ask them where the limits are.
- **Hollow Crown** — took the valve. Feared, obeyed, fully playable: darker
  titles, harsher patrol copy, merchants who offer before being asked.
- **Fractured** — mixed record. The world survives and keeps mentioning the
  contradictions.

**Path-gated Legacies** (structure kept from the request; names editable):

- Four good-leaning, one per village: *Stormbreaker's Refusal, the Namekeeper,
  the Oath Unmade, the Open Moon.*
- Four bad-leaning: *the False Thunder, the Cinder Crown, the Iron Snow, the
  Hollow Mask.*
- Two neutral/mixed: *the Warden's Ledger, the Gray Accord.*
- One capstone per dominant identity, cross-arc.

Requirements ride the existing server-owned counter engine (`r(stat, atLeast)`),
using new server-only story counters (§10) — never client-save traits, except for
purely cosmetic gates. Most Legacies stay activity-earned; path Legacies are
identity rewards, not power progression (per the balanced-PvP pillar).

Legacy lore surfaces inside wandering events, not codex dumps. Emissary register
(kept from the request): "A Legacy is not what you did once. It is what the road
expects you to do again."

---

## 10. Quest and system hooks that carry story through play

Verified against the codebase; file references in Appendix C.

**Interlude delivery.** New data module (e.g. `src/data/story-interludes.ts`, with
trigger wiring in `lib/` — App.tsx is at its ratchet ceiling). Interludes are
level-gated triggered VN events with ids like `story-interlude-<village>-<level>`,
completing through the existing battle-free `completeTriggeredEvent` path. They
never touch `storyProgress`. The milestone array is append-only save data;
interludes must not be inserted into it. Interludes pay story only — traits,
standings, relationship shifts, at most a title or cosmetic; never XP, ryo,
items, or power (owner decision 4).

**Choice memory.** Every interlude/milestone choice grants a *unique* trait,
schema `<vil><level>-<slug>` (e.g. `sv58-took-the-cut`, `ml70-read-the-file`).
Unique traits make the dedup'd `storyTraits` set countable and gateable. Later
scenes reference earlier choices via `requireTrait`/`forbidTrait` choice routing —
supported today, used by zero shipped content; the rebuild is its debut.
Authoring rules in Appendix C, rule 3 (hub pages need an ungated fallback choice).

**Relationship states.** Three mutually exclusive traits per companion
(e.g. `mira-trust` / `mira-respect` / `mira-fear`), granted at the L30 seed and
moved at L70/L80 via `forbidTrait`-gated upgrades. No engine change needed; a real
`Record<npc, state>` save field is an optional affordance if trait juggling gets
noisy.

**Finale variants.** The Kage finale gets a `requireTrait` hub page casting 2–3
accumulated choices back at the player in the Kage's voice ("You took Vanta's
share. You know how the arithmetic tastes.") plus lane-distinct final choices.
The mandate interlude (92) decides which supporter cameo page plays.

**Path counters, server-owned.** New `LegacyStatKey`s: `storyGoodChoices`,
`storyNeutralChoices`, `storyBadChoices`, `storyChaptersCleared`,
`storyVillageEnding` (0/1/2/3 lane code) — server-only, no bootstrap seeding from
client saves. Bumped from a story-settle endpoint, referenced by path Legacies via
`r(...)`.

**Server-authoritative story engine.** (Owner decision 3: full, not finale-only —
future-proofed and seamless.) Story progression state moves server-side: a sealed
`story:<player>` record — questbook-style staged state — owns chapter
eligibility, interlude completion, choice lanes, relationship states, and finale
settlement. `character.storyProgress`, `storyTraits`, and relationship traits
become display mirrors the server never trusts. A chapter or interlude start
mints a sealed single-use token (level and prerequisites verified server-side);
completion validates against it, records the choice made, and bumps the path
counters. The finale settle additionally grants the title via `serverTitles` +
`api/_titles-registry.ts` (the current client-side `kageLiberatorTitles` write
migrates here), fires the herald, and writes the Hall entry.
`api/village/kage.ts` reads the server story record (or its mirrored save field)
for seat eligibility. Existing tester saves seed the record once on first
contact — migration risk is low with the pre-launch wipe pending. Every new
endpoint registers in `server.ts` (route-parity test enforces both directions).

**Story Hall.** (Owner decision 6.) The Hall becomes the full arc replay:
milestone chapters plus completed interludes, in level order, each showing the
choice the player actually made (read from the server story record). Read-only —
no re-choosing. This replaces the current flat 9-chapter dialogue list.

**Kage-system consequences (safe set).** Keep the unlock gate
(`level ≥ 100 && storyProgress ≥ 9`). Add per-lane grants: Liberator — herald
(`postVillageHerald`), Hall of Legends entry (`addHallEntry`, idempotent),
liberator title, `firstLiberator`-style permanent marker. Warden — arbiter title
+ measured herald copy. Hollow Crown — darker title, fear-flavored herald,
wanderer reaction set. **Never write `seatedKage`** — the seat is a live,
contested, player-held object won through the challenge system.

**Wandering story events.** All twelve events from the rebuild request ship
(owner decision 7), staggered through levels 20–95 by narrative fit, plus three
new connective events. Functions kept, levels reassigned:

| Lv | Event | Function |
|---|---|---|
| 22 | Border Smoke | false flag between villages; first cession echo (edited memory) |
| 26 | The Second Teacher | a foreign doctrine, then a test of whether it holds under raid |
| 31 | Three Footprints, One Body | intent echo — the Gate copies desperation, not bodies |
| 34 | What the Withheld Kept *(new)* | first Withheld contact: a sealed cache that opens only for a refusal |
| 38 | The Shrine That Both Sides Own | two villages, one shrine, trapped pilgrims, a relic choice |
| 44 | A Legacy Without a Name | reconstruct one act from three conflicting accounts |
| 48 | The Unsworn's Ledger *(new)* | Harrow met mid-job for a rival village — the rival thread on the road |
| 52 | Hostages at Black Bridge | a prisoner exchange collapses; diplomacy under fire |
| 56 | The Rival Who Keeps Losing | another village's challenger with a sealed cause |
| 62 | The Alliance Drill | Hollow sabotage turns a joint exercise live |
| 66 | The Fifth Anchor *(new)* | a false rumor of a fifth anchor under Central leads into what the Hollow Gate dungeon actually is |
| 74 | Four Seals, One Gate | the grid reveal — all four villages, one lattice |
| 82 | Emergency Powers | a valve decree; Kage-system foreshadow |
| 94 | The Last Road Before the Seat | the mandate mirror: one who trusts, one who fears, one who wants to use you |
| 100+ | Seat of Scars | governance fallout after the finale — not a new fight |

More connective events may be added wherever arcs need tissue (owner license).
All are recast onto the Court lore. Delivery uses the proven emissary template:
weight-0 wanderer archetypes + per-player spawn synth + a server endpoint owning
eligibility and rewards (sealed-KV, like `wanderer-quest`/`questbook`). Rewards
follow the philosophy: flags, reactions, titles, Legacy hints — not power.

**World reactions.** `announce()` importance tiers map to story weight: interlude
aftermaths are silent or low; finales are high (village herald) with mythic
reserved for first-ever liberations. Path-flavored wanderer greeting variants key
off `questStandings`-style flags, which already drive delayed flavor reactions.

**Art.** (Owner decision 8: professional-studio bar; no obligation to reuse
existing assets.) Full art pass in the established in-game anime/shinobi style,
generated through the shipped pipeline (`gen-asset.mjs` → gpt-image-1 → sharp →
WebP) or fal:

- New or regenerated portraits for the whole cast — the four Kages, elders,
  companions, Kite Harrow, minor speakers — replacing any of the 22 shipped
  portraits that fall short of the new bar. Convention `/portraits/<slug>.webp`
  stands.
- Four Kage finale forms, published as `ai:<aiProfileId>` shared images (the
  mechanism ships today, so this art can land without code changes).
- Scene/key art for every interlude and milestone (`/scenes/<eventId>.png`) and
  finale key art per village.
- Path-Legacy badges and title emblems (`/badges/legacy-<slug>.webp`).
- One Harrow concept round for owner sign-off before batch generation.
  Locked visual spec (owner, 2026-07-08): a strikingly attractive woman in her
  early twenties; traveling-broker look, ledger charms on her belt, no village
  marks anywhere. Her age is never stated in copy (verified), so the spec is
  visual-only and needs no dialogue changes.

Rules: generation keys stay untracked (main checkout `shinobij.client/.env`) and
are never committed; only optimized finals are stored; when the client dist is
rebuilt, commit only the intended files (PNG recompression churn is a known
trap). Renaming any story NPC also touches `src/data/village-leadership.ts`
(same names, separate render path). Every replaced original is deleted in the
same change (§12).

**Writing process for all copy.** The three passes from the request stand:
outline → voice filter → cleanup, with Appendix B as the voice filter's checklist.

---

## 11. Decisions (owner, 2026-07-08)

The unresolved questions were answered by the owner; recorded here as binding:

1. **Rival.** Name Kite Harrow approved; gender and look are designer's choice
   (one concept round before batch art). The term "paper shinobi" is banned from
   all copy — the in-world term is **the unsworn**. ("Ryn" had been rejected
   earlier — Storm Caller Ryn already ships.)
2. **Cross-village endgame: village-specific at launch.** Post-game identity is
   computed from the home arc's ending plus wandering-event path weights.
   Foreign campaigns stay a future expansion.
3. **Server authority: FULL.** The whole story engine — milestones, interludes,
   choice lanes, finale — is server-authoritative from day one, for
   future-proofing and a seamless experience (§10).
4. **Interlude rewards: story only.** Traits, standings, relationship states,
   occasionally a title or cosmetic. Never XP, ryo, items, or power.
5. **Dead-`conclusion` bug: fix the engine.** Pre-battle beat text becomes
   available everywhere.
6. **Story Hall: extend it.** Completed interludes and the choices made replay
   in the Hall alongside chapters (§10).
7. **Wandering events: all twelve ship**, staggered through 20–95 by narrative
   fit, plus three new connective events (§10 table); more may be added wherever
   arcs need tissue.
8. **Art: full professional pass.** New generation is the default; reuse only
   what clears the bar. Milestone event ids stay stable so admin `shared:img`
   overrides don't strand; replaced repo assets are deleted per §12.

Nothing remains open that blocks implementation.

---

## 12. Implementation-safe cut list

If scope tightens, cut in this order — each cut is self-sealing:

1. Interludes L30 and L80 (companion seed folds into L70; Harrow's shortcut folds
   into the 92 mandate). Five interludes per village still satisfy "more VN
   between 20–95."
2. Stagger the wandering-event waves: the lore spine ships first (Border Smoke,
   Four Seals, The Last Road, Seat of Scars) and the rest follow in updates —
   the full fifteen-event pool stays committed, only its schedule slips.
3. Finale variant hub → three static trait-gated Kage lines, no supporter cameo
   pages.
4. Relationship trait trios → a single trust/fear trait per companion.
5. Path-gated Legacies deferred post-launch (identity titles carry the weight
   alone; counters still accumulate from day one so nothing is lost).
6. Kage finale-form art deferred (emoji + existing Kage portraits; the `ai:<id>`
   publish mechanism means art can land later with zero code).
7. Interlude scene art deferred entirely (biome gradient fallback).

Never cut: the rival thread (L20 + one later beat minimum), the elder's cut at
L58, the per-village sacrifice, the three-lane finale with server-settled
consequences, the herald/Hall/title grants, and the server-authoritative story
engine — that last one is the foundation, not a feature.

**Cleanup obligations when the rebuild ships** (per the original request §18):
the cast survives, but the art pass (owner decision 8) will replace files —
every replaced portrait, scene, and badge is deleted in the same change, and the
implementation notes ship a manifest of removed / reused / added assets.
Required checks: no broken
`/portraits/<slug>.webp` resolutions for every speaker string in the new data; no
references to removed trait names; `analyzeVnFlow` passes on all new VN graphs
(with the known false-positive caveat on trait-gated hubs); route-parity test
passes for any new endpoints; `App.size.test.ts` ratchet respected. Document
removed/reused/added assets in the implementation notes.

---

## Appendix A — Owner interview answers (2026-07-08)

1. Emotional center: **the player character.**
2. Opening want: **prove they belong.**
3. Core wound: **village-dependent** — keyed to each village's core (loyalty,
   chaos, tradition, secrecy).
4. Rival: **create a main rival; the main villain of each arc is that village's
   Kage.**
5. Central conflict: **keep** (Hollow Gate fed by corrupted founding virtues).
6. Village worldviews: **keep, and make deeper.**
7. Hollow Gate: **an ancient civilization's power system that feeds on people —
   emotions or whatever the Kages siphon from their populations to gain power.**
8. Legacies: **power from some of the ancient people who lived at the time of the
   Hollow Gate.**
9. Who benefits: **the current Kages and Elders**, profiting from the siphon.
10. Sacrifice: **village-dependent — unique and deep per village.**
Plus: research how to make the story read as human-written and avoid AI
signatures (Appendix B); make the story longer, with more VN triggers between
levels 20 and 95 (§5).

Decision round (same day, recorded in §11): rival name approved, gender/look
designer's choice, "paper shinobi" banned in favor of "the unsworn"; endgame
village-specific at launch; FULL server-authoritative story engine; interludes
pay story only; fix the conclusion bug; extend the Story Hall; all twelve
wandering events staggered through 20–95 plus new connective events as needed;
full professional art pass with no obligation to reuse existing assets.

## Appendix B — Voice guide: writing copy that reads human

Distilled from current editor/community tell-lists (WP:AICATCH, the 2025 Helsinki
surge-word study, working editors' checklists) and narrative-design craft (Jon
Ingold, Failbetter, Emily Short, Josh Sawyer, Meg Jayanth). This is the Pass 2
filter for every line of VN copy.

**Blacklist — never in game copy:** tapestry, testament, delve, intricate,
pivotal, crucial, vibrant, "nestled," "renowned," "a testament to," "marking a
pivotal moment," "little did they know," "ancient evil," "destiny," "chosen one,"
"the fate of the world," "let out a breath they didn't know they were holding,"
"barely above a whisper," "something shifted," "eyes darkened," "the silence
stretched," "a wave of [emotion] washed over."

**Structural rules:**
- Kill the summary sentence. If a scene showed it, don't restate it — the
  explainer is almost always the paragraph's last sentence. Delete it.
- Ban "not X, but Y" beyond one use per chapter. Just assert Y.
- Budget em-dashes (one per screen) and triads (one per scene, only when rhythm
  is the point). Vary sentence length on purpose: a three-word line after a long
  one.
- Attribute lore to people, not fog. "Old Vanta swears the arena floor hums" —
  never "it is said."
- Let scenes end unresolved or on a mundane detail sometimes. Not every page
  closes on resolution.
- Specificity over scope: one goldfish stuck to a window implies the whole flood.

**Dialogue rules:**
- Cover-the-name test: strip speaker names; if you can't tell who's talking, the
  voices aren't done.
- Nobody states their emotion. Displace it: the angry go polite, the hurt change
  the subject, the scared make jokes.
- People interrupt, dodge, abandon sentences, and answer slightly off-axis.
  Perfectly cooperative turn-taking is a tell.
- No "as you know" exposition. If both characters know it, find an outsider, an
  argument, or ambient text.
- Names mid-conversation are a power move or an emotional spike — nothing else.

**Choice-writing rules (Ingold/Sawyer/Failbetter):**
- Three stances per beat: accept / reject / deflect. Never a labeled good/evil.
- Options are actions in the player's voice; no option may surprise the player
  with what it "meant." No false options that collapse to one result.
- Choice text ≤ 12 words; dialogue lines ≤ 30; compression forces image over
  explanation.
- A skill-flagged or bold option is allowed to backfire.
- Acknowledge immediately, pay off later: every remembered flag needs at least
  one real downstream callback, or the memory reads as theater.

**Idiolect cards** (enforce in review; 2–3 rules each):

- **Raiko Veyr:** short imperatives, present tense, everything a dare. Never
  apologizes; never explains twice.
- **Hoshina Enju:** liturgical cadence, first person plural ("we keep"), speaks
  of the dead in present tense. No contractions.
- **Kael Whitefang:** procedure and inventory — numbers, rosters, protocols.
  Answers questions with rules. Shortest lines in the game.
- **Sable Nocturne:** answers with questions; trades the shape of information
  without its content; never volunteers a sentence about herself.
- **Mira Volt:** jokes as armor, interrupts, nicknames everyone. Goes quiet when
  she's being honest — the quiet is the tell.
- **Toma Reed:** earnest, halting; lists facts when nervous; apologizes too
  much until the arc teaches him to stop.
- **Captain Yura:** military brevity in oath diction. Her arc lives in her
  grammar: "I am ordered" becomes "I choose."
- **Nyx:** prices things aloud; deflects warmth into terms ("that costs extra").
  Everything is a trade until, once, it isn't.
- **Kite Harrow:** fluent in every village's idiom and at home in none — the
  borrowing is the tell. Calls things by their price. The only character who
  says the quiet part plainly.
- **Elders:** Vanta speaks in aphorisms he stopped believing; Mori hedges like a
  footnote; Sova recites rules the way other people pray; Iro flatters with
  hooks in it.

## Appendix C — Engine facts the writer and implementer must respect

Verified 2026-07-08. Types in `shinobij.client/src/types/vn.ts`; content in
`src/data/storylines.ts`; VN reader `components/TriggeredVisualNovel.tsx`; flow
wiring in `App.tsx` (~3905 auto-trigger, ~5458 completion, ~5750 battle entry).

1. **The 9-milestone array is save data.** `storyProgress` is an index into it,
   and `api/village/kage.ts` gates seat unlock on `storyProgress >= 9`. Never
   insert steps; interludes are separate triggered events with their own ids.
2. **Battles attach per-choice** (`choice.battle`), only ever on the last page in
   shipped content. `conclusion` text is dead when `battle` is set (engine
   returns before rendering it) — fix or avoid (§11 item 5).
3. **`requireTrait`/`forbidTrait` work today** (filtered in the reader,
   unit-tested) but if every choice on a page filters out, the page silently
   auto-advances — every hub page needs one ungated fallback choice. The admin
   editor's `analyzeVnFlow` doesn't model trait gates and will emit false
   "unreachable" warnings on gated graphs.
4. **Traits are a deduplicated, append-only set** on `character.storyTraits`.
   Five identical picks look like one — hence unique-per-beat trait names
   (`sv58-took-the-cut`), with lane *totals* living in server counters, not
   traits.
5. **No dialogue templating exists.** Variant lines are built by routing to
   different pages via trait-gated choices, not by interpolating text.
6. **No post-battle VN resume exists.** Battle completion terminates the event.
   Epilogue beats go in the *next* trigger's opening page, or the small
   `resumePage` affordance gets built (optional).
7. **VN-only completion already works** for generic triggered events
   (`completeTriggeredEvent`) — but never advances `storyProgress`. Correct for
   interludes by design.
8. **Story rewards are client-paid today** and triggered-VN copies zero them.
   The finale's consequence grants must be server-settled (mint-token /
   questbook pattern, `docs/auth-and-anti-cheat-patterns.md`); new endpoints
   must be `route()`-registered in `server.ts` (no auto-routing;
   `server-routes.test.ts` enforces both directions).
9. **Titles:** server-granted story titles go through `serverTitles` + the
   registry in `api/_titles-registry.ts`, or the save sanitizer strips them.
   The shipped client-side `kageLiberatorTitles` write should migrate there.
10. **Portraits resolve by speaker-name slug** → `/portraits/<slug>.webp`;
    missing files fail silently to initials. Scene art `/scenes/<eventId>.png`
    falls back to biome gradients. Renames touch `village-leadership.ts` too.
11. **App.tsx is at its line-budget ceiling** (`App.size.test.ts`). All new
    story wiring lives in `lib/` / `data/` modules.
12. **Wandering story events** follow the emissary template: weight-0 archetypes
    in `lib/wanderers.ts`, per-player synth keyed on `(player, level, window)`,
    server endpoint owning eligibility + sealed rewards (`wanderer-quest` /
    `questbook` skeletons).
